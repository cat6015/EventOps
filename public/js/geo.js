// GPS 좌표(위도/경도) ↔ 배치도 위치(xPct/yPct, 전체 배치도 기준 0~100) 변환.
// 배치도 위 여러 지점에 실제 GPS 좌표를 찍어 두면(기준점), 그 점들로 변환식을 만든다.
//  1) 전체 기준점에 가장 잘 맞는 1차(아핀) 변환을 최소제곱으로 구한다 — 배치도의 위치/회전/축척/기울어짐.
//  2) 배치도가 실제 축척대로 그려지지 않은 안내도라면 기준점마다 어긋남(잔차)이 남는데, 이 어긋남을
//     가까운 기준점일수록 강하게 반영해(거리 가중) 그 주변을 보정한다. 그래서 기준점을 행사장 곳곳에
//     많이 찍을수록 그 근처의 정확도가 올라가고, 기준점 위치에서는 찍은 좌표와 정확히 일치한다.
(function () {
  const M_PER_DEG_LAT = 110540;
  const M_PER_DEG_LNG_AT_EQUATOR = 111320;

  function solve3(m, v) {
    // 3x3 연립방정식(크래머 공식). 특이 행렬이면 null.
    const det = (a) =>
      a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
      a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
      a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
    const d = det(m);
    if (Math.abs(d) < 1e-9) return null;
    return [0, 1, 2].map((col) => {
      const mm = m.map((row, i) => row.map((val, j) => (j === col ? v[i] : val)));
      return det(mm) / d;
    });
  }

  // points: [{ xPct, yPct, lat, lng }] — 3개 이상이고 한 줄로 늘어서지 않아야 한다.
  function buildTransform(points) {
    const pts = (points || []).filter(
      (p) => [p.xPct, p.yPct, p.lat, p.lng].every((v) => typeof v === 'number' && Number.isFinite(v))
    );
    if (pts.length < 3) return null;

    const lat0 = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
    const lng0 = pts.reduce((s, p) => s + p.lng, 0) / pts.length;
    const mPerDegLng = M_PER_DEG_LNG_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
    // 기준점 부근을 평면으로 보고 동쪽(E)/북쪽(N) 미터 좌표로 바꾼다(행사장 규모에서는 오차 무시 가능).
    const toLocal = (lat, lng) => [(lng - lng0) * mPerDegLng, (lat - lat0) * M_PER_DEG_LAT];
    const local = pts.map((p) => toLocal(p.lat, p.lng));

    // 최소제곱: [E N 1]·(a,b,c) = x,  [E N 1]·(d,e,f) = y
    const ata = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const atx = [0, 0, 0];
    const aty = [0, 0, 0];
    local.forEach(([E, N], i) => {
      const row = [E, N, 1];
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) ata[r][c] += row[r] * row[c];
        atx[r] += row[r] * pts[i].xPct;
        aty[r] += row[r] * pts[i].yPct;
      }
    });
    const cx = solve3(ata, atx);
    const cy = solve3(ata, aty);
    if (!cx || !cy) return null; // 기준점이 한 줄로 늘어서 있으면 방향을 정할 수 없다
    const [a, b, c] = cx;
    const [d, e, f] = cy;
    const affine = (E, N) => [a * E + b * N + c, d * E + e * N + f];
    const detA = a * e - b * d;
    if (Math.abs(detA) < 1e-12) return null;

    // 기준점별 어긋남(잔차): 배치도 % 단위와, 이를 실제 거리(m)로 환산한 값.
    const residuals = local.map(([E, N], i) => {
      const [fx, fy] = affine(E, N);
      const rx = pts[i].xPct - fx;
      const ry = pts[i].yPct - fy;
      // 아핀 선형부의 역행렬로 % 차이를 미터 차이로 되돌린다.
      const dE = (e * rx - b * ry) / detA;
      const dN = (-d * rx + a * ry) / detA;
      return { rx, ry, meters: Math.hypot(dE, dN) };
    });

    // 거리 가중 보정의 영향 범위: 기준점 사이 평균 최근접 거리. 기준점에서 이보다 멀어질수록
    // 보정이 약해져 1차 변환 결과로 돌아간다.
    const nearest = local.map(([E, N], i) =>
      Math.min(...local.filter((_, j) => j !== i).map(([E2, N2]) => Math.hypot(E - E2, N - N2)))
    );
    const influence = Math.max(5, nearest.reduce((s, v) => s + v, 0) / nearest.length);

    function toPct(lat, lng) {
      const [E, N] = toLocal(lat, lng);
      let [x, y] = affine(E, N);
      let wSum = 1 / (influence * influence); // "보정 없음" 쪽 가중치(멀리 가면 이게 우세)
      let cxSum = 0;
      let cySum = 0;
      for (let i = 0; i < local.length; i++) {
        const dist = Math.hypot(E - local[i][0], N - local[i][1]);
        if (dist < 0.01) return { xPct: pts[i].xPct, yPct: pts[i].yPct };
        const w = 1 / (dist * dist);
        wSum += w;
        cxSum += w * residuals[i].rx;
        cySum += w * residuals[i].ry;
      }
      x += cxSum / wSum;
      y += cySum / wSum;
      return { xPct: x, yPct: y };
    }

    return {
      toPct,
      residuals,
      // 1m가 배치도에서 대략 몇 %인지(가로/세로) — GPS 오차 범위 원을 그릴 때 쓴다.
      pctPerMeter: { x: Math.hypot(a, b), y: Math.hypot(d, e) },
    };
  }

  // "35.1234, 128.9876" 처럼 구글 지도에서 복사한 문자열을 { lat, lng }로. 형식이 틀리면 null.
  function parseLatLng(text) {
    const m = /(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/.exec(String(text || '').trim());
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
    return { lat, lng };
  }

  const api = { buildTransform, parseLatLng };
  if (typeof window !== 'undefined') window.GeoRef = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
