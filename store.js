const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const STORAGE_DIR = process.env.STORAGE_DIR || __dirname;
const DATA_DIR = path.join(STORAGE_DIR, 'data');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads', 'floorplans');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const EVENTS_FILE = path.join(DATA_DIR, 'events.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');

// 부스 사각형 기본 크기(%, 배치도 기준). 부스별로 개별/일괄 조정 가능.
const DEFAULT_BOOTH_WIDTH_PCT = 6;
const DEFAULT_BOOTH_HEIGHT_PCT = 6;

function ensureFile(filePath, initial) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(initial, null, 2));
  }
}

function init() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  ensureFile(USERS_FILE, []);
  ensureFile(EVENTS_FILE, []);
  ensureFile(ALERTS_FILE, []);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

// ---- users ----
function getUsers() {
  return readJson(USERS_FILE);
}

function findUser(username) {
  return getUsers().find((u) => u.username === username);
}

function addUser(user) {
  const users = getUsers();
  if (users.some((u) => u.username === user.username)) {
    throw new Error(`이미 존재하는 계정입니다: ${user.username}`);
  }
  users.push(user);
  writeJson(USERS_FILE, users);
  return user;
}

function removeUser(username) {
  const users = getUsers();
  const idx = users.findIndex((u) => u.username === username);
  if (idx === -1) return null;
  const [removed] = users.splice(idx, 1);
  writeJson(USERS_FILE, users);
  return removed;
}

function setUserRole(username, role) {
  const users = getUsers();
  const user = users.find((u) => u.username === username);
  if (!user) return null;
  user.role = role;
  writeJson(USERS_FILE, users);
  return user;
}

// oct-portal(field-file-portal)에서 내려받은 users.json 형태 그대로 붙여넣어
// 계정을 일괄 등록한다. passwordHash는 재해싱하지 않고 그대로 저장하므로
// 기존 비밀번호 그대로 로그인할 수 있다. 이미 있는 username은 건너뛴다.
function importUsers(rawUsers) {
  const users = getUsers();
  const existing = new Set(users.map((u) => u.username));
  const imported = [];
  const skipped = [];

  for (const raw of rawUsers) {
    if (!raw || !raw.username || !raw.passwordHash) {
      skipped.push({ username: raw && raw.username, reason: '필드 누락' });
      continue;
    }
    if (existing.has(raw.username)) {
      skipped.push({ username: raw.username, reason: '이미 존재' });
      continue;
    }
    const user = {
      username: raw.username,
      passwordHash: raw.passwordHash,
      displayName: raw.displayName || raw.username,
      role: raw.role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    existing.add(user.username);
    imported.push(user.username);
  }

  writeJson(USERS_FILE, users);
  return { imported, skipped };
}

// ADMIN_USERNAME/ADMIN_PASSWORD 환경변수가 설정돼 있고 아직 관리자 계정이 없으면
// 최초 1회 자동으로 관리자 계정을 만든다.
async function ensureBootstrapAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;

  if (findUser(username)) return;
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD는 8자 이상이어야 합니다. 부트스트랩 관리자 생성을 건너뜁니다.');
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  addUser({
    username,
    passwordHash,
    displayName: process.env.ADMIN_DISPLAY_NAME || username,
    role: 'admin',
    createdAt: new Date().toISOString(),
  });
  console.log(`부트스트랩 관리자 계정이 생성되었습니다: ${username}`);
}

// ---- events ----
function getEvents() {
  return readJson(EVENTS_FILE);
}

function listEventSummaries() {
  return getEvents().map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    status: e.status,
    isDefault: !!e.isDefault,
    hasFloorplan: !!e.floorplanImagePath,
    boothCount: e.booths.length,
  }));
}

// 지도 화면에 처음 접속했을 때 자동으로 보여줄 "기본 행사"를 지정한다(한 번에 하나만).
function setDefaultEvent(id) {
  const events = getEvents();
  if (!events.some((e) => e.id === id)) return null;
  for (const e of events) e.isDefault = e.id === id;
  writeJson(EVENTS_FILE, events);
  return events.find((e) => e.id === id);
}

