// /urban 정비계획 화면 코드 8/12 — 개략 배치 지도 ARCHLAY(/arch와 같은 배치 엔진), 지도 그리기·꼭짓점 편집·GeoJSON 읽기, 예시 지적도(SVG) 그리기
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 4탭 개략 배치: /arch와 같은 배치 엔진(shared/arch-geom.js)으로 실제 평면 모양 동을 놓음 (2026-11-04 사용자 결정 '1번') =====
 - 대지: 구역계, 건축 불가 = 3탭 정비기반시설(공원·도로 확폭·학교 등) — 그 경계에서 대지경계 이격만큼 띄움
 - 경계 성격: 도로가 닿은 변 'road'(폭 20m 이상 'arterial'), 북쪽을 향한 변 'north', 나머지 'boundary' (/arch '경계 자동 지정'과 같은 규칙)
 - 형태는 판상, 방향은 0°와 긴 변 방향 중 연면적 큰 쪽. 세대수 숫자는 여전히 개략 계산(용적률 연면적 ÷ 공급면적)이고 이 그림은 배치 확인용
 - 계산은 화면을 그린 뒤 따로(setTimeout) 하고 결과를 기억(같은 조건이면 다시 계산 안 함) */
const ARCHLAY = {
  memo: {}, busy: '',
  key(a, pl) { const z = Z.zones[a.key] || {}; return [a.key, JSON.stringify(BLINE.get(z)), JSON.stringify(((z.infra || {}).gates || []).map(g => [g.kind, g.pt && g.pt.map(v => +(+v).toFixed(5))])), Math.round(pl.site), Math.round(pl.farUse), JSON.stringify(JbsFeas.mixOf(JbsFeas.get())), JSON.stringify((z.infra || {}).fit || {}), JSON.stringify(((pl.infra || {}).lots || []).map(l => Math.round(l.area || 0))), Math.round((pl.infra || {}).relArea || 0), P.infraMode, z.roads && z.roads.at].join('|'); },
  input(a, pl) {
    const C = ARCHC, G = window.ArchGeom, z = Z.zones[a.key];
    if (!C || !G || !C.평면 || !C.가정 || !z || !z.geojson) return null;
    const g = z.geojson.geometry || z.geojson, ring0 = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.slice().sort((x, y) => turf.area(turf.polygon(y)) - turf.area(turf.polygon(x)))[0][0] : null;
    if (!ring0) return null;
    const ring = G.openRing(ring0), pr = G.projector(ring), pts = G.ccw(ring.map(pr.to));
    const ringsOf = gm => { const t = gm && (gm.geometry || gm); return !t ? [] : t.type === 'Polygon' ? [t.coordinates[0]] : t.type === 'MultiPolygon' ? t.coordinates.map(c => c[0]) : []; };
    const roads = ((z.roads && z.roads.edge) || []).filter(r => r.geom).map(r => ({ w: +r.w || 0, polys: ringsOf(r.geom).map(rg => G.openRing(rg).map(pr.to)) }));
    const tags = G.edges(pts).map(e => {
      const m = [(e.a[0] + e.b[0]) / 2 + e.out[0] * 3, (e.a[1] + e.b[1]) / 2 + e.out[1] * 3];
      const hit = roads.find(r => r.polys.some(pl2 => G.inside(m[0], m[1], pl2) || pl2.some((q, k) => G.segDist(m, q, pl2[(k + 1) % pl2.length]) < 4)));
      if (hit) return hit.w >= 20 ? 'arterial' : 'road';
      return e.out[1] > 0.6 && !/준주거|상업|공업/.test(String(a.zone || P.zone || '')) ? 'north' : 'boundary';   // 정북 일조는 전용·일반주거지역만(건축법 제61조①)
    });
    // 도로변은 건축선·출입 계획(BLINE)의 변별 건축한계선. 간선도로변은 소음 이격과 큰 쪽(2026-11-08)
    const A0 = C.가정, bp = BLINE.proj(z), bsb = i => (bp && bp.E.length === tags.length && bp.edges[i].r ? bp.edges[i].sb : A0.roadSetback_m);
    const sb = tags.map((t, i) => t === 'road' ? bsb(i) : t === 'arterial' ? Math.max(bsb(i), A0.arterialSetback_m) : A0.boundarySetback_m);
    const inf = pl.infra || {}, exclude = [];
    [inf.parkGeom, inf.roadGeom, inf.schoolGeom, inf.relGeom, inf.pubB && inf.pubB.geom, inf.other && inf.other.geom, inf.green && inf.green.geom].forEach(gm => ringsOf(gm).forEach(rg => { const q = G.openRing(rg).map(pr.to); if (q.length >= 3) exclude.push(q); }));
    (inf.lots || []).filter(l => l.small && l.geom).forEach(l => ringsOf(l.geom).forEach(rg => exclude.push(G.openRing(rg).map(pr.to))));
    const zoning = String(a.zone || P.zone || '');
    const win = (C.items || []).find(i => i.id === 'window_setback'), sun = ((C.items || []).find(i => i.id === 'sunlight_north') || {}).이격;
    const mix = {}; Object.entries(JbsFeas.mixOf(JbsFeas.get())).forEach(([t, v]) => { if (num(v) > 0 && C.평면[t]) mix[t] = num(v); });
    if (!Object.keys(mix).length) return null;
    // 단지 출입구 자리(주출입구 문주·진입광장, 주차장 경사로, 부출입구)는 건축 불가 — /arch와 같은 계산(shared/gate-zones.js, 2026-11-08)
    const E0 = G.edges(pts), keep = !window.GateZones ? [] : ((z.infra && z.infra.gates) || []).filter(g => g.pt).map(g => { const q = pr.to([g.pt[1], g.pt[0]]), ne = GateZones.nearestEdge(E0, q); return ne && ne.d < 30 ? GateZones.keepPoly(GateZones.zone(g.kind, q, E0[ne.edge], sb[ne.edge], {})) : null; }).filter(Boolean)
      .concat(bp && bp.E.length === tags.length ? BLINE.keepPolys(z) : []);   // 공공보행통로·공개공지(건축선·출입 계획)도 건축 불가
    // 출입구 자리(비상차로 잇기용) — 배치 뒤 draw()에서 동 사이로 순환 비상차로를 그림(2026-11-11)
    const gz = !window.GateZones ? [] : ((z.infra && z.infra.gates) || []).filter(g => g.pt).map(g => { const q = pr.to([g.pt[1], g.pt[0]]), ne = GateZones.nearestEdge(E0, q); return ne && ne.d < 30 ? GateZones.zone(g.kind, q, E0[ne.edge], sb[ne.edge], {}) : null; }).filter(Boolean);
    return { pr, pts, gz, site: { pts, tags, setbacks: sb, exclude, keep }, opt: { units: C.평면, lib: C.평면_라이브러리, assume: Object.assign({}, A0), mix, form: 'slab', spacing: 0.8, sun, lot: pl.site, far: pl.farUse, winRatio: win ? (/준주거|근린상업/.test(zoning) ? (win.값.근린상업_준주거_배수 || 4) : (win.값.배수 || 2)) : 0, edgeW: [], exSetback: A0.boundarySetback_m || 0 } };
  },
  cands(I) {
    const G = window.ArchGeom, cand = new Set([0]);
    G.edges(I.pts).sort((x, y) => y.len - x.len).slice(0, 2).forEach(e => { let d = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI; while (d > 45) d -= 90; while (d < -45) d += 90; cand.add(Math.round(d)); });
    const A = I.opt.assume;
    return { cand: [...cand], F: Math.round(A.minFloors + (A.maxFloors - A.minFloors) * 0.6) };
  },
  // 방향은 빠른 추정(quick, 기준 층수 하나)으로 고르고 고른 방향에서만 한 번 자세히 — /arch '배치안 만들기'와 같은 방식. 일꾼(Worker)에서 계산
  solve(I, done) {
    const c = this.cands(I);
    try {
      if (!this.wk) { this.wk = new Worker('archlay-worker.js?v=3f790e31'); this.cb = {}; this.wk.onmessage = e => { const f = this.cb[e.data.id]; delete this.cb[e.data.id]; if (f) f(e.data.r); }; this.wk.onerror = () => { Object.values(this.cb).forEach(f => f(null)); this.cb = {}; this.wk = null; }; }
      const id = (this.seq = (this.seq || 0) + 1); this.cb[id] = done;
      this.wk.postMessage({ id, site: I.site, opt: I.opt, cand: c.cand, F: c.F });
      // 90초가 넘으면 일꾼을 멈추고 예전 네모 그림으로(화면에 '계산 중'이 계속 남지 않게)
      setTimeout(() => { if (this.cb[id]) { const f = this.cb[id]; delete this.cb[id]; try { this.wk.terminate(); } catch (e) { /* 무시 */ } this.wk = null; Object.values(this.cb).forEach(g => g(null)); this.cb = {}; f(null); } }, 90000);
    } catch (e) { done(null); }
  },
  // 결과가 있으면 그리고 true. 없으면 계산을 걸어 두고 false(그동안은 예전 네모 그림)
  draw(a, pl) {
    let k; try { k = this.key(a, pl); } catch (e) { return false; }
    const r = this.memo[k];
    if (r === undefined) {
      if (this.busy !== k) {
        this.busy = k;
        const fin = res => {
          if (Object.keys(this.memo).length > 20) this.memo = {};
          this.memo[k] = res; this.busy = '';
          if (S.mode === 'arch' && S.region === a.key) render();
        };
        let I = null; try { I = this.input(a, pl); } catch (e) { console.warn('개략 배치(엔진) 입력 실패', e); }
        if (!I) setTimeout(() => fin(null), 0); else this.solve(I, r => { if (r) { r.pr = I.pr; r.pts = I.pts; r.gz = I.gz; r.ex = I.site.exclude; } fin(r); });
      }
      S.archLay = { busy: true };
      return false;
    }
    if (!r) { S.archLay = { fail: true }; return false; }
    const col = cssVar('--accent');
    r.buildings.forEach(b => {
      const ll = q => q.map(p => { const c = r.pr.back(p); return [c[1], c[0]]; });
      const tip = `${b.floors}층 · ${b.t}㎡형 층당 ${b.n}세대 · ${fmt(b.n * b.floors)}세대${b.vname ? ` · 평면 ${esc(b.vname)}` : ''}`;
      (b.parts && b.parts.length ? b.parts : [b.poly]).forEach(q => L.polygon(ll(q), { color: '#1f2933', weight: 1, fillColor: col, fillOpacity: 0.85 }).bindTooltip(tip, { sticky: true }).addTo(layT));
      (b.units || []).forEach(rs => rs.forEach(q => L.polygon(ll(q), { color: '#fff', weight: 0.5, fill: false, interactive: false }).addTo(layT)));
    });
    // 단지 안 비상차로(순환형)·소방차 전용구역 — 동 사이 빈 땅으로 이음(shared/gate-zones.js, 2026-11-11)
    try {
      if (window.GateZones && GateZones.routeRoad && r.pts && r.gz && r.gz.length) {
        if (!r.road) { const rc = GateZones.reach(r.pts, r.buildings, r.gz, { block: r.ex || [] }); r.pads = (r.units || 0) >= 100 ? GateZones.firePads(r.pts, r.buildings, r.ex || [], { reach: rc || undefined }) : [];
          r.road = GateZones.routeRoad(r.pts, r.buildings, r.gz, { block: r.ex || [], pads: r.pads.length ? r.pads : r.buildings.map(b => { const R = b.poly || (b.parts || [])[0]; const c = R.reduce((s, p) => [s[0] + p[0] / R.length, s[1] + p[1] / R.length], [0, 0]); return { id: b.id, ok: true, pad: [c, c, c, c] }; }) }) || { polys: [], miss: [], len: 0 }; }
        const ll = q => q.map(p => { const c = r.pr.back(p); return [c[1], c[0]]; });
        r.road.polys.forEach(q => L.polygon(ll(q), { stroke: false, fillColor: '#868e96', fillOpacity: 0.55, interactive: false }).addTo(layT));
        if (r.road.path && r.road.path.length) L.polyline(ll(r.road.path), { color: '#fff', weight: 1, dashArray: '4 3', interactive: false }).bindTooltip(`단지 안 비상차로(순환형) 폭 ${r.road.w}m · 약 ${fmt(r.road.len)}m`, { sticky: true }).addTo(layT);
        (r.pads || []).filter(f => f.ok).forEach(f => L.polygon(ll(f.pad), { color: '#e8a400', weight: 1, fillColor: '#ffd43b', fillOpacity: 0.7 }).bindTooltip(`소방자동차 전용구역 ${f.id}동(6×15m 가정)`, { sticky: true }).addTo(layT));
      }
    } catch (e) { /* 그림만 빠짐 */ }
    S.archLay = { n: r.buildings.length, units: r.units, fireNo: (r.pads || []).filter(f => !f.ok).length, roadMiss: ((r.road || {}).miss || []).length, maxF: r.maxFloors, far: r.far, bcr: r.bcr, angle: r.angle };
    return true;
  },
};

