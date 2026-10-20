-- v7.24.0: 증권 — 보유 계좌와 주식을 관리하고 실시간 시세로 손익을 평가한다.
--   · brokerage_accounts: 증권 계좌(증권사·계좌번호·별칭)
--   · stock_holdings:    계좌별 보유 종목(종목코드·수량·평균단가)
--   · stock_trades:      매수/매도 기록(선택 — 보유 종목의 평균단가를 자동 계산할 때 사용)
-- 시세 자체는 저장하지 않는다(한국투자증권 KIS API에서 실시간으로 받아 화면에서만 계산).
-- 사용자 설정(앱키/시크릿)은 이 앱의 기존 방침대로 브라우저에만 저장하며 DB에 넣지 않는다.

create table if not exists brokerage_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  broker text not null default '한국투자증권',
  account_no text,
  nickname text,
  currency text not null default 'KRW',   -- KRW | USD (해외주식 계좌)
  is_active boolean not null default true,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_brokerage_accounts_user on brokerage_accounts(user_id) where deleted_at is null;

create table if not exists stock_holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references brokerage_accounts(id) on delete cascade,
  market text not null default 'KRX',     -- KRX(국내) | US(해외)
  symbol text not null,                    -- 종목코드 (예: 005930) 또는 티커 (예: AAPL)
  name text,                               -- 종목명 (없으면 시세 조회 시 채움)
  quantity numeric not null default 0,
  avg_price numeric not null default 0,    -- 평균 매입단가(주당)
  currency text not null default 'KRW',
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_stock_holdings_user on stock_holdings(user_id) where deleted_at is null;
create index if not exists idx_stock_holdings_account on stock_holdings(account_id) where deleted_at is null;

-- 매수/매도 기록. 등록하면 보유 종목의 수량·평균단가를 자동으로 다시 계산할 수 있다(선택 기능).
create table if not exists stock_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references brokerage_accounts(id) on delete cascade,
  holding_id uuid references stock_holdings(id) on delete set null,
  market text not null default 'KRX',
  symbol text not null,
  name text,
  side text not null default 'buy',        -- buy | sell
  quantity numeric not null default 0,
  price numeric not null default 0,
  fee numeric not null default 0,
  traded_at date not null default current_date,
  memo text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_stock_trades_user on stock_trades(user_id) where deleted_at is null;
create index if not exists idx_stock_trades_holding on stock_trades(holding_id) where deleted_at is null;

-- RLS: 본인 데이터만 접근.
alter table brokerage_accounts enable row level security;
alter table stock_holdings enable row level security;
alter table stock_trades enable row level security;

drop policy if exists brokerage_accounts_owner on brokerage_accounts;
create policy brokerage_accounts_owner on brokerage_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists stock_holdings_owner on stock_holdings;
create policy stock_holdings_owner on stock_holdings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists stock_trades_owner on stock_trades;
create policy stock_trades_owner on stock_trades
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at 자동 갱신 트리거(다른 테이블과 동일한 패턴).
create or replace function set_brokerage_accounts_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_brokerage_accounts_updated_at on brokerage_accounts;
create trigger trg_brokerage_accounts_updated_at before update on brokerage_accounts
  for each row execute function set_brokerage_accounts_updated_at();

create or replace function set_stock_holdings_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists trg_stock_holdings_updated_at on stock_holdings;
create trigger trg_stock_holdings_updated_at before update on stock_holdings
  for each row execute function set_stock_holdings_updated_at();
