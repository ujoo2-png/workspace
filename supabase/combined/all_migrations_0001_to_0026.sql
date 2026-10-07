-- ===== supabase/migrations/0001_extensions.sql =====
-- 확장 기능. pgcrypto는 gen_random_uuid()를 위해 필요하다(Supabase는 기본 활성화되어 있는 경우가 많음).
create extension if not exists pgcrypto;


-- ===== supabase/migrations/0002_schema.sql =====
-- MVP 범위 스키마: 인증(Auth는 Supabase 제공), 일정, 프로젝트, 프로그램, 알림, 자동화 로그.
-- 전체 확장 스키마(PlayList, Briefing, 차량, Health 등)는 개발계획서 문서의 "DB 스키마 및 상세 설계" 탭 참고.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  default_city text default '서울',
  theme text default 'auto' check (theme in ('auto', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'done', 'on_hold')),
  deadline date,
  memo text,
  predicted_completion_date date,
  predicted_confidence text check (predicted_confidence in ('none', 'low', 'medium', 'high')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists project_progress (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  progress int not null check (progress between 0 and 100),
  recorded_at timestamptz not null default now()
);

create table if not exists schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  date date not null,
  time time,
  memo text,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  url text not null check (url ~* '^https?://'),
  icon text,
  description text,
  run_count int not null default 0,
  last_run timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  type text not null,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title text not null,
  message text,
  related_table text,
  related_id text,
  dedupe_key text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

create table if not exists automation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  rule_type text not null,
  dedupe_key text,
  result text not null check (result in ('created', 'skipped_duplicate', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);


-- ===== supabase/migrations/0003_indexes.sql =====
create index if not exists idx_schedules_user_date on schedules (user_id, date) where deleted_at is null;
create index if not exists idx_schedules_project on schedules (project_id) where project_id is not null;
create index if not exists idx_projects_user_deadline on projects (user_id, deadline) where deleted_at is null and status = 'in_progress';
create index if not exists idx_project_progress_project on project_progress (project_id, recorded_at desc);
create index if not exists idx_programs_user_runcount on programs (user_id, run_count desc) where deleted_at is null;
create index if not exists idx_notifications_user_unread on notifications (user_id, is_read, created_at desc);
create index if not exists idx_automation_logs_user on automation_logs (user_id, created_at desc);


-- ===== supabase/migrations/0004_rls.sql =====
-- 모든 테이블에 RLS를 켜고, user_id가 직접 있는 테이블은 단순 정책,
-- 없는 테이블(project_progress)은 부모(projects) 소유권을 EXISTS로 검증한다.

alter table profiles enable row level security;
drop policy if exists profiles_own_rows on profiles;
create policy profiles_own_rows on profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table projects enable row level security;
drop policy if exists projects_own_rows on projects;
create policy projects_own_rows on projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table schedules enable row level security;
drop policy if exists schedules_own_rows on schedules;
create policy schedules_own_rows on schedules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table programs enable row level security;
drop policy if exists programs_own_rows on programs;
create policy programs_own_rows on programs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table notifications enable row level security;
drop policy if exists notifications_own_rows on notifications;
create policy notifications_own_rows on notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table automation_logs enable row level security;
drop policy if exists automation_logs_own_rows on automation_logs;
create policy automation_logs_own_rows on automation_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- project_progress: 직접 user_id가 없으므로 부모 프로젝트 소유권을 확인한다.
alter table project_progress enable row level security;
drop policy if exists project_progress_own_rows on project_progress;
create policy project_progress_own_rows on project_progress for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())));


-- ===== supabase/migrations/0005_functions.sql =====
-- updated_at 자동 갱신
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();
drop trigger if exists trg_schedules_updated_at on schedules;
create trigger trg_schedules_updated_at before update on schedules
  for each row execute function set_updated_at();
drop trigger if exists trg_programs_updated_at on programs;
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

drop trigger if exists trg_predict_completion on project_progress;
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


-- ===== supabase/migrations/0006_cron.sql =====
-- pg_cron 스케줄링. Supabase 대시보드 Database > Extensions에서 pg_cron을 먼저 켠 뒤 실행하세요.
-- (일반 마이그레이션 권한으로는 확장 설치가 막혀 있을 수 있습니다.)
create extension if not exists pg_cron;

-- 매일 한국시간 08:00 = UTC 23:00 실행. run_daily_automation()은 0005_functions.sql 참고.
select cron.schedule(
  'daily-automation',
  '0 23 * * *',
  $$select run_daily_automation(7)$$
);

-- 스케줄 확인: select * from cron.job;
-- 스케줄 제거: select cron.unschedule('daily-automation');

-- 참고: 날씨 동기화, 메일/RSS 수집처럼 외부 네트워크 호출이 필요한 자동화는
-- 이 순수 SQL 방식이 아니라 Edge Function + pg_net으로 별도 구현한다(개발계획서 4.5장).


-- ===== supabase/migrations/0007_challenges_vehicle_health_playlist.sql =====
-- 챌린저 / 차량관리 / Health / 문화생활(PlayList)
-- 개발계획서 DB 스키마 탭의 설계를 기반으로 하되, 이 앱에는 파일 업로드(Storage)와
-- content_types lookup 테이블을 아직 쓰지 않으므로 그 부분만 단순화했다(문서상
-- content_type_id uuid FK 대신 content_type text로 저장 — js 코드가 실제로 이렇게 호출한다).

-- ---------------------------------------------------------------
-- 챌린저
-- ---------------------------------------------------------------
create table if not exists challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null,
  category text,
  target_value numeric not null default 1,
  unit text default '회',
  start_date date,
  end_date date,
  status text not null default 'active' check (status in ('active', 'completed', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists challenge_checkins (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references challenges(id) on delete cascade not null,
  checkin_date date not null,
  value numeric not null default 1,
  memo text,
  created_at timestamptz not null default now(),
  unique (challenge_id, checkin_date)
);

create index if not exists idx_challenges_user on challenges(user_id, status);
create index if not exists idx_challenge_checkins_challenge on challenge_checkins(challenge_id, checkin_date desc);

alter table challenges enable row level security;
drop policy if exists challenges_own_rows on challenges;
create policy challenges_own_rows on challenges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table challenge_checkins enable row level security;
drop policy if exists challenge_checkins_own_rows on challenge_checkins;
create policy challenge_checkins_own_rows on challenge_checkins for all to authenticated
  using (exists (select 1 from challenges c where c.id = challenge_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));

-- ---------------------------------------------------------------
-- 차량관리
-- ---------------------------------------------------------------
create table if not exists vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  plate_number text,
  model text,
  year int,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists vehicle_maintenance (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  item text not null,
  service_date date not null,
  odometer int,
  cost numeric,
  next_due_date date,
  next_due_odometer int,
  memo text,
  created_at timestamptz not null default now()
);

create table if not exists vehicle_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  logged_at date not null,
  odometer int,
  amount numeric,
  cost numeric,
  created_at timestamptz not null default now()
);

create index if not exists idx_vehicles_user on vehicles(user_id) where deleted_at is null;
create index if not exists idx_vehicle_maintenance_vehicle on vehicle_maintenance(vehicle_id, service_date desc);
create index if not exists idx_vehicle_maintenance_due on vehicle_maintenance(next_due_date) where next_due_date is not null;
create index if not exists idx_vehicle_fuel_vehicle on vehicle_fuel_logs(vehicle_id, logged_at desc);

alter table vehicles enable row level security;
drop policy if exists vehicles_own_rows on vehicles;
create policy vehicles_own_rows on vehicles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table vehicle_maintenance enable row level security;
drop policy if exists vehicle_maintenance_own_rows on vehicle_maintenance;
create policy vehicle_maintenance_own_rows on vehicle_maintenance for all to authenticated
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())));

