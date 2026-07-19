'use strict';
const { v4: uuid } = require('uuid');
const { query } = require('../db');
const { truncForLog } = require('./helpers');

// ═══════════════════════════════════════════════════════════════════════
// ЖУРНАЛ РЕДАКТИРОВАНИЯ ПОЛЕЙ (кто/что/когда изменил, значение до и после)
// ═══════════════════════════════════════════════════════════════════════
const EDIT_LOG_FIELD_LABELS = {
  news: { title: 'Заголовок', category: 'Категория', excerpt: 'Анонс', blocks: 'Содержимое статьи', img: 'Изображение', bg_img: 'Фон', align: 'Выравнивание', title_color: 'Цвет заголовка', text_color: 'Цвет текста', author_name: 'Автор', created_at: 'Дата публикации' },
  service: { name: 'Название', items: 'Позиции' },
  team_cat: { name: 'Название категории', layout: 'Расположение' },
  team_member: { cat_id: 'Категория', name: 'Имя', role: 'Должность', photo: 'Фото', role_font: 'Шрифт должности' },
  employee: { name: 'Имя', static_id: 'Static ID', active: 'Активен' },
  contract_slot: { price: 'Цена контракта', text: 'Текст', accepted_id: 'Принял', declined_id: 'Откинул', payout: 'К выплате', status: 'Статус', transfer_time: 'Время переноса' },
  bonus: { amount: 'Сумма', comment: 'Комментарий', paid: 'Выплачено' },
  user_role: { role: 'Роль' },
  user_password: { password: 'Пароль' },
};

// Сравнивает before (строка из БД ДО изменения) с after (строка из БД
// ПОСЛЕ изменения) по карте fieldLabels и, если есть хоть одно отличие,
// пишет одну запись в edit_logs со списком изменений. Раз сравниваются
// два реальных снимка из БД, а не то, что пришло в запросе — поля с
// COALESCE-фолбэками (например «оставить как было, если не передано»)
// не дадут ложных срабатываний. Молча ничего не делает при ошибке —
// журнал не должен мешать сохранению.
async function logFieldEdit(req, entity, entityId, entityLabel, before, after, fieldLabels) {
  try {
    if (!fieldLabels || !before || !after) return;
    const changes = [];
    for (const key of Object.keys(fieldLabels)) {
      const bs = truncForLog(before[key]);
      const as = truncForLog(after[key]);
      if (bs !== as) changes.push({ field: fieldLabels[key], before: bs, after: as });
    }
    if (!changes.length) return;
    await query(
      `INSERT INTO edit_logs (id,user_id,user_name,entity,entity_id,entity_label,changes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [uuid(), req.user?.id || null, req.user?.name || 'Система', entity, (entityId || '').toString(), (entityLabel || '').toString().slice(0, 200), JSON.stringify(changes)]
    );
    await query(`DELETE FROM edit_logs WHERE id NOT IN (SELECT id FROM edit_logs ORDER BY created_at DESC LIMIT 2000)`);
  } catch (e) { console.error('logFieldEdit error:', e.message); }
}

async function empNameMap() {
  const r = await query('SELECT id,name FROM employees');
  const m = {}; r.rows.forEach(e => { m[e.id] = e.name; }); return m;
}

module.exports = { EDIT_LOG_FIELD_LABELS, logFieldEdit, empNameMap };