// 개략 배치 화면에도 3탭에서 정한 정비기반시설(공원·녹지·도로·학교 등)과 공동주택 획지 경계를 함께 보여 줌(읽기 전용) — 주동이 그 밖에만 놓였는지 눈으로 확인
function drawInfraLite(pl) {
  const inf = pl && pl.infra; if (!inf) return;
  const add = (g, st, tip) => { if (!g) return; try { L.geoJSON(g, { style: Object.assign({ weight: 1.5, fillOpacity: 0.55 }, st), interactive: !!tip }).eachLayer(l => { if (tip) l.bindTooltip(tip, { sticky: true }); l.addTo(layT); }); } catch (e) { /* 무시 */ } };
  add(inf.roadGeom, { color: '#7a7f86', fillColor: '#b9bec4' }, `도로(확폭 포함) ${fmt(inf.roadArea || 0)}㎡`);
  add(inf.parkGeom, { color: '#2f7d4a', fillColor: '#6fbf7e' }, `공원·녹지 ${fmt(inf.parkArea || 0)}㎡ — 주동을 놓지 않음`);
  add(inf.schoolGeom, { color: '#7a5aa6', fillColor: '#b9a3d6' }, `학교용지 ${fmt(inf.schoolArea || 0)}㎡`);
  add(inf.relGeom, { color: '#7b2cbf', fillColor: '#c9a7e8' }, `종교용지${inf.relC ? '(대체부지)' : '(현 위치 존치)'} ${fmt(inf.relArea || 0)}㎡ — 주동을 놓지 않음`);
  (Array.isArray(inf.lots) ? inf.lots : []).forEach((l, i) => add(l.geom, { color: '#1f2933', weight: 2, dashArray: '6 4', fill: false }, `공동주택 획지${inf.lots.length > 1 ? ' ' + (i + 1) : ''} ${fmt(l.area || turf.area(l.geom))}㎡${l.small ? ' (작아서 배치 제외)' : ''}`));
}
function drawTowersMap(gj, pl) {
  if (pl.rects) {
    const col0 = cssVar('--accent');
    pl.rects.forEach(c => L.polygon(c, { color: col0, weight: 1, fillColor: col0, fillOpacity: 0.85 }).bindTooltip(`${pl.floorsTower}층 · ${P.coreUnits}세대/층 · 높이 약 ${(pl.floorsTower * 2.9).toFixed(0)}m${pl.placedIn === 'lots' ? ' · 공동주택 획지 안' : ''}`, { sticky: true }).addTo(layT));
    S.placed = pl.rects.length; S.placedIn = pl.placedIn; S.placedNeed = pl.towersCalc; S.placedFloors = pl.floorsTower; S.placedFloorsCalc = pl.floorsCalc;
    return;
  }
  const g = gj.geometry;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : [];
  if (!rings.length) return;
  const ring = rings.slice().sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length, lon0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const kx = (111412.84 * Math.cos(lat0 * Math.PI / 180) - 93.5 * Math.cos(3 * lat0 * Math.PI / 180)), ky = (111132.92 - 559.82 * Math.cos(2 * lat0 * Math.PI / 180) + 1.175 * Math.cos(4 * lat0 * Math.PI / 180));
  const pts = ring.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
  const back = ([x, y]) => [lat0 - y / ky, lon0 + x / kx];
  const fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
  const gap = Math.max(fw + 14, 0.8 * pl.floorsTower * 2.9 + fh);
  const col = cssVar('--accent');
  // 기반시설 제안이 있으면 공동주택 획지(구역 − 도로·공원·학교·종교용지 등) 안에만 놓음. 1,000㎡ 미만 작은 획지는 뺌
  const toLocal = r => r.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
  const outer = gm => { const t = gm && (gm.geometry || gm); return !t ? [] : t.type === 'Polygon' ? [t.coordinates[0]] : t.type === 'MultiPolygon' ? t.coordinates.map(c => c[0]) : []; };
  const lots = pl.infra && Array.isArray(pl.infra.lots) && pl.infra.lots.length ? pl.infra.lots.filter(l => l.geom && !l.small).sort((a, b) => b.area - a.area) : null;
  const areas = lots ? lots.flatMap(l => outer(l.geom)).map(toLocal) : [pts];
  let placed = 0;
  for (const poly of areas) {
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
    // 모서리와 변 가운데가 모두 그 땅 안이어야 놓음
    const fits = (x, y) => [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh], [x + fw / 2, y], [x + fw / 2, y + fh], [x, y + fh / 2], [x + fw, y + fh / 2]].every(([px, py]) => inside(px, py, poly));
    for (let y = Math.min(...ys) + (lots ? 3 : 12); y < Math.max(...ys) - fh && placed < pl.towers; y += gap) {
      for (let x = Math.min(...xs) + (lots ? 3 : 10); x < Math.max(...xs) - fw && placed < pl.towers; x += fw + 16) {
        if (!fits(x, y)) continue;
        const c = [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh]];
        L.polygon(c.map(back), { color: col, weight: 1, fillColor: col, fillOpacity: 0.85 }).bindTooltip(`${pl.floorsTower}층 · ${P.coreUnits}세대/층${lots ? ' · 공동주택 획지 안' : ''}`, { sticky: true }).addTo(layT);
        placed++;
      }
    }
  }
  S.placed = placed; S.placedIn = lots ? 'lots' : 'zone'; S.placedNeed = pl.towers;
}
function startMapDraw() {
  if (!LM) return;
  if (drawH) { drawH.disable(); drawH = null; $id('drawBtn').textContent = '구역계 그리기'; return; }
  const R = D.regions[S.region];
  if (R.geojson && !confirm(`${R.name} 구역계를 새로 그릴까요? 지금 구역계는 지워집니다.`)) return;
  if (ZK.picking) ZK.setPicking(false);
  delete ZK.rough[S.region];
  drawH = new L.Draw.Polygon(LM, { allowIntersection: false, showArea: false, shapeOptions: { color: cssVar('--redline'), weight: 3 } });
  drawH.enable();
  $id('drawBtn').textContent = '그리기 취소';
  toast('지도에서 꼭짓점을 찍고, 첫 점을 다시 누르면 완성됩니다');
}
// 왼쪽 도구 막대 버튼 글자(아이콘은 그대로)
function mtLabel(b, t) { if (!b) return; b.setAttribute('aria-label', t); b.dataset.tip = b.dataset.tip ? t + (b.dataset.tip.includes(' — ') ? ' — ' + b.dataset.tip.split(' — ').slice(1).join(' — ') : '') : t; }
function toggleEdit() {
  if (!LM) return;
  const b = $id('editBtn');
  if (editH) { editH.save(); editH.disable(); editH = null; mtLabel(b, '꼭짓점 끌기'); b.classList.remove('on'); drawLeaflet(); return; }
  if (ZK.picking) ZK.setPicking(false);
  if (!editGroup.getLayers().length) { toast('먼저 구역계를 그려 주세요'); return; }
  if (editGroup.getLayers().length > 1 || D.regions[S.region].geojson.geometry.type !== 'Polygon') { toast('여러 덩어리로 된 구역계는 다시 그려 주세요'); return; }
  editH = new L.EditToolbar.Edit(LM, { featureGroup: editGroup });
  editH.enable();
  mtLabel(b, '끌기 끝내기'); b.classList.add('on');
  toast('흰 네모(꼭짓점)를 끌어 고친 뒤 왼쪽의 끌기 끝내기를 누르세요');
}
function importGeoJSONText(text) {
  let j; try { j = JSON.parse(text); } catch (e) { statusMsg('GeoJSON 파일을 읽지 못했습니다.', true); return; }
  const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', properties: {}, geometry: j }];
  const polys = [];
  feats.forEach(f => { const g = f && f.geometry; if (!g) return; if (g.type === 'Polygon') polys.push(g.coordinates); else if (g.type === 'MultiPolygon') polys.push(...g.coordinates); });
  if (!polys.length) { statusMsg('파일에 다각형(Polygon)이 없습니다.', true); return; }
  const c0 = polys[0][0][0];
  if (Math.abs(c0[0]) > 180 || Math.abs(c0[1]) > 90) { statusMsg('경위도(WGS84, EPSG:4326) 좌표의 GeoJSON만 읽을 수 있습니다. 파일 좌표계를 확인해 주세요.', true); return; }
  const merged = safeUnion(polys.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })));
  delete ZK.rough[S.region];
  setZoneGeom(S.region, merged, 0, 'GeoJSON 불러오기');
  fitZone(S.region);
  ZK.checkFit(merged, '불러온 구역계');
}