alter table vehicle_fuel_logs enable row level security;
drop policy if exists vehicle_fuel_logs_own_rows on vehicle_fuel_logs;
create policy vehicle_fuel_logs_own_rows on vehicle_fuel_logs for all to authenticated
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())));

-- ---------------------------------------------------------------
-- Health (일반 웰니스 지표만 — 진단명·복약 등 민감 의료정보는 다루지 않는다)
-- ---------------------------------------------------------------
create table if not exists health_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  metric_type text not null check (metric_type in ('weight', 'exercise', 'sleep', 'steps', 'condition')),
  value numeric not null,
  unit text,
  note text,
  recorded_at timestamptz not null default now()
);

create table if not exists health_appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null,
  appointment_date date not null,
  appointment_time time,
  location text,
  memo text,
  schedule_id uuid references schedules(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_health_metrics_user_type on health_metrics(user_id, metric_type, recorded_at desc);
create index if not exists idx_health_appointments_user on health_appointments(user_id, appointment_date);

alter table health_metrics enable row level security;
drop policy if exists health_metrics_own_rows on health_metrics;
create policy health_metrics_own_rows on health_metrics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table health_appointments enable row level security;
drop policy if exists health_appointments_own_rows on health_appointments;
create policy health_appointments_own_rows on health_appointments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- 문화생활(PlayList) — 영화/음악/연극/음악회 등
-- ---------------------------------------------------------------
create table if not exists playlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  content_type text not null check (content_type in ('movie','music','theater','concert','musical','exhibition','book','etc')),
  title text not null,
  creator text,
  status text not null default 'to_watch' check (status in ('to_watch','watched','in_progress','abandoned')),
  event_date date,
  event_time time,
  venue_name text,
  rating numeric check (rating between 1 and 5),
  review text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_playlist_user_status on playlist_items(user_id, status) where deleted_at is null;
create index if not exists idx_playlist_event_date on playlist_items(event_date) where event_date is not null;

alter table playlist_items enable row level security;
drop policy if exists playlist_own_rows on playlist_items;
create policy playlist_own_rows on playlist_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 참고: 포스터·티켓 등 파일 첨부(playlist_attachments, Storage 버킷)는 이 MVP에
-- 포함하지 않았다. 필요해지면 개발계획서 DB 스키마 탭의 playlist_attachments 설계와
-- private Storage 버킷(signed URL 발급) 설계를 그대로 추가하면 된다.


-- ===== supabase/migrations/0008_briefing.sql =====
-- 관심주제 브리핑. 개발계획서 9장(Briefing) 설계를 기반으로 하되, 이 MVP는 서버
-- 자동 수집(pg_cron + Edge Function) 대신 브라우저에서 "지금 가져오기" 버튼으로
-- 직접 RSS를 수집하므로 feed_fetch_logs / item_feedback / track_token 클릭추적처럼
-- Edge Function 전용 기능은 이번 라운드에는 포함하지 않았다(고도화 시 원래 설계대로 추가).

create table if not exists briefing_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  include_keywords text[] default '{}',
  exclude_keywords text[] default '{}',
  active boolean not null default true,
  priority int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists feed_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  type text not null default 'rss' check (type in ('api', 'rss', 'crawl')),
  endpoint text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists briefing_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  topic_id uuid references briefing_topics(id) on delete set null,
  source_id uuid references feed_sources(id) on delete set null,
  title text not null,
  link text not null check (link ~* '^https?://'),
  summary text,
  published_at timestamptz,
  item_hash text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, item_hash)
);

create index if not exists idx_briefing_items_inbox on briefing_items (user_id, is_read, created_at desc);
create index if not exists idx_briefing_topics_user on briefing_topics(user_id, active);
create index if not exists idx_feed_sources_user on feed_sources(user_id, enabled);

alter table briefing_topics enable row level security;
drop policy if exists briefing_topics_own_rows on briefing_topics;
create policy briefing_topics_own_rows on briefing_topics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table feed_sources enable row level security;
drop policy if exists feed_sources_own_rows on feed_sources;
create policy feed_sources_own_rows on feed_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table briefing_items enable row level security;
drop policy if exists briefing_items_own_rows on briefing_items;
create policy briefing_items_own_rows on briefing_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 관심주제 최대 10개 제한 (js state.js에서도 동일하게 클라이언트 단에서 먼저 막는다;
-- 여기 트리거는 API를 직접 두드리는 우회 시도까지 막는 최종 방어선이다)
create or replace function enforce_briefing_topic_limit()
returns trigger as $$
begin
  if (select count(*) from briefing_topics where user_id = new.user_id) >= 10 then
    raise exception 'briefing topic limit (10) reached';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_briefing_topic_limit on briefing_topics;
create trigger trg_briefing_topic_limit
  before insert on briefing_topics
  for each row execute function enforce_briefing_topic_limit();

-- 고도화 시 추가할 것(개발계획서 9장 참고): feed_fetch_logs(소스 상태 모니터링),
-- item_feedback(키워드 학습), track_token 기반 클릭 추적 Edge Function,
-- pg_cron 기반 매일 자동 수집(현재는 브라우저에서 수동 트리거).


-- ===== supabase/migrations/0009_knowledge_automation_integrations.sql =====
-- v3.2 추가 메뉴: Knowledge / Automation(규칙 저장) / Integrations
-- + 차량관리 예측·연동에 필요한 vehicles 보험/등록 만료일 컬럼
-- automation_logs 테이블은 0002_schema.sql에서 이미 만들어졌다는 전제(로컬 스토어 초기 스키마와
-- 동일하게 유지) — 없다면 아래에서 존재 확인 후 생성한다.

-- ---------------------------------------------------------------
-- 차량관리: 보험/등록 만료일 (예측+알림 규칙에 사용)
-- ---------------------------------------------------------------
alter table vehicles add column if not exists insurance_expiry date;
alter table vehicles add column if not exists registration_expiry date;

