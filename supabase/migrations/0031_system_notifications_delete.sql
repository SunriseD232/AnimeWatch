-- MediaWatch — миграция 0031: удаление системных уведомлений владельцем
--
-- В списке уведомлений появился крестик «убрать это». У episode_notifications
-- политика на delete была с самого начала (миграция 0005), а у системных —
-- только select и update: их никто не удалял, потому что и кнопки не было.
-- Без этой политики крестик молча ничего не делал бы у половины списка.

drop policy if exists "own system notifications delete" on system_notifications;

create policy "own system notifications delete" on system_notifications
  for delete using (auth.uid() = user_id);

grant delete on system_notifications to authenticated;
