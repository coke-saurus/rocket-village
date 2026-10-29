// 서버 함수 공용 도구 (밑줄로 시작하는 파일은 Vercel이 주소로 공개하지 않습니다)
import crypto from 'node:crypto';

export function env(name) {
  const v = process.env[name];
  if (!v) throw httpError(500, `환경변수 ${name} 가 설정되지 않았습니다`);
  return v;
}

export function httpError(status, message, code) {
  return Object.assign(new Error(message), { status, code });
}

export const RED = 0xe0282f;
export const GOLD = 0xf2c14e;
export const siteUrl = () => (process.env.SITE_URL || '').replace(/\/$/, '');

// ---------- Supabase (서비스 키로 접근, RLS 우회) ----------
function serviceHeaders(extra = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const h = { apikey: key, 'Content-Type': 'application/json', ...extra };
  // 예전 형식(JWT) 키는 Authorization 헤더도 필요, 새 형식(sb_secret_...)은 apikey 만
  if (!key.startsWith('sb_')) h.Authorization = `Bearer ${key}`;
  return h;
}

export async function db(path, { method = 'GET', body, returnRows = true } = {}) {
  const prefer = method !== 'GET' && returnRows ? { Prefer: 'return=representation' } : {};
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    method,
    headers: serviceHeaders(prefer),
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw httpError(500, `DB 오류 ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// 요청한 사람의 로그인 토큰을 확인
export async function getUser(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_SERVICE_ROLE_KEY'), Authorization: `Bearer ${token}` },
  });
  return r.ok ? r.json() : null;
}

export async function getAccess(uid) {
  const [profile] = await db(`profiles?id=eq.${encodeURIComponent(uid)}&select=*`);
  if (!profile) return { profile: null, fixed: false, admin: false, rocket: false };
  const fixedList = await db('fixed_admins?select=mc_name');
  const name = String(profile.mc_name || '').toLowerCase();
  const fixed = profile.mc_verified && fixedList.some((f) => f.mc_name.toLowerCase() === name);
  const admin = fixed || profile.role === 'admin';
  return { profile, fixed, admin, rocket: admin || profile.role === 'rocket' };
}

// 알림을 한 번만 보내도록 notified_at 을 원자적으로 기록
export async function claimNotify(table, id) {
  const rows = await db(`${table}?id=eq.${Number(id)}&notified_at=is.null`, {
    method: 'PATCH',
    body: { notified_at: new Date().toISOString() },
  });
  return Array.isArray(rows) && rows.length > 0;
}

// ---------- Discord ----------
export async function discord(path, method = 'GET', body) {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${env('DISCORD_BOT_TOKEN')}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw httpError(502, `Discord ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

// DM 보내기. 실패해도 예외 대신 false (서버 미가입, DM 차단 등)
export async function sendDM(discordId, payload) {
  if (!discordId) return false;
  try {
    const ch = await discord('/users/@me/channels', 'POST', { recipient_id: String(discordId) });
    await discord(`/channels/${ch.id}/messages`, 'POST', payload);
    return true;
  } catch (e) {
    console.error('DM 실패', discordId, e.message);
    return false;
  }
}

// 공지 채널(웹후크)로 보내기
export async function postChannel(payload) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return false;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '로켓단 알림', ...payload }),
  });
  if (!r.ok) console.error('웹후크 실패', r.status, await r.text());
  return r.ok;
}

// 디스코드 메시지용 이름 표기: 닉네임 (@멘션)
export function who(p) {
  if (!p) return '알 수 없음';
  const name = p.mc_name || p.discord_name || '이름 없음';
  return p.discord_id ? `${name} (<@${p.discord_id}>)` : name;
}

export const clip = (s, n) => {
  const t = String(s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t || '-';
};

// ---------- Microsoft 로그인 state 서명 ----------
export function sign(obj) {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const mac = crypto.createHmac('sha256', env('AUTH_STATE_SECRET')).update(data).digest('base64url');
  return `${data}.${mac}`;
}

export function unsign(token) {
  const [data, mac] = String(token || '').split('.');
  if (!data || !mac) return null;
  const expected = crypto.createHmac('sha256', env('AUTH_STATE_SECRET')).update(data).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(mac);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const obj = JSON.parse(Buffer.from(data, 'base64url').toString());
  return obj.exp > Date.now() ? obj : null;
}
