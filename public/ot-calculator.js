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

  const rangeStartInput = document.getElementById('ot-range-start');
  const rangeEndInput = document.getElementById('ot-range-end');
  const rangeStatus = document.getElementById('ot-range-status');

  const TEAMS = [
    { key: 'a', label: '조 A', short: 'A' },
    { key: 'b', label: '조 B', short: 'B' },
  ];
  const OTHER_TEAM = { a: 'b', b: 'a' };

  const WEEKLY_OT_CAP = 12;
  const BASE_HOURS = 8;
  const MEAL_BREAK_HOURS = 1; // 평일/칼퇴 모두 근무시간(출근~퇴근)에서 식사시간 1시간을 뺀다
  const CALTEO_SPAN_MINUTES = 9 * 60; // 9시간(식사시간 1시간 포함) => 실근무 8시간
  const MAX_RANGE_DAYS = 31;
  const WEEKDAY_CHARS = ['일', '월', '화', '수', '목', '금', '토'];
  const STORE_KEY = 'admin-ot-calc-week-v8';

  let roster = []; // [{ username, displayName }]
  let DAYS = []; // 선택된 기간에 속한 날짜들. { key, short, weekday, full, isSun, defaultHoliday, excludable, defaultExcluded }

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

  function toDateObj(str) {
    if (!str) return null;
    const d = new Date(`${str}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toDateStr(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // 저장된 기간이 없을 때: 오늘이 속한 일~토 한 주를 기본값으로 보여준다.
  function defaultRange() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return { start: toDateStr(start), end: toDateStr(end) };
  }

  // 시작일~종료일 문자열로부터 그 기간에 속한 날짜 목록을 만든다.
  // 범위가 비었거나 거꾸로거나 너무 길면 안전한 값으로 보정한다.
  function buildDays(startStr, endStr) {
    let start = toDateObj(startStr);
    let end = toDateObj(endStr);
    if (!start || !end) {
      const def = defaultRange();
      start = toDateObj(def.start);
      end = toDateObj(def.end);
    }
    if (end < start) end = new Date(start);

    let capped = false;
    const maxEnd = new Date(start);
    maxEnd.setDate(maxEnd.getDate() + (MAX_RANGE_DAYS - 1));
    if (end > maxEnd) {
      end = maxEnd;
      capped = true;
    }

    const days = [];
    const cur = new Date(start);
    while (cur <= end) {
      const dow = cur.getDay();
      const isWeekend = dow === 0 || dow === 6;
      days.push({
        key: toDateStr(cur),
        short: `${cur.getMonth() + 1}/${cur.getDate()}`,
        weekday: WEEKDAY_CHARS[dow],
        full: `${cur.getFullYear()}년 ${cur.getMonth() + 1}월 ${cur.getDate()}일 (${WEEKDAY_CHARS[dow]})`,
        isSun: dow === 0,
        defaultHoliday: isWeekend,
        excludable: isWeekend,
        defaultExcluded: isWeekend,
      });
      cur.setDate(cur.getDate() + 1);
    }
    return { days, startStr: toDateStr(start), endStr: toDateStr(end), capped };
  }

  function headerCellHtml(d) {
    return `
      <div class="ot-day-header-name${d.isSun ? ' is-sun' : ''}">${d.short}</div>
      <div class="ot-day-header-full">${d.weekday}요일</div>
      <label class="ot-holiday-toggle">
        <input type="checkbox" class="ot-holiday-check" ${d.defaultHoliday ? 'checked' : ''} />
        <span class="ot-label-text">휴일</span>
      </label>
    `;
  }

  function dayCellHtml(d) {
    return `
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
      <div class="ot-people-selected"></div>
      <div class="ot-day-note"></div>
      <div class="ot-day-result">
        근무 <span class="ot-worked-val">0.0h</span> · 정규 <span class="ot-reg-val">0.0h</span> · OT <span class="ot-val">0.0h</span>
      </div>
    `;
  }

  const table = document.createElement('table');
  table.className = 'ot-week-table';
  grid.appendChild(table);

  function renderTableBody() {
    table.innerHTML = `
      <thead>
        <tr>
          <th class="ot-week-row-label"></th>
          ${DAYS.map((d) => `<th class="ot-day-header" data-day="${d.key}">${headerCellHtml(d)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${TEAMS.map(
          (t) => `
          <tr data-team="${t.key}">
            <td class="ot-week-row-label">${t.label}</td>
            ${DAYS.map((d) => `<td class="ot-day-cell" data-day="${d.key}">${dayCellHtml(d)}</td>`).join('')}
          </tr>
        `
        ).join('')}
      </tbody>
    `;
  }

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
    table.querySelectorAll('.ot-people-list').forEach((el) => {
      el.innerHTML = peopleListHtml();
    });
  }

  // 인원 체크박스는 명단을 불러온 뒤에야 생겨서, 그 전에 실행되는 recalc()가 매번
  // "선택 인원 없음" 상태를 localStorage에 덮어써 버린다. 그래서 처음 불러온 저장값을
  // 그대로 들고 있다가, 명단이 준비된 뒤 그 값으로 다시 적용한다(localStorage를 다시 읽지 않음).
  async function loadRoster(savedDaysSnapshot) {
    try {
      const res = await fetch('/api/admin/users', { headers: { 'Content-Type': 'application/json' } });
      const data = await res.json().catch(() => []);
      roster = Array.isArray(data) ? data.filter((u) => u.status !== 'pending') : [];
    } catch (e) {
      roster = [];
    }
    renderPeopleLists();
    applySavedDays(savedDaysSnapshot);
    recalc();
  }

  function loadLocalSaved() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function persistLocal(data) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      /* ignore */
    }
  }

  // 서버(다른 PC에서도 보이는 공용 저장소)에서 읽어온다. 아직 아무도 저장한 적 없으면
  // rangeStart가 비어 있는데, 그럴 땐 null을 돌려줘서 로컬 저장값/기본값을 대신 쓰게 한다.
  async function fetchServerSchedule() {
    try {
      const res = await fetch('/api/ot-schedule', { headers: { 'Content-Type': 'application/json' } });
      if (!res.ok) return null;
      const data = await res.json();
      return data && data.rangeStart ? data : null;
    } catch (e) {
      return null;
    }
  }

  async function saveServerSchedule(state) {
    const res = await fetch('/api/admin/ot-schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '저장에 실패했습니다.');
    }
    return res.json();
  }

  function dayCellOf(teamKey, dayKey) {
    return table.querySelector(`tr[data-team="${teamKey}"] td[data-day="${dayKey}"]`);
  }

  // 화면에 지금 그려진 날짜(DAYS)들의 입력값 + 현재 선택된 기간을 읽어온다.
  function readState() {
    const days = {};
    DAYS.forEach((d) => {
      const th = table.querySelector(`th[data-day="${d.key}"]`);
      const teams = {};
      TEAMS.forEach((t) => {
        const cell = dayCellOf(t.key, d.key);
        const excludeCheck = cell.querySelector('.ot-exclude-check');
        teams[t.key] = {
          excluded: excludeCheck ? excludeCheck.checked : false,
          calteo: cell.querySelector('.ot-calteo-check').checked,
          checkin: cell.querySelector('.ot-checkin-time').value,
          checkout: cell.querySelector('.ot-checkout-time').value,
          // 사용자명뿐 아니라 표시 이름도 같이 저장한다 — 지도 화면(일반 사용자)은 계정 목록
          // API(/api/admin/users, 관리자 전용)에 접근할 수 없어 이름을 따로 알아낼 수 없기 때문.
          people: Array.from(cell.querySelectorAll('.ot-person-check:checked')).map((cb) => ({
            username: cb.value,
            displayName: cb.closest('label').textContent.trim(),
          })),
        };
      });
      days[d.key] = { holiday: th.querySelector('.ot-holiday-check').checked, teams };
    });
    return { rangeStart: rangeStartInput.value, rangeEnd: rangeEndInput.value, days };
  }

  // 날짜별 저장값(savedDays)을 지금 화면에 그려진 DAYS에 맞춰 되돌린다.
  // savedDays는 { 'YYYY-MM-DD': { holiday, teams } } 형태 — 현재 표시된 기간 밖의 날짜는 무시된다.
  function applySavedDays(savedDays) {
    if (!savedDays) return;
    DAYS.forEach((d) => {
      const s = savedDays[d.key];
      if (!s) return;
      const th = table.querySelector(`th[data-day="${d.key}"]`);
      th.querySelector('.ot-holiday-check').checked = !!s.holiday;
      TEAMS.forEach((t) => {
        const ts = s.teams && s.teams[t.key];
        if (!ts) return;
        const cell = dayCellOf(t.key, d.key);
        const excludeCheck = cell.querySelector('.ot-exclude-check');
        if (excludeCheck) excludeCheck.checked = !!ts.excluded;
        cell.querySelector('.ot-calteo-check').checked = !!ts.calteo;
        if (ts.checkin) cell.querySelector('.ot-checkin-time').value = ts.checkin;
        if (ts.checkout) cell.querySelector('.ot-checkout-time').value = ts.checkout;
        if (Array.isArray(ts.people)) {
          // 예전 형식(사용자명 문자열 배열)과 새 형식({username, displayName} 배열)을 둘 다 받아준다.
          const usernames = new Set(ts.people.map((p) => (typeof p === 'string' ? p : p.username)));
          cell.querySelectorAll('.ot-person-check').forEach((cb) => {
            cb.checked = usernames.has(cb.value);
          });
        }
      });
    });
  }

  // 근무 제외/휴일 여부에 따라 조 칸 내 나머지 입력의 사용 가능 상태를 맞춘다.
  function syncTeamCell(cell, isHoliday) {
    const excludeCheck = cell.querySelector('.ot-exclude-check');
    const isExcluded = !!excludeCheck && excludeCheck.checked;

    const calteoToggle = cell.querySelector('.ot-calteo-toggle');
    const calteoCheck = cell.querySelector('.ot-calteo-check');
    const timeRow = cell.querySelector('.ot-time-row');

    calteoToggle.classList.toggle('is-disabled', isExcluded || isHoliday);
    if (isHoliday) calteoCheck.checked = false;
    timeRow.classList.toggle('is-disabled', isExcluded);

    const isCalteo = !isExcluded && !isHoliday && calteoCheck.checked;
    cell.querySelector('.ot-checkout-field').hidden = isCalteo;

    return { isExcluded, isCalteo };
  }

  // 체크된 인원의 이름을 <details>를 열지 않아도 바로 보이게 칸에 표시한다("한눈에 확인").
  function updatePeopleSummary(cell) {
    const checked = Array.from(cell.querySelectorAll('.ot-person-check:checked'));
    cell.querySelector('.ot-people-summary').textContent = `인원 선택 (${checked.length}명)`;
    const names = checked.map((cb) => cb.closest('label').textContent.trim());
    cell.querySelector('.ot-people-selected').textContent = names.join(', ');
  }

  // 같은 날짜의 다른 조에 이미 배정된 사람은 이 조에서 체크할 수 없게 막는다(중복 배정 방지).
  function updatePeopleAvailability(cell, otherChecked) {
    cell.querySelectorAll('.ot-person-check').forEach((cb) => {
      const isTaken = !cb.checked && otherChecked.has(cb.value);
      cb.disabled = isTaken;
      cb.closest('label').classList.toggle('is-taken', isTaken);
    });
  }

  function entryLabel(e) {
    let label = `${e.dayShort}(${e.teamShort}) ${e.checkin}→${e.checkout}`;
    const tags = [];
    if (e.isHoliday) tags.push('휴일');
    if (e.isCalteo) tags.push('칼퇴');
    if (tags.length) label += ` · ${tags.join('·')}`;
    return label;
  }

  function recalc() {
    let totalWorked = 0;
    let totalRegular = 0;
    let totalOt = 0;
    const personTotals = new Map(); // username -> { displayName, worked, regular, ot, entries: [] }

    DAYS.forEach((d) => {
      const th = table.querySelector(`th[data-day="${d.key}"]`);
      const isHoliday = th.querySelector('.ot-holiday-check').checked;
      th.classList.toggle('is-holiday', isHoliday);
      th.querySelector('.ot-holiday-toggle .ot-label-text').classList.toggle('ot-label-on', isHoliday);

      TEAMS.forEach((t) => {
        const cell = dayCellOf(t.key, d.key);
        const otherCell = dayCellOf(OTHER_TEAM[t.key], d.key);
        const otherChecked = new Set(
          Array.from(otherCell.querySelectorAll('.ot-person-check:checked')).map((cb) => cb.value)
        );
        updatePeopleAvailability(cell, otherChecked);

        const { isExcluded, isCalteo } = syncTeamCell(cell, isHoliday);
        cell.classList.toggle('is-excluded', isExcluded);
        cell.querySelector('.ot-calteo-toggle .ot-label-text').classList.toggle('ot-label-on', isCalteo);
        updatePeopleSummary(cell);

        let worked = 0;
        let noteText = '근무하지 않음(제외)';
        let checkinDisplay = '--:--';
        let checkoutDisplay = '--:--';

        if (!isExcluded) {
          const checkinInput = cell.querySelector('.ot-checkin-time');
          const checkoutInput = cell.querySelector('.ot-checkout-time');
          const checkinMin = parseTimeToMinutes(checkinInput.value) ?? 0;

          let checkoutMin;
          if (isCalteo) {
            checkoutMin = checkinMin + CALTEO_SPAN_MINUTES; // 9시간(식사시간 1시간 포함) => 실근무 8시간
          } else {
            checkoutMin = parseTimeToMinutes(checkoutInput.value) ?? checkinMin;
            if (checkoutMin < checkinMin) checkoutMin += 24 * 60; // 다음날 새벽 퇴근 등 자정을 넘기는 경우
          }

          const rawSpanHours = Math.max(0, (checkoutMin - checkinMin) / 60);
          // 평일/휴일/칼퇴 모두 출근~퇴근 시간에서 식사시간 1시간을 뺀 만큼을 근무시간으로 본다.
          worked = Math.max(0, rawSpanHours - MEAL_BREAK_HOURS);
          checkinDisplay = checkinInput.value || '--:--';
          checkoutDisplay = minutesToLabel(checkoutMin);

          if (isCalteo) {
            noteText = `퇴근 ${checkoutDisplay} · ${fmt(rawSpanHours)}시간(식사시간 1시간 포함) · 실근무 ${fmt(worked)}시간 · OT 0시간`;
          } else {
            noteText = `${checkinDisplay} → ${checkoutInput.value || '--:--'} · 근무 ${fmt(worked)}시간 · 식사시간 1시간 차감`;
          }
        }
        cell.querySelector('.ot-day-note').textContent = noteText;

        const regular = isExcluded || isHoliday ? 0 : Math.min(worked, BASE_HOURS);
        const ot = isExcluded ? 0 : isHoliday ? worked : Math.max(0, worked - BASE_HOURS);

        cell.querySelector('.ot-worked-val').textContent = fmt(worked) + 'h';
        cell.querySelector('.ot-reg-val').textContent = fmt(regular) + 'h';
        const otEl = cell.querySelector('.ot-val');
        otEl.textContent = fmt(ot) + 'h';
        otEl.classList.toggle('has-ot', ot > 0);

        totalWorked += worked;
        totalRegular += regular;
        totalOt += ot;

        if (!isExcluded) {
          cell.querySelectorAll('.ot-person-check:checked').forEach((cb) => {
            const username = cb.value;
            const displayName = cb.closest('label').textContent.trim();
            const entry = personTotals.get(username) || { displayName, worked: 0, regular: 0, ot: 0, entries: [] };
            entry.worked += worked;
            entry.regular += regular;
            entry.ot += ot;
            entry.entries.push({
              dayShort: `${d.short}(${d.weekday})`,
              teamShort: t.short,
              checkin: checkinDisplay,
              checkout: checkoutDisplay,
              isHoliday,
              isCalteo,
            });
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
      tbody.innerHTML = '<tr><td colspan="6" class="status-msg">조에 배정된 인원이 없습니다.</td></tr>';
    } else {
      tbody.innerHTML = rows
        .map(([username, p]) => {
          const isOver = p.ot > WEEKLY_OT_CAP;
          if (isOver) overCount += 1;
          const entriesHtml = p.entries.map((e) => `<div>${escapeHtml(entryLabel(e))}</div>`).join('');
          return `
            <tr class="${isOver ? 'ot-person-row-over' : ''}">
              <td>${escapeHtml(p.displayName)}</td>
              <td>${fmt(p.worked)}h</td>
              <td>${fmt(p.regular)}h</td>
              <td>${fmt(p.ot)}h</td>
              <td>${isOver ? `<span class="badge over-limit">초과 +${fmt(p.ot - WEEKLY_OT_CAP)}h</span>` : '<span class="badge active">정상</span>'}</td>
              <td class="ot-person-entries">${entriesHtml}</td>
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
      bannerText.innerHTML = `<b>${overCount}명</b>이 선택 기간 동안 주 12시간 OT 한도를 초과했습니다. 근로기준법상 연장근무는 주 12시간을 넘길 수 없으니 배정을 조정하세요.`;
    } else {
      banner.classList.remove('show');
    }

    persistLocal(readState());
  }

  // 선택된 기간(DAYS)에 대해 근무 제외/휴일/칼퇴/출퇴근시간/인원 선택을 모두 기본값으로 되돌린다.
  function resetToDefaults() {
    DAYS.forEach((d) => {
      const th = table.querySelector(`th[data-day="${d.key}"]`);
      th.querySelector('.ot-holiday-check').checked = !!d.defaultHoliday;
      TEAMS.forEach((t) => {
        const cell = dayCellOf(t.key, d.key);
        const excludeCheck = cell.querySelector('.ot-exclude-check');
        if (excludeCheck) excludeCheck.checked = !!d.defaultExcluded;
        cell.querySelector('.ot-calteo-check').checked = false;
        cell.querySelector('.ot-checkin-time').value = '09:00';
        cell.querySelector('.ot-checkout-time').value = '18:00';
        cell.querySelectorAll('.ot-person-check').forEach((cb) => {
          cb.checked = false;
        });
      });
    });
    recalc();
  }

  // 기간(시작일/종료일)이 바뀌면 표를 다시 그린다. 지금 화면에 입력돼 있던 값은
  // 날짜별로 들고 있다가, 새 기간에도 같은 날짜가 있으면 그대로 복원한다.
  function applyRange() {
    const priorDays = readState().days;
    const result = buildDays(rangeStartInput.value, rangeEndInput.value);
    DAYS = result.days;
    rangeStartInput.value = result.startStr;
    rangeEndInput.value = result.endStr;
    rangeStatus.textContent = result.capped
      ? `기간은 최대 ${MAX_RANGE_DAYS}일까지 선택할 수 있어 종료일이 자동 조정되었습니다.`
      : '';
    renderTableBody();
    renderPeopleLists();
    applySavedDays(priorDays);
    recalc();
  }

  // 입력할 때마다 localStorage에는 자동 저장되지만(recalc() 끝에서, 이 브라우저 안전망용),
  // 다른 PC에서도 보이려면 서버에 저장해야 한다 — 그건 이 버튼을 눌러야 일어나는 명시적 동작이다.
  function formatNow() {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  const saveBtn = document.getElementById('ot-save-btn');
  const saveStatus = document.getElementById('ot-save-status');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const state = readState();
      persistLocal(state);
      saveBtn.disabled = true;
      if (saveStatus) saveStatus.textContent = '저장 중...';
      try {
        await saveServerSchedule(state);
        if (saveStatus) saveStatus.textContent = `저장됨 (${formatNow()}) · 다른 PC에서도 확인할 수 있습니다`;
      } catch (e) {
        if (saveStatus) saveStatus.textContent = `저장 실패: ${e.message}`;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  const resetBtn = document.getElementById('ot-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetToDefaults();
      if (saveStatus) saveStatus.textContent = '';
    });
  }
  rangeStartInput.addEventListener('change', applyRange);
  rangeEndInput.addEventListener('change', applyRange);

  // 초기 로딩: 서버에 이미 저장된 일정이 있으면 그걸 우선 쓰고(다른 PC/관리자가 저장한 최신 상태),
  // 없으면 이 브라우저에 남아있던 임시 입력값을 쓴다.
  (async function init() {
    const local = loadLocalSaved() || {};
    const server = await fetchServerSchedule();
    const initial = server || local;

    const initRange = buildDays(initial.rangeStart, initial.rangeEnd);
    DAYS = initRange.days;
    rangeStartInput.value = initRange.startStr;
    rangeEndInput.value = initRange.endStr;
    renderTableBody();
    applySavedDays(initial.days);
    grid.addEventListener('change', recalc);
    recalc();
    loadRoster(initial.days);
  })();
})();
