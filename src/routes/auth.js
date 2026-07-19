'use strict';
const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const config = require('../config');
const { hashIP, safeUser } = require('../utils/helpers');
const { requireAuth } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/auth/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    const ipHash = hashIP(req.ip);
    const att = await query('SELECT * FROM login_attempts WHERE ip_hash=$1', [ipHash]);
    const attempt = att.rows[0];
    if (attempt?.locked_until && new Date(attempt.locked_until) > new Date()) {
      const secs = Math.ceil((new Date(attempt.locked_until) - Date.now()) / 1000);
      return res.status(429).json({ error: `Заблокировано. Подождите ${secs} сек.` });
    }
    const r = await query('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const user = r.rows[0];
    const hashToCheck = user?.pwd_hash || '$2b$12$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const match = await bcrypt.compare(password, hashToCheck);
    if (!user || !match) {
      const nc = (attempt?.count || 0) + 1;
      const lock = nc >= 5 ? new Date(Date.now() + 60000).toISOString() : null;
      await query('INSERT INTO login_attempts (ip_hash,count,locked_until) VALUES ($1,$2,$3) ON CONFLICT (ip_hash) DO UPDATE SET count=$2,locked_until=$3', [ipHash, nc, lock]);
      return res.status(401).json({ error: 'Неверная почта или пароль' });
    }
    await query('DELETE FROM login_attempts WHERE ip_hash=$1', [ipHash]);
    await query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Ошибка сессии' });
      req.session.userId = user.id;
      res.json({ user: safeUser(user) });
    });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/auth/register', loginLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: 'Заполните все поля' });
    if (password.length < 6) return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Некорректный email' });
    const ex = await query('SELECT id FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    if (ex.rows.length) return res.status(409).json({ error: 'Email уже используется' });
    const hash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    const id = uuid();
    await query('INSERT INTO users (id,name,email,pwd_hash,role) VALUES ($1,$2,$3,$4,$5)', [id, name.trim(), email.trim().toLowerCase(), hash, 'guest']);
    const r = await query('SELECT * FROM users WHERE id=$1', [id]);
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Ошибка сессии' });
      req.session.userId = id; res.json({ user: safeUser(r.rows[0]) });
    });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

router.post('/auth/logout', (req, res) => { req.session.destroy(() => res.json({ ok: true })); });
router.get('/auth/me', async (req, res) => { if (!req.session?.userId) return res.json({ user: null }); try { const r = await query('SELECT * FROM users WHERE id=$1', [req.session.userId]); res.json({ user: safeUser(r.rows[0]) || null }); } catch { res.json({ user: null }); } });

// Изменить собственный ник (имя/фамилию персонажа) — доступно любому
// авторизованному пользователю, только для своего же аккаунта.
router.put('/auth/me', requireAuth, async (req, res) => {
  try {
    let { name } = req.body;
    name = (name || '').trim().replace(/\s+/g, ' ');
    if (!name) return res.status(400).json({ error: 'Введите имя' });
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Имя должно быть от 2 до 40 символов' });
    await query('UPDATE users SET name=$1 WHERE id=$2', [name, req.user.id]);
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ user: safeUser(r.rows[0]) });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// Смена пароля самим пользователем (пока залогинен) — этим же путём
// пользователь меняет временный пароль, который ему выдал администратор
// через «Сбросить пароль» в разделе Пользователи (см. POST
// /api/users/:id/reset-password в src/routes/users.js). Требуем текущий
// пароль — защита на случай, если сессия осталась открытой на чужом/общем компьютере.
router.put('/auth/password', requireAuth, loginLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Заполните все поля' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Новый пароль минимум 6 символов' });

    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = r.rows[0];
    const ok = await bcrypt.compare(currentPassword, user.pwd_hash);
    if (!ok) return res.status(400).json({ error: 'Текущий пароль указан неверно' });

    const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await query('UPDATE users SET pwd_hash=$1 WHERE id=$2', [hash, user.id]);
    res.json({ ok: true });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
