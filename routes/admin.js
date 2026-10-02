const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|webp|mp4|webm|mov/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) return cb(null, true);
    cb(new Error('Yalnız şəkil və video faylları yüklənə bilər!'));
  }
});

async function uploadToSupabase(supabase, file, folder = '') {
  if (!file) return null;
  const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_').toLowerCase();
  const fileName = folder ? `${folder}/${Date.now()}-${cleanName}` : `${Date.now()}-${cleanName}`;
  const { error } = await supabase.storage
    .from(process.env.SUPABASE_BUCKET)
    .upload(fileName, file.buffer, { contentType: file.mimetype, upsert: false });
  if (error) { console.error('Supabase upload error:', error); return null; }
  const { data: urlData } = supabase.storage.from(process.env.SUPABASE_BUCKET).getPublicUrl(fileName);
  return urlData.publicUrl;
}

module.exports = (db) => {
  const router = express.Router();

  function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/admin/login');
  }
  function requireSuperAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'super_admin') return next();
    res.status(403).send('Icaze yoxdur. Yalniz Super Admin.');
  }

  // LOGIN
  router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.render('admin/login', { error: null });
  });
  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? AND active = 1', [username], (err, user) => {
      if (!user || !bcrypt.compareSync(password, user.password)) return res.render('admin/login', { error: 'Istifadeci adi ve ya sifre yanlisdir' });
      let permissions = {};
      try { permissions = user.permissions ? JSON.parse(user.permissions) : {}; } catch(e) {}
      req.session.user = { id: user.id, username: user.username, full_name: user.full_name, role: user.role, permissions };
      db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      res.redirect('/admin');
    });
  });
  router.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/admin/login'); });

  // DASHBOARD
  router.get('/', requireAuth, (req, res) => {
    const user = req.session.user;
    if (user.role === 'super_admin') {
      db.get('SELECT COUNT(*) as c FROM news', (e, n) => {
        db.get('SELECT COUNT(*) as c FROM articles', (e, a) => {
          db.get('SELECT COUNT(*) as c FROM koshe', (e, k) => {
            db.get('SELECT COUNT(*) as c FROM places', (e, p) => {
              db.get('SELECT COUNT(*) as c FROM comments WHERE approved = 0', (e, c) => {
                db.get('SELECT COUNT(*) as c FROM users', (e, u) => {
                  db.get('SELECT SUM(views) as total_views, SUM(likes) as total_likes FROM news', (e, s) => {
                    res.render('admin/dashboard', { user, newsCount: n?n.c:0, articleCount: a?a.c:0, kosheCount: k?k.c:0, placeCount: p?p.c:0, pendingComments: c?c.c:0, userCount: u?u.c:0, totalViews: s?(s.total_views||0):0, totalLikes: s?(s.total_likes||0):0 });
                  });
                });
              });
            });
          });
        });
      });
    } else {
      db.get('SELECT COUNT(*) as c FROM news WHERE author_id = ?', [user.id], (e, n) => {
        db.get('SELECT COUNT(*) as c FROM articles WHERE author_id = ?', [user.id], (e, a) => {
          db.get('SELECT COUNT(*) as c FROM koshe WHERE author_id = ?', [user.id], (e, k) => {
            db.get('SELECT COUNT(*) as c FROM places', (e, p) => {
              db.get('SELECT SUM(views) as total_views, SUM(likes) as total_likes FROM news WHERE author_id = ?', [user.id], (e, s) => {
                res.render('admin/dashboard', { user, newsCount: n?n.c:0, articleCount: a?a.c:0, kosheCount: k?k.c:0, placeCount: p?p.c:0, pendingComments: 0, userCount: 0, totalViews: s?(s.total_views||0):0, totalLikes: s?(s.total_likes||0):0 });
              });
            });
          });
        });
      });
    }
  });

  // İSTİFADƏÇİLƏR
  router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, users) => { if (err) users = []; res.render('admin/users', { users }); });
  });
  router.get('/users/new', requireAuth, requireSuperAdmin, (req, res) => { res.render('admin/user-form', { user: null, error: null }); });
  router.post('/users/new', requireAuth, requireSuperAdmin, (req, res) => {
    const { username, password, full_name, email, role } = req.body;
    if (!username || !password) return res.render('admin/user-form', { user: null, error: 'Bos saheler' });
    const permissions = { can_add_news: req.body.can_add_news === 'on', can_add_articles: req.body.can_add_articles === 'on', can_add_koshe: req.body.can_add_koshe === 'on', can_add_gallery: req.body.can_add_gallery === 'on', can_manage_users: false, can_manage_settings: false, can_approve_comments: req.body.can_approve_comments === 'on' };
    const hash = bcrypt.hashSync(password, 10);
    db.run(`INSERT INTO users (username, password, full_name, email, role, active, permissions) VALUES (?, ?, ?, ?, ?, 1, ?)`, [username, hash, full_name, email, role || 'editor', JSON.stringify(permissions)], (err) => {
      if (err) return res.render('admin/user-form', { user: null, error: 'Bu istifadeci adi artiq movcuddur' });
      res.redirect('/admin/users');
    });
  });
  router.get('/users/edit/:id', requireAuth, requireSuperAdmin, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.params.id], (err, user) => {
      if (!user) return res.redirect('/admin/users');
      let permissions = {};
      try { permissions = user.permissions ? JSON.parse(user.permissions) : {}; } catch(e) {}
      user.permissionsObj = permissions;
      res.render('admin/user-form', { user, error: null });
    });
  });
  router.post('/users/edit/:id', requireAuth, requireSuperAdmin, (req, res) => {
    const { username, password, full_name, email, role, active } = req.body;
    const permissions = { can_add_news: req.body.can_add_news === 'on', can_add_articles: req.body.can_add_articles === 'on', can_add_koshe: req.body.can_add_koshe === 'on', can_add_gallery: req.body.can_add_gallery === 'on', can_manage_users: false, can_manage_settings: false, can_approve_comments: req.body.can_approve_comments === 'on' };
    let sql = 'UPDATE users SET username=?, full_name=?, email=?, role=?, active=?, permissions=?';
    let params = [username, full_name, email, role || 'editor', active === 'on' ? 1 : 0, JSON.stringify(permissions)];
    if (password && password.length > 0) { sql += ', password=?'; params.push(bcrypt.hashSync(password, 10)); }
    sql += ' WHERE id=?';
    params.push(req.params.id);
    db.run(sql, params, () => res.redirect('/admin/users'));
  });
  router.post('/users/delete/:id', requireAuth, requireSuperAdmin, (req, res) => {
    if (parseInt(req.params.id) === req.session.user.id) return res.redirect('/admin/users');
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], () => res.redirect('/admin/users'));
  });

  // XƏBƏRLƏR
  router.get('/news', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    if (user.role === 'super_admin') { query = 'SELECT * FROM news ORDER BY created_at DESC'; params = []; }
    else { query = 'SELECT * FROM news WHERE author_id = ? ORDER BY created_at DESC'; params = [user.id]; }
    db.all(query, params, (err, news) => { if (err) news = []; res.render('admin/news', { news, user }); });
  });
  router.get('/news/new', requireAuth, (req, res) => { res.render('admin/news-form', { news: null }); });
  router.post('/news/new', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), async (req, res) => {
    const { title, category, content, location } = req.body;
    const image = req.files?.image ? await uploadToSupabase(req.supabase, req.files.image[0], 'news') : null;
    const video = req.files?.video ? await uploadToSupabase(req.supabase, req.files.video[0], 'news') : null;
    db.run('INSERT INTO news (title, category, content, location, image, video, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, category, content, location, image, video, req.session.user.id, req.session.user.full_name || req.session.user.username],
      () => res.redirect('/admin/news'));
  });
  router.get('/news/edit/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, news) => {
      if (!news) return res.redirect('/admin/news');
      if (req.session.user.role !== 'super_admin' && news.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      res.render('admin/news-form', { news });
    });
  });
  router.post('/news/edit/:id', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), async (req, res) => {
    const { title, category, content, location } = req.body;
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], async (err, old) => {
      if (!old) return res.redirect('/admin/news');
      if (req.session.user.role !== 'super_admin' && old.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      const image = req.files?.image ? await uploadToSupabase(req.supabase, req.files.image[0], 'news') : old.image;
      const video = req.files?.video ? await uploadToSupabase(req.supabase, req.files.video[0], 'news') : old.video;
      db.run('UPDATE news SET title=?, category=?, content=?, location=?, image=?, video=? WHERE id=?',
        [title, category, content, location, image, video, req.params.id], () => res.redirect('/admin/news'));
    });
  });
  router.post('/news/delete/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, news) => {
      if (!news) return res.redirect('/admin/news');
      if (req.session.user.role !== 'super_admin' && news.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      db.run('DELETE FROM news WHERE id = ?', [req.params.id], () => res.redirect('/admin/news'));
    });
  });

  // MƏQALƏLƏR
  router.get('/articles', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    if (user.role === 'super_admin') { query = 'SELECT * FROM articles ORDER BY created_at DESC'; params = []; }
    else { query = 'SELECT * FROM articles WHERE author_id = ? ORDER BY created_at DESC'; params = [user.id]; }
    db.all(query, params, (err, articles) => { if (err) articles = []; res.render('admin/articles', { articles, user }); });
  });
  router.get('/articles/new', requireAuth, (req, res) => { res.render('admin/article-form', { article: null }); });
  router.post('/articles/new', requireAuth, upload.single('image'), async (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'articles') : null;
    db.run('INSERT INTO articles (title, content, image, author_id, author_name) VALUES (?, ?, ?, ?, ?)',
      [title, content, image, req.session.user.id, req.session.user.full_name || req.session.user.username],
      () => res.redirect('/admin/articles'));
  });
  router.get('/articles/edit/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
      if (!article) return res.redirect('/admin/articles');
      if (req.session.user.role !== 'super_admin' && article.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      res.render('admin/article-form', { article });
    });
  });
  router.post('/articles/edit/:id', requireAuth, upload.single('image'), async (req, res) => {
    const { title, content } = req.body;
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], async (err, old) => {
      if (!old) return res.redirect('/admin/articles');
      if (req.session.user.role !== 'super_admin' && old.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'articles') : old.image;
      db.run('UPDATE articles SET title=?, content=?, image=? WHERE id=?', [title, content, image, req.params.id], () => res.redirect('/admin/articles'));
    });
  });
  router.post('/articles/delete/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
      if (!article) return res.redirect('/admin/articles');
      if (req.session.user.role !== 'super_admin' && article.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      db.run('DELETE FROM articles WHERE id = ?', [req.params.id], () => res.redirect('/admin/articles'));
    });
  });

  // KÖŞƏ
  router.get('/koshe', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    if (user.role === 'super_admin') { query = 'SELECT * FROM koshe ORDER BY created_at DESC'; params = []; }
    else { query = 'SELECT * FROM koshe WHERE author_id = ? ORDER BY created_at DESC'; params = [user.id]; }
    db.all(query, params, (err, koshe) => { if (err) koshe = []; res.render('admin/koshe', { koshe, user }); });
  });
  router.get('/koshe/new', requireAuth, (req, res) => { res.render('admin/koshe-form', { koshe: null }); });
  router.post('/koshe/new', requireAuth, upload.single('image'), async (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'koshe') : null;
    db.run('INSERT INTO koshe (title, content, image, author_id, author_name) VALUES (?, ?, ?, ?, ?)',
      [title, content, image, req.session.user.id, req.session.user.full_name || req.session.user.username],
      () => res.redirect('/admin/koshe'));
  });
  router.get('/koshe/edit/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], (err, koshe) => {
      if (!koshe) return res.redirect('/admin/koshe');
      if (req.session.user.role !== 'super_admin' && koshe.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      res.render('admin/koshe-form', { koshe });
    });
  });
  router.post('/koshe/edit/:id', requireAuth, upload.single('image'), async (req, res) => {
    const { title, content } = req.body;
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], async (err, old) => {
      if (!old) return res.redirect('/admin/koshe');
      if (req.session.user.role !== 'super_admin' && old.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'koshe') : old.image;
      db.run('UPDATE koshe SET title=?, content=?, image=? WHERE id=?', [title, content, image, req.params.id], () => res.redirect('/admin/koshe'));
    });
  });
  router.post('/koshe/delete/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], (err, koshe) => {
      if (!koshe) return res.redirect('/admin/koshe');
      if (req.session.user.role !== 'super_admin' && koshe.author_id !== req.session.user.id) return res.status(403).send('Icaze yoxdur');
      db.run('DELETE FROM koshe WHERE id = ?', [req.params.id], () => res.redirect('/admin/koshe'));
    });
  });

  // QALEREYA
  router.get('/gallery', requireAuth, (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY created_at DESC', (err, gallery) => { if (err) gallery = []; res.render('admin/gallery', { gallery }); });
  });
  router.get('/gallery/new', requireAuth, (req, res) => { res.render('admin/gallery-form', { item: null }); });
  router.post('/gallery/new', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), async (req, res) => {
    const { title, description } = req.body;
    const image = req.files?.image ? await uploadToSupabase(req.supabase, req.files.image[0], 'gallery') : null;
    const video = req.files?.video ? await uploadToSupabase(req.supabase, req.files.video[0], 'gallery') : null;
    db.run('INSERT INTO gallery (title, image, video, description) VALUES (?, ?, ?, ?)',
      [title, image, video, description], () => res.redirect('/admin/gallery'));
  });
  router.post('/gallery/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM gallery WHERE id = ?', [req.params.id], () => res.redirect('/admin/gallery'));
  });

  // GÖRMƏLİ YERLƏR
  router.get('/places', requireAuth, (req, res) => {
    db.all('SELECT * FROM places ORDER BY created_at DESC', (err, places) => { if (err) places = []; res.render('admin/places', { places }); });
  });
  router.get('/places/new', requireAuth, (req, res) => { res.render('admin/place-form', { place: null }); });
  router.post('/places/new', requireAuth, upload.single('image'), async (req, res) => {
    const { title, description, location, map_link, youtube_link } = req.body;
    const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'places') : null;
    db.run('INSERT INTO places (title, description, image, location, map_link, youtube_link) VALUES (?, ?, ?, ?, ?, ?)',
      [title, description, image, location, map_link, youtube_link], () => res.redirect('/admin/places'));
  });
  router.get('/places/edit/:id', requireAuth, (req, res) => {
    db.get('SELECT * FROM places WHERE id = ?', [req.params.id], (err, place) => {
      if (!place) return res.redirect('/admin/places');
      res.render('admin/place-form', { place });
    });
  });
  router.post('/places/edit/:id', requireAuth, upload.single('image'), async (req, res) => {
    const { title, description, location, map_link, youtube_link } = req.body;
    db.get('SELECT * FROM places WHERE id = ?', [req.params.id], async (err, old) => {
      if (!old) return res.redirect('/admin/places');
      const image = req.file ? await uploadToSupabase(req.supabase, req.file, 'places') : old.image;
      db.run('UPDATE places SET title=?, description=?, image=?, location=?, map_link=?, youtube_link=? WHERE id=?',
        [title, description, image, location, map_link, youtube_link, req.params.id], () => res.redirect('/admin/places'));
    });
  });
  router.post('/places/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM places WHERE id = ?', [req.params.id], () => res.redirect('/admin/places'));
  });

  // ŞƏRHLƏR
  router.get('/comments', requireAuth, (req, res) => {
    db.all('SELECT * FROM comments ORDER BY created_at DESC', (err, comments) => { if (err) comments = []; res.render('admin/comments', { comments }); });
  });
  router.post('/comments/approve/:id', requireAuth, (req, res) => {
    db.run('UPDATE comments SET approved = 1 WHERE id = ?', [req.params.id], () => res.redirect('/admin/comments'));
  });
  router.post('/comments/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM comments WHERE id = ?', [req.params.id], () => res.redirect('/admin/comments'));
  });

  // MESAJLAR
  router.get('/messages', requireAuth, (req, res) => {
    db.all('SELECT * FROM contact ORDER BY created_at DESC', (err, messages) => { if (err) messages = []; res.render('admin/messages', { messages }); });
  });
  router.post('/messages/read/:id', requireAuth, (req, res) => {
    db.run('UPDATE contact SET read = 1 WHERE id = ?', [req.params.id], () => res.redirect('/admin/messages'));
  });
  router.post('/messages/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM contact WHERE id = ?', [req.params.id], () => res.redirect('/admin/messages'));
  });

  // SAZLAMALAR
  router.get('/settings', requireAuth, requireSuperAdmin, (req, res) => {
    db.all('SELECT key, value FROM settings', (err, rows) => {
      const settings = {};
      if (rows) rows.forEach(r => settings[r.key] = r.value);
      res.render('admin/settings', { settings, saved: req.query.saved });
    });
  });
  router.post('/settings', requireAuth, requireSuperAdmin, upload.fields([{ name: 'hero_image' }, { name: 'logo' }]), async (req, res) => {
    const fields = ['site_name', 'site_tagline', 'hero_title', 'hero_subtitle', 'about_title', 'about_text', 'contact_phone', 'contact_email', 'contact_address', 'contact_map', 'social_facebook', 'social_instagram', 'social_youtube', 'footer_text', 'stat_1_icon', 'stat_1_number', 'stat_1_label', 'stat_2_icon', 'stat_2_number', 'stat_2_label', 'stat_3_icon', 'stat_3_number', 'stat_3_label', 'stat_4_icon', 'stat_4_number', 'stat_4_label'];
    for (const field of fields) {
      if (req.body[field] !== undefined) {
        db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [field, req.body[field]]);
      }
    }
    if (req.files?.hero_image) {
      const img = await uploadToSupabase(req.supabase, req.files.hero_image[0], 'settings');
      if (img) db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['hero_image', img]);
    }
    if (req.files?.logo) {
      const logo = await uploadToSupabase(req.supabase, req.files.logo[0], 'settings');
      if (logo) db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', ['logo', logo]);
    }
    setTimeout(() => res.redirect('/admin/settings?saved=1'), 500);
  });

  // ŞİFRƏ
  router.get('/password', requireAuth, (req, res) => { res.render('admin/password', { error: null, success: null }); });
  router.post('/password', requireAuth, (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    if (!current_password || !new_password || !confirm_password) return res.render('admin/password', { error: 'Butun saheleri doldurun', success: null });
    if (new_password !== confirm_password) return res.render('admin/password', { error: 'Yeni sifreler uygun deyil', success: null });
    if (new_password.length < 6) return res.render('admin/password', { error: 'Yeni sifre en azi 6 simvol olmalidir', success: null });
    db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user) return res.render('admin/password', { error: 'Istifadeci tapilmadi', success: null });
      if (!bcrypt.compareSync(current_password, user.password)) return res.render('admin/password', { error: 'Cari sifre yanlisdir', success: null });
      const newHash = bcrypt.hashSync(new_password, 10);
      db.run('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id], (err) => {
        if (err) return res.render('admin/password', { error: 'Xeta bas verdi', success: null });
        res.render('admin/password', { error: null, success: 'Sifre ugurla deyisdirildi!' });
      });
    });
  });

  return router;
};