'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { requireAdvertising } = require('../middleware/auth');
const { getRosterRange, hoursInRange } = require('../utils/roster');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// «ДЕЖУРСТВА» / «СМЕНЫ» — бронирование почасовых слотов отдела рекламы.
// Два независимых расписания на день (kind: 'duty' | 'shift'), по образцу
// бота в Discord (см. присланные скрины): каждый час дня — либо
// «свободно» (можно забронировать), либо «занято» (кем именно — видно
// всем), либо «недоступно» (час на СЕГОДНЯШНУЮ дату уже прошёл — время
// считается по UTC, как и остальные недельные диапазоны на сайте, см.
// src/utils/schedule.js). Просмотр и бронирование — Advertising Dept. и
// выше (canAds() на фронте / requireAdvertising здесь — тот же уровень
// доступа, что и у всех остальных вкладок «Реклама»). «Передать» из
// бота НЕ реализуем — по функционалу есть только бронь и отмена.
//
// Лимит «не больше 2 смен на человека» считается ОТДЕЛЬНО для «Дежурств»
// и отдельно для «Смен» за один день (т.е. до 2 «Дежурств» + до 2 «Смен»
// в один и тот же день) — так как это две разные роли/расписания.
//
// Бронь всегда идёт от лица ТЕКУЩЕГО аккаунта: имя персонажа и Static ID
// берутся из привязанной записи ростера (users.employee_id — см.
// PUT /api/auth/me/employee в src/routes/auth.js), а не вводятся вручную,
// поэтому сначала нужно один раз связать аккаунт с собой в ростере.
// ═══════════════════════════════════════════════════════════════════════

const KINDS = ['duty', 'shift'];
const MAX_PER_DAY = 2;
const MANAGER_ROLES = ['curator_ad', 'dep_director', 'admin', 'leader'];

const fmtHour = h => String(h).padStart(2, '0') + ':00';
const todayStr = () => new Date().toISOString().slice(0, 10);

router.get('/roster/:kind', requireAdvertising, async (req, res) => {
  const { kind } = req.params;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Неверный раздел' });
  let { date } = req.query;
  if (!date || isNaN(Date.parse(date))) date = todayStr();

  const range = await getRosterRange(kind);
  const hours = hoursInRange(range);

  const r = await query('SELECT * FROM roster_slots WHERE kind=$1 AND slot_date=$2', [kind, date]);
  const byHour = {};
  r.rows.forEach(row => { byHour[row.slot_hour] = row; });

  const today = todayStr();
  const isToday = date === today;
  const isPast = date < today;
  const nowHourUTC = new Date().getUTCHours();

  const slots = hours.map(h => {
    const b = byHour[h];
    let status;
    if (b) status = 'busy';
    else if (isPast || (isToday && h < nowHourUTC)) status = 'unavailable';
    else status = 'free';
    return {
      hour: h,
      time: fmtHour(h),
      status,
      booking: b ? {
        id: b.id,
        userId: b.user_id,
        name: b.emp_name,
        staticId: b.emp_static_id,
        role: b.role_snap,
        mine: b.user_id === req.user.id,
      } : null,
    };
  });

  const busy = slots.filter(s => s.status === 'busy').length;
  const myCount = r.rows.filter(row => row.user_id === req.user.id).length;

  res.json({
    kind, date, range,
    slots,
    total: slots.length,
    busy,
    free: slots.length - busy,
    myCount,
    maxPerDay: MAX_PER_DAY,
    needsEmployee: !req.user.employee_id,
  });
});

router.post('/roster/:kind', requireAdvertising, async (req, res) => {
  const { kind } = req.params;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Неверный раздел' });

  let { date, hour } = req.body;
  hour = parseInt(hour, 10);
  if (!date || isNaN(Date.parse(date)) || isNaN(hour) || hour < 0 || hour > 23) {
    return res.status(400).json({ error: 'Некорректные дата или час' });
  }

  if (!req.user.employee_id) {
    return res.status(400).json({ error: 'Сначала свяжите аккаунт с собой в ростере сотрудников', needsEmployee: true });
  }

  const range = await getRosterRange(kind);
  if (!hoursInRange(range).includes(hour)) return res.status(400).json({ error: 'Этот час вне расписания' });

  const today = todayStr();
  if (date < today) return res.status(400).json({ error: 'Нельзя забронировать прошедшую дату' });
  if (date === today && hour < new Date().getUTCHours()) {
    return res.status(400).json({ error: 'Это время уже недоступно' });
  }

  const emp = await query('SELECT * FROM employees WHERE id=$1', [req.user.employee_id]);
  if (!emp.rows.length) return res.status(400).json({ error: 'Привязанный сотрудник не найден, обратитесь к руководству отдела' });

  const cnt = await query(
    'SELECT COUNT(*)::int AS n FROM roster_slots WHERE kind=$1 AND slot_date=$2 AND user_id=$3',
    [kind, date, req.user.id]
  );
  if (cnt.rows[0].n >= MAX_PER_DAY) {
    return res.status(400).json({ error: `Не больше ${MAX_PER_DAY} ${kind === 'duty' ? 'дежурств' : 'смен'} на человека в день` });
  }

  try {
    const id = uuid();
    await query(
      `INSERT INTO roster_slots (id,kind,slot_date,slot_hour,user_id,emp_name,emp_static_id,role_snap)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, kind, date, hour, req.user.id, emp.rows[0].name, emp.rows[0].static_id || '', req.user.role]
    );
    res.json({ ok: true, id });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Это время уже занято — обновите страницу' });
    throw e;
  }
});

router.delete('/roster/:kind/:id', requireAdvertising, async (req, res) => {
  const { kind, id } = req.params;
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Неверный раздел' });

  const cur = await query('SELECT * FROM roster_slots WHERE id=$1 AND kind=$2', [id, kind]);
  if (!cur.rows.length) return res.status(404).json({ error: 'Бронь не найдена' });
  const row = cur.rows[0];

  const isOwner = row.user_id === req.user.id;
  const isManager = MANAGER_ROLES.includes(req.user.role);
  if (!isOwner && !isManager) return res.status(403).json({ error: 'Нет прав отменить эту бронь' });

  await query('DELETE FROM roster_slots WHERE id=$1', [id]);

  // Если бронь снял руководитель, а не сам сотрудник — фиксируем в журнале
  // редактирования (см. вкладку «Логи») для прозрачности.
  if (!isOwner) {
    try {
      const dateStr = row.slot_date instanceof Date ? row.slot_date.toISOString().slice(0, 10) : String(row.slot_date).slice(0, 10);
      const label = `${kind === 'duty' ? 'Дежурство' : 'Смена'} ${fmtHour(row.slot_hour)} ${dateStr} — ${row.emp_name}`;
      await query(
        `INSERT INTO edit_logs (id,user_id,user_name,entity,entity_id,entity_label,changes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [uuid(), req.user.id, req.user.name, 'roster_slot', id, label, JSON.stringify([{ field: 'Бронь', before: row.emp_name, after: 'отменена руководством' }])]
      );
    } catch (e) { console.error('roster edit log error:', e.message); }
  }

  res.json({ ok: true });
});

module.exports = router;
