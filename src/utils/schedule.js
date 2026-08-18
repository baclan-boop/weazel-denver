'use strict';
const { query } = require('../db');

// ─── Недельная статистика: понедельник—воскресенье, UTC-даты без времени ───
function mondayOf(d) {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay(); const diff = (day === 0 ? -6 : 1 - day);
  dt.setUTCDate(dt.getUTCDate() + diff); return dt;
}
function fmtDate(d) { return d.toISOString().slice(0, 10); }
function weekRange(offset = 0) {
  const thisMonday = mondayOf(new Date());
  const start = new Date(thisMonday); start.setUTCDate(start.getUTCDate() - offset * 7);
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  return { start: fmtDate(start), end: fmtDate(end) };
}
function weekRangeForDate(dateStr) {
  const mon = mondayOf(new Date(dateStr));
  const end = new Date(mon); end.setUTCDate(end.getUTCDate() + 6);
  return { start: fmtDate(mon), end: fmtDate(end) };
}

// ─── Расписание слотов таблицы контрактов (по умолчанию 13:00 → 03:00 след. дня, шаг 10 мин) ───
async function getSchedule() {
  try {
    const r = await query(`SELECT value FROM site_settings WHERE key='contractSchedule'`);
    if (r.rows.length) { const v = JSON.parse(r.rows[0].value); if (v && v.start && v.end) return { start: v.start, end: v.end, intervalMin: Number(v.intervalMin) || 10 }; }
  } catch {}
  return { start: '13:00', end: '03:00', intervalMin: 10 };
}
function genTimeSlots(start, end, intervalMin) {
  const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let s = toMin(start), e = toMin(end); if (e <= s) e += 24 * 60;
  const out = [];
  for (let t = s; t < e; t += intervalMin) {
    const hh = String(Math.floor((t % 1440) / 60)).padStart(2, '0');
    const mm = String(t % 60).padStart(2, '0');
    out.push(`${hh}:${mm}`);
  }
  return out;
}

module.exports = { mondayOf, fmtDate, weekRange, weekRangeForDate, getSchedule, genTimeSlots };
