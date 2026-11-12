// POST /api/discord-interact
// 디스코드 개발자 포털 → 일반 정보 → "상호작용 엔드포인트 URL"에 이 주소를 넣으면
// 의뢰자가 DM에서 [거래 수락] [거절] 버튼을 눌렀을 때 디스코드가 여기로 알려 줍니다.
// 필요한 환경변수: DISCORD_PUBLIC_KEY (개발자 포털 일반 정보의 "공개 키")
import crypto from 'node:crypto';
import { db } from './_lib.js';
import { decideEntry, decidedContent } from './_entry.js';

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const EPHEMERAL = 64;
const BUDGET_MS = 2400; // 디스코드는 3초 안에 답을 받아야 함

function verify(raw, signature, timestamp, publicKeyHex) {
  try {
    if (!signature || !timestamp || !publicKeyHex) return false;
    const key = crypto.createPublicKey({
      key: Buffer.concat([SPKI_ED25519, Buffer.from(publicKeyHex, 'hex')]),
      format: 'der',
      type: 'spki',
    });
    return crypto.verify(null, Buffer.from(timestamp + raw), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
const privateReply = (content) => json({ type: 4, data: { content, flags: EPHEMERAL } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 응답을 보낸 뒤에도 남은 DM 작업을 마치도록 Vercel 에 부탁 (없으면 무시)
async function keepAlive(promise) {
  try {
    const { waitUntil } = await import('@vercel/functions');
    waitUntil(promise);
  } catch { /* 패키지가 없으면 응답 전에 기다린 만큼만 처리됨 */ }
}

export async function POST(request) {
  const started = Date.now();
  const raw = await request.text();
  const ok = verify(
    raw,
    request.headers.get('x-signature-ed25519'),
    request.headers.get('x-signature-timestamp'),
    process.env.DISCORD_PUBLIC_KEY,
  );
  if (!ok) return new Response('invalid request signature', { status: 401 });

  let i;
  try { i = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }

  if (i.type === 1) return json({ type: 1 }); // PING (엔드포인트 등록 확인)
  if (i.type !== 3) return privateReply('지원하지 않는 동작이에요.');

  const m = /^ent:(accept|decline):(\d+)$/.exec(i.data?.custom_id || '');
  if (!m) return privateReply('알 수 없는 버튼이에요.');
  const decision = m[1] === 'accept' ? 'accepted' : 'declined';
  const discordId = i.user?.id || i.member?.user?.id;

  try {
    const [profile] = await db(`profiles?discord_id=eq.${encodeURIComponent(discordId)}&select=id,banned`);
    if (!profile) return privateReply('사이트에 가입된 디스코드 계정이 아니에요.');
    if (profile.banned) return privateReply('이용할 수 없는 계정이에요.');

    const r = await decideEntry({ entryId: m[2], decision, actorId: profile.id, fromDm: true });

    // DM 보내기를 시간 안에서 최대한 기다리고, 남으면 백그라운드로 마저 처리
    keepAlive(r.notify);
    await Promise.race([r.notify.catch(() => {}), sleep(Math.max(0, BUDGET_MS - (Date.now() - started)))]);

    const content = decidedContent(r.post.title, r.decision, r.entry.user, r.entry.decided_at || new Date());
    const link = i.message?.components?.[0]?.components?.filter((c) => c.style === 5) || [];
    return json({
      type: 7, // 버튼이 달린 그 DM을 결과로 바꿈
      data: { content, components: link.length ? [{ type: 1, components: link }] : [] },
    });
  } catch (e) {
    console.error(e);
    return privateReply(`⚠️ ${e.status ? e.message : '처리 중 오류가 났어요. 사이트에서 다시 시도해 주세요.'}`);
  }
}

export function GET() {
  return new Response('Discord interactions endpoint', { status: 200 });
}
