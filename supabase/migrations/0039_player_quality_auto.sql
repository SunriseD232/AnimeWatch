-- К вариантам качества добавилось «авто» (плеер сам подбирает под скорость),
-- а smallint такое значение не вмещает. Колонка из 0038 переезжает в text.
--
-- Данных в ней практически нет (появилась в тот же день), поэтому перевод
-- типа безопасен: числа превращаются в '480'/'720'/'1080', null остаётся
-- null. Никаких пересчётов на стороне кода не нужно — normalizeQuality
-- (lib/playerQuality.ts) и так приводит и строку, и число.

alter table profiles
  drop constraint if exists profiles_preferred_quality_check;

alter table profiles
  alter column preferred_quality type text using preferred_quality::text;

alter table profiles
  add constraint profiles_preferred_quality_check
  check (preferred_quality is null or preferred_quality in ('auto', '480', '720', '1080'));
