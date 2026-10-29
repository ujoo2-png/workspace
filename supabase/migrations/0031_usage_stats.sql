-- v7.26.0: Supabase 무료 용량 관리용 "사용량" 화면이 읽는 읽기 전용 함수.
-- DB 크기·테이블별 크기·내 행 수·첨부(base64) 크기·Storage 크기·가입자 수를 한 번에 돌려준다.
-- 보안: SECURITY DEFINER(storage/auth 스키마를 읽어야 함) + search_path 고정 + 로그인한 사용자(authenticated)에게만 실행 허용.
--       비로그인(anon)과 public 실행 권한은 회수한다. 데이터 내용은 읽지 않고 크기/개수만 돌려준다.
--       (내 행 수는 user_id = auth.uid() 인 행만 센다.) 여러 번 실행해도 안전(create or replace).
create or replace function public.app_usage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t record;
  n bigint;
  tables jsonb := '[]'::jsonb;
  attach jsonb := '[]'::jsonb;
  storage_total bigint := 0;
  storage_objects bigint := 0;
  storage_buckets jsonb := '[]'::jsonb;
  users_total bigint := 0;
  users_active bigint := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- public 스키마의 일반 테이블: 총 크기(인덱스·TOAST 포함)와 "내 행 수"
  for t in
    select c.relname as name, pg_total_relation_size(c.oid) as bytes, c.reltuples::bigint as est_rows,
           exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.relname and k.column_name = 'user_id') as has_user
      from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind = 'r'
     order by pg_total_relation_size(c.oid) desc
  loop
    n := null;
    if t.has_user then
      execute format('select count(*) from public.%I where user_id = $1', t.name) into n using uid;
    end if;
    tables := tables || jsonb_build_array(jsonb_build_object('name', t.name, 'bytes', t.bytes, 'est_rows', greatest(t.est_rows, 0), 'my_rows', n));
  end loop;

  -- 첨부파일은 base64로 attachments.data에 들어 있어 DB 크기에 포함된다 → 메뉴(owner_table)별 합계
  if to_regclass('public.attachments') is not null then
    select coalesce(jsonb_agg(jsonb_build_object('owner_table', owner_table, 'files', files, 'bytes', bytes) order by bytes desc), '[]'::jsonb)
      into attach
      from (select owner_table, count(*) as files, coalesce(sum(octet_length(data)), 0) as bytes
              from public.attachments where user_id = uid group by owner_table) a;
  end if;

  -- Storage(파일 버킷) 사용량: 이 앱은 현재 버킷을 쓰지 않지만 쓰게 되면 여기에 잡힌다
  if to_regclass('storage.objects') is not null then
    select coalesce(sum((metadata->>'size')::bigint), 0), count(*) into storage_total, storage_objects from storage.objects;
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'objects', objs, 'bytes', bytes) order by bytes desc), '[]'::jsonb)
      into storage_buckets
      from (select bucket_id, count(*) as objs, coalesce(sum((metadata->>'size')::bigint), 0) as bytes from storage.objects group by bucket_id) b;
  end if;

  -- 가입자 수 / 최근 30일 로그인한 사용자(월간 활성 사용자 MAU 근사)
  select count(*), count(*) filter (where last_sign_in_at > now() - interval '30 days') into users_total, users_active from auth.users;

  return jsonb_build_object(
    'generated_at', now(),
    'db_bytes', pg_database_size(current_database()),
    'tables', tables,
    'attachments_by_owner', attach,
    'storage_bytes', storage_total,
    'storage_objects', storage_objects,
    'storage_buckets', storage_buckets,
    'users_total', users_total,
    'users_active_30d', users_active
  );
end;
$$;

revoke all on function public.app_usage_stats() from public;
revoke all on function public.app_usage_stats() from anon;
grant execute on function public.app_usage_stats() to authenticated;
