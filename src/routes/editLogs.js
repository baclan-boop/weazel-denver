'use strict';
const express = require('express');
const { query } = require('../db');
const { requireEditLogs } = require('../middleware/auth');

const router = express.Router();

// Журнал редактирования полей — Старший состав AD, Dep. Director, Лидер
// (Director) и Администратор (см. requireEditLogs в src/middleware/auth.js).
// В отличие от статистики посещений (/api/visitors в src/routes/visitors.js),
// которая по-прежнему видна только Администратору.
router.get('/edit-logs', requireEditLogs, async (req, res) => {
  try {
    const r = await query(`SELECT id,user_name,entity,entity_label,changes,created_at FROM edit_logs ORDER BY created_at DESC LIMIT 300`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
