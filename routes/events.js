const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const ExcelJS = require('exceljs');
const store = require('../store');
const { requireAdmin } = require('../middleware');
const { broadcastToEvent } = require('../socket');

const router = express.Router();

const MAX_IMAGE_MB = Number(process.env.MAX_IMAGE_MB) || 20;

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.xlsx' && ext !== '.xls') {
      return cb(new Error('엑셀 파일(.xlsx, .xls)만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});

const BOOTH_IMPORT_HEADERS = ['부스번호', '매장명', '사업자번호', '고유번호', '온보딩용핸드폰번호', 'VAN'];

function cellText(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map((rt) => rt.text).join('');
    if (v.text !== undefined) return String(v.text).trim();
    if (v.result !== undefined) return String(v.result).trim();
    return '';
  }
  return String(v).trim();
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, store.UPLOADS_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('이미지 파일(png, jpg, jpeg, webp, gif)만 업로드할 수 있습니다.'));
    }
    cb(null, true);
  },
});

function fixKoreanFilename(name) {
  return Buffer.from(name, 'latin1').toString('utf8');
}

router.get('/events', (req, res) => {
  res.json(store.listEventSummaries());
});

// OT 계산기(editor.html)가 저장한 근무 일정을 읽어온다. 지도 화면(map.html)의 "지금 근무 중" 표시에도
// 쓰이므로 로그인한 사용자라면 누구나 조회할 수 있게 열어둔다(쓰기는 routes/admin.js에서 관리자만).
router.get('/ot-schedule', (req, res) => {
  res.json(store.getOtSchedule());
});

router.get('/events/:id', (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
  res.json(event);
});

router.post('/events', requireAdmin, (req, res) => {
  const { name, date } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '행사 이름을 입력해주세요.' });
  }
  const event = store.createEvent({
    id: crypto.randomUUID(),
    name: name.trim(),
    date: date || null,
    createdBy: req.session.user.username,
  });
  res.json({ ok: true, event });
});

router.patch('/events/:id', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { name, date, status } = req.body || {};
  if (status !== undefined && status !== 'active' && status !== 'archived') {
    return res.status(400).json({ error: '상태 값이 올바르지 않습니다.' });
  }
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: '행사 이름을 입력해주세요.' });
  }

  const updated = store.updateEventMeta(req.params.id, {
    name: name !== undefined ? name.trim() : undefined,
    date,
    status,
  });
  res.json({ ok: true, event: updated });
});

router.delete('/events/:id', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  if (store.eventHasOpenAlert(event.id)) {
    return res.status(400).json({ error: '처리되지 않은 A/S가 있는 행사는 삭제할 수 없습니다. 먼저 모두 처리완료해주세요.' });
  }

  store.removeEvent(event.id);
  res.json({ ok: true });
});

// 일반 지도 화면에 처음 들어왔을 때 자동으로 선택될 "기본 행사"로 지정한다.
router.post('/events/:id/default', requireAdmin, (req, res) => {
  const updated = store.setDefaultEvent(req.params.id);
  if (!updated) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
  res.json({ ok: true, event: updated });
});

router.post('/events/:id/floorplan', requireAdmin, (req, res) => {
  upload.single('floorplan')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const event = store.getEvent(req.params.id);
    if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ error: '이미지 파일을 선택해주세요.' });

    const originalName = fixKoreanFilename(req.file.originalname);
    const updated = store.setEventFloorplan(req.params.id, {
      floorplanImagePath: req.file.filename,
      floorplanOriginalName: originalName,
    });
    res.json({ ok: true, event: updated });
  });
});

router.put('/events/:id/entrance', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { xPct, yPct } = req.body || {};
  if (typeof xPct !== 'number' || typeof yPct !== 'number') {
    return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
  }

  const updated = store.setEntrance(req.params.id, { xPct, yPct });
  res.json({ ok: true, event: updated });
});

function isValidSize(v) {
  return v === undefined || (typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 100);
}

