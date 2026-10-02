-- 확장 기능. pgcrypto는 gen_random_uuid()를 위해 필요하다(Supabase는 기본 활성화되어 있는 경우가 많음).
create extension if not exists pgcrypto;
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
create index if not exists idx_schedules_user_date on schedules (user_id, date) where deleted_at is null;
create index if not exists idx_schedules_project on schedules (project_id) where project_id is not null;
create index if not exists idx_projects_user_deadline on projects (user_id, deadline) where deleted_at is null and status = 'in_progress';
create index if not exists idx_project_progress_project on project_progress (project_id, recorded_at desc);
create index if not exists idx_programs_user_runcount on programs (user_id, run_count desc) where deleted_at is null;
create index if not exists idx_notifications_user_unread on notifications (user_id, is_read, created_at desc);
create index if not exists idx_automation_logs_user on automation_logs (user_id, created_at desc);
-- 모든 테이블에 RLS를 켜고, user_id가 직접 있는 테이블은 단순 정책,
-- 없는 테이블(project_progress)은 부모(projects) 소유권을 EXISTS로 검증한다.

alter table profiles enable row level security;
create policy profiles_own_rows on profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table projects enable row level security;
create policy projects_own_rows on projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table schedules enable row level security;
create policy schedules_own_rows on schedules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table programs enable row level security;
create policy programs_own_rows on programs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table notifications enable row level security;
create policy notifications_own_rows on notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table automation_logs enable row level security;
create policy automation_logs_own_rows on automation_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- project_progress: 직접 user_id가 없으므로 부모 프로젝트 소유권을 확인한다.
alter table project_progress enable row level security;
create policy project_progress_own_rows on project_progress for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())));
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
-- 챌린저 / 차량관리 / Health / 문화생활(PlayList)
-- 개발계획서 DB 스키마 탭의 설계를 기반으로 하되, 이 앱에는 파일 업로드(Storage)와
-- content_types lookup 테이블을 아직 쓰지 않으므로 그 부분만 단순화했다(문서상
-- content_type_id uuid FK 대신 content_type text로 저장 — js 코드가 실제로 이렇게 호출한다).

-- ---------------------------------------------------------------
-- 챌린저
-- ---------------------------------------------------------------
create table challenges (
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

create table challenge_checkins (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid references challenges(id) on delete cascade not null,
  checkin_date date not null,
  value numeric not null default 1,
  memo text,
  created_at timestamptz not null default now(),
  unique (challenge_id, checkin_date)
);

create index idx_challenges_user on challenges(user_id, status);
create index idx_challenge_checkins_challenge on challenge_checkins(challenge_id, checkin_date desc);

alter table challenges enable row level security;
create policy challenges_own_rows on challenges for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table challenge_checkins enable row level security;
create policy challenge_checkins_own_rows on challenge_checkins for all to authenticated
  using (exists (select 1 from challenges c where c.id = challenge_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from challenges c where c.id = challenge_id and c.user_id = (select auth.uid())));

-- ---------------------------------------------------------------
-- 차량관리
-- ---------------------------------------------------------------
create table vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  plate_number text,
  model text,
  year int,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table vehicle_maintenance (
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

create table vehicle_fuel_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid references vehicles(id) on delete cascade not null,
  logged_at date not null,
  odometer int,
  amount numeric,
  cost numeric,
  created_at timestamptz not null default now()
);

create index idx_vehicles_user on vehicles(user_id) where deleted_at is null;
create index idx_vehicle_maintenance_vehicle on vehicle_maintenance(vehicle_id, service_date desc);
create index idx_vehicle_maintenance_due on vehicle_maintenance(next_due_date) where next_due_date is not null;
create index idx_vehicle_fuel_vehicle on vehicle_fuel_logs(vehicle_id, logged_at desc);

alter table vehicles enable row level security;
create policy vehicles_own_rows on vehicles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table vehicle_maintenance enable row level security;
create policy vehicle_maintenance_own_rows on vehicle_maintenance for all to authenticated
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())));

alter table vehicle_fuel_logs enable row level security;
create policy vehicle_fuel_logs_own_rows on vehicle_fuel_logs for all to authenticated
  using (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())))
  with check (exists (select 1 from vehicles v where v.id = vehicle_id and v.user_id = (select auth.uid())));

-- ---------------------------------------------------------------
-- Health (일반 웰니스 지표만 — 진단명·복약 등 민감 의료정보는 다루지 않는다)
-- ---------------------------------------------------------------
create table health_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  metric_type text not null check (metric_type in ('weight', 'exercise', 'sleep', 'steps', 'condition')),
  value numeric not null,
  unit text,
  note text,
  recorded_at timestamptz not null default now()
);

