// POST /api/notify  { type, id }
// 사이트에서 글·신청·예약을 만든 직후 호출 → 디스코드로 알림
import {
  db, getUser, getAccess, claimNotify, sendDM, postChannel,
  who, clip, siteUrl, httpError, RED, GOLD, env,
} from './_lib.js';

const BOARD = {
  notice: '📢 공지',
  request: '🎯 포켓몬 의뢰',
  pvp: '⚔️ PVP 대회',
  auction: '💰 경매 모집',
};
const META_LABEL = {
  pokemon: '필요한 포켓몬', reward: '보상',
  when: '일시', rules: '규칙', capacity: '정원',
  item: '경매 물품', start: '시작가',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) throw httpError(401, '로그인이 필요합니다');
    const { type, id } = req.body || {};
    const nid = Number(id);
    let result;
    switch (type) {
      case 'post': result = await onPost(user, nid); break;
      case 'entry': result = await onEntry(user, nid); break;
      case 'reservation': result = await onReservation(user, nid); break;
      case 'verify-request': result = await onVerifyRequest(user); break;
      case 'bot-test': result = await onBotTest(user); break;
      default: throw httpError(400, '알 수 없는 알림 종류입니다');
    }
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}

// 새 글 → 공지 채널
async function onPost(user, id) {
  const [post] = await db(`posts?id=eq.${id}&select=*,author:profiles(mc_name,discord_name,discord_id)`);
  if (!post) throw httpError(404, '글을 찾을 수 없습니다');
  if (post.author_id !== user.id) throw httpError(403, '본인 글만 알릴 수 있습니다');
  if (!(await claimNotify('posts', id))) return { skipped: true };

  const fields = Object.entries(post.meta || {})
    .filter(([, v]) => v !== '' && v != null)
    .map(([k, v]) => ({ name: META_LABEL[k] || k, value: clip(v, 1000), inline: true }));

  const channel = await postChannel({
    embeds: [{
      title: clip(`${BOARD[post.board] || post.board} · ${post.title}`, 250),
      description: post.body ? clip(post.body, 1500) : undefined,
      url: siteUrl() ? `${siteUrl()}/#${post.board}` : undefined,
      color: RED,
      fields,
      footer: { text: `작성자 ${post.author?.mc_name || post.author?.discord_name || ''}` },
      timestamp: post.created_at,
    }],
  });
  return { channel };
}

// 의뢰 수락 / 대회 참가 / 경매 참여 → 글쓴이에게 DM
async function onEntry(user, id) {
  const [en] = await db(
    `entries?id=eq.${id}&select=*,post:posts(id,board,title,author_id),user:profiles(mc_name,discord_name,discord_id)`,
  );
  if (!en) throw httpError(404, '신청을 찾을 수 없습니다');
  if (en.user_id !== user.id) throw httpError(403, '본인 신청만 알릴 수 있습니다');
  if (!(await claimNotify('entries', id))) return { skipped: true };

  const [author] = await db(`profiles?id=eq.${en.post.author_id}&select=mc_name,discord_name,discord_id`);
  const author_dm = await sendDM(author?.discord_id, {
    content: `📮 **${clip(en.post.title, 80)}** 글에 새 신청이 들어왔어요.`,
    embeds: [{
      title: `${BOARD[en.post.board] || ''} 신청 알림`,
      color: RED,
      url: siteUrl() ? `${siteUrl()}/#${en.post.board}` : undefined,
      fields: [
        { name: '신청자', value: who(en.user), inline: true },
        { name: '전할 말', value: clip(en.message || '(없음)', 1000) },
      ],
      timestamp: en.created_at,
    }],
  });
  return { dm: { author: author_dm } };
}

