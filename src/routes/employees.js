'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { boolLbl } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireAdvertising, requireEmployeeMgmt } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// СОТРУДНИКИ (роster отдела рекламы: имя персонажа + StaticID)
// Используется в выпадающих списках «Принял/Откинул» таблицы контрактов
// и в недельной статистике. Просмотр — Advertising Department и выше;
// добавление/редактирование/удаление — Curator AD, Dep. Director, Лидер,
// Администратор.
// ═══════════════════════════════════════════════════════════════════════
router.get('/employees', requireAdvertising, async (req, res) => {
  try { const r = await query('SELECT * FROM employees ORDER BY sort_order,name'); res.json(r.rows); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/employees', requireEmployeeMgmt, async (req, res) => {
  try {
    const { name, static_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Укажите имя сотрудника' });
    const id = uuid();
    const maxR = await query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM employees');
    await query('INSERT INTO employees (id,name,static_id,sort_order) VALUES ($1,$2,$3,$4)', [id, name.trim(), (static_id || '').toString().trim(), maxR.rows[0].n]);
    res.json({ id, name: name.trim(), static_id: (static_id || '').toString().trim(), active: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.put('/employees/:id', requireEmployeeMgmt, async (req, res) => {
  try {
    const { name, static_id, active } = req.body;
    const before = await query('SELECT * FROM employees WHERE id=$1', [req.params.id]);
    await query('UPDATE employees SET name=COALESCE($1,name), static_id=COALESCE($2,static_id), active=COALESCE($3,active) WHERE id=$4',
      [name === undefined ? null : name.trim(), static_id === undefined ? null : (static_id || '').toString().trim(), active === undefined ? null : active, req.params.id]);
    if (before.rows.length) {
      const after = await query('SELECT * FROM employees WHERE id=$1', [req.params.id]);
      const b = { ...before.rows[0], active: boolLbl(before.rows[0].active) };
      const a = { ...after.rows[0], active: boolLbl(after.rows[0].active) };
      await logFieldEdit(req, 'employee', req.params.id, after.rows[0].name, b, a, EDIT_LOG_FIELD_LABELS.employee);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.delete('/employees/:id', requireEmployeeMgmt, async (req, res) => {
  try { await query('DELETE FROM employees WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
