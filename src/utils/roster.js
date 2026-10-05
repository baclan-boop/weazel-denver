'use strict';
const { query } = require('../db');

// ═══════════════════════════════════════════════════════════════════════
// «Дежурства» / «Смены» — диапазон часов, на которые вообще можно
// бронировать слоты за сутки. По умолчанию:
//   • duty  (Дежурства) — 13:00–23:59 (11 часовых слотов), как обычные
//     часы работы отдела.
//   • shift (Смены)     — 13:00–23:59 (время 00:00–13:00 убрано).
// Как и contractSchedule (см. src/utils/schedule.js), диапазон можно
// поменять без правки кода — PUT /api/settings с телом
// {"dutySchedule":{"startHour":13,"endHour":24}} или
// {"shiftSchedule":{"startHour":13,"endHour":24}} (только Лидер/Администратор,
// см. requireSiteSettings). endHour не включается в диапазон (13..24 —
// это часы 13,14,...,23).
// ═══════════════════════════════════════════════════════════════════════
const DEFAULT_RANGES = {
  duty: { startHour: 13, endHour: 24 },
  shift: { startHour: 13, endHour: 24 },
};

async function getRosterRange(kind) {
  const def = DEFAULT_RANGES[kind] || DEFAULT_RANGES.duty;
  const key = kind === 'shift' ? 'shiftSchedule' : 'dutySchedule';
  try {
    const r = await query(`SELECT value FROM site_settings WHERE key=$1`, [key]);
    if (r.rows.length) {
      const v = JSON.parse(r.rows[0].value);
      if (v && Number.isInteger(v.startHour) && Number.isInteger(v.endHour) &&
          v.startHour >= 0 && v.endHour > v.startHour && v.endHour <= 24) {
        const startHour = Math.max(v.startHour, MIN_START_HOUR);
        if (v.endHour > startHour) return { startHour, endHour: v.endHour };
      }
    }
  } catch { /* используем значение по умолчанию ниже */ }
  return def;
}

// Нижняя граница: ни в «Дежурствах», ни в «Сменах» нельзя брать часы раньше 13:00,
// даже если в site_settings осталось старое значение (например, startHour:0).
const MIN_START_HOUR = 13;

function hoursInRange(range) {
  const out = [];
  for (let h = range.startHour; h < range.endHour; h++) out.push(h);
  return out;
}

module.exports = { getRosterRange, hoursInRange };
