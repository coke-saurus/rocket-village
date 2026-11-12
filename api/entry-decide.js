// POST /api/entry-decide  { id, decision: 'accepted' | 'declined' }
// 사이트에서 의뢰자가 판매자의 수락을 "거래 수락" 또는 "거절"
import { getUser, getAccess, httpError } from './_lib.js';
import { decideEntry } from './_entry.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) throw httpError(401, '로그인이 필요합니다');
    const { profile } = await getAccess(user.id);
    if (!profile || profile.banned) throw httpError(403, '이용할 수 없는 계정이에요.');

    const { id, decision } = req.body || {};
    const r = await decideEntry({ entryId: id, decision, actorId: profile.id });
    const sent = await r.notify;
    return res.status(200).json({ ok: true, already: r.already, status: r.decision, dm: { seller: r.already ? null : sent.seller } });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}
