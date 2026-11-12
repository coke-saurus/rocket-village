// 포켓몬 의뢰 수락 → 의뢰자의 거래 수락 / 거절 처리 (밑줄 파일: 주소로 공개되지 않음)
// 사이트(api/entry-decide)와 디스코드 DM 버튼(api/discord-interact)이 같은 규칙을 씁니다.
import { db, discord, sendDM, who, clip, siteUrl, httpError } from './_lib.js';
import { pkFields, rewardText } from './_fmt.js';

const GREEN = 0x3ba55d;
const unix = (d = new Date()) => Math.floor(new Date(d).getTime() / 1000);
const nameOf = (p) => p?.mc_name || p?.discord_name || '탈퇴한 회원';
const requestUrl = () => (siteUrl() ? `${siteUrl()}/#request` : null);

// 버튼은 디스코드 공개 키(DISCORD_PUBLIC_KEY)가 설정돼 있을 때만 붙임.
// 없으면 눌러도 "상호작용 실패"가 뜨므로 사이트 링크만 보냄.
export const buttonsEnabled = () => !!process.env.DISCORD_PUBLIC_KEY;

function linkRow() {
  const url = requestUrl();
  return url ? [{ type: 1, components: [{ type: 2, style: 5, label: '사이트에서 보기', url }] }] : [];
}

export function entryButtons(entryId) {
  const link = linkRow()[0]?.components || [];
  if (!buttonsEnabled()) return link.length ? [{ type: 1, components: link }] : [];
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: '거래 수락', emoji: { name: '✅' }, custom_id: `ent:accept:${entryId}` },
      { type: 2, style: 2, label: '거절', emoji: { name: '❌' }, custom_id: `ent:decline:${entryId}` },
      ...link,
    ],
  }];
}

// 의뢰자에게 보낸 DM 위치를 기록 (나중에 사이트에서 결정하면 DM 버튼도 정리하려고)
export async function saveDmRef(entryId, msg) {
  if (!msg?.id || !msg?.channel_id) return;
  try {
    await db(`entries?id=eq.${Number(entryId)}`, {
      method: 'PATCH', returnRows: false,
      body: { dm_channel_id: msg.channel_id, dm_message_id: msg.id },
    });
  } catch (e) {
    console.error('DM 위치 저장 실패 (004 업데이트 전이면 정상)', e.message);
  }
}

// 의뢰자 DM의 윗줄 (처음 보낼 때와 결정 뒤 모두 사용)
export const requesterHead = (title) => `📮 **${clip(title, 80)}** 의뢰에 수락이 들어왔어요.`;

export function decidedContent(title, decision, seller, at = new Date()) {
  const t = `<t:${unix(at)}:f>`;
  if (decision === 'accepted') return `${requesterHead(title)}\n✅ **${clip(nameOf(seller), 40)}** 님과 거래를 수락했어요. 의뢰는 마감됐어요. · ${t}`;
  if (decision === 'declined') return `${requesterHead(title)}\n❌ **${clip(nameOf(seller), 40)}** 님의 수락을 거절했어요. · ${t}`;
  return `${requesterHead(title)}\n🔒 다른 판매자와 거래를 수락해서 의뢰가 마감됐어요.`;
}

async function editDm(channelId, messageId, content) {
  if (!channelId || !messageId) return false;
  try {
    await discord(`/channels/${channelId}/messages/${messageId}`, 'PATCH', { content, components: linkRow() });
    return true;
  } catch (e) {
    console.error('DM 수정 실패', e.message);
    return false;
  }
}

const isOpen = (post) => post.status === 'open' && (!post.closes_at || new Date(post.closes_at) > new Date());

/**
 * 거래 수락(accepted) 또는 거절(declined)
 * actorId: 결정하는 사람의 profiles.id (의뢰를 올린 본인이어야 함)
 * fromDm: 디스코드 버튼으로 누른 경우 true (그 DM은 상호작용 응답으로 바로 고침)
 * 반환: { already, entry, post, decision, notify: Promise }
 */
