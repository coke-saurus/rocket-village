// 매일 한 번 Vercel 크론이 호출 → Supabase 무료 프로젝트가 잠기지 않도록 DB를 가볍게 조회
import { db } from './_lib.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    await db('profiles?select=id&limit=1');
    return res.status(200).json({ ok: true, at: new Date().toISOString() });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}
