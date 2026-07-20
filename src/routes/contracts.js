'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { boolLbl, parseJSON } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS, empNameMap } = require('../utils/editLog');
const { getSchedule, genTimeSlots, weekRange, weekRangeForDate } = require('../utils/schedule');
const { TRANSFER_MARK_RE, findBusyPairs, commitContractToSlots } = require('../utils/contractsEngine');
const { requireAdvertising, requireContractApproval } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// ТАБЛИЦА КОНТРАКТОВ (интерактивное расписание объявлений на день)
// Просмотр — доступен Advertising Department и выше (Curator AD, Редактор,
// Администратор). Редактирование большинства полей — тоже, НО для роли
// Advertising Department поля «Цена контракта», «Текст», «Принял» и
// «К выплате» доступны только на просмотр (см. проверку внутри PUT ниже) —
// им можно менять статус, «Откинул» и время переноса.
// ═══════════════════════════════════════════════════════════════════════
router.get('/contracts', requireAdvertising, async (req, res) => {
  try {
    let { color, date } = req.query;
    color = color === 'red' ? 'red' : 'green';
    if (!date || isNaN(Date.parse(date))) date = new Date().toISOString().slice(0, 10);
    const sched = await getSchedule();
    const slots = genTimeSlots(sched.start, sched.end, sched.intervalMin || 10);
    for (const t of slots) {
      await query('INSERT INTO contract_slots (id,color,slot_date,slot_time) VALUES ($1,$2,$3,$4) ON CONFLICT (color,slot_date,slot_time) DO NOTHING', [uuid(), color, date, t]);
    }
    const r = await query(`
      SELECT cs.*, ea.name AS accepted_name, ed.name AS declined_name
      FROM contract_slots cs
      LEFT JOIN employees ea ON ea.id=cs.accepted_id
      LEFT JOIN employees ed ON ed.id=cs.declined_id
      WHERE cs.color=$1 AND cs.slot_date=$2`, [color, date]);
    const order = {}; slots.forEach((t, i) => order[t] = i);
    r.rows.sort((a, b) => (order[a.slot_time] ?? 0) - (order[b.slot_time] ?? 0));
    res.json({ color, date, schedule: sched, slots: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/contracts/:id', requireAdvertising, async (req, res) => {
  try {
    const { status, price, text, accepted_id, declined_id, payout, transfer_time } = req.body;
    const cur = await query('SELECT * FROM contract_slots WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Слот не найден' });
    const c = cur.rows[0];
    // Advertising Department видит контракты, но не имеет права менять цену,
    // текст, принявшего сотрудника и сумму к выплате — это зона ответственности
    // Curator AD и выше. Им доступны только статус, «Откинул» и время переноса.
    // ИСКЛЮЧЕНИЕ для «текста»: служебная пометка «Перенос с ЧЧ:ММ» — её сам
    // фронт проставляет/убирает в СОСЕДНЕЙ строке как побочный эффект поля
    // «Время переноса», которое этой роли как раз разрешено. Без этого
    // исключения запись пометки получала 403 и молча не сохранялась — в
    // интерфейсе она на миг появлялась (см. ctTransferChanged на фронте), но
    // после обновления страницы пропадала, т.к. в базе её не было. Настоящий
    // текст контракта (что угодно, что НЕ подходит под пометку) по-прежнему
    // под запретом для этой роли.
    if (req.user.role === 'advertising') {
      const textIsTransferMark = text !== undefined && (
        TRANSFER_MARK_RE.test((text || '').toString().trim()) ||
        (text === '' && TRANSFER_MARK_RE.test((c.text || '').toString().trim()))
      );
      const forbiddenFields = ['price', 'accepted_id', 'payout'];
      if (!textIsTransferMark) forbiddenFields.push('text');
      const forbidden = forbiddenFields.filter(f => req.body[f] !== undefined);
      if (forbidden.length) return res.status(403).json({ error: 'Advertising Dept. может менять только статус, «Откинул» и время переноса' });
    }
    await query(`UPDATE contract_slots SET
        status=COALESCE($1,status), price=COALESCE($2,price), text=COALESCE($3,text),
        accepted_id=$4, declined_id=$5, payout=COALESCE($6,payout), transfer_time=COALESCE($7,transfer_time),
        updated_at=NOW()
      WHERE id=$8`,
      [status === undefined ? null : status,
        price === undefined ? null : price,
        text === undefined ? null : text,
        accepted_id === undefined ? c.accepted_id : (accepted_id || null),
        declined_id === undefined ? c.declined_id : (declined_id || null),
        payout === undefined ? null : payout,
        transfer_time === undefined ? null : transfer_time,
        req.params.id]);
    const r = await query(`
      SELECT cs.*, ea.name AS accepted_name, ed.name AS declined_name
      FROM contract_slots cs
      LEFT JOIN employees ea ON ea.id=cs.accepted_id
      LEFT JOIN employees ed ON ed.id=cs.declined_id
      WHERE cs.id=$1`, [req.params.id]);
    // Для лога подменяем ID сотрудников на имена (сырой UUID в журнале
    // редактирования бесполезен) — «после» уже есть из JOIN выше, «до»
    // разрешаем через employees.
    const empMap = await empNameMap();
    const beforeResolved = { ...c, accepted_id: c.accepted_id ? (empMap[c.accepted_id] || '—') : '—', declined_id: c.declined_id ? (empMap[c.declined_id] || '—') : '—', status: boolLbl(c.status) };
    const afterRow = r.rows[0];
    const afterResolved = { ...afterRow, accepted_id: afterRow.accepted_name || '—', declined_id: afterRow.declined_name || '—', status: boolLbl(afterRow.status) };
    const dateStr = c.slot_date instanceof Date ? c.slot_date.toISOString().slice(0, 10) : String(c.slot_date).slice(0, 10);
    const label = `Контракт ${c.slot_time} (${c.color === 'green' ? 'зел.' : 'красн.'}) ${dateStr}`;
    await logFieldEdit(req, 'contract_slot', req.params.id, label, beforeResolved, afterResolved, EDIT_LOG_FIELD_LABELS.contract_slot);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// ДОБАВИТЬ КОНТРАКТ (вкладка «Добавить контракт»)
// С этой версии контракт больше НЕ пишется в contract_slots напрямую: этот
// роут проверяет входные данные и свободны ли нужные слоты (см. slotIsFree —
// слот с пометкой «Перенос с ЧЧ:ММ» считается свободным), и если всё
// свободно — создаёт заявку в pending_contracts со статусом 'pending'.
// Сама запись в таблицу «Контракты» происходит только после одобрения
// Curator AD и выше, см. POST /api/contracts/pending/:id/approve ниже —
// на одобрении можно поправить ЛЮБОЕ поле заявки (см. PUT /api/contracts/pending/:id).
// Доступ к подаче заявки: любой сотрудник с доступом к разделу «Реклама»
// (Advertising Dept. и выше).
// ═══════════════════════════════════════════════════════════════════════
router.post('/contracts/bulk', requireAdvertising, async (req, res) => {
  try {
    let { color, times, dates, text, accepted_id, discount } = req.body;
    color = color === 'red' ? 'red' : 'green';
    text = (text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'Укажите текст объявления' });
    if (!accepted_id) return res.status(400).json({ error: 'Выберите сотрудника, принявшего контракт' });

    const emp = await query('SELECT id FROM employees WHERE id=$1', [accepted_id]);
    if (!emp.rows.length) return res.status(400).json({ error: 'Сотрудник не найден' });

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!Array.isArray(times) || !times.length) return res.status(400).json({ error: 'Укажите хотя бы одно время' });
    times = [...new Set(times)];
    if (times.some(t => !timeRe.test(t))) return res.status(400).json({ error: 'Некорректный формат времени' });

    if (!Array.isArray(dates) || !dates.length) return res.status(400).json({ error: 'Укажите срок контракта' });
    dates = [...new Set(dates)];
    if (dates.some(d => isNaN(Date.parse(d)))) return res.status(400).json({ error: 'Некорректная дата' });

    discount = parseFloat(discount); if (isNaN(discount) || discount < 0) discount = 0; if (discount > 100) discount = 100;

    // Времена должны входить в действующее расписание слотов таблицы контрактов
    const sched = await getSchedule();
    const validTimes = new Set(genTimeSlots(sched.start, sched.end, sched.intervalMin || 10));
    if (times.some(t => !validTimes.has(t))) {
      return res.status(400).json({ error: 'Одно из указанных времён не входит в расписание слотов' });
    }

    const pairs = [];
    for (const d of dates) for (const t of times) pairs.push({ d, t });

    // Проверяем свободны ли нужные слоты уже на этапе подачи заявки (слот
    // свободен, если текст пуст и сотрудник не назначен, либо если в нём
    // стоит служебная пометка «Перенос с ЧЧ:ММ» — см. slotIsFree выше).
    const busy = await findBusyPairs(color, dates, times, pairs);
    if (busy.length) return res.status(409).json({ error: 'Некоторые слоты уже заняты', busy });

    const id = uuid();
    await query(
      `INSERT INTO pending_contracts (id,color,times,dates,text,accepted_id,discount,submitted_by,submitted_by_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, color, JSON.stringify(times), JSON.stringify(dates), text, accepted_id, discount, req.user.id, req.user.name]
    );
    const r = await query('SELECT * FROM pending_contracts WHERE id=$1', [id]);
    res.json({ ok: true, pending: true, request: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// ОДОБРЕНИЕ ЗАЯВОК НА ДОБАВЛЕНИЕ КОНТРАКТА (Curator AD и выше)
// ═══════════════════════════════════════════════════════════════════════
// Список заявок (по умолчанию только 'pending'; ?status=all — вообще все,
// включая уже одобренные/отклонённые, для истории).
router.get('/contracts/pending', requireContractApproval, async (req, res) => {
  try {
    const status = req.query.status;
    const r = status === 'all'
      ? await query('SELECT * FROM pending_contracts ORDER BY created_at DESC')
      : await query(`SELECT * FROM pending_contracts WHERE status='pending' ORDER BY created_at`);
    res.json(r.rows.map(row => ({ ...row, times: parseJSON(row.times, []), dates: parseJSON(row.dates, []) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Правка любого поля заявки ДО одобрения (доступно только пока status='pending').
router.put('/contracts/pending/:id', requireContractApproval, async (req, res) => {
  try {
    const cur = await query('SELECT * FROM pending_contracts WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    if (cur.rows[0].status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });

    let { color, times, dates, text, accepted_id, discount } = req.body;
    color = color === 'red' ? 'red' : (color === 'green' ? 'green' : cur.rows[0].color);
    if (text !== undefined) text = (text || '').toString().trim();
    if (times !== undefined) {
      const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!Array.isArray(times) || !times.length || times.some(t => !timeRe.test(t))) return res.status(400).json({ error: 'Некорректное время' });
      times = [...new Set(times)];
    }
    if (dates !== undefined) {
      if (!Array.isArray(dates) || !dates.length || dates.some(d => isNaN(Date.parse(d)))) return res.status(400).json({ error: 'Некорректная дата' });
      dates = [...new Set(dates)];
    }
    if (discount !== undefined) { discount = parseFloat(discount); if (isNaN(discount) || discount < 0) discount = 0; if (discount > 100) discount = 100; }
    if (accepted_id) {
      const emp = await query('SELECT id FROM employees WHERE id=$1', [accepted_id]);
      if (!emp.rows.length) return res.status(400).json({ error: 'Сотрудник не найден' });
    }

    const next = {
      color, text: text !== undefined ? text : cur.rows[0].text,
      accepted_id: accepted_id !== undefined ? accepted_id : cur.rows[0].accepted_id,
      discount: discount !== undefined ? discount : cur.rows[0].discount,
      times: times !== undefined ? times : parseJSON(cur.rows[0].times, []),
      dates: dates !== undefined ? dates : parseJSON(cur.rows[0].dates, []),
    };
    await query(
      `UPDATE pending_contracts SET color=$1,times=$2,dates=$3,text=$4,accepted_id=$5,discount=$6 WHERE id=$7`,
      [next.color, JSON.stringify(next.times), JSON.stringify(next.dates), next.text, next.accepted_id || null, next.discount, req.params.id]
    );
    const r = await query('SELECT * FROM pending_contracts WHERE id=$1', [req.params.id]);
    res.json({ ...r.rows[0], times: parseJSON(r.rows[0].times, []), dates: parseJSON(r.rows[0].dates, []) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Одобрить: перепроверяем свободные слоты (могли занять, пока заявка ждала)
// и, если всё ещё всё свободно, записываем контракт в contract_slots — той
// же формулой расчёта, что и в Калькуляторе (см. commitContractToSlots).
router.post('/contracts/pending/:id/approve', requireContractApproval, async (req, res) => {
  try {
    const cur = await query('SELECT * FROM pending_contracts WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    const row = cur.rows[0];
    if (row.status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });
    if (!row.accepted_id) return res.status(400).json({ error: 'Выберите сотрудника, принявшего контракт' });

    const times = parseJSON(row.times, []);
    const dates = parseJSON(row.dates, []);
    let result;
    try {
      result = await commitContractToSlots({ color: row.color, dates, times, text: row.text, accepted_id: row.accepted_id, discount: Number(row.discount) || 0 });
    } catch (e) {
      if (e.busy) return res.status(409).json({ error: 'Некоторые слоты уже заняты', busy: e.busy });
      throw e;
    }
    await query(
      `UPDATE pending_contracts SET status='approved', reviewed_by=$1, reviewed_by_name=$2, reviewed_at=NOW() WHERE id=$3`,
      [req.user.id, req.user.name, req.params.id]
    );
    res.json({ ok: true, filled: result.filled, color: row.color, dates, times, calc: result.calc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Отклонить заявку (без записи в contract_slots). Необязательная причина.
router.post('/contracts/pending/:id/reject', requireContractApproval, async (req, res) => {
  try {
    const cur = await query('SELECT * FROM pending_contracts WHERE id=$1', [req.params.id]);
    if (!cur.rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    if (cur.rows[0].status !== 'pending') return res.status(409).json({ error: 'Заявка уже обработана' });
    const reason = (req.body?.reason || '').toString().trim().slice(0, 300);
    await query(
      `UPDATE pending_contracts SET status='rejected', reviewed_by=$1, reviewed_by_name=$2, reviewed_at=NOW(), reject_reason=$3 WHERE id=$4`,
      [req.user.id, req.user.name, reason, req.params.id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Удалить заявку из списка насовсем (уборка истории одобренных/отклонённых).
router.delete('/contracts/pending/:id', requireContractApproval, async (req, res) => {
  try { await query('DELETE FROM pending_contracts WHERE id=$1', [req.params.id]); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// НЕДЕЛЬНАЯ СТАТИСТИКА
// offset=0 — текущая неделя, offset=1 — прошлая. Параметр date — точечный
// просмотр произвольной недели из глубокого архива (данные не удаляются,
// просто не показываются вкладками по умолчанию).
// Просмотр доступен Advertising Department и выше — управление премиями
// (создание/редактирование/удаление) по-прежнему только Curator AD и выше
// (см. src/routes/bonuses.js).
// ═══════════════════════════════════════════════════════════════════════
router.get('/stats/week', requireAdvertising, async (req, res) => {
  try {
    let offset = parseInt(req.query.offset, 10); if (isNaN(offset) || offset < 0) offset = 0;
    const range = (req.query.date && !isNaN(Date.parse(req.query.date))) ? weekRangeForDate(req.query.date) : weekRange(offset);
    const emps = await query('SELECT * FROM employees ORDER BY sort_order,name');
    const slots = await query('SELECT * FROM contract_slots WHERE slot_date BETWEEN $1 AND $2', [range.start, range.end]);
    const stats = {};
    emps.rows.forEach(e => { stats[e.id] = { id: e.id, name: e.name, static_id: e.static_id, acceptedGreen: 0, sentGreen: 0, acceptedRed: 0, sentRed: 0, payout: 0, declinedCount: 0, payoutSlots: [] }; });
    slots.rows.forEach(s => {
      if (s.accepted_id && stats[s.accepted_id]) {
        const st = stats[s.accepted_id];
        if (s.color === 'green') st.acceptedGreen++; else st.acceptedRed++;
      }
      // «Отправлено», «К выплате» и сам факт участия сотрудника в «Откинул»
      // начисляются ТОЛЬКО когда у слота отмечена галочка «Статус» (ад
      // фактически отправлен) — просто вписанное имя в «Откинул» само по
      // себе в статистику не идёт, иначе деньги/счётчик засчитывались бы
      // ещё до реальной отправки объявления.
      if (s.declined_id && stats[s.declined_id] && s.status) {
        const st = stats[s.declined_id];
        st.declinedCount++;
        st.payout += Number(s.payout) || 0;
        if (s.color === 'green') st.sentGreen++; else st.sentRed++;
        // Детализация «из каких ячеек» сложилась сумма — показывается на
        // фронте по клику на «К выплате» (раскладка по датам/времени).
        st.payoutSlots.push({
          date: s.slot_date instanceof Date ? s.slot_date.toISOString().slice(0, 10) : String(s.slot_date).slice(0, 10),
          time: s.slot_time,
          color: s.color,
          amount: Number(s.payout) || 0,
          text: s.text || '',
        });
      }
    });
    Object.values(stats).forEach(st => st.payoutSlots.sort((a, b) => a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    const bonuses = await query(`SELECT b.*, e.name AS emp_name, e.static_id FROM bonuses b LEFT JOIN employees e ON e.id=b.employee_id WHERE b.week_start=$1 ORDER BY b.created_at`, [range.start]);
    res.json({ range, employees: Object.values(stats), bonuses: bonuses.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