create table health_appointments (
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

create index idx_health_metrics_user_type on health_metrics(user_id, metric_type, recorded_at desc);
create index idx_health_appointments_user on health_appointments(user_id, appointment_date);

alter table health_metrics enable row level security;
create policy health_metrics_own_rows on health_metrics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table health_appointments enable row level security;
create policy health_appointments_own_rows on health_appointments for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- 문화생활(PlayList) — 영화/음악/연극/음악회 등
-- ---------------------------------------------------------------
create table playlist_items (
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

create index idx_playlist_user_status on playlist_items(user_id, status) where deleted_at is null;
create index idx_playlist_event_date on playlist_items(event_date) where event_date is not null;

alter table playlist_items enable row level security;
create policy playlist_own_rows on playlist_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 참고: 포스터·티켓 등 파일 첨부(playlist_attachments, Storage 버킷)는 이 MVP에
-- 포함하지 않았다. 필요해지면 개발계획서 DB 스키마 탭의 playlist_attachments 설계와
-- private Storage 버킷(signed URL 발급) 설계를 그대로 추가하면 된다.
-- 관심주제 브리핑. 개발계획서 9장(Briefing) 설계를 기반으로 하되, 이 MVP는 서버
-- 자동 수집(pg_cron + Edge Function) 대신 브라우저에서 "지금 가져오기" 버튼으로
-- 직접 RSS를 수집하므로 feed_fetch_logs / item_feedback / track_token 클릭추적처럼
-- Edge Function 전용 기능은 이번 라운드에는 포함하지 않았다(고도화 시 원래 설계대로 추가).

create table briefing_topics (
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

create table feed_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  type text not null default 'rss' check (type in ('api', 'rss', 'crawl')),
  endpoint text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table briefing_items (
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

create index idx_briefing_items_inbox on briefing_items (user_id, is_read, created_at desc);
create index idx_briefing_topics_user on briefing_topics(user_id, active);
create index idx_feed_sources_user on feed_sources(user_id, enabled);

alter table briefing_topics enable row level security;
create policy briefing_topics_own_rows on briefing_topics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table feed_sources enable row level security;
create policy feed_sources_own_rows on feed_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table briefing_items enable row level security;
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

create trigger trg_briefing_topic_limit
  before insert on briefing_topics
  for each row execute function enforce_briefing_topic_limit();

-- 고도화 시 추가할 것(개발계획서 9장 참고): feed_fetch_logs(소스 상태 모니터링),
-- item_feedback(키워드 학습), track_token 기반 클릭 추적 Edge Function,
-- pg_cron 기반 매일 자동 수집(현재는 브라우저에서 수동 트리거).
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
create policy integrations_own_rows on integrations for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 참고: 메일 계정별 수집(Gmail 등)은 사용자 요청에 따라 고도화 단계로 보류되었다.
-- 실제 연동 시에는 integrations.provider='gmail' 행의 status를 'connected'로 바꾸고
-- OAuth 토큰은 별도의 암호화된 저장소(예: Supabase Vault)에 두는 설계를 검토할 것.
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
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or is_admin());
create policy profiles_insert on profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid()) or is_admin())
  with check (id = (select auth.uid()) or is_admin());

-- 참고: 회원가입 직후 클라이언트에서 profiles 행을 upsert하므로(js/store/supabaseStore.js signUp),
-- insert 정책은 본인 id로만 허용한다. 승인/거절(update)은 본인 또는 admin만 가능하다.
-- Devlog: GitHub 이슈/PR 링크(가벼운 연동). 실제 GitHub API/OAuth 동기화는 하지 않고,
-- 이슈/PR URL만 저장해두면 화면에서 "owner/repo#번호" 배지로 파싱해 보여주고 바로 이동할 수 있게 한다.
alter table devlogs add column if not exists issue_url text;
-- 문화생활(PlayList) 포스터 표시. 실제 파일 업로드(Storage 버킷 + playlist_attachments 테이블)
-- 대신, 이 라운드에서는 외부 이미지 URL을 하나 저장해 카드 상단에 썸네일로 보여주는 가벼운 버전으로
-- 구현했다. 파일 업로드가 필요해지면 개발계획서 DB 스키마 탭의 playlist_attachments 설계를 참고해
-- 별도 테이블 + Storage 버킷으로 확장할 수 있다.
alter table playlist_items add column if not exists poster_url text;
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
create policy project_stages_own_rows on project_stages for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 챌린저: 오늘 체크인할 때 "무엇을 했는지" 기록하는 memo 컬럼은 challenge_checkins에
-- 이미 있다(0007에서 생성). 여기서는 재차 언급만 해둔다.
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
create policy vehicle_odometer_logs_own_rows on vehicle_odometer_logs for all to authenticated
  using (vehicle_id in (select id from vehicles where user_id = (select auth.uid())))
  with check (vehicle_id in (select id from vehicles where user_id = (select auth.uid())));

alter table project_stages add column if not exists group_name text; -- 중분류(예: "1학기-1과:노인복지론")
alter table vehicles add column if not exists fuel_type text not null default 'gasoline'
  check (fuel_type in ('gasoline', 'diesel', 'hybrid', 'ev', 'lpg'));
-- v7.1.0: 프로젝트/단계 계획대비 실적(실제 완료일) 관리를 위한 컬럼 추가.
-- 홈 화면 시계/Supabase 연결상태 위젯은 서버 스키마 변경이 필요 없다(클라이언트 상태만 사용).
alter table projects add column if not exists actual_completion_date date;
alter table project_stages add column if not exists actual_start_date date;
alter table project_stages add column if not exists actual_completion_date date;

-- 관심주제: RSS 외에 마크다운 붙여넣기에서 링크를 추출해 수집하는 소스 타입을 허용한다.
alter table feed_sources drop constraint if exists feed_sources_type_check;
alter table feed_sources add constraint feed_sources_type_check check (type in ('api', 'rss', 'crawl', 'markdown'));
-- v7.2.0: 차량관리 정비소 태그(이력 구분/필터용).
alter table vehicle_maintenance add column if not exists shop_name text;
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
create policy bookmarks_own_rows on bookmarks for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- Knowledge: "메모"를 "링크/문서"와 구분해서 보여줄 수 있도록 종류 컬럼 추가.
-- (기존에도 URL 없이 메모만 저장할 수 있었지만, 명시적으로 종류를 구분해 필터링이 가능해진다.)
-- ---------------------------------------------------------------
alter table knowledge_docs add column if not exists doc_type text not null default 'link'
  check (doc_type in ('link', 'memo'));
