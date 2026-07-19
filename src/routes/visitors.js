'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { hashIP } = require('../utils/helpers');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// VISITORS
router.post('/visitors', async (req, res) => { try { const { page } = req.body; let name = 'Гость'; if (req.session?.userId) { const r = await query('SELECT name FROM users WHERE id=$1', [req.session.userId]); name = r.rows[0]?.name || 'Гость'; } await query('INSERT INTO visitors (user_name,page,ip_hash) VALUES ($1,$2,$3)', [name, page || '?', hashIP(req.ip)]); await query('DELETE FROM visitors WHERE id NOT IN (SELECT id FROM visitors ORDER BY id DESC LIMIT 500)'); res.json({ ok: true }); } catch { res.json({ ok: true }); } });
router.get('/visitors', requireAdmin, async (req, res) => { const r = await query('SELECT user_name,page,visited_at FROM visitors ORDER BY id DESC LIMIT 200'); res.json(r.rows); });

// ═══════════════════════════════════════════════════════════════════════
// СТАТИСТИКА ПОСЕЩЕНИЙ САЙТА
// Клиент шлёт сюда ОДИН раз за визит (не на каждое переключение вкладок —
// см. logSiteVisit() во фронтенде, вызывается один раз при загрузке
// страницы), с visitor_id — случайным ID, который генерируется на клиенте
// и хранится в localStorage (переживает переключения вкладок и перезапуск
// браузера, привязан к конкретному устройству/браузеру). Благодаря
// UNIQUE(visitor_id,visit_date) + ON CONFLICT DO NOTHING один и тот же
// visitor_id за один день создаёт ровно одну запись, сколько бы раз
// человек ни заходил и ни обновлял страницу в этот день.
// ═══════════════════════════════════════════════════════════════════════
router.post('/site-visits', async (req, res) => {
  try {
    const visitor_id = (req.body?.visitor_id || '').toString().trim().slice(0, 128);
    if (!visitor_id) return res.json({ ok: true });
    // Дата визита считается по московскому времени (MSK, UTC+3), а не по
    // локальной дате сервера БД (обычно UTC) — иначе сутки переключаются
    // в 3 часа ночи по Москве вместо полуночи.
    await query(
      `INSERT INTO site_visits (id,visitor_id,visit_date,ip_hash) VALUES ($1,$2,(NOW() AT TIME ZONE 'Europe/Moscow')::date,$3)
       ON CONFLICT (visitor_id,visit_date) DO NOTHING`,
      [uuid(), visitor_id, hashIP(req.ip)]
    );
    res.json({ ok: true });
  } catch { res.json({ ok: true }); } // статистика не должна ломать работу сайта при сбое
});
router.get('/site-visits/stats', requireAdmin, async (req, res) => {
  try {
    // Везде ниже — те же соображения по MSK, что и при записи визита выше.
    const [today, yesterday, last7, last30, allTime, daily] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM site_visits WHERE visit_date=(NOW() AT TIME ZONE 'Europe/Moscow')::date`),
      query(`SELECT COUNT(*)::int AS n FROM site_visits WHERE visit_date=(NOW() AT TIME ZONE 'Europe/Moscow')::date-1`),
      query(`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM site_visits WHERE visit_date>=(NOW() AT TIME ZONE 'Europe/Moscow')::date-6`),
      query(`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM site_visits WHERE visit_date>=(NOW() AT TIME ZONE 'Europe/Moscow')::date-29`),
      query(`SELECT COUNT(DISTINCT visitor_id)::int AS n FROM site_visits`),
      query(`SELECT to_char(visit_date,'YYYY-MM-DD') AS d, COUNT(*)::int AS n FROM site_visits
             WHERE visit_date>=(NOW() AT TIME ZONE 'Europe/Moscow')::date-13 GROUP BY visit_date ORDER BY visit_date`)
    ]);
    res.json({
      today: today.rows[0].n, yesterday: yesterday.rows[0].n,
      last7: last7.rows[0].n, last30: last30.rows[0].n, allTime: allTime.rows[0].n,
      daily: daily.rows.map(r => ({ date: r.d, count: r.n }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
