# mediawatch-extractor — VPS-сервис извлечения (Alloha/Videoseed)

Автономный сервис вне Vercel — см. §12.6 ARCHITECTURE.md основного репозитория
за полную историю расследования и причину, почему он вообще понадобился
(serverless-песочница Vercel не проходит антибот источников; обычный
Puppeteer на VPS — единственная конфигурация, которая подтверждённо
срабатывала). Держит только этот один узкий эндпоинт — весь остальной сайт
(Vercel + Supabase) не трогаем.

## Шаг 1 — на VPS: системные зависимости для headless Chromium

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 \
  libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 libnspr4 libnss3 \
  libxcomposite1 libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 \
  xdg-utils
```

Node.js (если ещё не стоит — проверить `node -v`, нужен 18+):
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

## Шаг 2 — код на VPS

```bash
git clone https://github.com/SunriseD232/AnimeWatch.git /opt/mediawatch-extractor-src
cd /opt/mediawatch-extractor-src/vps-extractor
npm install
```

(качает `@sparticuz/chromium-min` — сам пакет маленький, архив Chromium
~65 МБ скачается один раз при ПЕРВОМ запросе на извлечение, в `/tmp` — не
при `npm install`.)

## Шаг 3 — конфиг

```bash
cp .env.example .env
```

Заполнить `.env`:
- `EXTRACTOR_AUTH_TOKEN` — любая случайная строка (`openssl rand -hex 32`) —
  её же потом вписать в Vercel как `VPS_EXTRACTOR_TOKEN`.
- `ALLOHA_PROXY_SERVER`/`ALLOHA_PROXY_USERNAME`/`ALLOHA_PROXY_PASSWORD` —
  те же значения, что уже стоят в Vercel.
- `VIDEOSEED_TOKEN`/`VIDEOSEED_HOST` — те же значения, что уже стоят в Vercel.

## Шаг 4 — запуск через pm2 (автоперезапуск + лимит памяти)

```bash
sudo npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # выполнить команду, которую он предложит, — автозапуск после ребута VPS
```

Проверка:
```bash
curl http://127.0.0.1:3300/health
# {"ok":true,"uptime":...}
```

## Шаг 5 — доступ снаружи (для Vercel)

Порт `3300` (или другой, если поменяли `PORT` в `.env`) должен быть
доступен из интернета — Vercel обращается к нему напрямую по IP/домену.

**Минимально** (без своего домена — этого хватит для начала, эндпоинт и так
защищён случайным токеном):
```bash
sudo ufw allow 3300/tcp
```
Тогда в Vercel указать `VPS_EXTRACTOR_URL=http://ВАШ_IP:3300`.

**Рекомендуется** (если на VPS уже есть домен/nginx — например, тот же,
что и для x-ui) — обернуть в HTTPS через nginx + Let's Encrypt, чтобы токен
не летал в открытом виде:
```nginx
server {
    listen 443 ssl;
    server_name extractor.ваш-домен.ru;
    ssl_certificate     /etc/letsencrypt/live/extractor.ваш-домен.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/extractor.ваш-домен.ru/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3300;
    }
}
```
(сертификат: `sudo certbot --nginx -d extractor.ваш-домен.ru`) — тогда в
Vercel `VPS_EXTRACTOR_URL=https://extractor.ваш-домен.ru`, порт 3300 наружу
НЕ открывать (`sudo ufw deny 3300/tcp`, только `127.0.0.1`).

## Если `@sparticuz/chromium-min` не пройдёт `/bnsi/` и на VPS

Значит дело не в serverless-песочнице Vercel, а в самом урезанном билде
Chromium. Следующий шаг — заменить на обычный `puppeteer` (полный пакет,
сам скачивает стандартный Chromium):
```bash
npm uninstall @sparticuz/chromium-min puppeteer-core
npm install puppeteer
```
и в `src/browser.js` заменить `launchBrowser()` на использование
`require('puppeteer').launch({ args: [...], headless: true })` без
`executablePath`/`chromium.args` — сообщите, помогу переписать.

## Логи и обслуживание

```bash
pm2 logs mediawatch-extractor    # живые логи
pm2 restart mediawatch-extractor # перезапуск вручную
pm2 monit                        # RAM/CPU в реальном времени — стоит последить
                                  # первые дни, бюджет памяти на VPS тесный
```
