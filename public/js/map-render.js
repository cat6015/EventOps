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
  applyUprightText(text, 0, 0);
  return g;
}

const DEFAULT_BOOTH_W = 6;
const DEFAULT_BOOTH_H = 6;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// 부스 크기가 작아져도 테두리가 번호 표시 공간을 다 잡아먹지 않도록,
// 테두리 두께/모서리 반경/글자 크기를 부스 크기(작은 변 기준)에 비례해 함께 줄인다.
function boothMarkerMetrics(w, h) {
  const size = Math.min(w, h);
  return {
    strokeWidth: clamp(size * 0.067, 0.02, 0.4),
    ringStrokeWidth: clamp(size * 0.083, 0.03, 0.5),
    rx: clamp(size * 0.133, 0.03, 0.8),
  };
}

// 부스 번호가 부스 칸 밖으로 넘치지 않도록, 칸의 가로(번호 글자 수 반영)/세로에 모두 들어가는
// 가장 큰 글자 크기를 고른다(너무 큰 부스에서도 과하게 커지지 않게 상한을 둔다).
const BOOTH_FONT_MAX = 3.6;
const BOOTH_FONT_MIN = 0.2;
function fitBoothFontSize(w, h, label) {
  const widthEm = Math.max(textWidthEm(String(label || '')), 0.6) * 1.08; // 굵은 글씨 여유분
  return clamp(Math.min((h * 0.75), (w * 0.85) / widthEm), BOOTH_FONT_MIN, BOOTH_FONT_MAX);
}

// 번호 글자는 회전해도 똑바로 세워 두므로, 회전 후 화면상 "가로로 보이는" 칸 폭/높이에 맞춘다.
// 90°/270°면 가로세로가 뒤바뀌고(화면 비율 k 반영), 그 밖의 각도는 두 경우 중 작은 쪽으로 잡는다.
function uprightBoothBox(w, h, deg, k) {
  const m = deg % 180;
  const swapped = { w: h / k, h: w * k };
  if (Math.abs(m) < 1 || Math.abs(m - 180) < 1) return { w, h };
  if (Math.abs(m - 90) < 1) return swapped;
  return { w: Math.min(w, swapped.w), h: Math.min(h, swapped.h) };
}

function updateBoothFontSize(markerEl, deg, k) {
  const text = markerEl.querySelector('text');
  if (!text) return;
  const w = Number(markerEl.dataset.w) || DEFAULT_BOOTH_W;
  const h = Number(markerEl.dataset.h) || DEFAULT_BOOTH_H;
  const box = deg ? uprightBoothBox(w, h, deg, k) : { w, h };
  text.setAttribute('font-size', fitBoothFontSize(box.w, box.h, text.textContent));
}

// 오버레이는 preserveAspectRatio="none"이라 가로/세로 단위 길이가 화면에서 서로 다르다.
// 그냥 rotate()하면 배치도가 정사각형이 아닐 때 부스가 찌그러져 보이므로, 화면 비율(k)로
// 가로를 늘린 공간에서 회전한 뒤 다시 되돌려 "화면 기준"으로 반듯하게 회전시킨다.
// 비율은 CSS 레이아웃 크기로 잰다(지도 보기 회전/확대 transform의 영향을 받지 않도록).
function overlayAspect(svg) {
  if (!svg) return 1;
  if (svg.clientWidth > 0 && svg.clientHeight > 0) return svg.clientWidth / svg.clientHeight;
  const r = svg.getBoundingClientRect();
  return r.width > 0 && r.height > 0 ? r.width / r.height : 1;
}

function rotationTransform(k, deg) {
  return `scale(${1 / k}, 1) rotate(${deg}) scale(${k}, 1)`;
}

// 지도 화면(map.js)에서 배치도 전체를 돌려 보는 각도(0/90/180/270). 글자들은 이만큼 반대로
// 돌려서 지도를 돌려도 항상 똑바로 읽히게 한다. 편집기는 쓰지 않으므로 항상 0이다.
let viewRotation = 0;
function setViewRotation(deg) {
  viewRotation = normalizeRotation(deg);
}

function isSideways(deg) {
  return Math.abs((normalizeRotation(deg) % 180) - 90) < 1;
}

// 글자(text)를 (cx, cy)를 중심으로 extraDeg + 지도 보기 회전만큼 반대로 돌려 화면에서 똑바로 세운다.
function applyUprightText(text, extraDeg, cx, cy, k) {
  const total = normalizeRotation(extraDeg + viewRotation);
  if (!total) {
    text.removeAttribute('transform');
    return;
  }
  const kk = k || overlayAspect(text.ownerSVGElement);
  const rot = rotationTransform(kk, -total);
  text.setAttribute('transform', cx || cy ? `translate(${cx}, ${cy}) ${rot} translate(${-cx}, ${-cy})` : rot);
}

