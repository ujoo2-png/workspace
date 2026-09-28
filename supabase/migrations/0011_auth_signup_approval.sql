-- 아이디/비밀번호 회원가입 + 관리자 승인(QMS 스타일 로그인) 지원.
-- Supabase Auth(이메일/비밀번호)는 그대로 쓰고, profiles에 역할·승인 상태만 추가한다.

alter table profiles add column if not exists name text;
alter table profiles add column if not exists role text not null default 'user' check (role in ('admin', 'user'));
alter table profiles add column if not exists status text not null default 'pending' check (status in ('pending', 'approved', 'rejected'));

-- 기존에 이미 있던 계정(이 컬럼이 생기기 전에 가입한 사용자)은 그대로 쓸 수 있도록 승인 처리.
update profiles set status = 'approved' where status = 'pending' and created_at < now();

-- admin 여부를 security definer 함수로 확인한다(같은 테이블을 RLS 정책 안에서 직접 재귀 조회하면
-- 무한 재귀 오류가 날 수 있어 함수로 우회하는 것이 Supabase 공식 권장 패턴이다).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists profiles_own_rows on profiles;
create policy profiles_select on profiles for select to authenticated
  using (id = (select auth.uid()) or is_admin());
create policy profiles_insert on profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on profiles for update to authenticated
  using (id = (select auth.uid()) or is_admin())
  with check (id = (select auth.uid()) or is_admin());

-- 참고: 회원가입 직후 클라이언트에서 profiles 행을 upsert하므로(js/store/supabaseStore.js signUp),
-- insert 정책은 본인 id로만 허용한다. 승인/거절(update)은 본인 또는 admin만 가능하다.
