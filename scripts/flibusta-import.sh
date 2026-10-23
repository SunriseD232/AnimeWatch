#!/usr/bin/env bash
# Еженедельный импорт каталога Флибусты из её SQL-дампов в book_index.
#
# Запуск — /etc/cron.d/mediawatch-reading (раз в неделю), вручную:
#   bash /opt/mediawatch/scripts/flibusta-import.sh
# Лог — /var/log/mediawatch-flibusta.log, итог — book_index_state
# (dump_imported_at, dump_books, dump_error; видно на /admin/status).
#
# Шаги:
#   1. Скачать 6 дампов (~350 МБ) с flibusta.is через VLESS-туннель — с этой
#      VPS Флибуста напрямую недоступна. flibusta.site — запасной: 23.10.2026
#      он отдавал дампы со скоростью ~1 КБ/с, а .is — за секунды.
#   2. scripts/flibusta-dump.mjs — потоково в TSV (только FB2/EPUB, без
#      удалённых, аннотации до 600 символов).
#   3. scripts/flibusta-merge.sql — COPY в Postgres и слияние одной
#      транзакцией. Дамп меньше 300 тыс. книг — откат, каталог не тронут.
#
# Флаг --dry-run: всё то же, но транзакция откатывается в конце — проверка
# без изменений в базе.

set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/mediawatch}"
WORK="${FLIBUSTA_WORK:-/var/tmp/flibusta-dump}"
LOG="${FLIBUSTA_LOG:-/var/log/mediawatch-flibusta.log}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
PROXY="${FLIBUSTA_PROXY:-socks5h://127.0.0.1:10808}"
MIRRORS=(https://flibusta.is https://flibusta.site)
FILES=(lib.libbook lib.libavtor lib.libavtorname lib.libgenre lib.libgenrelist lib.b.annotations)
MIN_FREE_GB=3
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

log() { echo "$(date '+%F %T') $*" >> "$LOG"; }
record_error() {
  local msg="${1//\'/\'\'}"
  docker exec "$DB_CONTAINER" psql -U postgres -d postgres -qc \
    "update book_index_state set dump_error = '$msg' where id" >/dev/null 2>&1 || true
}
cleanup() {
  rm -rf "$WORK"
  docker exec "$DB_CONTAINER" rm -rf /tmp/flibusta >/dev/null 2>&1 || true
}
fail() {
  log "ОШИБКА: $*"
  [ "$DRY_RUN" = 1 ] || record_error "$*"
  cleanup
  exit 1
}
trap 'fail "команда на строке $LINENO завершилась с ошибкой"' ERR

free_gb="$(df --output=avail -BG /var/tmp | tail -1 | tr -dc '0-9')"
[ "${free_gb:-0}" -ge "$MIN_FREE_GB" ] || fail "свободно ${free_gb} ГБ (< ${MIN_FREE_GB}) — импорт пропущен"

log "старт$([ "$DRY_RUN" = 1 ] && echo ' (dry-run)')"
rm -rf "$WORK"
mkdir -p "$WORK"

# ── 1. Скачать ──
for f in "${FILES[@]}"; do
  ok=0
  for m in "${MIRRORS[@]}"; do
    if curl -sf -m 900 -x "$PROXY" -o "$WORK/$f.sql.gz" "$m/sql/$f.sql.gz" && gzip -t "$WORK/$f.sql.gz" 2>/dev/null; then
      ok=1
      log "  $f.sql.gz: $(du -h "$WORK/$f.sql.gz" | cut -f1) с $m"
      break
    fi
    log "  $f.sql.gz: $m не отдал целый файл, пробую следующее зеркало"
  done
  [ "$ok" = 1 ] || fail "$f.sql.gz не скачался ни с одного зеркала"
done

# ── 2. TSV ──
node "$APP_DIR/scripts/flibusta-dump.mjs" "$WORK" >> "$LOG" 2>&1

# ── 3. В Postgres ──
docker exec "$DB_CONTAINER" rm -rf /tmp/flibusta
docker exec "$DB_CONTAINER" mkdir -p /tmp/flibusta
for t in book avtor avtorname genre genrelist annot; do
  docker cp "$WORK/$t.tsv" "$DB_CONTAINER:/tmp/flibusta/$t.tsv"
done
docker cp "$APP_DIR/scripts/flibusta-merge.sql" "$DB_CONTAINER:/tmp/flibusta/merge.sql"
# \copy читает файлы клиентом psql внутри контейнера — права на чтение.
docker exec "$DB_CONTAINER" chmod -R a+rX /tmp/flibusta
if [ "$DRY_RUN" = 1 ]; then
  docker exec "$DB_CONTAINER" sed -i 's/^commit;$/rollback;/' /tmp/flibusta/merge.sql
fi

result="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -qtA -f /tmp/flibusta/merge.sql 2>&1)" || fail "слияние: $(echo "$result" | tail -3 | tr '\n' ' ')"
log "  $(echo "$result" | tail -1)"

cleanup
log "готово$([ "$DRY_RUN" = 1 ] && echo ' (dry-run, транзакция откатена)')"
