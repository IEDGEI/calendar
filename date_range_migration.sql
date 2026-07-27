-- 조율 날짜 범위 설정
-- Supabase Dashboard > SQL Editor에서 한 번만 실행하세요.

begin;

alter table public.rooms
  add column if not exists schedule_start_date date,
  add column if not exists schedule_end_date date;

create or replace function public.set_calendar_settings(
  p_room_code text,
  p_finalized_date date,
  p_schedule_start_date date,
  p_schedule_end_date date
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
    raise exception '방 참가자만 일정 설정을 변경할 수 있습니다.';
  end if;

  if (p_schedule_start_date is null) <> (p_schedule_end_date is null) then
    raise exception '조율 시작일과 종료일을 모두 입력해 주세요.';
  end if;

  if p_schedule_start_date is not null
     and p_schedule_start_date > p_schedule_end_date then
    raise exception '종료일은 시작일보다 빠를 수 없습니다.';
  end if;

  if p_schedule_start_date is not null
     and p_schedule_end_date - p_schedule_start_date > 366 then
    raise exception '조율 범위는 최대 1년까지 설정할 수 있습니다.';
  end if;

  if p_finalized_date is not null
     and p_schedule_start_date is not null
     and (
       p_finalized_date < p_schedule_start_date
       or p_finalized_date > p_schedule_end_date
     ) then
    raise exception '최종 약속일은 조율 범위 안에 있어야 합니다.';
  end if;

  update public.rooms as r
  set finalized_date = p_finalized_date,
      schedule_start_date = p_schedule_start_date,
      schedule_end_date = p_schedule_end_date,
      last_activity_at = now()
  where r.room_code = v_code;
end;
$$;

revoke all on function public.set_calendar_settings(text, date, date, date)
  from public, anon, authenticated;
grant execute on function public.set_calendar_settings(text, date, date, date)
  to authenticated;

commit;
