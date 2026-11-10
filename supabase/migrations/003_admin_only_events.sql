-- =====================================================================
--  업데이트 003 · PVP 대회 · 경매 글은 관리자만 작성
--  Supabase > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--  이미 올라와 있는 글과 참가 신청은 그대로 유지됩니다.
-- =====================================================================

drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts
  for insert to authenticated
  with check (author_id = auth.uid()
              and public.is_verified()
              and (board not in ('notice', 'pvp', 'auction') or public.is_admin()));
