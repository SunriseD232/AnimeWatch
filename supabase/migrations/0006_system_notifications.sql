-- MediaWatch — миграция 0006: системные уведомления в колокольчик
-- Отдельная таблица, НЕ трогаем episode_notifications (0005) — там жёсткая
-- схема под конкретные тайтл/серию, здесь произвольный текст (например,
-- истечение пробного периода видеобалансера). Только для админ-аккаунтов
-- (см. src/lib/admin.ts) — строки создаёт только крон через service_role.

create table if not exists system_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Дедуп-ключ вехи (например 'vibix-trial-1month') — на пару с user_id не
  -- даёт крону прислать одно и то же уведомление дважды.
  key text not null,
  title text not null,
  message text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, key)
);

create index if not exists system_notifications_user_idx
  on system_notifications (user_id, created_at desc);

alter table system_notifications enable row level security;

drop policy if exists "own system notifications select" on system_notifications;
drop policy if exists "own system notifications update" on system_notifications;

create policy "own system notifications select" on system_notifications
  for select using (auth.uid() = user_id);
create policy "own system notifications update" on system_notifications
  for update using (auth.uid() = user_id);

-- Намеренно нет insert-политики для authenticated — строки создаёт только
-- крон через service_role (обходит RLS), как и episode_notifications.
grant select, update on system_notifications to authenticated;

-- Realtime — чтобы колокольчик обновлялся сразу, без перезагрузки страницы.
alter publication supabase_realtime add table system_notifications;
