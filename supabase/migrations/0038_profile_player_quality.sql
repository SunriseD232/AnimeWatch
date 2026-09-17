-- Качество видео по умолчанию — теперь настройка аккаунта, а не устройства.
--
-- Сначала она жила только в localStorage (рядом с громкостью и скоростью), но
-- по просьбе пользователя переносим в профиль, чтобы выбор подхватывался на
-- всех устройствах — как оформление. localStorage при этом остаётся зеркалом:
-- плеер читает значение синхронно в обработчике манифеста hls.js, ждать там
-- сетевой запрос негде (см. components/OwnPlayer.tsx и lib/playerQuality.ts).
--
-- Пусто (null) — человек настройку не трогал: тогда зеркало на устройстве не
-- перетираем, см. PlayerPrefsSync.
--
-- Права не выдаём отдельно: grant select on profiles to authenticated из
-- миграции 0036 — табличный, новые колонки под него попадают сами. Пишет в
-- profiles по-прежнему только service_role (через PATCH /api/profile).

alter table profiles
  add column if not exists preferred_quality smallint,
  -- Синхронизировать ли выбор между устройствами. Флаг АККАУНТА, а не
  -- устройства: это один выключатель на всё, иначе пришлось бы включать
  -- синхронизацию на каждом устройстве отдельно, и смысл терялся бы.
  -- Выключено по умолчанию — прежнее поведение (качество живёт локально).
  add column if not exists sync_player_quality boolean not null default false;

-- Ограничение добавляем идемпотентно: add constraint не умеет if not exists,
-- а миграции на этом проекте прогоняются и повторно.
do $$
begin
  alter table profiles
    add constraint profiles_preferred_quality_check
    check (preferred_quality is null or preferred_quality in (480, 720, 1080));
exception
  when duplicate_object then null;
end
$$;
