/**
 * Weazel News — Majestic RP
 * Render.com + Neon PostgreSQL (без карты)
 */
'use strict';
require('dotenv').config();

const express      = require('express');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const rateLimit    = require('express-rate-limit');
const helmet       = require('helmet');
const bcrypt       = require('bcrypt');
const { v4: uuid } = require('uuid');
const { Pool }     = require('pg');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');
const multer       = require('multer');

const PORT           = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex');
const BCRYPT_ROUNDS  = 12;
const DATABASE_URL   = process.env.DATABASE_URL;
const IS_PROD        = process.env.NODE_ENV === 'production';

if (!DATABASE_URL) {
  console.error('ОШИБКА: DATABASE_URL не задан!');
  process.exit(1);
}

const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const pool = new Pool({
  connectionString: DATABASE_URL,
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
      id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT DEFAULT '[]', sort_order INTEGER DEFAULT 0
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

  // Миграция: добавить роль 'advertising' (Advertising Department) в допустимые значения
  await query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK(role IN ('guest','editor','admin','advertising'))`);

  const adminEmail = process.env.ADMIN_EMAIL || 'computer52552@gmail.com';
  const adminPass  = process.env.ADMIN_PASSWORD || '098456964';
  const adminName  = process.env.ADMIN_NAME || 'degrees';
  const ex = await query('SELECT id FROM users WHERE email=$1', [adminEmail.toLowerCase()]);
  if (!ex.rows.length) {
    const hash = await bcrypt.hash(adminPass, BCRYPT_ROUNDS);
    await query('INSERT INTO users (id,name,email,pwd_hash,role) VALUES ($1,$2,$3,$4,$5)',
      [uuid(), adminName, adminEmail.toLowerCase(), hash, 'admin']);
    console.log('Администратор создан:', adminEmail);
  }
  console.log('База данных готова');
}

const app = express();
app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'","'unsafe-inline'"],
      // ВАЖНО: script-src-attr — отдельная директива от script-src.
      // Helmet по умолчанию ставит её в 'none', что блокирует ВСЕ
      // onclick="..." и подобные атрибуты, даже если script-src разрешает
      // unsafe-inline. Наш сайт построен на onclick-атрибутах — разрешаем явно.
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'","'unsafe-inline'","https://fonts.googleapis.com"],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'","https://fonts.gstatic.com"],
      imgSrc: ["'self'","data:","blob:","https:","http:"],
      frameSrc: ["'self'","https://online.fliphtml5.com","https://www.youtube.com","https://player.vimeo.com"],
      connectSrc: ["'self'"],
    }
  }, crossOriginEmbedderPolicy: false,
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(session({
  store: new pgSession({ pool, tableName: 'session', createTableIfMissing: false }),
  secret: SESSION_SECRET, resave: false, saveUninitialized: false, name: '__wn_sid',
  cookie: { httpOnly: true, secure: IS_PROD, sameSite: 'strict', maxAge: 7*24*60*60*1000 },
}));

const loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 10, message: { error: 'Слишком много попыток. Подождите 15 минут.' }, keyGenerator: r => hashIP(r.ip) });
const apiLimiter   = rateLimit({ windowMs: 60*1000, max: 200, message: { error: 'Слишком много запросов.' }, keyGenerator: r => hashIP(r.ip) });
app.use('/api/', apiLimiter);

function hashIP(ip) { return crypto.createHash('sha256').update((ip||'')+SESSION_SECRET).digest('hex').slice(0,16); }
function maskEmail(e) {
  if(!e)return'—'; const [l,d]=e.split('@'); if(!d)return e.slice(0,2)+'***';
  const ml=l.length>2?l.slice(0,2)+'*'.repeat(Math.min(l.length-2,4)):l;
  const p=d.split('.'); return ml+'@'+p[0].slice(0,2)+'***.'+p.slice(1).join('.');
}
function safeUser(u) { if(!u)return null; const {pwd_hash,...s}=u; return s; }
function parseJSON(s,d=[]) { try{return JSON.parse(s);}catch{return d;} }

async function requireAuth(req,res,next){
  if(!req.session?.userId) return res.status(401).json({error:'Требуется авторизация'});
  const r=await query('SELECT * FROM users WHERE id=$1',[req.session.userId]);
  if(!r.rows.length){req.session.destroy(()=>{});return res.status(401).json({error:'Сессия недействительна'});}
  req.user=r.rows[0];next();
}
async function requireEditor(req,res,next){ await requireAuth(req,res,()=>{ if(!['editor','admin'].includes(req.user.role))return res.status(403).json({error:'Нет прав'});next();}); }
async function requireAdmin(req,res,next){  await requireAuth(req,res,()=>{ if(req.user.role!=='admin')return res.status(403).json({error:'Только для администратора'});next();}); }
async function requireAdvertising(req,res,next){ await requireAuth(req,res,()=>{ if(!['advertising','admin'].includes(req.user.role))return res.status(403).json({error:'Нет доступа'});next();}); }

const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS_DIR, filename: (req,f,cb)=>cb(null,uuid()+path.extname(f.originalname).toLowerCase().replace(/[^.a-z0-9]/g,'')||'.jpg') }),
  limits: { fileSize: 15*1024*1024 },
  fileFilter: (req,f,cb) => { if(!f.mimetype.startsWith('image/'))return cb(new Error('Только изображения')); cb(null,true); }
});
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── GOOGLE APPS SCRIPT: поиск свободных слотов для объявлений ──────────────
// Вся логика поиска слотов живёт в скрипте ВНУТРИ самой Google Таблицы
// (Расширения → Apps Script), развёрнутом как веб-приложение.
// Наш сервер — просто прокси: получает запрос от сайта, пересылает
// в Apps Script, возвращает ответ. Настраивается ОДНОЙ переменной:
//   GOOGLE_APPS_SCRIPT_URL — ссылка вида https://script.google.com/macros/s/.../exec
// Полный код скрипта и инструкция — см. google-apps-script.gs и README.md

app.post('/api/ads/search', requireAdvertising, async (req, res) => {
  try {
    const scriptUrl = process.env.GOOGLE_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      return res.status(503).json({ error: 'Google Таблица не подключена. Обратитесь к администратору сайта — нужно указать переменную GOOGLE_APPS_SCRIPT_URL.' });
    }

    let { color, days, adsPerDay } = req.body;
    color = color === 'red' ? 'red' : 'green';
    days = Math.max(2, Math.min(7, parseInt(days, 10) || 2));
    adsPerDay = Math.max(2, Math.min(10, parseInt(adsPerDay, 10) || 2));

    const url = `${scriptUrl}?color=${encodeURIComponent(color)}&days=${days}&adsPerDay=${adsPerDay}`;
    const resp = await fetch(url, { redirect: 'follow' });

    if (!resp.ok) {
      return res.status(502).json({ error: `Google Apps Script вернул ошибку (код ${resp.status}). Проверь что скрипт развёрнут с доступом "Anyone".` });
    }

    const data = await resp.json();
    if (data.error) return res.status(502).json({ error: data.error });
    res.json(data);
  } catch (e) {
    console.error('Ads search error:', e.message);
    res.status(500).json({ error: 'Не удалось связаться с Google Apps Script: ' + e.message });
  }
});

// AUTH
app.post('/api/auth/login', loginLimiter, async (req,res) => {
  try {
    const {email,password}=req.body;
    if(!email||!password)return res.status(400).json({error:'Заполните все поля'});
    const ipHash=hashIP(req.ip);
    const att=await query('SELECT * FROM login_attempts WHERE ip_hash=$1',[ipHash]);
    const attempt=att.rows[0];
    if(attempt?.locked_until&&new Date(attempt.locked_until)>new Date()){
      const secs=Math.ceil((new Date(attempt.locked_until)-Date.now())/1000);
      return res.status(429).json({error:`Заблокировано. Подождите ${secs} сек.`});
    }
    const r=await query('SELECT * FROM users WHERE email=$1',[email.trim().toLowerCase()]);
    const user=r.rows[0];
    const hashToCheck=user?.pwd_hash||'$2b$12$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    const match=await bcrypt.compare(password,hashToCheck);
    if(!user||!match){
      const nc=(attempt?.count||0)+1;
      const lock=nc>=5?new Date(Date.now()+60000).toISOString():null;
      await query('INSERT INTO login_attempts (ip_hash,count,locked_until) VALUES ($1,$2,$3) ON CONFLICT (ip_hash) DO UPDATE SET count=$2,locked_until=$3',[ipHash,nc,lock]);
      return res.status(401).json({error:'Неверная почта или пароль'});
    }
    await query('DELETE FROM login_attempts WHERE ip_hash=$1',[ipHash]);
    await query('UPDATE users SET last_login=NOW() WHERE id=$1',[user.id]);
    req.session.regenerate(err=>{
      if(err)return res.status(500).json({error:'Ошибка сессии'});
      req.session.userId=user.id;
      res.json({user:safeUser(user)});
    });
  } catch(e){console.error(e.message);res.status(500).json({error:'Ошибка сервера'});}
});

app.post('/api/auth/register', loginLimiter, async (req,res) => {
  try {
    const {name,email,password}=req.body;
    if(!name||!email||!password)return res.status(400).json({error:'Заполните все поля'});
    if(password.length<6)return res.status(400).json({error:'Пароль минимум 6 символов'});
    if(!/\S+@\S+\.\S+/.test(email))return res.status(400).json({error:'Некорректный email'});
    const ex=await query('SELECT id FROM users WHERE email=$1',[email.trim().toLowerCase()]);
    if(ex.rows.length)return res.status(409).json({error:'Email уже используется'});
    const hash=await bcrypt.hash(password,BCRYPT_ROUNDS);
    const id=uuid();
    await query('INSERT INTO users (id,name,email,pwd_hash,role) VALUES ($1,$2,$3,$4,$5)',[id,name.trim(),email.trim().toLowerCase(),hash,'guest']);
    const r=await query('SELECT * FROM users WHERE id=$1',[id]);
    req.session.regenerate(err=>{
      if(err)return res.status(500).json({error:'Ошибка сессии'});
      req.session.userId=id;res.json({user:safeUser(r.rows[0])});
    });
  } catch(e){console.error(e.message);res.status(500).json({error:'Ошибка сервера'});}
});

app.post('/api/auth/logout',(req,res)=>{ req.session.destroy(()=>res.json({ok:true})); });
app.get('/api/auth/me', async (req,res)=>{ if(!req.session?.userId)return res.json({user:null}); try{const r=await query('SELECT * FROM users WHERE id=$1',[req.session.userId]);res.json({user:safeUser(r.rows[0])||null});}catch{res.json({user:null});} });

// USERS
app.get('/api/users',requireAdmin,async(req,res)=>{ const r=await query('SELECT id,name,email,role,created_at,last_login FROM users ORDER BY created_at');res.json(r.rows.map(u=>({...u,email:maskEmail(u.email)})));});
app.put('/api/users/:id/role',requireAdmin,async(req,res)=>{ const{role}=req.body;if(!['guest','editor','admin','advertising'].includes(role))return res.status(400).json({error:'Неверная роль'});if(req.params.id===req.user.id)return res.status(400).json({error:'Нельзя изменить свою роль'});await query('UPDATE users SET role=$1 WHERE id=$2',[role,req.params.id]);res.json({ok:true});});

// UPLOAD
app.post('/api/upload',requireEditor,upload.single('image'),(req,res)=>{ if(!req.file)return res.status(400).json({error:'Файл не загружен'});res.json({url:`/uploads/${req.file.filename}`});});

// NEWS
app.get('/api/news',async(req,res)=>{ try{const r=await query('SELECT * FROM news ORDER BY created_at DESC');res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}});
app.post('/api/news',requireEditor,async(req,res)=>{ try{const{title,category,excerpt,blocks,img,bg_img,align,title_color,text_color,created_at}=req.body;if(!title?.trim())return res.status(400).json({error:'Укажите заголовок'});const id=uuid();let dateVal=null;if(created_at){const d=new Date(created_at);if(!isNaN(d.getTime()))dateVal=d.toISOString();}await query('INSERT INTO news (id,title,category,excerpt,blocks,img,bg_img,align,title_color,text_color,author_id,author_name,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13,NOW()))',[id,title.trim(),category||'',excerpt||'',blocks||'[]',img||'',bg_img||'',align||'left',title_color||'',text_color||'',req.user.id,req.user.name,dateVal]);const r=await query('SELECT * FROM news WHERE id=$1',[id]);res.json(r.rows[0]);}catch(e){res.status(500).json({error:e.message});}});
app.put('/api/news/:id',requireEditor,async(req,res)=>{ try{const{title,category,excerpt,blocks,img,bg_img,align,title_color,text_color,created_at}=req.body;if(!title?.trim())return res.status(400).json({error:'Укажите заголовок'});let dateVal=null;if(created_at){const d=new Date(created_at);if(!isNaN(d.getTime()))dateVal=d.toISOString();}await query('UPDATE news SET title=$1,category=$2,excerpt=$3,blocks=$4,img=$5,bg_img=$6,align=$7,title_color=$8,text_color=$9,created_at=COALESCE($10,created_at),updated_at=NOW() WHERE id=$11',[title.trim(),category||'',excerpt||'',blocks||'[]',img||'',bg_img||'',align||'left',title_color||'',text_color||'',dateVal,req.params.id]);res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});
app.delete('/api/news/:id',requireEditor,async(req,res)=>{ await query('DELETE FROM news WHERE id=$1',[req.params.id]);res.json({ok:true});});

// SERVICES
app.get('/api/services',async(req,res)=>{ const r=await query('SELECT * FROM services ORDER BY sort_order');res.json(r.rows.map(s=>({...s,items:parseJSON(s.items)})));});
app.post('/api/services',requireEditor,async(req,res)=>{ const{name,items}=req.body;if(!name?.trim())return res.status(400).json({error:'Укажите название'});const id=uuid();await query('INSERT INTO services (id,name,items) VALUES ($1,$2,$3)',[id,name.trim(),JSON.stringify(items||[])]);res.json({id,name,items:items||[]});});
app.put('/api/services/:id',requireEditor,async(req,res)=>{ const{name,items}=req.body;await query('UPDATE services SET name=$1,items=$2 WHERE id=$3',[name,JSON.stringify(items||[]),req.params.id]);res.json({ok:true});});
app.delete('/api/services/:id',requireEditor,async(req,res)=>{ await query('DELETE FROM services WHERE id=$1',[req.params.id]);res.json({ok:true});});

// TEAM
app.get('/api/team',async(req,res)=>{ const c=await query('SELECT * FROM team_cats ORDER BY sort_order');const m=await query('SELECT * FROM team_members ORDER BY sort_order');res.json({cats:c.rows,members:m.rows});});
app.post('/api/team/cats',requireEditor,async(req,res)=>{ const{name,layout}=req.body;if(!name?.trim())return res.status(400).json({error:'Укажите название'});const id=uuid();await query('INSERT INTO team_cats (id,name,layout) VALUES ($1,$2,$3)',[id,name.trim(),layout||'pyramid']);res.json({id,name,layout:layout||'pyramid'});});
app.put('/api/team/cats/:id',requireEditor,async(req,res)=>{ const{name,layout}=req.body;await query('UPDATE team_cats SET name=$1,layout=$2 WHERE id=$3',[name,layout||'pyramid',req.params.id]);res.json({ok:true});});
app.delete('/api/team/cats/:id',requireEditor,async(req,res)=>{ await query('DELETE FROM team_cats WHERE id=$1',[req.params.id]);res.json({ok:true});});
app.post('/api/team/members',requireEditor,async(req,res)=>{ const{cat_id,name,role,photo}=req.body;if(!name?.trim())return res.status(400).json({error:'Укажите имя'});const id=uuid();await query('INSERT INTO team_members (id,cat_id,name,role,photo) VALUES ($1,$2,$3,$4,$5)',[id,cat_id,name.trim(),role||'',photo||'']);res.json({id,cat_id,name,role,photo});});
app.put('/api/team/members/:id',requireEditor,async(req,res)=>{ const{cat_id,name,role,photo}=req.body;await query('UPDATE team_members SET cat_id=$1,name=$2,role=$3,photo=$4 WHERE id=$5',[cat_id,name,role||'',photo||'',req.params.id]);res.json({ok:true});});
app.delete('/api/team/members/:id',requireEditor,async(req,res)=>{ await query('DELETE FROM team_members WHERE id=$1',[req.params.id]);res.json({ok:true});});

// SETTINGS
app.get('/api/settings',async(req,res)=>{ const r=await query('SELECT key,value FROM site_settings');const s={};r.rows.forEach(row=>{try{s[row.key]=JSON.parse(row.value);}catch{s[row.key]=row.value;}});res.json(s);});
app.put('/api/settings',requireEditor,async(req,res)=>{ try{for(const[k,v]of Object.entries(req.body)){await query('INSERT INTO site_settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2',[k,JSON.stringify(v)]);}res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}});

// VISITORS
app.post('/api/visitors',async(req,res)=>{ try{const{page}=req.body;let name='Гость';if(req.session?.userId){const r=await query('SELECT name FROM users WHERE id=$1',[req.session.userId]);name=r.rows[0]?.name||'Гость';}await query('INSERT INTO visitors (user_name,page,ip_hash) VALUES ($1,$2,$3)',[name,page||'?',hashIP(req.ip)]);await query('DELETE FROM visitors WHERE id NOT IN (SELECT id FROM visitors ORDER BY id DESC LIMIT 500)');res.json({ok:true});}catch{res.json({ok:true});}});
app.get('/api/visitors',requireAdmin,async(req,res)=>{ const r=await query('SELECT user_name,page,visited_at FROM visitors ORDER BY id DESC LIMIT 200');res.json(r.rows);});

// FRONTEND
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.use((err,req,res,next)=>{ if(err.code==='LIMIT_FILE_SIZE')return res.status(400).json({error:'Файл слишком большой (макс. 15MB)'});console.error(err.message);res.status(500).json({error:'Ошибка сервера'});});

initDB().then(()=>{ app.listen(PORT,'0.0.0.0',()=>console.log(`Weazel News: http://localhost:${PORT}`)); }).catch(e=>{ console.error('Ошибка запуска:',e.message);process.exit(1); });
