/**
 * pm2-конфиг — держит сервис живым и перезапускает при аварийном росте
 * памяти (см. README.md про тесный RAM-бюджет VPS: 1 ГБ, из них уже занято
 * x-ui). max_memory_restart — защита от утечки памяти в самом Node/Chromium
 * со временем, а не штатный режим работы (в норме процесс укладывается в
 * заметно меньший бюджет).
 */
module.exports = {
  apps: [
    {
      name: 'mediawatch-extractor',
      script: 'src/server.js',
      cwd: __dirname,
      max_memory_restart: '600M',
      autorestart: true,
      restart_delay: 3000,
    },
  ],
};
