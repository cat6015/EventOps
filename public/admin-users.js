(() => {
  let me = null;

  const el = {
    meName: document.getElementById('me-name'),
    newUsername: document.getElementById('new-username'),
    newPassword: document.getElementById('new-password'),
    newDisplayName: document.getElementById('new-displayname'),
    newRole: document.getElementById('new-role'),
    createUserBtn: document.getElementById('create-user-btn'),
    createUserStatus: document.getElementById('create-user-status'),
    userListBody: document.getElementById('user-list-body'),
    importJson: document.getElementById('import-json'),
    importBtn: document.getElementById('import-btn'),
    importStatus: document.getElementById('import-status'),
  };

  async function api(path, options) {
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    return data;
  }

  async function loadMe() {
    const data = await api('/api/me');
    if (!data.loggedIn || data.user.role !== 'admin') {
      window.location.href = '/login.html';
      return;
    }
    me = data.user;
    el.meName.textContent = `${me.displayName} (관리자)`;
  }

  async function loadUsers() {
    const users = await api('/api/admin/users');
    el.userListBody.innerHTML = users
      .map(
        (u) => `<tr>
          <td>${escapeHtml(u.username)}</td>
          <td>${escapeHtml(u.displayName)}</td>
          <td>
            <select class="role-select" data-username="${escapeHtml(u.username)}" ${u.username === me.username ? 'disabled' : ''}>
              <option value="user" ${u.role === 'user' ? 'selected' : ''}>일반</option>
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>관리자</option>
            </select>
          </td>
          <td>
            <button class="link-btn danger delete-user-btn" data-username="${escapeHtml(u.username)}" ${u.username === me.username ? 'disabled' : ''}>삭제</button>
          </td>
        </tr>`
      )
      .join('');

    el.userListBody.querySelectorAll('.role-select').forEach((sel) => {
      sel.addEventListener('change', async () => {
        try {
          await api(`/api/admin/users/${encodeURIComponent(sel.dataset.username)}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: sel.value }),
          });
          await loadUsers();
        } catch (err) {
          alert(err.message);
          await loadUsers();
        }
      });
    });

    el.userListBody.querySelectorAll('.delete-user-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(`${btn.dataset.username} 계정을 삭제할까요?`)) return;
        try {
          await api(`/api/admin/users/${encodeURIComponent(btn.dataset.username)}`, { method: 'DELETE' });
          await loadUsers();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  el.createUserBtn.addEventListener('click', async () => {
    el.createUserStatus.textContent = '';
    const username = el.newUsername.value.trim();
    const password = el.newPassword.value;
    const displayName = el.newDisplayName.value.trim();
    const role = el.newRole.value;
    if (!username || !password) {
      el.createUserStatus.textContent = '아이디와 비밀번호를 입력해주세요.';
      return;
    }
    try {
      await api('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ username, password, displayName, role }),
      });
      el.newUsername.value = '';
      el.newPassword.value = '';
      el.newDisplayName.value = '';
      el.newRole.value = 'user';
      await loadUsers();
    } catch (err) {
      el.createUserStatus.textContent = err.message;
    }
  });

  el.importBtn.addEventListener('click', async () => {
    el.importStatus.textContent = '';
    let users;
    try {
      const parsed = JSON.parse(el.importJson.value);
      users = Array.isArray(parsed) ? parsed : parsed.users;
      if (!Array.isArray(users)) throw new Error('배열 형식이 아닙니다.');
    } catch (err) {
      el.importStatus.textContent = 'JSON 형식이 올바르지 않습니다.';
      return;
    }
    try {
      const result = await api('/api/admin/users/import', { method: 'POST', body: JSON.stringify({ users }) });
      el.importStatus.textContent = `가져오기 완료: ${result.imported.length}건 추가, ${result.skipped.length}건 건너뜀`;
      el.importJson.value = '';
      await loadUsers();
    } catch (err) {
      el.importStatus.textContent = err.message;
    }
  });

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  (async function init() {
    await loadMe();
    await loadUsers();
  })();
})();
