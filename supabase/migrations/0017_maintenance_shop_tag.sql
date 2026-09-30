-- v7.2.0: 차량관리 정비소 태그(이력 구분/필터용).
alter table vehicle_maintenance add column if not exists shop_name text;
