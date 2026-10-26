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