function isValidRect(rect) {
  if (!rect || typeof rect !== 'object') return false;
  const { xPct, yPct, wPct, hPct } = rect;
  return (
    [xPct, yPct, wPct, hPct].every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    wPct > 0 &&
    hPct > 0 &&
    xPct >= 0 &&
    yPct >= 0 &&
    xPct + wPct <= 100.001 &&
    yPct + hPct <= 100.001
  );
}

// 규모가 큰 행사에서 전체 배치도를 여러 구역으로 나누고, 구역마다 별도의 상세 배치도를
// 두기 위한 구역(zone) 관리 엔드포인트. rect는 전체 배치도 위에서 그 구역이 차지하는
// 영역(드래그로 지정)이며, 구역에 속한 부스의 위치는 이 rect를 기준으로 자동 환산된다.
router.post('/events/:id/zones', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { name, rect } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: '구역 이름을 입력해주세요.' });
  }
  if (!isValidRect(rect)) {
    return res.status(400).json({ error: '구역 영역 값이 올바르지 않습니다.' });
  }

  const zone = store.addZone(event.id, { id: crypto.randomUUID(), name: String(name).trim(), rect });
  res.json({ ok: true, zone });
});

router.patch('/events/:id/zones/:zoneId', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
  if (!event.zones.some((z) => z.id === req.params.zoneId)) {
    return res.status(404).json({ error: '구역을 찾을 수 없습니다.' });
  }

  const { name, rect } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: '구역 이름을 입력해주세요.' });
  }
  if (rect !== undefined && !isValidRect(rect)) {
    return res.status(400).json({ error: '구역 영역 값이 올바르지 않습니다.' });
  }

  const zone = store.updateZone(event.id, req.params.zoneId, {
    name: name !== undefined ? String(name).trim() : undefined,
    rect,
  });
  const refreshed = store.getEvent(event.id);
  const booths = refreshed.booths.filter((b) => b.zoneId === req.params.zoneId);
  res.json({ ok: true, zone, booths });
});

router.post('/events/:id/zones/:zoneId/floorplan', requireAdmin, (req, res) => {
  upload.single('floorplan')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const event = store.getEvent(req.params.id);
    if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
    if (!event.zones.some((z) => z.id === req.params.zoneId)) {
      return res.status(404).json({ error: '구역을 찾을 수 없습니다.' });
    }
    if (!req.file) return res.status(400).json({ error: '이미지 파일을 선택해주세요.' });

    const originalName = fixKoreanFilename(req.file.originalname);
    const zone = store.setZoneFloorplan(event.id, req.params.zoneId, {
      floorplanImagePath: req.file.filename,
      floorplanOriginalName: originalName,
    });
    res.json({ ok: true, zone });
  });
});

router.delete('/events/:id/zones/:zoneId', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
  if (!event.zones.some((z) => z.id === req.params.zoneId)) {
    return res.status(404).json({ error: '구역을 찾을 수 없습니다.' });
  }
  try {
    store.removeZone(event.id, req.params.zoneId);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/events/:id/booths', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { number, xPct, yPct, wPct, hPct, zoneId, storeName, businessNumber, corpNumber, onboardingContact, van } =
    req.body || {};
  if (!number || !String(number).trim()) {
    return res.status(400).json({ error: '부스 번호를 입력해주세요.' });
  }
  if (typeof xPct !== 'number' || typeof yPct !== 'number') {
    return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
  }
  if (!isValidSize(wPct) || !isValidSize(hPct)) {
    return res.status(400).json({ error: '부스 크기 값이 올바르지 않습니다.' });
  }
  if (zoneId && !event.zones.some((z) => z.id === zoneId)) {
    return res.status(400).json({ error: '구역을 찾을 수 없습니다.' });
  }
  if (event.booths.some((b) => b.number === String(number).trim())) {
    return res.status(400).json({ error: '이미 같은 번호의 부스가 있습니다.' });
  }

  const booth = store.addBooth(event.id, {
    id: crypto.randomUUID(),
    number: String(number).trim(),
    xPct,
    yPct,
    wPct,
    hPct,
    zoneId: zoneId || null,
    storeName: storeName !== undefined ? String(storeName).trim() : undefined,
    businessNumber: businessNumber !== undefined ? String(businessNumber).trim() : undefined,
    corpNumber: corpNumber !== undefined ? String(corpNumber).trim() : undefined,
    onboardingContact: onboardingContact !== undefined ? String(onboardingContact).trim() : undefined,
    van: van !== undefined ? String(van).trim() : undefined,
  });
  res.json({ ok: true, booth });
});