function applyBoothTransform(markerEl) {
  const x = markerEl.dataset.x;
  const y = markerEl.dataset.y;
  const deg = Number(markerEl.dataset.rotation) || 0;
  const text = markerEl.querySelector('text');
  if (!deg && !viewRotation) {
    markerEl.setAttribute('transform', `translate(${x}, ${y})`);
    if (text) text.removeAttribute('transform');
    updateBoothFontSize(markerEl, 0, 1);
    return;
  }
  const k = overlayAspect(markerEl.ownerSVGElement);
  markerEl.setAttribute('transform', deg ? `translate(${x}, ${y}) ${rotationTransform(k, deg)}` : `translate(${x}, ${y})`);
  // 부스 번호는 부스 회전/지도 보기 회전과 상관없이 항상 똑바로 읽히도록 반대로 돌려 둔다.
  updateBoothFontSize(markerEl, deg + viewRotation, k);
  if (text) applyUprightText(text, deg, 0, 0, k);
}

// 화면 크기/비율이 바뀌면(배치도 이미지 로드, 창 크기 변경 등) 회전 보정값과 글자 배치를 다시 계산한다.
function refreshOverlayText(svg) {
  svg.querySelectorAll('.booth-marker').forEach(applyBoothTransform);
  svg.querySelectorAll('.zone-hotspot, .parking-lot').forEach(layoutZoneHotspotLabel);
  svg.querySelectorAll('.entrance-marker text').forEach((t) => applyUprightText(t, 0, 0, 0));
}

const watchedOverlays = new WeakSet();
function watchOverlayAspect(svg) {
  if (!svg || watchedOverlays.has(svg) || typeof ResizeObserver === 'undefined') return;
  watchedOverlays.add(svg);
  new ResizeObserver(() => refreshOverlayText(svg)).observe(svg);
}

function normalizeRotation(deg) {
  const n = Number(deg) || 0;
  return ((n % 360) + 360) % 360;
}

function renderBoothMarker(svg, booth, { editable = false } = {}) {
  const w = booth.wPct || DEFAULT_BOOTH_W;
  const h = booth.hPct || DEFAULT_BOOTH_H;
  const { strokeWidth, ringStrokeWidth, rx } = boothMarkerMetrics(w, h);
  const g = svgEl('g', {
    class: editable ? 'booth-marker editor-mode' : 'booth-marker',
    'data-booth-id': booth.id,
    'data-x': booth.xPct,
    'data-y': booth.yPct,
    'data-w': w,
    'data-h': h,
    transform: `translate(${booth.xPct}, ${booth.yPct})`,
  });
  const rotation = normalizeRotation(booth.rotation);
  if (rotation) g.setAttribute('data-rotation', rotation);
  g.appendChild(
    svgEl('rect', { class: 'ring', x: -w / 2, y: -h / 2, width: w, height: h, rx, 'stroke-width': ringStrokeWidth })
  );
  g.appendChild(
    svgEl('rect', { class: 'box', x: -w / 2, y: -h / 2, width: w, height: h, rx, 'stroke-width': strokeWidth })
  );
  const text = svgEl('text', { y: 0 });
  text.textContent = booth.number;
  g.appendChild(text);
  svg.appendChild(g);
  applyBoothTransform(g);
  if (rotation || viewRotation) watchOverlayAspect(svg);
  return g;
}

// event = { entrance, booths } 형태의 행사 상세 데이터.
// 반환값: boothId -> <g> 엘리먼트 맵 (알림 표시/드래그 등에 재사용).
function renderBase(svg, event, { editable = false } = {}) {
  clearSvg(svg);
  const markers = new Map();
  renderParkingLots(svg, event);
  renderEntranceMarker(svg, event.entrance);
  for (const booth of event.booths) {
    markers.set(booth.id, renderBoothMarker(svg, booth, { editable }));
  }
  return markers;
}

// 구역 rect가 아주 작아 실제 비율로 계산한 크기가 너무 작아지는 경우를 대비한 최소 크기(클릭 가능하도록).
// 이 값이 크면 작은 구역의 부스가 실제보다 부풀려져 전체 배치도에서 서로 겹쳐 보이므로 아주 작게 둔다.
const OVERVIEW_ZONE_BOOTH_MIN_SIZE = 0.15;

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

// 구역마다 구분되도록 순서대로 돌려 쓰는 색상 팔레트.
const ZONE_COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#db2777', '#65a30d', '#ea580c'];