-- ---------------------------------------------------------------
-- Knowledge: 스크랩한 링크/메모/문서 (파일 업로드는 이 MVP 범위 밖)
-- ---------------------------------------------------------------
create table if not exists knowledge_docs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null,
  url text,
  tags text[] not null default '{}',
  memo text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_knowledge_docs_user on knowledge_docs(user_id) where deleted_at is null;
create index if not exists idx_knowledge_docs_tags on knowledge_docs using gin(tags);

alter table knowledge_docs enable row level security;
drop policy if exists knowledge_docs_own_rows on knowledge_docs;
create policy knowledge_docs_own_rows on knowledge_docs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- Automation: 사용자별 규칙 on/off·파라미터 (실제 계산은 js/rules.js가 순수 함수로 수행)
-- ---------------------------------------------------------------
create table if not exists automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  rule_type text not null,
  enabled boolean not null default true,
  params jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, rule_type)
);

alter table automation_rules enable row level security;
drop policy if exists automation_rules_own_rows on automation_rules;
create policy automation_rules_own_rows on automation_rules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- automation_logs가 0002_schema.sql에 없을 가능성에 대비한 방어적 생성(이미 있으면 무시됨)
create table if not exists automation_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  rule_type text not null,
  dedupe_key text not null,
  result text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_automation_logs_user on automation_logs(user_id, created_at desc);

alter table automation_logs enable row level security;
do $$ begin
  create policy automation_logs_own_rows on automation_logs for all to authenticated
    using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------
-- Integrations: 외부 서비스 연동 상태(실제 OAuth 연동 전 단계 — 상태값만 기록)
-- ---------------------------------------------------------------
create table if not exists integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  provider text not null,
  status text not null default 'pending' check (status in ('connected', 'pending', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table integrations enable row level security;
drop policy if exists integrations_own_rows on integrations;
create policy integrations_own_rows on integrations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 참고: 메일 계정별 수집(Gmail 등)은 사용자 요청에 따라 고도화 단계로 보류되었다.
-- 실제 연동 시에는 integrations.provider='gmail' 행의 status를 'connected'로 바꾸고
-- OAuth 토큰은 별도의 암호화된 저장소(예: Supabase Vault)에 두는 설계를 검토할 것.


-- ===== supabase/migrations/0010_devlog_tags_weather_security.sql =====
-- 개발계획서 재검토 반영: Devlog 메뉴 신설, 태그(N:M 정규화 대신 이 앱 컨벤션대로 text[] 사용 —
-- knowledge_docs.tags와 동일한 단순화 패턴, playlist_items.content_type을 FK 대신 text로 둔 것과 같은 결)를
-- Schedule/Project/Devlog에 추가하고, 브리핑 소스 관제 상태 컬럼을 추가한다.

-- ---------------------------------------------------------------
-- Devlog: 개발/개선 기록, 프로젝트 연계(3장 메뉴 구조 표에 있었으나 이전 라운드에서 누락됨)
-- ---------------------------------------------------------------
create table if not exists devlogs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  title text not null,
  type text not null default 'feature' check (type in ('feature', 'fix', 'refactor', 'docs', 'chore')),
  logged_at date not null default current_date,
  project_id uuid references projects(id) on delete set null,
  tags text[] not null default '{}',
  content text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_devlogs_user on devlogs(user_id) where deleted_at is null;
create index if not exists idx_devlogs_project on devlogs(project_id) where project_id is not null;
create index if not exists idx_devlogs_tags on devlogs using gin(tags);

alter table devlogs enable row level security;
drop policy if exists devlogs_own_rows on devlogs;
create policy devlogs_own_rows on devlogs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- 태그: 4장 "태그 구조 N:M 정규화" 원안 대신, 이 앱은 처음부터 content_type/knowledge_docs.tags를
-- text[]로 단순화해 왔으므로 동일하게 Schedule·Project에도 tags text[]를 추가한다.
-- (검색·필터 요구는 이 방식으로도 충족되며, 별도 중간 테이블은 고도화 시 검토)
-- ---------------------------------------------------------------
alter table schedules add column if not exists tags text[] not null default '{}';
create index if not exists idx_schedules_tags on schedules using gin(tags);

alter table projects add column if not exists tags text[] not null default '{}';
alter table projects add column if not exists priority text not null default 'medium' check (priority in ('high', 'medium', 'low'));
create index if not exists idx_projects_tags on projects using gin(tags);

-- ---------------------------------------------------------------
-- 브리핑 소스 관제(9.3): 사용자 on/off(enabled)와 분리된 시스템 판단 상태
-- ---------------------------------------------------------------
alter table feed_sources add column if not exists last_result text check (last_result in ('success', 'error', 'timeout', 'empty'));
alter table feed_sources add column if not exists last_run_at timestamptz;

-- 참고: 날씨 다중 지역(기본 3/최대 5)은 이 MVP에서 profiles 테이블이 아니라 브라우저
-- localStorage(workspace:weatherCities)에 저장한다(테마 설정과 동일한 단순화 패턴).
-- 고도화 시 profiles.settings jsonb 컬럼으로 옮기면 기기 간 동기화가 가능해진다.


-- ===== supabase/migrations/0011_auth_signup_approval.sql =====
-- 아이디/비밀번호 회원가입 + 관리자 승인(QMS 스타일 로그인) 지원.
-- Supabase Auth(이메일/비밀번호)는 그대로 쓰고, profiles에 역할·승인 상태만 추가한다.

alter table profiles add column if not exists name text;
alter table profiles add column if not exists role text not null default 'user' check (role in ('admin', 'user'));
alter table profiles add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));

-- 기존에 이미 있던 계정(이 컬럼이 생기기 전에 가입한 사용자)은 그대로 쓸 수 있도록 승인 처리.
update profiles set status = 'approved' where status = 'pending' and created_at < now();

-- admin 여부를 security definer 함수로 확인한다(같은 테이블을 RLS 정책 안에서 직접 재귀 조회하면
-- 무한 재귀 오류가 날 수 있어 함수로 우회하는 것이 Supabase 공식 권장 패턴이다).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists profiles_own_rows on profiles;
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or is_admin());
drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert to authenticated
  with check (id = (select auth.uid()));
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid()) or is_admin())
  with check (id = (select auth.uid()) or is_admin());

-- 참고: 회원가입 직후 클라이언트에서 profiles 행을 upsert하므로(js/store/supabaseStore.js signUp),
-- insert 정책은 본인 id로만 허용한다. 승인/거절(update)은 본인 또는 admin만 가능하다.


-- ===== supabase/migrations/0012_devlog_issue_url.sql =====
-- Devlog: GitHub 이슈/PR 링크(가벼운 연동). 실제 GitHub API/OAuth 동기화는 하지 않고,
-- 이슈/PR URL만 저장해두면 화면에서 "owner/repo#번호" 배지로 파싱해 보여주고 바로 이동할 수 있게 한다.
alter table devlogs add column if not exists issue_url text;