// 부스 자동 추가: 배치도 위에 드래그로 지정한 영역을 행x열 격자로 나눠 한 번에 생성한다.
// zoneId가 있으면 xPct/yPct는 그 구역 상세 배치도 기준 좌표로 취급된다.
router.post('/events/:id/booths/bulk', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { booths, zoneId } = req.body || {};
  if (!Array.isArray(booths) || booths.length === 0) {
    return res.status(400).json({ error: '생성할 부스 목록이 비어 있습니다.' });
  }
  if (booths.length > 500) {
    return res.status(400).json({ error: '한 번에 생성할 수 있는 부스 수를 초과했습니다.' });
  }
  if (zoneId && !event.zones.some((z) => z.id === zoneId)) {
    return res.status(400).json({ error: '구역을 찾을 수 없습니다.' });
  }

  const requestNumbers = new Set();
  for (const b of booths) {
    if (!b || !b.number || !String(b.number).trim()) {
      return res.status(400).json({ error: '부스 번호가 비어 있는 항목이 있습니다.' });
    }
    const trimmed = String(b.number).trim();
    if (requestNumbers.has(trimmed)) {
      return res.status(400).json({ error: `요청 안에 번호가 중복되었습니다: ${trimmed}` });
    }
    requestNumbers.add(trimmed);
    if (typeof b.xPct !== 'number' || typeof b.yPct !== 'number') {
      return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
    }
    if (!isValidSize(b.wPct) || !isValidSize(b.hPct)) {
      return res.status(400).json({ error: '부스 크기 값이 올바르지 않습니다.' });
    }
  }

  try {
    const created = store.addBoothsBulk(
      event.id,
      booths.map((b) => ({ number: String(b.number).trim(), xPct: b.xPct, yPct: b.yPct, wPct: b.wPct, hPct: b.hPct })),
      zoneId || null
    );
    res.json({ ok: true, booths: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 다중 선택한 부스를 한 번에 이동/크기 변경한다.
router.patch('/events/:id/booths/bulk', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: '변경할 부스 목록이 비어 있습니다.' });
  }
  for (const item of items) {
    if (!item || !item.id) {
      return res.status(400).json({ error: '부스 id가 없는 항목이 있습니다.' });
    }
    if (!event.booths.some((b) => b.id === item.id)) {
      return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });
    }
    if (item.xPct !== undefined && typeof item.xPct !== 'number') {
      return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
    }
    if (item.yPct !== undefined && typeof item.yPct !== 'number') {
      return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
    }
    if (!isValidSize(item.wPct) || !isValidSize(item.hPct)) {
      return res.status(400).json({ error: '부스 크기 값이 올바르지 않습니다.' });
    }
  }

  try {
    const updated = store.updateBoothsBulk(
      event.id,
      items.map((i) => ({ id: i.id, xPct: i.xPct, yPct: i.yPct, wPct: i.wPct, hPct: i.hPct }))
    );
    res.json({ ok: true, booths: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 전체 배치도에서 부스를 드래그해 옮겼을 때 호출한다. 새 위치가 어떤 구역 영역 안이면
// 그 구역에 편입(또는 유지)하고, 밖이면 구역에서 뺀다(zoneId를 null로 보내면 구역 이탈).
// xPct/yPct는 전체 배치도 좌표다.
router.patch('/events/:id/booths/:boothId/zone', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const booth = event.booths.find((b) => b.id === req.params.boothId);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });

  const { zoneId, xPct, yPct } = req.body || {};
  if (zoneId !== null && zoneId !== undefined && !event.zones.some((z) => z.id === zoneId)) {
    return res.status(400).json({ error: '구역을 찾을 수 없습니다.' });
  }
  if (typeof xPct !== 'number' || typeof yPct !== 'number') {
    return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
  }

  try {
    const updated = store.moveBoothOnOverview(event.id, booth.id, xPct, yPct, zoneId || null);
    res.json({ ok: true, booth: updated });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// "설치시작": 선택한 부스들을 한 번에 '온보딩 필요' 상태로 표시한다.
router.post('/events/:id/booths/install-start', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { boothIds } = req.body || {};
  if (!Array.isArray(boothIds) || boothIds.length === 0) {
    return res.status(400).json({ error: '설치를 시작할 부스를 선택해주세요.' });
  }
  const validIds = boothIds.filter((id) => event.booths.some((b) => b.id === id));
  if (validIds.length === 0) {
    return res.status(400).json({ error: '선택한 부스를 찾을 수 없습니다.' });
  }

  const updated = store.startInstallation(event.id, validIds);
  broadcastToEvent(event.id, 'booths:install-updated', { booths: updated });
  res.json({ ok: true, booths: updated });
});

// 부스 담당자가 현장에서 "온보딩완료"를 선택하면 그 부스를 '설치완료'로 표시한다.
// (관리자 전용이 아니라, 로그인한 담당자 누구나 자기가 맡은 부스를 처리할 수 있어야 한다.)
router.patch('/events/:id/booths/:boothId/install-status', (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const booth = event.booths.find((b) => b.id === req.params.boothId);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });

  const { installStatus } = req.body || {};
  if (installStatus !== null && !store.INSTALL_STATUSES.includes(installStatus)) {
    return res.status(400).json({ error: '설치 상태 값이 올바르지 않습니다.' });
  }

  const updated = store.setBoothInstallStatus(event.id, booth.id, installStatus);
  broadcastToEvent(event.id, 'booths:install-updated', { booths: [updated] });
  res.json({ ok: true, booth: updated });
});

