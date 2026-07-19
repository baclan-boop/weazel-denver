'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { parseJSON } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireServices } = require('../middleware/auth');

const router = express.Router();

// SERVICES — управление доступно Dep. Director, Лидеру, Администратору (Редактору недоступно).
router.get('/services', async (req, res) => { const r = await query('SELECT * FROM services ORDER BY sort_order'); res.json(r.rows.map(s => ({ ...s, items: parseJSON(s.items) }))); });
router.post('/services', requireServices, async (req, res) => {
  const { name, items } = req.body; if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  // Защита от дублей при повторной/двойной отправке одной и той же формы
  // (например, двойной клик по кнопке «Сохранить» до того, как пришёл ответ сервера):
  // если точно такая же категория (имя + услуги) была создана в последние 10 секунд — не создаём вторую.
  const dup = await query(
    `SELECT id FROM services WHERE name=$1 AND items=$2 AND created_at > NOW() - INTERVAL '10 seconds' ORDER BY created_at DESC LIMIT 1`,
    [name.trim(), JSON.stringify(items || [])]
  ).catch(() => ({ rows: [] }));
  if (dup.rows.length) return res.json({ id: dup.rows[0].id, name, items: items || [] });
  const id = uuid(); await query('INSERT INTO services (id,name,items) VALUES ($1,$2,$3)', [id, name.trim(), JSON.stringify(items || [])]); res.json({ id, name, items: items || [] });
});
router.put('/services/:id', requireServices, async (req, res) => { const { name, items } = req.body; const before = await query('SELECT * FROM services WHERE id=$1', [req.params.id]); await query('UPDATE services SET name=$1,items=$2 WHERE id=$3', [name, JSON.stringify(items || []), req.params.id]); if (before.rows.length) { const after = await query('SELECT * FROM services WHERE id=$1', [req.params.id]); await logFieldEdit(req, 'service', req.params.id, name || before.rows[0].name, before.rows[0], after.rows[0], EDIT_LOG_FIELD_LABELS.service); } res.json({ ok: true }); });
router.delete('/services/:id', requireServices, async (req, res) => { await query('DELETE FROM services WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

module.exports = router;
