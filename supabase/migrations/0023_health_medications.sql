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
