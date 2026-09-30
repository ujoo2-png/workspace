-- v7.1.0: 프로젝트/단계 계획대비 실적(실제 완료일) 관리를 위한 컬럼 추가.
-- 홈 화면 시계/Supabase 연결상태 위젯은 서버 스키마 변경이 필요 없다(클라이언트 상태만 사용).
alter table projects add column if not exists actual_completion_date date;
alter table project_stages add column if not exists actual_start_date date;
alter table project_stages add column if not exists actual_completion_date date;

-- 관심주제: RSS 외에 마크다운 붙여넣기에서 링크를 추출해 수집하는 소스 타입을 허용한다.
alter table feed_sources drop constraint if exists feed_sources_type_check;
alter table feed_sources add constraint feed_sources_type_check check (type in ('api', 'rss', 'crawl', 'markdown'));