-- ===== supabase/migrations/0013_playlist_poster_url.sql =====
-- 문화생활(PlayList) 포스터 표시. 실제 파일 업로드(Storage 버킷 + playlist_attachments 테이블)
-- 대신, 이 라운드에서는 외부 이미지 URL을 하나 저장해 카드 상단에 썸네일로 보여주는 가벼운 버전으로
-- 구현했다. 파일 업로드가 필요해지면 개발계획서 DB 스키마 탭의 playlist_attachments 설계를 참고해
-- 별도 테이블 + Storage 버킷으로 확장할 수 있다.
alter table playlist_items add column if not exists poster_url text;


-- ===== supabase/migrations/0014_schedule_flag_priority_project_stages.sql =====
-- 일정: 플래그(중요 표시)와 우선순위 추가 — 화면에서 정렬/필터에 사용한다.
alter table schedules add column if not exists flagged boolean not null default false;
alter table schedules add column if not exists priority text not null default 'medium' check (priority in ('high', 'medium', 'low'));

-- 프로젝트 진척(간트차트): 프로젝트를 단계(작업 항목)로 쪼개고 항목별 시작일/목표일을 둬야
-- 간트 바를 그리고 진도 관리를 할 수 있다. project_progress(퍼센트 스냅샷)와는 별개로,
-- "무엇을 언제까지" 관리하는 목적의 테이블이다.
create table if not exists project_stages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  seq int not null default 0,
  start_date date,
  target_date date,
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_project_stages_project on project_stages(project_id, seq);

alter table project_stages enable row level security;
drop policy if exists project_stages_own_rows on project_stages;
create policy project_stages_own_rows on project_stages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 챌린저: 오늘 체크인할 때 "무엇을 했는지" 기록하는 memo 컬럼은 challenge_checkins에
-- 이미 있다(0007에서 생성). 여기서는 재차 언급만 해둔다.


-- ===== supabase/migrations/0015_attachments_odometer_stage_group_vehicle_fuel.sql =====
-- v7.0.0: 파일 첨부 공통 테이블, 차량 주행거리 간단 기록, 프로젝트 단계 중분류, 차량 연료 종류.
create table if not exists attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  owner_table text not null,
  owner_id uuid not null,
  name text not null,
  mime_type text,
  size int,
  data text not null, -- base64 Data URL. 별도 스토리지 버킷 없이 동일한 인터페이스로 두 모드를 지원하기 위함.
  created_at timestamptz not null default now()
);
create index if not exists idx_attachments_owner on attachments(owner_table, owner_id);
alter table attachments enable row level security;
drop policy if exists attachments_own_rows on attachments;
create policy attachments_own_rows on attachments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists vehicle_odometer_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references vehicles(id) on delete cascade,
  logged_at date not null,
  odometer int not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_vehicle_odometer_logs_vehicle on vehicle_odometer_logs(vehicle_id, logged_at);
alter table vehicle_odometer_logs enable row level security;
drop policy if exists vehicle_odometer_logs_own_rows on vehicle_odometer_logs;
create policy vehicle_odometer_logs_own_rows on vehicle_odometer_logs for all to authenticated
  using (vehicle_id in (select id from vehicles where user_id = (select auth.uid())))
  with check (vehicle_id in (select id from vehicles where user_id = (select auth.uid())));

alter table project_stages add column if not exists group_name text; -- 중분류(예: "1학기-1과:노인복지론")
alter table vehicles add column if not exists fuel_type text not null default 'gasoline'
  check (fuel_type in ('gasoline', 'diesel', 'hybrid', 'ev', 'lpg'));


-- ===== supabase/migrations/0016_plan_vs_actual_and_home_widgets.sql =====
-- v7.1.0: 프로젝트/단계 계획대비 실적(실제 완료일) 관리를 위한 컬럼 추가.
-- 홈 화면 시계/Supabase 연결상태 위젯은 서버 스키마 변경이 필요 없다(클라이언트 상태만 사용).
alter table projects add column if not exists actual_completion_date date;
alter table project_stages add column if not exists actual_start_date date;
alter table project_stages add column if not exists actual_completion_date date;

-- 관심주제: RSS 외에 마크다운 붙여넣기에서 링크를 추출해 수집하는 소스 타입을 허용한다.
alter table feed_sources drop constraint if exists feed_sources_type_check;
alter table feed_sources add constraint feed_sources_type_check check (type in ('api', 'rss', 'crawl', 'markdown'));


-- ===== supabase/migrations/0017_maintenance_shop_tag.sql =====
-- v7.2.0: 차량관리 정비소 태그(이력 구분/필터용).
alter table vehicle_maintenance add column if not exists shop_name text;


-- ===== supabase/migrations/0018_health_extended_metrics_profile.sql =====
-- Health 기능 확장: 혈압·맥박·혈당·콜레스테롤 지표 추가 + 내 정보(나이/혈액형 등) 확장.
-- (여전히 진단명·복약 등 민감 의료정보는 다루지 않는다 — 체중/혈압/혈당/콜레스테롤 등은
--  모두 사용자가 직접 측정해 기록하는 일반 웰니스 수치다.)

-- health_metrics.metric_type check 제약을 새 지표로 확장한다.
-- 혈압은 수축기/이완기 두 값이라 metric_type을 bp_systolic/bp_diastolic 두 개로 나눠 저장하고
-- 화면에서 같은 기록 시각(recorded_at)으로 묶어서 "120/80"처럼 보여준다.
alter table health_metrics drop constraint if exists health_metrics_metric_type_check;
alter table health_metrics add constraint health_metrics_metric_type_check
  check (metric_type in (
    'weight', 'exercise', 'sleep', 'steps', 'condition',
    'bp_systolic', 'bp_diastolic', 'pulse', 'blood_glucose',
    'total_cholesterol', 'triglycerides', 'hdl'
  ));

-- 내 정보(설정 화면에서 입력) — 나이대별 건강 제안에 사용. 모두 선택 입력이며,
-- 민감한 진단/복약 정보가 아니라 사용자가 공개적으로 알려주는 기본 신상 정보 수준이다.
alter table profiles add column if not exists birth_date date;
alter table profiles add column if not exists gender text check (gender in ('male', 'female', 'other'));
alter table profiles add column if not exists blood_type text check (blood_type in ('A', 'B', 'O', 'AB'));
alter table profiles add column if not exists height_cm numeric;


-- ===== supabase/migrations/0019_programs_pipeline_bookmarks_knowledge_memo.sql =====
-- 프로그램 메뉴 확장(유형/개발-배포 파이프라인/관리자 계정), 즐겨찾기 URL, Knowledge 메모 구분.

-- ---------------------------------------------------------------
-- 프로그램: 유형 + 개발툴→게시(GitHub)→배포(Vercel)→저장(Supabase) 파이프라인 + 관리자 계정
-- ---------------------------------------------------------------
alter table programs add column if not exists program_type text not null default 'web'
  check (program_type in ('web', 'mobile', 'widget', 'web_mobile'));
