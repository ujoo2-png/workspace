-- Health 기능 확장: 혈압·맥박·혈당·콜레스테롤 지표 추가 + 내 정보(나이/혈액형 등) 확장.
-- (여전히 진단명·복약 등 민감 의료정보는 다루지 않는다 — 체중/혈압/혈당/콜레스테롤 등은
--  모두 사용자가 직접 측정해 기록하는 일반 웰니스 수치다.)

-- health_metrics.metric_type check 제약을 새 지표로 확장한다.
-- 혈압은 수축기/이완기 두 값이라 metric_type을 bp_systolic/bp_diastolic 두 개로 나눠 저장하고
-- 화면에서 같은 기록 시각(recorded_at)으로 묶어서 "120/80"처럼 보여준다.
alter table health_metrics drop constraint if exists health_metrics_metric_type_check;
alter table health_metrics add constraint health_metrics_metric_type_check
  check (metric_type in (
    'weight', 'exercise', 'sleep', 'steps', 'condition',
    'bp_systolic', 'bp_diastolic', 'pulse', 'blood_glucose',
    'total_cholesterol', 'triglycerides', 'hdl'
  ));

-- 내 정보(설정 화면에서 입력) — 나이대별 건강 제안에 사용. 모두 선택 입력이며,
-- 민감한 진단/복약 정보가 아니라 사용자가 공개적으로 알려주는 기본 신상 정보 수준이다.
alter table profiles add column if not exists birth_date date;
alter table profiles add column if not exists gender text check (gender in ('male', 'female', 'other'));
alter table profiles add column if not exists blood_type text check (blood_type in ('A', 'B', 'O', 'AB'));
alter table profiles add column if not exists height_cm numeric;
