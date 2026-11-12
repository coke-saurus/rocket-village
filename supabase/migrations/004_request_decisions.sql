-- =====================================================================
--  업데이트 004 · 포켓몬 의뢰: 의뢰자의 "거래 수락 / 거절"
--  Supabase > SQL Editor 에 전체를 붙여넣고 Run 하세요. 여러 번 실행해도 안전합니다.
--  이미 올라와 있는 글·수락 정보는 그대로 유지됩니다 (기존 수락은 모두 '대기'로 시작).
-- =====================================================================

-- 1) 수락마다 상태 칸: pending(대기) / accepted(거래 수락) / declined(거절됨)
alter table public.entries add column if not exists status        text not null default 'pending';
alter table public.entries add column if not exists decided_at    timestamptz;
alter table public.entries add column if not exists dm_channel_id text;  -- 의뢰자에게 간 DM 위치 (버튼 정리용)
alter table public.entries add column if not exists dm_message_id text;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conname = 'entries_status_check' and conrelid = 'public.entries'::regclass) then
    alter table public.entries add constraint entries_status_check
      check (status in ('pending', 'accepted', 'declined'));
  end if;
end $$;

-- 2) 상태는 서버(거래 수락/거절 처리)만 바꿈. 사이트에서 직접 고칠 수 있는 칸은 없음.
revoke update on public.entries from authenticated;

-- 3) 판매자는 '대기' 중인 수락만 취소할 수 있음 (거절된 뒤 지우고 다시 수락하는 것 방지)
drop policy if exists entries_delete on public.entries;
create policy entries_delete on public.entries
  for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());
