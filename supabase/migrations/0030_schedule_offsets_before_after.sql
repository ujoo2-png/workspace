-- 0030 — 일정 "N일 전/후" 통합(v7.24.0 계열 기능): 음수 오프셋(= N일 전)과 최대 60개를 허용한다.
-- 기존 제약(0024: 개수 ≤ 10, offset_days 1~365)을 "있으면 지우고 다시 만든다" 방식으로 바꿔 여러 번 실행해도 안전하다.
alter table schedules drop constraint if exists schedules_repeat_offsets_chk;
alter table schedules add constraint schedules_repeat_offsets_chk check (cardinality(repeat_offsets) <= 60);
alter table schedules drop constraint if exists schedules_offset_days_chk;
alter table schedules add constraint schedules_offset_days_chk
  check (offset_days is null or (offset_days between -365 and 365 and offset_days <> 0));
