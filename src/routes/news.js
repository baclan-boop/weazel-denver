'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireNewsEdit, requireNewsDelete } = require('../middleware/auth');

const router = express.Router();

// NEWS
// Добавление/редактирование — Редактор, Dep. Director, Лидер, Администратор.
// Удаление — Редактору недоступно (может только добавлять и редактировать).
// ── Список новостей ──
// ВАЖНО: отдаём "лёгкие" поля без blocks (полное тело статьи) и bg_img (фон
// статьи) — они не нужны для карточек в лентах/бегущей строке/таблице
// админки, а blocks может быть весьма объёмным (много блоков текста/картинок
// на статью). При большом количестве новостей это резко сокращает объём
// ответа и, соответственно, время его получения и парсинга на клиенте.
// Полные данные конкретной статьи — через GET /api/news/:id (см. ниже),
// используется при открытии статьи и при редактировании.
//
// Поддерживается постраничная загрузка через ?limit=&offset= — используется
// вкладкой «Новости» на сайте (кнопка «Показать ещё»), чтобы не рендерить
// сразу все карточки при большом архиве новостей. Без ?limit — поведение как
// раньше, отдаётся полный список (используется админ-панелью и т.п.).
const NEWS_LIST_COLS = 'id,title,category,excerpt,img,align,title_color,text_color,author_id,author_name,created_at,updated_at';
router.get('/news', async (req, res) => {
  try {
    let sql = `SELECT ${NEWS_LIST_COLS} FROM news ORDER BY created_at DESC`;
    const params = [];
    const limitNum = parseInt(req.query.limit);
    if (Number.isFinite(limitNum) && limitNum > 0) {
      params.push(Math.min(limitNum, 200));
      sql += ` LIMIT $${params.length}`;
      const offsetNum = parseInt(req.query.offset);
      if (Number.isFinite(offsetNum) && offsetNum > 0) {
        params.push(offsetNum);
        sql += ` OFFSET $${params.length}`;
      }
    }
    const r = await query(sql, params);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// Полные данные одной новости (включая blocks и bg_img) — для открытия статьи
// и для формы редактирования.
router.get('/news/:id', async (req, res) => {
  try {
    const r = await query('SELECT * FROM news WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: 'Новость не найдена' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
router.post('/news', requireNewsEdit, async (req, res) => { try { const { title, category, excerpt, blocks, img, bg_img, align, title_color, text_color, created_at, author_name } = req.body; if (!title?.trim()) return res.status(400).json({ error: 'Укажите заголовок' }); const id = uuid(); let dateVal = null; if (created_at) { const d = new Date(created_at); if (!isNaN(d.getTime())) dateVal = d.toISOString(); } const finalAuthor = (author_name && author_name.trim()) ? author_name.trim().slice(0, 100) : req.user.name; await query('INSERT INTO news (id,title,category,excerpt,blocks,img,bg_img,align,title_color,text_color,author_id,author_name,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,NOW()))', [id, title.trim(), category || '', excerpt || '', blocks || '[]', img || '', bg_img || '', align || 'left', title_color || '', text_color || '', req.user.id, finalAuthor, dateVal]); const r = await query('SELECT * FROM news WHERE id=$1', [id]); res.json(r.rows[0]); } catch (e) { res.status(500).json({ error: e.message }); } });
router.put('/news/:id', requireNewsEdit, async (req, res) => { try { const { title, category, excerpt, blocks, img, bg_img, align, title_color, text_color, created_at, author_name } = req.body; if (!title?.trim()) return res.status(400).json({ error: 'Укажите заголовок' }); let dateVal = null; if (created_at) { const d = new Date(created_at); if (!isNaN(d.getTime())) dateVal = d.toISOString(); } const authorVal = (author_name && author_name.trim()) ? author_name.trim().slice(0, 100) : null; const before = await query('SELECT * FROM news WHERE id=$1', [req.params.id]); await query('UPDATE news SET title=$1,category=$2,excerpt=$3,blocks=$4,img=$5,bg_img=$6,align=$7,title_color=$8,text_color=$9,author_name=COALESCE($10,author_name),created_at=COALESCE($11,created_at),updated_at=NOW() WHERE id=$12', [title.trim(), category || '', excerpt || '', blocks || '[]', img || '', bg_img || '', align || 'left', title_color || '', text_color || '', authorVal, dateVal, req.params.id]); if (before.rows.length) { const after = await query('SELECT * FROM news WHERE id=$1', [req.params.id]); await logFieldEdit(req, 'news', req.params.id, title.trim(), before.rows[0], after.rows[0], EDIT_LOG_FIELD_LABELS.news); } res.json({ ok: true }); } catch (e) { res.status(500).json({ error: e.message }); } });
router.delete('/news/:id', requireNewsDelete, async (req, res) => { await query('DELETE FROM news WHERE id=$1', [req.params.id]); res.json({ ok: true }); });

module.exports = router;
