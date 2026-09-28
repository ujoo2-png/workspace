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
