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
