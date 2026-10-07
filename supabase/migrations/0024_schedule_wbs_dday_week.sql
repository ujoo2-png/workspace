-- v7.20.0 — 일정(장소·구분·"N일 후" 반복) / 프로젝트(WBS 트리·간트) / 챌린저(D-day·주간 알약 빈도).
-- 0020~0023과 같은 스타일로 "재실행해도 안전"하게 작성했다:
--   create table if not exists / alter table ... add column if not exists / create index if not exists /
--   drop policy|trigger if exists 후 create / 제약조건은 pg_constraint 확인 후 추가 / 데이터 이전은 "이미 옮긴 행은 건너뜀" 조건.
-- 이 파일을 여러 번(3회 이상) 실행해도 결과가 같다.

-- ---------------------------------------------------------------
-- 1) 일정: 장소(place) · 구분(category) · "N일 후" 반복(repeat_offsets + 자동 생성 자식 일정)
--    category: 개인 | 회사 | 가족 | 업무 | 기타(기본값)
--    repeat_offsets: 부모 일정에 저장된 "N일 후" 목록(예 {5,7}), 최대 10개. 앱이 offset마다 자식 일정을 만든다.
--    parent_schedule_id / offset_days / is_generated: 자식 일정(자동 생성) 표식. 부모가 지워지면 연결만 끊긴다(on delete set null).
-- ---------------------------------------------------------------
alter table schedules add column if not exists place text;
alter table schedules add column if not exists repeat_offsets integer[] not null default '{}';
alter table schedules add column if not exists parent_schedule_id uuid references schedules(id) on delete set null;
alter table schedules add column if not exists offset_days integer;
alter table schedules add column if not exists is_generated boolean not null default false;