router.patch('/events/:id/booths/:boothId', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const booth = event.booths.find((b) => b.id === req.params.boothId);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });

  const { number, xPct, yPct, wPct, hPct, storeName, businessNumber, corpNumber, onboardingContact, van } =
    req.body || {};
  if (number !== undefined) {
    const trimmed = String(number).trim();
    if (!trimmed) return res.status(400).json({ error: '부스 번호를 입력해주세요.' });
    if (event.booths.some((b) => b.id !== booth.id && b.number === trimmed)) {
      return res.status(400).json({ error: '이미 같은 번호의 부스가 있습니다.' });
    }
  }
  if (xPct !== undefined && typeof xPct !== 'number') {
    return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
  }
  if (yPct !== undefined && typeof yPct !== 'number') {
    return res.status(400).json({ error: '좌표 값이 올바르지 않습니다.' });
  }
  if (!isValidSize(wPct) || !isValidSize(hPct)) {
    return res.status(400).json({ error: '부스 크기 값이 올바르지 않습니다.' });
  }

  const updated = store.updateBooth(event.id, booth.id, {
    number: number !== undefined ? String(number).trim() : undefined,
    xPct,
    yPct,
    wPct,
    hPct,
    storeName: storeName !== undefined ? String(storeName).trim() : undefined,
    businessNumber: businessNumber !== undefined ? String(businessNumber).trim() : undefined,
    corpNumber: corpNumber !== undefined ? String(corpNumber).trim() : undefined,
    onboardingContact: onboardingContact !== undefined ? String(onboardingContact).trim() : undefined,
    van: van !== undefined ? String(van).trim() : undefined,
  });
  res.json({ ok: true, booth: updated });
});

router.delete('/events/:id/booths/:boothId', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const booth = event.booths.find((b) => b.id === req.params.boothId);
  if (!booth) return res.status(404).json({ error: '부스를 찾을 수 없습니다.' });

  if (store.boothHasOpenAlert(event.id, booth.id)) {
    return res.status(400).json({ error: '처리되지 않은 A/S가 있는 부스는 삭제할 수 없습니다. 먼저 처리완료 처리해주세요.' });
  }

  store.removeBooth(event.id, booth.id);
  res.json({ ok: true });
});

