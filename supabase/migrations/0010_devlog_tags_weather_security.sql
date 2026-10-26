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
