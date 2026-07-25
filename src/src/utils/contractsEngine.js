'use strict';
const { v4: uuid } = require('uuid');
const { query } = require('../db');

// ─── Свободен ли слот контракта (используется и при подаче заявки на
// добавление контракта, и при её одобрении) ───
// Слот считается СВОБОДНЫМ, если текст пуст и сотрудник не назначен — ИЛИ
// если в тексте стоит служебная пометка «Перенос с ЧЧ:ММ» (её автоматически
// проставляет ctTransferChanged на фронте в строку целевого времени переноса
// — это не настоящий текст контракта, а просто отметка, что сюда что-то
// перенесли, поэтому новый контракт можно ставить поверх такой пометки).
const TRANSFER_MARK_RE = /^Перенос с ([01]\d|2[0-3]):[0-5]\d$/;
function slotIsFree(row) {
  if (!row) return true;
  const text = (row.text || '').toString().trim();
  if (TRANSFER_MARK_RE.test(text)) return true;
  return !text && !row.accepted_id;
}

// Возвращает список занятых (date,time) пар из запрошенных pairs=[{d,t}] для
// заданного цвета — используется при подаче заявки и при её одобрении.
async function findBusyPairs(color, dates, times, pairs) {
  const existing = await query(
    `SELECT to_char(slot_date,'YYYY-MM-DD') AS d, slot_time AS t, text, accepted_id
     FROM contract_slots WHERE color=$1 AND slot_date = ANY($2::date[]) AND slot_time = ANY($3::text[])`,
    [color, dates, times]
  );
  const map = new Map();
  existing.rows.forEach(r => map.set(`${r.d}_${r.t}`, r));
  const busy = [];
  for (const { d, t } of pairs) {
    if (!slotIsFree(map.get(`${d}_${t}`))) busy.push({ date: d, time: t });
  }
  return busy;
}

// Считает цену/выплату (формула Калькулятора) и записывает контракт в
// contract_slots — общая логика для прямого добавления (устаревший путь) и
// для одобрения заявки (см. POST /api/contracts/pending/:id/approve в
// src/routes/contracts.js). Бросает объект {busy:[...]}, если на момент
// записи что-то из слотов уже занято.
async function commitContractToSlots({ color, dates, times, text, accepted_id, discount }) {
  const pairs = [];
  for (const d of dates) for (const t of times) pairs.push({ d, t });

  for (const { d, t } of pairs) {
    await query('INSERT INTO contract_slots (id,color,slot_date,slot_time) VALUES ($1,$2,$3,$4) ON CONFLICT (color,slot_date,slot_time) DO NOTHING', [uuid(), color, d, t]);
  }

  const busy = await findBusyPairs(color, dates, times, pairs);
  if (busy.length) { const err = new Error('Некоторые слоты уже заняты'); err.busy = busy; throw err; }

  const rate = color === 'red' ? 150 : 300;
  const chars = text.length;
  const totalAds = times.length * dates.length;
  const baseSum = totalAds * chars * rate;
  const orderSum = baseSum * (1 - discount / 100);
  const treasury = orderSum * 0.9;
  const toEmployee = orderSum * 0.1;
  const perAd = totalAds > 0 ? toEmployee / totalAds : 0;

  const wnewsText = `/wnews ${text}`;
  for (const { d, t } of pairs) {
    await query(
      `UPDATE contract_slots SET text=$1, accepted_id=$2, price=$3, payout=$4, updated_at=NOW() WHERE color=$5 AND slot_date=$6 AND slot_time=$7`,
      [wnewsText, accepted_id, orderSum, perAd, color, d, t]
    );
  }
  return { filled: pairs.length, calc: { chars, totalAds, rate, discount, baseSum, orderSum, treasury, toEmployee, perAd } };
}

module.exports = { TRANSFER_MARK_RE, slotIsFree, findBusyPairs, commitContractToSlots };
