-- Небольшое key-value хранилище для переключаемых вручную настроек —
-- сейчас только relay через VPS (см. lib/settings.ts, lib/extract/proxy.ts),
-- но таблица общая, не завязана на конкретный ключ.
create table if not exists app_settings (
  key text primary key,
  value boolean not null,
  updated_at timestamptz not null default now()
);

insert into app_settings (key, value)
values ('vps_relay_enabled', true)
on conflict (key) do nothing;

-- Тот же паттерн, что и resolved_streams/subtitle_cache: без единой policy —
-- читает/пишет только серверный код через service_role (проверка "админ ли
-- это" — в нашем коде, см. lib/admin.ts, не в RLS).
alter table app_settings enable row level security;
