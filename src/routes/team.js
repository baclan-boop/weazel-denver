'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireTeam } = require('../middleware/auth');

const router = express.Router();

// TEAM («Состав») — управление доступно только Лидеру и Администратору
// (Dep. Director составом управлять не может — см. requireTeam).
router.get('/team', async (req, res) => { const c = await query('SELECT * FROM team_cats ORDER BY sort_order'); const m = await query('SELECT * FROM team_members ORDER BY sort_order'); res.json({ cats: c.rows, members: m.rows }); });

router.post('/team/cats', requireTeam, async (req, res) => {
  const { name, layout } = req.body; if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  const id = uuid();
  const maxR = await query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM team_cats');
  await query('INSERT INTO team_cats (id,name,layout,sort_order) VALUES ($1,$2,$3,$4)', [id, name.trim(), layout || 'pyramid', maxR.rows[0].n]);
  res.json({ id, name, layout: layout || 'pyramid' });
});
router.put('/team/cats/:id', requireTeam, async (req, res) => { const { name, layout } = req.body; const before = await query('SELECT * FROM team_cats WHERE id=$1', [req.params.id]); await query('UPDATE team_cats SET name=$1,layout=$2 WHERE id=$3', [name, layout || 'pyramid', req.params.id]); if (before.rows.length) { const after = await query('SELECT * FROM team_cats WHERE id=$1', [req.params.id]); await logFieldEdit(req, 'team_cat', req.params.id, name || before.rows[0].name, before.rows[0], after.rows[0], EDIT_LOG_FIELD_LABELS.team_cat); } res.json({ ok: true }); });
router.delete('/team/cats/:id', requireTeam, async (req, res) => { await query('DELETE FROM team_cats WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

// Переместить категорию вверх/вниз (меняет местами sort_order с соседней категорией)
router.put('/team/cats/:id/move', requireTeam, async (req, res) => {
  const { direction } = req.body;
  const cur = await query('SELECT * FROM team_cats WHERE id=$1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Категория не найдена' });
  const curRow = cur.rows[0];
  const cmp = direction === 'up' ? '<' : '>';
  const ord = direction === 'up' ? 'DESC' : 'ASC';
  const neighborR = await query(`SELECT * FROM team_cats WHERE sort_order ${cmp} $1 ORDER BY sort_order ${ord} LIMIT 1`, [curRow.sort_order]);
  if (!neighborR.rows.length) return res.json({ ok: true, moved: false });
  const neighbor = neighborR.rows[0];
  await query('UPDATE team_cats SET sort_order=$1 WHERE id=$2', [neighbor.sort_order, curRow.id]);
  await query('UPDATE team_cats SET sort_order=$1 WHERE id=$2', [curRow.sort_order, neighbor.id]);
  res.json({ ok: true, moved: true });
});

router.post('/team/members', requireTeam, async (req, res) => {
  const { cat_id, name, role, photo, role_font } = req.body; if (!name?.trim()) return res.status(400).json({ error: 'Укажите имя' });
  const id = uuid();
  const maxR = await query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM team_members WHERE cat_id=$1', [cat_id]);
  await query('INSERT INTO team_members (id,cat_id,name,role,photo,role_font,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, cat_id, name.trim(), role || '', photo || '', role_font || '', maxR.rows[0].n]);
  res.json({ id, cat_id, name, role, photo, role_font });
});
router.put('/team/members/:id', requireTeam, async (req, res) => {
  const { cat_id, name, role, photo, role_font } = req.body;
  const before = await query('SELECT * FROM team_members WHERE id=$1', [req.params.id]);
  await query('UPDATE team_members SET cat_id=$1,name=$2,role=$3,photo=$4,role_font=$5 WHERE id=$6',
    [cat_id, name, role || '', photo || '', role_font || '', req.params.id]);
  if (before.rows.length) {
    const after = await query('SELECT * FROM team_members WHERE id=$1', [req.params.id]);
    await logFieldEdit(req, 'team_member', req.params.id, name || before.rows[0].name, before.rows[0], after.rows[0], EDIT_LOG_FIELD_LABELS.team_member);
  }
  res.json({ ok: true });
});
router.delete('/team/members/:id', requireTeam, async (req, res) => { await query('DELETE FROM team_members WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

// Переместить участника вверх/вниз ВНУТРИ его категории
router.put('/team/members/:id/move', requireTeam, async (req, res) => {
  const { direction } = req.body;
  const cur = await query('SELECT * FROM team_members WHERE id=$1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Участник не найден' });
  const curRow = cur.rows[0];
  const cmp = direction === 'up' ? '<' : '>';
  const ord = direction === 'up' ? 'DESC' : 'ASC';
  const neighborR = await query(`SELECT * FROM team_members WHERE cat_id=$1 AND sort_order ${cmp} $2 ORDER BY sort_order ${ord} LIMIT 1`, [curRow.cat_id, curRow.sort_order]);
  if (!neighborR.rows.length) return res.json({ ok: true, moved: false });
  const neighbor = neighborR.rows[0];
  await query('UPDATE team_members SET sort_order=$1 WHERE id=$2', [neighbor.sort_order, curRow.id]);
  await query('UPDATE team_members SET sort_order=$1 WHERE id=$2', [curRow.sort_order, neighbor.id]);
  res.json({ ok: true, moved: true });
});

module.exports = router;
