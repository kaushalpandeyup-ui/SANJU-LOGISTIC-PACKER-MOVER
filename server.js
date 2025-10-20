const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
// do not require sql.js at module load time - it's large and can break serverless bundling
let initSqlJs;
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const IS_VERCEL = !!process.env.VERCEL || process.env.SERVERLESS === '1';

const DATA_DIR = path.join(__dirname, 'data');
try{ if(!IS_VERCEL && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR); }catch(e){ console.warn('could not create DATA_DIR:', e && (e.message||e)); }
const DB_FILE = path.join(DATA_DIR, 'app.db');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
try{ if(!IS_VERCEL && !fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR); }catch(e){ console.warn('could not create UPLOADS_DIR:', e && (e.message||e)); }

let SQL;
let db; // sql.js Database instance

async function initDb(){
  if(IS_VERCEL){
    // In serverless environment: avoid loading sql.js (WASM/binary). Provide a minimal in-memory stub
    // that implements the DB methods used by the app but does not persist data.
    db = {
      run: function(){ /* no-op */ },
      export: function(){ return new Uint8Array(); },
      prepare: function(){
        return {
          bind: function(){},
          step: function(){ return false; },
          getAsObject: function(){ return {}; },
          free: function(){}
        };
      }
    };
    SQL = null;
  } else {
    initSqlJs = initSqlJs || require('sql.js');
    SQL = await initSqlJs({ locateFile: filename => path.join(__dirname, 'node_modules', 'sql.js', 'dist', filename) });
    if(fs.existsSync(DB_FILE)){
      const filebuffer = fs.readFileSync(DB_FILE);
      db = new SQL.Database(filebuffer);
    } else {
      db = new SQL.Database();
    }
  }
  // create schema if missing
  db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, phone TEXT, passwordHash TEXT NOT NULL,
    verified INTEGER DEFAULT 0, isAdmin INTEGER DEFAULT 0, verifyToken TEXT
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, uuid TEXT, userEmail TEXT, pickFrom TEXT, dropTo TEXT,
    createdAt TEXT, paid INTEGER DEFAULT 0, amount REAL, screenshot TEXT, paidAt TEXT, reached INTEGER DEFAULT 0, reachedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, bookingId TEXT, userEmail TEXT, amount REAL, screenshot TEXT, createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS revoked_tokens (
    id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, expiresAt TEXT
  );
  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY, type TEXT, payload TEXT, createdAt TEXT, isRead INTEGER DEFAULT 0
  );
  `);
  // ensure phone column exists on bookings (safe attempt)
  try{ db.run("ALTER TABLE bookings ADD COLUMN phone TEXT"); }catch(e){}
  // migrate existing JSON files if present
  const usersFile = path.join(DATA_DIR, 'users.json');
  const bookingsFile = path.join(DATA_DIR, 'bookings.json');
  const paymentsFile = path.join(DATA_DIR, 'payments.json');
  if(fs.existsSync(usersFile)){
    try{
      const raw = JSON.parse(fs.readFileSync(usersFile,'utf8')||'{}');
      const insert = db.prepare('INSERT OR IGNORE INTO users (id,email,phone,passwordHash,verified,isAdmin,verifyToken) VALUES (?,?,?,?,?,?,?)');
      try{
        Object.values(raw).forEach(u=>{
          insert.bind([u.id||uuidv4(), u.email, u.phone, u.passwordHash, u.verified?1:0, u.isAdmin?1:0, u.verifyToken||null]);
          insert.step();
          insert.reset();
        });
      }finally{ try{ insert.free(); }catch(e){} }
    }catch(e){console.warn('users.json migration failed', e && (e.stack||e) || e);}
  }
  if(fs.existsSync(bookingsFile)){
    try{
      const raw = JSON.parse(fs.readFileSync(bookingsFile,'utf8')||'[]');
      const insert = db.prepare('INSERT OR IGNORE INTO bookings (id,uuid,userEmail,pickFrom,dropTo,createdAt,paid,amount,screenshot,paidAt,reached,reachedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      try{
        raw.forEach(b=>{
          insert.bind([b.id, b.uuid||uuidv4(), b.user||b.userEmail||'', b.pickFrom, b.dropTo, b.createdAt||new Date().toISOString(), b.paid?1:0, b.amount||null, b.screenshot||null, b.paidAt||null, b.reached?1:0, b.reachedAt||null]);
          insert.step();
          insert.reset();
        });
      }finally{ try{ insert.free(); }catch(e){} }
    }catch(e){console.warn('bookings.json migration failed', e && (e.stack||e) || e);}
  }
  if(fs.existsSync(paymentsFile)){
    try{
      const raw = JSON.parse(fs.readFileSync(paymentsFile,'utf8')||'[]');
      const insert = db.prepare('INSERT OR IGNORE INTO payments (id,bookingId,userEmail,amount,screenshot,createdAt) VALUES (?,?,?,?,?,?)');
      try{
        raw.forEach(p=>{
          insert.bind([p.id, p.bookingId, p.user||p.userEmail||'', p.amount, p.screenshot, p.createdAt]);
          insert.step();
          insert.reset();
        });
      }finally{ try{ insert.free(); }catch(e){} }
    }catch(e){console.warn('payments.json migration failed', e && (e.stack||e) || e);}
  }
  persistDb();
}

function persistDb(){
  if(IS_VERCEL){
    // Running in serverless environment: skip persisting DB to disk (ephemeral or readonly FS)
    console.warn('persistDb skipped in serverless environment');
    return;
  }
  try{
    const data = db.export(); const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  }catch(e){ console.warn('persistDb failed:', e && (e.message||e)); }
}

// helper to run SELECTs returning objects
function all(stmt, params=[]){
  // For simplicity, use prepared statements via sql.js builtins
  try{
    const s = db.prepare(stmt);
    const rows = [];
    s.bind(params);
    while(s.step()) rows.push(s.getAsObject());
    s.free();
    return rows;
  }catch(e){ return []; }
}

// helper to run statement with params
function run(stmt, params=[]){
  try{ const s = db.prepare(stmt); s.bind(params); s.step(); s.free(); persistDb(); return true; }catch(e){ console.warn('DB run error', e && (e.stack||e) || e); return false; }
}

// admin ensure
function ensureAdmin(){
  const adminEmail = 'sanjulogisticadminhosti@gmail.com';
  const row = all('SELECT * FROM users WHERE email = ?', [adminEmail])[0];
  if(!row){
    const password = 'dmte@99316';
    const hash = bcrypt.hashSync(password, 10);
    run('INSERT INTO users (id,email,passwordHash,verified,isAdmin) VALUES (?,?,?,?,?)', [uuidv4(), adminEmail, hash, 1, 1]);
    console.log('admin user created', adminEmail);
  }
}
// startup sequence will init DB then call ensureAdmin()

const upload = multer({ dest: UPLOADS_DIR });

// transporter: prefer real SMTP configured by env vars, otherwise fall back to Ethereal (dev)
async function getTransporter(){
  if(global.__transporter) return global.__transporter;
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const port = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
  const secure = process.env.SMTP_SECURE === 'true';
  if(host && user && pass){
    const transporter = nodemailer.createTransport({ host, port: port || 587, secure: !!secure, auth: { user, pass } });
    // verify connection configuration
    try{ await transporter.verify(); global.__transporter = transporter; console.log('SMTP transporter ready (env)'); return transporter; }catch(e){ console.warn('SMTP transport verify failed:', e.message); }
  }
  // fallback to ethereal for development/testing
  if(global.__etherealTransport) return global.__etherealTransport;
  global.__ethereal = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({ host:'smtp.ethereal.email', port:587, auth: { user: global.__ethereal.user, pass: global.__ethereal.pass }});
  global.__etherealTransport = transporter; global.__etherealInfo = global.__ethereal; console.log('Using Ethereal test account for email');
  return transporter;
}

// signup
app.post('/api/signup', async (req, res)=>{
  const { email, phone, password } = req.body;
  if(!email || !password) return res.status(400).json({ error: 'email and password required' });
  const exists = all('SELECT email FROM users WHERE email = ?', [email])[0];
  if(exists) return res.status(400).json({ error: 'user exists' });
  const id = uuidv4();
    // For simpler / local usage: skip email verification and mark user as verified immediately
    const hash = await bcrypt.hash(password, 10);
    run('INSERT INTO users (id,email,phone,passwordHash,verified,verifyToken) VALUES (?,?,?,?,?,?)', [id,email,phone||null,hash,1,null]);
    return res.json({ message: 'user created', note: 'verification disabled for local mode' });
});

// verify
app.get('/api/verify', (req,res)=>{
  // verification flow is disabled in local mode — return informational response
  res.json({ message: 'verification disabled in local mode' });
});

// login
app.post('/api/login', async (req,res)=>{
  const { email, password } = req.body; if(!email||!password) return res.status(400).json({ error:'missing' });
  const u = all('SELECT * FROM users WHERE email = ?', [email])[0];
  if(!u) return res.status(400).json({ error:'invalid' });
  const ok = await bcrypt.compare(password, u.passwordHash);
  if(!ok) return res.status(400).json({ error:'invalid' });
  const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
  const token = jwt.sign({ email: u.email, isAdmin: !!u.isAdmin }, jwtSecret, { expiresIn: '7d' });
  res.json({ token });
});

// logout - revoke token server-side
app.post('/api/logout', authMiddleware, (req,res)=>{
  try{
    const token = req.token;
    if(!token) return res.status(400).json({ error: 'no token' });
    // try to decode token to get expiry
    let expiresAt = null;
    try{ const p = jwt.decode(token); if(p && p.exp) expiresAt = new Date(p.exp * 1000).toISOString(); }catch(e){}
    const id = uuidv4();
    run('INSERT OR IGNORE INTO revoked_tokens (id,token,expiresAt) VALUES (?,?,?)', [id, token, expiresAt]);
    return res.json({ ok:true });
  }catch(e){ console.warn('logout failed', e && (e.stack||e) || e); return res.status(500).json({ error:'server' }); }
});

// check whether a token was revoked (logout)
function isTokenRevoked(token){
  try{
    if(!token) return true;
    const rows = all('SELECT token FROM revoked_tokens WHERE token = ?', [token]);
    return rows && rows.length > 0;
  }catch(e){ return true; }
}

// revised auth middleware that rejects revoked tokens and exposes req.token
function authMiddleware(req,res,next){
  const a = req.headers.authorization;
  if(!a) return res.status(401).json({ error: 'no auth' });
  const token = a.replace(/^Bearer\s+/,'');
  try{
    // reject if token is revoked
    if(isTokenRevoked(token)) return res.status(401).json({ error: 'token_revoked' });
    const jwtSecret = process.env.JWT_SECRET || 'dev-secret';
    const payload = jwt.verify(token, jwtSecret);
    req.user = payload;
    req.token = token;
    next();
  }catch(e){
    res.status(401).json({ error:'invalid token' });
  }
}

// create booking
app.post('/api/bookings', authMiddleware, (req,res)=>{
  const { pickFrom, dropTo } = req.body; if(!pickFrom||!dropTo) return res.status(400).json({ error:'missing' });
  const id = Date.now().toString(); const uuid = uuidv4(); const createdAt = new Date().toISOString();
  run('INSERT INTO bookings (id,uuid,userEmail,pickFrom,dropTo,createdAt,paid,reached) VALUES (?,?,?,?,?,?,?,?)', [id,uuid,req.user.email,pickFrom,dropTo,createdAt,0,0]);
  const booking = all('SELECT * FROM bookings WHERE id = ?', [id])[0];
  res.json({ booking });
});

// public booking endpoint (no auth) - stores phone and returns booking
app.post('/api/public/bookings', (req,res)=>{
  const { pickFrom, dropTo, phone } = req.body;
  if(!pickFrom||!dropTo||!phone) return res.status(400).json({ error:'pickFrom, dropTo and phone are required' });
  const id = Date.now().toString(); const uuid = uuidv4(); const createdAt = new Date().toISOString();
  run('INSERT INTO bookings (id,uuid,userEmail,pickFrom,dropTo,createdAt,paid,reached,phone) VALUES (?,?,?,?,?,?,?,?,?)', [id,uuid,'anonymous',pickFrom,dropTo,createdAt,0,0,phone]);
  const booking = all('SELECT * FROM bookings WHERE id = ?', [id])[0];
  // create notification for admin
  try{ run('INSERT INTO notifications (id,type,payload,createdAt,isRead) VALUES (?,?,?,?,?)', [uuidv4(),'booking', JSON.stringify(booking), new Date().toISOString(), 0]); }catch(e){ console.warn('notify booking failed', e); }
  res.json({ booking, message: 'Booking received. We will get to you soon.' });
});

// add payment
app.post('/api/bookings/:id/payment', authMiddleware, upload.single('screenshot'), (req,res)=>{
  const id = req.params.id; const amount = req.body.amount; const b = all('SELECT * FROM bookings WHERE id = ?', [id])[0];
  if(!b) return res.status(404).json({ error:'no booking' });
  const screenshot = req.file ? ('/uploads/'+path.basename(req.file.path)) : null;
  const paidAt = new Date().toISOString();
  run('UPDATE bookings SET paid=1,amount=?,screenshot=?,paidAt=? WHERE id = ?', [amount,screenshot,paidAt,id]);
  const pid = uuidv4(); const pay = { id: pid, bookingId: id, userEmail: b.userEmail, amount, screenshot, createdAt: paidAt };
  run('INSERT INTO payments (id,bookingId,userEmail,amount,screenshot,createdAt) VALUES (?,?,?,?,?,?)', [pid,id,b.userEmail,amount,screenshot,paidAt]);
  const booking = all('SELECT * FROM bookings WHERE id = ?', [id])[0];
  // create payment notification
  try{ const payRow = { id: pid, bookingId: id, userEmail: b.userEmail, amount, screenshot, createdAt: paidAt }; run('INSERT INTO notifications (id,type,payload,createdAt,isRead) VALUES (?,?,?,?,?)', [uuidv4(),'payment', JSON.stringify(payRow), new Date().toISOString(), 0]); }catch(e){ console.warn('notify payment failed', e); }
  res.json({ booking, payment: pay });
});

// Admin: list notifications (requires admin auth)
app.get('/api/admin/notifications', authMiddleware, (req,res)=>{
  try{
    if(!req.user.isAdmin) return res.status(403).json({ error: 'forbidden' });
    const rows = all('SELECT id,type,payload,createdAt,isRead FROM notifications ORDER BY createdAt DESC');
    const parsed = rows.map(r=>({ id: r.id, type: r.type, payload: (function(){ try{ return JSON.parse(r.payload); }catch(e){ return r.payload; } })(), createdAt: r.createdAt, isRead: !!r.isRead }));
    return res.json({ notifications: parsed });
  }catch(e){ console.warn('admin notifications failed', e); return res.status(500).json({ error: 'server' }); }
});

// mark reached
app.post('/api/bookings/:id/reached', authMiddleware, (req,res)=>{
  const id = req.params.id; const b = all('SELECT * FROM bookings WHERE id = ?', [id])[0]; if(!b) return res.status(404).json({ error:'no booking' });
  const reachedAt = new Date().toISOString(); run('UPDATE bookings SET reached=1,reachedAt=? WHERE id=?', [reachedAt,id]);
  res.json({ ok:true, booking: all('SELECT * FROM bookings WHERE id = ?', [id])[0] });
});

// admin endpoints
app.get('/api/admin/bookings', authMiddleware, (req,res)=>{ if(!req.user.isAdmin) return res.status(403).json({ error:'forbidden' }); const allRows = all('SELECT * FROM bookings'); res.json(allRows); });
app.get('/api/admin/users', authMiddleware, (req,res)=>{ if(!req.user.isAdmin) return res.status(403).json({ error:'forbidden' }); const allRows = all('SELECT id,email,phone,verified,isAdmin FROM users'); res.json(allRows); });
app.get('/api/admin/payments', authMiddleware, (req,res)=>{ if(!req.user.isAdmin) return res.status(403).json({ error:'forbidden' }); const allRows = all('SELECT * FROM payments'); res.json(allRows); });
app.get('/api/admin/users/reached', authMiddleware, (req,res)=>{ if(!req.user.isAdmin) return res.status(403).json({ error:'forbidden' }); const reached = all('SELECT id,uuid,userEmail,reachedAt FROM bookings WHERE reached=1'); res.json(reached); });

// serve uploads and static
app.use('/uploads', express.static(UPLOADS_DIR));
// serve downloaded external resources for offline/localized mode
app.use('/resource', express.static(path.join(__dirname, 'resource')));
app.use('/', express.static(path.join(__dirname)));

// Banner upload: store files under uploads/ads with unique filenames and return public URL
const bannerStorage = multer.diskStorage({
  destination: function(req,file,cb){
    const dir = path.join(UPLOADS_DIR, 'ads');
    try{
      if(!fs.existsSync(dir)) {
        // attempt to create directory; ignore failures on serverless
        fs.mkdirSync(dir, { recursive: true });
      }
    }catch(e){
      console.warn('could not create uploads ads dir:', e && (e.message||e));
    }
    cb(null, dir);
  },
  filename: function(req,file,cb){
    const ext = path.extname(file.originalname) || '.jpg';
    const name = Date.now() + '-' + uuidv4() + ext;
    cb(null, name);
  }
});
const bannerUpload = multer({ storage: bannerStorage });

app.post('/api/uploads/banner', bannerUpload.single('file'), (req, res) => {
  try{
    if(!req.file) return res.status(400).json({ error: 'no file uploaded' });
    const filename = path.basename(req.file.path);
    return res.json({ url: '/uploads/ads/' + filename, filename });
  }catch(e){
    console.warn('banner upload failed', e && (e.stack||e) || e);
    return res.status(500).json({ error: 'upload_failed' });
  }
});

// List banner uploads (returns public URLs)
app.get('/api/uploads/banner/list', (req,res)=>{
  try{
    const dir = path.join(UPLOADS_DIR, 'ads');
    if(!fs.existsSync(dir)) return res.json({ files: [] });
    const files = fs.readdirSync(dir).filter(f=>!f.startsWith('.')).map(f=> '/uploads/ads/' + f);
    return res.json({ files });
  }catch(e){
    console.warn('list banner uploads failed', e && (e.stack||e) || e);
    return res.status(500).json({ error: 'list_failed' });
  }
});

const PORT = process.env.PORT || 3000;

// startup: ensure DB is initialized before starting server
// startup: initialize DB. In serverless (Vercel) export a handler instead of calling app.listen
// Prepare a readiness promise and export a synchronous handler in serverless mode
let _readyPromise = Promise.resolve();
if(IS_VERCEL){
  // Start initialization asynchronously and export a handler immediately.
  _readyPromise = (async ()=>{
    try{ await initDb(); ensureAdmin(); }catch(e){ console.error('init failed', e && (e.stack||e)); }
  })();

  // Export a handler synchronously — Vercel will require this module immediately.
  module.exports = async (req, res) => {
    try{
      await _readyPromise;
      return app(req, res);
    }catch(e){
      console.error('handler init failed', e && (e.stack||e));
      try{ res.statusCode = 500; res.end('Server initialization error'); }catch(_){}
    }
  };
} else {
  // Local / non-serverless startup: init then listen
  (async function start(){
    try{
      await initDb();
      ensureAdmin();
      app.listen(PORT, ()=> console.log('server listening on', PORT));
    }catch(err){
      console.error('startup failed', err); process.exit(1);
    }
  })();
}