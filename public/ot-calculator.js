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

  const WEEKLY_OT_CAP = 12;
  const BASE_HOURS = 8;
  const CALTEO_SPAN_MINUTES = 9 * 60; // 9시간(식사시간 1시간 포함) => 실근무 8시간
  const STORE_KEY = 'admin-ot-calc-week-v4';

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

  DAYS.forEach((d) => {
    const card = document.createElement('div');
    card.className = 'ot-day-card' + (d.isSun ? ' is-sun' : '');
    card.dataset.key = d.key;
    card.innerHTML = `
      <div>
        <div class="ot-day-name">${d.short}</div>
        <div class="ot-day-full">${d.full}</div>
      </div>
      ${d.excludable ? `
      <label class="ot-exclude-toggle">
        <input type="checkbox" class="ot-exclude-check" ${d.defaultExcluded ? 'checked' : ''} />
        <span class="ot-label-text">근무 제외</span>
      </label>` : ''}
      <label class="ot-holiday-toggle">
        <input type="checkbox" class="ot-holiday-check" ${d.defaultHoliday ? 'checked' : ''} />
        <span class="ot-label-text">휴일</span>
      </label>
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
      <div class="ot-day-note"></div>
      <div class="ot-day-result">
        근무 <span class="ot-worked-val">0.0h</span> · 정규 <span class="ot-reg-val">0.0h</span> · OT <span class="ot-val">0.0h</span>
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
      const excludeCheck = card.querySelector('.ot-exclude-check');
      state[card.dataset.key] = {
        excluded: excludeCheck ? excludeCheck.checked : false,
        holiday: card.querySelector('.ot-holiday-check').checked,
        calteo: card.querySelector('.ot-calteo-check').checked,
        checkin: card.querySelector('.ot-checkin-time').value,
        checkout: card.querySelector('.ot-checkout-time').value,
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
      const excludeCheck = card.querySelector('.ot-exclude-check');
      if (excludeCheck) excludeCheck.checked = !!s.excluded;
      card.querySelector('.ot-holiday-check').checked = !!s.holiday;
      card.querySelector('.ot-calteo-check').checked = !!s.calteo;
      if (s.checkin) card.querySelector('.ot-checkin-time').value = s.checkin;
      if (s.checkout) card.querySelector('.ot-checkout-time').value = s.checkout;
    });
  }

  function fmt(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // 근무 제외/휴일 여부에 따라 나머지 입력의 사용 가능 상태와, 퇴근시간 입력 방식(직접 선택 vs 출근시간+9h 자동계산)을 맞춘다.
  function syncCardMode(card) {
    const excludeCheck = card.querySelector('.ot-exclude-check');
    const isExcluded = !!excludeCheck && excludeCheck.checked;

    const holidayToggle = card.querySelector('.ot-holiday-toggle');
    const calteoToggle = card.querySelector('.ot-calteo-toggle');
    const calteoCheck = card.querySelector('.ot-calteo-check');
    const timeRow = card.querySelector('.ot-time-row');

    holidayToggle.classList.toggle('is-disabled', isExcluded);
    calteoToggle.classList.toggle('is-disabled', isExcluded);
    timeRow.classList.toggle('is-disabled', isExcluded);

    const isHoliday = card.querySelector('.ot-holiday-check').checked;
    calteoToggle.classList.toggle('is-disabled', isExcluded || isHoliday);
    if (isHoliday) calteoCheck.checked = false;

    const isCalteo = !isExcluded && !isHoliday && calteoCheck.checked;
    card.querySelector('.ot-checkout-field').hidden = isCalteo;

    return { isExcluded, isHoliday, isCalteo };
  }

  function recalc() {
    let totalWorked = 0;
    let totalRegular = 0;
    let totalOt = 0;

    grid.querySelectorAll('.ot-day-card').forEach((card) => {
      const { isExcluded, isHoliday, isCalteo } = syncCardMode(card);

      card.classList.toggle('is-excluded', isExcluded);
      card.classList.toggle('is-holiday', isHoliday);
      card.querySelector('.ot-holiday-toggle .ot-label-text').classList.toggle('ot-label-on', isHoliday);
      card.querySelector('.ot-calteo-toggle .ot-label-text').classList.toggle('ot-label-on', isCalteo);

      let worked = 0;
      let noteText = '근무하지 않음(제외)';

      if (!isExcluded) {
        const checkinInput = card.querySelector('.ot-checkin-time');
        const checkoutInput = card.querySelector('.ot-checkout-time');
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
      card.querySelector('.ot-day-note').textContent = noteText;

      const regular = isExcluded || isHoliday ? 0 : Math.min(worked, BASE_HOURS);
      const ot = isExcluded ? 0 : isHoliday ? worked : Math.max(0, worked - BASE_HOURS);

      card.querySelector('.ot-worked-val').textContent = fmt(worked) + 'h';
      card.querySelector('.ot-reg-val').textContent = fmt(regular) + 'h';
      const otEl = card.querySelector('.ot-val');
      otEl.textContent = fmt(ot) + 'h';
      otEl.classList.toggle('has-ot', ot > 0);

      totalWorked += worked;
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

  // 요일별 근무 제외/휴일/칼퇴 체크와 출퇴근 시간을 모두 기본값(토·일은 근무 제외+휴일, 09:00~18:00)으로 되돌린다.
  function resetToDefaults() {
    DAYS.forEach((d) => {
      const card = grid.querySelector(`.ot-day-card[data-key="${d.key}"]`);
      const excludeCheck = card.querySelector('.ot-exclude-check');
      if (excludeCheck) excludeCheck.checked = !!d.defaultExcluded;
      card.querySelector('.ot-holiday-check').checked = !!d.defaultHoliday;
      card.querySelector('.ot-calteo-check').checked = false;
      card.querySelector('.ot-checkin-time').value = '09:00';
      card.querySelector('.ot-checkout-time').value = '18:00';
    });
    recalc();
  }

  const resetBtn = document.getElementById('ot-reset-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', resetToDefaults);
  }

  applySaved(loadSaved());
  grid.querySelectorAll('.ot-day-card').forEach(syncCardMode);
  grid.addEventListener('change', recalc);
  recalc();
})();
