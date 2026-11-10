-- =====================================================================
--  업데이트 003 · PVP 대회·경매 관리자 전용, 회원 삭제·차단
--  Supabase > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--  이미 올라와 있는 글·신청·회원 정보는 그대로 유지됩니다.
-- =====================================================================

-- 1) 공지 · PVP 대회 · 경매 글은 관리자만 작성
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check (author_id = auth.uid()
              and public.is_verified()
              and (board not in ('notice', 'pvp', 'auction') or public.is_admin()));

-- 2) 차단: 차단된 회원은 같은 디스코드 계정으로 다시 가입해도 아무것도 할 수 없음
alter table public.profiles add column if not exists banned boolean not null default false;

create table if not exists public.banned_users (
  discord_id  text primary key,
  name        text,                 -- 차단할 때의 닉네임 (기록용)
  reason      text,
  banned_by   uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.banned_users enable row level security;
revoke all on public.banned_users from anon, authenticated;
grant select on public.banned_users to authenticated;
drop policy if exists banned_read on public.banned_users;
create policy banned_read on public.banned_users
  for select to authenticated using (public.is_admin());

create or replace function public.is_fixed_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
    join fixed_admins f on lower(f.mc_name) = lower(p.mc_name)
    where p.id = uid and p.mc_verified and not p.banned
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' and not banned from profiles where id = auth.uid()), false)
      or public.is_fixed_admin(auth.uid());
$$;

create or replace function public.is_rocket()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('rocket', 'admin') and not banned from profiles where id = auth.uid()), false)
      or public.is_fixed_admin(auth.uid());
$$;

create or replace function public.is_verified()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select mc_verified and not banned from profiles where id = auth.uid()), false);
$$;

create or replace function public.my_access()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'admin',    public.is_admin(),
    'rocket',   public.is_rocket(),
    'fixed',    public.is_fixed_admin(auth.uid()),
    'verified', public.is_verified(),
    'banned',   coalesce((select banned from profiles where id = auth.uid()), false)
  );
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, discord_id, discord_name, discord_avatar, banned)
  values (
    new.id,
    new.raw_user_meta_data ->> 'provider_id',
    coalesce(new.raw_user_meta_data -> 'custom_claims' ->> 'global_name',
             new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url',
    exists (select 1 from public.banned_users b where b.discord_id = new.raw_user_meta_data ->> 'provider_id')
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 3) 회원이 삭제돼도 글·신청·예약은 남기고 작성자만 비움 ('탈퇴한 회원'으로 표시)
do $$
declare r record;
begin
  for r in
    select con.conname, rel.relname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname = 'public' and con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and rel.relname in ('posts', 'entries', 'rocket_listings', 'rocket_reservations')
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;
alter table public.posts               alter column author_id    drop not null;
alter table public.entries             alter column user_id      drop not null;
alter table public.rocket_listings     alter column author_id    drop not null;
alter table public.rocket_reservations alter column requester_id drop not null;
alter table public.posts               add constraint posts_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.entries             add constraint entries_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;
alter table public.rocket_listings     add constraint rocket_listings_author_id_fkey
  foreign key (author_id) references public.profiles(id) on delete set null;
alter table public.rocket_reservations add constraint rocket_reservations_requester_id_fkey
  foreign key (requester_id) references public.profiles(id) on delete set null;

-- 4) 탈퇴한 회원의 글에는 신청 불가
drop policy if exists entries_insert on public.entries;
create policy entries_insert on public.entries
  for insert to authenticated
  with check (user_id = auth.uid()
              and public.is_verified()
              and exists (select 1 from public.posts p
                          where p.id = post_id and p.status = 'open' and p.board <> 'notice'
                            and p.author_id is not null
                            and (p.closes_at is null or p.closes_at > now())));
