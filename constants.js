const ISSUE_TYPES = [
  { id: 'malfunction', label: '고장' },
  { id: 'payment', label: '결제불가' },
  { id: 'connection', label: '연결끊김' },
  { id: 'other', label: '기타' },
];

const RESOLUTION_TYPES = [
  { id: 'repaired', label: '수리완료' },
  { id: 'replaced', label: '교체완료' },
  { id: 'restarted', label: '재부팅/재설정으로 해결' },
  { id: 'guided', label: '고객 안내로 조치' },
  { id: 'other', label: '기타' },
];

function issueLabel(issueType) {
  const found = ISSUE_TYPES.find((t) => t.id === issueType);
  return found ? found.label : issueType;
}

function resolutionLabel(resolutionType) {
  const found = RESOLUTION_TYPES.find((t) => t.id === resolutionType);
  return found ? found.label : resolutionType;
}

module.exports = { ISSUE_TYPES, issueLabel, RESOLUTION_TYPES, resolutionLabel };
