-- v7.17.0 보안 점검에서 발견한 권한 상승(privilege escalation) 취약점을 DB 레벨에서 막는다.
--
-- 문제: 0011에서 추가한 profiles_update 정책은
--   using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin())
-- 로, "자기 자신의 행(row)"을 수정하는 것을 허용한다. 그런데 RLS의 USING/WITH CHECK는
-- "어떤 행을 건드릴 수 있는가"만 제어할 뿐 "그 행의 어떤 컬럼을 어떤 값으로 바꿀 수 있는가"는
-- 전혀 제한하지 않는다. 즉, role/status 컬럼을 추가하면서 "가입 승인 전에는 접근 금지"라는
-- 워크플로우를 만들었지만, 일반 사용자가 자신의 유효한 JWT로 Supabase REST API를 직접 호출해
-- (클라이언트 UI를 거치지 않고) 아래와 같은 요청을 보내면 그대로 통과한다:
--   PATCH /rest/v1/profiles?id=eq.<내 uid>   body: { "role": "admin", "status": "approved" }
-- 클라이언트(js/modules/settings.js updateMyProfile)가 UI상으로 role/status를 보내지 않는 것은
-- "클라이언트가 얌전해서" 막히는 것일 뿐, RLS가 막고 있는 게 아니다 — 이 앱 아키텍처(서버리스,
-- RLS만이 유일한 서버측 강제 장치)에서는 이것만으로 보안이 전혀 되지 않는다.
--
-- 해결: BEFORE UPDATE 트리거로 "관리자가 아닌 사용자가 자기 행을 수정할 때는 role/status를
-- 무조건 기존 값으로 되돌린다"를 DB 레벨에서 강제한다. is_admin()이 true인 세션(관리자 본인,
-- 또는 js/store/supabaseStore.js의 approveUser/rejectUser가 다른 사용자 행에 대해 실행하는
-- 경우)은 영향받지 않으므로 기존 승인/거절 관리자 플로우는 그대로 동작한다. "내 정보(이름/
-- 생년월일 등) 저장" 같은 일반 자기 정보 수정 플로우도 role/status를 건드리지 않으므로
-- 동작에 변화가 없다(트리거가 NEW.role=OLD.role로 되돌려도 애초에 같은 값이라 무해함).
create or replace function prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    new.role := old.role;
    new.status := old.status;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_prevent_self_role_escalation on profiles;
create trigger trg_profiles_prevent_self_role_escalation
  before update on profiles
  for each row execute function prevent_self_role_escalation();

-- 참고(운영 조치 필요): 이 마이그레이션은 Supabase 대시보드 SQL Editor에서 실행해야 실제로
-- 적용된다. 실행 전까지는 위에서 설명한 권한 상승이 이론상 가능한 상태이므로 가능한 한 빨리
-- 적용을 권장한다. 재실행해도 안전하다(create or replace function, drop trigger if exists).
