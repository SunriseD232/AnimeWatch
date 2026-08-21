#!/usr/bin/env bash
set -euo pipefail

# Разворачивает MediaWatch на продакшен-VPS (адрес/доступы — см. секреты
# деплоя, не в этом репозитории). Никакого CI/CD тут нет — пуш в origin/main
# сам по себе НЕ обновляет сайт, нужно зайти по SSH на сервер и прогнать этот
# скрипт вручную из корня проекта: bash scripts/deploy.sh
#
# Шаг с копированием public/ и .next/static — самый важный и самый
# незаметный при пропуске: next.config.js использует output: 'standalone',
# а Next.js в этом режиме НЕ копирует статику в .next/standalone сам по
# себе. Без этого шага сайт после рестарта PM2 стартует и отвечает
# HTML/JSON как ни в чём не бывало (маскирует проблему), но ВЕСЬ CSS/JS
# из /_next/static отдаёт 404 — сайт визуально превращается в голый
# неотформатированный HTML. Именно так это один раз и было пропущено при
# ручном деплое 2026-08-21 — отсюда этот скрипт.

cd "$(dirname "$0")/.."

echo "==> git pull origin main"
git pull origin main

echo "==> npm ci"
npm ci

echo "==> npm run build"
npm run build

echo "==> copying public/ and .next/static into .next/standalone"
rm -rf .next/standalone/public .next/standalone/.next/static
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

echo "==> pm2 restart mediawatch-web"
pm2 restart mediawatch-web

echo "==> done"
pm2 list