const ZONE_LABEL_MAX_FONT = 2.6;
const ZONE_LABEL_MIN_FONT = 0.8;
const ZONE_LABEL_LINE_HEIGHT = 1.2;
const ZONE_LABEL_PADDING = 0.6;

// SVG <text>는 자동 줄바꿈이 없어서 글자 폭을 어림해 직접 줄을 나눈다.
// 한글 등 전각 문자는 1em, 영문/숫자는 약 0.6em, 공백은 0.3em으로 계산한다.
function charWidthEm(ch) {
  if (ch === ' ') return 0.3;
  return ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6;
}

function textWidthEm(str) {
  let w = 0;
  for (const ch of str) w += charWidthEm(ch);
  return w;
}

// 공백 단위로 먼저 나누고, 한 단어가 한 줄보다 길면 글자 단위로 끊는다.
function wrapLabel(label, maxWidthEm) {
  const lines = [];
  let line = '';
  const pushWord = (word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidthEm(candidate) <= maxWidthEm) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = '';
    if (textWidthEm(word) <= maxWidthEm) {
      line = word;
      return;
    }
    for (const ch of word) {
      if (line && textWidthEm(line + ch) > maxWidthEm) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  };
  for (const word of String(label).split(/\s+/).filter(Boolean)) pushWord(word);
  if (line) lines.push(line);
  return lines;
}

// 이 크기까지는 단어 중간을 끊지 않고 글자 크기를 줄여 맞춰 본다.
const ZONE_LABEL_WORD_KEEP_MIN_FONT = 1.6;

// 구역 rect 안에 이름이 다 들어가도록 줄바꿈하고, 그래도 넘치면 글자 크기를 줄인다.
function layoutZoneLabel(label, wPct, hPct) {
  const availW = Math.max(wPct - ZONE_LABEL_PADDING * 2, 0.5);
  const availH = Math.max(hPct - ZONE_LABEL_PADDING * 2, 0.5);
  const fits = (lines, fontSize) =>
    lines.length * fontSize * ZONE_LABEL_LINE_HEIGHT <= availH &&
    lines.every((l) => textWidthEm(l) * fontSize <= availW);
  const wordsFit = (fontSize) =>
    String(label).split(/\s+/).every((w) => textWidthEm(w) * fontSize <= availW);

  for (let fontSize = ZONE_LABEL_MAX_FONT; fontSize >= ZONE_LABEL_WORD_KEEP_MIN_FONT; fontSize *= 0.9) {
    const lines = wrapLabel(label, availW / fontSize);
    if (wordsFit(fontSize) && fits(lines, fontSize)) return { fontSize, lines };
  }
  let fontSize = ZONE_LABEL_MAX_FONT;
  let lines = wrapLabel(label, availW / fontSize);
  while (fontSize > ZONE_LABEL_MIN_FONT && !fits(lines, fontSize)) {
    fontSize = Math.max(ZONE_LABEL_MIN_FONT, fontSize * 0.9);
    lines = wrapLabel(label, availW / fontSize);
  }
  return { fontSize, lines };
}

function renderZoneHotspot(svg, zone, index = 0) {
  const { xPct, yPct, wPct, hPct } = zone.rect;
  const color = ZONE_COLORS[index % ZONE_COLORS.length];
  const g = svgEl('g', { class: 'zone-hotspot', 'data-zone-id': zone.id, style: `--zone-color: ${color}` });
  g.dataset.name = zone.name || '';
  g.appendChild(svgEl('rect', { x: xPct, y: yPct, width: wPct, height: hPct, rx: 1 }));
  g.appendChild(svgEl('text'));
  svg.appendChild(g);
  layoutZoneHotspotLabel(g);
  if (viewRotation) watchOverlayAspect(svg);
  return g;
}

// 주차장: 구역과 구분되도록 회색 계열 실선 영역 + "P 이름" 표시. 클릭해도 구역처럼
// 화면이 바뀌지 않는다(편집기에서만 눌러서 이름 변경/삭제).
function renderParkingLot(svg, lot) {
  if (!lot || !lot.rect) return null;
  const { xPct, yPct, wPct, hPct } = lot.rect;
  const g = svgEl('g', { class: 'parking-lot', 'data-parking-id': lot.id });
  g.dataset.name = `P ${lot.name || ''}`.trim();
  g.appendChild(svgEl('rect', { x: xPct, y: yPct, width: wPct, height: hPct, rx: 0.6 }));
  g.appendChild(svgEl('text'));
  svg.appendChild(g);
  layoutZoneHotspotLabel(g);
  if (viewRotation) watchOverlayAspect(svg);
  return g;
}

