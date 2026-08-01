-- 0014 fixed default privileges for FUTURE tables, but existing ones
-- (created before that ALTER DEFAULT PRIVILEGES ran) were never retroactively
-- granted. resolved_streams is one of them — its service_role reads/writes
-- have been silently failing (same "permission denied" pattern as
-- user_list/app_settings before 0014), meaning the extraction cache never
-- actually worked: every watch request re-ran live extraction instead of
-- reusing a cached stream URL.
do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
