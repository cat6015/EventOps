require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');

const store = require('./store');
const { requireLogin, requireAdmin } = require('./middleware');
const authRoutes = require('./routes/auth');
const eventRoutes = require('./routes/events');
const alertRoutes = require('./routes/alerts');
const adminRoutes = require('./routes/admin');
const { initSocket } = require('./socket');

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const sessionMiddleware = session({
  store: new FileStore({ path: path.join(STORAGE_DIR, 'data', 'sessions'), logFn: () => {} }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 12 * 60 * 60 * 1000, // 12시간
  },
});
app.use(sessionMiddleware);

// 로그인 페이지 및 정적 자원은 인증 없이 접근 가능
app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/login.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.js'));
});
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.get('/favicon.png', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.png'));
});

app.use('/api', authRoutes);
app.use('/api', requireLogin, eventRoutes);
app.use('/api', requireLogin, alertRoutes);
app.use('/api', requireLogin, requireAdmin, adminRoutes);

// 배치도 이미지는 로그인한 사용자만 조회 가능
app.use('/uploads/floorplans', requireLogin, express.static(store.UPLOADS_DIR));

// 지도 화면(전 직원 공용)
app.get('/', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});
app.get('/map.html', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});
app.get('/map.js', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.js'));
});

// 관리자 전용 화면
app.get('/editor.html', requireLogin, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.html'));
});
app.get('/editor.js', requireLogin, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'editor.js'));
});
app.get('/admin-users.html', requireLogin, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-users.html'));
});
app.get('/admin-users.js', requireLogin, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-users.js'));
});
app.get('/ot-calculator.js', requireLogin, requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ot-calculator.js'));
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const httpServer = http.createServer(app);
initSocket(httpServer, sessionMiddleware);

store.init();
store
  .ensureBootstrapAdmin()
  .catch((err) => console.error('부트스트랩 관리자 생성 실패:', err.message))
  .finally(() => {
    httpServer.listen(PORT, () => {
      console.log(`booth-as-map이 http://localhost:${PORT} 에서 실행 중입니다.`);
    });
  });
