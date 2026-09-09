-- MediaWatch — миграция 0032: ключ алфавитной сортировки
--
-- ЗАЧЕМ. Сортировка «По алфавиту» начиналась с мусора: «- Ишь ты,
-- Масленица!», «¡Ay, mi madre!», «¿Cómo te llamas?», «... и в бедности».
-- Postgres сортирует по коллации, а она ставит пунктуацию перед буквами —
-- то есть первую страницу занимало то, что искать по алфавиту никто не
-- станет.
--
-- Ключ считается прямо в базе генерируемой колонкой, а не при записи: он
-- обязан быть согласован со всеми строками разом, включая те, что вставит
-- следующая ночная перестройка, и вычислять его в трёх местах кода —
-- заявка на расхождение.
--
-- Порядок разрядов: сперва буквы, потом цифры, в конце всё остальное.
-- Внутри разряда — обычная коллация по нижнему регистру.

alter table cinema_index
  add column if not exists title_sort text
  generated always as (
    case
      when title ~ '^[[:alpha:]]' then '1'
      when title ~ '^[0-9]' then '2'
      else '3'
    end || lower(coalesce(title, ''))
  ) stored;

alter table anime_index
  add column if not exists title_sort text
  generated always as (
    case
      when coalesce(russian, name) ~ '^[[:alpha:]]' then '1'
      when coalesce(russian, name) ~ '^[0-9]' then '2'
      else '3'
    end || lower(coalesce(russian, name, ''))
  ) stored;

create index if not exists cinema_index_batch_title_sort_idx
  on cinema_index (batch_id, title_sort);

create index if not exists anime_index_batch_title_sort_idx
  on anime_index (batch_id, title_sort);