function parcelFill(p) {
  const old = p.blds.some(b => (b.old === undefined ? obsoleteRule(b).old : b.old));
  if (S.mode === 'old' || S.mode === 'arch') return !p.blds.length ? 'var(--nobuild)' : old ? 'var(--old)' : 'var(--new)';
  if (S.mode === 'small') return p.area < smallLimit(p.zone) ? 'var(--small)' : 'var(--new)';
  if (S.mode === 'access') return p.access == null ? 'var(--nobuild)' : !p.blds.length ? 'var(--nobuild)' : p.access ? 'var(--new)' : 'var(--old)';
  if (S.mode === 'zone') return /2종/.test(p.zone) ? 'var(--accent-soft)' : /3종/.test(p.zone) ? 'var(--warn-soft)' : 'var(--nobuild)';
}
function drawSvg() {
  svg.innerHTML = '';
  svg.classList.toggle('drawing', S.drawing);
  const vb = svg.viewBox.baseVal, u = Math.max(D.W, D.H) / 410;   // 선 굵기 단위
  el('rect', { x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: 'var(--sheet)' });
  D.roads.forEach(r => el('polygon', { points: ringStr(r), fill: 'var(--road)' }));
  const reg = D.regions[S.region];
  const g = el('g', {});
  const inReg = new Set(reg && reg.pts ? regionParcels(S.region).map(p => p.id) : []);
  D.parcels.forEach(p => {
    const dim = reg && reg.pts && !inReg.has(p.id);
    p.rings.forEach(r => {
      const shape = el('polygon', { points: ringStr(r), fill: parcelFill(p), stroke: p.manual && S.mode === 'access' ? 'var(--ink)' : 'var(--roadline)', 'stroke-width': (p.manual && S.mode === 'access' ? 1 : 0.35) * u, opacity: dim ? 0.38 : 1 }, g);
      if (S.mode === 'access' && p.blds.length) { shape.style.cursor = 'pointer'; shape.addEventListener('click', ev => { if (S.drawing) return; ev.stopPropagation(); cycleAccess(p.id); }); }
      const t = el('title', {}, shape);
      t.textContent = `${p.jibun} ${p.jimok || ''} · ${fmt(p.area)}㎡ · ${p.zone || '용도지역 미확인'}\n접도: ${p.accessStr}` +
        (p.blds.length ? p.blds.map(b => `\n${b.use} · ${b.struct} · ${b.year || '연도 없음'} · ${(b.old ?? obsoleteRule(b).old) ? '노후' : '비노후'}`).join('') : '\n건축물 없음');
    });
  });
  for (const k of D.keys) {
    const rr = D.regions[k]; if (k === S.region || !rr.pts) continue;
    el('polygon', { points: ringStr(rr.pts), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 0.8 * u, 'stroke-dasharray': `${3 * u} ${2 * u}`, opacity: 0.5 });
  }
  if (reg && reg.pts) {
    (reg.rings || [reg.pts]).forEach(r => el('polygon', { points: ringStr(r), fill: 'none', stroke: 'var(--redline)', 'stroke-width': 1.8 * u, 'stroke-dasharray': `${7 * u} ${2 * u} ${1.2 * u} ${2 * u}` }));
    const minY = Math.min(...reg.pts.map(q => q[1])), atX = reg.pts.find(q => q[1] === minY)[0];
    const lab = el('text', { x: atX + 3 * u, y: minY + 9 * u, fill: 'var(--redline)', 'font-size': 7.5 * u, 'font-weight': 700, 'font-family': 'IBM Plex Sans KR, sans-serif' }); lab.textContent = reg.name + ' 구역계';
  }
  S.placed = null; S.placedIn = null; S.placedNeed = null; S.placedFloors = null; S.placedFloorsCalc = null;
  if (S.mode === 'arch' && reg && reg.pts) { const a = analyze(S.region); if (a) drawTowers(reg.pts, plan(a), u); }
  if (S.drawing) {
    if (S.draft.length) el('polyline', { points: ringStr(S.draft), fill: 'none', stroke: 'var(--redline)', 'stroke-width': 1.4 * u });
    S.draft.forEach(q => el('circle', { cx: q[0], cy: q[1], r: 2.2 * u, fill: 'var(--redline)' }));
  }
  const bar = Math.pow(10, Math.floor(Math.log10(D.W / 6))), by = vb.y + vb.height - 6 * u, bx = vb.x + 6 * u;
  el('line', { x1: bx, y1: by, x2: bx + bar, y2: by, stroke: 'var(--ink)', 'stroke-width': u });
  const st = el('text', { x: bx, y: by - 3 * u, 'font-size': 6 * u, fill: 'var(--ink)', 'font-family': 'IBM Plex Mono, monospace' }); st.textContent = `0 — ${bar}m`;
  drawLegend();
}
function drawTowers(pts, pl, u) {
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
  const gap = Math.max(fw + 14, 0.8 * pl.floorsTower * 2.9 + fh);
  let placed = 0; const g = el('g', {});
  for (let y = Math.min(...ys) + 12; y < Math.max(...ys) - fh && placed < pl.towers; y += gap) {
    for (let x = Math.min(...xs) + 10; x < Math.max(...xs) - fw && placed < pl.towers; x += fw + 16) {
      const c = [[x, y], [x + fw, y], [x, y + fh], [x + fw, y + fh]]; if (!c.every(([px, py]) => inside(px, py, pts))) continue;
      el('rect', { x, y, width: fw, height: fh, fill: 'var(--accent)', opacity: 0.85, rx: u }, g);
      const t = el('text', { x: x + fw / 2, y: y + fh / 2 + 2.2 * u, 'text-anchor': 'middle', 'font-size': 5.5 * u, fill: 'var(--sheet)', 'font-family': 'IBM Plex Mono, monospace' }, g); t.textContent = pl.floorsTower + 'F';
      placed++;
    }
  }
  S.placed = placed;
}
function drawLegend() {
  const L = document.getElementById('legend');
  const m = {
    old: [['var(--old)', '노후·불량'], ['var(--new)', '비노후'], ['var(--nobuild)', '건축물 없음']],
    small: [['var(--small)', '과소필지(분할제한면적 미만, 주거 60㎡)'], ['var(--new)', '그 외']],
    access: [['var(--new)', '접도 충족'], ['var(--old)', '미충족(폭4m·4m 미만)'], ['var(--nobuild)', D.real ? '미확인·건축물 없음' : '건축물 없음'], [null, `${D.map ? '지도의' : '도면의'} 필지를 누르면 충족 → 미충족 → 자동 순으로 지정`]],
    zone: [['var(--accent-soft)', '제2종일반주거'], ['var(--warn-soft)', '제3종일반주거'], ['var(--nobuild)', '기타·미확인']],
    arch: [['var(--accent)', '개략 주동 배치'], ['var(--old)', '노후·불량(현황)']],
    infra: [['var(--ink-2)', '도로 확폭(제안)'], ['var(--road)', '구역 안 현황 도로'], ['var(--ok)', '공원·녹지(제안)'], ['var(--accent)', '학교용지(제안)'], ['#7b2cbf', '종교용지(존치·대체)'], ['#f2c94c', '공동주택 획지(남는 땅)'], [null, `<label style="cursor:pointer"><input type="checkbox" id="showFac" ${P.showFac ? 'checked' : ''} onchange="P.showFac=this.checked;saveP();render()"> 도시계획시설 결정선(참고) 보기</label>`]],
  }[S.mode];
  L.innerHTML = m.map(([c, t]) => c ? `<span><i style="background:${c}"></i>${t}</span>` : `<span>${t}</span>`).join('') + `<span><svg width="26" height="8" style="vertical-align:0"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--redline)" stroke-width="2" stroke-dasharray="7 2 1.2 2"/></svg> 구역계</span>`;
}
function svgPoint(evt) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(Math.max(0, Math.min(D.W, q.x)) * 10) / 10, Math.round(Math.max(0, Math.min(D.H, q.y)) * 10) / 10]; }
svg.addEventListener('click', e => { if (!S.drawing) return; S.draft.push(svgPoint(e)); document.getElementById('finishBtn').disabled = S.draft.length < 3; drawSvg(); });

