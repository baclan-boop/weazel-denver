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
// ВАЖНО: раньше здесь стоял ФИКСИРОВАННЫЙ пароль прямо в коде. Это серьёзная
// дыра — такой пароль виден каждому, у кого есть исходники (архив, репозиторий
// на GitHub и т.п.), то есть потенциально кому угодно, а не только владельцу
// сайта. Теперь, если ADMIN_EMAIL/ADMIN_PASSWORD не заданы явно в переменных
// окружения, вместо фиксированного значения генерируется СЛУЧАЙНЫЙ пароль при
// каждом старте процесса (тот же приём, что и для SESSION_SECRET выше) и
// печатается в лог — заберите его оттуда при первом запуске.
// ЕСЛИ САЙТ УЖЕ РАБОТАЕТ И АДМИН-АККАУНТ УЖЕ СОЗДАН СТАРЫМ КОДОМ: этот фикс
// не меняет пароль у уже существующей учётки в базе (initDB создаёт админа,
// только если его ещё нет) — обязательно смените пароль вручную через
// профиль на самом сайте (см. PUT /api/auth/password), это не заменяет
// правку кода, а дополняет её.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@localhost';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const ADMIN_NAME = process.env.ADMIN_NAME || 'degrees';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('═══════════════════════════════════════════════════════════════');
  console.warn('ВНИМАНИЕ: ADMIN_PASSWORD не задан — сгенерирован случайный пароль');
  console.warn('для НОВОГО администратора (если он ещё не создан в базе):');
  console.warn('  Email:  ' + ADMIN_EMAIL);
  console.warn('  Пароль: ' + ADMIN_PASSWORD);
  console.warn('Задайте ADMIN_EMAIL и ADMIN_PASSWORD в переменных окружения,');
  console.warn('иначе при каждом перезапуске будет новый случайный пароль.');
  console.warn('═══════════════════════════════════════════════════════════════');
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