// 오래된 데이터 파일에는 zones/assignments, 부스의 zoneId 등 필드가 없을 수 있어
// 읽을 때마다 기본값을 채워 넣는다(저장은 실제 쓰기 작업이 일어날 때 자연히 반영됨).
function withDefaults(event) {
  if (!event) return event;
  if (event.isDefault === undefined) event.isDefault = false;
  if (!Array.isArray(event.zones)) event.zones = [];
  if (!Array.isArray(event.assignments)) event.assignments = [];
  for (const b of event.booths) {
    if (b.zoneId === undefined) b.zoneId = null;
    if (b.zoneXPct === undefined) b.zoneXPct = null;
    if (b.zoneYPct === undefined) b.zoneYPct = null;
    if (b.wPct === undefined || b.wPct === null) b.wPct = DEFAULT_BOOTH_WIDTH_PCT;
    if (b.hPct === undefined || b.hPct === null) b.hPct = DEFAULT_BOOTH_HEIGHT_PCT;
    if (b.storeName === undefined) b.storeName = null;
    if (b.van === undefined) b.van = null;
    if (b.installStatus === undefined) b.installStatus = null;
  }
  return event;
}

const INSTALL_STATUSES = ['onboarding_needed', 'installed'];

function getEvent(id) {
  return withDefaults(getEvents().find((e) => e.id === id));
}

function createEvent({ id, name, date, createdBy }) {
  const events = getEvents();
  const now = new Date().toISOString();
  const event = {
    id,
    name,
    date,
    status: 'active',
    isDefault: false,
    floorplanImagePath: null,
    floorplanOriginalName: null,
    entrance: null,
    zones: [],
    booths: [],
    assignments: [],
    createdAt: now,
    createdBy,
    updatedAt: now,
  };
  events.push(event);
  writeJson(EVENTS_FILE, events);
  return event;
}

// 구역 상세 배치도 위 좌표(zoneXPct/zoneYPct, 0~100)를 구역이 전체 배치도에서
// 차지하는 영역(zone.rect)에 비례 매핑해 전체 배치도 위 좌표를 계산한다.
function computeOverviewFromZone(zone, zoneXPct, zoneYPct) {
  if (!zone || !zone.rect || zoneXPct === null || zoneXPct === undefined || zoneYPct === null || zoneYPct === undefined) {
    return { xPct: zoneXPct, yPct: zoneYPct };
  }
  return {
    xPct: zone.rect.xPct + (zoneXPct / 100) * zone.rect.wPct,
    yPct: zone.rect.yPct + (zoneYPct / 100) * zone.rect.hPct,
  };
}

// ---- zones(구역) ----
function addZone(eventId, { id, name, rect }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const now = new Date().toISOString();
  const zone = {
    id,
    name,
    floorplanImagePath: null,
    floorplanOriginalName: null,
    rect: rect || null,
    createdAt: now,
    updatedAt: now,
  };
  event.zones.push(zone);
  saveEvent(event);
  return zone;
}

// rect(구역이 전체 배치도에서 차지하는 영역)를 바꾸면, 그 구역에 속한 모든 부스의
// 전체 배치도 위 좌표(xPct/yPct)를 새 rect 기준으로 다시 계산해준다.
function updateZone(eventId, zoneId, { name, rect }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const zone = event.zones.find((z) => z.id === zoneId);
  if (!zone) return null;
  if (name !== undefined) zone.name = name;
  if (rect !== undefined) {
    zone.rect = rect;
    for (const booth of event.booths) {
      if (booth.zoneId !== zoneId) continue;
      const computed = computeOverviewFromZone(zone, booth.zoneXPct, booth.zoneYPct);
      booth.xPct = computed.xPct;
      booth.yPct = computed.yPct;
      booth.updatedAt = new Date().toISOString();
    }
  }
  zone.updatedAt = new Date().toISOString();
  saveEvent(event);
  return zone;
}

function setZoneFloorplan(eventId, zoneId, { floorplanImagePath, floorplanOriginalName }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const zone = event.zones.find((z) => z.id === zoneId);
  if (!zone) return null;
  zone.floorplanImagePath = floorplanImagePath;
  zone.floorplanOriginalName = floorplanOriginalName;
  zone.updatedAt = new Date().toISOString();
  saveEvent(event);
  return zone;
}

