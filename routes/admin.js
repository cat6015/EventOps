const express = require('express');
const bcrypt = require('bcryptjs');
const store = require('../store');

const router = express.Router();

function toPublicUser(u) {
  return {
    username: u.username,
    displayName: u.displayName,
    role: u.role === 'admin' ? 'admin' : 'user',
    status: u.status === 'pending' ? 'pending' : 'approved',
    createdAt: u.createdAt,
  };
}

router.get('/admin/users', (req, res) => {
  res.json(store.getUsers().map(toPublicUser));
});

router.post('/admin/users', async (req, res) => {
  const { username, password, displayName, role } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: '아이디와 비밀번호를 입력해주세요.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: '비밀번호는 최소 8자 이상이어야 합니다.' });
  }
  if (role && role !== 'user' && role !== 'admin') {
    return res.status(400).json({ error: '권한 값이 올바르지 않습니다.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    store.addUser({
      username,
      passwordHash,
      displayName: displayName || username,
      role: role === 'admin' ? 'admin' : 'user',
      status: 'approved',
      createdAt: new Date().toISOString(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 회원가입으로 만들어진(승인 대기) 계정을 관리자가 승인한다.
router.post('/admin/users/:username/approve', (req, res) => {
  const { username } = req.params;
  const target = store.findUser(username);
  if (!target) {
    return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  }
  store.approveUser(username);
  res.json({ ok: true });
});

router.delete('/admin/users/:username', (req, res) => {
  const { username } = req.params;

  if (username === req.session.user.username) {
    return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
  }

  const target = store.findUser(username);
  if (!target) {
    return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  }

  if (target.role === 'admin') {
    const adminCount = store.getUsers().filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '마지막 관리자 계정은 삭제할 수 없습니다.' });
    }
  }

  store.removeUser(username);
  res.json({ ok: true });
});

router.patch('/admin/users/:username/role', (req, res) => {
  const { username } = req.params;
  const { role } = req.body || {};

  if (role !== 'user' && role !== 'admin') {
    return res.status(400).json({ error: '권한 값이 올바르지 않습니다.' });
  }

  const target = store.findUser(username);
  if (!target) {
    return res.status(404).json({ error: '계정을 찾을 수 없습니다.' });
  }

  const currentRole = target.role === 'admin' ? 'admin' : 'user';
  if (currentRole === role) {
    return res.json({ ok: true });
  }

  if (currentRole === 'admin' && role === 'user') {
    const adminCount = store.getUsers().filter((u) => u.role === 'admin').length;
    if (adminCount <= 1) {
      return res.status(400).json({ error: '마지막 관리자 계정의 권한은 변경할 수 없습니다.' });
    }
  }

  store.setUserRole(username, role);
  res.json({ ok: true });
});

// oct-portal의 users.json 내용을 그대로 붙여넣어 계정을 일괄 등록한다.
// (자동 연계 없음 — 관리자가 수동으로 내려받아 붙여넣는 1회성 작업)
router.post('/admin/users/import', (req, res) => {
  const { users } = req.body || {};

  if (!Array.isArray(users)) {
    return res.status(400).json({ error: 'users 배열 형식의 JSON을 붙여넣어주세요.' });
  }

  try {
    const result = store.importUsers(users);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
