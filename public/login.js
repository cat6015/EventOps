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

// ---- 로그인 <-> 회원가입 화면 전환 ----
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const showSignupRow = document.getElementById('show-signup-btn').parentElement;
const backToLoginRow = document.getElementById('back-to-login-row');

document.getElementById('show-signup-btn').addEventListener('click', () => {
  loginForm.hidden = true;
  showSignupRow.hidden = true;
  signupForm.hidden = false;
  backToLoginRow.hidden = false;
});

document.getElementById('show-login-btn').addEventListener('click', () => {
  signupForm.hidden = true;
  backToLoginRow.hidden = true;
  loginForm.hidden = false;
  showSignupRow.hidden = false;
});

signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('signup-error');
  const successEl = document.getElementById('signup-success');
  errorEl.textContent = '';
  successEl.textContent = '';

  const formData = new FormData(e.target);
  const password = formData.get('password');
  const passwordConfirm = formData.get('passwordConfirm');
  if (password !== passwordConfirm) {
    errorEl.textContent = '비밀번호가 서로 일치하지 않습니다.';
    return;
  }

  const body = {
    username: formData.get('username'),
    password,
    displayName: formData.get('displayName'),
  };

  try {
    const res = await fetch('/api/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || '가입 신청에 실패했습니다.';
      return;
    }
    signupForm.reset();
    successEl.textContent = data.message || '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.';
  } catch (err) {
    errorEl.textContent = '서버와 통신할 수 없습니다.';
  }
});
