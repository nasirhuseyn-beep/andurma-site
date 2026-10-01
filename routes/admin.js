const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');

// Fayl yükləmə
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage: storage });

module.exports = (db) => {
  const router = express.Router();

  // ---------- AUTH MIDDLEWARE ----------
  function requireAuth(req, res, next) {
    if (req.session.user) return next();
    res.redirect('/admin/login');
  }

  function requireSuperAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'super_admin') {
      return next();
    }
    res.status(403).send('Icaze yoxdur. Yalniz Super Admin.');
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      const user = req.session.user;
      if (!user) return res.redirect('/admin/login');
      if (user.role === 'super_admin') return next();
      if (user.permissions && user.permissions[permission]) return next();
      res.status(403).send('Icaze yoxdur');
    };
  }

  // ---------- LOGIN ----------
  router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/admin');
    res.render('admin/login', { error: null });
  });

  router.post('/login', (req, res) => {
    const { username, password } = req.body;
    db.get('SELECT * FROM users WHERE username = ? AND active = 1', [username], (err, user) => {
      if (!user || !bcrypt.compareSync(password, user.password)) {
        return res.render('admin/login', { error: 'Istifadeci adi ve ya sifre yanlisdir' });
      }
      
      let permissions = {};
      try {
        permissions = user.permissions ? JSON.parse(user.permissions) : {};
      } catch(e) {
        permissions = {};
      }
      
      req.session.user = {
        id: user.id,
        username: user.username,
        full_name: user.full_name,
        role: user.role,
        permissions: permissions
      };
      
      // Son giriş vaxtı
      db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
      
      res.redirect('/admin');
    });
  });

  router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
  });

  // ---------- DASHBOARD ----------
  router.get('/', requireAuth, (req, res) => {
    const user = req.session.user;
    
    if (user.role === 'super_admin') {
      // Super admin: bütün statistika
      db.get('SELECT COUNT(*) as c FROM news', (e, n) => {
        db.get('SELECT COUNT(*) as c FROM articles', (e, a) => {
          db.get('SELECT COUNT(*) as c FROM koshe', (e, k) => {
            db.get('SELECT COUNT(*) as c FROM comments WHERE approved = 0', (e, c) => {
              db.get('SELECT COUNT(*) as c FROM users', (e, u) => {
                db.get('SELECT SUM(views) as total_views, SUM(likes) as total_likes FROM news', (e, s) => {
                  res.render('admin/dashboard', {
                    user: user,
                    newsCount: n ? n.c : 0,
                    articleCount: a ? a.c : 0,
                    kosheCount: k ? k.c : 0,
                    pendingComments: c ? c.c : 0,
                    userCount: u ? u.c : 0,
                    totalViews: s ? (s.total_views || 0) : 0,
                    totalLikes: s ? (s.total_likes || 0) : 0
                  });
                });
              });
            });
          });
        });
      });
    } else {
      // Redaktor: yalnız öz statistikası
      db.get('SELECT COUNT(*) as c FROM news WHERE author_id = ?', [user.id], (e, n) => {
        db.get('SELECT COUNT(*) as c FROM articles WHERE author_id = ?', [user.id], (e, a) => {
          db.get('SELECT COUNT(*) as c FROM koshe WHERE author_id = ?', [user.id], (e, k) => {
            db.get('SELECT SUM(views) as total_views, SUM(likes) as total_likes FROM news WHERE author_id = ?', [user.id], (e, s) => {
              res.render('admin/dashboard', {
                user: user,
                newsCount: n ? n.c : 0,
                articleCount: a ? a.c : 0,
                kosheCount: k ? k.c : 0,
                pendingComments: 0,
                userCount: 0,
                totalViews: s ? (s.total_views || 0) : 0,
                totalLikes: s ? (s.total_likes || 0) : 0
              });
            });
          });
        });
      });
    }
  });

  // ============================================
  // ---------- İSTİFADƏÇİLƏR (SUPER ADMIN) ----------
  // ============================================
  router.get('/users', requireAuth, requireSuperAdmin, (req, res) => {
    db.all('SELECT * FROM users ORDER BY created_at DESC', (err, users) => {
      if (err) users = [];
      res.render('admin/users', { users: users });
    });
  });

  router.get('/users/new', requireAuth, requireSuperAdmin, (req, res) => {
    res.render('admin/user-form', { user: null, error: null });
  });

  router.post('/users/new', requireAuth, requireSuperAdmin, (req, res) => {
    const { username, password, full_name, email, role } = req.body;
    
    if (!username || !password) {
      return res.render('admin/user-form', { user: null, error: 'Bos saheler' });
    }
    
    // Default redaktor icazələri
    const permissions = {
      can_add_news: req.body.can_add_news === 'on',
      can_add_articles: req.body.can_add_articles === 'on',
      can_add_koshe: req.body.can_add_koshe === 'on',
      can_add_gallery: req.body.can_add_gallery === 'on',
      can_manage_users: false,
      can_manage_settings: false,
      can_approve_comments: req.body.can_approve_comments === 'on'
    };
    
    const hash = bcrypt.hashSync(password, 10);
    
    db.run(`INSERT INTO users (username, password, full_name, email, role, active, permissions) 
            VALUES (?, ?, ?, ?, ?, 1, ?)`,
      [username, hash, full_name, email, role || 'editor', JSON.stringify(permissions)],
      (err) => {
        if (err) {
          return res.render('admin/user-form', { user: null, error: 'Bu istifadeci adi artiq movcuddur' });
        }
        res.redirect('/admin/users');
      });
  });

  router.get('/users/edit/:id', requireAuth, requireSuperAdmin, (req, res) => {
    db.get('SELECT * FROM users WHERE id = ?', [req.params.id], (err, user) => {
      if (!user) return res.redirect('/admin/users');
      let permissions = {};
      try { permissions = user.permissions ? JSON.parse(user.permissions) : {}; } catch(e) {}
      user.permissionsObj = permissions;
      res.render('admin/user-form', { user: user, error: null });
    });
  });

  router.post('/users/edit/:id', requireAuth, requireSuperAdmin, (req, res) => {
    const { username, password, full_name, email, role, active } = req.body;
    
    const permissions = {
      can_add_news: req.body.can_add_news === 'on',
      can_add_articles: req.body.can_add_articles === 'on',
      can_add_koshe: req.body.can_add_koshe === 'on',
      can_add_gallery: req.body.can_add_gallery === 'on',
      can_manage_users: false,
      can_manage_settings: false,
      can_approve_comments: req.body.can_approve_comments === 'on'
    };
    
    let sql = 'UPDATE users SET username=?, full_name=?, email=?, role=?, active=?, permissions=?';
    let params = [username, full_name, email, role || 'editor', active === 'on' ? 1 : 0, JSON.stringify(permissions)];
    
    if (password && password.length > 0) {
      sql += ', password=?';
      params.push(bcrypt.hashSync(password, 10));
    }
    
    sql += ' WHERE id=?';
    params.push(req.params.id);
    
    db.run(sql, params, (err) => {
      res.redirect('/admin/users');
    });
  });

  router.post('/users/delete/:id', requireAuth, requireSuperAdmin, (req, res) => {
    // Özünü silməsin
    if (parseInt(req.params.id) === req.session.user.id) {
      return res.redirect('/admin/users');
    }
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], () => res.redirect('/admin/users'));
  });

  // ============================================
  // ---------- XƏBƏRLƏR ----------
  // ============================================
  router.get('/news', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    
    if (user.role === 'super_admin') {
      query = 'SELECT * FROM news ORDER BY created_at DESC';
      params = [];
    } else {
      query = 'SELECT * FROM news WHERE author_id = ? ORDER BY created_at DESC';
      params = [user.id];
    }
    
    db.all(query, params, (err, news) => {
      if (err) news = [];
      res.render('admin/news', { news: news, user: user });
    });
  });

  router.get('/news/new', requireAuth, (req, res) => {
    res.render('admin/news-form', { news: null });
  });

  router.post('/news/new', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), (req, res) => {
    const { title, category, content, location } = req.body;
    const image = req.files && req.files.image ? '/uploads/' + req.files.image[0].filename : null;
    const video = req.files && req.files.video ? '/uploads/' + req.files.video[0].filename : null;
    const author_id = req.session.user.id;
    const author_name = req.session.user.full_name || req.session.user.username;
    
    db.run('INSERT INTO news (title, category, content, location, image, video, author_id, author_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, category, content, location, image, video, author_id, author_name],
      () => res.redirect('/admin/news'));
  });

  router.get('/news/edit/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, news) => {
      if (!news) return res.redirect('/admin/news');
      
      // Redaktor yalnız öz yazısını redaktə edə bilər
      if (user.role !== 'super_admin' && news.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      
      res.render('admin/news-form', { news: news });
    });
  });

  router.post('/news/edit/:id', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), (req, res) => {
    const user = req.session.user;
    const { title, category, content, location } = req.body;
    
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, old) => {
      if (!old) return res.redirect('/admin/news');
      
      if (user.role !== 'super_admin' && old.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      
      const image = req.files && req.files.image ? '/uploads/' + req.files.image[0].filename : old.image;
      const video = req.files && req.files.video ? '/uploads/' + req.files.video[0].filename : old.video;
      
      db.run('UPDATE news SET title=?, category=?, content=?, location=?, image=?, video=? WHERE id=?',
        [title, category, content, location, image, video, req.params.id],
        () => res.redirect('/admin/news'));
    });
  });

  router.post('/news/delete/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    
    db.get('SELECT * FROM news WHERE id = ?', [req.params.id], (err, news) => {
      if (!news) return res.redirect('/admin/news');
      
      if (user.role !== 'super_admin' && news.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      
      db.run('DELETE FROM news WHERE id = ?', [req.params.id], () => res.redirect('/admin/news'));
    });
  });

  // ============================================
  // ---------- MƏQALƏLƏR ----------
  // ============================================
  router.get('/articles', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    
    if (user.role === 'super_admin') {
      query = 'SELECT * FROM articles ORDER BY created_at DESC';
      params = [];
    } else {
      query = 'SELECT * FROM articles WHERE author_id = ? ORDER BY created_at DESC';
      params = [user.id];
    }
    
    db.all(query, params, (err, articles) => {
      if (err) articles = [];
      res.render('admin/articles', { articles: articles, user: user });
    });
  });

  router.get('/articles/new', requireAuth, (req, res) => {
    res.render('admin/article-form', { article: null });
  });

  router.post('/articles/new', requireAuth, upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;
    const author_id = req.session.user.id;
    const author_name = req.session.user.full_name || req.session.user.username;
    
    db.run('INSERT INTO articles (title, content, image, author_id, author_name) VALUES (?, ?, ?, ?, ?)',
      [title, content, image, author_id, author_name],
      () => res.redirect('/admin/articles'));
  });

  router.get('/articles/edit/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
      if (!article) return res.redirect('/admin/articles');
      if (user.role !== 'super_admin' && article.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      res.render('admin/article-form', { article: article });
    });
  });

  router.post('/articles/edit/:id', requireAuth, upload.single('image'), (req, res) => {
    const user = req.session.user;
    const { title, content } = req.body;
    
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, old) => {
      if (!old) return res.redirect('/admin/articles');
      if (user.role !== 'super_admin' && old.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      
      const image = req.file ? '/uploads/' + req.file.filename : old.image;
      db.run('UPDATE articles SET title=?, content=?, image=? WHERE id=?',
        [title, content, image, req.params.id],
        () => res.redirect('/admin/articles'));
    });
  });

  router.post('/articles/delete/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
      if (!article) return res.redirect('/admin/articles');
      if (user.role !== 'super_admin' && article.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      db.run('DELETE FROM articles WHERE id = ?', [req.params.id], () => res.redirect('/admin/articles'));
    });
  });

  // ============================================
  // ---------- KÖŞƏ YAZILARI ----------
  // ============================================
  router.get('/koshe', requireAuth, (req, res) => {
    const user = req.session.user;
    let query, params;
    
    if (user.role === 'super_admin') {
      query = 'SELECT * FROM koshe ORDER BY created_at DESC';
      params = [];
    } else {
      query = 'SELECT * FROM koshe WHERE author_id = ? ORDER BY created_at DESC';
      params = [user.id];
    }
    
    db.all(query, params, (err, koshe) => {
      if (err) koshe = [];
      res.render('admin/koshe', { koshe: koshe, user: user });
    });
  });

  router.get('/koshe/new', requireAuth, (req, res) => {
    res.render('admin/koshe-form', { koshe: null });
  });

  router.post('/koshe/new', requireAuth, upload.single('image'), (req, res) => {
    const { title, content } = req.body;
    const image = req.file ? '/uploads/' + req.file.filename : null;
    const author_id = req.session.user.id;
    const author_name = req.session.user.full_name || req.session.user.username;
    
    db.run('INSERT INTO koshe (title, content, image, author_id, author_name) VALUES (?, ?, ?, ?, ?)',
      [title, content, image, author_id, author_name],
      () => res.redirect('/admin/koshe'));
  });

  router.get('/koshe/edit/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], (err, koshe) => {
      if (!koshe) return res.redirect('/admin/koshe');
      if (user.role !== 'super_admin' && koshe.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      res.render('admin/koshe-form', { koshe: koshe });
    });
  });

  router.post('/koshe/edit/:id', requireAuth, upload.single('image'), (req, res) => {
    const user = req.session.user;
    const { title, content } = req.body;
    
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], (err, old) => {
      if (!old) return res.redirect('/admin/koshe');
      if (user.role !== 'super_admin' && old.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      
      const image = req.file ? '/uploads/' + req.file.filename : old.image;
      db.run('UPDATE koshe SET title=?, content=?, image=? WHERE id=?',
        [title, content, image, req.params.id],
        () => res.redirect('/admin/koshe'));
    });
  });

  router.post('/koshe/delete/:id', requireAuth, (req, res) => {
    const user = req.session.user;
    db.get('SELECT * FROM koshe WHERE id = ?', [req.params.id], (err, koshe) => {
      if (!koshe) return res.redirect('/admin/koshe');
      if (user.role !== 'super_admin' && koshe.author_id !== user.id) {
        return res.status(403).send('Icaze yoxdur');
      }
      db.run('DELETE FROM koshe WHERE id = ?', [req.params.id], () => res.redirect('/admin/koshe'));
    });
  });

  // ============================================
  // ---------- QALEREYA ----------
  // ============================================
  router.get('/gallery', requireAuth, (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY created_at DESC', (err, gallery) => {
      if (err) gallery = [];
      res.render('admin/gallery', { gallery: gallery });
    });
  });

  router.get('/gallery/new', requireAuth, (req, res) => {
    res.render('admin/gallery-form', { item: null });
  });

  router.post('/gallery/new', requireAuth, upload.fields([{ name: 'image' }, { name: 'video' }]), (req, res) => {
    const { title, description } = req.body;
    const image = req.files && req.files.image ? '/uploads/' + req.files.image[0].filename : null;
    const video = req.files && req.files.video ? '/uploads/' + req.files.video[0].filename : null;
    
    db.run('INSERT INTO gallery (title, image, video, description) VALUES (?, ?, ?, ?)',
      [title, image, video, description],
      () => res.redirect('/admin/gallery'));
  });

  router.post('/gallery/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM gallery WHERE id = ?', [req.params.id], () => res.redirect('/admin/gallery'));
  });

  // ============================================
  // ---------- ŞƏRHLƏR ----------
  // ============================================
  router.get('/comments', requireAuth, (req, res) => {
    db.all('SELECT * FROM comments ORDER BY created_at DESC', (err, comments) => {
      if (err) comments = [];
      res.render('admin/comments', { comments: comments });
    });
  });

  router.post('/comments/approve/:id', requireAuth, (req, res) => {
    db.run('UPDATE comments SET approved = 1 WHERE id = ?', [req.params.id], () => res.redirect('/admin/comments'));
  });

  router.post('/comments/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM comments WHERE id = ?', [req.params.id], () => res.redirect('/admin/comments'));
  });

  // ============================================
  // ---------- ƏLAQƏ MESAJLARI ----------
  // ============================================
  router.get('/messages', requireAuth, (req, res) => {
    db.all('SELECT * FROM contact ORDER BY created_at DESC', (err, messages) => {
      if (err) messages = [];
      res.render('admin/messages', { messages: messages });
    });
  });

  router.post('/messages/read/:id', requireAuth, (req, res) => {
    db.run('UPDATE contact SET read = 1 WHERE id = ?', [req.params.id], () => res.redirect('/admin/messages'));
  });

  router.post('/messages/delete/:id', requireAuth, (req, res) => {
    db.run('DELETE FROM contact WHERE id = ?', [req.params.id], () => res.redirect('/admin/messages'));
  });

  // ============================================
  // ---------- SAYT SAZLAMALARI (SUPER ADMIN) ----------
  // ============================================
  router.get('/settings', requireAuth, requireSuperAdmin, (req, res) => {
    db.all('SELECT key, value FROM settings', (err, rows) => {
      const settings = {};
      if (rows) rows.forEach(r => settings[r.key] = r.value);
      res.render('admin/settings', { settings: settings, saved: req.query.saved });
    });
  });

  router.post('/settings', requireAuth, requireSuperAdmin, 
    upload.fields([{ name: 'hero_image' }, { name: 'logo' }]),
    (req, res) => {
    
    const fields = [
      'site_name', 'hero_title', 'hero_subtitle',
      'about_title', 'about_text',
      'contact_phone', 'contact_email', 'contact_address',
      'social_facebook', 'social_instagram', 'social_youtube',
      'footer_text'
    ];
    
    fields.forEach(field => {
      if (req.body[field] !== undefined) {
        db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [field, req.body[field]]);
      }
    });
    
    if (req.files && req.files.hero_image && req.files.hero_image[0]) {
      const img = '/uploads/' + req.files.hero_image[0].filename;
      db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        ['hero_image', img]);
    }
    if (req.files && req.files.logo && req.files.logo[0]) {
      const logo = '/uploads/' + req.files.logo[0].filename;
      db.run('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
        ['logo', logo]);
    }
    
    setTimeout(() => res.redirect('/admin/settings?saved=1'), 300);
  });

  // ============================================
  // ---------- ŞİFRƏ DƏYİŞMƏ ----------
  // ============================================
  router.get('/password', requireAuth, (req, res) => {
    res.render('admin/password', { error: null, success: null });
  });

  router.post('/password', requireAuth, (req, res) => {
    const { current_password, new_password, confirm_password } = req.body;
    
    if (!current_password || !new_password || !confirm_password) {
      return res.render('admin/password', { error: 'Butun saheleri doldurun', success: null });
    }
    if (new_password !== confirm_password) {
      return res.render('admin/password', { error: 'Yeni sifreler uygun deyil', success: null });
    }
    if (new_password.length < 6) {
      return res.render('admin/password', { error: 'Yeni sifre en azi 6 simvol olmalidir', success: null });
    }
    
    db.get('SELECT * FROM users WHERE id = ?', [req.session.user.id], (err, user) => {
      if (err || !user) {
        return res.render('admin/password', { error: 'Istifadeci tapilmadi', success: null });
      }
      if (!bcrypt.compareSync(current_password, user.password)) {
        return res.render('admin/password', { error: 'Cari sifre yanlisdir', success: null });
      }
      
      const newHash = bcrypt.hashSync(new_password, 10);
      db.run('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id], (err) => {
        if (err) {
          return res.render('admin/password', { error: 'Xeta bas verdi', success: null });
        }
        res.render('admin/password', { error: null, success: 'Sifre ugurla deyisdirildi!' });
      });
    });
  });

  return router;
};