-- category는 "컬럼이 처음 생길 때 한 번만" Health 병원 일정과 연동된 기존 일정을 '개인'으로 옮긴다
-- (이후 재실행해도 사용자가 바꾼 값을 되돌리지 않는다).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'schedules' and column_name = 'category'
  ) then
    alter table schedules add column category text not null default '기타';
    update schedules set category = '개인'
      where id in (select schedule_id from health_appointments where schedule_id is not null);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'schedules_category_chk') then
    alter table schedules add constraint schedules_category_chk
      check (category in ('개인', '회사', '가족', '업무', '기타'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedules_repeat_offsets_chk') then
    alter table schedules add constraint schedules_repeat_offsets_chk
      check (cardinality(repeat_offsets) <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'schedules_offset_days_chk') then
    alter table schedules add constraint schedules_offset_days_chk
      check (offset_days is null or (offset_days between 1 and 365));
  end if;
end $$;

create index if not exists idx_schedules_parent on schedules (parent_schedule_id) where parent_schedule_id is not null;
create index if not exists idx_schedules_user_category on schedules (user_id, category) where deleted_at is null;

-- ---------------------------------------------------------------
-- 2) 프로젝트 WBS(트리): project_stages를 "부모-자식" 트리로 확장한다.
--    parent_id: 상위 항목(없으면 최상위=대분류). 깊이로 대/중/소/세 레벨과 번호(1, 1.1, 1.1.1)를 앱이 자동 계산한다.
--    progress: 0~100(리프 항목의 진행률, 부모는 앱이 자식에서 롤업 계산). is_milestone: 마일스톤(기간 0, ◆).
--    depends_on: 선행 항목 목록. 원소는 'uuid'(= 종료→시작 FS) 또는 'uuid:SS' / 'uuid:FF' / 'uuid:SF'.
--    baseline_start/baseline_end: 기준선(계획 스냅샷) — 간트에서 실제와 비교한다.
--    legacy_group: 예전 "중분류(group_name)"를 트리로 옮기며 만든 그룹 부모 표시.
--    (기존 컬럼 name/seq/start_date/target_date/status/group_name/actual_* 는 그대로 유지한다. target_date = 종료일.)
-- ---------------------------------------------------------------
alter table project_stages add column if not exists parent_id uuid references project_stages(id) on delete cascade;
alter table project_stages add column if not exists progress integer not null default 0;
alter table project_stages add column if not exists is_milestone boolean not null default false;
alter table project_stages add column if not exists depends_on text[] not null default '{}';
alter table project_stages add column if not exists baseline_start date;
alter table project_stages add column if not exists baseline_end date;
alter table project_stages add column if not exists legacy_group boolean not null default false;
alter table project_stages add column if not exists memo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_stages_progress_chk') then
    alter table project_stages add constraint project_stages_progress_chk check (progress between 0 and 100);
  end if;
end $$;

create index if not exists idx_project_stages_parent on project_stages (parent_id, seq);

-- 기존 데이터 이전(손실 없음): 예전 구조는 "프로젝트=대, group_name=중, 단계=소"였다.
--   같은 프로젝트의 같은 group_name마다 그룹 부모 행을 하나 만들고(이미 있으면 만들지 않음) 단계를 그 아래로 옮긴다.
--   group_name 원본 값은 지우지 않는다. 이미 parent_id가 있는 행은 건드리지 않으므로 재실행해도 같은 결과다.
insert into project_stages (user_id, project_id, name, seq, group_name, legacy_group, status)
select s.user_id, s.project_id, btrim(s.group_name), min(s.seq), btrim(s.group_name), true, 'todo'
from project_stages s
where s.parent_id is null
  and s.legacy_group = false
  and nullif(btrim(s.group_name), '') is not null
  and not exists (
    select 1 from project_stages g
    where g.project_id = s.project_id and g.legacy_group = true and g.parent_id is null and g.name = btrim(s.group_name)
  )
group by s.user_id, s.project_id, btrim(s.group_name);

update project_stages c set parent_id = g.id
from project_stages g
where c.parent_id is null
  and c.legacy_group = false
  and nullif(btrim(c.group_name), '') is not null
  and g.project_id = c.project_id
  and g.legacy_group = true
  and g.parent_id is null
  and g.name = btrim(c.group_name);

-- 예전 "완료" 단계는 진행률 100%로 맞춘다(앱은 status='done'도 100%로 취급하므로 표시는 같다).
update project_stages set progress = 100 where status = 'done' and progress = 0;

drop trigger if exists trg_project_stages_updated_at on project_stages;
create trigger trg_project_stages_updated_at before update on project_stages
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------
-- 3) 챌린저: 빈도(주간 알약 7칸에서 "쉬는 날"을 빨강으로 표시하지 않기 위해 필요)
--    freq_type: daily(매일, 기본) | weekdays(요일 지정, freq_days '1,3,5' = 월·수·금) | times_per_week(주 N회, freq_times)
-- ---------------------------------------------------------------
alter table challenges add column if not exists freq_type text not null default 'daily';
alter table challenges add column if not exists freq_days text not null default '';
alter table challenges add column if not exists freq_times integer;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'challenges_freq_type_chk') then
    alter table challenges add constraint challenges_freq_type_chk
      check (freq_type in ('daily', 'weekdays', 'times_per_week'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'challenges_freq_times_chk') then
    alter table challenges add constraint challenges_freq_times_chk
      check (freq_times is null or (freq_times between 1 and 7));
  end if;
end $$;

-- ---------------------------------------------------------------
-- 4) D-day (챌린저 메뉴 상단 카드, 사용자당 최대 5개)
--    repeat_yearly: 매년 반복(기념일). 소프트삭제 없음(챌린지/체크인과 동일하게 hard delete — 개수 제한 계산이 단순해진다).
-- ---------------------------------------------------------------
create table if not exists ddays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  target_date date not null,
  emoji text,
  color text,
  memo text,
  repeat_yearly boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ddays_user on ddays (user_id, target_date);

alter table ddays enable row level security;
drop policy if exists ddays_own_rows on ddays;
create policy ddays_own_rows on ddays for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop trigger if exists trg_ddays_updated_at on ddays;
create trigger trg_ddays_updated_at before update on ddays
  for each row execute function set_updated_at();

-- 최대 5개 제한: 앱(js/state.js)에서도 먼저 막지만, API를 직접 두드리는 우회까지 막는 최종 방어선이다
-- (briefing_topics의 trg_briefing_topic_limit과 같은 패턴 + 동시 insert 경쟁을 막는 advisory lock).
create or replace function enforce_dday_limit()
returns trigger as $$
begin
  perform pg_advisory_xact_lock(hashtext('ddays:' || new.user_id::text));
  if (select count(*) from ddays where user_id = new.user_id) >= 5 then
    raise exception 'dday limit (5) reached';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_dday_limit on ddays;
create trigger trg_dday_limit before insert on ddays
  for each row execute function enforce_dday_limit();
