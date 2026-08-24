function requireLogin(req, res, next) {
  if (req.session && req.session.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  return res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  if (req.originalUrl.startsWith('/api/')) {
    return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
  }
  return res.redirect('/');
}

module.exports = { requireLogin, requireAdmin };
