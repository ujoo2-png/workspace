-- v7.24.0: 증권 확장 — 목표가/손절가(알림용)와 배당 기록.
--   · stock_holdings.target_price / stop_price: 평단 대비가 아니라 "주당 지정가". 도달하면 홈 카드에 배지로 알린다.
--   · stock_dividends: 배당금 수령 기록(종목별). 실현손익·연간 수익 요약에 쓴다.
-- 0027 실행 후에 이어서 실행한다(여러 번 실행해도 안전).

alter table stock_holdings add column if not exists target_price numeric;
alter table stock_holdings add column if not exists stop_price numeric;

create table if not exists stock_dividends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references brokerage_accounts(id) on delete cascade,
  holding_id uuid references stock_holdings(id) on delete set null,
  market text not null default 'KRX',
  symbol text not null,
  name text,
  amount numeric not null default 0,          -- 배당금 총액(세후)
  tax numeric not null default 0,             -- 원천징수 세액(참고)
  paid_at date not null default current_date, -- 지급일
  currency text not null default 'KRW',
  memo text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_stock_dividends_user on stock_dividends(user_id) where deleted_at is null;
create index if not exists idx_stock_dividends_holding on stock_dividends(holding_id) where deleted_at is null;

alter table stock_dividends enable row level security;

drop policy if exists stock_dividends_owner on stock_dividends;
create policy stock_dividends_owner on stock_dividends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