-- pipeline 구조: { dev:{tool,id,date}, github:{id,date,url}, vercel:{id,date,url}, supabase:{id,date,url} }
-- 각 단계마다 식별자(id)와 작업일(date)이 다르고 앞으로도 단계가 늘어날 수 있어 jsonb로 유연하게 둔다.
alter table programs add column if not exists pipeline jsonb not null default '{}'::jsonb;
-- 관리자 계정(화면에서는 비밀번호를 기본적으로 마스킹하고 "보기" 버튼으로만 평문을 보여준다).
-- 주의: 개인용 참고 도구 특성상 암호화 없이 저장됩니다 — 중요한 계정의 비밀번호는 별도 비밀번호
-- 관리자 사용을 권장합니다.
alter table programs add column if not exists admin_id text;
alter table programs add column if not exists admin_password text;
-- 프로젝트 메뉴와 연동(어떤 프로젝트에서 나온 결과물인지) — Devlog와 동일한 패턴.
alter table programs add column if not exists project_id uuid references projects(id) on delete set null;

create index if not exists idx_programs_project on programs(project_id) where project_id is not null;

-- ---------------------------------------------------------------
-- 즐겨찾기 URL(바로가기) — 프로그램(내가 만든 결과물)과 달리 그냥 자주 쓰는 외부 링크 모음.
-- ---------------------------------------------------------------
create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  url text not null check (url ~* '^https?://'),
  icon text,
  category text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bookmarks_user on bookmarks(user_id, sort_order);

alter table bookmarks enable row level security;
drop policy if exists bookmarks_own_rows on bookmarks;
create policy bookmarks_own_rows on bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- Knowledge: "메모"를 "링크/문서"와 구분해서 보여줄 수 있도록 종류 컬럼 추가.
-- (기존에도 URL 없이 메모만 저장할 수 있었지만, 명시적으로 종류를 구분해 필터링이 가능해진다.)
-- ---------------------------------------------------------------
alter table knowledge_docs add column if not exists doc_type text not null default 'link'
  check (doc_type in ('link', 'memo'));


-- ===== supabase/migrations/0020_career.sql =====
-- 이력/경력 관리(Career) 메뉴 — 학력/자격증/교육이수/가입단체/포상/경력/증명사진 7개 테이블.
-- 구조는 모두 동일(사용자 소유 + 드래그 순서(sort_order) + 소프트삭제)하다.
-- v7.15.0에서 다른 마이그레이션 파일들에 적용한 재실행 안전성(idempotency) 수정을 이 파일은
-- 처음부터 반영한다: create table if not exists / create index if not exists /
-- drop policy if exists + create policy / drop trigger if exists + create trigger.

-- ---------------------------------------------------------------
-- 1) 학력
-- ---------------------------------------------------------------
create table if not exists career_education (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  school_name text not null,
  degree text,
  admission_date date,
  graduation_date date,
  status text,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_education_user on career_education (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 2) 자격증 보유
-- ---------------------------------------------------------------
create table if not exists career_certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cert_name text not null,
  issuing_org text,
  acquired_date date,
  cert_number text,
  expiry_date date,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_certifications_user on career_certifications (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 3) 교육이수
-- ---------------------------------------------------------------
create table if not exists career_trainings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  training_name text not null,
  institution text,
  start_date date,
  end_date date,
  hours numeric,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_trainings_user on career_trainings (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 4) 가입단체
-- ---------------------------------------------------------------
create table if not exists career_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  org_name text not null,
  role text,
  join_date date,
  leave_date date,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_memberships_user on career_memberships (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 5) 포상
-- ---------------------------------------------------------------
create table if not exists career_awards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  award_name text not null,
  awarding_body text,
  award_date date,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_awards_user on career_awards (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 6) 경력(회사 재직 이력)
-- ---------------------------------------------------------------
create table if not exists career_experiences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  company_name text not null,
  department_position text,
  employment_type text,
  start_date date,
  end_date date,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_experiences_user on career_experiences (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 7) 증명사진 (실제 이미지는 공용 attachments 테이블에 owner_table='career_photos'로 연결)
-- ---------------------------------------------------------------
create table if not exists career_photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  label text,
  taken_date date,
  note text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_photos_user on career_photos (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- RLS (0004_rls.sql과 동일한 패턴)
-- ---------------------------------------------------------------
alter table career_education enable row level security;
drop policy if exists career_education_own_rows on career_education;
create policy career_education_own_rows on career_education for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_certifications enable row level security;
drop policy if exists career_certifications_own_rows on career_certifications;
create policy career_certifications_own_rows on career_certifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_trainings enable row level security;
drop policy if exists career_trainings_own_rows on career_trainings;
create policy career_trainings_own_rows on career_trainings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_memberships enable row level security;
drop policy if exists career_memberships_own_rows on career_memberships;
create policy career_memberships_own_rows on career_memberships for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_awards enable row level security;
drop policy if exists career_awards_own_rows on career_awards;
create policy career_awards_own_rows on career_awards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_experiences enable row level security;
drop policy if exists career_experiences_own_rows on career_experiences;
create policy career_experiences_own_rows on career_experiences for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_photos enable row level security;
drop policy if exists career_photos_own_rows on career_photos;
create policy career_photos_own_rows on career_photos for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
-- ---------------------------------------------------------------
drop trigger if exists trg_career_education_updated_at on career_education;
create trigger trg_career_education_updated_at before update on career_education
  for each row execute function set_updated_at();

drop trigger if exists trg_career_certifications_updated_at on career_certifications;
create trigger trg_career_certifications_updated_at before update on career_certifications
  for each row execute function set_updated_at();

drop trigger if exists trg_career_trainings_updated_at on career_trainings;
create trigger trg_career_trainings_updated_at before update on career_trainings
  for each row execute function set_updated_at();

drop trigger if exists trg_career_memberships_updated_at on career_memberships;
create trigger trg_career_memberships_updated_at before update on career_memberships
  for each row execute function set_updated_at();

drop trigger if exists trg_career_awards_updated_at on career_awards;
create trigger trg_career_awards_updated_at before update on career_awards
  for each row execute function set_updated_at();

drop trigger if exists trg_career_experiences_updated_at on career_experiences;
create trigger trg_career_experiences_updated_at before update on career_experiences
  for each row execute function set_updated_at();

drop trigger if exists trg_career_photos_updated_at on career_photos;
create trigger trg_career_photos_updated_at before update on career_photos
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 0021_security_hardening.sql
-- ---------------------------------------------------------------
-- v7.17.0 보안 점검에서 발견한 권한 상승(privilege escalation) 취약점을 DB 레벨에서 막는다.
--
-- 문제: 0011에서 추가한 profiles_update 정책은
--   using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin())
-- 로, "자기 자신의 행(row)"을 수정하는 것을 허용한다. 그런데 RLS의 USING/WITH CHECK는
-- "어떤 행을 건드릴 수 있는가"만 제어할 뿐 "그 행의 어떤 컬럼을 어떤 값으로 바꿀 수 있는가"는
-- 전혀 제한하지 않는다. 즉, role/status 컬럼을 추가하면서 "가입 승인 전에는 접근 금지"라는
-- 워크플로우를 만들었지만, 일반 사용자가 자신의 유효한 JWT로 Supabase REST API를 직접 호출해
-- (클라이언트 UI를 거치지 않고) 아래와 같은 요청을 보내면 그대로 통과한다:
--   PATCH /rest/v1/profiles?id=eq.<내 uid>   body: { "role": "admin", "status": "approved" }
-- 클라이언트(js/modules/settings.js updateMyProfile)가 UI상으로 role/status를 보내지 않는 것은
-- "클라이언트가 얌전해서" 막히는 것일 뿐, RLS가 막고 있는 게 아니다 — 이 앱 아키텍처(서버리스,
-- RLS만이 유일한 서버측 강제 장치)에서는 이것만으로 보안이 전혀 되지 않는다.
--
-- 해결: BEFORE UPDATE 트리거로 "관리자가 아닌 사용자가 자기 행을 수정할 때는 role/status를
-- 무조건 기존 값으로 되돌린다"를 DB 레벨에서 강제한다. is_admin()이 true인 세션(관리자 본인,
-- 또는 js/store/supabaseStore.js의 approveUser/rejectUser가 다른 사용자 행에 대해 실행하는
-- 경우)은 영향받지 않으므로 기존 승인/거절 관리자 플로우는 그대로 동작한다. "내 정보(이름/
-- 생년월일 등) 저장" 같은 일반 자기 정보 수정 플로우도 role/status를 건드리지 않으므로
-- 동작에 변화가 없다(트리거가 NEW.role=OLD.role로 되돌려도 애초에 같은 값이라 무해함).
create or replace function prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_self_role_escalation on profiles;
create trigger trg_profiles_prevent_self_role_escalation
  before update on profiles
  for each row execute function prevent_self_role_escalation();