export async function decideEntry({ entryId, decision, actorId, fromDm = false }) {
  if (!['accepted', 'declined'].includes(decision)) throw httpError(400, '알 수 없는 결정이에요.');
  const id = Number(entryId);
  if (!Number.isInteger(id) || id <= 0) throw httpError(400, '잘못된 요청이에요.');

  const [entry] = await db(
    `entries?id=eq.${id}&select=*,post:posts(id,board,title,status,closes_at,author_id,meta,author:profiles(mc_name,discord_name,discord_id)),user:profiles(mc_name,discord_name,discord_id)`,
  );
  if (!entry || !entry.post) throw httpError(404, '이 수락을 찾을 수 없어요. 판매자가 취소했거나 의뢰가 삭제됐어요.');
  const post = entry.post;
  if (post.board !== 'request') throw httpError(400, '포켓몬 의뢰에서만 쓸 수 있어요.');
  if (!actorId || post.author_id !== actorId) throw httpError(403, '의뢰를 올린 사람만 수락하거나 거절할 수 있어요.');
  if (!entry.status) throw httpError(503, '사이트 DB 업데이트(004)가 아직 적용되지 않았어요. 관리자에게 알려 주세요.');

  if (entry.status !== 'pending') return { already: true, entry, post, decision: entry.status, notify: Promise.resolve({}) };
  if (decision === 'accepted' && !isOpen(post)) throw httpError(409, '이미 마감된 의뢰예요. 거래 수락은 모집 중일 때만 할 수 있어요.');

  const now = new Date().toISOString();
  const rows = await db(`entries?id=eq.${id}&status=eq.pending`, {
    method: 'PATCH',
    body: { status: decision, decided_at: now },
  });
  if (!rows?.length) {
    const [cur] = await db(`entries?id=eq.${id}&select=status`);
    return { already: true, entry, post, decision: cur?.status || entry.status, notify: Promise.resolve({}) };
  }

  let others = [];
  if (decision === 'accepted') {
    await db(`posts?id=eq.${post.id}`, { method: 'PATCH', returnRows: false, body: { status: 'closed' } });
    others = await db(
      `entries?post_id=eq.${post.id}&status=eq.pending&id=neq.${id}&select=id,dm_channel_id,dm_message_id,user:profiles(mc_name,discord_name,discord_id)`,
    );
  }

  const notify = notifyDecision({ entry, post, decision, others, fromDm, at: now });
  return { already: false, entry: { ...entry, status: decision, decided_at: now }, post, decision, notify };
}

async function notifyDecision({ entry, post, decision, others, fromDm, at }) {
  const pk = post.meta?.pk;
  const reward = post.meta?.reward;
  const jobs = [];

  // 1) 판매자에게 결과 DM
  if (decision === 'accepted') {
    jobs.push(sendDM(entry.user?.discord_id, {
      content: `✅ **${clip(post.title, 80)}** 의뢰자가 거래를 수락했어요! 게임에서 만나 거래해 주세요.`,
      embeds: [{
        title: '🎯 포켓몬 의뢰 · 거래 수락',
        color: GREEN,
        url: requestUrl() || undefined,
        thumbnail: pk?.icon ? { url: pk.icon } : undefined,
        fields: [
          { name: '의뢰자', value: who(post.author), inline: true },
          ...pkFields(pk),
          ...(reward ? [{ name: '보수', value: clip(rewardText(reward, pk), 1000) }] : []),
          { name: '내가 보낸 말', value: clip(entry.message || '(없음)', 1000) },
        ],
        timestamp: at,
      }],
      components: linkRow(),
    }));
  } else {
    jobs.push(sendDM(entry.user?.discord_id, {
      content: `❌ **${clip(post.title, 80)}** 의뢰자가 이번 수락을 거절했어요. 다른 의뢰도 둘러봐 주세요!`,
      components: linkRow(),
    }));
  }

  // 2) 사이트에서 결정했다면, 의뢰자에게 갔던 DM의 버튼을 정리
  if (!fromDm) jobs.push(editDm(entry.dm_channel_id, entry.dm_message_id, decidedContent(post.title, decision, entry.user, at)));

  // 3) 거래 수락으로 마감되면, 기다리던 다른 판매자에게 알리고 의뢰자 DM 버튼도 정리
  for (const o of others || []) {
    jobs.push(sendDM(o.user?.discord_id, {
      content: `🔒 **${clip(post.title, 80)}** 의뢰는 다른 판매자와 거래가 진행돼 마감됐어요. 수락해 주셔서 고마워요!`,
      components: linkRow(),
    }));
    jobs.push(editDm(o.dm_channel_id, o.dm_message_id, decidedContent(post.title, 'closed')));
  }

  const results = await Promise.allSettled(jobs);
  return { seller: results[0]?.status === 'fulfilled' ? results[0].value : false };
}
