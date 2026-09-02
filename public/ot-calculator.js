(() => {
  const grid = document.getElementById('ot-day-grid');
  if (!grid) return;

  // 배치도 관리 화면(editor.html)에 탭으로 붙는 경우: 탭 버튼 클릭 시 패널 전환.
  // (로그인/관리자 권한 확인과 로그아웃 버튼은 이미 editor.js가 처리한다.)
  const pageTabs = document.getElementById('page-tabs');
  if (pageTabs) {
    pageTabs.querySelectorAll('.page-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        pageTabs.querySelectorAll('.page-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach((panel) => {
          panel.hidden = panel.id !== btn.dataset.tabTarget;
        });
      });
    });
  }

  const DAYS = [
    { key: 'sun', short: '일', full: '일요일', isSun: true, defaultHoliday: true, excludable: true, defaultExcluded: true },
    { key: 'mon', short: '월', full: '월요일' },
    { key: 'tue', short: '화', full: '화요일' },
    { key: 'wed', short: '수', full: '수요일' },
    { key: 'thu', short: '목', full: '목요일' },
    { key: 'fri', short: '금', full: '금요일' },
    { key: 'sat', short: '토', full: '토요일', defaultHoliday: true, excludable: true, defaultExcluded: true },
  ];

  const TEAMS = [
    { key: 'a', label: '조 A' },
    { key: 'b', label: '조 B' },
  ];

  const WEEKLY_OT_CAP = 12;
  const BASE_HOURS = 8;
  const CALTEO_SPAN_MINUTES = 9 * 60; // 9시간(식사시간 1시간 포함) => 실근무 8시간
  const STORE_KEY = 'admin-ot-calc-week-v5';

  let roster = []; // [{ username, displayName }]

  function minutesToLabel(mins) {
    const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function parseTimeToMinutes(str) {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function fmt(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function teamBlockHtml(d, team) {
    return `
      <div class="ot-team-block" data-team="${team.key}">
        <div class="ot-team-title">${team.label}</div>
        ${d.excludable ? `
        <label class="ot-exclude-toggle">
          <input type="checkbox" class="ot-exclude-check" ${d.defaultExcluded ? 'checked' : ''} />
          <span class="ot-label-text">근무 제외</span>
        </label>` : ''}
        <label class="ot-calteo-toggle">
          <input type="checkbox" class="ot-calteo-check" />
          <span class="ot-label-text">칼퇴</span>
        </label>
        <div class="ot-time-row">
          <label class="ot-time-field">
            <span class="ot-time-caption">출근</span>
            <input type="time" class="ot-checkin-time" value="09:00" />
          </label>
          <label class="ot-time-field ot-checkout-field">
            <span class="ot-time-caption">퇴근</span>
            <input type="time" class="ot-checkout-time" value="18:00" />
          </label>
        </div>
        <details class="ot-people-picker">
          <summary class="ot-people-summary">인원 선택 (0명)</summary>
          <div class="ot-people-list">불러오는 중...</div>
        </details>
        <div class="ot-day-note"></div>
        <div class="ot-day-result">
          근무 <span class="ot-worked-val">0.0h</span> · 정규 <span class="ot-reg-val">0.0h</span> · OT <span class="ot-val">0.0h</span>
        </div>
      </div>
    `;
  }

  DAYS.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'ot-day-card' + (d.isSun ? ' is-sun' : '');
    card.dataset.key = d.key;
    card.innerHTML = `
      <div class="ot-day-head">
        <div>
          <div class="ot-day-name">${d.short}</div>
          <div class="ot-day-full">${d.full}</div>
        </div>
        <label class="ot-holiday-toggle">
          <input type="checkbox" class="ot-holiday-check" ${d.defaultHoliday ? 'checked' : ''} />
          <span class="ot-label-text">휴일</span>
        </label>
      </div>
      <div class="ot-team-row">
        ${TEAMS.map((t) => teamBlockHtml(d, t)).join('')}
      </div>
    `;
    grid.appendChild(card);
  });

  function peopleListHtml() {
    if (!roster.length) return '<div class="ot-people-empty">등록된 계정이 없습니다.</div>';
    return roster
      .map(
        (u) =>
          `<label><input type="checkbox" class="ot-person-check" value="${escapeHtml(u.username)}" />${escapeHtml(u.displayName)}</label>`
      )
      .join('');
  }

  function renderPeopleLists() {
    grid.querySelectorAll('.ot-people-list').forEach((el) => {
      el.innerHTML = peopleListHtml();
    });
  }

  // 인원 체크박스는 명단을 불러온 뒤에야 생겨서, 그 전에 실행되는 recalc()가 매번
  // "선택 인원 없음" 상태를 localStorage에 덮어써 버린다. 그래서 처음 불러온 저장값을
  // 그대로 들고 있다가, 명단이 준비된 뒤 그 값으로 다시 적용한다(localStorage를 다시 읽지 않음).
  async function loadRoster(savedSnapshot) {
    try {
      const res = await fetch('/api/admin/users', { headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => []);
      roster = Array.isArray(data) ? data.filter((u) => u.status !== 'pending') : [];
    } catch (e) {
      roster = [];
    }
    renderPeopleLists();
    applySaved(savedSnapshot);
    recalc();
  }

  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persist(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  }

  function readState() {
    const state = {};
    grid.querySelectorAll('.ot-day-card').forEach((card) => {
      const teams = {};
      card.querySelectorAll('.ot-team-block').forEach((block) => {
        const excludeCheck = block.querySelector('.ot-exclude-check');
        teams[block.dataset.team] = {
          excluded: excludeCheck ? excludeCheck.checked : false,
          calteo: block.querySelector('.ot-calteo-check').checked,
          checkin: block.querySelector('.ot-checkin-time').value,
          checkout: block.querySelector('.ot-checkout-time').value,
          people: Array.from(block.querySelectorAll('.ot-person-check:checked')).map((cb) => cb.value),
        };
      });
      state[card.dataset.key] = {
        holiday: card.querySelector('.ot-holiday-check').checked,
        teams,
      };
    });
    return state;
  }

  function applySaved(saved) {
    if (!saved) return;
    DAYS.forEach((d) => {
      const s = saved[d.key];
      if (!s) return;
      const card = grid.querySelector(`.ot-day-card[data-key="${d.key}"]`);
      card.querySelector('.ot-holiday-check').checked = !!s.holiday;
      TEAMS.forEach((t) => {
        const ts = s.teams && s.teams[t.key];
        if (!ts) return;
        const block = card.querySelector(`.ot-team-block[data-team="${t.key}"]`);
        const excludeCheck = block.querySelector('.ot-exclude-check');
        if (excludeCheck) excludeCheck.checked = !!ts.excluded;
        block.querySelector('.ot-calteo-check').checked = !!ts.calteo;
        if (ts.checkin) block.querySelector('.ot-checkin-time').value = ts.checkin;
        if (ts.checkout) block.querySelector('.ot-checkout-time').value = ts.checkout;
        if (Array.isArray(ts.people)) {
          block.querySelectorAll('.ot-person-check').forEach((cb) => {
            cb.checked = ts.people.includes(cb.value);
          });
        }
      });
    });
  }

  // 근무 제외/휴일 여부에 따라 조 블록 내 나머지 입력의 사용 가능 상태를 맞춘다.
  function syncTeamBlock(block, isHoliday) {
    const excludeCheck = block.querySelector('.ot-exclude-check');
    const isExcluded = !!excludeCheck && excludeCheck.checked;

    const calteoToggle = block.querySelector('.ot-calteo-toggle');
    const calteoCheck = block.querySelector('.ot-calteo-check');
    const timeRow = block.querySelector('.ot-time-row');

    calteoToggle.classList.toggle('is-disabled', isExcluded || isHoliday);
    if (isHoliday) calteoCheck.checked = false;
    timeRow.classList.toggle('is-disabled', isExcluded);

    const isCalteo = !isExcluded && !isHoliday && calteoCheck.checked;
    block.querySelector('.ot-checkout-field').hidden = isCalteo;

    return { isExcluded, isCalteo };
  }

  function updatePeopleSummary(block) {
    const count = block.querySelectorAll('.ot-person-check:checked').length;
    block.querySelector('.ot-people-summary').textContent = `인원 선택 (${count}명)`;
  }

  function recalc() {
    let totalWorked = 0;
    let totalRegular = 0;
    let totalOt = 0;
    const personTotals = new Map(); // username -> { displayName, worked, regular, ot }

    grid.querySelectorAll('.ot-day-card').forEach((card) => {
      const isHoliday = card.querySelector('.ot-holiday-check').checked;
      card.classList.toggle('is-holiday', isHoliday);
      card.querySelector('.ot-holiday-toggle .ot-label-text').classList.toggle('ot-label-on', isHoliday);

      card.querySelectorAll('.ot-team-block').forEach((block) => {
        const { isExcluded, isCalteo } = syncTeamBlock(block, isHoliday);
        block.classList.toggle('is-excluded', isExcluded);
        block.querySelector('.ot-calteo-toggle .ot-label-text').classList.toggle('ot-label-on', isCalteo);
        updatePeopleSummary(block);

        let worked = 0;
        let noteText = '근무하지 않음(제외)';

        if (!isExcluded) {
          const checkinInput = block.querySelector('.ot-checkin-time');
          const checkoutInput = block.querySelector('.ot-checkout-time');
          const checkinMin = parseTimeToMinutes(checkinInput.value) ?? 0;

          let checkoutMin;
          if (isCalteo) {
            checkoutMin = checkinMin + CALTEO_SPAN_MINUTES; // 9시간(식사시간 1시간 포함) => 실근무 8시간
            noteText = `퇴근 ${minutesToLabel(checkoutMin)} · 9시간(식사시간 포함) · 실근무 8시간 · OT 0시간`;
          } else {
            checkoutMin = parseTimeToMinutes(checkoutInput.value) ?? checkinMin;
            if (checkoutMin < checkinMin) checkoutMin += 24 * 60; // 다음날 새벽 퇴근 등 자정을 넘기는 경우
          }

          worked = Math.max(0, (checkoutMin - checkinMin) / 60);
          if (!isCalteo) {
            noteText = `${checkinInput.value || '--:--'} → ${checkoutInput.value || '--:--'} · 근무 ${fmt(worked)}시간`;
          }
        }
        block.querySelector('.ot-day-note').textContent = noteText;

        const regular = isExcluded || isHoliday ? 0 : Math.min(worked, BASE_HOURS);
        const ot = isExcluded ? 0 : isHoliday ? worked : Math.max(0, worked - BASE_HOURS);

        block.querySelector('.ot-worked-val').textContent = fmt(worked) + 'h';
        block.querySelector('.ot-reg-val').textContent = fmt(regular) + 'h';
        const otEl = block.querySelector('.ot-val');
        otEl.textContent = fmt(ot) + 'h';
        otEl.classList.toggle('has-ot', ot > 0);

        totalWorked += worked;
        totalRegular += regular;
        totalOt += ot;

        if (!isExcluded) {
          block.querySelectorAll('.ot-person-check:checked').forEach((cb) => {
            const username = cb.value;
            const displayName = cb.closest('label').textContent.trim();
            const entry = personTotals.get(username) || { displayName, worked: 0, regular: 0, ot: 0 };
            entry.worked += worked;
            entry.regular += regular;
            entry.ot += ot;
            personTotals.set(username, entry);
          });
        }
      });
    });

    document.getElementById('ot-stat-total').innerHTML = fmt(totalWorked) + '<span class="ot-unit">h</span>';
    document.getElementById('ot-stat-regular').innerHTML = fmt(totalRegular) + '<span class="ot-unit">h</span>';
    document.getElementById('ot-stat-ot').innerHTML = fmt(totalOt) + '<span class="ot-unit">h</span>';

    const tbody = document.getElementById('ot-person-table-body');
    const rows = Array.from(personTotals.entries()).sort((a, b) => a[1].displayName.localeCompare(b[1].displayName, 'ko'));
    let overCount = 0;
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="status-msg">조에 배정된 인원이 없습니다.</td></tr>';
    } else {
      tbody.innerHTML = rows
        .map(([username, p]) => {
          const isOver = p.ot > WEEKLY_OT_CAP;
          if (isOver) overCount += 1;
          return `
            <tr class="${isOver ? 'ot-person-row-over' : ''}">
              <td>${escapeHtml(p.displayName)}</td>
              <td>${fmt(p.worked)}h</td>
              <td>${fmt(p.regular)}h</td>
              <td>${fmt(p.ot)}h</td>
              <td>${isOver ? `<span class="badge over-limit">초과 +${fmt(p.ot - WEEKLY_OT_CAP)}h</span>` : '<span class="badge active">정상</span>'}</td>
            </tr>
          `;
        })
        .join('');
    }

    const banner = document.getElementById('ot-banner');
    const bannerText = document.getElementById('ot-banner-text');
    banner.classList.remove('status-bad');
    if (overCount > 0) {
      banner.classList.add('show', 'status-bad');
      bannerText.innerHTML = `<b>${overCount}명</b>이 주 12시간 OT 한도를 초과했습니다. 근로기준법상 연장근무는 주 12시간을 넘길 수 없으니 배정을 조정하세요.`;
    } else {
      banner.classList.remove('show');
    }

    persist(readState());
  }

  // 요일별 근무 제외/휴일/칼퇴/출퇴근시간/인원 선택을 모두 기본값으로 되돌린다.
  function resetToDefaults() {
    DAYS.forEach((d) => {
      const card = grid.querySelector(`.ot-day-card[data-key="${d.key}"]`);
      card.querySelector('.ot-holiday-check').checked = !!d.defaultHoliday;
      card.querySelectorAll('.ot-team-block').forEach((block) => {
        const excludeCheck = block.querySelector('.ot-exclude-check');
        if (excludeCheck) excludeCheck.checked = !!d.defaultExcluded;
        block.querySelector('.ot-calteo-check').checked = false;
        block.querySelector('.ot-checkin-time').value = '09:00';
        block.querySelector('.ot-checkout-time').value = '18:00';
        block.querySelectorAll('.ot-person-check').forEach((cb) => {
          cb.checked = false;
        });
      });
    });
    recalc();
  }

  const resetBtn = document.getElementById('ot-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetToDefaults);
  }

  const initialSaved = loadSaved();
  applySaved(initialSaved);
  grid.addEventListener('change', recalc);
  recalc();
  loadRoster(initialSaved);
})();
