-- 참가자의 일정 입력 완료 상태와 내 일정 일괄 초기화 기능
-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.

begin;

alter table public.participants
  add column if not exists is_complete boolean not null default false,
  add column if not exists completed_at timestamptz;

create or replace function private.reset_schedule_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_code text := coalesce(new.room_code, old.room_code);
  v_user_id uuid := coalesce(new.user_id, old.user_id);
begin
  if v_user_id is not null then
    update public.participants as p
    set is_complete = false,
        completed_at = null,
        last_seen_at = now()
    where p.room_code = v_room_code
      and p.user_id = v_user_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists schedules_reset_completion on public.schedules;
create trigger schedules_reset_completion
after insert or update or delete on public.schedules
for each row execute function private.reset_schedule_completion();

create or replace function public.set_my_schedule_completion(
  p_room_code text,
  p_is_complete boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(p_room_code));
begin
  update public.participants as p
  set is_complete = p_is_complete,
      completed_at = case when p_is_complete then now() else null end,
      last_seen_at = now()
  where p.room_code = v_code
    and p.user_id = auth.uid();

  if not found then
    raise exception '방 참가자만 완료 상태를 변경할 수 있습니다.';
  end if;
end;
$$;

create or replace function public.clear_my_calendar_schedules(
  p_room_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(p_room_code));
begin
  if not private.is_room_member(v_code) then
    raise exception '방 참가자만 자신의 일정을 초기화할 수 있습니다.';
  end if;

  delete from public.schedules as s
  where s.room_code = v_code
    and s.user_id = auth.uid();

  update public.participants as p
  set is_complete = false,
      completed_at = null,
      last_seen_at = now()
  where p.room_code = v_code
    and p.user_id = auth.uid();
end;
$$;

revoke all on function public.set_my_schedule_completion(text, boolean)
  from public, anon, authenticated;
revoke all on function public.clear_my_calendar_schedules(text)
  from public, anon, authenticated;

grant execute on function public.set_my_schedule_completion(text, boolean)
  to authenticated;
grant execute on function public.clear_my_calendar_schedules(text)
  to authenticated;

commit;
