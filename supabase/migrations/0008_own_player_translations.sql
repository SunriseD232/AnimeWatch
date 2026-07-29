-- MediaWatch — миграция 0008: выбор озвучки в собственном плеере (OwnPlayer)
-- Применить через Supabase SQL Editor.
--
-- 1) resolved_streams: разные озвучки Alloha резолвятся в РАЗНЫЕ прямые
--    ссылки — кэш должен различать их по озвучке, иначе второй пользователь
--    (или тот же после смены озвучки) получит закэшированный поток от чужой
--    озвучки. translation_id тут — Yummy video_id, валиден только В РАМКАХ
--    этой же серии (см. ниже про watch_progress — как раз поэтому его нельзя
--    использовать для долгосрочного запоминания).
alter table resolved_streams add column if not exists translation_id integer not null default 0;

do $$
declare
  old_constraint text;
begin
  select conname into old_constraint
  from pg_constraint
  where conrelid = 'resolved_streams'::regclass and contype = 'u';
  if old_constraint is not null then
    execute format('alter table resolved_streams drop constraint %I', old_constraint);
  end if;
end $$;

alter table resolved_streams add constraint resolved_streams_unique_key
  unique (content_type, shikimori_id, season, episode, source, translation_id);

drop index if exists resolved_streams_lookup_idx;
create index if not exists resolved_streams_lookup_idx
  on resolved_streams (content_type, shikimori_id, season, episode, source, translation_id);

-- 2) watch_progress: video_id Yummy НЕ стабилен между сериями (у одной и той
--    же озвучки на разных сериях разный video_id) — поэтому для запоминания
--    выбора пользователя между заходами храним текстовую метку озвучки
--    (dubbing-название вида "Озвучка AniLibria · Alloha"), а не число:
--    на новой серии сопоставляем по этой строке, а не по id.
alter table watch_progress add column if not exists translation_title text;
