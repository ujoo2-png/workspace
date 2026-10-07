-- v7.22.0 — 이력/경력 "양식 문서"(Excel/Word 양식에 등록 데이터를 매칭해 편집·저장) + 기본 인적사항.
-- 0020~0024와 같은 방식으로 "재실행해도 안전"하게 작성했다:
--   create table if not exists / create index if not exists / drop policy|trigger if exists 후 create.
-- 이 파일을 여러 번(3회 이상) 실행해도 결과가 같다.
--
-- ⚠️ 개인정보(PII) 안내: career_basic_info에는 이름·생년월일·연락처·이메일·주소가 들어간다.
--   RLS(user_id = auth.uid())로 "본인 행만" 읽고 쓸 수 있다. DB 접근 권한이 있는 사람(Supabase 프로젝트 소유자)에게는 보이므로
--   이 앱은 주민등록번호 같은 고유식별번호 칸을 아예 만들지 않았다. 양식 파일/최종본은 모두 브라우저 안에서만 처리하며
--   어떤 외부 서비스로도 보내지 않는다(attachments 테이블에 base64로만 저장, owner_table = 'career_documents').

-- ---------------------------------------------------------------
-- 1) 기본 인적사항 — 사용자당 1행(이름/영문/한자/생년월일/성별/연락처/이메일/주소/병역/국적)
-- ---------------------------------------------------------------
create table if not exists career_basic_info (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text,
  name_en text,
  name_hanja text,
  birth_date date,
  gender text,
  phone text,
  email text,
  address text,
  military text,
  nationality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_career_basic_info_user on career_basic_info (user_id);

-- ---------------------------------------------------------------
-- 2) 양식 문서 — 템플릿(xlsx/docx) 1건 + 매칭 설정(mapping) + 사용자가 편집한 값(field_values) + 최종본 목록(finals)
--    status: draft(임시저장) | saved(저장 완료). 템플릿 원본/최종본 파일은 attachments(owner_table='career_documents')에 저장.
--    finals: [{ attachment_id, name, size, created_at }] 최대 5개(앱이 관리).
-- ---------------------------------------------------------------
create table if not exists career_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  template_name text not null,
  template_kind text not null check (template_kind in ('xlsx', 'docx')),
  template_attachment_id uuid,
  mapping jsonb not null default '{}'::jsonb,
  field_values jsonb not null default '{}'::jsonb,
  finals jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'saved')),
  saved_at timestamptz,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_career_documents_user on career_documents (user_id, updated_at desc) where deleted_at is null;

-- ---------------------------------------------------------------
-- RLS (0020과 동일한 패턴)
-- ---------------------------------------------------------------
alter table career_basic_info enable row level security;
drop policy if exists career_basic_info_own_rows on career_basic_info;
create policy career_basic_info_own_rows on career_basic_info for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table career_documents enable row level security;
drop policy if exists career_documents_own_rows on career_documents;
create policy career_documents_own_rows on career_documents for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------
-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
-- ---------------------------------------------------------------
drop trigger if exists trg_career_basic_info_updated_at on career_basic_info;
create trigger trg_career_basic_info_updated_at before update on career_basic_info
  for each row execute function set_updated_at();

drop trigger if exists trg_career_documents_updated_at on career_documents;
create trigger trg_career_documents_updated_at before update on career_documents
  for each row execute function set_updated_at();
