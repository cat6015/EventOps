(() => {
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 4;
  const LOCATE_ZOOM = 2;

  const state = {
    me: null,
    issueTypes: [],
    resolutionTypes: [],
    eventId: null,
    event: null,
    activeZoneId: null,
    currentAspect: null, // 현재 표시 중인 배치도의 세로/가로 비율(화면 맞춤 재계산용)
    markers: new Map(),
    zoneMarkers: new Map(),
    viewBooths: [],
    openAlerts: [],
    socket: null,
    zoom: 1,
    wideZoom: false, // PC에서 확대 중일 때 지도 영역이 화면 가로폭 전체를 쓰는 중인지
    resolvingAlertId: null,
    reportBoothByLabel: new Map(),
    otSchedule: null, // OT 계산기(editor.html)에서 저장한 근무 일정 — "지금 근무 중" 계산에 쓴다
    selectedDate: null, // 담당자/근무 현황을 조회할 날짜(YYYY-MM-DD). 기본값은 오늘.
    onboardingFilterOn: false, // "온보딩미진행" 탭이 켜져 있는지 — 켜지면 온보딩 미진행 부스만 지도에 보여준다
    locatedMarkerEl: null, // 검색으로 찾아가 반짝이는 중인 마커 — 지도 밖 클릭/부스 클릭 전까지 유지된다
  };

  const el = {
    meName: document.getElementById('me-name'),
    navEditor: document.getElementById('nav-editor'),
    navUsers: document.getElementById('nav-users'),
    eventSelect: document.getElementById('event-select'),
    installStartBtn: document.getElementById('install-start-btn'),
    staffDatePicker: document.getElementById('staff-date-picker'),
    todayStaffPanel: document.getElementById('today-staff-panel'),
    onDutyPanel: document.getElementById('on-duty-panel'),
    zoneTabs: document.getElementById('zone-tabs'),
    activeAsBanner: document.getElementById('active-as-banner'),
    activeAsBannerTitle: document.getElementById('active-as-banner-title'),
    activeAsList: document.getElementById('active-as-list'),
    mapStage: document.getElementById('map-stage'),
    mapCanvas: document.getElementById('map-canvas'),
    mapEmpty: document.getElementById('map-empty'),
    floorplanImg: document.getElementById('floorplan-img'),
    mapOverlay: document.getElementById('map-overlay'),
    zoomInBtn: document.getElementById('zoom-in-btn'),
    zoomOutBtn: document.getElementById('zoom-out-btn'),
    zoomResetBtn: document.getElementById('zoom-reset-btn'),
    zoomLevel: document.getElementById('zoom-level'),
    reportBoothSearch: document.getElementById('report-booth-search'),
    reportBoothDatalist: document.getElementById('report-booth-datalist'),
    boothLocateSearch: document.getElementById('booth-locate-search'),
    boothLocateDatalist: document.getElementById('booth-locate-datalist'),
    reportIssueSelect: document.getElementById('report-issue-select'),
    reportNote: document.getElementById('report-note'),
    reportSubmit: document.getElementById('report-submit'),
    reportStatus: document.getElementById('report-status'),
    openCount: document.getElementById('open-count'),
    openAlertsBody: document.getElementById('open-alerts-body'),
    resolvedAlertsBody: document.getElementById('resolved-alerts-body'),
    popover: document.getElementById('issue-popover'),
    popoverTitle: document.getElementById('popover-title'),
    popoverStoreInfoToggle: document.getElementById('popover-store-info-toggle'),
    popoverStoreInfo: document.getElementById('popover-store-info'),
    popoverInstallStatus: document.getElementById('popover-install-status'),
    popoverOpenList: document.getElementById('popover-open-list'),
    popoverClose: document.getElementById('popover-close'),
    resolveModal: document.getElementById('resolve-modal'),
    resolveModalType: document.getElementById('resolve-modal-type'),
    resolveModalNote: document.getElementById('resolve-modal-note'),
    resolveModalError: document.getElementById('resolve-modal-error'),
    resolveModalCancel: document.getElementById('resolve-modal-cancel'),
    resolveModalSave: document.getElementById('resolve-modal-save'),
    installStartModal: document.getElementById('install-start-modal'),
    installSelectAll: document.getElementById('install-select-all'),
    installBoothChecklist: document.getElementById('install-booth-checklist'),
    installStartModalError: document.getElementById('install-start-modal-error'),
    installStartModalCancel: document.getElementById('install-start-modal-cancel'),
    installStartModalSave: document.getElementById('install-start-modal-save'),
  };

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    return data;
  }

  async function loadMe() {
    const data = await api('/api/me');
    if (!data.loggedIn) {
      window.location.href = '/login.html';
      return;
    }
    state.me = data.user;
    el.meName.textContent = `${data.user.displayName} (${data.user.role === 'admin' ? '관리자' : '일반'})`;
    if (data.user.role === 'admin') {
      el.navEditor.hidden = false;
      el.navUsers.hidden = false;
      el.installStartBtn.hidden = false;
    }
  }

  async function loadIssueTypes() {
    state.issueTypes = await api('/api/issue-types');
    el.reportIssueSelect.innerHTML = state.issueTypes
      .map((t) => `<option value="${t.id}">${t.label}</option>`)
      .join('');
  }

  async function loadResolutionTypes() {
    state.resolutionTypes = await api('/api/resolution-types');
    el.resolveModalType.innerHTML = state.resolutionTypes
      .map((t) => `<option value="${t.id}">${t.label}</option>`)
      .join('');
  }

  async function loadEvents() {
    const events = await api('/api/events');
    if (events.length === 0) {
      el.eventSelect.innerHTML = '<option value="">등록된 행사가 없습니다</option>';
      return;
    }
    el.eventSelect.innerHTML = events
      .map((e) => `<option value="${e.id}">${e.name}${e.status === 'archived' ? ' (종료)' : ''}</option>`)
      .join('');
    const active = events.find((e) => e.isDefault) || events.find((e) => e.status === 'active') || events[0];
    el.eventSelect.value = active.id;
    await selectEvent(active.id);
  }

  async function selectEvent(eventId) {
    state.eventId = eventId;
    state.activeZoneId = null;
    resetZoom();
    closePopover();
    await loadEventDetail(eventId);
    await refreshAlerts();
    if (state.socket) {
      window.SocketClient.switchEvent(state.socket, eventId);
    } else {
      state.socket = window.SocketClient.connect(eventId, {
        onAlertCreated: ({ alert }) => {
          if (alert.eventId !== state.eventId) return;
          if (addOpenAlert(alert)) playSirenBeep();
        },
        onAlertResolved: (payload) => {
          removeOpenAlert(payload.alertId);
          loadResolvedAlerts();
        },
        onInstallUpdated: ({ booths }) => {
          for (const b of booths) {
            const local = state.event.booths.find((x) => x.id === b.id);
            if (local) local.installStatus = b.installStatus;
          }
          // "온보딩미진행" 탭은 마커 자체를 필터링해서 보여주는 중이라, 다른 세션에서
          // 온보딩완료 처리를 하면 그 부스가 화면에서 빠지도록 지도를 통째로 다시 그려야 한다
          // (applyAlertsToMap은 이미 그려진 마커의 색/상태만 바꿀 뿐 마커 목록 자체는 바꾸지 않는다).
          if (state.onboardingFilterOn) {
            renderCurrentMap();
          } else {
            applyAlertsToMap();
          }
        },
      });
    }
  }

  async function loadEventDetail(eventId) {
    const event = await api(`/api/events/${eventId}`);
    state.event = event;

    renderReportBoothOptions();

    renderZoneTabs();
    renderTodayStaffPanel();
    renderOnDutyPanel();
    renderCurrentMap();
  }

  // 부스번호/상호/사업자번호로 검색해 고를 수 있도록 datalist 옵션을 만든다.
  function boothSearchLabel(b) {
    const parts = [b.number];
    if (b.storeName) parts.push(b.storeName);
    if (b.businessNumber) parts.push(b.businessNumber);
    return parts.join(' · ');
  }

  function renderReportBoothOptions() {
    const booths = state.event.booths
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number, 'ko', { numeric: true }));
    state.reportBoothByLabel = new Map();
    const optionsHtml = booths
      .map((b) => {
        const label = boothSearchLabel(b);
        state.reportBoothByLabel.set(label, b.id);
        return `<option value="${escapeHtml(label)}"></option>`;
      })
      .join('');
    el.reportBoothDatalist.innerHTML = optionsHtml;
    // 배치도 위 검색창(위치 찾기)도 같은 부스 목록/라벨을 그대로 재사용한다.
    el.boothLocateDatalist.innerHTML = optionsHtml;
  }

  function getActiveZone() {
    if (!state.event || !state.activeZoneId) return null;
    return state.event.zones.find((z) => z.id === state.activeZoneId) || null;
  }

  function currentFloorplanPath() {
    const zone = getActiveZone();
    return zone ? zone.floorplanImagePath : state.event ? state.event.floorplanImagePath : null;
  }

  // 구역 탭에서는 zoneXPct/zoneYPct를, 전체 배치도 탭에서는 xPct/yPct를 그 탭의 좌표로 쓴다.
  // "온보딩미진행" 탭이 켜져 있으면 그중에서도 온보딩 미진행 부스만 남긴다.
  function getViewBooths() {
    if (!state.event) return [];
    const zone = getActiveZone();
    let booths;
    if (zone) {
      booths = state.event.booths
        .filter((b) => b.zoneId === zone.id)
        .map((b) => ({ ...b, xPct: b.zoneXPct, yPct: b.zoneYPct }));
    } else {
      booths = state.event.booths;
    }
    if (state.onboardingFilterOn) {
      booths = booths.filter((b) => b.installStatus === 'onboarding_needed');
    }
    return booths;
  }

  function getOnboardingPendingBooths() {
    if (!state.event) return [];
    return state.event.booths.filter((b) => b.installStatus === 'onboarding_needed');
  }

  function zoneOpenAlertCount(zoneId) {
    const boothIds = new Set(state.event.booths.filter((b) => b.zoneId === zoneId).map((b) => b.id));
    return state.openAlerts.filter((a) => boothIds.has(a.boothId)).length;
  }

  function renderZoneTabs() {
    if (!state.event) {
      el.zoneTabs.innerHTML = '';
      return;
    }
    const zones = state.event.zones || [];
    const overviewActive = !state.activeZoneId && !state.onboardingFilterOn;
    const tabs = [`<button data-zone-id="" class="${overviewActive ? 'active' : ''}">전체 배치도</button>`];
    zones.forEach((z) => {
      const count = zoneOpenAlertCount(z.id);
      const badge = count > 0 ? ` <span class="tab-alert-badge">${count}</span>` : '';
      const isActive = !state.onboardingFilterOn && state.activeZoneId === z.id;
      const classes = [isActive ? 'active' : '', count > 0 ? 'has-alert' : ''].filter(Boolean).join(' ');
      tabs.push(
        `<button data-zone-id="${z.id}" class="${classes}">${escapeHtml(z.name)}${badge}</button>`
      );
    });
    const pendingCount = getOnboardingPendingBooths().length;
    const pendingBadge = pendingCount > 0 ? ` <span class="tab-onboarding-badge">${pendingCount}</span>` : '';
    tabs.push(
      `<button data-mode="onboarding" class="${state.onboardingFilterOn ? 'active' : ''}">온보딩미진행${pendingBadge}</button>`
    );
    el.zoneTabs.innerHTML = tabs.join('');
    el.zoneTabs.querySelectorAll('button').forEach((btn) => {
      if (btn.dataset.mode === 'onboarding') {
        btn.addEventListener('click', switchToOnboardingFilter);
      } else {
        btn.addEventListener('click', () => switchZoneTab(btn.dataset.zoneId || null));
      }
    });
  }

  function switchZoneTab(zoneId) {
    state.activeZoneId = zoneId || null;
    state.onboardingFilterOn = false;
    resetZoom();
    closePopover();
    renderZoneTabs();
    renderTodayStaffPanel();
    renderOnDutyPanel();
    renderCurrentMap();
  }

  // "온보딩미진행" 탭: 구역 선택을 해제하고 전체 배치도 위에 온보딩 미진행 부스만 남겨서 보여준다.
  function switchToOnboardingFilter() {
    state.activeZoneId = null;
    state.onboardingFilterOn = true;
    resetZoom();
    closePopover();
    renderZoneTabs();
    renderTodayStaffPanel();
    renderOnDutyPanel();
    renderCurrentMap();
  }

  // 배치도 전체(가로 x 세로 비율 aspect = 세로/가로)가 스크롤 없이 한 화면에 들어오도록
  // map-stage의 크기를 기기 화면(뷰포트) 폭/높이에 맞춰 자동으로 계산한다.
  function fitStageToScreen(aspect) {
    state.currentAspect = aspect;
    // 먼저 인라인 width를 비워 CSS(width:100%, 부모 padding 반영됨) 기준 실제 폭을 구한다.
    el.mapStage.style.width = '';
    el.mapStage.style.margin = '';
    const naturalWidth = el.mapStage.clientWidth || window.innerWidth;
    const stageTop = el.mapStage.getBoundingClientRect().top;
    const availableHeight = Math.max(240, window.innerHeight - stageTop - 16);

    let width = naturalWidth;
    let height = width * aspect;
    if (height > availableHeight) {
      height = availableHeight;
      width = height / aspect;
      el.mapStage.style.width = `${Math.round(width)}px`;
      el.mapStage.style.margin = '0 auto';
    }
    el.mapStage.style.height = `${Math.round(height)}px`;
  }

  function clearStageFit() {
    state.currentAspect = null;
    el.mapStage.style.width = '';
    el.mapStage.style.height = '';
    el.mapStage.style.margin = '';
  }

  window.addEventListener('resize', () => {
    if (state.currentAspect) fitStageToScreen(state.currentAspect);
  });

  // ---- 확대/축소(줌) ----
  function applyZoom() {
    el.mapCanvas.style.transform = `scale(${state.zoom})`;
    el.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
    // 확대가 막 시작/해제되는 순간에만(매 확대 단계마다가 아니라) 지도 영역 폭을 넓히거나
    // 되돌리고, 그 새 폭 기준으로 화면 맞춤을 다시 계산한다(PC에서 좁은 본문 폭 안에
    // 갇혀 스크롤로만 보이지 않도록).
    const shouldBeWide = state.zoom > 1;
    if (shouldBeWide !== state.wideZoom) {
      state.wideZoom = shouldBeWide;
      el.mapStage.classList.toggle('wide-zoom', shouldBeWide);
      if (state.currentAspect) fitStageToScreen(state.currentAspect);
    }
  }

  function resetZoom() {
    state.zoom = 1;
    applyZoom();
    el.mapStage.scrollLeft = 0;
    el.mapStage.scrollTop = 0;
  }

  // 화면 좌표(clientX/Y) 지점이 그대로 유지되도록 줌 배율을 바꾸고 스크롤 위치를 보정한다.
  function setZoomAt(newZoom, clientX, clientY) {
    newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
    if (newZoom === state.zoom) return;
    const rect = el.mapStage.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const oldZoom = state.zoom;
    const contentX = (el.mapStage.scrollLeft + offsetX) / oldZoom;
    const contentY = (el.mapStage.scrollTop + offsetY) / oldZoom;
    state.zoom = newZoom;
    applyZoom();
    el.mapStage.scrollLeft = contentX * newZoom - offsetX;
    el.mapStage.scrollTop = contentY * newZoom - offsetY;
  }

  function zoomAtCenter(factor) {
    const rect = el.mapStage.getBoundingClientRect();
    setZoomAt(state.zoom * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  el.zoomInBtn.addEventListener('click', () => zoomAtCenter(1.25));
  el.zoomOutBtn.addEventListener('click', () => zoomAtCenter(1 / 1.25));
  el.zoomResetBtn.addEventListener('click', resetZoom);

  el.mapStage.addEventListener(
    'wheel',
    (e) => {
      if (!state.event || !state.currentAspect || !e.ctrlKey) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      setZoomAt(state.zoom * factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  // 모바일 두 손가락 핀치 확대/축소
  function touchDist(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }
  let pinchStartDist = null;
  let pinchStartZoom = 1;

  el.mapStage.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length === 2) {
        pinchStartDist = touchDist(e.touches);
        pinchStartZoom = state.zoom;
      }
    },
    { passive: true }
  );

  el.mapStage.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length === 2 && pinchStartDist) {
        e.preventDefault();
        const dist = touchDist(e.touches);
        const factor = dist / pinchStartDist;
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        setZoomAt(pinchStartZoom * factor, cx, cy);
      }
    },
    { passive: false }
  );

  el.mapStage.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchStartDist = null;
  });

  // 배치도 이미지 로딩(및 화면 맞춤 계산)이 끝난 뒤에 콜백을 실행한다. 배치도가 없으면 포기한다.
  function afterMapReady(callback, attempts) {
    attempts = attempts == null ? 40 : attempts;
    if (!el.mapEmpty.hidden) return;
    if (el.floorplanImg.complete && el.floorplanImg.naturalWidth) {
      requestAnimationFrame(callback);
      return;
    }
    if (attempts <= 0) return;
    requestAnimationFrame(() => afterMapReady(callback, attempts - 1));
  }

  // 배치도 위 특정 위치(xPct, yPct)가 화면 중앙에 오도록 확대하고 스크롤을 이동한다.
  function scrollToPct(xPct, yPct, zoom) {
    const stageW = el.mapStage.clientWidth;
    const stageH = el.mapStage.clientHeight;
    const contentX = (xPct / 100) * stageW;
    const contentY = (yPct / 100) * stageH;
    state.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    applyZoom();
    el.mapStage.scrollLeft = contentX * state.zoom - stageW / 2;
    el.mapStage.scrollTop = contentY * state.zoom - stageH / 2;
  }

  // 부스 위치로 화면을 이동 + 확대한다. 구역에 속한 부스라도 상세구역 지도가 아니라
  // 항상 전체 배치도 화면에서 그 위치를 보여주고, 도착하면 마커를 반짝이게 한다
  // (지도 밖을 클릭하거나 부스를 클릭하기 전까지 계속 반짝인다 — clearLocatedSparkle 참고).
  function locateBooth(boothId) {
    if (!state.event) return;
    const booth = state.event.booths.find((b) => b.id === boothId);
    if (!booth || booth.xPct == null) return;
    closePopover();
    // "온보딩미진행" 필터가 켜져 있으면 찾는 부스가 화면에 없을 수 있으니 꺼서 전체를 보여준다.
    if (state.activeZoneId !== null || state.onboardingFilterOn) {
      switchZoneTab(null);
    }
    afterMapReady(() => {
      const vb = state.viewBooths.find((b) => b.id === boothId);
      if (!vb || vb.xPct == null || vb.yPct == null) return;
      scrollToPct(vb.xPct, vb.yPct, LOCATE_ZOOM);
      clearLocatedSparkle();
      const markerEl = state.markers.get(boothId);
      if (markerEl) {
        markerEl.classList.add('marker--located');
        state.locatedMarkerEl = markerEl;
      }
    });
  }

  function clearLocatedSparkle() {
    if (state.locatedMarkerEl) {
      state.locatedMarkerEl.classList.remove('marker--located');
      state.locatedMarkerEl = null;
    }
  }

  // 지도 밖을 클릭하거나(부스 검색으로 반짝이는 걸 그만 보고 싶을 때) 아무 부스나 클릭하면
  // (같은 부스를 다시 봐도, 다른 부스를 봐도) 반짝임을 끈다.
  document.addEventListener('click', (e) => {
    if (!state.locatedMarkerEl) return;
    const clickedBoothMarker = e.target.closest('.booth-marker');
    const clickedInsideMapStage = el.mapStage.contains(e.target);
    if (clickedBoothMarker || !clickedInsideMapStage) {
      clearLocatedSparkle();
    }
  });

  // 사업자번호는 xxx-xx-xxxxx(하이픈 포함)와 xxxxxxxxxx(숫자만) 둘 다 검색되게, 숫자만 비교한다.
  function digitsOnly(str) {
    return (str || '').replace(/\D/g, '');
  }

  function findBoothByLocateQuery(query) {
    const trimmed = query.trim();
    if (!trimmed || !state.event) return null;
    const byLabel = state.reportBoothByLabel.get(trimmed);
    if (byLabel) return byLabel;
    const digits = digitsOnly(trimmed);
    if (digits.length >= 4) {
      const match = state.event.booths.find((b) => b.businessNumber && digitsOnly(b.businessNumber) === digits);
      if (match) return match.id;
    }
    return null;
  }

  // 배치도 위 검색창: 매장명/부스번호/사업자번호로 검색해 목록에서 고르면 그 위치로 바로 이동한다.
  el.boothLocateSearch.addEventListener('change', () => {
    const boothId = findBoothByLocateQuery(el.boothLocateSearch.value);
    if (!boothId) return;
    locateBooth(boothId);
    el.boothLocateSearch.value = '';
    el.boothLocateSearch.blur();
  });

  // 구역 상세 배치도가 아직 없을 때, 전체 배치도에서 그 구역이 차지하는 영역만 잘라
  // 화면에 꽉 차게 확대해 보여준다. SVG 오버레이 viewBox는 그대로 0~100이라 부스 좌표
  // 계산에는 영향이 없다 — 이 미리보기 자체가 곧 그 구역의 0~100 좌표계다.
  function applyZoneCropFallback(overviewPath, rect) {
    el.mapStage.classList.add('cropped');

    function place() {
      const naturalW = el.floorplanImg.naturalWidth;
      const naturalH = el.floorplanImg.naturalHeight;
      if (!naturalW || !naturalH) return;

      // 세로 범위는 구역 rect 기준으로 살짝만 여유를 두어(세로 틀 높이 자체는 바뀌지
      // 않게) 유지하고, 가로 범위는 화면 가로세로 비율에 맞을 만큼 넓혀서 세로 틀은
      // 그대로인 채 좌우로 가려져 있던 부분을 더 보여준다.
      const padH = rect.hPct * 0.1;
      let viewHPct = Math.min(100, rect.hPct + padH);
      let viewYPct = Math.max(0, Math.min(rect.yPct - padH / 2, 100 - viewHPct));

      // 화면 폭 측정 전에, 이전 구역에서 남아있을 수 있는 좁은 인라인 폭을 지워
      // CSS 기준(부모 폭에 꽉 찬) 실제 가용 폭을 구한다.
      el.mapStage.style.width = '';
      el.mapStage.style.margin = '';
      const stageTop = el.mapStage.getBoundingClientRect().top;
      const availableHeight = Math.max(240, window.innerHeight - stageTop - 16);
      const availableWidth = el.mapStage.clientWidth || window.innerWidth;
      const screenPxAspect = availableHeight / availableWidth; // 화면의 세로/가로 비율
      const viewHeightPx = (viewHPct / 100) * naturalH;
      const desiredWidthPx = viewHeightPx / screenPxAspect;
      const minWPct = Math.min(100, rect.wPct * 1.1);
      const viewWPct = Math.max(minWPct, Math.min(100, (desiredWidthPx / naturalW) * 100));
      const viewXPct = Math.max(0, Math.min(rect.xPct - (viewWPct - rect.wPct) / 2, 100 - viewWPct));

      const view = { xPct: viewXPct, yPct: viewYPct, wPct: viewWPct, hPct: viewHPct };

      const cropAspect = (view.hPct * naturalH) / (view.wPct * naturalW);
      fitStageToScreen(cropAspect);
      const containerWidth = el.mapStage.clientWidth || 1;
      const fullWidthPx = containerWidth * (100 / view.wPct);
      const fullHeightPx = fullWidthPx * (naturalH / naturalW);
      el.floorplanImg.style.width = `${fullWidthPx}px`;
      el.floorplanImg.style.height = `${fullHeightPx}px`;
      el.floorplanImg.style.left = `${-(view.xPct / 100) * fullWidthPx}px`;
      el.floorplanImg.style.top = `${-(view.yPct / 100) * fullHeightPx}px`;

      // 실제 구역 rect(부스 좌표 0~100 기준)는 이 확장된 미리보기 안에서 아래 위치에
      // 해당한다. SVG 오버레이를 그 위치/크기로 맞춰서, 부스 좌표 계산은 그대로 두고
      // 화면에는 구역 범위보다 살짝 바깥쪽까지 더 보여준다.
      el.mapOverlay.style.left = `${((rect.xPct - view.xPct) / view.wPct) * 100}%`;
      el.mapOverlay.style.top = `${((rect.yPct - view.yPct) / view.hPct) * 100}%`;
      el.mapOverlay.style.width = `${(rect.wPct / view.wPct) * 100}%`;
      el.mapOverlay.style.height = `${(rect.hPct / view.hPct) * 100}%`;
      el.mapOverlay.style.right = 'auto';
      el.mapOverlay.style.bottom = 'auto';
    }

    const src = `/uploads/floorplans/${overviewPath}`;
    if (el.floorplanImg.getAttribute('src') === src && el.floorplanImg.complete && el.floorplanImg.naturalWidth) {
      place();
    } else {
      el.floorplanImg.onload = place;
      el.floorplanImg.src = src;
    }
  }

  function clearCropFallback() {
    if (!el.mapStage.classList.contains('cropped')) return;
    el.mapStage.classList.remove('cropped');
    el.floorplanImg.onload = null;
    el.floorplanImg.style.width = '';
    el.floorplanImg.style.height = '';
    el.floorplanImg.style.left = '';
    el.floorplanImg.style.top = '';
    el.mapOverlay.style.left = '';
    el.mapOverlay.style.top = '';
    el.mapOverlay.style.width = '';
    el.mapOverlay.style.height = '';
    el.mapOverlay.style.right = '';
    el.mapOverlay.style.bottom = '';
  }

  // 일반(자르지 않은) 배치도 이미지를 화면에 맞춘다.
  function applyNormalFit(path) {
    function place() {
      const naturalW = el.floorplanImg.naturalWidth;
      const naturalH = el.floorplanImg.naturalHeight;
      if (!naturalW || !naturalH) return;
      fitStageToScreen(naturalH / naturalW);
    }
    const src = `/uploads/floorplans/${path}`;
    if (el.floorplanImg.getAttribute('src') === src && el.floorplanImg.complete && el.floorplanImg.naturalWidth) {
      place();
    } else {
      el.floorplanImg.onload = place;
      el.floorplanImg.src = src;
    }
  }

  function renderCurrentMap() {
    const zone = getActiveZone();
    const floorplanPath = currentFloorplanPath();
    const usingCropFallback = !!(zone && !floorplanPath && state.event.floorplanImagePath && zone.rect);

    if (!floorplanPath && !usingCropFallback) {
      clearCropFallback();
      clearStageFit();
      el.mapStage.classList.remove('zoom-active');
      el.floorplanImg.hidden = true;
      el.mapOverlay.hidden = true;
      el.mapEmpty.hidden = false;
      el.mapEmpty.textContent = zone
        ? '이 구역에는 아직 상세 배치도가 등록되지 않았습니다.'
        : '이 행사에는 아직 배치도가 등록되지 않았습니다.';
      state.markers = new Map();
      state.viewBooths = [];
      applyAlertsToMap();
      return;
    }

    if (usingCropFallback) {
      applyZoneCropFallback(state.event.floorplanImagePath, zone.rect);
    } else {
      clearCropFallback();
      applyNormalFit(floorplanPath);
    }
    el.mapStage.classList.add('zoom-active');
    el.floorplanImg.hidden = false;
    el.mapOverlay.hidden = false;
    el.mapEmpty.hidden = true;
    state.viewBooths = getViewBooths();

    state.zoneMarkers = new Map();
    if (zone) {
      state.markers = window.MapRender.renderBase(
        el.mapOverlay,
        { entrance: null, booths: state.viewBooths },
        { editable: false }
      );
      for (const [boothId, markerEl] of state.markers) {
        markerEl.addEventListener('click', () => openPopover(boothId));
      }
    } else if ((state.event.zones || []).length > 0) {
      // "온보딩미진행" 탭이 켜져 있으면 온보딩 미진행 부스만 담은 사본을 넘겨서
      // 전체 배치도 위에 그 부스들만(그리고 그 부스들의 반짝이는 표시만) 남긴다.
      const overviewEvent = state.onboardingFilterOn ? { ...state.event, booths: state.viewBooths } : state.event;
      const { boothMarkers, zoneMarkers } = window.MapRender.renderOverview(el.mapOverlay, overviewEvent, { editable: false });
      state.markers = boothMarkers;
      state.zoneMarkers = zoneMarkers;
      // 구역에 속한 부스를 클릭해도 이제 그 구역 탭으로 넘어가지 않고, 전체 배치도 위에서
      // 바로 부스 정보 팝업을 보여준다(구역 탭 이동은 구역 영역 자체를 클릭하거나 위 탭에서).
      for (const [boothId, markerEl] of state.markers) {
        markerEl.addEventListener('click', () => openPopover(boothId));
      }
      for (const [zoneId, zoneEl] of zoneMarkers) {
        zoneEl.addEventListener('click', () => switchZoneTab(zoneId));
      }
    } else {
      const baseEvent = state.onboardingFilterOn ? { ...state.event, booths: state.viewBooths } : state.event;
      state.markers = window.MapRender.renderBase(el.mapOverlay, baseEvent, { editable: false });
      for (const [boothId, markerEl] of state.markers) {
        markerEl.addEventListener('click', () => openPopover(boothId));
      }
    }
    applyAlertsToMap();
  }

  // 새 A/S 등록 시 짧게 울리는 사이렌풍 알림음(외부 음원 없이 Web Audio로 합성)
  let audioCtx = null;
  function playSirenBeep() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const ctx = audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.connect(gain);
      gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.linearRampToValueAtTime(1320, now + 0.25);
      osc.frequency.linearRampToValueAtTime(880, now + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (err) {
      // 브라우저 자동재생 정책 등으로 재생이 막혀도 조용히 무시(시각 효과는 그대로 동작)
    }
  }

  function todayStr() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function parseTimeToMinutes(str) {
    if (!str) return null;
    const [h, m] = str.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
    return h * 60 + m;
  }

  function selectedDateStr() {
    return state.selectedDate || todayStr();
  }

  function formatDateLabel(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(d.getTime())) return dateStr;
    const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()}(${weekday})`;
  }

  // OT 계산기(editor.html)에서 저장한 근무 일정을 보고, "지금" 근무 시간대에 걸쳐 있는
  // 사람들을 찾는다. 자정을 넘겨 오늘까지 이어지는 어제 시작 근무도 함께 확인한다.
  // (조회 날짜가 오늘일 때만 의미가 있다 — 다른 날짜는 computeScheduledPeople을 쓴다.)
  function computeOnDutyNow() {
    const schedule = state.otSchedule;
    if (!schedule || !schedule.days) return [];

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const results = [];

    const checkDay = (dateStr, minuteOffset) => {
      const day = schedule.days[dateStr];
      if (!day) return;
      ['a', 'b'].forEach((teamKey) => {
        const team = day.teams && day.teams[teamKey];
        if (!team || team.excluded) return;
        const checkinMin = parseTimeToMinutes(team.checkin);
        if (checkinMin == null) return;
        let checkoutMin;
        if (team.calteo) {
          checkoutMin = checkinMin + 9 * 60; // 9시간(식사시간 포함)
        } else {
          checkoutMin = parseTimeToMinutes(team.checkout);
          if (checkoutMin == null) return;
          if (checkoutMin < checkinMin) checkoutMin += 24 * 60;
        }
        const nowRelative = nowMin + minuteOffset;
        if (nowRelative < checkinMin || nowRelative >= checkoutMin) return;
        (team.people || []).forEach((p) => {
          const username = typeof p === 'string' ? p : p.username;
          const displayName = typeof p === 'string' ? p : p.displayName;
          if (!username || results.some((r) => r.username === username)) return;
          results.push({ username, displayName: displayName || username, team: teamKey === 'a' ? '조 A' : '조 B' });
        });
      });
    };

    checkDay(todayStr(), 0);
    checkDay(yesterdayStr(), 24 * 60);
    return results;
  }

  // 오늘이 아닌 다른 날짜를 조회할 때 쓴다 — "지금 시각"이 그 날짜엔 의미가 없으니
  // 시간대와 상관없이 그날 근무 제외되지 않은 사람 전체를 보여준다.
  function computeScheduledPeople(dateStr) {
    const schedule = state.otSchedule;
    const day = schedule && schedule.days && schedule.days[dateStr];
    if (!day) return [];
    const results = [];
    ['a', 'b'].forEach((teamKey) => {
      const team = day.teams && day.teams[teamKey];
      if (!team || team.excluded) return;
      (team.people || []).forEach((p) => {
        const username = typeof p === 'string' ? p : p.username;
        const displayName = typeof p === 'string' ? p : p.displayName;
        if (!username || results.some((r) => r.username === username)) return;
        results.push({ username, displayName: displayName || username, team: teamKey === 'a' ? '조 A' : '조 B' });
      });
    });
    return results;
  }

  async function assignOnDutyPerson(username) {
    if (!state.eventId) return;
    const zone = getActiveZone();
    try {
      const { assignment } = await api(`/api/events/${state.eventId}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ date: selectedDateStr(), zoneId: zone ? zone.id : null, username }),
      });
      state.event.assignments.push(assignment);
      renderTodayStaffPanel();
      renderOnDutyPanel();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderOnDutyPanel() {
    if (!el.onDutyPanel) return;
    if (!state.event) {
      el.onDutyPanel.hidden = true;
      return;
    }

    const dateStr = selectedDateStr();
    const isToday = dateStr === todayStr();
    // "지금 근무 중"은 현재 시각과 비교하는 개념이라 오늘 조회할 때만 의미가 있다.
    // 다른 날짜를 보고 있으면 시간대 상관없이 그날 배정된 사람 전체를 보여준다.
    const people = isToday ? computeOnDutyNow() : computeScheduledPeople(dateStr);
    if (!people.length) {
      el.onDutyPanel.hidden = true;
      return;
    }
    el.onDutyPanel.hidden = false;

    const isAdmin = state.me && state.me.role === 'admin';
    const zone = getActiveZone();
    const assignLabel = zone ? `${zone.name}에 배치` : '공통으로 배치';
    const title = isToday ? '지금 근무 중' : `${formatDateLabel(dateStr)} 근무 예정 인원`;

    const rows = people
      .map((p) => {
        const btn = isAdmin
          ? `<button type="button" class="secondary on-duty-assign-btn" data-username="${escapeHtml(p.username)}">${escapeHtml(assignLabel)}</button>`
          : '';
        return `<div class="staff-row"><span>${escapeHtml(p.displayName)} (${p.team})</span>${btn}</div>`;
      })
      .join('');
    el.onDutyPanel.innerHTML = `<div class="on-duty-title">${escapeHtml(title)}</div>${rows}`;

    if (isAdmin) {
      el.onDutyPanel.querySelectorAll('.on-duty-assign-btn').forEach((btn) => {
        btn.addEventListener('click', () => assignOnDutyPerson(btn.dataset.username));
      });
    }
  }

  async function loadOtSchedule() {
    try {
      state.otSchedule = await api('/api/ot-schedule');
    } catch (err) {
      state.otSchedule = null;
    }
    renderOnDutyPanel();
  }

  function staffLine(label, list) {
    if (!list || !list.length) {
      return `<div class="staff-row"><span class="staff-zone">${escapeHtml(label)}</span><span class="staff-empty">담당자 미배정</span></div>`;
    }
    const names = list.map((a) => {
      const contact = a.phone ? ` · ${escapeHtml(a.phone)}` : '';
      const note = a.note ? ` (${escapeHtml(a.note)})` : '';
      return `${escapeHtml(a.displayName)}${contact}${note}`;
    });
    return `<div class="staff-row"><span class="staff-zone">${escapeHtml(label)}</span><span>${names.join(', ')}</span></div>`;
  }

  function renderTodayStaffPanel() {
    if (!state.event) {
      el.todayStaffPanel.hidden = true;
      return;
    }
    el.todayStaffPanel.hidden = false;
    const dateStr = selectedDateStr();
    const dayLabel = dateStr === todayStr() ? `오늘(${formatDateLabel(dateStr)})` : formatDateLabel(dateStr);
    const todays = (state.event.assignments || []).filter((a) => a.date === dateStr);
    const zone = getActiveZone();

    if (zone) {
      let list = todays.filter((x) => x.zoneId === zone.id);
      if (!list.length) list = todays.filter((x) => !x.zoneId);
      el.todayStaffPanel.innerHTML = staffLine(`${dayLabel} ${zone.name} 담당자`, list);
      return;
    }

    const generalList = todays.filter((x) => !x.zoneId);
    const lines = [staffLine(`${dayLabel} 담당자`, generalList)];
    for (const z of state.event.zones || []) {
      const list = todays.filter((x) => x.zoneId === z.id);
      if (list.length) lines.push(staffLine(z.name, list));
    }
    el.todayStaffPanel.innerHTML = lines.join('');
  }

  // 새 A/S를 목록/지도에 반영한다(이미 있으면 무시). 소켓이 늦거나 끊겨도 등록한
  // 본인 화면은 즉시 갱신되고, 실제로 새로 추가된 경우에만 true를 돌려준다(중복 경보음 방지용).
  function addOpenAlert(alert) {
    if (state.openAlerts.some((a) => a.id === alert.id)) return false;
    state.openAlerts.unshift(alert);
    applyAlertsToMap();
    renderOpenAlertsTable();
    return true;
  }

  // 처리완료된 A/S를 목록/지도에서 즉시 뺀다(소켓 도착 여부와 무관하게 항상 먼저 반영).
  function removeOpenAlert(alertId) {
    const idx = state.openAlerts.findIndex((a) => a.id === alertId);
    if (idx === -1) return false;
    state.openAlerts.splice(idx, 1);
    applyAlertsToMap();
    renderOpenAlertsTable();
    return true;
  }

  async function refreshAlerts() {
    if (!state.eventId) return;
    state.openAlerts = await api(`/api/events/${state.eventId}/alerts?status=open`);
    applyAlertsToMap();
    renderOpenAlertsTable();
    await loadResolvedAlerts();
  }

  async function loadResolvedAlerts() {
    if (!state.eventId) return;
    const resolved = await api(`/api/events/${state.eventId}/alerts?status=resolved`);
    el.resolvedAlertsBody.innerHTML = resolved
      .slice(0, 30)
      .map(
        (a) => `<tr>
          <td>${escapeHtml(a.boothNumber)}</td>
          <td>${escapeHtml(a.issueLabel)}</td>
          <td>${escapeHtml(a.resolutionLabel || '')}${a.resolvedNote ? ` - ${escapeHtml(a.resolvedNote)}` : ''}</td>
          <td>${escapeHtml(a.createdByName)}</td>
          <td>${escapeHtml(a.resolvedByName || '')}</td>
          <td>${formatTime(a.resolvedAt)}</td>
        </tr>`
      )
      .join('');
  }

  function applyAlertsToMap() {
    if (!state.event) return;
    const alertsByBooth = new Map();
    for (const a of state.openAlerts) {
      if (!alertsByBooth.has(a.boothId)) alertsByBooth.set(a.boothId, []);
      alertsByBooth.get(a.boothId).push(a);
    }
    const boothById = new Map(state.event.booths.map((b) => [b.id, b]));
    for (const [boothId, markerEl] of state.markers) {
      const hasAlert = alertsByBooth.has(boothId);
      window.MapRender.setBoothAlertState(markerEl, hasAlert);
      const booth = boothById.get(boothId);
      window.MapRender.setBoothInstallState(markerEl, booth ? booth.installStatus : null);
      window.MapRender.removeRouteLine(el.mapOverlay, boothId);
    }
    // 전체 배치도 위 구역 영역(hotspot)도, 그 구역 안에 A/S가 있으면 빨갛게 깜빡이게 표시한다.
    for (const [zoneId, zoneEl] of state.zoneMarkers) {
      zoneEl.classList.toggle('has-alert', zoneOpenAlertCount(zoneId) > 0);
    }
    renderZoneTabs();
    renderActiveAsBanner();
  }

  function renderOpenAlertsTable() {
    el.openCount.textContent = state.openAlerts.length ? `(${state.openAlerts.length}건)` : '';
    renderActiveAsBanner();
    if (state.openAlerts.length === 0) {
      el.openAlertsBody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;">진행중인 A/S가 없습니다.</td></tr>';
      return;
    }
    el.openAlertsBody.innerHTML = state.openAlerts
      .map((a) => {
        const booth = state.event.booths.find((b) => b.id === a.boothId);
        const locatable = booth && booth.xPct != null;
        const locateBtn = locatable
          ? `<button class="secondary locate-btn" data-booth-id="${a.boothId}">위치찾기</button>`
          : '';
        return `<tr>
          <td>${escapeHtml(a.boothNumber)}</td>
          <td>${escapeHtml(a.issueLabel)}</td>
          <td>${escapeHtml(a.note || '')}</td>
          <td>${escapeHtml(a.createdByName)}</td>
          <td>${formatTime(a.createdAt)}</td>
          <td>${locateBtn}<button class="secondary resolve-btn" data-alert-id="${a.id}">처리완료</button></td>
        </tr>`;
      })
      .join('');
    el.openAlertsBody.querySelectorAll('.resolve-btn').forEach((btn) => {
      btn.addEventListener('click', () => openResolveModal(btn.dataset.alertId));
    });
    el.openAlertsBody.querySelectorAll('.locate-btn').forEach((btn) => {
      btn.addEventListener('click', () => locateBooth(btn.dataset.boothId));
    });
  }

  // 지도 상단 배너: 평소엔 진행중인 A/S를, "온보딩미진행" 탭이 켜져 있으면 온보딩 미진행
  // 부스(번호+매장명) 목록을 같은 자리에 보여준다(클릭하면 해당 부스 위치로 이동).
  function renderActiveAsBanner() {
    if (state.onboardingFilterOn) {
      el.activeAsBanner.classList.add('is-onboarding');
      const pending = getOnboardingPendingBooths();
      el.activeAsBannerTitle.textContent = `온보딩 미진행 부스 (${pending.length}건)`;
      if (pending.length === 0) {
        el.activeAsBanner.hidden = true;
        el.activeAsList.innerHTML = '';
        return;
      }
      el.activeAsBanner.hidden = false;
      el.activeAsList.innerHTML = pending
        .map(
          (b) =>
            `<button type="button" class="active-as-chip" data-booth-id="${b.id}">${escapeHtml(b.number)}${b.storeName ? ' · ' + escapeHtml(b.storeName) : ''}</button>`
        )
        .join('');
      el.activeAsList.querySelectorAll('.active-as-chip').forEach((btn) => {
        btn.addEventListener('click', () => locateBooth(btn.dataset.boothId));
      });
      return;
    }

    el.activeAsBanner.classList.remove('is-onboarding');
    el.activeAsBannerTitle.textContent = '진행중인 A/S';
    if (state.openAlerts.length === 0) {
      el.activeAsBanner.hidden = true;
      el.activeAsList.innerHTML = '';
      return;
    }
    el.activeAsBanner.hidden = false;
    el.activeAsList.innerHTML = state.openAlerts
      .map(
        (a) =>
          `<button type="button" class="active-as-chip" data-booth-id="${a.boothId}">${escapeHtml(a.boothNumber)} · ${escapeHtml(a.issueLabel)}</button>`
      )
      .join('');
    el.activeAsList.querySelectorAll('.active-as-chip').forEach((btn) => {
      btn.addEventListener('click', () => locateBooth(btn.dataset.boothId));
    });
  }

  // 처리완료 시 처리내용(유형 선택 + 메모)을 입력받는 팝업
  function openResolveModal(alertId) {
    state.resolvingAlertId = alertId;
    el.resolveModalError.textContent = '';
    el.resolveModalType.value = state.resolutionTypes[0] ? state.resolutionTypes[0].id : '';
    el.resolveModalNote.value = '';
    el.resolveModal.hidden = false;
  }

  function closeResolveModal() {
    el.resolveModal.hidden = true;
    state.resolvingAlertId = null;
  }
  el.resolveModalCancel.addEventListener('click', closeResolveModal);

  el.resolveModalSave.addEventListener('click', async () => {
    if (!state.resolvingAlertId) return;
    const resolutionType = el.resolveModalType.value;
    const note = el.resolveModalNote.value.trim();
    try {
      await resolveAlert(state.resolvingAlertId, resolutionType, note);
      removeOpenAlert(state.resolvingAlertId);
      loadResolvedAlerts();
      closeResolveModal();
      closePopover();
    } catch (err) {
      el.resolveModalError.textContent = err.message;
    }
  });

  async function resolveAlert(alertId, resolutionType, note) {
    await api(`/api/events/${state.eventId}/alerts/${alertId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolutionType, note }),
    });
  }

  // ---- 부스 설치/온보딩 진행 ----
  function openInstallStartModal() {
    if (!state.event) return;
    el.installStartModalError.textContent = '';
    el.installSelectAll.checked = false;
    const booths = state.event.booths
      .slice()
      .sort((a, b) => a.number.localeCompare(b.number, 'ko', { numeric: true }));
    const statusLabel = (s) => (s === 'onboarding_needed' ? '온보딩 필요' : s === 'installed' ? '설치완료' : '');
    el.installBoothChecklist.innerHTML = booths
      .map(
        (b) =>
          `<label><input type="checkbox" class="install-booth-check" value="${b.id}" />${escapeHtml(b.number)}${
            statusLabel(b.installStatus) ? `<span class="install-status-tag">${statusLabel(b.installStatus)}</span>` : ''
          }</label>`
      )
      .join('');
    el.installStartModal.hidden = false;
  }

  function closeInstallStartModal() {
    el.installStartModal.hidden = true;
  }
  el.installStartBtn.addEventListener('click', openInstallStartModal);
  el.installStartModalCancel.addEventListener('click', closeInstallStartModal);

  el.installSelectAll.addEventListener('change', () => {
    el.installBoothChecklist.querySelectorAll('.install-booth-check').forEach((cb) => {
      cb.checked = el.installSelectAll.checked;
    });
  });

  el.installStartModalSave.addEventListener('click', async () => {
    const boothIds = Array.from(el.installBoothChecklist.querySelectorAll('.install-booth-check:checked')).map(
      (cb) => cb.value
    );
    if (boothIds.length === 0) {
      el.installStartModalError.textContent = '설치를 시작할 부스를 선택해주세요.';
      return;
    }
    try {
      const { booths } = await api(`/api/events/${state.eventId}/booths/install-start`, {
        method: 'POST',
        body: JSON.stringify({ boothIds }),
      });
      for (const b of booths) {
        const local = state.event.booths.find((x) => x.id === b.id);
        if (local) local.installStatus = b.installStatus;
      }
      closeInstallStartModal();
      applyAlertsToMap();
    } catch (err) {
      el.installStartModalError.textContent = err.message;
    }
  });

  // 부스 담당자가 팝업에서 "온보딩완료"를 선택하면 그 부스를 설치완료로 표시한다.
  async function markBoothInstalled(boothId) {
    try {
      const { booth } = await api(`/api/events/${state.eventId}/booths/${boothId}/install-status`, {
        method: 'PATCH',
        body: JSON.stringify({ installStatus: 'installed' }),
      });
      const local = state.event.booths.find((b) => b.id === booth.id);
      if (local) local.installStatus = booth.installStatus;
      applyAlertsToMap();
      openPopover(boothId);
    } catch (err) {
      alert(err.message);
    }
  }

  el.reportSubmit.addEventListener('click', async () => {
    el.reportStatus.textContent = '';
    const boothId = state.reportBoothByLabel.get(el.reportBoothSearch.value.trim());
    const issueType = el.reportIssueSelect.value;
    const note = el.reportNote.value;
    if (!boothId) {
      el.reportStatus.textContent = '목록에서 부스를 선택해주세요(번호/상호/사업자번호로 검색 가능).';
      return;
    }
    if (!issueType) {
      el.reportStatus.textContent = '이슈 유형을 선택해주세요.';
      return;
    }
    try {
      const { alert } = await api(`/api/events/${state.eventId}/alerts`, {
        method: 'POST',
        body: JSON.stringify({ boothId, issueType, note }),
      });
      addOpenAlert(alert);
      playSirenBeep();
      el.reportBoothSearch.value = '';
      el.reportNote.value = '';
      el.reportStatus.textContent = 'AS발생이 등록되었습니다.';
    } catch (err) {
      el.reportStatus.textContent = err.message;
    }
  });

  function openPopover(boothId) {
    const booth = state.event.booths.find((b) => b.id === boothId);
    if (!booth) return;
    const markerEl = state.markers.get(boothId);
    const rect = markerEl.getBoundingClientRect();

    el.popoverTitle.textContent = `부스 ${booth.number}`;

    const infoRows = [
      ['매장명', booth.storeName],
      ['사업자번호', booth.businessNumber],
      ['고유번호', booth.corpNumber],
      ['연락처', booth.onboardingContact],
      ['VAN', booth.van],
    ].filter(([, v]) => v);
    el.popoverStoreInfo.innerHTML = infoRows.length
      ? infoRows
          .map(([label, v]) => `<div class="store-info-row"><span class="store-info-label">${escapeHtml(label)}</span><span>${escapeHtml(v)}</span></div>`)
          .join('')
      : '';
    // 매장정보는 기본적으로 접어두고, 버튼을 눌러야 펼쳐 보이도록 한다.
    el.popoverStoreInfo.hidden = true;
    el.popoverStoreInfoToggle.hidden = infoRows.length === 0;
    el.popoverStoreInfoToggle.textContent = '매장정보 보기';

    if (booth.installStatus === 'onboarding_needed') {
      el.popoverInstallStatus.innerHTML = `<span class="install-status-badge onboarding_needed">온보딩 필요</span><button type="button" class="secondary" id="popover-mark-installed-btn">온보딩완료</button>`;
      document.getElementById('popover-mark-installed-btn').addEventListener('click', () => markBoothInstalled(boothId));
    } else if (booth.installStatus === 'installed') {
      el.popoverInstallStatus.innerHTML = `<span class="install-status-badge installed">설치완료</span>`;
    } else {
      el.popoverInstallStatus.innerHTML = '';
    }

    const alertsForBooth = state.openAlerts.filter((a) => a.boothId === boothId);
    if (alertsForBooth.length === 0) {
      el.popoverOpenList.innerHTML = '<p style="color:#6b7280;font-size:0.85rem;">진행중인 A/S가 없습니다.</p>';
    } else {
      el.popoverOpenList.innerHTML = alertsForBooth
        .map(
          (a) => `<div class="open-alert-item">
            <span>${escapeHtml(a.issueLabel)}${a.note ? ` - ${escapeHtml(a.note)}` : ''}</span>
            <button class="secondary resolve-btn" data-alert-id="${a.id}">처리완료</button>
          </div>`
        )
        .join('');
      el.popoverOpenList.querySelectorAll('.resolve-btn').forEach((btn) => {
        btn.addEventListener('click', () => openResolveModal(btn.dataset.alertId));
      });
    }

    el.popover.style.left = `${rect.left + rect.width / 2}px`;
    el.popover.style.top = `${rect.top}px`;
    el.popover.hidden = false;
  }

  function closePopover() {
    el.popover.hidden = true;
  }
  el.popoverClose.addEventListener('click', closePopover);

  // 팝업이 떠 있을 때 팝업 바깥을 클릭하면 닫는다. 부스 마커 클릭은 그 마커 자신의
  // 클릭 핸들러가 새 팝업을 열므로(전파를 막지 않음) 여기서는 건드리지 않고 지나간다.
  document.addEventListener('click', (e) => {
    if (el.popover.hidden) return;
    if (el.popover.contains(e.target)) return;
    if (e.target.closest('.booth-marker')) return;
    closePopover();
  });

  el.popoverStoreInfoToggle.addEventListener('click', () => {
    const willShow = el.popoverStoreInfo.hidden;
    el.popoverStoreInfo.hidden = !willShow;
    el.popoverStoreInfoToggle.textContent = willShow ? '매장정보 닫기' : '매장정보 보기';
  });

  el.eventSelect.addEventListener('change', () => selectEvent(el.eventSelect.value));

  document.getElementById('logout-btn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login.html';
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function formatTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ko-KR');
  }

  if (el.staffDatePicker) {
    el.staffDatePicker.value = todayStr();
    state.selectedDate = todayStr();
    el.staffDatePicker.addEventListener('change', () => {
      state.selectedDate = el.staffDatePicker.value || todayStr();
      renderTodayStaffPanel();
      renderOnDutyPanel();
    });
  }

  (async function init() {
    await loadMe();
    await loadIssueTypes();
    await loadResolutionTypes();
    await loadEvents();
    await loadOtSchedule();
    // "지금 근무 중"은 시각에 따라 바뀌므로 분 단위로 다시 계산해 보여준다(일정 자체는 다시 불러오지 않음).
    // 다른 날짜를 보고 있을 땐 그대로 둬도 매분 다시 그릴 필요는 없지만, renderOnDutyPanel이
    // 알아서 오늘인지 아닌지 구분하므로 그냥 항상 돌려도 무해하다.
    setInterval(renderOnDutyPanel, 60 * 1000);
  })();
})();