-- 참고(운영 조치 필요): 이 마이그레이션은 Supabase 대시보드 SQL Editor에서 실행해야 실제로
-- 적용된다. 실행 전까지는 위에서 설명한 권한 상승이 이론상 가능한 상태이므로 가능한 한 빨리
-- 적용을 권장한다. 재실행해도 안전하다(create or replace function, drop trigger if exists).


-- ===== supabase/migrations/0022_user_settings.sql =====
-- 기기 간 설정 동기화(v7.18.0) — 사용자당 1행의 jsonb 설정 저장소.
-- 같은 계정으로 여러 PC에서 로그인해도 날씨 지역, 홈 위젯 순서, 테마, 커스텀 API, API 키 등을
-- 동일하게 쓰도록, 지금까지 브라우저 localStorage에만 있던 설정성 값을 이 테이블에 함께 저장한다
-- (js/services/settingsSync.js). settings의 키 이름은 localStorage 키(workspace:...)와 같고, 값은
-- 원래 localStorage에 들어 있던 "문자열" 그대로다(JSON 문자열 포함).
--
-- ⚠️ 보안 참고: settings에는 사용자가 입력한 외부 API 키(공공데이터포털/KOPIS/오피넷/TMDB, 커스텀
-- API의 keyValue)가 "평문"으로 들어간다. RLS(user_id = auth.uid())로 본인 행만 읽고 쓸 수 있지만,
-- DB 접근 권한이 있는 사람(Supabase 프로젝트 소유자)에게는 보인다. 이번 버전에서는 암호화하지 않는다.
--
-- 0020/0021과 동일하게 재실행해도 안전하다(create table if not exists, drop ... if exists 후 create).

create table if not exists user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists user_settings_own_rows on user_settings;
create policy user_settings_own_rows on user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
drop trigger if exists trg_user_settings_updated_at on user_settings;
create trigger trg_user_settings_updated_at before update on user_settings
  for each row execute function set_updated_at();


-- ===== supabase/migrations/0023_health_medications.sql =====
-- Health 복약 관리(v7.19.0) — 내복약 정보(health_medications)와 복용 체크 기록(health_med_logs),
-- 그리고 병원/검진 일정 관리 보강(health_appointments.appt_type / updated_at).
-- 0020/0021/0022와 같은 스타일로 "재실행해도 안전"하게 작성했다:
--   create table if not exists / alter table ... add column if not exists / create index if not exists /
--   drop policy|trigger if exists 후 create.
-- ⚠️ 의료 조언이 아닌 "개인 기록용" 데이터다. 복용 일정/횟수는 사용자가 직접 입력한 값 그대로 저장한다.

-- ---------------------------------------------------------------
-- 1) 내복약 정보
--    schedule_type: 'daily'(매일, dose_times의 시각마다 복용) | 'every_n_days'(N일마다, start_date 기준) |
--                   'weekdays'(지정 요일만, weekdays에 0=일 … 6=토를 쉼표로)
--    dose_times: 복용 시각 'HH:MM'을 쉼표로 구분(예: '08:00,20:00'). 비어 있으면 "시각 없이 하루 1회".
--    remaining_count: 남은 알약/회분 수(선택). 체크할 때마다 앱이 1씩 줄여 재처방 알림에 쓴다.
-- ---------------------------------------------------------------
create table if not exists health_medications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  dosage text,
  purpose text,
  schedule_type text not null default 'daily' check (schedule_type in ('daily', 'every_n_days', 'weekdays')),
  interval_days int not null default 1 check (interval_days >= 1),
  weekdays text not null default '',
  dose_times text not null default '08:00',
  start_date date not null default current_date,
  end_date date,
  note text,
  active boolean not null default true,
  remaining_count int,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_health_medications_user on health_medications (user_id, sort_order) where deleted_at is null;

-- ---------------------------------------------------------------
-- 2) 복용 체크 기록 — 약 1개 × 날짜 × 시각(slot)마다 최대 1행.
--    status: taken(복용) | skipped(일부러 건너뜀) | missed(놓침을 명시적으로 기록).
--    기록이 아예 없는 지난 복용 시각은 앱이 "미복용(놓침)"으로 계산한다.
--    체크를 해제하면 행을 삭제한다(챌린지 체크인과 동일하게 hard delete — deleted_at 없음).
-- ---------------------------------------------------------------
create table if not exists health_med_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  medication_id uuid not null references health_medications(id) on delete cascade,
  taken_date date not null,
  slot text not null default '',
  status text not null default 'taken' check (status in ('taken', 'skipped', 'missed')),
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (medication_id, taken_date, slot)
);
create index if not exists idx_health_med_logs_user_date on health_med_logs (user_id, taken_date desc);
create index if not exists idx_health_med_logs_med on health_med_logs (medication_id, taken_date desc);

-- ---------------------------------------------------------------
-- 3) 병원/검진 일정 관리 보강 — 유형(진료/검진/…)과 수정 시각
-- ---------------------------------------------------------------
alter table health_appointments add column if not exists appt_type text;
alter table health_appointments add column if not exists updated_at timestamptz not null default now();

