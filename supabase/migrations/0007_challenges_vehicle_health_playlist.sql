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
