/**
 * Weazel News — конфигурация из переменных окружения.
 * Все остальные модули берут константы отсюда, а не читают process.env
 * напрямую — так весь список нужных переменных виден в одном месте
 * (см. также .env.example в корне проекта).
 */
'use strict';
require('dotenv').config();

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const PORT    = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ОШИБКА: DATABASE_URL не задан!');
  process.exit(1);
}

// SESSION_SECRET: если не задан явно — генерируем случайный при каждом
// старте процесса. Это работает, но означает, что ПОСЛЕ КАЖДОГО РЕДЕПЛОЯ
// все пользователи будут разлогинены (старые сессии подписаны предыдущим
// секретом). Чтобы это не происходило — задайте SESSION_SECRET явно в
// переменных окружения (один раз, любая длинная случайная строка).
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('ВНИМАНИЕ: SESSION_SECRET не задан — используется случайный ключ, сгенерированный при старте. Все пользователи будут разлогинены при следующем перезапуске/редеплое. Задайте SESSION_SECRET в переменных окружения, чтобы это исправить.');
}

const BCRYPT_ROUNDS = 12;

// Учётка администратора, создаваемая при первом запуске (см. initDB в db.js).
// Если ADMIN_EMAIL/ADMIN_PASSWORD не заданы явно — используются значения
// по умолчанию ниже. Это удобно для локальной разработки, но ПЕРЕД
// продовым деплоем настоятельно рекомендуется задать свои ADMIN_EMAIL и
// ADMIN_PASSWORD в переменных окружения — иначе в проде будет реально
// работать этот дефолтный логин/пароль.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'computer52552@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '098456964';
const ADMIN_NAME = process.env.ADMIN_NAME || 'degrees';
if (IS_PROD && (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD)) {
  console.warn('ВНИМАНИЕ: ADMIN_EMAIL и/или ADMIN_PASSWORD не заданы в проде — используются значения по умолчанию из кода. Рекомендуется задать свои в переменных окружения.');
}

// Cloudinary — постоянное хранилище для загруженных картинок (см.
// подробный комментарий в src/cloudinary.js). Если не настроен — сайт
// работает, но загруженные файлы теряются при каждом редеплое.
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || '';
const CLOUDINARY_API_KEY    = process.env.CLOUDINARY_API_KEY || '';
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET || '';
const CLOUDINARY_ENABLED    = !!(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);

// Google Apps Script (поиск свободных слотов для объявлений) — см. src/routes/booking.js.
const GOOGLE_APPS_SCRIPT_URL = process.env.GOOGLE_APPS_SCRIPT_URL;

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = {
  PORT, IS_PROD, DATABASE_URL, SESSION_SECRET, BCRYPT_ROUNDS,
  ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME,
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_ENABLED,
  GOOGLE_APPS_SCRIPT_URL,
  UPLOADS_DIR,
};
