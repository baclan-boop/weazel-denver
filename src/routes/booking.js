'use strict';
const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { getSchedule, genTimeSlots } = require('../utils/schedule');
const { slotIsFree } = require('../utils/contractsEngine');
const { requireAdvertising } = require('../middleware/auth');

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════
// ПОИСК СВОБОДНЫХ СЛОТОВ ДЛЯ ОБЪЯВЛЕНИЙ
// Раньше это искалось в отдельной Google Таблице через Apps Script (см.
// google-apps-script/Code.gs — больше не используется по умолчанию).
// Теперь ищем прямо в contract_slots — той же таблице, что и вкладка
// «Контракты» (src/routes/contracts.js) — и той же логикой «слот свободен»
// (см. slotIsFree в utils/contractsEngine.js: пусто и без сотрудника, либо
// стоит служебная пометка «Перенос с ЧЧ:ММ»). Расписание времени в течение
// дня — из site_settings/contractSchedule, как и в самих «Контрактах»
// (см. getSchedule/genTimeSlots в utils/schedule.js) — так что если время
// начала/окончания приёма контрактов когда-нибудь поменяют там, поиск
// объявлений автоматически подхватит это же расписание.
// ═══════════════════════════════════════════════════════════════════════

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

router.post('/booking/search', requireAdvertising, async (req, res) => {
  try {
    let { color, days, adsPerDay, startDate } = req.body;
    color = color === 'red' ? 'red' : 'green';
    days = Math.max(2, Math.min(7, parseInt(days, 10) || 2));
    adsPerDay = Math.max(2, Math.min(10, parseInt(adsPerDay, 10) || 2));
    // По умолчанию — «завтра» (как было раньше всегда), но теперь можно
    // явно указать любую другую дату начала поиска.
    if (!startDate || isNaN(Date.parse(startDate))) startDate = addDays(new Date().toISOString().slice(0, 10), 1);
    else startDate = new Date(startDate).toISOString().slice(0, 10);

    const dates = [];
    for (let i = 0; i < days; i++) dates.push(addDays(startDate, i));

    const sched = await getSchedule();
    const slotTimes = genTimeSlots(sched.start, sched.end, sched.intervalMin || 10);

    // Создаём недостающие строки слотов для ВСЕХ запрошенных дат одним
    // запросом (а не по одной строке за раз, как в GET /api/contracts —
    // там это одна дата, здесь может быть до 7 сразу, и последовательные
    // вставки были бы заметно медленнее).
    const ids = [], colors = [], slotDatesArr = [], slotTimesArr = [];
    for (const d of dates) {
      for (const t of slotTimes) { ids.push(uuid()); colors.push(color); slotDatesArr.push(d); slotTimesArr.push(t); }
    }
    if (ids.length) {
      await query(
        `INSERT INTO contract_slots (id, color, slot_date, slot_time)
         SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::text[])
         ON CONFLICT (color, slot_date, slot_time) DO NOTHING`,
        [ids, colors, slotDatesArr, slotTimesArr]
      );
    }

    const existing = await query(
      `SELECT to_char(slot_date,'YYYY-MM-DD') AS d, slot_time AS t, text, accepted_id
       FROM contract_slots WHERE color=$1 AND slot_date = ANY($2::date[])`,
      [color, dates]
    );
    const map = new Map();
    existing.rows.forEach(r => map.set(`${r.d}_${r.t}`, r));

    const foundSlots = [];
    for (const t of slotTimes) {
      let allFree = true;
      for (const d of dates) {
        if (!slotIsFree(map.get(`${d}_${t}`))) { allFree = false; break; }
      }
      if (allFree) foundSlots.push({ time: t, dates });
    }

    res.json({
      color, days, adsPerDay, startDate,
      checkedDates: dates,
      foundSlots,
      totalFound: foundSlots.length,
      fulfilled: foundSlots.length >= adsPerDay,
    });
  } catch (e) {
    console.error('Ads search error:', e.message);
    res.status(500).json({ error: 'Не удалось выполнить поиск слотов: ' + e.message });
  }
});

module.exports = router;
