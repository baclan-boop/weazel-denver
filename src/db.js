/**
 * Weazel News — подключение к Postgres и инициализация схемы.
 */
'use strict';
const { Pool }     = require('pg');
const bcrypt       = require('bcrypt');
const { v4: uuid } = require('uuid');
const config       = require('./config');

const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initDB() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
      pwd_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'guest'
        CHECK(role IN ('guest','editor','admin')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_login TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS news (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT DEFAULT '',
      excerpt TEXT DEFAULT '', blocks TEXT DEFAULT '[]',
      img TEXT DEFAULT '', bg_img TEXT DEFAULT '', align TEXT DEFAULT 'left',
      title_color TEXT DEFAULT '', text_color TEXT DEFAULT '',
      author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      author_name TEXT DEFAULT 'Редакция',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS services (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT DEFAULT '[]', sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS team_cats (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, layout TEXT DEFAULT 'pyramid', sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY, cat_id TEXT REFERENCES team_cats(id) ON DELETE CASCADE,
      name TEXT NOT NULL, role TEXT DEFAULT '', photo TEXT DEFAULT '', sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS visitors (
      id SERIAL PRIMARY KEY, user_name TEXT DEFAULT 'Гость',
      page TEXT DEFAULT '', ip_hash TEXT DEFAULT '',
      visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Статистика посещений сайта: 1 запись = 1 уникальное устройство за 1 день
    -- (UNIQUE(visitor_id,visit_date) + ON CONFLICT DO NOTHING при записи).
    -- Не путать с таблицей visitors выше — там сырой журнал КАЖДОГО перехода
    -- между разделами сайта, здесь — дедуплицированные посещения для статистики.
    CREATE TABLE IF NOT EXISTS site_visits (
      id TEXT PRIMARY KEY, visitor_id TEXT NOT NULL,
      visit_date DATE NOT NULL, ip_hash TEXT DEFAULT '',
      first_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(visitor_id, visit_date)
    );
    CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits(visit_date);
    -- Журнал редактирования полей: 1 запись = 1 сохранение с массивом
    -- изменённых полей {field, before, after}. Видно только Администратору
    -- (см. requireAdmin на роуте /api/edit-logs) — роль Leader сюда доступа
    -- не имеет, как и к /api/site-visits/stats.
    CREATE TABLE IF NOT EXISTS edit_logs (
      id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      user_name TEXT DEFAULT 'Система', entity TEXT NOT NULL, entity_id TEXT DEFAULT '',
      entity_label TEXT DEFAULT '', changes JSONB NOT NULL DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_edit_logs_created ON edit_logs(created_at DESC);
    CREATE TABLE IF NOT EXISTS site_settings (key TEXT PRIMARY KEY, value TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip_hash TEXT PRIMARY KEY, count INTEGER DEFAULT 0, locked_until TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS session (
      sid TEXT PRIMARY KEY, sess JSONB NOT NULL, expire TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS session_expire ON session(expire);
  `);

  // Миграция: добавить новые колонки если БД уже существует
  await query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS title_color TEXT DEFAULT ''`);
  await query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS text_color TEXT DEFAULT ''`);

  // Миграция: добавить роли 'advertising' (Advertising Department) и 'curator_ad' (Curator AD)
  // + 'leader' (Лидер — доступ как у Администратора, кроме статистики
  // посещений и журнала редактирования, см. requireAdmin ниже)
  // + 'dep_director' (Dep. Director — см. requireNewsEdit/requireServices/
  // requireTeam/requireSiteSettings/requireAdvertising/requireUserMgmt/
  // requireEmployeeMgmt в src/middleware/auth.js за подробным разбором прав этой роли).
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('guest','editor','admin','advertising','curator_ad','leader','dep_director'))`);

  // ─── Модуль «Контракты» (роли, таблица контрактов, калькулятор, статистика) ───
  await query(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, static_id TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT true, sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS contract_slots (
      id TEXT PRIMARY KEY,
      color TEXT NOT NULL CHECK(color IN ('green','red')),
      slot_date DATE NOT NULL,
      slot_time TEXT NOT NULL,
      status BOOLEAN NOT NULL DEFAULT false,
      price NUMERIC NOT NULL DEFAULT 0,
      text TEXT DEFAULT '',
      accepted_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
      declined_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
      payout NUMERIC NOT NULL DEFAULT 0,
      transfer_time TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(color, slot_date, slot_time)
    );
    CREATE INDEX IF NOT EXISTS idx_contract_slots_date ON contract_slots(slot_date);
    CREATE TABLE IF NOT EXISTS bonuses (
      id TEXT PRIMARY KEY,
      employee_id TEXT REFERENCES employees(id) ON DELETE CASCADE,
      week_start DATE NOT NULL,
      amount NUMERIC NOT NULL DEFAULT 0,
      comment TEXT DEFAULT '',
      paid BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_bonuses_week ON bonuses(week_start);
    -- Заявки на добавление контракта, ожидающие одобрения Curator AD и выше
    -- (см. requireContractApproval и /api/contracts/pending* в
    -- src/routes/contracts.js). Contract Bulk-форма «Добавить контракт»
    -- теперь не пишет сразу в contract_slots, а создаёт здесь запись со
    -- статусом 'pending' — она попадает в contract_slots только после /approve.
    CREATE TABLE IF NOT EXISTS pending_contracts (
      id TEXT PRIMARY KEY,
      color TEXT NOT NULL CHECK(color IN ('green','red')),
      times TEXT NOT NULL DEFAULT '[]',
      dates TEXT NOT NULL DEFAULT '[]',
      text TEXT NOT NULL DEFAULT '',
      accepted_id TEXT REFERENCES employees(id) ON DELETE SET NULL,
      discount NUMERIC NOT NULL DEFAULT 0,
      submitted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      submitted_by_name TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_by_name TEXT DEFAULT '',
      reviewed_at TIMESTAMPTZ,
      reject_reason TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_pending_contracts_status ON pending_contracts(status);
  `);

  // Миграция: шрифт для описания (должности) участника состава
  await query(`ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role_font TEXT DEFAULT ''`);

  // Миграция: дата создания категории услуг (нужна для защиты от дублей при двойной отправке формы)
  await query(`ALTER TABLE services ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

  // Миграция: если sort_order ещё не проставлен (старые данные до этой версии) —
  // заполняем его на основе текущего физического порядка строк (ctid), чтобы
  // кнопки "переместить вверх/вниз" сразу заработали на уже существующих данных.
  // На новых записях sort_order выставляется явно при создании — эта миграция
  // их не трогает.
  await query(`
    UPDATE team_members m SET sort_order = sub.rn
    FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY cat_id ORDER BY ctid) AS rn FROM team_members) sub
    WHERE m.id = sub.id AND m.sort_order = 0
  `);
  await query(`
    UPDATE team_cats c SET sort_order = sub.rn
    FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY ctid) AS rn FROM team_cats) sub
    WHERE c.id = sub.id AND c.sort_order = 0
  `);

  const ex = await query('SELECT id FROM users WHERE email=$1', [config.ADMIN_EMAIL.toLowerCase()]);
  if (!ex.rows.length) {
    const hash = await bcrypt.hash(config.ADMIN_PASSWORD, config.BCRYPT_ROUNDS);
    await query('INSERT INTO users (id,name,email,pwd_hash,role) VALUES ($1,$2,$3,$4,$5)',
      [uuid(), config.ADMIN_NAME, config.ADMIN_EMAIL.toLowerCase(), hash, 'admin']);
    console.log('Администратор создан:', config.ADMIN_EMAIL);
  }
  console.log('База данных готова');
}

module.exports = { pool, query, initDB };
