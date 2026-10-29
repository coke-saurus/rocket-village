// POST /api/ms-start → Microsoft 로그인 주소를 돌려줌 (로그인한 사람만)
import { getUser, sign, siteUrl } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: '로그인이 필요합니다' });

    const clientId = process.env.MS_CLIENT_ID;
    if (!clientId || !siteUrl()) {
      return res.status(503).json({ error: 'Microsoft 연동이 아직 설정되지 않았습니다 (MS_CLIENT_ID, SITE_URL)' });
    }

    const state = sign({ uid: user.id, exp: Date.now() + 10 * 60 * 1000 });
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: `${siteUrl()}/api/ms-callback`,
      scope: 'XboxLive.signin offline_access',
      state,
      prompt: 'select_account',
    });
    return res.status(200).json({
      url: `https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?${params}`,
    });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ error: e.message });
  }
}
