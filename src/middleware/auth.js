'use strict';
const { query } = require('../db');

async function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ error: 'Требуется авторизация' });
  const r = await query('SELECT * FROM users WHERE id=$1', [req.session.userId]);
  if (!r.rows.length) { req.session.destroy(() => {}); return res.status(401).json({ error: 'Сессия недействительна' }); }
  req.user = r.rows[0]; next();
}

// ═══════════════════════════════════════════════════════════════════════
// РОЛИ И ПРАВА ДОСТУПА
// ─────────────────────────────────────────────────────────────────────
//  • admin (Администратор)   — абсолютно все права без исключений.
//  • leader (Лидер)          — как Администратор, КРОМЕ статистики посещений
//                              (/api/visitors, /api/site-visits/stats) и
//                              журнала редактирования (/api/edit-logs) —
//                              это зона видимости исключительно Администратора
//                              (см. requireAdmin).
//  • dep_director (Dep. Director) — как Лидер, НО дополнительно не видит:
//                              посещаемость и логи (как и Лидер), не может
//                              управлять Составом (requireTeam) и не может
//                              менять тексты сайта/фоны страниц
//                              (requireSiteSettings). Во всём остальном,
//                              включая раздел «Реклама» — полные права.
//  • editor (Редактор)       — только добавление и редактирование новостей
//                              (requireNewsEdit) + загрузка картинок для них.
//                              Не может удалять новости, не имеет доступа
//                              ни к чему в разделе «Реклама», ни к Составу/
//                              Услугам/Текстам/Пользователям/Сотрудникам.
//  • curator_ad (Старший состав AD) — полное редактирование раздела «Реклама»
//                              (объявления, контракты — все поля,
//                              статистика, премии) + вкладка «Сотрудники»
//                              (полное управление ростером) + вкладка
//                              «Пользователи», но ТАМ ограниченно: может
//                              выдавать/снимать ИСКЛЮЧИТЕЛЬНО роль
//                              Advertising Department (см. проверку внутри
//                              PUT /api/users/:id/role). Остального в
//                              Панели (Новости/Услуги/Состав/Тексты) не видит.
//  • advertising (AD)        — только раздел «Реклама», и то не полностью:
//                              может добавлять контракты (bulk-добавление) и
//                              в самой таблице контрактов — только галочку
//                              «Статус», «Откинул» и время переноса (см.
//                              проверку роли внутри PUT /api/contracts/:id).
//                              Не видит и не правит цену/текст/принявшего/
//                              выплату, не управляет сотрудниками и премиями.
//  • guest (Гость)           — обычный авторизованный посетитель, без прав.
// ═══════════════════════════════════════════════════════════════════════

// Добавление и редактирование новостей + загрузка картинок для них.
async function requireNewsEdit(req, res, next) { await requireAuth(req, res, () => { if (!['editor', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет прав' }); next(); }); }
// Удаление новостей — Редактору недоступно, только добавление/редактирование.
async function requireNewsDelete(req, res, next) { await requireAuth(req, res, () => { if (!['dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет прав' }); next(); }); }
// Услуги (создание/редактирование/удаление категорий и позиций).
async function requireServices(req, res, next) { await requireAuth(req, res, () => { if (!['dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет прав' }); next(); }); }
// Состав (публичная страница «команда сайта») — категории и участники.
async function requireTeam(req, res, next) { await requireAuth(req, res, () => { if (!['admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет прав' }); next(); }); }
// Настройки сайта: «Все тексты» (главная/о нас/названия разделов/бегущая
// строка) и «Фоны страниц» — обе вкладки сохраняются через один и тот же
// роут PUT /api/settings, поэтому и права на них совпадают.
async function requireSiteSettings(req, res, next) { await requireAuth(req, res, () => { if (!['admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет прав' }); next(); }); }
async function requireAdmin(req, res, next) { await requireAuth(req, res, () => { if (req.user.role !== 'admin') return res.status(403).json({ error: 'Только для администратора' }); next(); }); }
// Раздел «Реклама»: объявления/калькулятор/просмотр контрактов и статистики.
// Сюда же входит и редактирование контрактов — ограничение по конкретным
// полям для роли Advertising Dept. проверяется отдельно внутри самого
// роута PUT /api/contracts/:id (см. src/routes/contracts.js).
async function requireAdvertising(req, res, next) { await requireAuth(req, res, () => { if (!['advertising', 'curator_ad', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' }); next(); }); }
// Премии (премирование сотрудников отдела рекламы) — управление (не просмотр).
// Advertising Dept. сюда не входит: премии не входит в её ограниченный список прав.
async function requireBonusMgmt(req, res, next) { await requireAuth(req, res, () => { if (!['curator_ad', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' }); next(); }); }
// Сотрудники (ростер отдела рекламы) — управление (создание/редактирование/
// удаление) — Старший состав AD, Dep. Director, Лидер, Администратор (ростер
// сотрудников — часть повседневной работы отдела рекламы, поэтому Curator
// AD также имеет сюда полный доступ).
async function requireEmployeeMgmt(req, res, next) { await requireAuth(req, res, () => { if (!['curator_ad', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' }); next(); }); }
// Пользователи: просмотр списка — Старший состав AD, Dep. Director, Лидер,
// Администратор. Назначение ролей — тоже им всем, но у Старший состав AD доступ
// ограничен: она может выдавать/снимать ИСКЛЮЧИТЕЛЬНО роль Advertising
// Department (см. проверку внутри PUT /api/users/:id/role в src/routes/users.js).
async function requireUserMgmt(req, res, next) { await requireAuth(req, res, () => { if (!['curator_ad', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' }); next(); }); }
// Одобрение заявок на добавление контракта (см. /api/contracts/pending* в
// src/routes/contracts.js) — «Старший состав AD и выше»: Старший состав AD, Dep. Director,
// Лидер, Администратор. Advertising Dept. только подаёт заявки (см.
// requireAdvertising на POST /api/contracts/bulk), но не видит и не одобряет очередь.
async function requireContractApproval(req, res, next) { await requireAuth(req, res, () => { if (!['curator_ad', 'dep_director', 'admin', 'leader'].includes(req.user.role)) return res.status(403).json({ error: 'Нет доступа' }); next(); }); }

module.exports = {
  requireAuth, requireNewsEdit, requireNewsDelete, requireServices, requireTeam,
  requireSiteSettings, requireAdmin, requireAdvertising, requireBonusMgmt,
  requireEmployeeMgmt, requireUserMgmt, requireContractApproval,
};
