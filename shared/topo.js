/* 고시용 지형도면(2026-11-08, 인계 남은 일 1 — '지적도 위에 구역계·토지이용·정비기반시설·건축한계선, DXF·PDF 내보내기')
   근거(2026-11-08 원문 대조, law.go.kr):
   - 토지이용규제 기본법 제8조, 같은 법 시행령 제7조①(축척 1/500 이상 1/1,500 이하)·⑤(2매 이상이면 1/5,000~1/50,000 총괄도)
   - 지역·지구등의 지형도면 작성에 관한 지침(국토교통부고시 제2026-360호, 2026. 7. 8. 시행)
     제6조②1호 좌표 = 공간정보법 시행령 제7조③ 직각좌표(인천 = 중부원점, GRS80 — EPSG:5186)
     제8조②2호 경계가 지적선 기준이면 연속지적도에 명시해 고시 가능 · 제9조③ 전산파일 SHAPE · 제10조①축척 1/500~1/1,500, ③토지이음 등재 PDF, ④총괄도, ⑤용지 A1(594×841㎜), ⑥표시기준은 개별 법령 도식
   순수 계산(turf 6.5 필요) — 브라우저(window.JbsTopo)와 node(require) 둘 다. 화면은 topo/topo.js */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const T = () => (g.turf || (isNode ? require('@turf/turf') : null));

  /* ---------- 경위도 → 중부원점 TM(EPSG:5186) — Snyder 식, GRS80 ---------- */
  const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), EP2 = E2 / (1 - E2), K0 = 1, LAT0 = 38, LON0 = 127, FE = 200000, FN = 600000;
  const rad = d => d * Math.PI / 180;
  const M = p => A * ((1 - E2 / 4 - 3 * E2 * E2 / 64 - 5 * E2 ** 3 / 256) * p - (3 * E2 / 8 + 3 * E2 * E2 / 32 + 45 * E2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * E2 * E2 / 256 + 45 * E2 ** 3 / 1024) * Math.sin(4 * p) - (35 * E2 ** 3 / 3072) * Math.sin(6 * p));
  const M0 = M(rad(LAT0));
  function tm(lon, lat) {   // → [동(E, 측량 Y), 북(N, 측량 X)] m
    const p = rad(lat), l = rad(lon - LON0), s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
    const N = A / Math.sqrt(1 - E2 * s * s), Tt = t * t, C = EP2 * c * c, Aa = l * c;
    const x = K0 * N * (Aa + (1 - Tt + C) * Aa ** 3 / 6 + (5 - 18 * Tt + Tt * Tt + 72 * C - 58 * EP2) * Aa ** 5 / 120);
    const y = K0 * (M(p) - M0 + N * t * (Aa * Aa / 2 + (5 - Tt + 9 * C + 4 * C * C) * Aa ** 4 / 24 + (61 - 58 * Tt + Tt * Tt + 600 * C - 330 * EP2) * Aa ** 6 / 720));
    return [FE + x, FN + y];
  }
  const PRJ = 'PROJCS["Korea_2000_Korea_Central_Belt_2010",GEOGCS["GCS_Korea_2000",DATUM["D_Korea_2000",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",200000.0],PARAMETER["False_Northing",600000.0],PARAMETER["Central_Meridian",127.0],PARAMETER["Scale_Factor",1.0],PARAMETER["Latitude_Of_Origin",38.0],UNIT["Meter",1.0]]';
  const CRS_NAME = 'GRS80 중부원점(EPSG:5186, 원점 북위 38° 동경 127°, 가산 X 600,000m · Y 200,000m)';

  /* ---------- 도형 도우미 ---------- */
  const close = q => (q.length && (q[0][0] !== q[q.length - 1][0] || q[0][1] !== q[q.length - 1][1]) ? q.concat([q[0]]) : q);
  const areaXY = q => Math.abs(q.reduce((a, p, i) => { const r = q[(i + 1) % q.length]; return a + p[0] * r[1] - r[0] * p[1]; }, 0) / 2);
  const ringsOf = geo => { if (!geo) return []; const gm = geo.geometry || geo; return gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : []; };   // [[outer, hole…]…]
  const projPoly = poly => poly.map(r => close(r).map(p => tm(p[0], p[1])));
  const polyArea = poly => areaXY(poly[0]) - poly.slice(1).reduce((a, h) => a + areaXY(h), 0);
  const centroidOf = q => { let a = 0, x = 0, y = 0; for (let i = 0; i < q.length - 1; i++) { const p = q[i], r = q[i + 1], k = p[0] * r[1] - r[0] * p[1]; a += k; x += (p[0] + r[0]) * k; y += (p[1] + r[1]) * k; } return a ? [x / (3 * a), y / (3 * a)] : q[0]; };
  // 다각형 안의 글자 자리: 무게중심이 밖이면 가로 훑기 중 가장 긴 구간 가운데
  function labelAt(q) {
    const c = centroidOf(q); if (inRing(c, q)) return c;
    const ys = q.map(p => p[1]), y0 = Math.min(...ys), y1 = Math.max(...ys); let best = null;
    for (let k = 1; k < 10; k++) { const y = y0 + (y1 - y0) * k / 10, xs = [];
      for (let i = 0; i < q.length - 1; i++) { const a = q[i], b = q[i + 1]; if ((a[1] - y) * (b[1] - y) < 0) xs.push(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
      xs.sort((a, b) => a - b); for (let j = 0; j + 1 < xs.length; j += 2) { const w = xs[j + 1] - xs[j]; if (!best || w > best.w) best = { w, p: [(xs[j] + xs[j + 1]) / 2, y] }; } }
    return best ? best.p : c;
  }
  function inRing(p, q) { let r = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r; } return r; }
  const segDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const distToRings = (p, rings) => { let d = Infinity; rings.forEach(q => { for (let i = 0; i < q.length - 1; i++) d = Math.min(d, segDist(p, q[i], q[i + 1])); }); return d; };
  const fmt = (n, d = 0) => (+n).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: d });

  /* ---------- 종류·범례(색은 도시·군관리계획 결정도 관례 — 지침 제10조⑥ 개별 법령 도식 확인 필요) ---------- */
  const KINDS = [
    { k: '획지', re: /획지|주택|대지/, fill: '#fbe9a6', aci: 2 },
    { k: '도로', re: /도로/, fill: '#d4d8dc', aci: 8 },
    { k: '공원', re: /공원/, fill: '#8fd19e', aci: 3 },
    { k: '녹지', re: /녹지/, fill: '#c6e9b4', aci: 3 },
    { k: '공공공지', re: /공공공지|광장/, fill: '#bfe3e8', aci: 4 },
    { k: '주차장', re: /주차/, fill: '#d0d0f0', aci: 5 },
    { k: '학교', re: /학교/, fill: '#d8c8f0', aci: 6 },
    { k: '공공청사', re: /청사|공공/, fill: '#c8d6ea', aci: 5 },
    { k: '종교용지', re: /종교/, fill: '#ecd6c0', aci: 30 },
    { k: '그 밖의 시설', re: /./, fill: '#e3e3e3', aci: 9 },
  ];
  const kindOf = s => KINDS.find(x => x.re.test(String(s || ''))) || KINDS[KINDS.length - 1];
  const LINE = { zone: { name: '정비구역 경계', color: '#e03131', aci: 1 }, dz: { name: '지구단위계획구역 경계', color: '#1c7ed6', aci: 5 }, bline: { name: '건축한계선', color: '#d6336c', aci: 6 }, parcel: { name: '연속지적(지번)', color: '#8a9096', aci: 9 } };

  /* ---------- 모형(m 좌표) 만들기 ---------- */
  // site: 공통 구역(JbsSite) · parcels: 브이월드 연속지적 GeoJSON Feature 목록(없어도 됨) · opt { sb(건축한계선 후퇴 m), dz(지구단위계획구역도 그림) }
  function model(site, parcels, opt) {
    opt = opt || {}; const tf = T(), arch = site.arch || {}, P = arch.params || {};
    const zr = ringsOf(site.geojson); if (!zr.length) return { error: '구역계가 없습니다' };
    const zoneF = { type: 'Feature', properties: {}, geometry: (site.geojson.geometry || site.geojson) };
    const zone = zr.map(projPoly), zoneA = zone.reduce((a, p) => a + polyArea(p), 0);
    // 토지이용: 건축 불가 영역(/arch exclude) + 나머지 획지
    const exF = (arch.exclude || []).map((q, i) => ({ kind: (arch.exKinds || [])[i] || '그 밖의 시설', f: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [close(q)] } } }));
    const land = [];
    exF.forEach(e => { let x = e.f; try { x = tf.intersect(e.f, zoneF) || null; } catch (er) { /* 그대로 */ } if (!x) return; ringsOf(x).forEach(poly => { const pp = projPoly(poly); land.push({ kind: kindOf(e.kind).k, name: e.kind, poly: pp, area: polyArea(pp) }); }); });
    let lotF = zoneF;
    exF.forEach(e => { try { const d = tf.difference(lotF, e.f); if (d) lotF = d; } catch (er) { /* 무시 */ } });
    const lotPolys = ringsOf(lotF).map(projPoly).filter(p => polyArea(p) > 1);
    lotPolys.sort((a, b) => polyArea(b) - polyArea(a));
    lotPolys.forEach((pp, i) => land.push({ kind: '획지', name: `획지${lotPolys.length > 1 ? i + 1 : 1}`, poly: pp, area: polyArea(pp) }));
    const placed = land.filter(x => x.kind !== '획지').reduce((a, x) => a + x.area, 0), lotA = lotPolys.reduce((a, p) => a + polyArea(p), 0);
    // 연속지적(구역 주변) — 지번 글자 = jibun(끝 글자 지목)
    const pc = (parcels || []).map(f => { const pr = f.properties || {}; const polys = ringsOf(f).map(projPoly); return { jibun: String(pr.jibun || pr.JIBUN || ''), pnu: pr.pnu || '', polys }; }).filter(x => x.polys.length);
    // 경계가 필지를 가로지르는지(지적선 기준 여부 — 지침 제8조②2호)
    const cross = [];
    (parcels || []).forEach(f => { let r = 0; try { const x = tf.intersect(f, zoneF); r = x ? tf.area(x) / tf.area(f) : 0; } catch (er) { return; } if (r > 0.02 && r < 0.98) cross.push({ jibun: String((f.properties || {}).jibun || ''), ratio: r }); });
    // 건축한계선: 획지 경계 중 도로(구역 안 도로 + 구역 밖 지목 '도' 필지)를 향한 부분을 sb m 안으로
    const sb = opt.sb != null ? +opt.sb : (+P.roadSb || 0), roads = [];
    land.filter(x => x.kind === '도로').forEach(x => roads.push(x.poly[0]));
    pc.forEach(x => { if (/도$/.test(x.jibun.trim())) x.polys.forEach(p => { if (!inRing(centroidOf(p[0]), zone[0][0])) roads.push(p[0]); }); });
    const bline = [];
    if (sb > 0 && roads.length) lotPolys.forEach(pp => {
      const q = pp[0], n = q.length - 1; if (n < 3) return;
      const sgn = (q.reduce((a, p, i) => i < n ? a + p[0] * q[i + 1][1] - q[i + 1][0] * p[1] : a, 0) > 0) ? 1 : -1;   // 반시계 = 1
      // 변마다 도로를 향하는지(변 가운데에서 바깥 1.5m 점이 도로에 들어가거나 1m 안)
      const edges = []; for (let i = 0; i < n; i++) { const a = q[i], b = q[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = dy / L * sgn, ny = -dx / L * sgn, m = [(a[0] + b[0]) / 2 + nx * 1.5, (a[1] + b[1]) / 2 + ny * 1.5];
        const onRoad = roads.some(r => inRing(m, r)) || distToRings(m, roads) < 1; edges.push({ a, b, nx, ny, L, road: onRoad }); }
      // 도로 변을 안쪽으로 sb 평행 이동, 이어진 도로 변끼리 교점으로 이음
      let cur = [];
      const off = e => [[e.a[0] - e.nx * sb, e.a[1] - e.ny * sb], [e.b[0] - e.nx * sb, e.b[1] - e.ny * sb]];
      const meet = (e, f) => { const [p1, p2] = off(e), [p3, p4] = off(f), d = (p1[0] - p2[0]) * (p3[1] - p4[1]) - (p1[1] - p2[1]) * (p3[0] - p4[0]); if (Math.abs(d) < 1e-9) return p2; const t = ((p1[0] - p3[0]) * (p3[1] - p4[1]) - (p1[1] - p3[1]) * (p3[0] - p4[0])) / d; return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])]; };
      const start = edges.findIndex((e, i) => e.road && !edges[(i + n - 1) % n].road);
      const order = start < 0 ? (edges.every(e => e.road) ? [...Array(n).keys()] : []) : [...Array(n).keys()].map(k => (start + k) % n);
      const ring = start < 0 && order.length;
      order.forEach((i, k) => {
        const e = edges[i], prev = edges[(i + n - 1) % n], next = edges[(i + 1) % n];
        if (!e.road) { if (cur.length > 1) bline.push(cur); cur = []; return; }
        if (!cur.length) cur.push(prev.road ? meet(prev, e) : off(e)[0]);
        cur.push(next.road ? meet(e, next) : off(e)[1]);
        if (k === order.length - 1) { if (ring) cur.push(cur[0]); if (cur.length > 1) bline.push(cur); cur = []; }
      });
      if (cur.length > 1) bline.push(cur);
    });
    // 범위
    const all = zone.flatMap(p => p[0]); const bb = [Math.min(...all.map(p => p[0])), Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1]))];
    return { zone, zoneA, land, lotA, placedA: placed, restA: Math.max(0, zoneA - lotA - placed), parcels: pc, cross, sb, bline, roadsKnown: roads.length, bbox: bb, dz: opt.dz !== false };
  }

  /* ---------- 축척·도엽(A1 가로 841×594㎜, 지도 칸 = 왼쪽, 오른쪽 표제·범례 띠) ---------- */
  const PAPER = { w: 841, h: 594, ml: 25, mt: 15, mb: 15, side: 165, gap: 6 };
  const MAPW = PAPER.w - PAPER.ml - 10 - PAPER.side - PAPER.gap, MAPH = PAPER.h - PAPER.mt - PAPER.mb;   // 635 × 564 ㎜
  const SCALES = [500, 600, 1000, 1200, 1500], OVERVIEW = [5000, 10000, 25000, 50000];
  function sheets(M, opt) {
    opt = opt || {}; const mg = opt.margin != null ? opt.margin : 25;   // 구역 밖 주변 지적 여유(m)
    const [x0, y0, x1, y1] = M.bbox, W = x1 - x0 + 2 * mg, H = y1 - y0 + 2 * mg, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const fits = s => W * 1000 / s <= MAPW && H * 1000 / s <= MAPH;
    let s = opt.scale ? +opt.scale : (SCALES.find(fits) || 0);
    if (s && fits(s)) { const w = MAPW * s / 1000, h = MAPH * s / 1000; return { scale: s, list: [{ no: 1, bbox: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] }], overview: null }; }
    s = s || 1200;   // 1/1,500로도 한 장에 안 들어가면 1/1,200로 나눔(정비구역 고시 관례)
    const w = MAPW * s / 1000, h = MAPH * s / 1000, nc = Math.ceil(W / w), nr = Math.ceil(H / h), sx = cx - nc * w / 2, sy = cy + nr * h / 2, list = [];
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      const bb = [sx + c * w, sy - (r + 1) * h, sx + (c + 1) * w, sy - r * h];
      const any = M.zone.some(p => boxHitsPoly(bb, p[0]));
      if (any) list.push({ no: list.length + 1, bbox: bb, rc: [r, c] });
    }
    const ov = OVERVIEW.find(z => (nc * w) * 1000 / z <= MAPW && (nr * h) * 1000 / z <= MAPH) || 50000;
    const ow = MAPW * ov / 1000, oh = MAPH * ov / 1000;
    return { scale: s, list, overview: { scale: ov, bbox: [cx - ow / 2, cy - oh / 2, cx + ow / 2, cy + oh / 2] } };
  }
  // 도엽 사각형과 구역이 닿는지: 사각형 가운데가 구역 안, 또는 구역 변이 사각형을 지남(Liang–Barsky)
  const segHitsBox = (a, b, bb) => { let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
    for (const [p, q] of [[-dx, a[0] - bb[0]], [dx, bb[2] - a[0]], [-dy, a[1] - bb[1]], [dy, bb[3] - a[1]]]) { if (p === 0) { if (q < 0) return false; continue; } const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } } return true; };
  const boxHitsPoly = (bb, q) => inRing([(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2], q) || q.some((p, i) => i < q.length - 1 && segHitsBox(p, q[i + 1], bb));

  /* ---------- SVG 한 장(㎜) ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // meta { title, org, gosi, date, maker, place, note }, sheet { no, bbox }, S = sheets 결과, kind 'sheet' | 'overview'
  function svg(M, sheet, S, meta, kind) {
    meta = meta || {}; const ov = kind === 'overview', sc = ov ? S.overview.scale : S.scale, bb = ov ? S.overview.bbox : sheet.bbox, k = 1000 / sc;
    const mx = PAPER.ml, my = PAPER.mt, X = e => mx + (e - bb[0]) * k, Y = n => my + (bb[3] - n) * k;
    const pth = q => 'M' + q.map(p => `${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('L') + 'Z';
    const pl = q => 'M' + q.map(p => `${X(p[0]).toFixed(2)},${Y(p[1]).toFixed(2)}`).join('L');
    const polyD = poly => poly.map(pth).join('');
    const tsz = ov ? 2.6 : sc <= 600 ? 4.2 : sc <= 1200 ? 3.6 : 3.2, jsz = ov ? 0 : sc <= 600 ? 2.4 : sc <= 1000 ? 2 : 1.7;
    let g = '';
    // 연속지적
    M.parcels.forEach(p => p.polys.forEach(poly => { g += `<path d="${polyD(poly)}" fill="none" stroke="${LINE.parcel.color}" stroke-width="${ov ? 0.08 : 0.13}"/>`; }));
    // 토지이용 칠
    M.land.forEach(x => { const kd = kindOf(x.kind); g += `<path d="${polyD(x.poly)}" fill="${kd.fill}" fill-opacity=".72" fill-rule="evenodd" stroke="#555" stroke-width="${ov ? 0.12 : 0.25}"/>`; });
    // 지번(구역 안 + 바로 밖)
    if (jsz) M.parcels.forEach(p => { const q = p.polys[0][0], c = labelAt(q), a = areaXY(q); if (!p.jibun || a * k * k < 18) return; const x = X(c[0]), y = Y(c[1]); if (x < mx || x > mx + MAPW || y < my || y > my + MAPH) return; g += `<text x="${x.toFixed(2)}" y="${(y + jsz * 0.35).toFixed(2)}" font-size="${jsz}" text-anchor="middle" fill="#495057">${esc(p.jibun)}</text>`; });
    // 건축한계선
    if (!ov) M.bline.forEach(l => { g += `<path d="${pl(l)}" fill="none" stroke="${LINE.bline.color}" stroke-width="0.5" stroke-dasharray="3 1 0.6 1"/>`; });
    // 구역 경계(지구단위계획구역은 같은 선 바깥쪽 파란 일점쇄선)
    M.zone.forEach(poly => { if (M.dz) g += `<path d="${polyD(poly)}" fill="none" stroke="${LINE.dz.color}" stroke-width="${ov ? 0.6 : 1.4}" stroke-dasharray="6 1.5 1 1.5" stroke-opacity=".85"/>`;
      g += `<path d="${polyD(poly)}" fill="none" stroke="${LINE.zone.color}" stroke-width="${ov ? 0.4 : 0.7}" stroke-dasharray="${ov ? '3 1' : '5 1.2 1 1.2'}"/>`; });
    // 시설 이름·면적
    M.land.forEach(x => { const c = labelAt(x.poly[0]), a = x.area * k * k; if (a < (ov ? 40 : 120)) return; g += `<text x="${X(c[0]).toFixed(2)}" y="${Y(c[1]).toFixed(2)}" font-size="${tsz}" text-anchor="middle" font-weight="600" fill="#212529">${esc(x.name)}</text>`;
      if (!ov) g += `<text x="${X(c[0]).toFixed(2)}" y="${(Y(c[1]) + tsz * 1.25).toFixed(2)}" font-size="${tsz * 0.8}" text-anchor="middle" fill="#343a40">${fmt(x.area, 1)}㎡</text>`; });
    // 총괄도: 도엽 구획·번호
    if (ov) S.list.forEach(s2 => { const b = s2.bbox; g += `<rect x="${X(b[0]).toFixed(2)}" y="${Y(b[3]).toFixed(2)}" width="${((b[2] - b[0]) * k).toFixed(2)}" height="${((b[3] - b[1]) * k).toFixed(2)}" fill="none" stroke="#000" stroke-width="0.35"/><text x="${X(b[0]) + 3}" y="${Y(b[3]) + 7}" font-size="6" font-weight="700">${s2.no}</text>`; });
    // 좌표 눈금(100m, 1/1,500 넘으면 500m) — 측량 좌표 X=북, Y=동
    const step = sc <= 1500 ? 100 : sc <= 10000 ? 500 : 1000; let tick = '';
    for (let e = Math.ceil(bb[0] / step) * step; e <= bb[2]; e += step) { const x = X(e).toFixed(2); tick += `<path d="M${x},${my}v4M${x},${my + MAPH}v-4" stroke="#000" stroke-width="0.25"/><text x="${x}" y="${my - 1.5}" font-size="2.2" text-anchor="middle">Y=${fmt(e)}</text>`; }
    for (let n = Math.ceil(bb[1] / step) * step; n <= bb[3]; n += step) { const y = Y(n).toFixed(2); tick += `<path d="M${mx},${y}h4M${mx + MAPW},${y}h-4" stroke="#000" stroke-width="0.25"/><text x="${mx - 1.5}" y="${y}" font-size="2.2" text-anchor="end" dominant-baseline="middle" transform="rotate(-90 ${mx - 1.5} ${y})">X=${fmt(n)}</text>`; }
    // 도곽 네 모서리 좌표
    const cn = [[bb[0], bb[3], mx, my - 6, 'start'], [bb[2], bb[3], mx + MAPW, my - 6, 'end'], [bb[0], bb[1], mx, my + MAPH + 8, 'start'], [bb[2], bb[1], mx + MAPW, my + MAPH + 8, 'end']]
      .map(([e, n, x, y, a]) => `<text x="${x}" y="${y}" font-size="2.4" text-anchor="${a}">X=${fmt(n, 1)} · Y=${fmt(e, 1)}</text>`).join('');
    // 오른쪽 띠: 표제·범례·축척·방위
    const sx = PAPER.w - 10 - PAPER.side, sw = PAPER.side; let s = `<rect x="${sx}" y="${my}" width="${sw}" height="${MAPH}" fill="#fff" stroke="#000" stroke-width="0.5"/>`;
    let yy = my + 12;
    const line = (t, size, w, x) => { s += `<text x="${x != null ? x : sx + 6}" y="${yy}" font-size="${size}" font-weight="${w || 400}">${esc(t)}</text>`; yy += size * 1.45; };
    const wrap = (t, size, w, n) => { const cut = []; let r = String(t); while (r.length > n) { let i = r.lastIndexOf(' ', n); if (i < n * 0.5) i = n; cut.push(r.slice(0, i)); r = r.slice(i).trim(); } cut.push(r); cut.forEach(c => line(c, size, w)); };
    wrap(meta.title || '정비구역 지정 지형도면', 6.2, 700, 24);
    yy += 2; line(`${meta.org || '인천광역시'} 고시 제${meta.gosi || '　　　　'}호`, 4, 600);
    line(ov ? `총괄도 · 축척 1/${fmt(sc)}` : `도면 ${sheet.no} / ${S.list.length} · 축척 1/${fmt(sc)}`, 4, 600);
    if (meta.place) wrap(`위치: ${meta.place}`, 3.2, 400, 42);
    line(`구역 면적: ${fmt(M.zoneA, 1)}㎡`, 3.2);
    yy += 3; s += `<path d="M${sx},${yy}h${sw}" stroke="#000" stroke-width="0.3"/>`; yy += 8; line('범  례', 4.2, 700);
    const lg = (draw, t) => { s += draw(sx + 8, yy - 3) + `<text x="${sx + 30}" y="${yy}" font-size="3.2">${esc(t)}</text>`; yy += 6.2; };
    lg((x, y) => `<path d="M${x},${y + 1.5}h18" stroke="${LINE.zone.color}" stroke-width="0.9" stroke-dasharray="5 1.2 1 1.2"/>`, LINE.zone.name);
    if (M.dz) lg((x, y) => `<path d="M${x},${y + 1.5}h18" stroke="${LINE.dz.color}" stroke-width="1.4" stroke-dasharray="6 1.5 1 1.5"/>`, LINE.dz.name);
    if (M.bline.length) lg((x, y) => `<path d="M${x},${y + 1.5}h18" stroke="${LINE.bline.color}" stroke-width="0.6" stroke-dasharray="3 1 0.6 1"/>`, `${LINE.bline.name}(도로에서 ${fmt(M.sb, 1)}m)`);
    lg((x, y) => `<path d="M${x},${y + 1.5}h18" stroke="${LINE.parcel.color}" stroke-width="0.3"/>`, LINE.parcel.name);
    const used = [...new Set(M.land.map(x => x.kind))];
    KINDS.filter(kd => used.includes(kd.k)).forEach(kd => { const a = M.land.filter(x => x.kind === kd.k).reduce((t, x) => t + x.area, 0); lg((x, y) => `<rect x="${x}" y="${y - 1}" width="18" height="5" fill="${kd.fill}" stroke="#555" stroke-width="0.25"/>`, `${kd.k === '획지' ? '획지(주택용지)' : kd.k} ${fmt(a, 1)}㎡`); });
    if (M.restA > M.zoneA * 0.003) { s += `<text x="${sx + 8}" y="${yy}" font-size="2.7" fill="#c92a2a">※ 비율로만 잡은 기반시설 ${fmt(M.restA, 1)}㎡는 위치 미정(도면에 없음)</text>`; yy += 5.5; }
    // 축척 막대·방위
    yy += 4; s += `<path d="M${sx},${yy}h${sw}" stroke="#000" stroke-width="0.3"/>`; yy += 10;
    const bar = [10, 20, 50, 100, 200, 500, 1000, 2000].find(m => m * k >= 40) || 100, bw = bar * k;
    s += `<g transform="translate(${sx + 8},${yy})"><rect width="${(bw / 2).toFixed(2)}" height="2.2" fill="#000"/><rect x="${(bw / 2).toFixed(2)}" width="${(bw / 2).toFixed(2)}" height="2.2" fill="#fff" stroke="#000" stroke-width="0.3"/><text y="6.5" font-size="2.6">0</text><text x="${(bw / 2).toFixed(2)}" y="6.5" font-size="2.6" text-anchor="middle">${bar / 2}</text><text x="${bw.toFixed(2)}" y="6.5" font-size="2.6" text-anchor="middle">${bar}m</text></g>`;
    const nx = sx + sw - 18, ny = yy + 2; s += `<path d="M${nx},${ny - 9}L${nx + 4},${ny + 4}L${nx},${ny + 1.5}L${nx - 4},${ny + 4}Z" fill="#000"/><text x="${nx}" y="${ny - 10.5}" font-size="4" text-anchor="middle" font-weight="700">N</text>`;
    yy += 16; s += `<path d="M${sx},${yy}h${sw}" stroke="#000" stroke-width="0.3"/>`; yy += 7;
    // 작성 기준
    [`좌표계: ${CRS_NAME}`,
      '작성 기준: 토지이용규제 기본법 제8조, 같은 법 시행령 제7조, 「지역·지구등의 지형도면 작성에 관한 지침」(국토교통부고시 제2026-360호)',
      `바탕 도면: 연속지적도${M.cross.length ? '' : '(구역 경계가 지적선 기준 — 지침 제8조②2호)'}`,
      M.cross.length ? `※ 구역 경계가 필지 ${M.cross.length}개를 가로지름 — 지적선 기준이 아니면 지적이 표시된 지형도에 작성(지침 제8조②)` : '',
      '※ 고시 전 국토이용정보체계 지적 데이터로 다시 맞추고 검수(지침 제6조①1호·제14조) — 이 도면은 초안',
      meta.note || ''].filter(Boolean).forEach(t => wrap(t, 2.5, 400, 60));
    yy = my + MAPH - 22; s += `<path d="M${sx},${yy}h${sw}" stroke="#000" stroke-width="0.3"/>`; yy += 7;
    line(`작성: ${meta.maker || '　'}`, 3.2); line(`작성 일자: ${meta.date || ''}`, 3.2);
    const clip = `cp${ov ? 'o' : sheet.no}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER.w} ${PAPER.h}" width="${PAPER.w}mm" height="${PAPER.h}mm" font-family="'IBM Plex Sans KR','맑은 고딕',sans-serif">`
      + `<rect width="${PAPER.w}" height="${PAPER.h}" fill="#fff"/><defs><clipPath id="${clip}"><rect x="${mx}" y="${my}" width="${MAPW}" height="${MAPH}"/></clipPath></defs>`
      + `<g clip-path="url(#${clip})">${g}</g><rect x="${mx}" y="${my}" width="${MAPW}" height="${MAPH}" fill="none" stroke="#000" stroke-width="0.6"/>${tick}${cn}`
      + `<rect x="${PAPER.ml - 5}" y="${my - 10}" width="${PAPER.w - PAPER.ml - 5}" height="${MAPH + 20}" fill="none" stroke="#000" stroke-width="1"/>${s}</svg>`;
  }

  /* ---------- DXF(R12 ASCII, 측량 좌표 m — CAD X = 동, Y = 북) ---------- */
  const dxfStr = s => String(s).replace(/[^\x20-\x7e]/g, c => '\\U+' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  function dxf(M, meta) {
    const L = [['정비구역경계', 1], ['지구단위계획구역', 5], ['건축한계선', 6], ['연속지적', 9], ['지번', 9], ['토지이용_글자', 7]].concat(KINDS.map(kd => ['토지이용_' + kd.k.replace(/\s/g, ''), kd.aci]));
    const o = [];
    const P = (...a) => { for (let i = 0; i < a.length; i += 2) o.push(String(a[i]), String(a[i + 1])); };
    P(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
    P(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, L.length);
    L.forEach(([n, c]) => P(0, 'LAYER', 2, dxfStr(n), 70, 0, 62, c, 6, 'CONTINUOUS'));
    P(0, 'ENDTAB', 0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES');
    const poly = (layer, q, closed) => { P(0, 'POLYLINE', 8, dxfStr(layer), 66, 1, 70, closed ? 1 : 0); (closed ? q.slice(0, -1) : q).forEach(p => P(0, 'VERTEX', 8, dxfStr(layer), 10, p[0].toFixed(3), 20, p[1].toFixed(3), 30, 0)); P(0, 'SEQEND', 8, dxfStr(layer)); };
    const text = (layer, p, h, t) => P(0, 'TEXT', 8, dxfStr(layer), 10, p[0].toFixed(3), 20, p[1].toFixed(3), 30, 0, 40, h, 1, dxfStr(t), 72, 1, 11, p[0].toFixed(3), 21, p[1].toFixed(3), 31, 0);
    M.parcels.forEach(p => { p.polys.forEach(pp => pp.forEach(q => poly('연속지적', q, true))); if (p.jibun) text('지번', labelAt(p.polys[0][0]), 0.9, p.jibun); });
    M.land.forEach(x => { x.poly.forEach(q => poly('토지이용_' + x.kind.replace(/\s/g, ''), q, true)); const c = labelAt(x.poly[0]); text('토지이용_글자', c, 2.2, x.name); text('토지이용_글자', [c[0], c[1] - 3], 1.6, fmt(x.area, 1) + '㎡'); });
    M.bline.forEach(l => poly('건축한계선', l, false));
    M.zone.forEach(pp => pp.forEach(q => { poly('정비구역경계', q, true); if (M.dz) poly('지구단위계획구역', q, true); }));
    if (meta && meta.title) text('토지이용_글자', [M.bbox[0], M.bbox[3] + 8], 3, meta.title);
    P(0, 'ENDSEC', 0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  /* ---------- SHAPE(zip — 지침 제9조③) ---------- */
  const enc = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s) : Buffer.from(s, 'utf8'));
  function shpFiles(kind, recs) {   // kind 5 폴리곤 | 3 선, recs [{ parts:[[ [x,y]… ]…], attr:{} }]
    const bbOf = pts => [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    const all = recs.flatMap(r => r.parts.flat()), BB = all.length ? bbOf(all) : [0, 0, 0, 0];
    const bodies = recs.map(r => { const pts = r.parts.flat(), np = r.parts.length, n = pts.length, len = 44 + 4 * np + 16 * n, b = new DataView(new ArrayBuffer(len)), bb = bbOf(pts);
      b.setInt32(0, kind, true); bb.forEach((v, i) => b.setFloat64(4 + 8 * i, v, true)); b.setInt32(36, np, true); b.setInt32(40, n, true);
      let at = 0; r.parts.forEach((pt, i) => { b.setInt32(44 + 4 * i, at, true); at += pt.length; });
      pts.forEach((p, i) => { b.setFloat64(44 + 4 * np + 16 * i, p[0], true); b.setFloat64(52 + 4 * np + 16 * i, p[1], true); }); return new Uint8Array(b.buffer); });
    const head = total => { const h = new DataView(new ArrayBuffer(100)); h.setInt32(0, 9994); h.setInt32(24, total / 2); h.setInt32(28, 1000, true); h.setInt32(32, kind, true); BB.forEach((v, i) => h.setFloat64(36 + 8 * i, v, true)); return new Uint8Array(h.buffer); };
    const shpLen = 100 + bodies.reduce((a, b) => a + 8 + b.length, 0), shp = new Uint8Array(shpLen), shx = new Uint8Array(100 + 8 * bodies.length);
    shp.set(head(shpLen)); shx.set(head(shx.length));
    let off = 100; bodies.forEach((b, i) => { const rh = new DataView(new ArrayBuffer(8)); rh.setInt32(0, i + 1); rh.setInt32(4, b.length / 2); shp.set(new Uint8Array(rh.buffer), off);
      const xr = new DataView(new ArrayBuffer(8)); xr.setInt32(0, off / 2); xr.setInt32(4, b.length / 2); shx.set(new Uint8Array(xr.buffer), 100 + 8 * i); shp.set(b, off + 8); off += 8 + b.length; });
    // DBF(UTF-8, .cpg로 알림)
    const fields = [['KIND', 'C', 40, 0], ['NAME', 'C', 80, 0], ['AREA_M2', 'N', 14, 2]], recLen = 1 + fields.reduce((a, f) => a + f[2], 0), hl = 32 + 32 * fields.length + 1;
    const dbf = new Uint8Array(hl + recLen * recs.length + 1), dv = new DataView(dbf.buffer), d = new Date();
    dv.setUint8(0, 3); dv.setUint8(1, d.getFullYear() - 1900); dv.setUint8(2, d.getMonth() + 1); dv.setUint8(3, d.getDate()); dv.setUint32(4, recs.length, true); dv.setUint16(8, hl, true); dv.setUint16(10, recLen, true);
    fields.forEach((f, i) => { const o2 = 32 + 32 * i; dbf.set(enc(f[0]), o2); dbf[o2 + 11] = f[1].charCodeAt(0); dbf[o2 + 16] = f[2]; dbf[o2 + 17] = f[3]; });
    dbf[hl - 1] = 0x0d;
    recs.forEach((r, i) => { let o2 = hl + recLen * i; dbf[o2++] = 0x20; fields.forEach(f => { let v = r.attr[f[0]]; let bytes;
      if (f[1] === 'N') { const s = (v == null || !isFinite(+v) ? '' : (+v).toFixed(f[3])).padStart(f[2]); bytes = enc(s); }
      else { bytes = enc(String(v == null ? '' : v)); let cut = Math.min(bytes.length, f[2]); while (cut > 0 && cut < bytes.length && (bytes[cut] & 0xc0) === 0x80) cut--; bytes = bytes.slice(0, cut); }
      const cell = new Uint8Array(f[2]).fill(0x20); cell.set(bytes.slice(0, f[2])); dbf.set(cell, o2); o2 += f[2]; }); });
    dbf[dbf.length - 1] = 0x1a;
    return { shp, shx, dbf };
  }
  const cw = q => { let a = 0; for (let i = 0; i < q.length - 1; i++) a += q[i][0] * q[i + 1][1] - q[i + 1][0] * q[i][1]; return a < 0; };
  const shpRing = (q, outer) => (cw(q) === outer ? q : q.slice().reverse());   // 셰이프: 바깥 시계, 구멍 반시계
  function shapes(M) {
    const out = {}, put = (name, fs) => { out[name + '.shp'] = fs.shp; out[name + '.shx'] = fs.shx; out[name + '.dbf'] = fs.dbf; out[name + '.prj'] = enc(PRJ); out[name + '.cpg'] = enc('UTF-8'); };
    put('정비구역', shpFiles(5, M.zone.map(pp => ({ parts: pp.map((q, i) => shpRing(q, i === 0)), attr: { KIND: '정비구역', NAME: '정비구역', AREA_M2: polyArea(pp) } }))));
    put('토지이용계획', shpFiles(5, M.land.map(x => ({ parts: x.poly.map((q, i) => shpRing(q, i === 0)), attr: { KIND: x.kind, NAME: x.name, AREA_M2: x.area } }))));
    if (M.bline.length) put('건축한계선', shpFiles(3, M.bline.map(l => ({ parts: [l], attr: { KIND: '건축한계선', NAME: `도로에서 ${M.sb}m`, AREA_M2: 0 } }))));
    return out;
  }
  // 압축 없는 zip
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const parts = [], cen = []; let off = 0;
    Object.entries(files).forEach(([name, data]) => {
      const nb = enc(name), c = crc32(data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint32(16, c, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true); ch.setUint32(42, off, true);
      cen.push(new Uint8Array(ch.buffer), nb); off += 30 + nb.length + data.length;
    });
    const cl = cen.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22)), n = Object.keys(files).length;
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, n, true); e.setUint16(10, n, true); e.setUint32(12, cl, true); e.setUint32(16, off, true);
    const all = parts.concat(cen, [new Uint8Array(e.buffer)]), out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let o = 0; all.forEach(b => { out.set(b, o); o += b.length; }); return out;
  }

  const api = { tm, PRJ, CRS_NAME, model, sheets, svg, dxf, shapes, zip, crc32, PAPER, MAPW, MAPH, SCALES, KINDS, kindOf, labelAt };
  if (isNode) module.exports = api; else g.JbsTopo = api;
})(typeof window !== 'undefined' ? window : globalThis);
