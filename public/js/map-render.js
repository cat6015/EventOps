// 지도 화면(map.js)과 편집기(editor.js)가 함께 쓰는 SVG 오버레이 렌더러.
// viewBox를 "0 0 100 100"으로 고정하고 부스 좌표를 xPct/yPct(0~100) 그대로
// SVG 좌표로 쓰기 때문에, 컨테이너 크기가 바뀌어도 별도 계산 없이 반응형으로 맞는다.
const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function clearSvg(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

// 구역 상세 배치도가 아직 없어 전체 배치도를 잘라 미리보기로 보여줄 때, 선택한 구역
// rect 딱 그 안쪽만 보이면 주변 맥락을 알기 어려우므로 위아래/좌우로 이 비율만큼
// 더 넓게(원본 이미지 범위를 벗어나지 않는 선에서) 보여준다.
const ZONE_CROP_PADDING = 0.2;

function expandRectForPreview(rect) {
  const padW = rect.wPct * ZONE_CROP_PADDING;
  const padH = rect.hPct * ZONE_CROP_PADDING;
  const xPct = Math.max(0, rect.xPct - padW);
  const yPct = Math.max(0, rect.yPct - padH);
  const rightPct = Math.min(100, rect.xPct + rect.wPct + padW);
  const bottomPct = Math.min(100, rect.yPct + rect.hPct + padH);
  return { xPct, yPct, wPct: rightPct - xPct, hPct: bottomPct - yPct };
}

function renderEntranceMarker(svg, entrance) {
  if (!entrance) return null;
  const g = svgEl('g', { class: 'entrance-marker', transform: `translate(${entrance.xPct}, ${entrance.yPct})` });
  g.appendChild(svgEl('circle', { r: 2.6 }));
  const text = svgEl('text', { y: 0.1 });
  text.textContent = '입구';
  g.appendChild(text);
  svg.appendChild(g);
  return g;
}

const DEFAULT_BOOTH_W = 6;
const DEFAULT_BOOTH_H = 6;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 부스 크기가 작아져도 테두리가 번호 표시 공간을 다 잡아먹지 않도록,
// 테두리 두께/모서리 반경/글자 크기를 부스 크기(작은 변 기준)에 비례해 함께 줄인다.
// 기본 크기(6)에서는 기존 고정값(0.4, 0.8, 2.3)과 동일하게 계산되도록 계수를 맞췄다.
function boothMarkerMetrics(w, h) {
  const size = Math.min(w, h);
  return {
    strokeWidth: clamp(size * 0.067, 0.06, 0.4),
    ringStrokeWidth: clamp(size * 0.083, 0.08, 0.5),
    rx: clamp(size * 0.133, 0.15, 0.8),
    fontSize: clamp(size * 0.383, 0.9, 2.3),
  };
}

function renderBoothMarker(svg, booth, { editable = false } = {}) {
  const w = booth.wPct || DEFAULT_BOOTH_W;
  const h = booth.hPct || DEFAULT_BOOTH_H;
  const { strokeWidth, ringStrokeWidth, rx, fontSize } = boothMarkerMetrics(w, h);
  const g = svgEl('g', {
    class: editable ? 'booth-marker editor-mode' : 'booth-marker',
    'data-booth-id': booth.id,
    transform: `translate(${booth.xPct}, ${booth.yPct})`,
  });
  g.appendChild(
    svgEl('rect', { class: 'ring', x: -w / 2, y: -h / 2, width: w, height: h, rx, 'stroke-width': ringStrokeWidth })
  );
  g.appendChild(
    svgEl('rect', { class: 'box', x: -w / 2, y: -h / 2, width: w, height: h, rx, 'stroke-width': strokeWidth })
  );
  const text = svgEl('text', { y: 0.1, 'font-size': fontSize });
  text.textContent = booth.number;
  g.appendChild(text);
  svg.appendChild(g);
  return g;
}

// event = { entrance, booths } 형태의 행사 상세 데이터.
// 반환값: boothId -> <g> 엘리먼트 맵 (알림 표시/드래그 등에 재사용).
function renderBase(svg, event, { editable = false } = {}) {
  clearSvg(svg);
  const markers = new Map();
  renderEntranceMarker(svg, event.entrance);
  for (const booth of event.booths) {
    markers.set(booth.id, renderBoothMarker(svg, booth, { editable }));
  }
  return markers;
}

// 구역 rect가 아주 작아 실제 비율로 계산한 크기가 너무 작아지는 경우를 대비한 최소 크기(클릭 가능하도록).
const OVERVIEW_ZONE_BOOTH_MIN_SIZE = 1;

// 구역에 속한 부스가 전체 배치도에서 차지할 크기를 계산한다. 부스의 실제 크기(그 구역
// 상세 배치도 기준 wPct/hPct)에 구역이 전체 배치도에서 차지하는 비율(zone.rect)을 곱해
// 물리적 크기와 비슷하게 보이도록 하되, 너무 작아지면 최소 크기로 보정한다.
function overviewBoothSize(booth, zone) {
  const rawW = booth.wPct || DEFAULT_BOOTH_W;
  const rawH = booth.hPct || DEFAULT_BOOTH_H;
  if (!zone || !zone.rect) {
    return { wPct: OVERVIEW_ZONE_BOOTH_MIN_SIZE, hPct: OVERVIEW_ZONE_BOOTH_MIN_SIZE };
  }
  const wPct = Math.max(rawW * (zone.rect.wPct / 100), OVERVIEW_ZONE_BOOTH_MIN_SIZE);
  const hPct = Math.max(rawH * (zone.rect.hPct / 100), OVERVIEW_ZONE_BOOTH_MIN_SIZE);
  return { wPct, hPct };
}

function renderZoneHotspot(svg, zone) {
  const { xPct, yPct, wPct, hPct } = zone.rect;
  const g = svgEl('g', { class: 'zone-hotspot', 'data-zone-id': zone.id });
  g.appendChild(svgEl('rect', { x: xPct, y: yPct, width: wPct, height: hPct, rx: 1 }));
  const text = svgEl('text', { x: xPct + wPct / 2, y: yPct + hPct / 2 });
  text.textContent = zone.name;
  g.appendChild(text);
  svg.appendChild(g);
  return g;
}

// 구역이 있는 행사의 전체 배치도: 구역 영역(hotspot, 클릭하면 상세 배치도로 이동)을
// 바닥에 깔고 그 위에 모든 부스를 표시한다. 구역에 속한 부스는 실제 크기(그 구역 상세
// 배치도 기준)를 구역이 차지하는 비율만큼 환산해 물리적 크기와 비슷하게 보여준다.
// 반환값: { boothMarkers, zoneMarkers } (각각 id -> <g> 엘리먼트 맵)
function renderOverview(svg, event, { editable = false } = {}) {
  clearSvg(svg);
  const zoneMarkers = new Map();
  const zoneById = new Map();
  for (const zone of event.zones || []) {
    zoneById.set(zone.id, zone);
    if (!zone.rect) continue;
    zoneMarkers.set(zone.id, renderZoneHotspot(svg, zone));
  }
  renderEntranceMarker(svg, event.entrance);
  const boothMarkers = new Map();
  for (const booth of event.booths) {
    const sized = booth.zoneId
      ? { ...booth, ...overviewBoothSize(booth, zoneById.get(booth.zoneId)) }
      : booth;
    boothMarkers.set(booth.id, renderBoothMarker(svg, sized, { editable }));
  }
  return { boothMarkers, zoneMarkers };
}

function setBoothMarkerPosition(markerEl, xPct, yPct) {
  markerEl.setAttribute('transform', `translate(${xPct}, ${yPct})`);
}

function setBoothMarkerSize(markerEl, wPct, hPct) {
  const { strokeWidth, ringStrokeWidth, rx, fontSize } = boothMarkerMetrics(wPct, hPct);
  const ring = markerEl.querySelector('rect.ring');
  const box = markerEl.querySelector('rect.box');
  const text = markerEl.querySelector('text');
  if (ring) {
    ring.setAttribute('x', -wPct / 2);
    ring.setAttribute('y', -hPct / 2);
    ring.setAttribute('width', wPct);
    ring.setAttribute('height', hPct);
    ring.setAttribute('rx', rx);
    ring.setAttribute('stroke-width', ringStrokeWidth);
  }
  if (box) {
    box.setAttribute('x', -wPct / 2);
    box.setAttribute('y', -hPct / 2);
    box.setAttribute('width', wPct);
    box.setAttribute('height', hPct);
    box.setAttribute('rx', rx);
    box.setAttribute('stroke-width', strokeWidth);
  }
  if (text) text.setAttribute('font-size', fontSize);
}

function setBoothMarkerSelected(markerEl, selected) {
  markerEl.classList.toggle('selected', !!selected);
}

function setBoothAlertState(markerEl, isAlert) {
  markerEl.classList.toggle('marker--alert', isAlert);
}

// 부스 설치/온보딩 진행 상태를 마커 색으로 표시한다(installStatus: null | 'onboarding_needed' | 'installed').
function setBoothInstallState(markerEl, installStatus) {
  markerEl.classList.toggle('marker--onboarding', installStatus === 'onboarding_needed');
  markerEl.classList.toggle('marker--installed', installStatus === 'installed');
}

function routeLineId(boothId) {
  return `route-${boothId}`;
}

function drawRouteLine(svg, entrance, booth) {
  if (!entrance) return;
  removeRouteLine(svg, booth.id);
  const line = svgEl('line', {
    id: routeLineId(booth.id),
    class: 'route-line',
    x1: entrance.xPct,
    y1: entrance.yPct,
    x2: booth.xPct,
    y2: booth.yPct,
  });
  svg.insertBefore(line, svg.firstChild);
}

function removeRouteLine(svg, boothId) {
  const existing = svg.querySelector(`#${CSS.escape(routeLineId(boothId))}`);
  if (existing) existing.remove();
}

// 마우스/터치 좌표를 배치도 컨테이너 기준 0~100 퍼센트 좌표로 변환.
function pointToPct(containerEl, clientX, clientY) {
  const rect = containerEl.getBoundingClientRect();
  const xPct = ((clientX - rect.left) / rect.width) * 100;
  const yPct = ((clientY - rect.top) / rect.height) * 100;
  return {
    xPct: Math.min(100, Math.max(0, xPct)),
    yPct: Math.min(100, Math.max(0, yPct)),
  };
}

window.MapRender = {
  overviewBoothSize,
  expandRectForPreview,
  renderBase,
  renderOverview,
  renderEntranceMarker,
  renderBoothMarker,
  renderZoneHotspot,
  setBoothMarkerPosition,
  setBoothMarkerSize,
  setBoothMarkerSelected,
  setBoothAlertState,
  setBoothInstallState,
  drawRouteLine,
  removeRouteLine,
  pointToPct,
  clearSvg,
};
