// POST /api/discord-member → 로그인한 회원이 뒷세계 디스코드 서버에 들어와 있는지 확인
// DISCORD_GUILD_ID 가 없으면 { configured: false } (사이트는 '모두에게 안내' 방식으로 동작)
import { getUser, getAccess, httpError } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) throw httpError(401, '로그인이 필요합니다');
    const guild = process.env.DISCORD_GUILD_ID;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!guild || !token) return res.status(200).json({ ok: true, configured: false });

    const { profile } = await getAccess(user.id);
    if (!profile?.discord_id) return res.status(200).json({ ok: true, configured: true, member: null });

    const r = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guild)}/members/${encodeURIComponent(profile.discord_id)}`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (r.ok) return res.status(200).json({ ok: true, configured: true, member: true });
    if (r.status === 404) return res.status(200).json({ ok: true, configured: true, member: false });
    console.error('서버 참가 확인 실패', r.status, await r.text());
    return res.status(200).json({ ok: true, configured: true, member: null, error: `Discord ${r.status}` });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}
