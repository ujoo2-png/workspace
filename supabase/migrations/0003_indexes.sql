create index if not exists idx_schedules_user_date on schedules (user_id, date) where deleted_at is null;
create index if not exists idx_schedules_project on schedules (project_id) where project_id is not null;
create index if not exists idx_projects_user_deadline on projects (user_id, deadline) where deleted_at is null and status = 'in_progress';
create index if not exists idx_project_progress_project on project_progress (project_id, recorded_at desc);
create index if not exists idx_programs_user_runcount on programs (user_id, run_count desc) where deleted_at is null;
create index if not exists idx_notifications_user_unread on notifications (user_id, is_read, created_at desc);
create index if not exists idx_automation_logs_user on automation_logs (user_id, created_at desc);
