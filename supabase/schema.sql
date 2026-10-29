-- =====================================================================
--  로켓단 마을 사이트 · Supabase 스키마
--  Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run 하세요.
--  여러 번 실행해도 안전하도록 작성되어 있습니다.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 고정 관리자 (마인크래프트 닉네임)
--    ▼ 아래 'YOUR_MC_NAME' 을 본인 자바 닉네임으로 바꾸세요.
-- ---------------------------------------------------------------------
create table if not exists public.fixed_admins (
  mc_name text primary key
);
insert into public.fixed_admins (mc_name) values ('YOUR_MC_NAME')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 1. 회원 프로필 (디스코드 로그인 시 자동 생성)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  discord_id      text,
  discord_name    text,
  discord_avatar  text,
  mc_name         text check (mc_name ~ '^[A-Za-z0-9_]{1,16}$'),
  mc_uuid         text,
  mc_verified     boolean not null default false,
  mc_verified_via text,                       -- 'microsoft' | 'admin'
  role            text not null default 'member'
                  check (role in ('member', 'rocket', 'admin')),
  created_at      timestamptz not null default now()
);
-- 인증된 닉네임은 한 사람만 가질 수 있음
create unique index if not exists profiles_verified_mc_name
  on public.profiles (lower(mc_name)) where mc_verified;

-- ---------------------------------------------------------------------
-- 2. 권한 확인 함수
-- ---------------------------------------------------------------------
create or replace function public.is_fixed_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    join fixed_admins f on lower(f.mc_name) = lower(p.mc_name)
    where p.id = uid and p.mc_verified
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from profiles where id = auth.uid()), false)
      or public.is_fixed_admin(auth.uid());
$$;

create or replace function public.is_rocket()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('rocket', 'admin') from profiles where id = auth.uid()), false)
      or public.is_fixed_admin(auth.uid());
$$;

create or replace function public.is_verified()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select mc_verified from profiles where id = auth.uid()), false);
$$;

create or replace function public.my_access()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'admin',    public.is_admin(),
    'rocket',   public.is_rocket(),
    'fixed',    public.is_fixed_admin(auth.uid()),
    'verified', public.is_verified()
  );
$$;

-- ---------------------------------------------------------------------
-- 3. 가입 시 프로필 생성 트리거
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, discord_id, discord_name, discord_avatar)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
             new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. 프로필 변경 보호 트리거
--    - 일반 회원: 자기 닉네임만 바꿀 수 있고, 바꾸면 인증이 풀림
--    - 관리자: 인증/권한 변경 가능 (관리자 권한 부여·회수는 고정 관리자만)
--    - 고정 관리자의 닉네임·인증은 사이트에서 못 바꿈 (SQL에서만)
-- ---------------------------------------------------------------------
create or replace function public.guard_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 서버 함수(서비스 키)나 SQL Editor 에서의 변경은 그대로 허용
  if auth.uid() is null then
    return new;
  end if;

  new.id := old.id;
  new.discord_id := old.discord_id;
  new.created_at := old.created_at;

  if public.is_fixed_admin(old.id)
     and (new.mc_name is distinct from old.mc_name
          or new.mc_verified is distinct from old.mc_verified) then
    raise exception '고정 관리자의 닉네임과 인증 상태는 사이트에서 바꿀 수 없습니다';
  end if;

  if public.is_admin() then
    if new.role is distinct from old.role
       and (new.role = 'admin' or old.role = 'admin')
       and not public.is_fixed_admin(auth.uid()) then
      raise exception '관리자 권한은 고정 관리자만 주거나 뺄 수 있습니다';
    end if;
    if new.mc_name is distinct from old.mc_name then
      new.mc_uuid := null;
    end if;
    if new.mc_verified and (not old.mc_verified or new.mc_name is distinct from old.mc_name) then
      new.mc_verified_via := 'admin';
    end if;
    if not new.mc_verified then
      new.mc_verified_via := null;
    end if;
    return new;
  end if;

  -- 일반 회원 (RLS 때문에 본인 행만 여기까지 옴)
  new.role := old.role;
  new.mc_verified := old.mc_verified;
  new.mc_verified_via := old.mc_verified_via;
  new.mc_uuid := old.mc_uuid;
  if new.mc_name is distinct from old.mc_name then
    new.mc_verified := false;
    new.mc_verified_via := null;
    new.mc_uuid := null;
  end if;
  return new;
end $$;

drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile
  before update on public.profiles
  for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------
