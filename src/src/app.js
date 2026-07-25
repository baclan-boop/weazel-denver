/**
 * Weazel News — сборка Express-приложения: middleware безопасности,
 * сессии, статика и подключение всех роутеров.
 */
'use strict';
const express   = require('express');
// express-async-errors: патчит роутинг Express 4 так, чтобы reject
// промиса ИЛИ throw внутри async-обработчика (или async-мидлвары вроде
// requireAuth) автоматически улетал в наш финальный error-handler ниже
// вместо того, чтобы остаться "необработанным reject" — в Express 4 (в
// отличие от 5) это не ловится из коробки. Именно необработанные reject
// в роутах без try/catch (GET /api/settings, /api/team, /api/services,
// /api/editorial, /api/users, requireAuth и т.д. — при ошибке БД,
// например при "пробуждении" Neon/Render из спячки) роняли ВЕСЬ
// Node-процесс, из-за чего "падал" сразу весь сайт целиком у случайных
// посетителей. Строка ниже — единая точка фикса для всех роутов сразу,
// включая любые новые, которые добавят в будущем без try/catch.
require('express-async-errors');
const path      = require('path');
const helmet    = require('helmet');
const session   = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const config = require('./config');
const { pool } = require('./db');
const { apiLimiter } = require('./middleware/rateLimiters');

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // ВАЖНО: script-src-attr — отдельная директива от script-src.
      // Helmet по умолчанию ставит её в 'none', что блокирует ВСЕ
      // onclick="..." и подобные атрибуты, даже если script-src разрешает
      // unsafe-inline. Наш сайт построен на onclick-атрибутах — разрешаем явно.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
      frameSrc: ["'self'", "https://online.fliphtml5.com", "https://www.youtube.com", "https://player.vimeo.com"],
      connectSrc: ["'self'"],
    }
  }, crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: config.SESSION_SECRET, resave: false, saveUninitialized: false, name: '__wn_sid',
  cookie: { httpOnly: true, secure: config.IS_PROD, sameSite: 'strict', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use('/api/', apiLimiter);

// Загруженные картинки, если Cloudinary не настроен (см. src/cloudinary.js
// и src/routes/upload.js) — раздаём напрямую с диска.
app.use('/uploads', express.static(config.UPLOADS_DIR));

app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/users'));
app.use('/api', require('./routes/employees'));
app.use('/api', require('./routes/contracts'));
app.use('/api', require('./routes/bonuses'));
app.use('/api', require('./routes/booking'));
app.use('/api', require('./routes/upload'));
app.use('/api', require('./routes/news'));
app.use('/api', require('./routes/services'));
app.use('/api', require('./routes/team'));
app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/visitors'));
app.use('/api', require('./routes/editLogs'));
app.use('/api', require('./routes/editorial'));

// FRONTEND
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Файл слишком большой (макс. 15MB)' });
  // Полный стек в логи (Render → Logs) — раньше писался только err.message,
  // из-за чего в логах было не видно, где именно произошла ошибка.
  console.error('Ошибка запроса', req.method, req.originalUrl, ':', err.stack || err.message || err);
  // Если ответ уже начали отправлять — по правилам Express дальше можно
  // только передать ошибку дальше, повторный res.status()/res.json() кинет
  // ещё одно (уже синхронное) исключение.
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Ошибка сервера. Обновите страницу через несколько секунд.' });
});

module.exports = app;
