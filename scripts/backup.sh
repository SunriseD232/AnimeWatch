#!/usr/bin/env bash
# Ежедневный локальный бэкап MediaWatch на VPS.
#
# Ставится в /usr/local/bin/mediawatch-backup.sh и запускается из
# /etc/cron.d/mediawatch-backup (см. README → «Бэкапы»). Что копирует:
#
#   globals.sql        — роли и их права (pg_dumpall --globals-only): без
#                        них дамп базы не восстановить, в Supabase десяток
#                        своих ролей (authenticator, anon, supabase_auth_admin…).
#   postgres.dump      — вся база postgres (pg_dump -Fc): auth, public,
#                        storage и остальные схемы. Формат custom — сжат и
#                        восстанавливается выборочно (pg_restore -t/-n).
#   _supabase.dump     — служебная база Supabase (аналитика, несколько МБ).
#   files.tar.zst      — аватары, сохранённые книги и оба .env. .env нужен:
#                        без JWT-секрета восстановленная база не примет ключи,
#                        с которыми живут сайт и клиенты.
#
# Кэши (обложки, фоны) не копируем: они качаются заново.
#
# Почему именно так:
#   • дамп снимается под supabase_admin — в Supabase у postgres нет прав
#     суперпользователя, и схему auth он целиком не прочитал бы;
#   • сайт и база при этом работают: pg_dump читает снимок, не блокируя
#     запись;
#   • каждая копия проверяется (pg_restore --list, tar -t) — бэкап, который
#     нельзя прочитать, хуже, чем никакого: он создаёт ложное спокойствие;
#   • при свободном месте меньше MIN_FREE_GB бэкап не делается: иначе он сам
#     мог бы заполнить диск и уронить сайт с базой.
#
# Хранение: 7 последних ежедневных копий плюс воскресные за 4 недели.
#
# Важно: копии лежат на ТОМ ЖЕ диске. От ошибки, испорченной миграции или
# случайного удаления они спасают, от потери сервера — нет. Внешняя копия —
# отдельная задача.

set -Eeuo pipefail
umask 077

BACKUP_ROOT="${BACKUP_ROOT:-/var/backups/mediawatch}"
LOG="${BACKUP_LOG:-/var/log/mediawatch-backup.log}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
MIN_FREE_GB="${MIN_FREE_GB:-3}"
KEEP_DAILY_DAYS=7
KEEP_WEEKLY_DAYS=28

DAY="$(date +%F)"
DIR="$BACKUP_ROOT/$DAY"

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
fail() { log "ОШИБКА: $*"; exit 1; }
trap 'fail "команда на строке $LINENO завершилась с ошибкой"' ERR

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

free_gb="$(df --output=avail -BG "$BACKUP_ROOT" | tail -1 | tr -dc '0-9')"
if [ "${free_gb:-0}" -lt "$MIN_FREE_GB" ]; then
  fail "свободно ${free_gb} ГБ (< ${MIN_FREE_GB}) — бэкап пропущен, чтобы не заполнить диск"
fi

log "старт → $DIR (свободно ${free_gb} ГБ)"
# Повторный запуск в тот же день пересобирает копию дня с нуля.
rm -rf "$DIR.partial"
mkdir -p "$DIR.partial"

# ── База ──
docker exec "$DB_CONTAINER" pg_dumpall -U supabase_admin --globals-only \
  > "$DIR.partial/globals.sql"
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d postgres -Fc -Z 6 \
  > "$DIR.partial/postgres.dump"
docker exec "$DB_CONTAINER" pg_dump -U supabase_admin -d _supabase -Fc -Z 6 \
  > "$DIR.partial/_supabase.dump"

# Проверка: оглавление дампа читается целиком.
for dump in postgres _supabase; do
  entries="$(docker exec -i "$DB_CONTAINER" pg_restore --list < "$DIR.partial/$dump.dump" | grep -vc '^;')"
  [ "$entries" -gt 0 ] || fail "$dump.dump пустой или не читается"
done
grep -q 'CREATE ROLE' "$DIR.partial/globals.sql" || fail "globals.sql без ролей"

# ── Файлы ──
paths=()
for p in opt/mediawatch/avatars opt/mediawatch/books opt/mediawatch/.env opt/supabase/docker/.env; do
  [ -e "/$p" ] && paths+=("$p")
done
tar -C / --zstd -cf "$DIR.partial/files.tar.zst" "${paths[@]}"
tar -C / --zstd -tf "$DIR.partial/files.tar.zst" > /dev/null

# Копия дня готова целиком — только теперь подменяем прошлую за этот день.
rm -rf "$DIR"
mv "$DIR.partial" "$DIR"

# ── Хранение ──
now="$(date +%s)"
for old in "$BACKUP_ROOT"/????-??-??; do
  [ -d "$old" ] || continue
  day="$(basename "$old")"
  age_days=$(( (now - $(date -d "$day" +%s)) / 86400 ))
  weekday="$(date -d "$day" +%u)" # 7 = воскресенье
  if [ "$age_days" -ge "$KEEP_DAILY_DAYS" ] && { [ "$weekday" != 7 ] || [ "$age_days" -ge "$KEEP_WEEKLY_DAYS" ]; }; then
    rm -rf "$old"
    log "удалена старая копия $day"
  fi
done
# Обрывки упавших прогонов прошлых дней.
find "$BACKUP_ROOT" -maxdepth 1 -name '*.partial' ! -name "$DAY.partial" -exec rm -rf {} +

log "готово: $(du -sh "$DIR" | cut -f1) — $(cd "$DIR" && du -h ./* | awk '{printf "%s %s; ", $2, $1}')"
