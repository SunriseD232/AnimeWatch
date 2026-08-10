-- MediaWatch — миграция 0021: presence-эвристика «сейчас онлайн» для админ-бейджа в шапке
-- Применить через Supabase SQL Editor.
--
-- Не Supabase Realtime Presence — тот требует держать открытый websocket-
-- канал у КАЖДОГО клиента ради счётчика в шапке, слишком тяжело для этой
-- задачи. Вместо этого простой heartbeat: клиент раз в ~45 секунд, пока
-- вкладка видима, обновляет свою строку через POST /api/presence/heartbeat
-- (см. route.ts и components/PresenceHeartbeat.tsx), а «онлайн» на сервере —
-- просто last_seen_at не старше нескольких минут (см. getOnlineUserCount в
-- lib/admin.ts).

create table if not exists user_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);

create index if not exists user_presence_last_seen_idx
  on user_presence (last_seen_at);

alter table user_presence enable row level security;

-- Пользователь видит/пишет только свою строку — никому, кроме service_role
-- (админ-бейдж, обходит RLS), не нужно видеть чужие отметки присутствия.
create policy "user can read own presence"
  on user_presence for select
  using (auth.uid() = user_id);

create policy "user can insert own presence"
  on user_presence for insert
  with check (auth.uid() = user_id);

create policy "user can update own presence"
  on user_presence for update
  using (auth.uid() = user_id);

-- Явный грант — миграция 0020 напоминание, что RLS policy без него не
-- работает (Postgres сначала проверяет табличные права, потом RLS).
grant select, insert, update on user_presence to authenticated;