// 매장정보 엑셀 일괄 등록용 양식 다운로드.
router.get('/events/:id/booths/import-template', requireAdmin, async (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('부스정보');
  sheet.addRow(BOOTH_IMPORT_HEADERS);
  sheet.addRow(['A-101', '예시매장', '123-45-67890', '123456-1234567', '01012345678', 'KIS정보통신']);
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((col) => {
    col.width = 20;
  });
  // 전화번호/사업자번호 등은 엑셀이 숫자로 잘못 인식해 앞자리 0이 사라지지 않도록 텍스트 서식으로 지정.
  ['B', 'C', 'D', 'E', 'F'].forEach((letter) => {
    sheet.getColumn(letter).numFmt = '@';
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="booth-import-template.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// 매장정보 엑셀 일괄 등록: 부스번호로 매칭해 매장명/사업자번호/고유번호/온보딩용핸드폰번호/VAN을 채워 넣는다.
// 매칭되는 부스가 없으면 위치 미지정 상태로 새 부스를 만든다(관리자 화면에서 위치를 드래그해 배치하면 됨).
router.post('/events/:id/booths/import', requireAdmin, (req, res) => {
  importUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    const event = store.getEvent(req.params.id);
    if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
    if (!req.file) return res.status(400).json({ error: '엑셀 파일을 선택해주세요.' });

    let workbook;
    try {
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(req.file.buffer);
    } catch (e) {
      return res.status(400).json({ error: '엑셀 파일을 읽을 수 없습니다. 양식을 다시 확인해주세요.' });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) return res.status(400).json({ error: '엑셀 파일 안에 시트가 없습니다.' });

    const created = [];
    const updated = [];
    const skipped = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // 헤더 행
      const number = cellText(row.getCell(1));
      if (!number) return; // 완전히 빈 행은 건너뜀

      const storeName = cellText(row.getCell(2));
      const businessNumber = cellText(row.getCell(3));
      const corpNumber = cellText(row.getCell(4));
      const onboardingContact = cellText(row.getCell(5));
      const van = cellText(row.getCell(6));

      try {
        const { booth, created: isNew } = store.upsertBoothByNumber(event.id, {
          number,
          storeName: storeName || undefined,
          businessNumber: businessNumber || undefined,
          corpNumber: corpNumber || undefined,
          onboardingContact: onboardingContact || undefined,
          van: van || undefined,
        });
        (isNew ? created : updated).push(booth.number);
      } catch (e) {
        skipped.push({ row: rowNumber, number, reason: e.message });
      }
    });

    res.json({ ok: true, created, updated, skipped });
  });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 날짜(+구역)별 담당자 배정. zoneId를 비워두면 행사 전체(또는 소규모 행사) 공통 담당자로 취급된다.
router.post('/events/:id/assignments', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { date, zoneId, username, phone, note } = req.body || {};
  if (!date || !DATE_RE.test(date)) {
    return res.status(400).json({ error: '날짜(YYYY-MM-DD)를 선택해주세요.' });
  }
  if (!username) {
    return res.status(400).json({ error: '담당자 계정을 선택해주세요.' });
  }
  const user = store.findUser(username);
  if (!user) {
    return res.status(400).json({ error: '존재하지 않는 계정입니다.' });
  }
  if (zoneId && !event.zones.some((z) => z.id === zoneId)) {
    return res.status(400).json({ error: '구역을 찾을 수 없습니다.' });
  }

  const assignment = store.addAssignment(event.id, {
    id: crypto.randomUUID(),
    date,
    zoneId: zoneId || null,
    username: user.username,
    displayName: user.displayName,
    phone: phone || null,
    note: note || null,
  });
  res.json({ ok: true, assignment });
});

router.delete('/events/:id/assignments/:assignmentId', requireAdmin, (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });
  if (!event.assignments.some((a) => a.id === req.params.assignmentId)) {
    return res.status(404).json({ error: '배정 내역을 찾을 수 없습니다.' });
  }
  store.removeAssignment(event.id, req.params.assignmentId);
  res.json({ ok: true });
});

module.exports = router;
