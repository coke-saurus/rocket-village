-- =====================================================================
--  업데이트 002 · 포켓몬 상세 정보, 자동 마감 시각(PVP·경매 기본 7일), 의뢰 제한
--  Supabase > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--  기존 글과 회원 정보는 그대로 유지되며, 여러 번 실행해도 안전합니다.
-- =====================================================================

-- 1) 새 칸
alter table public.posts           add column if not exists closes_at timestamptz;
alter table public.rocket_listings add column if not exists meta jsonb not null default '{}'::jsonb;

-- 2) 사이트에서 쓸 수 있는 칸 권한
grant insert (board, title, body, meta, closes_at) on public.posts to authenticated;
grant update (title, body, meta, status, closes_at) on public.posts to authenticated;
grant insert (kind, pokemon, details, meta) on public.rocket_listings to authenticated;
grant update (pokemon, details, status, meta) on public.rocket_listings to authenticated;

-- 3) 글 규칙
--    - 포켓몬 의뢰(관리자 제외): 7일 뒤 자동 마감, 모집 중인 의뢰는 1인 1개, 마감 후 다시 열기 불가
--    - PVP 대회 · 경매: 마감 시각을 비워 두면 7일 뒤 자동 마감
--    - 마감 시각은 지금보다 뒤여야 함
create or replace function public.guard_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 서버 함수(서비스 키)나 SQL Editor 에서의 변경은 그대로 허용
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.board = 'request' and not public.is_admin() then
      perform pg_advisory_xact_lock(hashtext('request:' || new.author_id::text));
      if exists (select 1 from posts
                 where author_id = new.author_id and board = 'request' and status = 'open'
                   and (closes_at is null or closes_at > now())) then
        raise exception '이미 모집 중인 포켓몬 의뢰가 있어요. 기존 의뢰가 마감된 뒤에 올릴 수 있어요.';
      end if;
      new.closes_at := now() + interval '7 days';
    end if;
    -- PVP 대회 · 경매: 마감 시각을 비워 두면 7일 뒤 자동 마감 (관리자 포함)
    if new.board in ('pvp', 'auction') and new.closes_at is null then
      new.closes_at := now() + interval '7 days';
    end if;
    if new.closes_at is not null and new.closes_at <= now() then
      raise exception '마감 시각은 지금보다 뒤여야 해요.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.board = 'request' and not public.is_admin() then
    new.closes_at := old.closes_at;
    if new.status = 'open' and old.status <> 'open' then
      raise exception '마감된 의뢰는 다시 열 수 없어요. 새 의뢰를 올려 주세요.';
    end if;
  end if;
  if old.board in ('pvp', 'auction') and new.closes_at is distinct from old.closes_at then
    if new.closes_at is null then
      new.closes_at := now() + interval '7 days';
    elsif new.closes_at <= now() then
      raise exception '마감 시각은 지금보다 뒤여야 해요.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_post on public.posts;
create trigger guard_post
  before insert or update on public.posts
  for each row execute function public.guard_post();

-- 4) 마감 시각이 지난 글에는 신청 불가
drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert to authenticated
  with check (user_id = auth.uid()
              and public.is_verified()
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'open' and p.board <> 'notice'
                            and (p.closes_at is null or p.closes_at > now())));

-- 5) 이미 올라와 있는 PVP 대회 · 경매 글 중 마감 시각이 없는 글은 지금부터 7일 뒤로 맞춤
update public.posts
   set closes_at = now() + interval '7 days'
 where board in ('pvp', 'auction') and status = 'open' and closes_at is null;
