-- Этот проект почему-то не имеет стандартных Supabase default privileges —
-- у service_role нет прав даже на свои же таблицы, если их создали через
-- SQL Editor (RLS тут ни при чём, это отдельный уровень GRANT). Из-за этого
-- app_settings молча не читался/не писался (getSetting просто ловил ошибку и
-- подставлял fallback), и по той же причине давно падает
-- /api/cron/check-episodes на user_list ("permission denied for table
-- user_list").
grant select, insert, update, delete on public.app_settings to service_role;
grant select, insert, update, delete on public.user_list to service_role;

-- И на будущее — чтобы это не повторялось для каждой новой таблицы.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