-- ---------------------------------------------------------------
-- RLS (own-rows)
-- ---------------------------------------------------------------
alter table health_medications enable row level security;
drop policy if exists health_medications_own_rows on health_medications;
create policy health_medications_own_rows on health_medications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table health_med_logs enable row level security;
drop policy if exists health_med_logs_own_rows on health_med_logs;
create policy health_med_logs_own_rows on health_med_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
-- ---------------------------------------------------------------
drop trigger if exists trg_health_medications_updated_at on health_medications;
create trigger trg_health_medications_updated_at before update on health_medications
  for each row execute function set_updated_at();

drop trigger if exists trg_health_med_logs_updated_at on health_med_logs;
create trigger trg_health_med_logs_updated_at before update on health_med_logs
  for each row execute function set_updated_at();

drop trigger if exists trg_health_appointments_updated_at on health_appointments;
create trigger trg_health_appointments_updated_at before update on health_appointments
  for each row execute function set_updated_at();


-- ===== supabase/migrations/0024_schedule_wbs_dday_week.sql =====
-- v7.20.0 — 일정(장소·구분·"N일 후" 반복) / 프로젝트(WBS 트리·간트) / 챌린저(D-day·주간 알약 빈도).
-- 0020~0023과 같은 스타일로 "재실행해도 안전"하게 작성했다:
--   create table if not exists / alter table ... add column if not exists / create index if not exists /
--   drop policy|trigger if exists 후 create / 제약조건은 pg_constraint 확인 후 추가 / 데이터 이전은 "이미 옮긴 행은 건너뜀" 조건.
-- 이 파일을 여러 번(3회 이상) 실행해도 결과가 같다.

-- ---------------------------------------------------------------
-- 1) 일정: 장소(place) · 구분(category) · "N일 후" 반복(repeat_offsets + 자동 생성 자식 일정)
--    category: 개인 | 회사 | 가족 | 업무 | 기타(기본값)
--    repeat_offsets: 부모 일정에 저장된 "N일 후" 목록(예 {5,7}), 최대 10개. 앱이 offset마다 자식 일정을 만든다.
--    parent_schedule_id / offset_days / is_generated: 자식 일정(자동 생성) 표식. 부모가 지워지면 연결만 끊긴다(on delete set null).
-- ---------------------------------------------------------------
alter table schedules add column if not exists place text;
alter table schedules add column if not exists repeat_offsets integer[] not null default '{}';
alter table schedules add column if not exists parent_schedule_id uuid references schedules(id) on delete set null;
alter table schedules add column if not exists offset_days integer;
alter table schedules add column if not exists is_generated boolean not null default false;

