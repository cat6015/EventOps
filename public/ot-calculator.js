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
    { key: 'sun', short: '일', full: '일요일', isSun: true },
    { key: 'mon', short: '월', full: '월요일' },
    { key: 'tue', short: '화', full: '화요일' },
    { key: 'wed', short: '수', full: '수요일' },
    { key: 'thu', short: '목', full: '목요일' },
    { key: 'fri', short: '금', full: '금요일' },
    { key: 'sat', short: '토', full: '토요일' },
  ];

  const WEEKLY_OT_CAP = 12;
  const BASE_HOURS = 8;
  const CALTEO_SPAN_MINUTES = 9 * 60; // 9시간(식사시간 1시간 포함) => 실근무 8시간
  const STORE_KEY = 'admin-ot-calc-week-v2';

  function hourOptions(selected) {
    let out = '';
    for (let h = 0; h <= 16; h += 0.5) {
      out += `<option value="${h}" ${h === selected ? 'selected' : ''}>${h.toFixed(1)}시간</option>`;
    }
    return out;
  }

  function minutesToLabel(mins) {
    const wrapped = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
    const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
    const mm = String(wrapped % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function checkinOptions(selectedMinutes) {
    let out = '';
    for (let m = 6 * 60; m <= 12 * 60; m += 30) {
      const label = minutesToLabel(m);
      out += `<option value="${m}" ${m === selectedMinutes ? 'selected' : ''}>${label} 출근</option>`;
    }
    return out;
  }

  DAYS.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'ot-day-card' + (d.isSun ? ' is-sun' : '');
    card.dataset.key = d.key;
    card.innerHTML = `
      <div>
        <div class="ot-day-name">${d.short}</div>
        <div class="ot-day-full">${d.full}</div>
      </div>
      <label class="ot-holiday-toggle">
        <input type="checkbox" class="ot-holiday-check" />
        <span class="ot-label-text">휴일</span>
      </label>
      <label class="ot-calteo-toggle">
        <input type="checkbox" class="ot-calteo-check" />
        <span class="ot-label-text">칼퇴</span>
      </label>
      <select class="ot-hours-select">${hourOptions(0)}</select>
      <div class="ot-checkin-wrap" hidden>
        <select class="ot-checkin-select">${checkinOptions(9 * 60)}</select>
        <div class="ot-checkin-note"></div>
      </div>
      <div class="ot-day-result">
        정규 <span class="ot-reg-val">0.0h</span> · OT <span class="ot-val">0.0h</span>
      </div>
    `;
    grid.appendChild(card);
  });

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
      state[card.dataset.key] = {
        holiday: card.querySelector('.ot-holiday-check').checked,
        calteo: card.querySelector('.ot-calteo-check').checked,
        hours: parseFloat(card.querySelector('.ot-hours-select').value),
        checkin: parseInt(card.querySelector('.ot-checkin-select').value, 10),
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
      card.querySelector('.ot-calteo-check').checked = !!s.calteo;
      const sel = card.querySelector('.ot-hours-select');
      if (sel.querySelector(`option[value="${s.hours}"]`)) {
        sel.value = String(s.hours);
      }
      const checkinSel = card.querySelector('.ot-checkin-select');
      if (Number.isFinite(s.checkin) && checkinSel.querySelector(`option[value="${s.checkin}"]`)) {
        checkinSel.value = String(s.checkin);
      }
    });
  }

  function fmt(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // 휴일 여부에 따라 칼퇴 토글의 사용 가능 상태와, 시간 입력 방식(직접 선택 vs 출근시간 기준)을 맞춘다.
  function syncCardMode(card) {
    const isHoliday = card.querySelector('.ot-holiday-check').checked;
    const calteoToggle = card.querySelector('.ot-calteo-toggle');
    const calteoCheck = card.querySelector('.ot-calteo-check');

    calteoToggle.classList.toggle('is-disabled', isHoliday);
    if (isHoliday) calteoCheck.checked = false;

    const isCalteo = !isHoliday && calteoCheck.checked;
    card.querySelector('.ot-hours-select').hidden = isCalteo;
    card.querySelector('.ot-checkin-wrap').hidden = !isCalteo;

    return { isHoliday, isCalteo };
  }

  function recalc() {
    let totalWorked = 0;
    let totalRegular = 0;
    let totalOt = 0;

    grid.querySelectorAll('.ot-day-card').forEach((card) => {
      const { isHoliday, isCalteo } = syncCardMode(card);

      card.classList.toggle('is-holiday', isHoliday);
      card.querySelector('.ot-holiday-toggle .ot-label-text').classList.toggle('ot-label-on', isHoliday);
      card.querySelector('.ot-calteo-toggle .ot-label-text').classList.toggle('ot-label-on', isCalteo);

      let hours;
      if (isCalteo) {
        hours = BASE_HOURS; // 9시간 근무(식사시간 1시간 포함) => 실근무 8시간, OT 0시간
        const checkinMin = parseInt(card.querySelector('.ot-checkin-select').value, 10);
        const checkoutLabel = minutesToLabel(checkinMin + CALTEO_SPAN_MINUTES);
        card.querySelector('.ot-checkin-note').textContent =
          `퇴근 ${checkoutLabel} · 9시간(식사시간 포함) · 실근무 8시간 · OT 0시간`;
      } else {
        hours = parseFloat(card.querySelector('.ot-hours-select').value) || 0;
      }

      const regular = isHoliday ? 0 : Math.min(hours, BASE_HOURS);
      const ot = isHoliday ? hours : Math.max(0, hours - BASE_HOURS);

      card.querySelector('.ot-reg-val').textContent = fmt(regular) + 'h';
      const otEl = card.querySelector('.ot-val');
      otEl.textContent = fmt(ot) + 'h';
      otEl.classList.toggle('has-ot', ot > 0);

      totalWorked += hours;
      totalRegular += regular;
      totalOt += ot;
    });

    document.getElementById('ot-stat-total').innerHTML = fmt(totalWorked) + '<span class="ot-unit">h</span>';
    document.getElementById('ot-stat-regular').innerHTML = fmt(totalRegular) + '<span class="ot-unit">h</span>';
    document.getElementById('ot-stat-ot').innerHTML = fmt(totalOt) + '<span class="ot-unit">h</span>';

    const remaining = WEEKLY_OT_CAP - totalOt;
    const limitCard = document.getElementById('ot-stat-limit-card');
    const limitEl = document.getElementById('ot-stat-limit');
    const otCard = document.getElementById('ot-stat-ot-card');

    if (remaining >= 0) {
      limitEl.innerHTML = fmt(remaining) + '<span class="ot-unit">h</span>';
      limitCard.classList.remove('status-bad');
      limitCard.classList.add('status-good');
      otCard.classList.remove('status-bad');
    } else {
      limitEl.innerHTML = '-' + fmt(Math.abs(remaining)) + '<span class="ot-unit">h</span>';
      limitCard.classList.remove('status-good');
      limitCard.classList.add('status-bad');
      otCard.classList.add('status-bad');
    }

    const ratio = Math.min(1, totalOt / WEEKLY_OT_CAP);
    const fill = document.getElementById('ot-gauge-fill');
    fill.style.width = (ratio * 100).toFixed(1) + '%';
    fill.classList.remove('status-warn', 'status-bad');
    if (totalOt > WEEKLY_OT_CAP) {
      fill.classList.add('status-bad');
    } else if (totalOt >= WEEKLY_OT_CAP * 0.85) {
      fill.classList.add('status-warn');
    }

    document.getElementById('ot-gauge-fig').textContent = `${fmt(totalOt)} / ${WEEKLY_OT_CAP.toFixed(1)}h`;

    const banner = document.getElementById('ot-banner');
    const bannerText = document.getElementById('ot-banner-text');
    banner.classList.remove('status-bad');
    if (totalOt > WEEKLY_OT_CAP) {
      banner.classList.add('show', 'status-bad');
      bannerText.innerHTML = `주 12시간 한도를 <b>${fmt(totalOt - WEEKLY_OT_CAP)}시간</b> 초과했습니다. 근로기준법상 연장근무는 주 12시간을 넘길 수 없으니 근무시간을 조정하세요.`;
    } else {
      banner.classList.remove('show');
    }

    persist(readState());
  }

  applySaved(loadSaved());
  grid.querySelectorAll('.ot-day-card').forEach(syncCardMode);
  grid.addEventListener('change', recalc);
  recalc();
})();
