#!/usr/bin/env bash
set -euo pipefail

# Разворачивает MediaWatch на продакшен-VPS (адрес/доступы — см. секреты
# деплоя, не в этом репозитории). Никакого CI/CD тут нет — пуш в origin/main
# сам по себе НЕ обновляет сайт, нужно зайти по SSH на сервер и прогнать этот
# скрипт вручную из корня проекта: bash scripts/deploy.sh
#
# ГЛАВНОЕ СВОЙСТВО: живой сайт не трогается, пока новая сборка не готова
# целиком. Раньше скрипт собирал прямо в .next, а `next build` первым делом
# СТИРАЕТ этот каталог вместе с .next/standalone, из которого работает сайт.
# Любая упавшая или зависшая сборка означала лежащий прод: HTML ещё отдавался
# с открытых inode'ов процессов PM2 и вводил в заблуждение кодом 200, а весь
# CSS и JS отвечали 500. Так и случилось 2026-09-09, дважды.
#
# Теперь сборка идёт в отдельный каталог, а .next становится симлинком на
# него — переключение атомарно (ln -sfn через временное имя + mv), откат
# делается тем же переключением на прошлый каталог.

cd "$(dirname "$0")/.."

ROOT="$(pwd)"
RELEASES="$ROOT/.releases"
STAMP="$(date +%Y%m%d-%H%M%S)"
# ОТНОСИТЕЛЬНЫЙ путь — принципиально. Next воспроизводит distDir ВНУТРИ
# standalone-вывода как есть: при distDir=.releases/<метка> серверный
# server.js ищет свои манифесты в ./.releases/<метка>/ относительно
# собственного каталога. С абсолютным путём эта вложенность стала бы
# /opt/mediawatch/... внутри standalone, и сборка не нашла бы саму себя.
REL_DIST=".releases/$STAMP"
BUILD_DIR="$ROOT/$REL_DIST"

echo "==> git pull origin main"
BEFORE="$(git rev-parse HEAD)"
git pull origin main
AFTER="$(git rev-parse HEAD)"

# Скрипт обновляет сам себя. Bash читает файл ПО МЕРЕ выполнения, и подмена
# на лету даёт в лучшем случае старое поведение, в худшем — выполнение
# случайного куска нового файла со сдвигом по смещению. Наступил на это
# вживую: первый прогон после правки молча отработал прежней версией.
# Поэтому: если pull что-то принёс и файл изменился — перезапускаем себя
# заново уже новым содержимым, ровно один раз (флаг через переменную).
if [ "$BEFORE" != "$AFTER" ] && [ "${DEPLOY_REEXECED:-}" != "1" ]; then
  if ! git diff --quiet "$BEFORE" "$AFTER" -- "$0"; then
    echo "==> скрипт деплоя обновился — перезапускаю себя новой версией"
    DEPLOY_REEXECED=1 exec bash "$0" "$@"
  fi
fi

echo "==> npm ci"
npm ci

# distDir задаётся переменной окружения (см. next.config.js) — так `next build`
# кладёт результат мимо живого .next и ничего не стирает.
echo "==> npm run build (в $BUILD_DIR)"
mkdir -p "$RELEASES"
NEXT_DIST_DIR="$REL_DIST" npm run build

# Проверка вменяемости до переключения: без server.js standalone не стартует,
# без .next/static сайт поднимется, но отдаст весь CSS/JS в 404 — визуально
# это голый неотформатированный HTML. Ровно так однажды и выкатили.
echo "==> проверка собранного"
test -f "$BUILD_DIR/standalone/server.js" || { echo "нет standalone/server.js"; exit 1; }
test -d "$BUILD_DIR/static" || { echo "нет static"; exit 1; }

