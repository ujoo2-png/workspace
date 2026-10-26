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
