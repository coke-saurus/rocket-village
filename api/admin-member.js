// POST /api/admin-member  (관리자 전용)
//   { action: 'delete', id, ban, reason }  회원 삭제 (+ 선택: 차단)
//   { action: 'unban', discord_id }        차단 해제
// 삭제된 회원의 글·신청·예약은 남고, 작성자는 '탈퇴한 회원'으로 표시됩니다.
import { db, getUser, getAccess, httpError, env, serviceHeaders } from './_lib.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능합니다' });
  try {
    const user = await getUser(req);
    if (!user) throw httpError(401, '로그인이 필요합니다');
    const caller = await getAccess(user.id);
    if (!caller.admin) throw httpError(403, '관리자만 사용할 수 있어요');

    const { action } = req.body || {};
    if (action === 'delete') return res.status(200).json({ ok: true, ...(await deleteMember(user, caller, req.body)) });
    if (action === 'unban') return res.status(200).json({ ok: true, ...(await unban(req.body)) });
    throw httpError(400, '알 수 없는 요청입니다');
  } catch (e) {
    console.error(e);
    return res.status(e.status || 500).json({ ok: false, error: e.message });
  }
}

async function deleteMember(user, caller, { id, ban, reason }) {
  id = String(id || '');
  if (!UUID.test(id)) throw httpError(400, '회원 정보가 올바르지 않아요');
  if (id === user.id) throw httpError(400, '자기 자신은 삭제할 수 없어요');

  const target = await getAccess(id);
  if (!target.profile) throw httpError(404, '이미 삭제된 회원이에요');
  if (target.fixed) throw httpError(403, '고정 관리자는 삭제할 수 없어요');
  if (target.admin && !caller.fixed) throw httpError(403, '관리자는 고정 관리자만 삭제할 수 있어요');
  const p = target.profile;

  // 1) 진행 중이던 글·거래는 정리 (글 자체는 남김)
  const patch = (path, body) => db(path, { method: 'PATCH', body, returnRows: false });
  await patch(`posts?author_id=eq.${id}&status=eq.open`, { status: 'closed' });
  await patch(`rocket_listings?author_id=eq.${id}&status=eq.open`, { status: 'done' });
  await patch(`rocket_reservations?requester_id=eq.${id}&status=eq.pending`, { status: 'cancelled' });
  const mine = await db(`rocket_listings?author_id=eq.${id}&select=id`);
  if (mine.length) await patch(`rocket_reservations?listing_id=in.(${mine.map((l) => l.id).join(',')})&status=eq.pending`, { status: 'cancelled' });

  // 2) 차단 목록에 먼저 등록 (계정 삭제 뒤 바로 다시 가입하는 경우까지 막기 위해)
  let banned = false;
  if (ban) {
    if (!p.discord_id) throw httpError(400, '디스코드 정보가 없어 차단할 수 없어요. 차단 없이 삭제해 주세요.');
    await db('banned_users', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      returnRows: false,
      body: {
        discord_id: p.discord_id,
        name: p.mc_name || p.discord_name || null,
        reason: String(reason || '').trim().slice(0, 200) || null,
        banned_by: user.id,
      },
    });
    banned = true;
  }

  // 3) 계정 삭제 (프로필도 함께 삭제되고, 글의 작성자는 비워짐)
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: serviceHeaders() });
  if (!r.ok && r.status !== 404) {
    if (banned) await db(`banned_users?discord_id=eq.${encodeURIComponent(p.discord_id)}`, { method: 'DELETE', returnRows: false });
    throw httpError(500, `계정 삭제에 실패했어요 (${r.status}): ${await r.text()}`);
  }
  return { deleted: p.mc_name || p.discord_name || id, banned };
}

async function unban({ discord_id }) {
  const did = String(discord_id || '');
  if (!/^\d{1,25}$/.test(did)) throw httpError(400, '디스코드 정보가 올바르지 않아요');
  await db(`banned_users?discord_id=eq.${did}`, { method: 'DELETE', returnRows: false });
  // 차단 중에 다시 가입해 둔 계정이 있으면 바로 풀어 줌
  await db(`profiles?discord_id=eq.${did}`, { method: 'PATCH', body: { banned: false }, returnRows: false });
  return { unbanned: did };
}
