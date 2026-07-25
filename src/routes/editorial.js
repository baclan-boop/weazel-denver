'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { parseJSON } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireAdvertising, requireEditorialMgmt } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// «ШАБЛОНЫ ОБЪЯВЛЕНИЙ» и «РЕДАКТУРА» — справочные материалы раздела
// «Реклама» (подвкладки adhub-templates / adhub-editorial в public/index.html).
// Каждая запись editorial_categories — одна карточка-категория (например
// «Одежда» или «Расшифровка причин отклонения») со своим набором пунктов
// (items, JSON-массив прямо в строке категории — как у /api/services).
//
//   tab:       'templates' (вкладка «Шаблоны объявлений») | 'editorial' (вкладка «Редактура»)
//   group_key: раздел ВНУТРИ вкладки — см. ALLOWED_GROUPS ниже.
//   columns:   1 — items это массив строк; 2 — items это массив {a,b}
//              (напр. код/причина или термин/значение).
//
// Просмотр (GET) — все, у кого вообще есть доступ к разделу «Реклама»
// (requireAdvertising, т.е. Advertising Dept. и выше). Создание/редактирование/
// удаление/перемещение категорий — «Старший состав AD и выше» (requireEditorialMgmt),
// обычный Advertising Dept. только читает.
// ═══════════════════════════════════════════════════════════════════════

const ALLOWED_GROUPS = {
  templates: ['main'],
  editorial: ['examples', 'locations', 'codes', 'glossary'],
};
const GROUP_COLUMNS = { main: 1, examples: 1, locations: 1, codes: 2, glossary: 2 };

function validGroup(tab, group_key) {
  return !!(ALLOWED_GROUPS[tab] && ALLOWED_GROUPS[tab].includes(group_key));
}

// Приводим items к ожидаемой форме под columns, отбрасывая мусор из тела запроса.
function sanitizeItems(items, columns) {
  if (!Array.isArray(items)) return [];
  if (columns === 2) {
    return items
      .map(it => ({ a: (it?.a ?? '').toString().trim(), b: (it?.b ?? '').toString().trim() }))
      .filter(it => it.a || it.b);
  }
  return items.map(it => (typeof it === 'string' ? it : (it?.a ?? '').toString()).trim()).filter(Boolean);
}

router.get('/editorial', requireAdvertising, async (req, res) => {
  const { tab } = req.query;
  const r = (tab && ALLOWED_GROUPS[tab])
    ? await query('SELECT * FROM editorial_categories WHERE tab=$1 ORDER BY group_key, sort_order', [tab])
    : await query('SELECT * FROM editorial_categories ORDER BY tab, group_key, sort_order');
  res.json(r.rows.map(c => ({ ...c, items: parseJSON(c.items) })));
});

router.post('/editorial/categories', requireEditorialMgmt, async (req, res) => {
  const { tab, group_key, title, items } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Укажите название категории' });
  if (!validGroup(tab, group_key)) return res.status(400).json({ error: 'Некорректный раздел' });
  const columns = GROUP_COLUMNS[group_key];
  const id = uuid();
  const maxR = await query('SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM editorial_categories WHERE tab=$1 AND group_key=$2', [tab, group_key]);
  const cleanItems = sanitizeItems(items, columns);
  await query(
    'INSERT INTO editorial_categories (id,tab,group_key,title,columns,items,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, tab, group_key, title.trim(), columns, JSON.stringify(cleanItems), maxR.rows[0].n]
  );
  res.json({ id, tab, group_key, title: title.trim(), columns, items: cleanItems, sort_order: maxR.rows[0].n });
});

router.put('/editorial/categories/:id', requireEditorialMgmt, async (req, res) => {
  const { title, items } = req.body;
  const before = await query('SELECT * FROM editorial_categories WHERE id=$1', [req.params.id]);
  if (!before.rows.length) return res.status(404).json({ error: 'Категория не найдена' });
  const cleanItems = sanitizeItems(items, before.rows[0].columns);
  const newTitle = title?.trim() || before.rows[0].title;
  await query('UPDATE editorial_categories SET title=$1, items=$2 WHERE id=$3', [newTitle, JSON.stringify(cleanItems), req.params.id]);
  const after = await query('SELECT * FROM editorial_categories WHERE id=$1', [req.params.id]);
  await logFieldEdit(req, 'editorial_cat', req.params.id, after.rows[0].title, before.rows[0], after.rows[0], EDIT_LOG_FIELD_LABELS.editorial_cat);
  res.json({ ok: true });
});

router.delete('/editorial/categories/:id', requireEditorialMgmt, async (req, res) => {
  await query('DELETE FROM editorial_categories WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// Переместить категорию вверх/вниз внутри своей группы (tab+group_key) —
// меняет местами sort_order с соседкой, аналогично /api/team/cats/:id/move.
router.put('/editorial/categories/:id/move', requireEditorialMgmt, async (req, res) => {
  const { direction } = req.body;
  const cur = await query('SELECT * FROM editorial_categories WHERE id=$1', [req.params.id]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Категория не найдена' });
  const curRow = cur.rows[0];
  const cmp = direction === 'up' ? '<' : '>';
  const ord = direction === 'up' ? 'DESC' : 'ASC';
  const neighborR = await query(
    `SELECT * FROM editorial_categories WHERE tab=$1 AND group_key=$2 AND sort_order ${cmp} $3 ORDER BY sort_order ${ord} LIMIT 1`,
    [curRow.tab, curRow.group_key, curRow.sort_order]
  );
  if (!neighborR.rows.length) return res.json({ ok: true, moved: false });
  const neighbor = neighborR.rows[0];
  await query('UPDATE editorial_categories SET sort_order=$1 WHERE id=$2', [neighbor.sort_order, curRow.id]);
  await query('UPDATE editorial_categories SET sort_order=$1 WHERE id=$2', [curRow.sort_order, neighbor.id]);
  res.json({ ok: true, moved: true });
});

module.exports = router;