-- 5. 게시판 (공지 / 포켓몬 의뢰 / PVP 대회 / 경매 모집)
-- ---------------------------------------------------------------------
create table if not exists public.posts (
  id          bigint generated always as identity primary key,
  board       text not null check (board in ('notice', 'request', 'pvp', 'auction')),
  title       text not null check (char_length(title) between 1 and 80),
  body        text not null default '' check (char_length(body) <= 2000),
  meta        jsonb not null default '{}'::jsonb,
  status      text not null default 'open' check (status in ('open', 'closed')),
  author_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  notified_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists posts_board_created on public.posts (board, created_at desc);

-- 의뢰 수락 / 대회 참가 / 경매 참여 신청
create table if not exists public.entries (
  id          bigint generated always as identity primary key,
  post_id     bigint not null references public.posts(id) on delete cascade,
  user_id     uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message     text not null default '' check (char_length(message) <= 300),
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (post_id, user_id)
);

-- ---------------------------------------------------------------------
-- 6. 로켓단 전용: 보유 포켓몬 / 구해요 / 거래 예약
-- ---------------------------------------------------------------------
create table if not exists public.rocket_listings (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('have', 'need')),
  pokemon    text not null check (char_length(pokemon) between 1 and 40),
  details    text not null default '' check (char_length(details) <= 500),
  status     text not null default 'open' check (status in ('open', 'done')),
  author_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.rocket_reservations (
  id           bigint generated always as identity primary key,
  listing_id   bigint not null references public.rocket_listings(id) on delete cascade,
  requester_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  message      text not null check (char_length(message) between 1 and 300),
  status       text not null default 'pending' check (status in ('pending', 'done', 'cancelled')),
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 7. 테이블 권한 (컬럼 단위로 필요한 것만 허용)
-- ---------------------------------------------------------------------
revoke all on public.fixed_admins, public.profiles, public.posts, public.entries,
              public.rocket_listings, public.rocket_reservations from anon;
revoke insert, update, delete on public.fixed_admins, public.profiles, public.posts,
              public.entries, public.rocket_listings, public.rocket_reservations from authenticated;

grant select on public.fixed_admins, public.profiles, public.posts, public.entries,
              public.rocket_listings, public.rocket_reservations to authenticated;

grant update (discord_name, discord_avatar, mc_name, mc_verified, role) on public.profiles to authenticated;

grant insert (board, title, body, meta) on public.posts to authenticated;
grant update (title, body, meta, status) on public.posts to authenticated;
grant delete on public.posts to authenticated;

grant insert (post_id, message) on public.entries to authenticated;
grant delete on public.entries to authenticated;

grant insert (kind, pokemon, details) on public.rocket_listings to authenticated;
grant update (pokemon, details, status) on public.rocket_listings to authenticated;
grant delete on public.rocket_listings to authenticated;

grant insert (listing_id, message) on public.rocket_reservations to authenticated;
grant update (status) on public.rocket_reservations to authenticated;

grant usage, select on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------
-- 8. 행 단위 보안 (RLS)
-- ---------------------------------------------------------------------
alter table public.fixed_admins        enable row level security;
alter table public.profiles            enable row level security;
alter table public.posts               enable row level security;
alter table public.entries             enable row level security;
alter table public.rocket_listings     enable row level security;
alter table public.rocket_reservations enable row level security;

-- 고정 관리자 목록: 로그인한 사람은 읽기만
drop policy if exists fixed_admins_read on public.fixed_admins;
create policy fixed_admins_read on public.fixed_admins
  for select to authenticated using (true);

-- 프로필
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- 게시글
drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts
  for select to authenticated using (true);

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check (author_id = auth.uid()
              and public.is_verified()
              and (board <> 'notice' or public.is_admin()));

drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts
  for update to authenticated
  using (author_id = auth.uid() or public.is_admin())
  with check (author_id = auth.uid() or public.is_admin());

drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts
  for delete to authenticated using (public.is_admin());

-- 신청
drop policy if exists entries_read on public.entries;
create policy entries_read on public.entries
  for select to authenticated using (true);

drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert to authenticated
  with check (user_id = auth.uid()
              and public.is_verified()
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'open' and p.board <> 'notice'));

drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- 로켓단 게시글
drop policy if exists rocket_listings_read on public.rocket_listings;
create policy rocket_listings_read on public.rocket_listings
  for select to authenticated using (public.is_rocket());

drop policy if exists rocket_listings_insert on public.rocket_listings;
create policy rocket_listings_insert on public.rocket_listings
  for insert to authenticated
  with check (public.is_rocket() and author_id = auth.uid());

drop policy if exists rocket_listings_update on public.rocket_listings;
create policy rocket_listings_update on public.rocket_listings
  for update to authenticated
  using (public.is_rocket() and (author_id = auth.uid() or public.is_admin()))
  with check (public.is_rocket() and (author_id = auth.uid() or public.is_admin()));

drop policy if exists rocket_listings_delete on public.rocket_listings;
create policy rocket_listings_delete on public.rocket_listings
  for delete to authenticated
  using (public.is_rocket() and (author_id = auth.uid() or public.is_admin()));

-- 로켓단 예약 (당사자와 관리자만 볼 수 있음)
drop policy if exists rocket_reservations_read on public.rocket_reservations;
create policy rocket_reservations_read on public.rocket_reservations
  for select to authenticated
  using (public.is_rocket() and (
           requester_id = auth.uid()
           or public.is_admin()
           or exists (select 1 from public.rocket_listings l
                      where l.id = listing_id and l.author_id = auth.uid())));

drop policy if exists rocket_reservations_insert on public.rocket_reservations;
create policy rocket_reservations_insert on public.rocket_reservations
  for insert to authenticated
  with check (public.is_rocket()
              and requester_id = auth.uid()
              and exists (select 1 from public.rocket_listings l
                          where l.id = listing_id and l.status = 'open'
                            and l.author_id <> auth.uid()));

drop policy if exists rocket_reservations_update on public.rocket_reservations;
create policy rocket_reservations_update on public.rocket_reservations
  for update to authenticated
  using (public.is_rocket() and (
           requester_id = auth.uid()
           or public.is_admin()
           or exists (select 1 from public.rocket_listings l
                      where l.id = listing_id and l.author_id = auth.uid())))
  with check (true);

-- 끝. 이제 사이트에서 디스코드로 로그인한 뒤 SETUP.md 의 "고정 관리자 인증" 단계를 진행하세요.
