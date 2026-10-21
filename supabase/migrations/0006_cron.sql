-- pg_cron 스케줄링. Supabase 대시보드 Database > Extensions에서 pg_cron을 먼저 켠 뒤 실행하세요.
-- (일반 마이그레이션 권한으로는 확장 설치가 막혀 있을 수 있습니다.)
--
-- v7.25.0: 이 파일 전체를 do 블록으로 감싸 재실행·권한 부족 상황에서도
--   "전체 붙여넣기 실행"이 중단되지 않게 한다(이미 스케줄이 있으면 지우고 다시 등록 → 중복 없음).
--   pg_cron이 없거나 권한이 없으면 알림(notice)만 남기고 조용히 건너뛴다.
-- v7.26.0 수정: cron.schedule 의 SQL 문자열을 $cron$ … $cron$ 로 감싼다.
--   바깥 do 블록 안에서 같은 태그(두 개의 달러 기호)를 다시 쓰면 바깥 블록이 조기 종료되어
--   "ERROR 42601: syntax error at or near select" 가 났다.
do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron 확장을 설치하지 못했습니다(권한 또는 미지원). 대시보드 Database > Extensions에서 직접 켜 주세요: %', sqlerrm;
    return;
  end;

  -- 매일 한국시간 08:00 = UTC 23:00 실행. run_daily_automation()은 0005_functions.sql 참고.
  -- 재실행 시 중복 등록을 막기 위해 기존 스케줄을 먼저 지운다(없으면 무시).
  begin
    perform cron.unschedule('daily-automation');
  exception when others then
    null; -- 아직 없는 스케줄을 지우려 한 경우는 무시
  end;
  perform cron.schedule(
    'daily-automation',
    '0 23 * * *',
    $cron$select run_daily_automation(7)$cron$
  );
exception when others then
  raise notice 'pg_cron 스케줄 등록을 건너뛰었습니다(확장 미설치). 나머지 마이그레이션은 정상입니다: %', sqlerrm;
end $$;

-- 스케줄 확인: select * from cron.job;
-- 스케줄 제거: select cron.unschedule('daily-automation');

-- 참고: 날씨 동기화, 메일/RSS 수집처럼 외부 네트워크 호출이 필요한 자동화는
-- 이 순수 SQL 방식이 아니라 Edge Function + pg_net으로 별도 구현한다(개발계획서 4.5장).
