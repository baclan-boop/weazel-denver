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

initDB()
  .then(() => { app.listen(config.PORT, '0.0.0.0', () => console.log(`Weazel News: http://localhost:${config.PORT}`)); })
  .catch(e => { console.error('Ошибка запуска:', e.message); process.exit(1); });
