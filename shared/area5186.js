/* 면적은 EPSG:5186(GRS80 중부원점 TM) 평면 면적으로(2026-11-13, JBSLAB_작업기준서 결정사항·오류기록 6번)
   - 예전: turf.area(구면 면적, 지구 반지름 6,371,008.8m) → A구역 고시 40,448㎡보다 77.5㎡(0.19%) 크게 나옴
   - 고시·CAD 면적은 측량 좌표(5186) 평면에서 잰 값이므로 같은 방식으로 셈. 변환식은 shared/topo.js tm과 같음(Snyder, proj4와 0.5cm 안)
   - 이 파일을 turf 바로 다음에 불러오면 turf.area가 이 계산으로 바뀜(화면 코드는 그대로 turf.area를 부름).
     한국 밖 좌표(경도 124~132°, 위도 33~39.5° 밖)가 섞이면 예전 turf 계산 그대로
   - node: require('./shared/area5186.js').m2(geojson) */
(function (g) {
  const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), EP2 = E2 / (1 - E2), LAT0 = 38, LON0 = 127, FE = 200000, FN = 600000;
  const rad = d => d * Math.PI / 180;
  const M = p => A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const M0 = M(rad(LAT0));
  function tm(lon, lat) {
    const p = rad(lat), l = rad(lon - LON0), s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
    const N = A / Math.sqrt(1 - E2 * s * s), Tt = t * t, C = EP2 * c * c, Aa = l * c;
    const x = N * (Aa + (1 - Tt + C) * Aa ** 3 / 6 + (5 - 18 * Tt + Tt * Tt + 72 * C - 58 * EP2) * Aa ** 5 / 120);
    const y = M(p) - M0 + N * t * (Aa * Aa / 2 + (5 - Tt + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * Tt + Tt * Tt + 600 * C - 330 * EP2) * Aa ** 6 / 720);
    return [FE + x, FN + y];
  }
  const inKorea = (lon, lat) => lon >= 124 && lon <= 132 && lat >= 33 && lat <= 39.5;
  // 고리 하나의 평면 면적(부호 없이). 한국 밖 점이 있으면 NaN
  function ringArea(r) {
    if (!r || r.length < 3) return 0;
    let s = 0, prev = null, first = null;
    for (const p of r) {
      if (!inKorea(p[0], p[1])) return NaN;
      const q = tm(p[0], p[1]);
      if (prev) s += prev[0] * q[1] - q[0] * prev[1]; else first = q;
      prev = q;
    }
    s += prev[0] * first[1] - first[0] * prev[1];
    return Math.abs(s) / 2;
  }
  const polyArea = rings => rings.reduce((a, r, i) => a + (i ? -1 : 1) * ringArea(r), 0);
  function m2(geo) {
    if (!geo) return 0;
    if (geo.type === 'FeatureCollection') return geo.features.reduce((a, f) => a + m2(f), 0);
    if (geo.type === 'Feature') return m2(geo.geometry);
    if (geo.type === 'GeometryCollection') return geo.geometries.reduce((a, x) => a + m2(x), 0);
    if (geo.type === 'Polygon') return polyArea(geo.coordinates);
    if (geo.type === 'MultiPolygon') return geo.coordinates.reduce((a, c) => a + polyArea(c), 0);
    return 0;
  }
  const api = { m2, tm, CRS: 'EPSG:5186' };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  g.JbsArea = api;
  const t = g.turf;
  if (t && t.area && !t.area.__epsg5186) {
    const orig = t.area;
    const area = function (geo) { const v = m2(geo); return isFinite(v) ? v : orig.apply(this, arguments); };
    area.__epsg5186 = true; area.sphere = orig;
    t.area = area;
  }
})(typeof window !== 'undefined' ? window : globalThis);
