'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { boolLbl } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireBonusMgmt } = require('../middleware/auth');

const router = express.Router();

// ─── Премирование (часть вкладки «Реклама» → «Статистика») ───
// Curator AD, Dep. Director, Лидер, Администратор — полное управление.
// Advertising Dept. премиями не управляет (только просматривает, см.
// requireAdvertising на GET /api/stats/week в src/routes/contracts.js).
router.post('/bonuses', requireBonusMgmt, async (req, res) => {
  try {
    const { employee_id, week_start, amount, comment } = req.body;
    if (!employee_id || !week_start || isNaN(Date.parse(week_start))) return res.status(400).json({ error: 'Укажите сотрудника и неделю' });
    const id = uuid();
    await query('INSERT INTO bonuses (id,employee_id,week_start,amount,comment) VALUES ($1,$2,$3,$4,$5)', [id, employee_id, week_start, Number(amount) || 0, (comment || '').toString().slice(0, 300)]);
    const r = await query('SELECT b.*, e.name AS emp_name, e.static_id FROM bonuses b LEFT JOIN employees e ON e.id=b.employee_id WHERE b.id=$1', [id]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/bonuses/:id', requireBonusMgmt, async (req, res) => {
  try {
    const { amount, comment, paid } = req.body;
    const before = await query('SELECT b.*, e.name AS emp_name FROM bonuses b LEFT JOIN employees e ON e.id=b.employee_id WHERE b.id=$1', [req.params.id]);
    await query('UPDATE bonuses SET amount=COALESCE($1,amount), comment=COALESCE($2,comment), paid=COALESCE($3,paid) WHERE id=$4',
      [amount === undefined ? null : Number(amount), comment === undefined ? null : comment.toString().slice(0, 300), paid === undefined ? null : paid, req.params.id]);
    if (before.rows.length) {
      const after = await query('SELECT b.*, e.name AS emp_name FROM bonuses b LEFT JOIN employees e ON e.id=b.employee_id WHERE b.id=$1', [req.params.id]);
      const label = `Премия: ${before.rows[0].emp_name || '—'}`;
      const b = { ...before.rows[0], paid: boolLbl(before.rows[0].paid) };
      const a = { ...after.rows[0], paid: boolLbl(after.rows[0].paid) };
      await logFieldEdit(req, 'bonus', req.params.id, label, b, a, EDIT_LOG_FIELD_LABELS.bonus);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/bonuses/:id', requireBonusMgmt, async (req, res) => {
  try { await query('DELETE FROM bonuses WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
