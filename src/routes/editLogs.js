'use strict';
const express = require('express');
const { query } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Журнал редактирования полей — только Администратор (роль Leader сюда
// доступа не имеет, см. requireAdmin по аналогии с /api/visitors в src/routes/visitors.js).
router.get('/edit-logs', requireAdmin, async (req, res) => {
  try {
    const r = await query(`SELECT id,user_name,entity,entity_label,changes,created_at FROM edit_logs ORDER BY created_at DESC LIMIT 300`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
