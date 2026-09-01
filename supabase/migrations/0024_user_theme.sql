-- MediaWatch — миграция 0024: персональная тема оформления (профиль → «Оформление»)
-- Применить через Supabase SQL Editor.
--
-- Хранится ИМЕННО в БД, а не только в localStorage, ради того же принципа,
-- что и прогресс просмотра: настройка едет за пользователем на другое
-- устройство. localStorage при этом остаётся — но как зеркало ради
-- мгновенного применения до первого рендера (см. lib/theme.ts,
-- components/ThemeScript.tsx): читать БД до отрисовки нельзя, а показать
-- синий и через мгновение перекрасить в выбранный — заметный мигающий скачок.
--
-- Две колонки, а не пять: акцент задаётся точным hex-ом (пользователь может
-- выбрать произвольный), а фон — идентификатором пресета. Произвольный фон
-- сознательно не даём: тёмная палитра сайта завязана на контраст со светлым
-- текстом, и свободный выбор фона легко делает интерфейс нечитаемым.
-- Оттенок наведения (accent hover) не хранится — выводится из accent
-- осветлением (lightenHex в lib/theme.ts), отдельная настройка на него
-- пользователю не нужна.

create table if not exists user_theme (
  user_id uuid primary key references auth.users(id) on delete cascade,
  -- #rrggbb, валидируется и здесь, и в lib/theme.ts (клиент шлёт что угодно)
  accent text not null default '#2997ff' check (accent ~* '^#[0-9a-f]{6}$'),
  -- идентификатор пресета фона, см. BG_PRESETS в lib/theme.ts
  palette text not null default 'black' check (palette in ('black', 'graphite', 'midnight')),
  updated_at timestamptz not null default now()
);

alter table user_theme enable row level security;

-- Пользователь видит и меняет только свою тему — чужая никому не нужна.
create policy "user can read own theme"
  on user_theme for select
  using (auth.uid() = user_id);

create policy "user can insert own theme"
  on user_theme for insert
  with check (auth.uid() = user_id);

create policy "user can update own theme"
  on user_theme for update
  using (auth.uid() = user_id);

-- Явный грант — RLS policy без него не работает (Postgres сначала проверяет
-- табличные права, потом RLS). Та же грабля, что в 0020/0021.
grant select, insert, update on user_theme to authenticated;
