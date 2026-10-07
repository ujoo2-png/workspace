-- 기기 간 설정 동기화(v7.18.0) — 사용자당 1행의 jsonb 설정 저장소.
-- 같은 계정으로 여러 PC에서 로그인해도 날씨 지역, 홈 위젯 순서, 테마, 커스텀 API, API 키 등을
-- 동일하게 쓰도록, 지금까지 브라우저 localStorage에만 있던 설정성 값을 이 테이블에 함께 저장한다
-- (js/services/settingsSync.js). settings의 키 이름은 localStorage 키(workspace:...)와 같고, 값은
-- 원래 localStorage에 들어 있던 "문자열" 그대로다(JSON 문자열 포함).
--
-- ⚠️ 보안 참고: settings에는 사용자가 입력한 외부 API 키(공공데이터포털/KOPIS/오피넷/TMDB, 커스텀
-- API의 keyValue)가 "평문"으로 들어간다. RLS(user_id = auth.uid())로 본인 행만 읽고 쓸 수 있지만,
-- DB 접근 권한이 있는 사람(Supabase 프로젝트 소유자)에게는 보인다. 이번 버전에서는 암호화하지 않는다.
--
-- 0020/0021과 동일하게 재실행해도 안전하다(create table if not exists, drop ... if exists 후 create).

create table if not exists user_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

drop policy if exists user_settings_own_rows on user_settings;
create policy user_settings_own_rows on user_settings for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- updated_at 자동 갱신 트리거 (0005_functions.sql의 set_updated_at() 재사용)
drop trigger if exists trg_user_settings_updated_at on user_settings;
create trigger trg_user_settings_updated_at before update on user_settings
  for each row execute function set_updated_at();
