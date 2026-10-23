-- MediaWatch — миграция 0058: книги, сохранённые на сервере
--
-- ЗАЧЕМ
--   Флибуста бывает недоступна целиком (23.10.2026: поиск и файлы — 502,
--   flibusta.is — 503). Пока она работает, человек может сохранить книгу к
--   нам на сервер, и дальше читатель отдаёт файл с нашего диска, а не с
--   источника.
--
-- ЧТО ГДЕ ЛЕЖИТ
--   Файлы — на диске VPS (BOOK_STORAGE_DIR, по умолчанию
--   /opt/mediawatch/books), а не в базе: в БД по-прежнему только id и
--   лёгкие метаданные. Один файл на книгу и формат, общий для всех: если
--   десять человек сохранили одну книгу, на диске она одна.
--
--   book_files        — какие файлы реально лежат на диске (+ размер).
--   user_saved_books  — кто что сохранил. Это «ссылки» на файлы.
--   book_storage_state — итог последнего прогона очистки (для /admin/status).
--
-- ОГРАНИЧЕНИЯ
--   • Не больше 10 книг на человека — проверяет триггер ниже (под блокировкой
--     на пользователя, чтобы два одновременных «сохранить» не дали 11-ю).
--   • Размер одного файла и общий объём хранилища проверяет сервер
--     (lib/bookStorage.ts): лимиты живут в env, менять их без миграции.
--
-- УДАЛЕНИЕ (подробно — lib/bookStorage.ts, крон cleanup-saved-books)
--   • Человек убрал книгу — строка user_saved_books удаляется сразу.
--   • Книгу не открывали 90 дней (дочитанную — 30) — крон убирает её сам.
--   • Удалён аккаунт — строки уходят каскадом.
--   • Файл, на который больше никто не ссылается, крон удаляет с диска не
--     сразу, а через сутки: если книгу тут же сохранят снова, качать её с
--     Флибусты заново не придётся.
--
-- Применять вручную через Supabase SQL Editor после 0057.

-- ─────────────────────────────────────────────────────────────
-- 1. Файлы на диске
-- ─────────────────────────────────────────────────────────────
create table if not exists book_files (
  book_id bigint not null,
  format text not null check (format in ('epub', 'fb2')),
  size_bytes bigint not null check (size_bytes > 0),
  stored_at timestamptz not null default now(),
  -- Когда крон впервые увидел, что на файл никто не ссылается. Снова
  -- сохранили — крон сбросит в null. Прошли сутки — файл удаляется.
  unreferenced_since timestamptz,
  primary key (book_id, format)
);

-- ─────────────────────────────────────────────────────────────
-- 2. Сохранённые книги пользователя
-- ─────────────────────────────────────────────────────────────
create table if not exists user_saved_books (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- id Флибусты (= book_index.book_id = watch_progress.shikimori_id).
  book_id bigint not null,
  -- Копия названия/автора/обложки: список сохранённого должен показываться,
  -- даже если книга выпала из book_index.
  title text not null,
  author text,
  cover_url text,
  -- Какие форматы удалось сохранить (epub и/или fb2).
  formats text[] not null,
  saved_at timestamptz not null default now(),
  primary key (user_id, book_id)
);

create index if not exists user_saved_books_book_idx on user_saved_books (book_id);

-- ─────────────────────────────────────────────────────────────
-- 3. Лимит 10 книг на человека
-- ─────────────────────────────────────────────────────────────
create or replace function enforce_saved_books_limit()
returns trigger
language plpgsql
as $$
begin
  -- Блокировка на пользователя до конца транзакции: без неё два
  -- параллельных INSERT оба увидели бы 9 строк и оба прошли.
  perform pg_advisory_xact_lock(hashtext('user_saved_books:' || new.user_id::text));
  if (select count(*) from user_saved_books where user_id = new.user_id) >= 10 then
    raise exception 'saved_books_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists user_saved_books_limit on user_saved_books;
create trigger user_saved_books_limit
  before insert on user_saved_books
  for each row execute function enforce_saved_books_limit();

-- ─────────────────────────────────────────────────────────────
-- 4. Состояние очистки
-- ─────────────────────────────────────────────────────────────
create table if not exists book_storage_state (
  id boolean primary key default true check (id),
  files_count integer not null default 0,
  bytes_total bigint not null default 0,
  last_run_started_at timestamptz,
  last_run_finished_at timestamptz,
  last_error text
);

insert into book_storage_state (id) values (true) on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 5. Доступы
-- ─────────────────────────────────────────────────────────────
-- Пишет только сервер (service_role): сохранение требует скачать файл, а
-- удаление — решить судьбу файла. Человек видит только свои строки.
alter table book_files enable row level security;
alter table user_saved_books enable row level security;
alter table book_storage_state enable row level security;

drop policy if exists "own saved books select" on user_saved_books;
create policy "own saved books select" on user_saved_books
  for select to authenticated using (auth.uid() = user_id);

grant select on user_saved_books to authenticated;
