// GET /api/ms-callback  (Microsoft 로그인 후 돌아오는 주소)
// Microsoft → Xbox Live → XSTS → Minecraft 순서로 토큰을 교환해 자바 닉네임을 확인하고 저장
import { db, unsign, siteUrl, env } from './_lib.js';

const fail = (code) => Object.assign(new Error(code), { code });

function back(res, query) {
  res.writeHead(302, { Location: `${siteUrl() || ''}/?${new URLSearchParams(query)}#me` });
  res.end();
}

async function postJson(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* 무시 */ }
  return { ok: r.ok, status: r.status, data };
}

export default async function handler(req, res) {
  const { code, state, error } = req.query || {};
  if (error) return back(res, { mc: 'err', reason: 'cancelled' });

  let st;
  try { st = unsign(state); } catch { st = null; }
  if (!st || !code) return back(res, { mc: 'err', reason: 'state' });

  try {
    // 1) Microsoft 액세스 토큰
    const tr = await fetch('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env('MS_CLIENT_ID'),
        client_secret: env('MS_CLIENT_SECRET'),
        code: String(code),
        grant_type: 'authorization_code',
        redirect_uri: `${siteUrl()}/api/ms-callback`,
        scope: 'XboxLive.signin offline_access',
      }),
    });
    const tok = await tr.json();
    if (!tr.ok) { console.error('MS token', tok); throw fail('ms_token'); }

    // 2) Xbox Live
    const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
      Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${tok.access_token}` },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType: 'JWT',
    });
    if (!xbl.ok) throw fail('xbl');
    const uhs = xbl.data.DisplayClaims.xui[0].uhs;

    // 3) XSTS
    const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.data.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT',
    });
    if (!xsts.ok) {
      const x = xsts.data?.XErr;
      if (x === 2148916233) throw fail('no_xbox');
      if (x === 2148916238) throw fail('child');
      throw fail('xsts');
    }

    // 4) Minecraft 로그인
    const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
      identityToken: `XBL3.0 x=${uhs};${xsts.data.Token}`,
    });
    if (!mc.ok) throw fail(mc.status === 403 ? 'not_approved' : 'mc_login');

    // 5) 자바 프로필 (닉네임, UUID)
    const pr = await fetch('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${mc.data.access_token}` },
    });
    if (pr.status === 404) throw fail('no_java');
    if (!pr.ok) throw fail('mc_profile');
    const profile = await pr.json();

    // 6) 저장: 같은 닉네임을 인증받은 다른 계정이 있으면 인증 해제 후 본인에게 부여
    const pattern = encodeURIComponent(profile.name.replace(/_/g, '\\_'));
    await db(`profiles?mc_verified=is.true&mc_name=ilike.${pattern}&id=neq.${st.uid}`, {
      method: 'PATCH',
      body: { mc_verified: false, mc_verified_via: null, mc_uuid: null },
      returnRows: false,
    });
    await db(`profiles?id=eq.${st.uid}`, {
      method: 'PATCH',
      body: { mc_name: profile.name, mc_uuid: profile.id, mc_verified: true, mc_verified_via: 'microsoft' },
      returnRows: false,
    });
    return back(res, { mc: 'ok', name: profile.name });
  } catch (e) {
    console.error('MS 연동 실패', e);
    return back(res, { mc: 'err', reason: e.code || 'unknown' });
  }
}
