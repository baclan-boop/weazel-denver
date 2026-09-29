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

// Учётка администратора, создаваемая при первом запуске (см. initDB в db.js).
// Входа по паролю на сайте больше нет — единственный способ войти
// (в том числе в этот самый начальный аккаунт) — через Discord OAuth
// ниже. Поэтому пароль этой учётке больше не нужен: initDB заводит её
// сразу с ADMIN_EMAIL и БЕЗ пароля (pwd_hash = NULL), а войти в неё
// получится, когда кто-то авторизуется через Discord-аккаунт с ТЕМ ЖЕ
// подтверждённым (verified) email — см. подробности в src/routes/auth.js
// (там аккаунт по email автоматически привяжется к Discord при первом входе).
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@localhost';
const ADMIN_NAME = process.env.ADMIN_NAME || 'degrees';
if (!process.env.ADMIN_EMAIL) {
  console.warn('ВНИМАНИЕ: ADMIN_EMAIL не задан — начальный администратор будет создан с email admin@localhost, войти в него будет некому (Discord-аккаунтов с таким email не бывает). Задайте ADMIN_EMAIL в переменных окружения — тот email, который подтверждён (verified) на ВАШЕМ Discord-аккаунте, чтобы именно вы получили роль Администратора при первом входе через Discord.');
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

// Авторизация через Discord (OAuth2) — см. src/routes/auth.js
// (GET /api/auth/discord, /api/auth/discord/callback). ЕДИНСТВЕННЫЙ способ
// входа на сайт — обычного входа по почте/паролю больше нет.
// Как получить эти 3 переменные — см. ШАГ «DISCORD OAUTH» в README.md.
// DISCORD_REDIRECT_URI должен быть ПОЛНЫМ адресом (со схемой https:// и
// доменом сайта), например https://weazel-news.onrender.com/api/auth/discord/callback,
// и должен быть добавлен в Discord Developer Portal → OAuth2 → Redirects
// СИМВОЛ В СИМВОЛ (включая /api/auth/discord/callback в конце).
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || '';
const DISCORD_ENABLED = !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_REDIRECT_URI);
if (!DISCORD_ENABLED) {
  console.warn('═══════════════════════════════════════════════════════════════');
  console.warn('ВНИМАНИЕ: вход через Discord НЕ настроен (не заданы');
  console.warn('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI).');
  console.warn('Входа по почте/паролю на сайте больше нет — пока эти переменные');
  console.warn('не заданы, войти на сайт НИКТО НЕ СМОЖЕТ. См. ШАГ «DISCORD OAUTH» в README.md.');
  console.warn('═══════════════════════════════════════════════════════════════');
}

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Self-ping — бесплатный инстанс на Render засыпает примерно после 15
// минут без единого входящего запроса, а после сна первый посетитель
// ждёт долгий "холодный старт". Чтобы сайт не засыпал, он сам себе
// раз в 14 минут делает обычный GET-запрос (см. запуск в server.js).
// Работает ТОЛЬКО в проде (NODE_ENV=production) — иначе локальная
// разработка или локальные тесты долбили бы боевой адрес почём зря.
// Задать другой адрес — SELF_PING_URL; выключить совсем — SELF_PING_ENABLED=false;
// включить принудительно вне прода — SELF_PING_ENABLED=true.
const SELF_PING_URL = process.env.SELF_PING_URL || 'https://wn-dn.onrender.com/';
const SELF_PING_ENABLED = process.env.SELF_PING_ENABLED
  ? process.env.SELF_PING_ENABLED === 'true'
  : IS_PROD;

module.exports = {
  PORT, IS_PROD, DATABASE_URL, SESSION_SECRET,
  ADMIN_EMAIL, ADMIN_NAME,
  CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_ENABLED,
  GOOGLE_APPS_SCRIPT_URL,
  UPLOADS_DIR,
  DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DISCORD_ENABLED,
  SELF_PING_URL, SELF_PING_ENABLED,
};
