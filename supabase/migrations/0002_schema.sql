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