-- category는 "컬럼이 처음 생길 때 한 번만" Health 병원 일정과 연동된 기존 일정을 '개인'으로 옮긴다
-- (이후 재실행해도 사용자가 바꾼 값을 되돌리지 않는다).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'schedules' and column_name = 'category'
  ) then
    alter table schedules add column category text not null default '기타';
    update schedules set category = '개인'
      where id in (select schedule_id from health_appointments where schedule_id is not null);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedules_category_chk') then
    alter table schedules add constraint schedules_category_chk
      check (category in ('개인', '회사', '가족', '업무', '기타'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedules_repeat_offsets_chk') then
    alter table schedules add constraint schedules_repeat_offsets_chk
      check (cardinality(repeat_offsets) <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedules_offset_days_chk') then
    alter table schedules add constraint schedules_offset_days_chk
      check (offset_days is null or (offset_days between 1 and 365));
  end if;
end $$;

create index if not exists idx_schedules_parent on schedules (parent_schedule_id) where parent_schedule_id is not null;
create index if not exists idx_schedules_user_category on schedules (user_id, category) where deleted_at is null;

-- ---------------------------------------------------------------
-- 2) 프로젝트 WBS(트리): project_stages를 "부모-자식" 트리로 확장한다.
--    parent_id: 상위 항목(없으면 최상위=대분류). 깊이로 대/중/소/세 레벨과 번호(1, 1.1, 1.1.1)를 앱이 자동 계산한다.
--    progress: 0~100(리프 항목의 진행률, 부모는 앱이 자식에서 롤업 계산). is_milestone: 마일스톤(기간 0, ◆).
--    depends_on: 선행 항목 목록. 원소는 'uuid'(= 종료→시작 FS) 또는 'uuid:SS' / 'uuid:FF' / 'uuid:SF'.
--    baseline_start/baseline_end: 기준선(계획 스냅샷) — 간트에서 실제와 비교한다.
--    legacy_group: 예전 "중분류(group_name)"를 트리로 옮기며 만든 그룹 부모 표시.
--    (기존 컬럼 name/seq/start_date/target_date/status/group_name/actual_* 는 그대로 유지한다. target_date = 종료일.)
-- ---------------------------------------------------------------
alter table project_stages add column if not exists parent_id uuid references project_stages(id) on delete cascade;
alter table project_stages add column if not exists progress integer not null default 0;
alter table project_stages add column if not exists is_milestone boolean not null default false;
alter table project_stages add column if not exists depends_on text[] not null default '{}';
alter table project_stages add column if not exists baseline_start date;
alter table project_stages add column if not exists baseline_end date;
alter table project_stages add column if not exists legacy_group boolean not null default false;
alter table project_stages add column if not exists memo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_stages_progress_chk') then
    alter table project_stages add constraint project_stages_progress_chk check (progress between 0 and 100);
  end if;
end $$;

create index if not exists idx_project_stages_parent on project_stages (parent_id, seq);

-- 기존 데이터 이전(손실 없음): 예전 구조는 "프로젝트=대, group_name=중, 단계=소"였다.
--   같은 프로젝트의 같은 group_name마다 그룹 부모 행을 하나 만들고(이미 있으면 만들지 않음) 단계를 그 아래로 옮긴다.
--   group_name 원본 값은 지우지 않는다. 이미 parent_id가 있는 행은 건드리지 않으므로 재실행해도 같은 결과다.
insert into project_stages (user_id, project_id, name, seq, group_name, legacy_group, status)
select s.user_id, s.project_id, btrim(s.group_name), min(s.seq), btrim(s.group_name), true, 'todo'
from project_stages s
where s.parent_id is null
  and s.legacy_group = false
  and nullif(btrim(s.group_name), '') is not null
  and not exists (
    select 1 from project_stages g
    where g.project_id = s.project_id and g.legacy_group = true and g.parent_id is null and g.name = btrim(s.group_name)
  )
group by s.user_id, s.project_id, btrim(s.group_name);

update project_stages c set parent_id = g.id
from project_stages g
where c.parent_id is null
  and c.legacy_group = false
  and nullif(btrim(c.group_name), '') is not null
  and g.project_id = c.project_id
  and g.legacy_group = true
  and g.parent_id is null
  and g.name = btrim(c.group_name);

-- 예전 "완료" 단계는 진행률 100%로 맞춘다(앱은 status='done'도 100%로 취급하므로 표시는 같다).
update project_stages set progress = 100 where status = 'done' and progress = 0;

drop trigger if exists trg_project_stages_updated_at on project_stages;
create trigger trg_project_stages_updated_at before update on project_stages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 3) 챌린저: 빈도(주간 알약 7칸에서 "쉬는 날"을 빨강으로 표시하지 않기 위해 필요)
--    freq_type: daily(매일, 기본) | weekdays(요일 지정, freq_days '1,3,5' = 월·수·금) | times_per_week(주 N회, freq_times)
-- ---------------------------------------------------------------
alter table challenges add column if not exists freq_type text not null default 'daily';
alter table challenges add column if not exists freq_days text not null default '';
alter table challenges add column if not exists freq_times integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_freq_type_chk') then
    alter table challenges add constraint challenges_freq_type_chk
      check (freq_type in ('daily', 'weekdays', 'times_per_week'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_freq_times_chk') then
    alter table challenges add constraint challenges_freq_times_chk
      check (freq_times is null or (freq_times between 1 and 7));
  end if;
end $$;

-- ---------------------------------------------------------------
-- 4) D-day (챌린저 메뉴 상단 카드, 사용자당 최대 5개)
--    repeat_yearly: 매년 반복(기념일). 소프트삭제 없음(챌린지/체크인과 동일하게 hard delete — 개수 제한 계산이 단순해진다).
-- ---------------------------------------------------------------
create table if not exists ddays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  target_date date not null,
  emoji text,
  color text,
  memo text,
  repeat_yearly boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ddays_user on ddays (user_id, target_date);

alter table ddays enable row level security;
drop policy if exists ddays_own_rows on ddays;
create policy ddays_own_rows on ddays for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop trigger if exists trg_ddays_updated_at on ddays;
create trigger trg_ddays_updated_at before update on ddays
  for each row execute function set_updated_at();

-- 최대 5개 제한: 앱(js/state.js)에서도 먼저 막지만, API를 직접 두드리는 우회까지 막는 최종 방어선이다
-- (briefing_topics의 trg_briefing_topic_limit과 같은 패턴 + 동시 insert 경쟁을 막는 advisory lock).
create or replace function enforce_dday_limit()
returns trigger as $$
begin
  perform pg_advisory_xact_lock(hashtext('ddays:' || new.user_id::text));
  if (select count(*) from ddays where user_id = new.user_id) >= 5 then
    raise exception 'dday limit (5) reached';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_dday_limit on ddays;
create trigger trg_dday_limit before insert on ddays
  for each row execute function enforce_dday_limit();


-- ===== supabase/migrations/0025_career_documents.sql =====
-- v7.22.0 — 이력/경력 "양식 문서"(Excel/Word 양식에 등록 데이터를 매칭해 편집·저장) + 기본 인적사항.
-- 0020~0024와 같은 방식으로 "재실행해도 안전"하게 작성했다:
--   create table if not exists / create index if not exists / drop policy|trigger if exists 후 create.
-- 이 파일을 여러 번(3회 이상) 실행해도 결과가 같다.
--
-- ⚠️ 개인정보(PII) 안내: career_basic_info에는 이름·생년월일·연락처·이메일·주소가 들어간다.
--   RLS(user_id = auth.uid())로 "본인 행만" 읽고 쓸 수 있다. DB 접근 권한이 있는 사람(Supabase 프로젝트 소유자)에게는 보이므로
--   이 앱은 주민등록번호 같은 고유식별번호 칸을 아예 만들지 않았다. 양식 파일/최종본은 모두 브라우저 안에서만 처리하며
--   어떤 외부 서비스로도 보내지 않는다(attachments 테이블에 base64로만 저장, owner_table = 'career_documents').

-- ---------------------------------------------------------------
-- 1) 기본 인적사항 — 사용자당 1행(이름/영문/한자/생년월일/성별/연락처/이메일/주소/병역/국적)
-- ---------------------------------------------------------------
create table if not exists career_basic_info (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text,
  name_en text,
  name_hanja text,
  birth_date date,
  gender text,
  phone text,
  email text,
  address text,
  military text,
  nationality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_career_basic_info_user on career_basic_info (user_id);

-- ---------------------------------------------------------------
-- 2) 양식 문서 — 템플릿(xlsx/docx) 1건 + 매칭 설정(mapping) + 사용자가 편집한 값(field_values) + 최종본 목록(finals)
--    status: draft(임시저장) | saved(저장 완료). 템플릿 원본/최종본 파일은 attachments(owner_table='career_documents')에 저장.
--    finals: [{ attachment_id, name, size, created_at }] 최대 5개(앱이 관리).
-- ---------------------------------------------------------------
create table if not exists career_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  template_name text not null,
  template_kind text not null check (template_kind in ('xlsx', 'docx')),
  template_attachment_id uuid,
  mapping jsonb not null default '{}'::jsonb,
  field_values jsonb not null default '{}'::jsonb,
  finals jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'saved')),
  saved_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_documents_user on career_documents (user_id, updated_at desc) where deleted_at is null;

-- ---------------------------------------------------------------
-- RLS (0020과 동일한 패턴)
-- ---------------------------------------------------------------
alter table career_basic_info enable row level security;
drop policy if exists career_basic_info_own_rows on career_basic_info;
create policy career_basic_info_own_rows on career_basic_info for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_documents enable row level security;
drop policy if exists career_documents_own_rows on career_documents;
create policy career_documents_own_rows on career_documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
-- ---------------------------------------------------------------
drop trigger if exists trg_career_basic_info_updated_at on career_basic_info;
create trigger trg_career_basic_info_updated_at before update on career_basic_info
  for each row execute function set_updated_at();

drop trigger if exists trg_career_documents_updated_at on career_documents;
create trigger trg_career_documents_updated_at before update on career_documents
  for each row execute function set_updated_at();


-- ===== supabase/migrations/0026_schedule_end_date_briefing_spec.sql =====
-- v7.23.0 — (1) 기간(여러 날) 일정: schedules.end_date (null = 하루 일정). (2) 관심주제 간편 설정 컬럼.
-- 재실행해도 안전(add column if not exists / 제약은 존재 확인 후 추가). 여러 번 실행해도 결과가 같다.
alter table schedules add column if not exists end_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedules_end_date_chk') then
    alter table schedules add constraint schedules_end_date_chk
      check (end_date is null or end_date >= date);
  end if;
end $$;

create index if not exists idx_schedules_user_end_date on schedules (user_id, end_date) where end_date is not null;

-- v7.23.0 — 관심주제 간편 설정(사이트 URL / 특정 검색어 / 우선 검색어). 제외 단어는 기존 exclude_keywords를 그대로 쓴다.
alter table briefing_topics add column if not exists search_terms text[] not null default '{}';
alter table briefing_topics add column if not exists priority_keywords text[] not null default '{}';
alter table briefing_topics add column if not exists site_urls text[] not null default '{}';
