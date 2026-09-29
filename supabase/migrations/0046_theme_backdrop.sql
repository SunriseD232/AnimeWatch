-- MediaWatch — миграция 0046: живой фон страниц с баннером (профиль → «Оформление»)
-- Применить через Supabase SQL Editor.
--
-- Третий параметр темы рядом с accent и palette (см. 0024): какой фон рисовать
-- за баннером главной — обычный, «Созвездие» или «Топография» (оба со
-- свечением в цветах текущего слайда, см. components/HeroBackdrop.tsx).
-- Идентификатор пресета, как и palette: список вариантов — BACKDROP_PRESETS
-- в lib/theme.ts, check ниже держит их в одном наборе.

alter table user_theme
  add column if not exists backdrop text not null default 'plain'
  check (backdrop in ('plain', 'stars', 'topo'));
