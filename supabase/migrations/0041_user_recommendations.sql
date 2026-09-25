-- MediaWatch — миграция 0041: персональные рекомендации главной
--
-- ЗАЧЕМ. Блок «Рекомендуем посмотреть» на новой главной (см. план редизайна)
-- подбирается LLM (OpenRouter) по истории просмотра — раз в сутки кроном
-- api/cron/refresh-recommendations, а не на каждый заход на страницу: живой
-- вызов модели в рендере — это и задержка, и деньги на каждый визит.
--
-- Крон полностью перезаписывает набор рангов пользователя за один прогон
-- (upsert по первичному ключу), старые ранги, которых в новом наборе нет,
-- отдельно не чистятся ЗДЕСЬ — см. функцию replaceRecommendations в
-- lib/recommendationsEngine.ts, она удаляет их явно перед вставкой.
create table if not exists user_recommendations (
  user_id uuid not null references auth.users(id) on delete cascade,
  content_type text not null check (content_type in ('anime','cinema')),
  -- shikimori_id для 'anime', kp_id для 'cinema' — та же денормализация
  -- имени поля, что и в watch_progress.shikimori_id.
  item_id integer not null,
  -- 1 = лучшая рекомендация. По нему же выбирается hero (см. lib/recommendations.ts).
  rank integer not null,
  -- Короткое обоснование от модели — опционально всплывает в UI подсказкой
  -- «почему это тебе». Не обязательно для работы блока.
  reason text,
  generated_at timestamptz not null default now(),
  primary key (user_id, content_type, rank)
);

create index if not exists user_recommendations_lookup_idx
  on user_recommendations (user_id, content_type);

alter table user_recommendations enable row level security;

create policy "users read own recommendations" on user_recommendations
  for select using (auth.uid() = user_id);

grant select on user_recommendations to authenticated;
-- Пишет только крон под service_role (обходит RLS, как и прочие крон-таблицы).

-- ─────────────────────────────────────────────────────────────
-- Hero-выбор (главный баннер)
-- ─────────────────────────────────────────────────────────────
-- Отдельно от user_recommendations: hero — не обязательно rank=1 (см. бонус
-- за популярность в lib/recommendationsEngine.ts), и, в отличие от списка
-- рекомендаций, нужен ТАКЖЕ гостю. Вместо nullable user_id (ломает семантику
-- upsert по PK — NULL никогда не равен NULL) гость — обычная строка с
-- фиксированным sentinel-id GUEST_HERO_USER_ID (см. lib/recommendations.ts).
--
-- backdrop_url — уже ПОЛНОСТЬЮ разрешённая ссылка (локальный кэш, если он
-- скачался, иначе прямая ссылка на апстрим), посчитанная кроном заранее.
-- Рендер страницы никогда не ходит в Kitsu/TMDB сам — раздел «Аниме» иначе
-- был бы вынужден на каждый холодный кэш делать живой запрос к Kitsu.
create table if not exists hero_pick (
  user_id uuid not null,
  content_type text not null check (content_type in ('anime','cinema')),
  item_id integer not null,
  backdrop_url text,
  generated_at timestamptz not null default now(),
  primary key (user_id, content_type)
);

alter table hero_pick enable row level security;

-- '00000000-0000-0000-0000-000000000000' — гостевой sentinel, читается всеми
-- (anon в том числе), это не персональные данные, а общий популярный тайтл.
create policy "users read own or guest hero" on hero_pick
  for select using (
    auth.uid() = user_id or user_id = '00000000-0000-0000-0000-000000000000'
  );

grant select on hero_pick to authenticated, anon;
