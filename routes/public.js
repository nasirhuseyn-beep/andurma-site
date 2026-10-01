const express = require('express');

module.exports = (db) => {
  const router = express.Router();

  // ========== ANA SƏHİFƏ ==========
  router.get('/', (req, res) => {
    db.all('SELECT * FROM news ORDER BY created_at DESC LIMIT 6', (err, news) => {
      if (err) news = [];
      db.all('SELECT * FROM articles ORDER BY created_at DESC LIMIT 3', (err, articles) => {
        if (err) articles = [];
        db.all('SELECT * FROM gallery ORDER BY created_at DESC LIMIT 6', (err, gallery) => {
          if (err) gallery = [];
          res.render('index', { 
            news: news, 
            articles: articles, 
            gallery: gallery 
          });
        });
      });
    });
  });

  // ========== XƏBƏRLƏR ==========
  router.get('/xeberler', (req, res) => {
    db.all('SELECT * FROM news ORDER BY created_at DESC', (err, news) => {
      if (err) news = [];
      res.render('news-list', { news: news, category: null });
    });
  });

  router.get('/xeberler/:category', (req, res) => {
    const cat = req.params.category;
    db.all('SELECT * FROM news WHERE category = ? ORDER BY created_at DESC', [cat], (err, news) => {
      if (err) news = [];
      res.render('news-list', { news: news, category: cat });
    });
  });

  router.get('/xeber/:id', (req, res) => {
    const id = req.params.id;
    
    // Baxış sayı artır
    db.run('UPDATE news SET views = views + 1 WHERE id = ?', [id]);
    
    db.get('SELECT * FROM news WHERE id = ?', [id], (err, news) => {
      if (!news) return res.status(404).send('Xeber tapilmadi');
      db.all('SELECT * FROM comments WHERE content_type = ? AND content_id = ? AND approved = 1 ORDER BY created_at DESC',
        ['news', id], (err, comments) => {
          if (err) comments = [];
          res.render('news-single', { 
            news: news, 
            comments: comments,
            sent: req.query.sent 
          });
        });
    });
  });

  // ========== GÖRÜLƏN İŞLƏR ==========
  router.get('/isler', (req, res) => {
    db.all('SELECT * FROM news ORDER BY created_at DESC', (err, news) => {
      if (err) news = [];
      res.render('isler', { news: news, category: null });
    });
  });

  router.get('/isler/:category', (req, res) => {
    const cat = req.params.category;
    db.all('SELECT * FROM news WHERE category = ? ORDER BY created_at DESC', [cat], (err, news) => {
      if (err) news = [];
      res.render('isler', { news: news, category: cat });
    });
  });

  // ========== MƏQALƏLƏR ==========
  router.get('/meqaleler', (req, res) => {
    db.all('SELECT * FROM articles ORDER BY created_at DESC', (err, articles) => {
      if (err) articles = [];
      res.render('articles-list', { articles: articles });
    });
  });

  router.get('/meqale/:id', (req, res) => {
    const id = req.params.id;
    
    db.run('UPDATE articles SET views = views + 1 WHERE id = ?', [id]);
    
    db.get('SELECT * FROM articles WHERE id = ?', [id], (err, article) => {
      if (!article) return res.status(404).send('Meqale tapilmadi');
      db.all('SELECT * FROM comments WHERE content_type = ? AND content_id = ? AND approved = 1 ORDER BY created_at DESC',
        ['article', id], (err, comments) => {
          if (err) comments = [];
          res.render('article-single', { 
            article: article, 
            comments: comments,
            sent: req.query.sent 
          });
        });
    });
  });

  // ========== KÖŞƏ YAZILARI ==========
  router.get('/koshe', (req, res) => {
    db.all('SELECT * FROM koshe ORDER BY created_at DESC', (err, koshe) => {
      if (err) koshe = [];
      res.render('koshe-list', { koshe: koshe });
    });
  });

  router.get('/koshe/:id', (req, res) => {
    const id = req.params.id;
    
    db.run('UPDATE koshe SET views = views + 1 WHERE id = ?', [id]);
    
    db.get('SELECT * FROM koshe WHERE id = ?', [id], (err, koshe) => {
      if (!koshe) return res.status(404).send('Koshe yazisi tapilmadi');
      db.all('SELECT * FROM comments WHERE content_type = ? AND content_id = ? AND approved = 1 ORDER BY created_at DESC',
        ['koshe', id], (err, comments) => {
          if (err) comments = [];
          res.render('koshe-single', { 
            koshe: koshe, 
            comments: comments,
            sent: req.query.sent 
          });
        });
    });
  });

  // ========== QALEREYA ==========
  router.get('/qalereya', (req, res) => {
    db.all('SELECT * FROM gallery ORDER BY created_at DESC', (err, gallery) => {
      if (err) gallery = [];
      res.render('gallery', { gallery: gallery });
    });
  });

  // ========== HAQQINDA ==========
  router.get('/haqqinda', (req, res) => {
    db.all('SELECT key, value FROM settings', (err, rows) => {
      const settings = {};
      if (rows) rows.forEach(r => settings[r.key] = r.value);
      res.render('about', { settings: settings });
    });
  });

  // ========== ƏLAQƏ ==========
  router.get('/elaqe', (req, res) => {
    res.render('contact', { sent: req.query.sent });
  });

  router.post('/elaqe', (req, res) => {
    const { name, phone, email, message } = req.body;
    if (!name || !message) return res.redirect('/elaqe');
    
    db.run('INSERT INTO contact (name, phone, email, message) VALUES (?, ?, ?, ?)',
      [name, phone, email, message], () => {
        res.redirect('/elaqe?sent=1');
      });
  });

  // ========== ŞƏRH YAZMAQ ==========
  router.post('/comment/:type/:id', (req, res) => {
    const { name, text } = req.body;
    const { type, id } = req.params;
    
    if (!name || !text) return res.redirect('back');
    
    db.run('INSERT INTO comments (content_type, content_id, name, text, approved) VALUES (?, ?, ?, ?, 0)',
      [type, id, name, text], () => {
        let url = '/';
        if (type === 'news') url = '/xeber/' + id;
        else if (type === 'article') url = '/meqale/' + id;
        else if (type === 'koshe') url = '/koshe/' + id;
        res.redirect(url + '?sent=1');
      });
  });

  // ========== BƏYƏNMƏ ==========
  router.post('/like/:type/:id', (req, res) => {
    const { type, id } = req.params;
    
    let table = 'news';
    if (type === 'article') table = 'articles';
    else if (type === 'koshe') table = 'koshe';
    
    db.run(`UPDATE ${table} SET likes = likes + 1 WHERE id = ?`, [id], (err) => {
      if (err) return res.json({ success: false });
      
      db.get(`SELECT likes FROM ${table} WHERE id = ?`, [id], (err, row) => {
        res.json({ success: true, likes: row ? row.likes : 0 });
      });
    });
  });

  return router;
};