# next.config.js использует output: 'standalone', а Next в этом режиме НЕ
# копирует статику и public/ внутрь standalone сам.
# Статика кладётся по ТОМУ ЖЕ относительному пути, что и остальной вывод
# внутри standalone (см. REL_DIST выше) — server.js ищет её именно там, а не
# в .next/static.
echo "==> копирую public/ и static внутрь standalone"
rm -rf "$BUILD_DIR/standalone/public" "$BUILD_DIR/standalone/$REL_DIST/static"
mkdir -p "$BUILD_DIR/standalone/$REL_DIST"
cp -r public "$BUILD_DIR/standalone/public"
cp -r "$BUILD_DIR/static" "$BUILD_DIR/standalone/$REL_DIST/static"

# node-wreq (см. lib/extract/proxy.ts — обходит фингерпринт-блокировку
# vkvideo.cloud/Alloha): платформенный суб-пакет выбирается ДИНАМИЧЕСКИ в
# рантайме по process.platform/arch, статический анализ трассировщика его не
# находит. Без этого шага раздача байт с vkvideo.cloud падает, хотя всё
# остальное деплоится как ни в чём не бывало.
echo "==> копирую нативный бинарник node-wreq"
mkdir -p "$BUILD_DIR/standalone/node_modules/@node-wreq"
cp -r node_modules/@node-wreq/linux-x64-gnu "$BUILD_DIR/standalone/node_modules/@node-wreq/"

# Атомарное переключение: симлинк создаётся под временным именем и
# переименовывается поверх старого. mv симлинка в пределах одной ФС —
# атомарная операция, промежуточного состояния «каталога .next нет» не
# возникает даже на долю секунды.
echo "==> переключаю .next на новую сборку"
PREV_TARGET=""
if [ -L "$ROOT/.next" ]; then
  PREV_TARGET="$(readlink -f "$ROOT/.next" || true)"
elif [ -d "$ROOT/.next" ]; then
  # Первый запуск после перехода на симлинки: убираем настоящий каталог.
  echo "    (.next был обычным каталогом — переношу в $RELEASES/legacy)"
  rm -rf "$RELEASES/legacy"
  mv "$ROOT/.next" "$RELEASES/legacy"
fi
ln -sfn "$BUILD_DIR" "$ROOT/.next.tmp"
mv -T "$ROOT/.next.tmp" "$ROOT/.next"

echo "==> pm2 restart mediawatch-web"
pm2 restart mediawatch-web

# Дым-тест уже переключенного сайта. Если он не отвечает — откатываемся на
# прошлую сборку тем же переключением. Без этого упавший старт PM2 оставлял
# бы сайт лежать до ручного вмешательства.
echo "==> дым-тест"
sleep 4
CODE=""
for i in 1 2 3 4 5 6 7 8 9 10; do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' -m 10 http://127.0.0.1:3000/login || true)"
  [ "$CODE" = "200" ] && break
  sleep 2
done

if [ "$CODE" != "200" ]; then
  echo "!! сайт отвечает $CODE"
  if [ -n "$PREV_TARGET" ] && [ -d "$PREV_TARGET" ]; then
    echo "!! откатываюсь на $PREV_TARGET"
    ln -sfn "$PREV_TARGET" "$ROOT/.next.tmp"
    mv -T "$ROOT/.next.tmp" "$ROOT/.next"
    pm2 restart mediawatch-web
    echo "!! откат выполнен, разбирайтесь со сборкой $BUILD_DIR"
  else
    echo "!! откатываться не на что (прошлой сборки нет)"
  fi
  exit 1
fi

# Держим три последние сборки: одна живая, одна на откат, одна про запас.
# Каждая — около 400 МБ, копить их бесконечно на 77-гигабайтном диске не надо.
echo "==> убираю старые сборки (оставляю 3)"
ls -1dt "$RELEASES"/*/ 2>/dev/null | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$(readlink -f "$ROOT/.next")" ] && continue
  echo "    удаляю $old"
  rm -rf "$old"
done

echo "==> done ($CODE)"
pm2 list