function removeZone(eventId, zoneId) {
  const event = getEvent(eventId);
  if (!event) return null;
  if (event.booths.some((b) => b.zoneId === zoneId)) {
    throw new Error('구역에 속한 부스가 있으면 삭제할 수 없습니다. 먼저 부스를 삭제하거나 다른 구역으로 옮겨주세요.');
  }
  const idx = event.zones.findIndex((z) => z.id === zoneId);
  if (idx === -1) return null;
  const [removed] = event.zones.splice(idx, 1);
  event.assignments = event.assignments.filter((a) => a.zoneId !== zoneId);
  saveEvent(event);
  return removed;
}

function saveEvent(event) {
  const events = getEvents();
  const idx = events.findIndex((e) => e.id === event.id);
  if (idx === -1) return null;
  event.updatedAt = new Date().toISOString();
  events[idx] = event;
  writeJson(EVENTS_FILE, events);
  return event;
}

function updateEventMeta(id, { name, date, status }) {
  const event = getEvent(id);
  if (!event) return null;
  if (name !== undefined) event.name = name;
  if (date !== undefined) event.date = date;
  if (status !== undefined) event.status = status;
  return saveEvent(event);
}

// 행사를 삭제하면 부스/구역/배정 등 그 행사 안의 데이터는 통째로 사라지고,
// 그 행사에 걸려 있던 A/S 알림 기록도 함께 정리한다.
function removeEvent(id) {
  const events = getEvents();
  const idx = events.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const [removed] = events.splice(idx, 1);
  writeJson(EVENTS_FILE, events);
  const alerts = getAlerts().filter((a) => a.eventId !== id);
  writeJson(ALERTS_FILE, alerts);
  return removed;
}

function setEventFloorplan(id, { floorplanImagePath, floorplanOriginalName }) {
  const event = getEvent(id);
  if (!event) return null;
  event.floorplanImagePath = floorplanImagePath;
  event.floorplanOriginalName = floorplanOriginalName;
  return saveEvent(event);
}

function setEntrance(id, { xPct, yPct }) {
  const event = getEvent(id);
  if (!event) return null;
  event.entrance = { xPct, yPct };
  return saveEvent(event);
}

// zoneId가 있으면 xPct/yPct는 "그 구역 상세 배치도 위" 좌표(zoneXPct/zoneYPct)로 저장하고,
// 전체 배치도 위 좌표(xPct/yPct)는 구역의 rect를 이용해 자동으로 계산한다.
// zoneId가 없으면(일반 소규모 행사) 기존처럼 xPct/yPct를 전체 배치도 좌표로 그대로 쓴다.
function addBooth(eventId, { id, number, xPct, yPct, wPct, hPct, zoneId, storeName, businessNumber, corpNumber, onboardingContact, van }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const now = new Date().toISOString();

  let overviewX = xPct === undefined ? null : xPct;
  let overviewY = yPct === undefined ? null : yPct;
  let zoneXPct = null;
  let zoneYPct = null;
  if (zoneId) {
    const zone = event.zones.find((z) => z.id === zoneId);
    zoneXPct = xPct === undefined ? null : xPct;
    zoneYPct = yPct === undefined ? null : yPct;
    const computed = computeOverviewFromZone(zone, zoneXPct, zoneYPct);
    overviewX = computed.xPct;
    overviewY = computed.yPct;
  }

  const booth = {
    id,
    number,
    zoneId: zoneId || null,
    xPct: overviewX,
    yPct: overviewY,
    zoneXPct,
    zoneYPct,
    wPct: wPct === undefined || wPct === null ? DEFAULT_BOOTH_WIDTH_PCT : wPct,
    hPct: hPct === undefined || hPct === null ? DEFAULT_BOOTH_HEIGHT_PCT : hPct,
    // 이 크기 값이 "현재 zoneId 기준으로 이미 올바른 배치도 비율"임을 나타낸다.
    // 구역에 직접 만든 부스는 처음부터 그 구역 기준 값을 입력받으므로 true.
    sizeNormalized: !!zoneId,
    storeName: storeName || null,
    businessNumber: businessNumber || null,
    corpNumber: corpNumber || null,
    onboardingContact: onboardingContact || null,
    van: van || null,
    createdAt: now,
    updatedAt: now,
  };
  event.booths.push(booth);
  saveEvent(event);
  return booth;
}