function renderParkingLots(svg, event) {
  const markers = new Map();
  for (const lot of event.parkingLots || []) {
    const g = renderParkingLot(svg, lot);
    if (g) markers.set(lot.id, g);
  }
  return markers;
}

// 구역 이름을 구역 영역 안에 줄바꿈해 배치한다. 지도 보기를 90°/270° 돌리면 화면에서
// 구역의 가로/세로가 뒤바뀌므로, 그 뒤바뀐 폭/높이 기준으로 줄을 나누고 글자를 똑바로 세운다.
function layoutZoneHotspotLabel(g) {
  const rect = g.querySelector('rect');
  const text = g.querySelector('text');
  if (!rect || !text) return;
  const xPct = Number(rect.getAttribute('x'));
  const yPct = Number(rect.getAttribute('y'));
  const wPct = Number(rect.getAttribute('width'));
  const hPct = Number(rect.getAttribute('height'));
  const k = viewRotation ? overlayAspect(g.ownerSVGElement) : 1;
  const box = isSideways(viewRotation) ? { w: hPct / k, h: wPct * k } : { w: wPct, h: hPct };
  const { fontSize, lines } = layoutZoneLabel(g.dataset.name || '', box.w, box.h);
  const lineH = fontSize * ZONE_LABEL_LINE_HEIGHT;
  const cx = xPct + wPct / 2;
  const cy = yPct + hPct / 2;
  const firstY = cy - ((lines.length - 1) * lineH) / 2;
  while (text.firstChild) text.removeChild(text.firstChild);
  text.setAttribute('x', cx);
  text.setAttribute('y', firstY);
  text.setAttribute('font-size', fontSize);
  lines.forEach((l, i) => {
    const tspan = svgEl('tspan', { x: cx, y: firstY + i * lineH });
    tspan.textContent = l;
    text.appendChild(tspan);
  });
  applyUprightText(text, 0, cx, cy, k);
}

// 구역이 있는 행사의 전체 배치도: 구역 영역(hotspot, 클릭하면 상세 배치도로 이동)을
// 바닥에 깔고 그 위에 모든 부스를 표시한다. 구역에 속한 부스는 실제 크기(그 구역 상세
// 배치도 기준)를 구역이 차지하는 비율만큼 환산해 물리적 크기와 비슷하게 보여준다.
// 반환값: { boothMarkers, zoneMarkers } (각각 id -> <g> 엘리먼트 맵)
function renderOverview(svg, event, { editable = false } = {}) {
  clearSvg(svg);
  renderParkingLots(svg, event);
  const zoneMarkers = new Map();
  const zoneById = new Map();
  (event.zones || []).forEach((zone, index) => {
    zoneById.set(zone.id, zone);
    if (!zone.rect) return;
    zoneMarkers.set(zone.id, renderZoneHotspot(svg, zone, index));
  });
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

// 구역에 속한 부스는 "구역명-번호"(예: 로컬-1)로 표시한다. 지도 위 마커는 공간이 좁아 번호만 쓴다.
function boothLabel(booth, zones) {
  if (!booth) return '';
  const zone = booth.zoneId && zones ? zones.find((z) => z.id === booth.zoneId) : null;
  return zone ? `${zone.name}-${booth.number}` : String(booth.number);
}

function setBoothMarkerPosition(markerEl, xPct, yPct) {
  markerEl.dataset.x = xPct;
  markerEl.dataset.y = yPct;
  applyBoothTransform(markerEl);
}

function setBoothMarkerRotation(markerEl, deg) {
  const rotation = normalizeRotation(deg);
  if (rotation) markerEl.dataset.rotation = rotation;
  else delete markerEl.dataset.rotation;
  applyBoothTransform(markerEl);
  if (rotation) watchOverlayAspect(markerEl.ownerSVGElement);
}

function setBoothMarkerSize(markerEl, wPct, hPct) {
  const { strokeWidth, ringStrokeWidth, rx } = boothMarkerMetrics(wPct, hPct);
  markerEl.dataset.w = wPct;
  markerEl.dataset.h = hPct;
  const ring = markerEl.querySelector('rect.ring');
  const box = markerEl.querySelector('rect.box');
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
  applyBoothTransform(markerEl);
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
  boothLabel,
  expandRectForPreview,
  renderBase,
  renderOverview,
  renderEntranceMarker,
  renderBoothMarker,
  renderZoneHotspot,
  renderParkingLot,
  setBoothMarkerPosition,
  setBoothMarkerRotation,
  normalizeRotation,
  setViewRotation,
  setBoothMarkerSize,
  setBoothMarkerSelected,
  setBoothAlertState,
  setBoothInstallState,
  drawRouteLine,
  removeRouteLine,
  pointToPct,
  clearSvg,
};
