-- 모든 테이블에 RLS를 켜고, user_id가 직접 있는 테이블은 단순 정책,
-- 없는 테이블(project_progress)은 부모(projects) 소유권을 EXISTS로 검증한다.

alter table profiles enable row level security;
create policy profiles_own_rows on profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table projects enable row level security;
create policy projects_own_rows on projects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table schedules enable row level security;
create policy schedules_own_rows on schedules for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table programs enable row level security;
create policy programs_own_rows on programs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table notifications enable row level security;
create policy notifications_own_rows on notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table automation_logs enable row level security;
create policy automation_logs_own_rows on automation_logs for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- project_progress: 직접 user_id가 없으므로 부모 프로젝트 소유권을 확인한다.
alter table project_progress enable row level security;
create policy project_progress_own_rows on project_progress for all to authenticated
  using (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())))
  with check (exists (select 1 from projects p where p.id = project_id and p.user_id = (select auth.uid())));
