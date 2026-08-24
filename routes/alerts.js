const express = require('express');
const crypto = require('crypto');
const store = require('../store');
const { ISSUE_TYPES, issueLabel, RESOLUTION_TYPES, resolutionLabel } = require('../constants');
const { broadcastToEvent } = require('../socket');

const router = express.Router();

router.get('/issue-types', (req, res) => {
  res.json(ISSUE_TYPES);
});

router.get('/resolution-types', (req, res) => {
  res.json(RESOLUTION_TYPES);
});

router.get('/events/:id/alerts', (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { status } = req.query;
  res.json(store.getAlertsForEvent(event.id, { status }));
});

router.post('/events/:id/alerts', (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const { boothId, issueType, note } = req.body || {};
  const booth = event.booths.find((b) => b.id === boothId);
  if (!booth) return res.status(400).json({ error: '부스를 찾을 수 없습니다.' });
  if (!ISSUE_TYPES.some((t) => t.id === issueType)) {
    return res.status(400).json({ error: '이슈 유형이 올바르지 않습니다.' });
  }
  if (store.hasOpenAlert(event.id, boothId, issueType)) {
    return res.status(409).json({ error: '이미 같은 유형의 처리되지 않은 A/S가 있습니다.' });
  }

  const alert = store.createAlert({
    id: crypto.randomUUID(),
    eventId: event.id,
    boothId: booth.id,
    boothNumber: booth.number,
    issueType,
    issueLabel: issueLabel(issueType),
    note: note && String(note).trim() ? String(note).trim() : null,
    status: 'open',
    createdBy: req.session.user.username,
    createdByName: req.session.user.displayName,
    createdAt: new Date().toISOString(),
    resolvedBy: null,
    resolvedByName: null,
    resolvedAt: null,
  });

  broadcastToEvent(event.id, 'alert:created', { alert });
  res.json({ ok: true, alert });
});

router.post('/events/:id/alerts/:alertId/resolve', (req, res) => {
  const event = store.getEvent(req.params.id);
  if (!event) return res.status(404).json({ error: '행사를 찾을 수 없습니다.' });

  const alert = store.findAlert(req.params.alertId);
  if (!alert || alert.eventId !== event.id) {
    return res.status(404).json({ error: '알림을 찾을 수 없습니다.' });
  }
  if (alert.status === 'resolved') {
    return res.status(400).json({ error: '이미 처리완료된 알림입니다.' });
  }

  const { resolutionType, note } = req.body || {};
  if (resolutionType !== undefined && resolutionType !== null && !RESOLUTION_TYPES.some((t) => t.id === resolutionType)) {
    return res.status(400).json({ error: '처리내용 유형이 올바르지 않습니다.' });
  }

  const resolved = store.resolveAlert(alert.id, {
    resolvedBy: req.session.user.username,
    resolvedByName: req.session.user.displayName,
    resolutionType: resolutionType || null,
    resolutionLabel: resolutionType ? resolutionLabel(resolutionType) : null,
    resolvedNote: note && String(note).trim() ? String(note).trim() : null,
  });

  broadcastToEvent(event.id, 'alert:resolved', {
    alertId: resolved.id,
    boothId: resolved.boothId,
    resolvedBy: resolved.resolvedBy,
    resolvedByName: resolved.resolvedByName,
    resolvedAt: resolved.resolvedAt,
    resolutionType: resolved.resolutionType,
    resolutionLabel: resolved.resolutionLabel,
    resolvedNote: resolved.resolvedNote,
  });
  res.json({ ok: true, alert: resolved });
});

module.exports = router;
