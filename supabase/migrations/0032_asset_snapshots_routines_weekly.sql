-- v7.33.0: ① 일별 마감 자산 스냅샷 ② 루틴(반복 할 일) + 수행 기록 ③ 주간 브리핑 보관.
-- 모든 테이블은 RLS로 "내 행만"(user_id = auth.uid()) 접근한다. 여러 번 실행해도 안전(if not exists / drop policy if exists).
-- 서비스 키·비밀번호는 쓰지 않는다 — 앱이 로그인한 사용자 권한으로만 읽고 쓴다.

-- ① 일별 마감 자산: 하루 1행(user_id, snap_date 유일). detail에 종목별 수량·가격·평가액을 남겨 나중에 원인을 볼 수 있다.
create table if not exists stock_asset_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  snap_date date not null,
  total_value numeric not null default 0,   -- 원화 환산 총 평가금액
  total_cost numeric not null default 0,    -- 원화 환산 총 매입금액
  holdings_count int not null default 0,
  evaluated_count int not null default 0,   -- 시세가 있어 평가된 종목 수(부족하면 합계가 낮을 수 있음)
  usd_krw numeric,                          -- 해외 종목 환산에 쓴 환율(없으면 null)
  source text not null default 'live',      -- live(장 마감 후 실시간 시세) | backfill(일봉 종가로 보충)
  detail jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, snap_date)
);
create index if not exists idx_asset_snap_user_date on stock_asset_snapshots(user_id, snap_date desc);

-- ② 루틴
create table if not exists routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text,
  cadence text not null default 'daily' check (cadence in ('daily','weekdays','weekly','monthly','interval')),
  weekdays text not null default '',        -- cadence='weekdays': '1,3,5' (월=1 … 일=7)
  times_per_week int,                       -- cadence='weekly': 주 N회(요일 상관없이)
  interval_days int,                        -- cadence='interval': N일마다
  start_date date not null default current_date,
  auto_source text,                         -- 자동 완료 연결: health | health:<지표> | devlog | challenge:<id> | stocks
  note text,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_routines_user on routines(user_id) where deleted_at is null;

create table if not exists routine_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null references routines(id) on delete cascade,
  log_date date not null,
  note text,
  created_at timestamptz not null default now(),
  unique (routine_id, log_date)
);
create index if not exists idx_routine_logs_user_date on routine_logs(user_id, log_date desc);

-- ③ 주간 브리핑(금요일 오전 9시 이후 첫 접속 때 만들어 보관)
create table if not exists weekly_briefings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,                 -- 그 주 월요일
  content jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

alter table stock_asset_snapshots enable row level security;
alter table routines enable row level security;
alter table routine_logs enable row level security;
alter table weekly_briefings enable row level security;

drop policy if exists stock_asset_snapshots_owner on stock_asset_snapshots;
create policy stock_asset_snapshots_owner on stock_asset_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists routines_owner on routines;
create policy routines_owner on routines for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists routine_logs_owner on routine_logs;
create policy routine_logs_owner on routine_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists weekly_briefings_owner on weekly_briefings;
create policy weekly_briefings_owner on weekly_briefings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
