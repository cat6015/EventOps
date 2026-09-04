(() => {
  const MIN_ZOOM = 0.3;
  const MAX_ZOOM = 5;
  const DEFAULT_BOOTH_SIZE = 6;

  const state = {
    events: [],
    event: null,
    users: [],
    markers: new Map(),
    viewBooths: [],
    mode: 'select', // 'select' | 'add' | 'grid' | 'zone' | 'entrance'
    activeZoneId: null, // null = 전체 배치도 탭
    editingZoneId: null, // 구역 영역을 재설정하는 중이면 그 구역 id
    pendingAddPct: null,
    addSettings: null, // 부스추가 모드에서 직전에 저장한 번호/크기(모드를 끄기 전까지 유지)
    pendingGridRect: null,
    gridCountTouched: false, // 사용자가 생성 개수를 직접 입력했는지(직접 입력 시엔 행x열 변경으로 자동 덮어쓰지 않음)
    pendingZoneRect: null,
    modalBoothId: null,
    selected: new Set(),
    zoom: 1,
    otSchedule: null, // OT 계산기(같은 페이지 근무시간 탭)에서 저장한 근무 일정 — 날짜별 담당자 배정에서 그날 근무자 목록을 채우는 데 쓴다
  };

  const el = {
    meName: document.getElementById('me-name'),
    eventSelect: document.getElementById('event-select'),
    eventStatusSelect: document.getElementById('event-status-select'),
    newEventName: document.getElementById('new-event-name'),
    newEventDate: document.getElementById('new-event-date'),
    createEventBtn: document.getElementById('create-event-btn'),
    eventStatusMsg: document.getElementById('event-status-msg'),
    setDefaultEventBtn: document.getElementById('set-default-event-btn'),
    deleteEventBtn: document.getElementById('delete-event-btn'),
    floorplanBox: document.getElementById('floorplan-box'),
    floorplanFile: document.getElementById('floorplan-file'),
    floorplanUploadBtn: document.getElementById('floorplan-upload-btn'),
    floorplanStatus: document.getElementById('floorplan-status'),
    mapBox: document.getElementById('map-box'),
    zoneTabs: document.getElementById('zone-tabs'),
    zoneManageBar: document.getElementById('zone-manage-bar'),
    zoneResizeBtn: document.getElementById('zone-resize-btn'),
    zoneFixBoothSizeBtn: document.getElementById('zone-fix-booth-size-btn'),
    zoneDeleteBtn: document.getElementById('zone-delete-btn'),
    zoneFloorplanBox: document.getElementById('zone-floorplan-box'),
    zoneFloorplanFile: document.getElementById('zone-floorplan-file'),
    zoneFloorplanUploadBtn: document.getElementById('zone-floorplan-upload-btn'),
    zoneFloorplanStatus: document.getElementById('zone-floorplan-status'),
    mapEditorArea: document.getElementById('map-editor-area'),
    mapStage: document.getElementById('map-stage'),
    mapCanvas: document.getElementById('map-canvas'),
    mapEmpty: document.getElementById('map-empty'),
    floorplanImg: document.getElementById('floorplan-img'),
    mapOverlay: document.getElementById('map-overlay'),
    modeSelectBtn: document.getElementById('mode-select-btn'),
    modeAddBtn: document.getElementById('mode-add-btn'),
    modeGridBtn: document.getElementById('mode-grid-btn'),
    modeZoneBtn: document.getElementById('mode-zone-btn'),
    modeEntranceBtn: document.getElementById('mode-entrance-btn'),
    modeHint: document.getElementById('mode-hint'),
    zoomInBtn: document.getElementById('zoom-in-btn'),
    zoomOutBtn: document.getElementById('zoom-out-btn'),
    zoomResetBtn: document.getElementById('zoom-reset-btn'),
    zoomLevel: document.getElementById('zoom-level'),
    zoneCropHint: document.getElementById('zone-crop-hint'),
    batchPanel: document.getElementById('batch-panel'),
    batchCount: document.getElementById('batch-count'),
    batchWidth: document.getElementById('batch-width'),
    batchHeight: document.getElementById('batch-height'),
    batchApplyBtn: document.getElementById('batch-apply-btn'),
    batchClearBtn: document.getElementById('batch-clear-btn'),
    batchDeleteBtn: document.getElementById('batch-delete-btn'),
    alignLeftBtn: document.getElementById('align-left-btn'),
    alignRightBtn: document.getElementById('align-right-btn'),
    alignTopBtn: document.getElementById('align-top-btn'),
    alignBottomBtn: document.getElementById('align-bottom-btn'),
    distributeHBtn: document.getElementById('distribute-h-btn'),
    distributeVBtn: document.getElementById('distribute-v-btn'),
    importBox: document.getElementById('import-box'),
    importTemplateBtn: document.getElementById('import-template-btn'),
    importFile: document.getElementById('import-file'),
    importUploadBtn: document.getElementById('import-upload-btn'),
    importStatus: document.getElementById('import-status'),
    boothListBox: document.getElementById('booth-list-box'),
    boothCountSummary: document.getElementById('booth-count-summary'),
    boothListBody: document.getElementById('booth-list-body'),
    boothModal: document.getElementById('booth-modal'),
    boothModalTitle: document.getElementById('booth-modal-title'),
    boothModalNumber: document.getElementById('booth-modal-number'),
    boothModalWidth: document.getElementById('booth-modal-width'),
    boothModalHeight: document.getElementById('booth-modal-height'),
    boothModalStoreName: document.getElementById('booth-modal-store-name'),
    boothModalBusinessNumber: document.getElementById('booth-modal-business-number'),
    boothModalCorpNumber: document.getElementById('booth-modal-corp-number'),
    boothModalOnboardingContact: document.getElementById('booth-modal-onboarding-contact'),
    boothModalVan: document.getElementById('booth-modal-van'),
    boothModalError: document.getElementById('booth-modal-error'),
    boothModalDelete: document.getElementById('booth-modal-delete'),
    boothModalCancel: document.getElementById('booth-modal-cancel'),
    boothModalSave: document.getElementById('booth-modal-save'),
    gridModal: document.getElementById('grid-modal'),
    gridRows: document.getElementById('grid-rows'),
    gridCols: document.getElementById('grid-cols'),
    gridCount: document.getElementById('grid-count'),
    gridPrefix: document.getElementById('grid-prefix'),
    gridStart: document.getElementById('grid-start'),
    gridPad: document.getElementById('grid-pad'),
    gridGap: document.getElementById('grid-gap'),
    gridCountHint: document.getElementById('grid-count-hint'),
    gridModalError: document.getElementById('grid-modal-error'),
    gridModalCancel: document.getElementById('grid-modal-cancel'),
    gridModalSave: document.getElementById('grid-modal-save'),
    zoneModal: document.getElementById('zone-modal'),
    zoneModalName: document.getElementById('zone-modal-name'),
    zoneModalError: document.getElementById('zone-modal-error'),
    zoneModalCancel: document.getElementById('zone-modal-cancel'),
    zoneModalSave: document.getElementById('zone-modal-save'),
    assignmentBox: document.getElementById('assignment-box'),
    assignDate: document.getElementById('assign-date'),
    assignZoneSelect: document.getElementById('assign-zone-select'),
    assignUserSelect: document.getElementById('assign-user-select'),
    assignUserHint: document.getElementById('assign-user-hint'),
    assignPhone: document.getElementById('assign-phone'),
    assignNote: document.getElementById('assign-note'),
    assignCreateBtn: document.getElementById('assign-create-btn'),
    assignStatus: document.getElementById('assign-status'),
    assignmentListBody: document.getElementById('assignment-list-body'),
    onboardingLogBox: document.getElementById('onboarding-log-box'),
    onboardingLogSearch: document.getElementById('onboarding-log-search'),
    onboardingLogRefreshBtn: document.getElementById('onboarding-log-refresh-btn'),
    onboardingLogBody: document.getElementById('onboarding-log-body'),
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
    el.meName.textContent = `${data.user.displayName} (관리자)`;
  }

  async function loadUsers() {
    try {
      state.users = await api('/api/admin/users');
      renderAssignUserOptions();
    } catch (err) {
      // 계정 목록을 못 불러와도 나머지 기능은 계속 쓸 수 있게 무시
    }
  }

  // 근무시간 탭(OT 계산기)이 저장한 일정을 읽어와, 날짜별 담당자 배정에서
  // 그날 근무자로 등록된 인원만 골라 보여줄 수 있게 한다.
  async function loadOtSchedule() {
    try {
      state.otSchedule = await api('/api/ot-schedule');
    } catch (err) {
      state.otSchedule = null;
    }
    renderAssignUserOptions();
  }

  function getScheduledPeopleForDate(dateStr) {
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
        results.push({ username, displayName: displayName || username, team: teamKey === 'a' ? '조A' : '조B' });
      });
    });
    return results;
  }

  // 선택한 날짜에 근무시간 탭에 등록된 근무자가 있으면 그 사람들만, 없으면(또는 날짜 미선택)
  // 전체 계정 목록을 담당자 선택란에 채운다.
  function renderAssignUserOptions() {
    const dateStr = el.assignDate.value;
    const scheduled = dateStr ? getScheduledPeopleForDate(dateStr) : [];

    if (scheduled.length > 0) {
      el.assignUserSelect.innerHTML = scheduled
        .map((p) => `<option value="${escapeHtml(p.username)}">${escapeHtml(p.displayName)} (${p.team})</option>`)
        .join('');
      el.assignUserHint.textContent = `${dateStr}에 근무시간 탭에 등록된 근무자 ${scheduled.length}명입니다.`;
      return;
    }

    el.assignUserSelect.innerHTML = state.users
      .map((u) => `<option value="${escapeHtml(u.username)}">${escapeHtml(u.displayName)} (${escapeHtml(u.username)})</option>`)
      .join('');
    el.assignUserHint.textContent = dateStr
      ? `${dateStr}에 근무시간 탭에 등록된 근무자가 없어 전체 계정 목록을 보여줍니다.`
      : '';
  }

  el.assignDate.addEventListener('change', renderAssignUserOptions);

  function renderEventOptions() {
    el.eventSelect.innerHTML = state.events
      .map(
        (e) =>
          `<option value="${e.id}">${e.isDefault ? '★ ' : ''}${e.name}${e.status === 'archived' ? ' (종료)' : ''}</option>`
      )
      .join('');
    if (state.event) el.eventSelect.value = state.event.id;
  }

  async function loadEvents() {
    state.events = await api('/api/events');
    if (state.events.length === 0) {
      el.eventSelect.innerHTML = '<option value="">행사를 먼저 만들어주세요</option>';
      return;
    }
    renderEventOptions();
    await selectEvent(el.eventSelect.value);
  }

  async function selectEvent(eventId) {
    if (!eventId) return;
    const event = await api(`/api/events/${eventId}`);
    state.event = event;
    state.selected.clear();
    state.zoom = 1;
    state.activeZoneId = null;
    el.eventStatusSelect.value = event.status;
    updateSetDefaultBtn();
    el.floorplanBox.hidden = false;
    el.mapBox.hidden = false;
    el.importBox.hidden = false;
    el.boothListBox.hidden = false;
    el.assignmentBox.hidden = false;
    el.onboardingLogBox.hidden = false;
    applyZoom();
    setMode('select');
    renderMap();
    renderBoothList();
    renderAssignZoneOptions();
    renderAssignmentList();
    renderOnboardingLog();
  }

  function getActiveZone() {
    if (!state.event || !state.activeZoneId) return null;
    return state.event.zones.find((z) => z.id === state.activeZoneId) || null;
  }

  function currentFloorplanPath() {
    const zone = getActiveZone();
    return zone ? zone.floorplanImagePath : state.event ? state.event.floorplanImagePath : null;
  }

  // 구역에 상세 배치도가 아직 없어 전체 배치도를 잘라 확대해 보여주는 중인지 여부.
  // 이 상태에서도 실제로는 배치도가 화면에 그려져 있으므로, 줌/이동/선택/부스추가 등
  // 모든 조작 가능 여부 판단은 currentFloorplanPath() 대신 이 값을 함께 확인해야 한다.
  function isCropFallbackActive() {
    const zone = getActiveZone();
    return !!(zone && !zone.floorplanImagePath && state.event && state.event.floorplanImagePath && zone.rect);
  }

  function hasRenderableFloorplan() {
    return !!currentFloorplanPath() || isCropFallbackActive();
  }

  // 구역 탭에서는 부스의 zoneXPct/zoneYPct를, 전체 배치도 탭에서는 xPct/yPct(자동 계산분 포함)를
  // 그 탭의 좌표로 사용하는 뷰모델을 만든다. 드래그/다중선택 등 화면상의 좌표 계산은 항상 이 값을 쓴다.
  function getViewBooths() {
    if (!state.event) return [];
    const zone = getActiveZone();
    if (zone) {
      return state.event.booths
        .filter((b) => b.zoneId === zone.id)
        .map((b) => ({ ...b, xPct: b.zoneXPct, yPct: b.zoneYPct }));
    }
    return state.event.booths;
  }

  // ---- 구역 탭 ----
  function renderZoneTabs() {
    if (!state.event) return;
    const zones = state.event.zones || [];
    const tabs = [`<button data-zone-id="" class="${state.activeZoneId ? '' : 'active'}">전체 배치도</button>`];
    zones.forEach((z) => {
      tabs.push(
        `<button data-zone-id="${z.id}" class="${state.activeZoneId === z.id ? 'active' : ''}">${escapeHtml(z.name)}</button>`
      );
    });
    el.zoneTabs.innerHTML = tabs.join('');
    el.zoneTabs.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => switchZoneTab(btn.dataset.zoneId || null));
    });
    el.zoneManageBar.hidden = !state.activeZoneId;
  }

  el.zoneResizeBtn.addEventListener('click', () => {
    const zone = getActiveZone();
    if (!zone) return;
    const zoneId = zone.id;
    switchZoneTab(null);
    state.editingZoneId = zoneId;
    setMode('zone');
  });

  // 전체 배치도에서 이 구역으로 드래그해 옮겨진 부스가 옛(버그가 있던) 로직 탓에 크기
  // 환산이 안 된 채로 남아 너무 작거나 커 보일 때, 구역 rect 비율로 다시 계산해 바로잡는다.
  el.zoneFixBoothSizeBtn.addEventListener('click', async () => {
    const zone = getActiveZone();
    if (!zone || !zone.rect) return;
    // 이미 정상화된(sizeNormalized) 부스는 다시 계산하지 않는다 — 자동 이동으로 이미
    // 맞춰졌거나, 이 버튼으로 이미 한 번 고쳐진 부스를 다시 곱해 크기가 또 틀어지는 걸 막는다.
    const boothsInZone = state.event.booths.filter((b) => b.zoneId === zone.id && !b.sizeNormalized);
    if (boothsInZone.length === 0) {
      alert('이 구역에는 다시 계산이 필요한 부스가 없습니다(이미 정상화되어 있습니다).');
      return;
    }
    if (
      !confirm(
        `'${zone.name}' 구역의 부스 ${boothsInZone.length}개 크기를 구역 영역 비율(가로 ${zone.rect.wPct.toFixed(1)}%, 세로 ${zone.rect.hPct.toFixed(1)}%) 기준으로 다시 계산합니다.\n전체 배치도에서 이 구역으로 옮겨진 뒤 한 번도 크기가 보정된 적 없는 부스에만 적용됩니다.\n계속할까요?`
      )
    ) {
      return;
    }
    const items = boothsInZone.map((b) => ({
      id: b.id,
      wPct: Math.min(100, Math.max(0.5, (b.wPct || DEFAULT_BOOTH_SIZE) * (100 / zone.rect.wPct))),
      hPct: Math.min(100, Math.max(0.5, (b.hPct || DEFAULT_BOOTH_SIZE) * (100 / zone.rect.hPct))),
    }));
    try {
      const { booths } = await api(`/api/events/${state.event.id}/booths/bulk`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      });
      for (const b of booths) {
        const local = state.event.booths.find((x) => x.id === b.id);
        if (local) {
          local.wPct = b.wPct;
          local.hPct = b.hPct;
        }
      }
      renderMap();
      renderBoothList();
    } catch (err) {
      alert(err.message);
    }
  });

  el.zoneDeleteBtn.addEventListener('click', async () => {
    const zone = getActiveZone();
    if (!zone) return;
    if (!confirm(`'${zone.name}' 구역을 삭제할까요? 구역에 부스가 남아있으면 삭제할 수 없습니다.`)) return;
    try {
      await api(`/api/events/${state.event.id}/zones/${zone.id}`, { method: 'DELETE' });
      state.event.zones = state.event.zones.filter((z) => z.id !== zone.id);
      state.event.assignments = state.event.assignments.filter((a) => a.zoneId !== zone.id);
      switchZoneTab(null);
      renderAssignZoneOptions();
      renderAssignmentList();
    } catch (err) {
      alert(err.message);
    }
  });

  async function updateZoneRect(zoneId, rect) {
    try {
      const { zone, booths } = await api(`/api/events/${state.event.id}/zones/${zoneId}`, {
        method: 'PATCH',
        body: JSON.stringify({ rect }),
      });
      const idx = state.event.zones.findIndex((z) => z.id === zoneId);
      if (idx !== -1) state.event.zones[idx] = zone;
      for (const b of booths) {
        const local = state.event.booths.find((x) => x.id === b.id);
        if (local) {
          local.xPct = b.xPct;
          local.yPct = b.yPct;
        }
      }
      state.editingZoneId = null;
      setMode('select');
      switchZoneTab(zoneId);
      renderBoothList();
    } catch (err) {
      alert(err.message);
      state.editingZoneId = null;
      setMode('select');
    }
  }

  function switchZoneTab(zoneId) {
    state.activeZoneId = zoneId || null;
    state.selected.clear();
    // 구역 상세 배치도로 들어갈 때는 한눈에 더 잘 보이도록 기본 50%로, 전체 배치도로
    // 돌아갈 때는 기본 100%로 시작한다.
    state.zoom = zoneId ? 0.5 : 1;
    applyZoom();
    if (el.mapStage) {
      el.mapStage.scrollLeft = 0;
      el.mapStage.scrollTop = 0;
    }
    setMode('select');
    renderMap();
  }

  // 구역 상세 배치도가 아직 없을 때, 전체 배치도에서 그 구역 rect 부분만 잘라
  // 화면에 꽉 차게 확대해 보여준다(실제 상세 배치도가 준비되기 전까지의 임시 미리보기).
  // SVG 오버레이의 viewBox는 그대로 0~100이므로 클릭/드래그 좌표 계산은 손댈 필요가 없다 —
  // 이 미리보기 영역 자체가 곧 "그 구역의 0~100 좌표계"가 된다.
  function applyZoneCropFallback(overviewPath, rect) {
    el.mapCanvas.classList.add('cropped');
    const view = window.MapRender.expandRectForPreview(rect);

    function place() {
      const naturalW = el.floorplanImg.naturalWidth;
      const naturalH = el.floorplanImg.naturalHeight;
      if (!naturalW || !naturalH) return;
      const containerWidth = el.mapStage.clientWidth || 1;
      const fullWidthPx = containerWidth * (100 / view.wPct);
      const fullHeightPx = fullWidthPx * (naturalH / naturalW);
      const containerHeightPx = fullHeightPx * (view.hPct / 100);
      el.mapCanvas.style.height = `${containerHeightPx}px`;
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
    if (!el.mapCanvas.classList.contains('cropped')) return;
    el.mapCanvas.classList.remove('cropped');
    el.floorplanImg.onload = null;
    el.mapCanvas.style.height = '';
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

  function renderMap() {
    renderZoneTabs();
    const zone = getActiveZone();
    const floorplanPath = currentFloorplanPath();
    const usingCropFallback = isCropFallbackActive();

    el.zoneFloorplanBox.hidden = !(zone && !floorplanPath);
    el.zoneCropHint.hidden = !usingCropFallback;

    if (zone && !floorplanPath && !usingCropFallback) {
      el.mapEditorArea.hidden = true;
      state.markers = new Map();
      state.viewBooths = [];
      return;
    }

    el.mapEditorArea.hidden = false;
    el.modeZoneBtn.hidden = !!zone;
    el.modeEntranceBtn.hidden = !!zone;
    if (zone && (state.mode === 'zone' || state.mode === 'entrance')) setMode('select');

    if (!floorplanPath && !usingCropFallback) {
      clearCropFallback();
      el.floorplanImg.hidden = true;
      el.mapOverlay.hidden = true;
      el.mapEmpty.hidden = false;
      state.markers = new Map();
      state.viewBooths = [];
      return;
    }

    if (usingCropFallback) {
      applyZoneCropFallback(state.event.floorplanImagePath, zone.rect);
    } else {
      clearCropFallback();
      el.floorplanImg.src = `/uploads/floorplans/${floorplanPath}`;
    }
    el.floorplanImg.hidden = false;
    el.mapOverlay.hidden = false;
    el.mapEmpty.hidden = true;

    state.viewBooths = getViewBooths();

    if (zone) {
      state.markers = window.MapRender.renderBase(
        el.mapOverlay,
        { entrance: null, booths: state.viewBooths },
        { editable: true }
      );
    } else if ((state.event.zones || []).length > 0) {
      const { boothMarkers } = window.MapRender.renderOverview(el.mapOverlay, state.event, { editable: true });
      state.markers = boothMarkers;
    } else {
      state.markers = window.MapRender.renderBase(el.mapOverlay, state.event, { editable: true });
    }

    const viewBoothById = new Map(state.viewBooths.map((b) => [b.id, b]));
    for (const [boothId, markerEl] of state.markers) {
      const vb = viewBoothById.get(boothId);
      if (vb) attachMarkerDrag(vb, markerEl);
    }
    updateSelectionUI();
  }

  function renderBoothList() {
    const zoneNameOf = (zoneId) => {
      if (!zoneId) return '전체';
      const z = state.event.zones.find((zz) => zz.id === zoneId);
      return z ? z.name : '(삭제된 구역)';
    };
    const booths = state.event.booths.slice().sort((a, b) => a.number.localeCompare(b.number, 'ko', { numeric: true }));
    const installedCount = booths.filter((b) => b.installStatus === 'installed').length;
    el.boothCountSummary.textContent = booths.length > 0 ? `(총 ${booths.length}개 · 온보딩완료 ${installedCount}개)` : '';
    if (booths.length === 0) {
      el.boothListBody.innerHTML = '<tr><td colspan="5" style="color:#6b7280;">등록된 부스가 없습니다.</td></tr>';
      return;
    }
    el.boothListBody.innerHTML = booths
      .map(
        (b) => `<tr>
          <td class="num">${escapeHtml(b.number)}</td>
          <td>${escapeHtml(b.storeName || '')}</td>
          <td>${escapeHtml(zoneNameOf(b.zoneId))}</td>
          <td>${b.xPct === null ? '미지정' : `${b.xPct.toFixed(1)}, ${b.yPct.toFixed(1)}`}</td>
          <td><button class="secondary edit-booth-btn" data-booth-id="${b.id}">수정</button></td>
        </tr>`
      )
      .join('');
    el.boothListBody.querySelectorAll('.edit-booth-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const boothId = btn.dataset.boothId;
        const booth = state.event.booths.find((b) => b.id === boothId);
        if (booth && booth.zoneId !== state.activeZoneId) switchZoneTab(booth.zoneId);
        openBoothModal('edit', boothId);
      });
    });
  }

  // ---- 확대/축소(줌) ----
  function applyZoom() {
    el.mapCanvas.style.transform = `scale(${state.zoom})`;
    el.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function zoomAt(factor, clientX, clientY) {
    const rect = el.mapStage.getBoundingClientRect();
    const offsetX = clientX - rect.left;
    const offsetY = clientY - rect.top;
    const oldZoom = state.zoom;
    const contentX = (el.mapStage.scrollLeft + offsetX) / oldZoom;
    const contentY = (el.mapStage.scrollTop + offsetY) / oldZoom;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, oldZoom * factor));
    state.zoom = newZoom;
    applyZoom();
    el.mapStage.scrollLeft = contentX * newZoom - offsetX;
    el.mapStage.scrollTop = contentY * newZoom - offsetY;
  }

  el.mapStage.addEventListener(
    'wheel',
    (e) => {
      if (!state.event || !hasRenderableFloorplan()) return;
      if (!e.ctrlKey) return; // Ctrl 없는 휠은 그대로 화면 스크롤(이동)로 둔다
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
      zoomAt(factor, e.clientX, e.clientY);
    },
    { passive: false }
  );

  el.zoomInBtn.addEventListener('click', () => {
    const rect = el.mapStage.getBoundingClientRect();
    zoomAt(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  el.zoomOutBtn.addEventListener('click', () => {
    const rect = el.mapStage.getBoundingClientRect();
    zoomAt(1 / 1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  el.zoomResetBtn.addEventListener('click', () => {
    state.zoom = 1;
    applyZoom();
    el.mapStage.scrollLeft = 0;
    el.mapStage.scrollTop = 0;
  });

  // ---- 모드 전환 ----
  function setMode(mode) {
    if (mode !== 'zone') state.editingZoneId = null;
    if (mode !== 'add') state.addSettings = null;
    state.mode = mode;
    [el.modeSelectBtn, el.modeAddBtn, el.modeGridBtn, el.modeZoneBtn, el.modeEntranceBtn].forEach((b) =>
      b.classList.remove('active')
    );
    if (mode === 'select') {
      el.modeSelectBtn.classList.add('active');
      el.modeHint.textContent =
        '부스를 클릭하면 수정, 드래그하면 이동 · Shift+드래그로 다중 선택 · Ctrl+휠 확대/축소(50%~500%), 휠로 화면 이동';
    } else if (mode === 'add') {
      el.modeAddBtn.classList.add('active');
      updateAddModeHint();
    } else if (mode === 'grid') {
      el.modeGridBtn.classList.add('active');
      el.modeHint.textContent = '배치도 위에서 영역을 드래그하면 행x열 격자로 부스를 한 번에 생성합니다';
    } else if (mode === 'zone') {
      el.modeZoneBtn.classList.add('active');
      el.modeHint.textContent = state.editingZoneId
        ? '재설정할 새 영역을 전체 배치도 위에서 드래그하세요'
        : '전체 배치도 위에서 영역을 드래그해 새 구역을 지정하세요';
    } else {
      el.modeEntranceBtn.classList.add('active');
      el.modeHint.textContent = '배치도 위에서 입구 위치를 클릭하세요';
    }
  }
  el.modeSelectBtn.addEventListener('click', () => setMode('select'));
  el.modeAddBtn.addEventListener('click', () => setMode('add'));
  el.modeGridBtn.addEventListener('click', () => setMode('grid'));
  el.modeZoneBtn.addEventListener('click', () => setMode('zone'));
  el.modeEntranceBtn.addEventListener('click', () => setMode('entrance'));
  setMode('select');

  // 부스 번호 끝의 숫자를 1 증가시켜 다음 번호를 만든다(자릿수는 유지). 끝이 숫자가 아니면 null.
  function nextBoothNumber(number) {
    const m = /^(.*?)(\d+)$/.exec(number);
    if (!m) return null;
    const [, prefix, digits] = m;
    const next = String(Number(digits) + 1).padStart(digits.length, '0');
    return prefix + next;
  }

  // 부스추가 모드일 때, 이전 저장값이 있으면 다음 번호 미리보기를 안내 문구에 표시한다.
  function updateAddModeHint() {
    if (state.mode !== 'add') return;
    if (state.addSettings) {
      const next = nextBoothNumber(state.addSettings.number);
      if (next) {
        el.modeHint.textContent = `빈 곳을 클릭하면 '${next}' 부스가 이전 설정(가로 ${state.addSettings.wPct}, 세로 ${state.addSettings.hPct})으로 바로 추가됩니다`;
        return;
      }
    }
    el.modeHint.textContent = '배치도 위 빈 곳을 클릭해 새 부스를 추가하세요';
  }

  // 부스추가 모드에서 팝업 없이 이전 설정값 그대로(번호만 +1) 부스를 바로 생성
  async function createBoothFromAddSettings(pct) {
    const next = nextBoothNumber(state.addSettings.number);
    try {
      const { booth } = await api(`/api/events/${state.event.id}/booths`, {
        method: 'POST',
        body: JSON.stringify({
          number: next,
          wPct: state.addSettings.wPct,
          hPct: state.addSettings.hPct,
          zoneId: state.activeZoneId,
          ...pct,
        }),
      });
      state.event.booths.push(booth);
      state.addSettings = { number: booth.number, wPct: booth.wPct, hPct: booth.hPct };
      updateAddModeHint();
      renderMap();
      renderBoothList();
    } catch (err) {
      alert(err.message);
    }
  }

  function normalizeRect(a, b) {
    const xPct = Math.min(a.xPct, b.xPct);
    const yPct = Math.min(a.yPct, b.yPct);
    const wPct = Math.abs(b.xPct - a.xPct);
    const hPct = Math.abs(b.yPct - a.yPct);
    return { xPct, yPct, wPct, hPct };
  }

  // 배치도 위 빈 공간 클릭(부스 추가/입구 지정, select 모드에서는 선택 해제)
  el.mapOverlay.addEventListener('click', async (e) => {
    if (!state.event || !hasRenderableFloorplan()) return;
    const pct = window.MapRender.pointToPct(el.mapOverlay, e.clientX, e.clientY);
    if (state.mode === 'add') {
      if (state.addSettings && nextBoothNumber(state.addSettings.number)) {
        await createBoothFromAddSettings(pct);
      } else {
        state.pendingAddPct = pct;
        openBoothModal('add', null);
      }
    } else if (state.mode === 'entrance') {
      try {
        const { event } = await api(`/api/events/${state.event.id}/entrance`, {
          method: 'PUT',
          body: JSON.stringify(pct),
        });
        state.event = event;
        renderMap();
      } catch (err) {
        alert(err.message);
      }
    } else if (state.mode === 'select' && !(e.shiftKey || e.ctrlKey || e.metaKey)) {
      clearSelection();
    }
  });

  // 드래그로 사각 영역을 그리는 공용 헬퍼(부스 자동 추가 / 구역 지정 / 다중 선택 영역에서 재사용)
  function startBoxDrag(e, onFinish) {
    e.preventDefault();
    const startPct = window.MapRender.pointToPct(el.mapOverlay, e.clientX, e.clientY);
    let currentPct = startPct;
    let moved = false;
    const boxEl = document.createElement('div');
    boxEl.className = 'select-box';
    el.mapCanvas.appendChild(boxEl);

    function updateBox() {
      const rect = normalizeRect(startPct, currentPct);
      boxEl.style.left = `${rect.xPct}%`;
      boxEl.style.top = `${rect.yPct}%`;
      boxEl.style.width = `${rect.wPct}%`;
      boxEl.style.height = `${rect.hPct}%`;
    }

    function onMove(ev) {
      currentPct = window.MapRender.pointToPct(el.mapOverlay, ev.clientX, ev.clientY);
      if (!moved && (Math.abs(currentPct.xPct - startPct.xPct) > 0.5 || Math.abs(currentPct.yPct - startPct.yPct) > 0.5)) {
        moved = true;
      }
      if (moved) updateBox();
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      boxEl.remove();
      if (!moved) return;
      const rect = normalizeRect(startPct, currentPct);
      if (rect.wPct < 2 || rect.hPct < 2) return;
      onFinish(rect);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // 부스 자동 추가 영역 / 구역 영역 지정(드래그)
  function startRegionDrag(e) {
    startBoxDrag(e, (rect) => {
      if (state.mode === 'grid') {
        openGridModal(rect);
      } else if (state.mode === 'zone') {
        if (state.editingZoneId) updateZoneRect(state.editingZoneId, rect);
        else openZoneModal(rect);
      }
    });
  }

  // Shift(또는 Ctrl)+드래그로 다중 선택 영역 지정(기존 선택에 추가)
  function startRubberBandSelect(e) {
    startBoxDrag(e, (rect) => {
      const idsInRect = state.viewBooths
        .filter(
          (b) =>
            b.xPct >= rect.xPct &&
            b.xPct <= rect.xPct + rect.wPct &&
            b.yPct >= rect.yPct &&
            b.yPct <= rect.yPct + rect.hPct
        )
        .map((b) => b.id);
      idsInRect.forEach((id) => state.selected.add(id));
      updateSelectionUI();
    });
  }

  el.mapOverlay.addEventListener('mousedown', (e) => {
    if (!state.event || !hasRenderableFloorplan()) return;
    if (state.mode === 'grid' || state.mode === 'zone') {
      startRegionDrag(e);
    } else if (state.mode === 'select' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      startRubberBandSelect(e);
    }
    // select 모드에서 Shift/Ctrl 없이 누르는 경우, add/entrance 모드는 위 'click' 리스너가 처리한다.
  });

  // ---- 다중 선택 ----
  function toggleSelect(boothId) {
    if (state.selected.has(boothId)) state.selected.delete(boothId);
    else state.selected.add(boothId);
    updateSelectionUI();
  }

  function clearSelection() {
    state.selected.clear();
    updateSelectionUI();
  }

  function updateSelectionUI() {
    const validIds = new Set(state.viewBooths.map((b) => b.id));
    for (const id of Array.from(state.selected)) {
      if (!validIds.has(id)) state.selected.delete(id);
    }
    for (const [id, markerEl] of state.markers) {
      window.MapRender.setBoothMarkerSelected(markerEl, state.selected.has(id));
    }
    const n = state.selected.size;
    el.batchPanel.hidden = n === 0;
    el.batchCount.textContent = `${n}개 선택됨`;
    if (n > 0) {
      const first = state.event.booths.find((b) => state.selected.has(b.id));
      if (first) {
        // 전체 배치도에서는 화면에 실제로 보이는 크기(구역 rect 비율 반영)를 보여준다.
        const size = boothSize(first);
        el.batchWidth.value = Math.round(size.wPct * 100) / 100;
        el.batchHeight.value = Math.round(size.hPct * 100) / 100;
      }
    }
  }

  el.batchClearBtn.addEventListener('click', clearSelection);

  el.batchDeleteBtn.addEventListener('click', async () => {
    const ids = Array.from(state.selected);
    if (ids.length === 0) return;
    if (!confirm(`선택한 부스 ${ids.length}개를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    const results = await Promise.allSettled(
      ids.map((id) => api(`/api/events/${state.event.id}/booths/${id}`, { method: 'DELETE' }))
    );
    const failed = [];
    ids.forEach((id, i) => {
      if (results[i].status === 'fulfilled') {
        state.event.booths = state.event.booths.filter((b) => b.id !== id);
        state.selected.delete(id);
      } else {
        const booth = state.event.booths.find((b) => b.id === id);
        failed.push(`${booth ? booth.number : id}: ${results[i].reason.message}`);
      }
    });
    renderMap();
    renderBoothList();
    if (failed.length > 0) {
      alert(`일부 부스는 삭제하지 못했습니다.\n${failed.join('\n')}`);
    }
  });

  el.batchApplyBtn.addEventListener('click', async () => {
    if (state.selected.size === 0) return;
    const wPct = Number(el.batchWidth.value);
    const hPct = Number(el.batchHeight.value);
    if (!wPct || !hPct || wPct <= 0 || hPct <= 0) {
      alert('가로/세로 크기를 올바르게 입력해주세요.');
      return;
    }
    // 전체 배치도에서 입력한 크기는 "전체 배치도 기준" 크기로 본다. 선택된 부스가
    // 구역에 속해 있으면, 상세구역 화면은 그 구역 rect 비율만큼 확대되어 보이므로
    // 같은 비율로 크기를 키운 값을 그 구역 좌표계 크기로 저장해야 물리적 크기가
    // 일치해 보인다(구역 상세 화면에서 너무 작게 보이는 문제 방지).
    const onOverview = !getActiveZone();
    const items = Array.from(state.selected).map((id) => {
      const booth = state.event.booths.find((b) => b.id === id);
      let itemW = wPct;
      let itemH = hPct;
      if (onOverview && booth && booth.zoneId) {
        const zone = state.event.zones.find((z) => z.id === booth.zoneId);
        if (zone && zone.rect) {
          itemW = Math.min(100, Math.max(0.5, wPct * (100 / zone.rect.wPct)));
          itemH = Math.min(100, Math.max(0.5, hPct * (100 / zone.rect.hPct)));
        }
      }
      return { id, wPct: itemW, hPct: itemH };
    });
    try {
      const { booths } = await api(`/api/events/${state.event.id}/booths/bulk`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      });
      for (const b of booths) {
        const local = state.event.booths.find((x) => x.id === b.id);
        if (local) {
          local.wPct = b.wPct;
          local.hPct = b.hPct;
        }
      }
      renderMap();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---- 부스 드래그(단일/다중 이동) ----
  // booth: 현재 탭 좌표계로 변환된 뷰모델 부스(getViewBooths 결과의 원소)
  // 전체 배치도에서 구역에 속한 부스(zone-linked)는 클릭하면 그 구역 탭으로 이동하지만,
  // 드래그하면(다른 booth와 동일하게) 위치를 옮길 수 있어야 하므로 드래그 자체는 막지 않는다.
  function attachMarkerDrag(booth, markerEl) {
    const onOverview = !getActiveZone();
    const isZoneLinkedOnOverview = onOverview && booth.zoneId;

    markerEl.addEventListener('click', (e) => e.stopPropagation());
    if (isZoneLinkedOnOverview) markerEl.classList.add('zone-linked');

    const boothId = booth.id;

    markerEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        toggleSelect(boothId);
        return;
      }

      const moveIds =
        state.selected.has(boothId) && state.selected.size > 1 ? Array.from(state.selected) : [boothId];
      const viewById = new Map(state.viewBooths.map((b) => [b.id, b]));
      const startPositions = new Map(moveIds.map((id) => [id, { xPct: viewById.get(id).xPct, yPct: viewById.get(id).yPct }]));
      const startPct = window.MapRender.pointToPct(el.mapOverlay, e.clientX, e.clientY);
      let moved = false;
      let lastPct = startPct;

      function onMove(ev) {
        lastPct = window.MapRender.pointToPct(el.mapOverlay, ev.clientX, ev.clientY);
        const dx = lastPct.xPct - startPct.xPct;
        const dy = lastPct.yPct - startPct.yPct;
        if (!moved && (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4)) {
          moved = true;
          moveIds.forEach((id) => state.markers.get(id) && state.markers.get(id).classList.add('dragging'));
        }
        if (moved) {
          for (const id of moveIds) {
            const start = startPositions.get(id);
            const nx = Math.min(100, Math.max(0, start.xPct + dx));
            const ny = Math.min(100, Math.max(0, start.yPct + dy));
            window.MapRender.setBoothMarkerPosition(state.markers.get(id), nx, ny);
          }
        }
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        moveIds.forEach((id) => state.markers.get(id) && state.markers.get(id).classList.remove('dragging'));
        if (moved) {
          const dx = lastPct.xPct - startPct.xPct;
          const dy = lastPct.yPct - startPct.yPct;
          const finalPositions = moveIds.map((id) => {
            const start = startPositions.get(id);
            return {
              id,
              xPct: Math.min(100, Math.max(0, start.xPct + dx)),
              yPct: Math.min(100, Math.max(0, start.yPct + dy)),
            };
          });

          savePositionMoves(finalPositions);
        } else if (isZoneLinkedOnOverview) {
          switchZoneTab(booth.zoneId);
        } else {
          openBoothModal('edit', boothId);
        }
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // 전체 배치도에서 옮긴 부스들 중, 원래 구역에 속해 있었거나 새로 어떤 구역 안으로
  // 들어간 부스들을 각각 처리한다(zoneId가 null이면 구역에서 뺀다).
  // items: [{ id, zoneId, xPct, yPct }, ...] (xPct/yPct는 전체 배치도 좌표)
  async function moveBoothsOnOverview(items) {
    try {
      const results = await Promise.all(
        items.map((it) =>
          api(`/api/events/${state.event.id}/booths/${it.id}/zone`, {
            method: 'PATCH',
            body: JSON.stringify({ zoneId: it.zoneId, xPct: it.xPct, yPct: it.yPct }),
          })
        )
      );
      for (const { booth } of results) {
        const local = state.event.booths.find((b) => b.id === booth.id);
        if (local) Object.assign(local, booth);
      }
      renderMap();
      renderBoothList();
    } catch (err) {
      alert(err.message);
      renderMap();
    }
  }

  async function saveBoothsBulkPosition(items) {
    try {
      const { booths } = await api(`/api/events/${state.event.id}/booths/bulk`, {
        method: 'PATCH',
        body: JSON.stringify({ items }),
      });
      for (const b of booths) {
        const local = state.event.booths.find((x) => x.id === b.id);
        if (local) {
          local.xPct = b.xPct;
          local.yPct = b.yPct;
          local.zoneXPct = b.zoneXPct;
          local.zoneYPct = b.zoneYPct;
        }
      }
      renderMap();
      renderBoothList();
    } catch (err) {
      alert(err.message);
      renderMap();
    }
  }

  // 다중 선택된 부스의 현재 탭 좌표계 뷰모델(정렬/간격정렬 계산에 사용)
  function getSelectedViewBooths() {
    return state.viewBooths.filter((b) => state.selected.has(b.id));
  }

  // 정렬/간격정렬 계산에 쓸 "실제로 화면에 보이는" 크기. 전체 배치도에서 구역에 속한
  // 부스는 실제 wPct/hPct(그 구역 상세 배치도 기준 값)가 아니라 구역 rect 비율로 환산한
  // 크기(renderOverview와 동일한 계산, window.MapRender.overviewBoothSize)로 그려지므로,
  // 정렬 계산도 그 값을 기준으로 해야 화면에 보이는 것과 정렬 결과가 일치한다.
  function boothSize(b) {
    if (!getActiveZone() && b.zoneId) {
      const zone = state.event.zones.find((z) => z.id === b.zoneId);
      return window.MapRender.overviewBoothSize(b, zone);
    }
    return { wPct: b.wPct || DEFAULT_BOOTH_SIZE, hPct: b.hPct || DEFAULT_BOOTH_SIZE };
  }

  // 부스 위치 변경 결과(items: [{id, xPct, yPct}])를 현재 탭에 맞게 저장한다.
  // 전체 배치도에서는 구역 편입/이탈이 걸린 부스만 구역 인식 API로 따로 처리하고,
  // 나머지(계속 구역 밖에 있는 일반 부스)는 기존 일괄 이동 API를 쓴다.
  // 구역 상세 탭에서는 항상 일괄 이동 API(zone-local 좌표)를 쓴다.
  // 크기(wPct/hPct)는 건드리지 않는다 — 정렬/드래그는 위치만 바꾼다.
  function savePositionMoves(items) {
    if (getActiveZone()) {
      saveBoothsBulkPosition(items);
      return;
    }
    const zones = (state.event.zones || []).filter((z) => z.rect);
    const boothById = new Map(state.event.booths.map((b) => [b.id, b]));
    const zoneAware = [];
    const plainMove = [];
    for (const pos of items) {
      const currentZoneId = (boothById.get(pos.id) || {}).zoneId || null;
      const hitZone = zones.find(
        (z) =>
          pos.xPct >= z.rect.xPct &&
          pos.xPct <= z.rect.xPct + z.rect.wPct &&
          pos.yPct >= z.rect.yPct &&
          pos.yPct <= z.rect.yPct + z.rect.hPct
      );
      const targetZoneId = hitZone ? hitZone.id : null;
      if (currentZoneId || targetZoneId) {
        zoneAware.push({ id: pos.id, zoneId: targetZoneId, xPct: pos.xPct, yPct: pos.yPct });
      } else {
        plainMove.push(pos);
      }
    }
    if (zoneAware.length > 0) moveBoothsOnOverview(zoneAware);
    if (plainMove.length > 0) saveBoothsBulkPosition(plainMove);
  }

  // 좌/우/상/하 라인 정렬: 선택된 부스 중 가장 바깥쪽 라인(맨 왼쪽/오른쪽/위/아래)에 나머지를 맞춘다.
  function applyAlign(edge) {
    const booths = getSelectedViewBooths();
    if (booths.length < 2) {
      alert('정렬하려면 부스를 2개 이상 선택해주세요.');
      return;
    }
    let items;
    if (edge === 'left') {
      const target = Math.min(...booths.map((b) => b.xPct - boothSize(b).wPct / 2));
      items = booths.map((b) => ({ id: b.id, xPct: target + boothSize(b).wPct / 2, yPct: b.yPct }));
    } else if (edge === 'right') {
      const target = Math.max(...booths.map((b) => b.xPct + boothSize(b).wPct / 2));
      items = booths.map((b) => ({ id: b.id, xPct: target - boothSize(b).wPct / 2, yPct: b.yPct }));
    } else if (edge === 'top') {
      const target = Math.min(...booths.map((b) => b.yPct - boothSize(b).hPct / 2));
      items = booths.map((b) => ({ id: b.id, xPct: b.xPct, yPct: target + boothSize(b).hPct / 2 }));
    } else {
      const target = Math.max(...booths.map((b) => b.yPct + boothSize(b).hPct / 2));
      items = booths.map((b) => ({ id: b.id, xPct: b.xPct, yPct: target - boothSize(b).hPct / 2 }));
    }
    savePositionMoves(items);
  }

  // 가로/세로 간격 균등 정렬: 맨 왼쪽/오른쪽(또는 위/아래) 부스는 그대로 두고,
  // 그 사이 부스들의 테두리 간 간격이 모두 같아지도록 배치한다.
  function applyDistribute(axis) {
    const booths = getSelectedViewBooths();
    if (booths.length < 3) {
      alert('간격 정렬을 하려면 부스를 3개 이상 선택해주세요.');
      return;
    }
    const list = booths
      .map((b) => {
        const { wPct, hPct } = boothSize(b);
        return {
          id: b.id,
          center: axis === 'h' ? b.xPct : b.yPct,
          other: axis === 'h' ? b.yPct : b.xPct,
          size: axis === 'h' ? wPct : hPct,
        };
      })
      .sort((a, b) => a.center - b.center);

    const first = list[0];
    const last = list[list.length - 1];
    const spanStart = first.center - first.size / 2;
    const spanEnd = last.center + last.size / 2;
    const totalSize = list.reduce((sum, b) => sum + b.size, 0);
    const gap = (spanEnd - spanStart - totalSize) / (list.length - 1);

    const toItem = (b, center) => ({
      id: b.id,
      xPct: axis === 'h' ? center : b.other,
      yPct: axis === 'h' ? b.other : center,
    });

    const items = [toItem(first, first.center)];
    let cursor = spanStart + first.size;
    for (let i = 1; i < list.length - 1; i++) {
      const b = list[i];
      const edgeStart = cursor + gap;
      const center = edgeStart + b.size / 2;
      items.push(toItem(b, center));
      cursor = edgeStart + b.size;
    }
    items.push(toItem(last, last.center));

    savePositionMoves(items);
  }

  el.alignLeftBtn.addEventListener('click', () => applyAlign('left'));
  el.alignRightBtn.addEventListener('click', () => applyAlign('right'));
  el.alignTopBtn.addEventListener('click', () => applyAlign('top'));
  el.alignBottomBtn.addEventListener('click', () => applyAlign('bottom'));
  el.distributeHBtn.addEventListener('click', () => applyDistribute('h'));
  el.distributeVBtn.addEventListener('click', () => applyDistribute('v'));

  // ---- 부스 자동 추가(격자) ----
  function openGridModal(rect) {
    state.pendingGridRect = rect;
    state.gridCountTouched = false;
    el.gridModalError.textContent = '';
    el.gridRows.value = 1;
    el.gridCols.value = 1;
    el.gridCount.value = 1;
    el.gridPrefix.value = '';
    el.gridStart.value = 1;
    el.gridPad.value = 2;
    el.gridGap.value = 1;
    updateGridCountHint();
    el.gridModal.hidden = false;
  }

  function closeGridModal() {
    el.gridModal.hidden = true;
    state.pendingGridRect = null;
  }

  // 행x열 값으로 최대 칸 수를 계산하고, 생성 개수 입력을 그 범위로 맞춘다.
  // 사용자가 개수를 직접 건드리지 않았다면 행x열 변경에 맞춰 자동으로 꽉 채운 값을 유지한다.
  function updateGridCountHint() {
    const rows = Math.max(1, parseInt(el.gridRows.value, 10) || 1);
    const cols = Math.max(1, parseInt(el.gridCols.value, 10) || 1);
    const maxCount = rows * cols;
    el.gridCount.max = String(maxCount);
    if (!state.gridCountTouched || !el.gridCount.value) {
      el.gridCount.value = maxCount;
    } else if (Number(el.gridCount.value) > maxCount) {
      el.gridCount.value = maxCount;
    }
    el.gridCountHint.textContent = `격자 ${rows}x${cols}(최대 ${maxCount}칸) 중 앞에서부터 ${el.gridCount.value}개 부스가 생성됩니다.`;
  }
  el.gridRows.addEventListener('input', updateGridCountHint);
  el.gridCols.addEventListener('input', updateGridCountHint);
  el.gridCount.addEventListener('input', () => {
    state.gridCountTouched = true;
    updateGridCountHint();
  });
  el.gridModalCancel.addEventListener('click', closeGridModal);

  el.gridModalSave.addEventListener('click', async () => {
    const rect = state.pendingGridRect;
    if (!rect) return;
    const rows = Math.max(1, parseInt(el.gridRows.value, 10) || 1);
    const cols = Math.max(1, parseInt(el.gridCols.value, 10) || 1);
    const maxCount = rows * cols;
    const count = Math.min(maxCount, Math.max(1, parseInt(el.gridCount.value, 10) || maxCount));
    const prefix = el.gridPrefix.value || '';
    const start = parseInt(el.gridStart.value, 10) || 0;
    const pad = Math.max(1, parseInt(el.gridPad.value, 10) || 1);
    const gap = Math.max(0, Number(el.gridGap.value) || 0);

    const cellW = rect.wPct / cols;
    const cellH = rect.hPct / rows;
    const boothW = Math.max(0.5, cellW - gap);
    const boothH = Math.max(0.5, cellH - gap);

    const booths = [];
    let seq = start;
    for (let r = 0; r < rows && booths.length < count; r++) {
      for (let c = 0; c < cols && booths.length < count; c++) {
        const cx = rect.xPct + cellW * (c + 0.5);
        const cy = rect.yPct + cellH * (r + 0.5);
        booths.push({
          number: `${prefix}${String(seq).padStart(pad, '0')}`,
          xPct: cx,
          yPct: cy,
          wPct: boothW,
          hPct: boothH,
        });
        seq++;
      }
    }

    try {
      const { booths: created } = await api(`/api/events/${state.event.id}/booths/bulk`, {
        method: 'POST',
        body: JSON.stringify({ booths, zoneId: state.activeZoneId }),
      });
      state.event.booths.push(...created);
      closeGridModal();
      renderMap();
      renderBoothList();
    } catch (err) {
      el.gridModalError.textContent = err.message;
    }
  });

  // ---- 구역(zone) 추가 ----
  function openZoneModal(rect) {
    state.pendingZoneRect = rect;
    el.zoneModalError.textContent = '';
    el.zoneModalName.value = '';
    el.zoneModal.hidden = false;
  }

  function closeZoneModal() {
    el.zoneModal.hidden = true;
    state.pendingZoneRect = null;
  }
  el.zoneModalCancel.addEventListener('click', closeZoneModal);

  el.zoneModalSave.addEventListener('click', async () => {
    const name = el.zoneModalName.value.trim();
    if (!name) {
      el.zoneModalError.textContent = '구역 이름을 입력해주세요.';
      return;
    }
    try {
      const { zone } = await api(`/api/events/${state.event.id}/zones`, {
        method: 'POST',
        body: JSON.stringify({ name, rect: state.pendingZoneRect }),
      });
      state.event.zones.push(zone);
      closeZoneModal();
      renderAssignZoneOptions();
      switchZoneTab(zone.id);
    } catch (err) {
      el.zoneModalError.textContent = err.message;
    }
  });

  el.zoneFloorplanUploadBtn.addEventListener('click', async () => {
    const zone = getActiveZone();
    if (!zone) return;
    const file = el.zoneFloorplanFile.files[0];
    if (!file) {
      el.zoneFloorplanStatus.textContent = '이미지 파일을 선택해주세요.';
      return;
    }
    const formData = new FormData();
    formData.append('floorplan', file);
    try {
      const res = await fetch(`/api/events/${state.event.id}/zones/${zone.id}/floorplan`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
      const idx = state.event.zones.findIndex((z) => z.id === zone.id);
      if (idx !== -1) state.event.zones[idx] = data.zone;
      state.zoom = 1;
      applyZoom();
      el.zoneFloorplanStatus.textContent = '구역 배치도가 업로드되었습니다.';
      renderMap();
    } catch (err) {
      el.zoneFloorplanStatus.textContent = err.message;
    }
  });

  // ---- 부스 추가/수정/삭제 모달 ----
  function openBoothModal(mode, boothId) {
    state.modalBoothId = boothId;
    el.boothModalError.textContent = '';
    el.boothModalNumber.value = '';
    if (mode === 'add') {
      el.boothModalTitle.textContent = '새 부스';
      el.boothModalDelete.hidden = true;
      el.boothModalWidth.value = DEFAULT_BOOTH_SIZE;
      el.boothModalHeight.value = DEFAULT_BOOTH_SIZE;
      el.boothModalStoreName.value = '';
      el.boothModalBusinessNumber.value = '';
      el.boothModalCorpNumber.value = '';
      el.boothModalOnboardingContact.value = '';
      el.boothModalVan.value = '';
    } else {
      const booth = state.event.booths.find((b) => b.id === boothId);
      el.boothModalTitle.textContent = `부스 ${booth.number} 수정`;
      el.boothModalNumber.value = booth.number;
      el.boothModalWidth.value = booth.wPct || DEFAULT_BOOTH_SIZE;
      el.boothModalHeight.value = booth.hPct || DEFAULT_BOOTH_SIZE;
      el.boothModalStoreName.value = booth.storeName || '';
      el.boothModalBusinessNumber.value = booth.businessNumber || '';
      el.boothModalCorpNumber.value = booth.corpNumber || '';
      el.boothModalOnboardingContact.value = booth.onboardingContact || '';
      el.boothModalVan.value = booth.van || '';
      el.boothModalDelete.hidden = false;
    }
    el.boothModal.hidden = false;
  }

  function closeBoothModal() {
    el.boothModal.hidden = true;
    state.modalBoothId = null;
    state.pendingAddPct = null;
  }
  el.boothModalCancel.addEventListener('click', closeBoothModal);

  el.boothModalSave.addEventListener('click', async () => {
    const number = el.boothModalNumber.value.trim();
    const wPct = Number(el.boothModalWidth.value) || DEFAULT_BOOTH_SIZE;
    const hPct = Number(el.boothModalHeight.value) || DEFAULT_BOOTH_SIZE;
    const storeName = el.boothModalStoreName.value.trim();
    const businessNumber = el.boothModalBusinessNumber.value.trim();
    const corpNumber = el.boothModalCorpNumber.value.trim();
    const onboardingContact = el.boothModalOnboardingContact.value.trim();
    const van = el.boothModalVan.value.trim();
    if (!number) {
      el.boothModalError.textContent = '부스 번호를 입력해주세요.';
      return;
    }
    try {
      if (state.modalBoothId) {
        const { booth } = await api(`/api/events/${state.event.id}/booths/${state.modalBoothId}`, {
          method: 'PATCH',
          body: JSON.stringify({ number, wPct, hPct, storeName, businessNumber, corpNumber, onboardingContact, van }),
        });
        const local = state.event.booths.find((b) => b.id === booth.id);
        if (local) Object.assign(local, booth);
      } else {
        const { booth } = await api(`/api/events/${state.event.id}/booths`, {
          method: 'POST',
          body: JSON.stringify({
            number,
            wPct,
            hPct,
            storeName,
            businessNumber,
            corpNumber,
            onboardingContact,
            van,
            zoneId: state.activeZoneId,
            ...state.pendingAddPct,
          }),
        });
        state.event.booths.push(booth);
        if (state.mode === 'add') {
          state.addSettings = { number: booth.number, wPct: booth.wPct, hPct: booth.hPct };
          updateAddModeHint();
        }
      }
      closeBoothModal();
      renderMap();
      renderBoothList();
    } catch (err) {
      el.boothModalError.textContent = err.message;
    }
  });

  el.boothModalDelete.addEventListener('click', async () => {
    if (!state.modalBoothId) return;
    if (!confirm('이 부스를 삭제할까요?')) return;
    try {
      await api(`/api/events/${state.event.id}/booths/${state.modalBoothId}`, { method: 'DELETE' });
      state.event.booths = state.event.booths.filter((b) => b.id !== state.modalBoothId);
      state.selected.delete(state.modalBoothId);
      closeBoothModal();
      renderMap();
      renderBoothList();
    } catch (err) {
      el.boothModalError.textContent = err.message;
    }
  });

  // ---- 날짜별 담당자 배정 ----
  function renderAssignZoneOptions() {
    const zones = (state.event && state.event.zones) || [];
    el.assignZoneSelect.innerHTML =
      '<option value="">전체(공통)</option>' + zones.map((z) => `<option value="${z.id}">${escapeHtml(z.name)}</option>`).join('');
  }

  function renderAssignmentList() {
    const assignments = (state.event.assignments || [])
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    if (assignments.length === 0) {
      el.assignmentListBody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;">배정된 담당자가 없습니다.</td></tr>';
      return;
    }
    el.assignmentListBody.innerHTML = assignments
      .map((a) => {
        const zone = a.zoneId ? state.event.zones.find((z) => z.id === a.zoneId) : null;
        const zoneLabel = a.zoneId ? (zone ? escapeHtml(zone.name) : '(삭제된 구역)') : '전체';
        return `<tr>
          <td>${escapeHtml(a.date)}</td>
          <td>${zoneLabel}</td>
          <td>${escapeHtml(a.displayName)}</td>
          <td>${escapeHtml(a.phone || '')}</td>
          <td>${escapeHtml(a.note || '')}</td>
          <td><button class="danger assign-delete-btn" data-assignment-id="${a.id}">삭제</button></td>
        </tr>`;
      })
      .join('');
    el.assignmentListBody.querySelectorAll('.assign-delete-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/events/${state.event.id}/assignments/${btn.dataset.assignmentId}`, { method: 'DELETE' });
          state.event.assignments = state.event.assignments.filter((a) => a.id !== btn.dataset.assignmentId);
          renderAssignmentList();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  function formatDateTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('ko-KR');
  }

  function renderOnboardingLog() {
    const logs = state.event.onboardingLogs || [];
    const query = el.onboardingLogSearch.value.trim().toLowerCase();
    const filtered = query
      ? logs.filter((log) =>
          [log.boothNumber, log.storeName, log.businessNumber, log.corpNumber]
            .some((v) => (v || '').toLowerCase().includes(query))
        )
      : logs;

    if (filtered.length === 0) {
      el.onboardingLogBody.innerHTML = `<tr><td colspan="10" style="color:#6b7280;">${
        query ? '검색 결과가 없습니다.' : '온보딩완료 처리 이력이 없습니다.'
      }</td></tr>`;
      return;
    }

    el.onboardingLogBody.innerHTML = filtered
      .map((log, idx) => {
        const zone = log.zoneId ? state.event.zones.find((z) => z.id === log.zoneId) : null;
        const zoneLabel = log.zoneId ? (zone ? escapeHtml(zone.name) : '(삭제된 구역)') : '전체';
        return `<tr>
          <td>${filtered.length - idx}</td>
          <td>${escapeHtml(formatDateTime(log.completedAt))}</td>
          <td>${escapeHtml(log.boothNumber || '')}</td>
          <td>${zoneLabel}</td>
          <td>${escapeHtml(log.storeName || '')}</td>
          <td>${escapeHtml(log.businessNumber || '')}</td>
          <td>${escapeHtml(log.corpNumber || '')}</td>
          <td>${escapeHtml(log.van || '')}</td>
          <td>${escapeHtml(log.completedByName)}</td>
          <td>${escapeHtml(log.completedBy)}</td>
        </tr>`;
      })
      .join('');
  }

  el.onboardingLogSearch.addEventListener('input', renderOnboardingLog);
  el.onboardingLogRefreshBtn.addEventListener('click', async () => {
    if (!state.event) return;
    try {
      state.event = await api(`/api/events/${state.event.id}`);
      renderOnboardingLog();
    } catch (err) {
      alert(err.message);
    }
  });

  el.assignCreateBtn.addEventListener('click', async () => {
    el.assignStatus.textContent = '';
    const date = el.assignDate.value;
    const zoneId = el.assignZoneSelect.value || null;
    const username = el.assignUserSelect.value;
    const phone = el.assignPhone.value.trim();
    const note = el.assignNote.value.trim();
    if (!date) {
      el.assignStatus.textContent = '날짜를 선택해주세요.';
      return;
    }
    if (!username) {
      el.assignStatus.textContent = '담당자 계정을 선택해주세요.';
      return;
    }
    try {
      const { assignment } = await api(`/api/events/${state.event.id}/assignments`, {
        method: 'POST',
        body: JSON.stringify({ date, zoneId, username, phone, note }),
      });
      state.event.assignments.push(assignment);
      el.assignPhone.value = '';
      el.assignNote.value = '';
      renderAssignmentList();
    } catch (err) {
      el.assignStatus.textContent = err.message;
    }
  });

  // ---- 행사 생성/선택/상태 ----
  function updateSetDefaultBtn() {
    const summary = state.events.find((e) => e.id === state.event.id);
    const isDefault = summary ? summary.isDefault : false;
    el.setDefaultEventBtn.textContent = isDefault ? '지도 화면 기본 행사입니다 ★' : '지도 화면 기본 행사로 설정';
    el.setDefaultEventBtn.disabled = isDefault;
  }

  el.setDefaultEventBtn.addEventListener('click', async () => {
    if (!state.event) return;
    try {
      await api(`/api/events/${state.event.id}/default`, { method: 'POST' });
      state.events = await api('/api/events');
      renderEventOptions();
      updateSetDefaultBtn();
    } catch (err) {
      el.eventStatusMsg.textContent = err.message;
    }
  });

  el.deleteEventBtn.addEventListener('click', async () => {
    if (!state.event) return;
    const name = state.event.name;
    if (
      !confirm(
        `'${name}' 행사를 삭제할까요?\n부스·구역·담당자 배정 등 이 행사의 모든 데이터가 함께 삭제되며 되돌릴 수 없습니다.`
      )
    ) {
      return;
    }
    try {
      await api(`/api/events/${state.event.id}`, { method: 'DELETE' });
      state.event = null;
      el.eventStatusMsg.textContent = `'${name}' 행사를 삭제했습니다.`;
      await loadEvents();
      if (state.events.length === 0) {
        el.floorplanBox.hidden = true;
        el.mapBox.hidden = true;
        el.importBox.hidden = true;
        el.boothListBox.hidden = true;
        el.assignmentBox.hidden = true;
      }
    } catch (err) {
      el.eventStatusMsg.textContent = err.message;
    }
  });

  el.eventSelect.addEventListener('change', () => selectEvent(el.eventSelect.value));

  el.eventStatusSelect.addEventListener('change', async () => {
    if (!state.event) return;
    try {
      await api(`/api/events/${state.event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: el.eventStatusSelect.value }),
      });
      state.event.status = el.eventStatusSelect.value;
      await loadEvents();
      el.eventSelect.value = state.event.id;
    } catch (err) {
      el.eventStatusMsg.textContent = err.message;
    }
  });

  el.createEventBtn.addEventListener('click', async () => {
    const name = el.newEventName.value.trim();
    const date = el.newEventDate.value;
    if (!name) {
      el.eventStatusMsg.textContent = '행사 이름을 입력해주세요.';
      return;
    }
    try {
      const { event } = await api('/api/events', { method: 'POST', body: JSON.stringify({ name, date }) });
      el.newEventName.value = '';
      el.newEventDate.value = '';
      el.eventStatusMsg.textContent = '';
      await loadEvents();
      el.eventSelect.value = event.id;
      await selectEvent(event.id);
    } catch (err) {
      el.eventStatusMsg.textContent = err.message;
    }
  });

  // ---- 배치도 업로드(전체 배치도) ----
  el.floorplanUploadBtn.addEventListener('click', async () => {
    if (!state.event) return;
    const file = el.floorplanFile.files[0];
    if (!file) {
      el.floorplanStatus.textContent = '이미지 파일을 선택해주세요.';
      return;
    }
    const formData = new FormData();
    formData.append('floorplan', file);
    try {
      const res = await fetch(`/api/events/${state.event.id}/floorplan`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
      state.event = data.event;
      state.zoom = 1;
      applyZoom();
      if (el.mapStage) {
        el.mapStage.scrollLeft = 0;
        el.mapStage.scrollTop = 0;
      }
      el.floorplanStatus.textContent = '배치도가 업로드되었습니다.';
      renderMap();
    } catch (err) {
      el.floorplanStatus.textContent = err.message;
    }
  });

  // ---- 매장정보 엑셀 일괄 등록 ----
  el.importTemplateBtn.addEventListener('click', () => {
    if (!state.event) return;
    window.location.href = `/api/events/${state.event.id}/booths/import-template`;
  });

  el.importUploadBtn.addEventListener('click', async () => {
    if (!state.event) return;
    const file = el.importFile.files[0];
    if (!file) {
      el.importStatus.textContent = '엑셀 파일을 선택해주세요.';
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    el.importStatus.textContent = '업로드 중...';
    try {
      const res = await fetch(`/api/events/${state.event.id}/booths/import`, { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '업로드에 실패했습니다.');
      const parts = [`신규 ${data.created.length}건`, `갱신 ${data.updated.length}건`];
      if (data.skipped.length > 0) parts.push(`건너뜀 ${data.skipped.length}건`);
      el.importStatus.textContent = parts.join(', ');
      el.importFile.value = '';
      state.event = await api(`/api/events/${state.event.id}`);
      renderMap();
      renderBoothList();
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
    applyZoom();
    await loadMe();
    await loadUsers();
    await loadOtSchedule();
    await loadEvents();
  })();
})();
