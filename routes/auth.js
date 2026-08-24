const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const store = require('../store');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '가입 신청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
});

router.post('/signup', signupLimiter, async (req, res) => {
  const { username, password, displayName } = req.body || {};
  if (!username || !String(username).trim() || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 최소 8자 이상이어야 합니다.' });
  }
  const trimmedUsername = String(username).trim();
  if (store.findUser(trimmedUsername)) {
    return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    store.addUser({
      username: trimmedUsername,
      passwordHash,
      displayName: displayName && String(displayName).trim() ? String(displayName).trim() : trimmedUsername,
      role: 'user',
      status: 'pending',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.' });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }

  const user = store.findUser(username);
  if (!user) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  if (user.status === 'pending') {
    return res.status(403).json({ error: '아직 관리자 승인 대기 중인 계정입니다. 승인 후 로그인해주세요.' });
  }

  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: '로그인 처리 중 오류가 발생했습니다.' });
    req.session.user = {
      username: user.username,
      displayName: user.displayName,
      role: user.role === 'admin' ? 'admin' : 'user',
    };
    res.json({ ok: true, displayName: user.displayName, role: req.session.user.role });
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (req.session && req.session.user) {
    return res.json({ loggedIn: true, user: req.session.user });
  }
  res.json({ loggedIn: false });
});

module.exports = router;
