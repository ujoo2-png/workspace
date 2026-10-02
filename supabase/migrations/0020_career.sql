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
