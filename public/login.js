document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  const formData = new FormData(e.target);
  const body = {
    username: formData.get('username'),
    password: formData.get('password'),
  };

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || '로그인에 실패했습니다.';
      return;
    }
    window.location.href = '/';
  } catch (err) {
    errorEl.textContent = '서버와 통신할 수 없습니다.';
  }
});
