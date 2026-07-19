'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { truncForLog } = require('../utils/helpers');
const { requireSiteSettings } = require('../middleware/auth');

const router = express.Router();

// SETTINGS — «Все тексты» (главная/о нас/названия разделов/бегущая строка)
// и «Фоны страниц» сохраняются через этот же роут, поэтому право на запись
// (PUT) — только у Лидера и Администратора (Dep. Director и Редактор менять
// тексты сайта и фоны не могут, см. requireSiteSettings). Чтение (GET) — публично.
router.get('/settings', async (req, res) => { const r = await query('SELECT key,value FROM site_settings'); const s = {}; r.rows.forEach(row => { try { s[row.key] = JSON.parse(row.value); } catch { s[row.key] = row.value; } }); res.json(s); });
router.put('/settings', requireSiteSettings, async (req, res) => {
  try {
    const changes = [];
    for (const [k, v] of Object.entries(req.body)) {
      const oldR = await query('SELECT value FROM site_settings WHERE key=$1', [k]);
      const oldVal = oldR.rows.length ? oldR.rows[0].value : '';
      const newVal = JSON.stringify(v);
      await query('INSERT INTO site_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2', [k, newVal]);
      if (oldVal !== newVal) changes.push({ field: k, before: truncForLog(oldVal), after: truncForLog(newVal) });
    }
    if (changes.length) {
      await query(`INSERT INTO edit_logs (id,user_id,user_name,entity,entity_id,entity_label,changes) VALUES ($1,$2,$3,'settings','','Настройки сайта',$4)`,
        [uuid(), req.user?.id || null, req.user?.name || 'Система', JSON.stringify(changes)]);
      await query(`DELETE FROM edit_logs WHERE id NOT IN (SELECT id FROM edit_logs ORDER BY created_at DESC LIMIT 2000)`);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
