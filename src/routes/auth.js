'use strict';
const express = require('express');
const crypto = require('crypto');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const config = require('../config');
const { safeUser } = require('../utils/helpers');
const { requireAuth, requireAdvertising } = require('../middleware/auth');
const { loginLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// Вход по почте/паролю УБРАН — Discord OAuth ниже единственный способ
// авторизации на сайте. /auth/login, /auth/register и /auth/password
// сознательно отсутствуют.
// ═══════════════════════════════════════════════════════════════════════

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

// Привязать свой аккаунт к сотруднику ростера (нужно для бронирования
// дежурств/смен — см. src/routes/roster.js: имя персонажа и Static ID
// при бронировании берутся из этой привязки, а не вводятся вручную).
// Доступно тем же ролям, что видят вкладку «Реклама» — остальным она не нужна.
router.put('/auth/me/employee', requireAdvertising, async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) {
      await query('UPDATE users SET employee_id=NULL WHERE id=$1', [req.user.id]);
      const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
      return res.json({ user: safeUser(r.rows[0]) });
    }
    const emp = await query('SELECT * FROM employees WHERE id=$1', [employee_id]);
    if (!emp.rows.length) return res.status(400).json({ error: 'Сотрудник не найден' });
    const taken = await query('SELECT id FROM users WHERE employee_id=$1 AND id<>$2', [employee_id, req.user.id]);
    if (taken.rows.length) return res.status(409).json({ error: 'Этот сотрудник уже привязан к другому аккаунту' });
    await query('UPDATE users SET employee_id=$1 WHERE id=$2', [employee_id, req.user.id]);
    const r = await query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    res.json({ user: safeUser(r.rows[0]) });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

// ═══════════════════════════════════════════════════════════════════════
// Авторизация через Discord (OAuth2, authorization-code flow) — ЕДИНСТВЕННЫЙ
// способ входа на сайт. Настройка — 3 переменные окружения, см.
// src/config.js и README.md («DISCORD OAUTH»).
//
// Запрашиваем scope "identify email", чтобы можно было один раз
// СВЯЗАТЬ уже существующий аккаунт (заведённый раньше, ещё при входе по
// почте/паролю — у него есть email и роль, но нет discord_id) с Discord
// по совпадению email. Это касается и самого первого администратора:
// начальный аккаунт по-прежнему создаётся в src/db.js по ADMIN_EMAIL
// (см. initDB) — просто войти в него теперь можно только через Discord-
// аккаунт с ТЕМ ЖЕ подтверждённым (verified) email.
// ═══════════════════════════════════════════════════════════════════════
router.get('/auth/discord', loginLimiter, (req, res) => {
  if (!config.DISCORD_ENABLED) {
    return res.status(500).send('Вход через Discord не настроен на сервере (не заданы DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET / DISCORD_REDIRECT_URI).');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.discordOAuthState = state;
  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: config.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify email',
    state,
    prompt: 'consent',
  });
  // Сохраняем state в сессии ДО редиректа, иначе на медленных дисках/БД
  // callback может прийти раньше, чем сессия физически запишется.
  req.session.save(() => {
    res.redirect('https://discord.com/oauth2/authorize?' + params.toString());
  });
});

router.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!config.DISCORD_ENABLED) return res.status(500).send('Вход через Discord не настроен на сервере.');
    const { code, state, error: oauthError } = req.query;
    if (oauthError) return res.redirect('/?discordError=' + encodeURIComponent('Вход отменён'));
    if (!code || !state || state !== req.session.discordOAuthState) {
      return res.redirect('/?discordError=' + encodeURIComponent('Сессия входа истекла, попробуйте ещё раз'));
    }
    delete req.session.discordOAuthState;

    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.DISCORD_CLIENT_ID,
        client_secret: config.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: config.DISCORD_REDIRECT_URI,
      }),
    });
    if (!tokenRes.ok) return res.redirect('/?discordError=' + encodeURIComponent('Discord отклонил запрос авторизации'));
    const tokenData = await tokenRes.json();

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!meRes.ok) return res.redirect('/?discordError=' + encodeURIComponent('Не удалось получить данные аккаунта Discord'));
    const me = await meRes.json();

    const discordId = String(me.id);
    const displayName = (me.global_name || me.username || 'Discord User').toString().trim().slice(0, 40) || 'Discord User';
    const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${me.avatar}.png` : '';
    const discordEmail = (me.verified && me.email) ? String(me.email).trim().toLowerCase() : null;

    let userId;
    const byDiscord = await query('SELECT * FROM users WHERE discord_id=$1', [discordId]);
    if (byDiscord.rows.length) {
      // Уже входили через Discord раньше — просто обновляем данные.
      userId = byDiscord.rows[0].id;
      await query('UPDATE users SET discord_username=$1, discord_avatar=$2, last_login=NOW() WHERE id=$3', [me.username || '', avatar, userId]);
    } else if (discordEmail) {
      // Первый вход через Discord — ищем СУЩЕСТВУЮЩИЙ аккаунт (заведённый
      // ещё при входе по почте/паролю, до перехода на Discord OAuth) с
      // тем же email и ещё не привязанный ни к какому Discord-аккаунту.
      // Найден — связываем и сохраняем его прежнюю роль/историю. Не
      // найден — заводим нового «Гостя», как раньше.
      const byEmail = await query('SELECT * FROM users WHERE email=$1 AND discord_id IS NULL', [discordEmail]);
      if (byEmail.rows.length) {
        userId = byEmail.rows[0].id;
        await query('UPDATE users SET discord_id=$1, discord_username=$2, discord_avatar=$3, last_login=NOW() WHERE id=$4', [discordId, me.username || '', avatar, userId]);
      }
    }
    if (!userId) {
      userId = uuid();
      await query(
        'INSERT INTO users (id,name,email,pwd_hash,role,discord_id,discord_username,discord_avatar,last_login) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())',
        [userId, displayName, discordEmail, null, 'guest', discordId, me.username || '', avatar]
      );
    }

    req.session.regenerate(err => {
      if (err) return res.redirect('/?discordError=' + encodeURIComponent('Ошибка сессии'));
      req.session.userId = userId;
      res.redirect('/');
    });
  } catch (e) {
    console.error('Discord OAuth error:', e.message);
    res.redirect('/?discordError=' + encodeURIComponent('Ошибка входа через Discord'));
  }
});

module.exports = router;
