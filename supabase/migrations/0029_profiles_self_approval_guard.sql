-- v7.25.0 — 회원가입 승인 우회 방지(권한 상승 차단).
--
-- 문제: 0011의 profiles_update 정책은 "본인 행이면 update 허용"이라, 승인 대기(pending) 사용자가
--   클라이언트에서 직접  update profiles set status = 'approved'  를 실행해 스스로 승인할 수 있었다.
--   이는 "승인된 계정만 로그인" 요구를 DB 계층에서 무력화한다(RLS as the last line of defense).
--
-- 해결: (a) 본인은 name만 수정 가능하고 role/status는 불변(변경 시도하면 row-level check에서 거부),
--       (b) admin은 모든 필드 수정 가능. 트리거 없이 RLS with check만으로 처리한다.

-- 1) self-update: 본인 행이면서 role/status가 "현재 값 그대로"일 때만 통과.
drop policy if exists profiles_update on profiles;
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role   is not distinct from (select p.role   from profiles p where p.id = (select auth.uid()))
    and status is not distinct from (select p.status from profiles p where p.id = (select auth.uid()))
  );

-- 2) admin-update: admin은 role/status 포함 모든 필드 수정 가능(승인/거절/역할 변경).
drop policy if exists profiles_update_admin on profiles;
create policy profiles_update_admin on profiles for update to authenticated
  using (is_admin())
  with check (is_admin());

-- 3) (권고) admin은 한 명만 존재하도록 부분 유니크 인덱스로 강제한다.
--    첫 가입자 판정의 경쟁 상태(동시 가입 시 admin 2명)를 DB가 막아 준다.
--    이미 admin이 2명 이상인 기존 데이터가 있으면 이 인덱스 생성이 실패하므로,
--    그 경우 먼저  select id, email from profiles where role='admin';  로 정리한 뒤 실행하세요.
create unique index if not exists profiles_one_admin on profiles ((role)) where role = 'admin';
