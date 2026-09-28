-- 관심주제 브리핑. 개발계획서 9장(Briefing) 설계를 기반으로 하되, 이 MVP는 서버
-- 자동 수집(pg_cron + Edge Function) 대신 브라우저에서 "지금 가져오기" 버튼으로
-- 직접 RSS를 수집하므로 feed_fetch_logs / item_feedback / track_token 클릭추적처럼
-- Edge Function 전용 기능은 이번 라운드에는 포함하지 않았다(고도화 시 원래 설계대로 추가).

create table briefing_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  include_keywords text[] default '{}',
  exclude_keywords text[] default '{}',
  active boolean not null default true,
  priority int not null default 5,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table feed_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  name text not null,
  type text not null default 'rss' check (type in ('api', 'rss', 'crawl')),
  endpoint text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create table briefing_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  topic_id uuid references briefing_topics(id) on delete set null,
  source_id uuid references feed_sources(id) on delete set null,
  title text not null,
  link text not null check (link ~* '^https?://'),
  summary text,
  published_at timestamptz,
  item_hash text not null,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, item_hash)
);

create index idx_briefing_items_inbox on briefing_items (user_id, is_read, created_at desc);
create index idx_briefing_topics_user on briefing_topics(user_id, active);
create index idx_feed_sources_user on feed_sources(user_id, enabled);

alter table briefing_topics enable row level security;
create policy briefing_topics_own_rows on briefing_topics for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table feed_sources enable row level security;
create policy feed_sources_own_rows on feed_sources for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table briefing_items enable row level security;
create policy briefing_items_own_rows on briefing_items for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 관심주제 최대 10개 제한 (js state.js에서도 동일하게 클라이언트 단에서 먼저 막는다;
-- 여기 트리거는 API를 직접 두드리는 우회 시도까지 막는 최종 방어선이다)
create or replace function enforce_briefing_topic_limit()
returns trigger as $$
begin
  if (select count(*) from briefing_topics where user_id = new.user_id) >= 10 then
    raise exception 'briefing topic limit (10) reached';
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_briefing_topic_limit
  before insert on briefing_topics
  for each row execute function enforce_briefing_topic_limit();

-- 고도화 시 추가할 것(개발계획서 9장 참고): feed_fetch_logs(소스 상태 모니터링),
-- item_feedback(키워드 학습), track_token 기반 클릭 추적 Edge Function,
-- pg_cron 기반 매일 자동 수집(현재는 브라우저에서 수동 트리거).