// 배치도 위 영역을 행x열로 나눠 부스를 한 번에 여러 개 생성한다(부스 자동 추가).
// zoneId가 있으면 boothsInput의 xPct/yPct는 그 구역 상세 배치도 기준 좌표로 취급한다.
// 번호가 기존 부스 또는 요청 안에서 중복되면 아무것도 저장하지 않고 에러를 던진다.
function addBoothsBulk(eventId, boothsInput, zoneId) {
  const event = getEvent(eventId);
  if (!event) return null;
  const zone = zoneId ? event.zones.find((z) => z.id === zoneId) : null;
  if (zoneId && !zone) throw new Error('구역을 찾을 수 없습니다.');

  const existingNumbers = new Set(event.booths.map((b) => b.number));
  const seen = new Set();
  const now = new Date().toISOString();
  const created = [];

  for (const input of boothsInput) {
    const number = String(input.number).trim();
    if (existingNumbers.has(number) || seen.has(number)) {
      throw new Error(`이미 사용 중인 부스 번호가 있습니다: ${number}`);
    }
    seen.add(number);

    let overviewX = input.xPct;
    let overviewY = input.yPct;
    let zoneXPct = null;
    let zoneYPct = null;
    if (zoneId) {
      zoneXPct = input.xPct;
      zoneYPct = input.yPct;
      const computed = computeOverviewFromZone(zone, zoneXPct, zoneYPct);
      overviewX = computed.xPct;
      overviewY = computed.yPct;
    }

    created.push({
      id: crypto.randomUUID(),
      number,
      zoneId: zoneId || null,
      xPct: overviewX,
      yPct: overviewY,
      zoneXPct,
      zoneYPct,
      wPct: input.wPct === undefined || input.wPct === null ? DEFAULT_BOOTH_WIDTH_PCT : input.wPct,
      hPct: input.hPct === undefined || input.hPct === null ? DEFAULT_BOOTH_HEIGHT_PCT : input.hPct,
      sizeNormalized: !!zoneId,
      businessNumber: null,
      corpNumber: null,
      onboardingContact: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  event.booths.push(...created);
  saveEvent(event);
  return created;
}

// 부스 "설치/온보딩" 진행 상태: null(시작 전) -> 'onboarding_needed'(온보딩 필요) -> 'installed'(설치완료).
// 선택한 부스들을 한 번에 '온보딩 필요' 상태로 표시한다("설치시작" 버튼).
function startInstallation(eventId, boothIds) {
  const event = getEvent(eventId);
  if (!event) return null;
  const idSet = new Set(boothIds);
  const updated = [];
  const now = new Date().toISOString();
  for (const booth of event.booths) {
    if (!idSet.has(booth.id)) continue;
    booth.installStatus = 'onboarding_needed';
    booth.updatedAt = now;
    updated.push(booth);
  }
  saveEvent(event);
  return updated;
}

// 부스 하나의 설치 상태를 바꾼다(예: "온보딩완료" 선택 -> '설치완료'로 저장).
function setBoothInstallStatus(eventId, boothId, installStatus) {
  const event = getEvent(eventId);
  if (!event) return null;
  const booth = event.booths.find((b) => b.id === boothId);
  if (!booth) return null;
  booth.installStatus = installStatus;
  booth.updatedAt = new Date().toISOString();
  saveEvent(event);
  return booth;
}

// 부스가 구역에 속해 있으면(booth.zoneId) 넘어온 xPct/yPct를 구역 상세 배치도 좌표로 보고
// zoneXPct/zoneYPct에 저장한 뒤, 전체 배치도 좌표(xPct/yPct)를 구역 rect 기준으로 재계산한다.
function updateBooth(eventId, boothId, { number, xPct, yPct, wPct, hPct, storeName, businessNumber, corpNumber, onboardingContact, van }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const booth = event.booths.find((b) => b.id === boothId);
  if (!booth) return null;
  if (number !== undefined) booth.number = number;
  if (xPct !== undefined || yPct !== undefined) {
    if (booth.zoneId) {
      const zone = event.zones.find((z) => z.id === booth.zoneId);
      if (xPct !== undefined) booth.zoneXPct = xPct;
      if (yPct !== undefined) booth.zoneYPct = yPct;
      const computed = computeOverviewFromZone(zone, booth.zoneXPct, booth.zoneYPct);
      booth.xPct = computed.xPct;
      booth.yPct = computed.yPct;
    } else {
      if (xPct !== undefined) booth.xPct = xPct;
      if (yPct !== undefined) booth.yPct = yPct;
    }
  }
  if (wPct !== undefined) booth.wPct = wPct;
  if (hPct !== undefined) booth.hPct = hPct;
  // 사람이 직접 크기를 입력했으므로, 지금 속한 구역(또는 전체 배치도) 기준으로 정상인 값으로 간주한다.
  if (wPct !== undefined || hPct !== undefined) booth.sizeNormalized = true;
  if (storeName !== undefined) booth.storeName = storeName || null;
  if (businessNumber !== undefined) booth.businessNumber = businessNumber || null;
  if (corpNumber !== undefined) booth.corpNumber = corpNumber || null;
  if (onboardingContact !== undefined) booth.onboardingContact = onboardingContact || null;
  if (van !== undefined) booth.van = van || null;
  booth.updatedAt = new Date().toISOString();
  saveEvent(event);
  return booth;
}

// 다중 선택한 부스를 한 번에 이동/크기 변경(일괄 변경)한다.
// items: [{ id, xPct?, yPct?, wPct?, hPct? }, ...] — 각 부스가 구역에 속해 있으면
// xPct/yPct는 그 구역 상세 배치도 좌표로 취급하고 전체 배치도 좌표는 자동 재계산한다.
function updateBoothsBulk(eventId, items) {
  const event = getEvent(eventId);
  if (!event) return null;
  const updated = [];
  for (const item of items) {
    const booth = event.booths.find((b) => b.id === item.id);
    if (!booth) throw new Error(`부스를 찾을 수 없습니다: ${item.id}`);
    if (item.xPct !== undefined || item.yPct !== undefined) {
      if (booth.zoneId) {
        const zone = event.zones.find((z) => z.id === booth.zoneId);
        if (item.xPct !== undefined) booth.zoneXPct = item.xPct;
        if (item.yPct !== undefined) booth.zoneYPct = item.yPct;
        const computed = computeOverviewFromZone(zone, booth.zoneXPct, booth.zoneYPct);
        booth.xPct = computed.xPct;
        booth.yPct = computed.yPct;
      } else {
        if (item.xPct !== undefined) booth.xPct = item.xPct;
        if (item.yPct !== undefined) booth.yPct = item.yPct;
      }
    }
    if (item.wPct !== undefined) booth.wPct = item.wPct;
    if (item.hPct !== undefined) booth.hPct = item.hPct;
    if (item.wPct !== undefined || item.hPct !== undefined) booth.sizeNormalized = true;
    booth.updatedAt = new Date().toISOString();
    updated.push(booth);
  }
  saveEvent(event);
  return updated;
}

function clampPct(v) {
  return Math.min(100, Math.max(0.1, v));
}

// 전체 배치도 위에서 부스를 드래그해 옮겼을 때 호출한다. 새 위치가 어떤 구역의 영역(rect)
// 안이면 그 구역에 편입(또는 유지)하고, 밖이면 구역에서 뺀다(newZoneId는 null 가능).
// xPct/yPct는 항상 전체 배치도 좌표로 그대로 저장하고, 구역에 속하면 rect를 기준으로
// 역산해 zoneXPct/zoneYPct(그 구역 상세 배치도 위 좌표)도 함께 계산한다.
// 구역이 실제로 바뀐 경우(편입/이탈/다른 구역으로 이동)에만 wPct/hPct를 옛 배치도 대비
// 새 배치도 비율로 다시 환산해, 물리적 크기가 급격히 달라 보이지 않게 한다
// (같은 구역 안에서 위치만 옮길 때는 크기를 건드리지 않는다).
function moveBoothOnOverview(eventId, boothId, xPct, yPct, newZoneId) {
  const event = getEvent(eventId);
  if (!event) return null;
  const booth = event.booths.find((b) => b.id === boothId);
  if (!booth) return null;

  const oldZoneId = booth.zoneId || null;
  const targetZoneId = newZoneId || null;
  const oldZone = oldZoneId ? event.zones.find((z) => z.id === oldZoneId) : null;
  const newZone = targetZoneId ? event.zones.find((z) => z.id === targetZoneId) : null;
  if (targetZoneId && !newZone) throw new Error('구역을 찾을 수 없습니다.');

  if (oldZoneId !== targetZoneId) {
    const oldScaleW = oldZone && oldZone.rect ? oldZone.rect.wPct / 100 : 1;
    const oldScaleH = oldZone && oldZone.rect ? oldZone.rect.hPct / 100 : 1;
    const newScaleW = newZone && newZone.rect ? newZone.rect.wPct / 100 : 1;
    const newScaleH = newZone && newZone.rect ? newZone.rect.hPct / 100 : 1;
    booth.wPct = clampPct((booth.wPct * oldScaleW) / newScaleW);
    booth.hPct = clampPct((booth.hPct * oldScaleH) / newScaleH);
  }

  booth.zoneId = targetZoneId;
  booth.xPct = xPct;
  booth.yPct = yPct;
  if (newZone && newZone.rect && newZone.rect.wPct > 0 && newZone.rect.hPct > 0) {
    booth.zoneXPct = ((xPct - newZone.rect.xPct) / newZone.rect.wPct) * 100;
    booth.zoneYPct = ((yPct - newZone.rect.yPct) / newZone.rect.hPct) * 100;
  } else {
    booth.zoneXPct = null;
    booth.zoneYPct = null;
  }
  booth.sizeNormalized = true;
  booth.updatedAt = new Date().toISOString();
  saveEvent(event);
  return booth;
}

// 엑셀 일괄 등록: 부스 번호로 매칭해 매장정보(매장명/사업자번호/고유번호/온보딩연락처/VAN)를 채워 넣는다.
// 같은 번호의 부스가 이미 있으면 정보만 갱신(위치는 그대로), 없으면 위치 미지정 상태로 새로 만든다.
function upsertBoothByNumber(eventId, { number, storeName, businessNumber, corpNumber, onboardingContact, van }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const existing = event.booths.find((b) => b.number === number);
  if (existing) {
    if (storeName !== undefined) existing.storeName = storeName || null;
    if (businessNumber !== undefined) existing.businessNumber = businessNumber || null;
    if (corpNumber !== undefined) existing.corpNumber = corpNumber || null;
    if (onboardingContact !== undefined) existing.onboardingContact = onboardingContact || null;
    if (van !== undefined) existing.van = van || null;
    existing.updatedAt = new Date().toISOString();
    saveEvent(event);
    return { booth: existing, created: false };
  }
  const now = new Date().toISOString();
  const booth = {
    id: crypto.randomUUID(),
    number,
    zoneId: null,
    xPct: null,
    yPct: null,
    zoneXPct: null,
    zoneYPct: null,
    wPct: DEFAULT_BOOTH_WIDTH_PCT,
    hPct: DEFAULT_BOOTH_HEIGHT_PCT,
    storeName: storeName || null,
    businessNumber: businessNumber || null,
    corpNumber: corpNumber || null,
    onboardingContact: onboardingContact || null,
    van: van || null,
    createdAt: now,
    updatedAt: now,
  };
  event.booths.push(booth);
  saveEvent(event);
  return { booth, created: true };
}

function removeBooth(eventId, boothId) {
  const event = getEvent(eventId);
  if (!event) return null;
  const idx = event.booths.findIndex((b) => b.id === boothId);
  if (idx === -1) return null;
  const [removed] = event.booths.splice(idx, 1);
  saveEvent(event);
  return removed;
}

// ---- assignments(날짜/구역별 담당자) ----
// zoneId가 null이면 행사 전체(또는 소규모 행사) 공통 담당자를 의미한다.
function addAssignment(eventId, { id, date, zoneId, username, displayName, phone, note }) {
  const event = getEvent(eventId);
  if (!event) return null;
  const assignment = {
    id,
    date,
    zoneId: zoneId || null,
    username,
    displayName: displayName || username,
    phone: phone || null,
    note: note || null,
    createdAt: new Date().toISOString(),
  };
  event.assignments.push(assignment);
  saveEvent(event);
  return assignment;
}

function removeAssignment(eventId, assignmentId) {
  const event = getEvent(eventId);
  if (!event) return null;
  const idx = event.assignments.findIndex((a) => a.id === assignmentId);
  if (idx === -1) return null;
  const [removed] = event.assignments.splice(idx, 1);
  saveEvent(event);
  return removed;
}

// ---- alerts ----
function getAlerts() {
  return readJson(ALERTS_FILE);
}

function getAlertsForEvent(eventId, { status } = {}) {
  let alerts = getAlerts().filter((a) => a.eventId === eventId);
  if (status) alerts = alerts.filter((a) => a.status === status);
  return alerts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function findAlert(id) {
  return getAlerts().find((a) => a.id === id);
}

function hasOpenAlert(eventId, boothId, issueType) {
  return getAlerts().some(
    (a) => a.eventId === eventId && a.boothId === boothId && a.issueType === issueType && a.status === 'open'
  );
}

function eventHasOpenAlert(eventId) {
  return getAlerts().some((a) => a.eventId === eventId && a.status === 'open');
}

function boothHasOpenAlert(eventId, boothId) {
  return getAlerts().some((a) => a.eventId === eventId && a.boothId === boothId && a.status === 'open');
}

function createAlert(alert) {
  const alerts = getAlerts();
  alerts.push(alert);
  writeJson(ALERTS_FILE, alerts);
  return alert;
}

function resolveAlert(id, { resolvedBy, resolvedByName, resolutionType, resolutionLabel, resolvedNote }) {
  const alerts = getAlerts();
  const alert = alerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.status = 'resolved';
  alert.resolvedBy = resolvedBy;
  alert.resolvedByName = resolvedByName;
  alert.resolvedAt = new Date().toISOString();
  alert.resolutionType = resolutionType || null;
  alert.resolutionLabel = resolutionLabel || null;
  alert.resolvedNote = resolvedNote || null;
  writeJson(ALERTS_FILE, alerts);
  return alert;
}

const CONTACT_RETENTION_DAYS = 7;

// 행사일(event.date) 기준 7일이 지나면 부스의 온보딩 연락처만 삭제한다
// (사업자번호/고유번호는 유지 — 개인 연락처만 개인정보 최소보유 원칙에 따라 파기).
function purgeExpiredOnboardingContacts() {
  const events = getEvents();
  const now = Date.now();
  let changed = false;
  const purgedEvents = [];

  for (const event of events) {
    if (!event.date) continue;
    const eventDate = new Date(event.date);
    if (Number.isNaN(eventDate.getTime())) continue;
    const deadline = eventDate.getTime() + CONTACT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    if (now < deadline) continue;

    let eventChanged = false;
    for (const booth of event.booths) {
      if (booth.onboardingContact !== null && booth.onboardingContact !== undefined) {
        booth.onboardingContact = null;
        eventChanged = true;
      }
    }
    if (eventChanged) {
      event.updatedAt = new Date().toISOString();
      changed = true;
      purgedEvents.push(event.id);
    }
  }

  if (changed) writeJson(EVENTS_FILE, events);
  return purgedEvents;
}

module.exports = {
  init,
  UPLOADS_DIR,
  purgeExpiredOnboardingContacts,
  // users
  getUsers,
  findUser,
  addUser,
  removeUser,
  setUserRole,
  importUsers,
  ensureBootstrapAdmin,
  // events
  getEvents,
  listEventSummaries,
  getEvent,
  createEvent,
  updateEventMeta,
  removeEvent,
  setDefaultEvent,
  setEventFloorplan,
  setEntrance,
  addBooth,
  addBoothsBulk,
  startInstallation,
  setBoothInstallStatus,
  INSTALL_STATUSES,
  updateBooth,
  updateBoothsBulk,
  moveBoothOnOverview,
  removeBooth,
  upsertBoothByNumber,
  // zones
  addZone,
  updateZone,
  setZoneFloorplan,
  removeZone,
  // assignments
  addAssignment,
  removeAssignment,
  // alerts
  getAlerts,
  getAlertsForEvent,
  findAlert,
  hasOpenAlert,
  eventHasOpenAlert,
  boothHasOpenAlert,
  createAlert,
  resolveAlert,
};