// 로켓단 거래 예약 → 두 사람 모두에게 DM
async function onReservation(user, id) {
  const [r] = await db(
    `rocket_reservations?id=eq.${id}&select=*,listing:rocket_listings(id,kind,pokemon,details,author_id),requester:profiles(mc_name,discord_name,discord_id)`,
  );
  if (!r) throw httpError(404, '예약을 찾을 수 없습니다');
  if (r.requester_id !== user.id) throw httpError(403, '본인 예약만 알릴 수 있습니다');
  if (!(await claimNotify('rocket_reservations', id))) return { skipped: true };

  const [owner] = await db(`profiles?id=eq.${r.listing.author_id}&select=mc_name,discord_name,discord_id`);
  const ownerGives = r.listing.kind === 'have';
  const giver = ownerGives ? owner : r.requester;
  const receiver = ownerGives ? r.requester : owner;

  const embed = {
    title: `🚀 로켓단 거래 예약 #${r.id}`,
    color: RED,
    url: siteUrl() ? `${siteUrl()}/#rocket` : undefined,
    fields: [
      { name: '포켓몬', value: clip(r.listing.pokemon, 200), inline: true },
      { name: '주는 사람', value: who(giver), inline: true },
      { name: '받는 사람', value: who(receiver), inline: true },
      { name: `${r.requester?.mc_name || '신청자'}님이 전할 말`, value: clip(r.message, 1000) },
      ...(r.listing.details ? [{ name: '포켓몬 정보', value: clip(r.listing.details, 1000) }] : []),
    ],
    footer: { text: '시간이 안 맞으면 디스코드로 직접 조율해 주세요 · 거래가 끝나면 사이트에서 완료를 눌러주세요' },
    timestamp: r.created_at,
  };

  const [toOwner, toRequester] = await Promise.all([
    sendDM(owner?.discord_id, {
      content: `📮 **${r.requester?.mc_name || '로켓단원'}**님이 회원님의 글에 거래 예약을 만들었어요.`,
      embeds: [embed],
    }),
    sendDM(r.requester?.discord_id, {
      content: `✅ **${owner?.mc_name || '로켓단원'}**님과의 거래 예약이 만들어졌어요.`,
      embeds: [embed],
    }),
  ]);
  return { dm: { owner: toOwner, requester: toRequester } };
}

// 닉네임 저장 → 관리자에게 인증 요청 (공지 채널)
async function onVerifyRequest(user) {
  const { profile } = await getAccess(user.id);
  if (!profile?.mc_name || profile.mc_verified) return { skipped: true };
  const channel = await postChannel({
    embeds: [{
      title: '🪪 닉네임 인증 요청',
      color: GOLD,
      description:
        `${profile.discord_id ? `<@${profile.discord_id}>` : profile.discord_name}님이 ` +
        `마인크래프트 닉네임 **${profile.mc_name}** 인증을 요청했어요.\n관리자 탭에서 확인해 주세요.`,
      url: siteUrl() ? `${siteUrl()}/#admin` : undefined,
    }],
  });
  return { channel };
}

// 관리자 전용: 봇 최초 연결 + 테스트 DM
async function onBotTest(user) {
  const acc = await getAccess(user.id);
  if (!acc.admin) throw httpError(403, '관리자만 사용할 수 있습니다');

  let gateway;
  try {
    const bot = await identifyOnce(env('DISCORD_BOT_TOKEN'));
    gateway = `ok (${bot.username})`;
  } catch (e) {
    gateway = `실패: ${e.message}`;
  }
  const dm = await sendDM(acc.profile.discord_id, {
    content: '🚀 로켓단 봇 연결 테스트 성공! 이 메시지가 보이면 거래 예약 알림도 받을 수 있어요.',
  });
  const channel = await postChannel({ content: '🚀 로켓단 알림 채널 연결 테스트입니다.' });
  return { gateway, dm, channel };
}

// 디스코드는 봇이 게이트웨이에 한 번이라도 접속해야 메시지를 보낼 수 있음
function identifyOnce(token) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') return reject(new Error('서버에서 WebSocket을 쓸 수 없습니다 (Node 22 이상 필요)'));
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    const timer = setTimeout(() => { ws.close(); reject(new Error('시간 초과')); }, 8000);
    const done = (fn, v) => { clearTimeout(timer); try { ws.close(); } catch {} fn(v); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.op === 10) {
        ws.send(JSON.stringify({
          op: 2,
          d: { token, intents: 0, properties: { os: 'linux', browser: 'rocket-site', device: 'rocket-site' } },
        }));
      } else if (m.t === 'READY') {
        done(resolve, m.d.user);
      } else if (m.op === 9) {
        done(reject, new Error('봇 토큰이 올바르지 않습니다'));
      }
    };
    ws.onerror = () => done(reject, new Error('게이트웨이 연결 오류'));
  });
}
