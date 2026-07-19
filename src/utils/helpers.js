'use strict';
const crypto = require('crypto');
const config = require('../config');

function hashIP(ip) {
  return crypto.createHash('sha256').update((ip || '') + config.SESSION_SECRET).digest('hex').slice(0, 16);
}

function maskEmail(e) {
  if (!e) return '—';
  const [l, d] = e.split('@');
  if (!d) return e.slice(0, 2) + '***';
  const ml = l.length > 2 ? l.slice(0, 2) + '*'.repeat(Math.min(l.length - 2, 4)) : l;
  const p = d.split('.');
  return ml + '@' + p[0].slice(0, 2) + '***.' + p.slice(1).join('.');
}

function safeUser(u) {
  if (!u) return null;
  const { pwd_hash, ...s } = u;
  return s;
}

function parseJSON(s, d = []) {
  try { return JSON.parse(s); } catch { return d; }
}

const boolLbl = v => v === true ? 'Да' : v === false ? 'Нет' : '';

function truncForLog(v, len = 300) {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s.length > len) s = s.slice(0, len) + '…';
  return s;
}

module.exports = { hashIP, maskEmail, safeUser, parseJSON, boolLbl, truncForLog };
