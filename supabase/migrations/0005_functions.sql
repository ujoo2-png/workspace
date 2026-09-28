-- updated_at 자동 갱신
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();
create trigger trg_schedules_updated_at before update on schedules
  for each row execute function set_updated_at();
create trigger trg_programs_updated_at before update on programs
  for each row execute function set_updated_at();

-- 프로젝트 완료 예측: "진행률 증분 ÷ 기록 간 경과일" 평균 (js/predict.js와 동일한 로직).
-- 기록 2건 미만·속도 0 이하·완료 프로젝트는 NULL 처리하고 신뢰도를 함께 저장한다.
create or replace function calc_predicted_completion()
returns trigger as $$
declare
  rec record;
  prev_progress numeric;
  prev_at timestamptz;
  rate numeric;
  rates numeric[] := '{}';
  record_count int := 0;
  avg_rate numeric;
  stddev_rate numeric;
  cv numeric;
  latest_progress numeric;
  confidence text := 'low';
begin
  for rec in
    select progress, recorded_at from project_progress
    where project_id = new.project_id
    order by recorded_at asc
  loop
    record_count := record_count + 1;
    latest_progress := rec.progress;
    if prev_at is not null then
      declare
        -- 날짜(day) 단위로만 비교한다. js/predict.js의 diffDays()와 동일한 정수 일수 기준으로 맞춰,
        -- 같은 날 기록된 시각 차이(sub-day drift)로 예측일이 흔들리지 않게 한다.
        days int := (rec.recorded_at::date - prev_at::date);
      begin
        if days > 0 then
          rate := (rec.progress - prev_progress) / days::numeric;
          rates := array_append(rates, rate);
        end if;
      end;
    end if;
    prev_progress := rec.progress;
    prev_at := rec.recorded_at;
  end loop;

  if record_count < 2 or latest_progress >= 100 or array_length(rates, 1) is null then
    update projects set predicted_completion_date = null, predicted_confidence = 'none' where id = new.project_id;
    return new;
  end if;

  select avg(r), stddev_pop(r) into avg_rate, stddev_rate from unnest(rates) as r;

  if avg_rate is null or avg_rate <= 0 then
    update projects set predicted_completion_date = null, predicted_confidence = 'none' where id = new.project_id;
    return new;
  end if;

  cv := case when avg_rate <> 0 then stddev_rate / abs(avg_rate) else null end;
  if record_count >= 6 and cv is not null and cv < 0.6 then
    confidence := 'high';
  elsif record_count >= 3 and cv is not null and cv < 1.2 then
    confidence := 'medium';
  end if;

  update projects
    set predicted_completion_date = current_date + ceil((100 - latest_progress) / avg_rate)::int,
        predicted_confidence = confidence
    where id = new.project_id;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_predict_completion
  after insert on project_progress
  for each row execute function calc_predicted_completion();

-- ---------------------------------------------------------------
-- 자동 워크플로우: DB 내부에서 판정 가능한 규칙(마감 D-n, 지난 미완료 일정)은
-- Edge Function 없이 순수 SQL 함수 + pg_cron으로 처리한다(0006_cron.sql에서 스케줄).
-- unique(user_id, dedupe_key) 제약 덕분에 on conflict do nothing만으로
-- "재실행해도 중복 생성 금지" 원칙이 DB 레벨에서도 보장된다.
-- ---------------------------------------------------------------
create or replace function run_daily_automation(p_deadline_days int default 7)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count int := 0;
begin
  -- 1) 마감 D-n 이내(진행 중 프로젝트)
  insert into notifications (user_id, type, severity, title, message, related_table, related_id, dedupe_key)
  select
    p.user_id,
    'deadline',
    case when (p.deadline - current_date) <= 2 then 'critical' else 'warning' end,
    '마감 D-' || (p.deadline - current_date) || ': ' || p.name,
    '프로젝트 "' || p.name || '"의 마감일이 ' || (p.deadline - current_date) || '일 남았습니다.',
    'projects', p.id::text,
    'deadline:' || p.id::text || ':' || p.deadline::text
  from projects p
  where p.status = 'in_progress'
    and p.deleted_at is null
    and p.deadline is not null
    and p.deadline >= current_date
    and (p.deadline - current_date) <= p_deadline_days
  on conflict (user_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;

  -- 2) 마감 초과(진행 중 프로젝트)
  insert into notifications (user_id, type, severity, title, message, related_table, related_id, dedupe_key)
  select
    p.user_id, 'overdue_project', 'critical',
    '마감 초과: ' || p.name,
    '프로젝트 "' || p.name || '"의 마감일이 ' || (current_date - p.deadline) || '일 지났습니다.',
    'projects', p.id::text,
    'overdue_project:' || p.id::text || ':' || p.deadline::text
  from projects p
  where p.status = 'in_progress' and p.deleted_at is null
    and p.deadline is not null and p.deadline < current_date
  on conflict (user_id, dedupe_key) do nothing;

  -- 3) 완료되지 않은 지난 일정 (하루 1회만 생성되도록 dedupe_key에 오늘 날짜 포함)
  insert into notifications (user_id, type, severity, title, message, related_table, related_id, dedupe_key)
  select
    s.user_id, 'overdue_schedule', 'warning',
    '지난 일정 미완료: ' || s.title,
    '"' || s.title || '" 일정(' || s.date::text || ')이 완료 처리되지 않았습니다.',
    'schedules', s.id::text,
    'overdue_schedule:' || s.id::text || ':' || current_date::text
  from schedules s
  where s.done = false and s.deleted_at is null and s.date < current_date
  on conflict (user_id, dedupe_key) do nothing;

  return inserted_count;
end;
$$;
