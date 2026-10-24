-- MediaWatch — миграция 0066: обратная связь с администратором
--
-- ЗАЧЕМ (24.10.2026). Новые разделы (подкасты, аудиокниги, книги, ранобэ,
-- манга) могут работать нестабильно — при первом заходе мы так и говорим и
-- зовём написать. Писать — из профиля: выбрать раздел, описать проблему.
-- Это переписка, а не разовая форма: администратор отвечает в том же
-- обращении, человек видит ответ в профиле и в колокольчике.
--
--   1. feedback_threads  — обращение: кто, про какой раздел, открыто ли,
--      кто ещё не прочитал последнее сообщение.
--   2. feedback_messages — сообщения в обращении (от человека или от админа).
--   3. system_notifications.href — куда ведёт уведомление по нажатию
--      (раньше системные уведомления были только текстом).
--
-- Пишет только сервер (/api/feedback*, service_role) после проверки входа
-- и прав: админ отвечает в любом обращении, человек пишет только в своё.
-- Человек читает свои обращения по RLS; админ — через сервер.
--
-- Применять после 0065.

create table if not exists feedback_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  section text not null check (section in (
    'anime', 'cinema', 'podcasts', 'audiobooks', 'books', 'ranobe', 'manga', 'site', 'other'
  )),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Кто ещё не видел последнее сообщение: по ним — счётчики на вкладках.
  user_unread boolean not null default false,
  admin_unread boolean not null default true
);

create index if not exists feedback_threads_user_idx on feedback_threads (user_id, last_message_at desc);
create index if not exists feedback_threads_inbox_idx on feedback_threads (last_message_at desc);

create table if not exists feedback_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references feedback_threads (id) on delete cascade,
  author_id uuid references auth.users (id) on delete set null,
  from_admin boolean not null default false,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists feedback_messages_thread_idx on feedback_messages (thread_id, created_at);

alter table feedback_threads enable row level security;
alter table feedback_messages enable row level security;

create policy "own feedback threads select" on feedback_threads
  for select to authenticated using (auth.uid() = user_id);
create policy "own feedback messages select" on feedback_messages
  for select to authenticated using (
    exists (select 1 from feedback_threads t where t.id = thread_id and t.user_id = auth.uid())
  );

revoke all on feedback_threads, feedback_messages from anon, authenticated;
grant select on feedback_threads, feedback_messages to authenticated;
grant select, insert, update, delete on feedback_threads, feedback_messages to service_role;

comment on table feedback_threads is 'Обращения к администратору (профиль → «Обратная связь»).';
comment on table feedback_messages is 'Сообщения в обращениях; from_admin — ответ администратора.';

-- Ссылка у системного уведомления: ответ на обращение ведёт в профиль, в
-- нужную переписку. Пусто — уведомление только текстом, как раньше.
alter table system_notifications add column if not exists href text;
