-- v7.23.0 — (1) 기간(여러 날) 일정: schedules.end_date (null = 하루 일정). (2) 관심주제 간편 설정 컬럼.
-- 재실행해도 안전(add column if not exists / 제약은 존재 확인 후 추가). 여러 번 실행해도 결과가 같다.
alter table schedules add column if not exists end_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedules_end_date_chk') then
    alter table schedules add constraint schedules_end_date_chk
      check (end_date is null or end_date >= date);
  end if;
end $$;

create index if not exists idx_schedules_user_end_date on schedules (user_id, end_date) where end_date is not null;

-- v7.23.0 — 관심주제 간편 설정(사이트 URL / 특정 검색어 / 우선 검색어). 제외 단어는 기존 exclude_keywords를 그대로 쓴다.
alter table briefing_topics add column if not exists search_terms text[] not null default '{}';
alter table briefing_topics add column if not exists priority_keywords text[] not null default '{}';
alter table briefing_topics add column if not exists site_urls text[] not null default '{}';

-- v7.24.0 — 일정 "N일 전/후" 통합: 음수 오프셋(= N일 전)과 최대 60개 허용.
-- 기존 제약(0024: 개수 ≤ 10, offset_days 1~365)을 "있으면 지우고 다시 만든다" 방식으로 바꿔 여러 번 실행해도 안전하다.
alter table schedules drop constraint if exists schedules_repeat_offsets_chk;
alter table schedules add constraint schedules_repeat_offsets_chk check (cardinality(repeat_offsets) <= 60);
alter table schedules drop constraint if exists schedules_offset_days_chk;
alter table schedules add constraint schedules_offset_days_chk
  check (offset_days is null or (offset_days between -365 and 365 and offset_days <> 0));
