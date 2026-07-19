'use strict';
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { query } = require('../db');
const config = require('../config');
const { maskEmail } = require('../utils/helpers');
const { logFieldEdit, EDIT_LOG_FIELD_LABELS } = require('../utils/editLog');
const { requireUserMgmt, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Просмотр списка пользователей — Curator AD, Dep. Director, Лидер,
// Администратор (Редактору доступа сюда больше нет, см. requireUserMgmt).
// Кто какую РОЛЬ может НАЗНАЧАТЬ — см. подробную проверку внутри
// PUT /api/users/:id/role ниже: у Администратора полная свобода, у
// Лидера/Dep. Director и у Curator AD — разный ограниченный набор.
router.get('/users', requireUserMgmt, async (req, res) => { const r = await query('SELECT id,name,email,role,created_at,last_login FROM users ORDER BY created_at'); res.json(r.rows.map(u => ({ ...u, email: maskEmail(u.email) }))); });

// «Средние» роли, доступные для назначения Лидеру (см. ниже).
const MID_ROLES = ['guest', 'advertising', 'curator_ad', 'editor', 'dep_director'];
// Dep. Director — то же самое, но БЕЗ роли Dep. Director: Dep. Director не
// может назначить роль Dep. Director (в т.ч. другому Dep. Director или себе
// подобным) — эта роль выдаётся только Лидером или Администратором.
const DEP_DIRECTOR_ASSIGNABLE_ROLES = MID_ROLES.filter(r => r !== 'dep_director');

router.put('/users/:id/role', requireUserMgmt, async (req, res) => {
  const { role } = req.body;
  const ROLES = ['guest', 'advertising', 'curator_ad', 'editor', 'dep_director', 'leader', 'admin'];
  if (!ROLES.includes(role)) return res.status(400).json({ error: 'Неверная роль' });
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Нельзя изменить свою роль' });
  const beforeR = await query('SELECT name,role FROM users WHERE id=$1', [req.params.id]);
  if (!beforeR.rows.length) return res.status(404).json({ error: 'Пользователь не найден' });
  // Администратор — может назначить ЛЮБУЮ роль любому пользователю (без ограничений ниже).
  // Лидер и Dep. Director — могут назначать только «средние» роли (см. MID_ROLES
  // выше: Гость/Advertising Department/Curator AD/Редактор/Dep. Director), и
  // только пользователям, которые СЕЙЧАС находятся в одной из этих же ролей.
  // Не могут ни назначить, ни отобрать роль Leader/Admin — то есть не могут
  // трогать пользователей, которые сейчас Leader или Admin, и не могут
  // никому присвоить роль Leader/Admin. Dep. Director дополнительно НЕ может
  // назначить саму роль Dep. Director (см. DEP_DIRECTOR_ASSIGNABLE_ROLES).
  if (['leader', 'dep_director'].includes(req.user.role)) {
    const assignable = req.user.role === 'dep_director' ? DEP_DIRECTOR_ASSIGNABLE_ROLES : MID_ROLES;
    if (!assignable.includes(role)) return res.status(403).json({ error: 'Эта роль вам недоступна для назначения' });
    if (!MID_ROLES.includes(beforeR.rows[0].role)) return res.status(403).json({ error: 'Недостаточно прав для изменения этой роли' });
  }
  // Curator AD может выдавать/снимать ИСКЛЮЧИТЕЛЬНО роль Advertising Department:
  // и назначаемая роль, и текущая роль пользователя должны быть guest либо advertising
  // (более высокие роли — Редактор/Dep. Director/Лидер/Администратор/сам Curator AD —
  // ей недоступны ни как источник, ни как цель).
  if (req.user.role === 'curator_ad') {
    if (!['guest', 'advertising'].includes(role)) return res.status(403).json({ error: 'Curator AD может назначать только роль Advertising Department' });
    if (!['guest', 'advertising'].includes(beforeR.rows[0].role)) return res.status(403).json({ error: 'Недостаточно прав для изменения этой роли' });
  }
  await query('UPDATE users SET role=$1 WHERE id=$2', [role, req.params.id]);

  await logFieldEdit(req, 'user_role', req.params.id, beforeR.rows[0].name, beforeR.rows[0], { role }, EDIT_LOG_FIELD_LABELS.user_role);
  res.json({ ok: true });
});

// Случайный пароль без букв 0/O/1/l/I (чтобы админ не путал при передаче
// голосом/в чат) — администратор видит его в ответе и передаёт пользователю
// сам (Discord и т.п.), тот входит с ним и меняет на свой через «Сменить
// пароль» в личном кабинете (см. PUT /api/auth/password в src/routes/auth.js).
function generateRandomPassword(len = 10) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[crypto.randomInt(chars.length)];
  return out;
}

router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  try {
    const r = await query('SELECT id,name FROM users WHERE id=$1', [req.params.id]);
    const target = r.rows[0];
    if (!target) return res.status(404).json({ error: 'Пользователь не найден' });

    const newPassword = generateRandomPassword();
    const hash = await bcrypt.hash(newPassword, config.BCRYPT_ROUNDS);
    await query('UPDATE users SET pwd_hash=$1 WHERE id=$2', [hash, target.id]);
    // Гасим все активные сессии этого пользователя — со старым паролем
    // никто (в т.ч. если доступ был скомпрометирован) не остаётся залогинен.
    await query(`DELETE FROM session WHERE sess->>'userId' = $1`, [target.id]);

    await logFieldEdit(req, 'user_password', target.id, target.name, { password: '—' }, { password: 'сброшен администратором' }, EDIT_LOG_FIELD_LABELS.user_password);
    res.json({ ok: true, password: newPassword });
  } catch (e) { console.error(e.message); res.status(500).json({ error: 'Ошибка сервера' }); }
});

module.exports = router;
