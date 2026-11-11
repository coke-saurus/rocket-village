// POST /api/discord-join  { provider_token }
// 디스코드 로그인 때 받은 'guilds.join' 권한으로 회원을 로켓단의 뒷세계 디스코드에 자동 참가시킴
import { getUser, getAccess, httpError } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) throw httpError(401, '로그인이 필요합니다');
    const guild = process.env.DISCORD_GUILD_ID;
    const bot = process.env.DISCORD_BOT_TOKEN;
    if (!guild || !bot) return res.status(200).json({ ok: true, configured: false });

    const token = String(req.body?.provider_token || '');
    if (!token) throw httpError(400, '디스코드 로그인 정보가 없어요. 다시 로그인해 주세요.');

    const { profile } = await getAccess(user.id);
    if (!profile?.discord_id) throw httpError(400, '디스코드 계정 정보가 없어요');
    if (profile.banned) throw httpError(403, '이용이 정지된 계정이에요');

    const r = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guild)}/members/${encodeURIComponent(profile.discord_id)}`, {
      method: 'PUT',
      headers: { Authorization: `Bot ${bot}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token }),
    });
    if (r.status === 201) return res.status(200).json({ ok: true, configured: true, joined: true });
    if (r.status === 204) return res.status(200).json({ ok: true, configured: true, already: true });

    const text = await r.text();
    let code; try { code = JSON.parse(text).code; } catch {}
    console.error('서버 자동 참가 실패', r.status, text);
    const reason =
      r.status === 401 || code === 50025 ? '디스코드 로그인에 서버 참가 권한이 없어요. 다시 로그인해 주세요.'
      : code === 40007 ? '이 디스코드 서버에서 차단된 계정이에요.'
      : code === 30001 ? '디스코드 서버가 너무 많이 가입되어 있어요 (최대 개수 초과).'
      : r.status === 403 ? '봇에게 초대 권한이 없어요. 관리자에게 알려 주세요.'
      : `디스코드 오류 (${r.status})`;
    return res.status(200).json({ ok: false, configured: true, error: reason });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}
