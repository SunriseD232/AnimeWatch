-- MediaWatch — миграция 0016: заглушить уведомления по конкретному тайтлу
-- Раньше уведомления о новых сериях (см. api/cron/check-episodes) были
-- "все или ничего" — нельзя было выключить конкретный шумный тайтл, не убирая
-- его целиком из "Смотрю".

alter table user_list
  add column if not exists muted boolean not null default false;
