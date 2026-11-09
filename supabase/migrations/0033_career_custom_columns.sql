-- v7.34.0 이력/경력 사용자 컬럼: 7개 카테고리 테이블에 사용자 정의 컬럼 값을 담는 jsonb 한 칸을 추가한다.
-- (컬럼 "정의"는 설정에, "값"은 행의 extra에 {컬럼id: 값} 형태로 저장 — 이후 컬럼을 늘리거나 바꿔도 SQL이 필요 없다.)
-- 재실행해도 안전(add column if not exists). 기존 RLS·소프트삭제는 그대로 적용된다.
alter table career_education      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_certifications add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_trainings      add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_memberships    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_awards         add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_experiences    add column if not exists extra jsonb not null default '{}'::jsonb;
alter table career_photos         add column if not exists extra jsonb not null default '{}'::jsonb;
notify pgrst, 'reload schema';
