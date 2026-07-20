-- AnimeWatch — миграция 0005: уведомления о новых сериях
-- Крон раз в сутки (см. src/app/api/cron/check-episodes) сравнивает текущее
-- число серий тайтла с последним известным и, если оно выросло, создаёт
-- уведомление каждому, у кого этот тайтл в статусе 'watching'.

-- =========================================================
-- Уведомления (персональные, по одному на пользователя)
-- =========================================================
create table if not exists episode_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id integer not null,
  title text not null,
  poster_url text,
  episode integer not null, -- новое общее число серий на момент уведомления
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, content_type, shikimori_id, episode)
);

create index if not exists episode_notifications_user_idx
  on episode_notifications (user_id, created_at desc);

alter table episode_notifications enable row level security;

drop policy if exists "own notifications select" on episode_notifications;
drop policy if exists "own notifications update" on episode_notifications;
drop policy if exists "own notifications delete" on episode_notifications;

create policy "own notifications select" on episode_notifications
  for select using (auth.uid() = user_id);
create policy "own notifications update" on episode_notifications
  for update using (auth.uid() = user_id);
create policy "own notifications delete" on episode_notifications
  for delete using (auth.uid() = user_id);

-- Намеренно нет insert-политики для authenticated: строки создаёт только
-- крон через service_role (обходит RLS) — пользователи не могут создавать
-- уведомления сами себе.
grant select, update, delete on episode_notifications to authenticated;

-- Realtime — чтобы колокольчик обновлялся сразу, без перезагрузки страницы.
alter publication supabase_realtime add table episode_notifications;

-- =========================================================
-- Кэш последнего известного числа серий на тайтл (глобальный, НЕ per-user) —
-- крону нужно с чем сравнивать при следующей проверке. Доступ — только
-- service_role: RLS включена без единой policy, что закрывает доступ для
-- ролей anon/authenticated полностью (клиенты эту таблицу не видят).
-- =========================================================
create table if not exists title_episode_baseline (
  content_type text not null check (content_type in ('anime', 'cinema')),
  shikimori_id integer not null,
  known_episodes integer not null,
  checked_at timestamptz not null default now(),
  primary key (content_type, shikimori_id)
);

alter table title_episode_baseline enable row level security;
