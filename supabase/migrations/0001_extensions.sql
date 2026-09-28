-- 확장 기능. pgcrypto는 gen_random_uuid()를 위해 필요하다(Supabase는 기본 활성화되어 있는 경우가 많음).
create extension if not exists pgcrypto;
