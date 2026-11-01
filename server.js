/**
 * Weazel News — Majestic RP
 * Render.com + Neon PostgreSQL (без карты)
 *
 * Точка входа: инициализирует схему БД и поднимает HTTP-сервер.
 * Вся остальная логика разложена по src/ (см. README.md → «Структура проекта»):
 *   src/config.js         — переменные окружения и константы
 *   src/db.js             — подключение к Postgres, схема, миграции
 *   src/app.js            — сборка Express-приложения и middleware
 *   src/cloudinary.js     — загрузка изображений в облако
 *   src/middleware/       — авторизация (роли), rate-limit
 *   src/utils/            — общие хелперы (журнал изменений, расписание слотов, контракты)
 *   src/routes/           — роуты по разделам (auth, users, news, contracts, ...)
 */
'use strict';
const config = require('./src/config');
const { initDB } = require('./src/db');
const app = require('./src/app');

// ПОСЛЕДНЯЯ ЛИНИЯ ЗАЩИТЫ (не основной фикс — основные см. в src/db.js
// pool.on('error') и src/app.js require('express-async-errors')).
// Раньше в проекте не было НИ ОДНОГО такого обработчика, поэтому любая
// необработанная ошибка (reject промиса вне цикла запроса Express, редкий
// сбой в стороннем пакете и т.п.) по умолчанию в Node.js завершает весь
// процесс — сайт полностью падал для всех текущих посетителей разом, пока
// хостинг не перезапустит контейнер. Логируем и НЕ рушим процесс: для
// простого HTTP API это безопаснее, чем внезапный полный даунтайм.
process.on('unhandledRejection', (reason) => {
  console.error('Необработанный reject промиса (процесс не завершается):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение (процесс не завершается):', err.stack || err);
});

initDB()
  .then(() => {
    app.listen(config.PORT, '0.0.0.0', () => console.log(`Weazel News: http://localhost:${config.PORT}`));
    startSelfPing();
  })
  .catch(e => { console.error('Ошибка запуска:', e.message); process.exit(1); });

// Self-ping (см. комментарий в src/config.js) — не даёт бесплатному
// инстансу на Render уснуть от простоя. Каждые 14 минут сам себе делает
// обычный GET-запрос; результат только логируется, ни на что не влияет —
// сбой запроса (например, кратковременная сетевая ошибка) не должен
// останавливать таймер и тем более ронять процесс.
//
// Тихие часы: с 01:00 до 12:00 по Москве пинг НЕ отправляется — в это
// время сайт может спокойно засыпать (экономия часов Render). Границы
// меняются константами QUIET_FROM_HOUR / QUIET_TO_HOUR ниже.
const QUIET_FROM_HOUR = 1;   // включительно: с 01:00 МСК
const QUIET_TO_HOUR = 12;    // не включительно: до 12:00 МСК

function mskHour() {
  // Москва — UTC+3 без перехода на летнее время; берём час через Intl,
  // чтобы не зависеть от часового пояса сервера.
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Moscow', hour: '2-digit', hour12: false,
  }).format(new Date());
  return parseInt(h, 10) % 24;
}

function isQuietHours() {
  const h = mskHour();
  return h >= QUIET_FROM_HOUR && h < QUIET_TO_HOUR;
}

function startSelfPing() {
  if (!config.SELF_PING_ENABLED) return;
  const INTERVAL_MS = 14 * 60 * 1000;
  const ping = () => {
    if (isQuietHours()) return; // тихие часы — просто пропускаем тик
    fetch(config.SELF_PING_URL)
      .then(r => console.log(`[self-ping] ${new Date().toISOString()} ${config.SELF_PING_URL} → ${r.status}`))
      .catch(e => console.warn(`[self-ping] ${new Date().toISOString()} ошибка: ${e.message}`));
  };
  setInterval(ping, INTERVAL_MS);
  console.log(`Self-ping включён: каждые 14 минут → ${config.SELF_PING_URL} (пауза ${String(QUIET_FROM_HOUR).padStart(2,'0')}:00–${QUIET_TO_HOUR}:00 МСК)`);
}
