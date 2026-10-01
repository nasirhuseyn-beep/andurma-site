require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const app = express();

// ---------- POSTGRESQL BAĞLANTI ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ---------- AĞILLI WRAPPER (SQLite → PostgreSQL) ----------
function convertSql(sql) {
  let counter = 1;
  return sql.replace(/\?/g, () => `$${counter++}`);
}

const db = {
  get: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertSql(sql);
    pool.query(pgSql, params || [])
      .then(result => callback(null, result.rows[0]))
      .catch(err => callback(err));
  },
  all: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertSql(sql);
    pool.query(pgSql, params || [])
      .then(result => callback(null, result.rows))
      .catch(err => callback(err));
  },
  run: (sql, params, callback) => {
    if (typeof params === 'function') {
      callback = params;
      params = [];
    }
    const pgSql = convertSql(sql);
    pool.query(pgSql, params || [])
      .then(result => {
        if (callback) callback(null, result);
      })
      .catch(err => {
        if (callback) callback(err);
        else console.error('DB Error:', err.message);
      });
  },
  serialize: (callback) => {
    if (callback) callback();
  }
};

// ---------- VERİLƏNLƏR BAZASI SXEMİ ----------
async function initDatabase() {
  try {
    // USERS cədvəli (rol sistemi ilə)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        full_name TEXT,
        email TEXT,
        role TEXT DEFAULT 'editor',
        active INTEGER DEFAULT 1,
        permissions TEXT,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // NEWS cədvəli (xəbərlər / görülən işlər)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news (
        id SERIAL PRIMARY KEY,
        title TEXT,
        category TEXT,
        content TEXT,
        location TEXT,
        image TEXT,
        video TEXT,
        author_id INTEGER,
        author_name TEXT,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // ARTICLES cədvəli (məqalələr)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS articles (
        id SERIAL PRIMARY KEY,
        title TEXT,
        content TEXT,
        image TEXT,
        author_id INTEGER,
        author_name TEXT,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // KOSHE cədvəli (köşə yazıları)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS koshe (
        id SERIAL PRIMARY KEY,
        title TEXT,
        content TEXT,
        image TEXT,
        author_id INTEGER,
        author_name TEXT,
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // GALLERY cədvəli (foto/video qalereya)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gallery (
        id SERIAL PRIMARY KEY,
        title TEXT,
        image TEXT,
        video TEXT,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // COMMENTS cədvəli (şərhlər)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        content_type TEXT,
        content_id INTEGER,
        name TEXT,
        text TEXT,
        approved INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // SETTINGS cədvəli
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // CONTACT cədvəli (əlaqə mesajları)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone TEXT,
        email TEXT,
        message TEXT,
        read INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Default settings
    const defaultSettings = [
      ['site_name', 'Andurma Kəndi'],
      ['hero_title', 'Andurma Kəndinə Xoş Gəldiniz'],
      ['hero_subtitle', 'Yaşıl təbiətin qoynunda bir kənd'],
      ['hero_image', ''],
      ['logo', ''],
      ['about_title', 'Kənd Haqqında'],
      ['about_text', 'Andurma kəndi Qəbələ rayonunda yerləşir...'],
      ['contact_phone', ''],
      ['contact_email', ''],
      ['contact_address', 'Andurma kəndi, Qəbələ rayonu'],
      ['social_facebook', ''],
      ['social_instagram', ''],
      ['social_youtube', ''],
      ['footer_text', '© 2026 Andurma Kəndi — Bütün hüquqlar qorunur.']
    ];

    for (const [key, value] of defaultSettings) {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2) 
         ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }

    // Default SUPER ADMIN
    const hash = bcrypt.hashSync('admin123', 10);
    await pool.query(
      `INSERT INTO users (id, username, password, full_name, role, active, permissions) 
       VALUES (1, 'admin', $1, 'Super Admin', 'super_admin', 1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [hash, JSON.stringify({
        can_add_news: true,
        can_add_articles: true,
        can_add_koshe: true,
        can_add_gallery: true,
        can_manage_users: true,
        can_manage_settings: true,
        can_approve_comments: true
      })]
    );

    console.log('✅ Database initialized (PostgreSQL)');
  } catch (err) {
    console.error('❌ Database init error:', err.message);
  }
}

// ---------- MIDDLEWARE ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
  secret: 'andurma-secret-key-2026',
  resave: false,
  saveUninitialized: false
}));

// DB-ni hər request-də əlçatan et + settings yüklə
app.use((req, res, next) => {
  req.db = db;
  res.locals.user = req.session.user || null;
  
  db.all('SELECT key, value FROM settings', (err, rows) => {
    const settings = {};
    if (rows) {
      rows.forEach(r => settings[r.key] = r.value);
    }
    res.locals.settings = settings;
    next();
  });
});

// ---------- MARŞRUTLAR ----------
app.use('/', require('./routes/public')(db));
app.use('/admin', require('./routes/admin')(db));

// ---------- BAŞLAT ----------
const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log('=================================');
    console.log('✅ Andurma saytı işləyir: http://localhost:' + PORT);
    console.log('🔐 Admin: http://localhost:' + PORT + '/admin/login');
    console.log('👤 Super Admin: admin / admin123');
    console.log('📊 Database: PostgreSQL (Supabase)');
    console.log('=================================');
  });
});