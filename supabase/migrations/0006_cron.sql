-- pg_cron 스케줄링. Supabase 대시보드 Database > Extensions에서 pg_cron을 먼저 켠 뒤 실행하세요.
-- (일반 마이그레이션 권한으로는 확장 설치가 막혀 있을 수 있습니다.)
create extension if not exists pg_cron;

-- 매일 한국시간 08:00 = UTC 23:00 실행. run_daily_automation()은 0005_functions.sql 참고.
select cron.schedule(
  'daily-automation',
  '0 23 * * *',
  $$select run_daily_automation(7)$$
);

-- 스케줄 확인: select * from cron.job;
-- 스케줄 제거: select cron.unschedule('daily-automation');

-- 참고: 날씨 동기화, 메일/RSS 수집처럼 외부 네트워크 호출이 필요한 자동화는
-- 이 순수 SQL 방식이 아니라 Edge Function + pg_net으로 별도 구현한다(개발계획서 4.5장).
