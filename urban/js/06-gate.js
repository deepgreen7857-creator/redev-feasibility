// /urban 정비계획 화면 코드 6/12 — 단지 출입구 GATE(주·부출입구, 주차장 출입구 위치 가정·추천)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 단지 출입구(주·부출입구, 주차장 출입구) — 위치 가정과 기준 검사 =====
 근거(원문 대조 2026-11-01, 국가법령정보센터)
  - 주택건설기준 등에 관한 규정(2026. 9. 8. 시행) 제25조(진입도로) ①③, 제26조(주택단지 안의 도로) ①②④
  - 주차장법 시행규칙(2026. 7. 27. 시행) 제11조① — 부설주차장에 제5조제6호·제7호, 제6조제1항제1~8호 등을 준용.
    제5조제5호(횡단보도 5m·학교 등 20m·폭 4m 미만 도로 금지)는 노외주차장 기준으로 부설주차장에는 준용 조항에 없음 → '참고'
  - 도로와 다른 시설의 연결에 관한 규칙(2021. 8. 27. 시행, 현행) — 일반국도에 연결할 때만 적용(제3조). 별표 4(교차로 연결 금지구간)는 미반영
  - 건축법 시행령 제41조 — 11층 이상 등은 소방자동차 접근 통로 */
const GATE = {
  KIND: { main: '주출입구', sub: '부출입구', park: '주차장 출입구' },
  list(z) { return ((z && z.infra && z.infra.gates) || []); },
  isBig(c) { return num(c.w) >= 25 || /광로|대로/.test(c.dec || ''); },
  // 다각형 테두리를 LineString 여러 개로(구멍·여러 덩어리 포함) — pointToLineDistance·nearestPointOnLine은 LineString만 받음
  lines(f) { try { return turf.flatten(turf.polygonToLine(f)).features.filter(l => l.geometry.type === 'LineString'); } catch (er) { return []; } },
  // 구역(획지) 경계에 붙임 — 찍기·끌어 옮기기 같이 씀
  snap(z, latlng) {
    let pt = [latlng.lat, latlng.lng];
    try {
      let best = null; this.lines(z.geojson).forEach(f => { const n = turf.nearestPointOnLine(f, turf.point([latlng.lng, latlng.lat]), { units: 'meters' }); if (!best || n.properties.dist < best.properties.dist) best = n; });
      if (best) pt = [best.geometry.coordinates[1], best.geometry.coordinates[0]];
    } catch (er) { /* 그대로 */ }
    return pt;
  },
  // 지도에서 끌어 옮긴 출입구 — 경계에 다시 붙이고, 주출입구면 진입도로도 다시 정함
  move(z, i, latlng) {
    const g = (z.infra.gates || [])[i]; if (!g) return;
    g.pt = this.snap(z, latlng); delete g.auto;
    let msg = '';
    if (g.kind === 'main') {
      const r = this.roadAt(z, g.pt);
      if (r) { const ch = z.infra.entryPnu !== r.pnu; z.infra.entryPnu = r.pnu; msg = ch ? ` — 진입도로를 ${r.jibun} 도로(현황 약 ${r.w}m)로 바꿨습니다` : ` — 진입도로는 그대로 ${r.jibun} 도로`; }
      else { delete z.infra.entryPnu; msg = ' — 경계 도로에 닿지 않은 자리라 진입도로가 비었습니다'; }
    }
    this.last = { i, t: Date.now() };
    saveZ(); INFRA.memo = {}; render();
    toast(`${this.KIND[g.kind]}를 옮겼습니다${msg}`, msg ? 5000 : 2500);
  },
  // 주출입구 추천(찍기 전에): 구역 경계를 4m마다 훑어 닿은 경계 도로별로 묶고, 도로마다 교차로에서 가장 먼 경계 지점을 후보 자리로
  //  순위 = 병목(짧게 닿음) 아닌 것 → 제25조① 폭까지 확폭 면적(닿은 길이×모자라는 폭) 적은 것 → 현황 폭 넓은 것. 일방통행·4m 미만·10m 미만 닿은 도로는 뺌
  // 공원·녹지·학교·종교·공공청사 등 획지가 아닌 땅(경계 도로 확폭은 빼고) — 출입구는 공동주택 획지에 닿은 경계에만
  facOf(inf) {
    if (!inf) return null;
    if (inf._facB !== undefined) return inf._facB;
    const gs = [inf.parkGeom, inf.schoolGeom, inf.relGeom, inf.pubB && inf.pubB.geom, inf.other && inf.other.geom, inf.green && inf.green.geom].filter(Boolean);
    let b = null; try { b = gs.length ? safeUnion(gs.map(g => turf.buffer(g.type === 'Feature' ? g : { type: 'Feature', properties: {}, geometry: g }, 3, { units: 'meters' }))) : null; } catch (er) { b = null; }
    inf._facB = b; return b;
  },
  onFac(inf, pt) { const b = this.facOf(inf); if (!b) return false; try { return turf.booleanPointInPolygon(turf.point([pt[1], pt[0]]), b); } catch (er) { return false; } },
  // 경계를 4m마다 훑은 지점을 닿은 도로별로 묶음(획지 아닌 땅의 경계는 뺌) — 주·부·주차장 출입구 추천이 같이 씀
  samples(z, inf) {
    const e = inf && inf.entry;
    if (!z || !z.roads || !z.geojson || !e) return null;
    const key = [z.roads.at, JSON.stringify(BLINE.get(z)), e.W, inf.relArea || 0, inf.parkArea || 0, JSON.stringify(((z.infra || {}).fit) || {}), JSON.stringify(z.geojson.geometry || z.geojson).length, JSON.stringify(((z.infra || {}).edgeOpt) || {})].join('|');
    if (this._smp && this._smp.k === key && this._smp.z === z) return this._smp.v;
    const ix = this.ixOf(z), eo = ((z.infra || {}).edgeOpt) || {}, by = new Map();
    this.lines(z.geojson).forEach(l => {
      let len = 0; try { len = turf.length(l, { units: 'meters' }); } catch (er) { len = 0; }
      for (let d = 2; d < len; d += 4) {
        const c = turf.along(l, d, { units: 'meters' }).geometry.coordinates, pt = [c[1], c[0]], r = this.roadAt(z, pt, 3);
        if (!r || this.onFac(inf, pt)) continue;
        const dIx = ix.length ? Math.min(...ix.map(x => turf.distance(turf.point(c), turf.point([x.pt[1], x.pt[0]]), { units: 'meters' }))) : 999;
        const o = by.get(r.pnu) || { r, s: [] }; o.s.push({ pt, dIx }); by.set(r.pnu, o);
      }
    });
    by.forEach(o => { o.n = o.s.length; o.s.forEach((q, k) => { q.end = Math.min(k, o.n - 1 - k) * 4 + 2; }); });
    this._smp = { k: key, z, v: by }; return by;
  },
  // 주출입구 추천: 병목 아님 → 제25조① 확폭 면적 적음 → 현황 넓음. 자리 = min(교차로 거리, 구간 끝 거리) 최대
  suggest(z, inf) {
    const by = this.samples(z, inf); if (!by) return [];
    const e = inf.entry, eo = ((z.infra || {}).edgeOpt) || {};
    return [...by.values()].map(o => ({ r: o.r, n: o.n, s: o.s.filter(q => !BLINE.noCar(z, o.r, q.dIx)) })).filter(o => o.s.length).map(o => {   // 차량출입 불허구간 밖에서만(BLINE)
      const b = o.s.reduce((m, q) => { const sc = Math.min(q.dIx, q.end); return !m || sc > m.sc ? { ...q, sc } : m; }, null);
      const q = e.per[o.r.pnu] || {}, front = q.front || o.n * 4, lack = Math.max(0, e.W - o.r.w);
      return { kind: 'main', pnu: o.r.pnu, jibun: o.r.jibun, w: o.r.w, dec: o.r.dec || '', pt: b.pt, dIx: b.dIx, front, lack, area: front * lack, partial: !!q.partial, oneway: !!(eo[o.r.pnu] || {}).oneway };
    }).filter(c => !c.oneway && c.w >= 4 && c.front >= 10)
      // 25m 이상(대로급) 도로는 뒤로 — 간선도로에 단지 주출입구를 바로 내면 교차로 간격·가감속 차로 문제가 생겨 보통 그 아래 도로에 둠(참고, 2026-11-04)
      .map(c => Object.assign(c, { big: GATE.isBig(c) }))
      .sort((x, y) => (x.partial - y.partial) || (x.big - y.big) || (x.area - y.area) || (y.w - x.w));
  },
  // 다음에 정할 출입구: 주출입구가 없거나 획지 아닌 땅·도로 없는 자리면 주출입구 → 부출입구 → 주차장 출입구 → 없음
  nextKind(z, inf) {
    const gl = this.list(z), main = gl.find(g => g.kind === 'main');
    if (!main || this.onFac(inf, main.pt) || !this.roadAt(z, main.pt)) return 'main';
    if (!gl.some(g => g.kind === 'sub')) return 'sub';
    if (!gl.some(g => g.kind === 'park')) return 'park';
    return null;
  },
  // 부출입구·주차장 출입구 추천(주출입구를 정한 뒤)
  //  부출입구: 제25조③(진입도로 2개)으로 계산 중이면 두 번째 진입도로 우선 → 주출입구와 다른 도로 → 주출입구에서 먼 자리(최대 150m까지 셈). 폭 4m 이상
  //  주차장 출입구: 차량 동선을 주출입구(보행·주 진입)와 나눔 — 주출입구에서 30m 이상, 교차로에서 먼 자리(30m 이상 우선), 폭 6m 이상(양방향) 우선, 주출입구와 다른 도로 우선, 부출입구와 20m 이상
  suggestFor(z, inf, kind) {
    if (kind === 'main') return this.suggest(z, inf);
    const by = this.samples(z, inf); if (!by) return [];
    const gl = this.list(z), main = gl.find(g => g.kind === 'main'); if (!main) return [];
    const e = inf.entry, eo = ((z.infra || {}).edgeOpt) || {}, mr = this.roadAt(z, main.pt);
    const dist = (a, b) => turf.distance(turf.point([a[1], a[0]]), turf.point([b[1], b[0]]), { units: 'meters' });
    const subs = gl.filter(g => g.kind === 'sub');
    const out = [];
    by.forEach(o => {
      if ((eo[o.r.pnu] || {}).oneway || o.r.w < 4 || o.n * 4 < 10) return;
      const same = !!(mr && mr.pnu === o.r.pnu);
      let b = null;
      o.s.forEach(q => {
        if (kind === 'park' && BLINE.noCar(z, o.r, q.dIx)) return;   // 주차장 출입구는 차량출입 불허구간 밖에서만(부출입구는 보행이라 허용)
        const dm = dist(q.pt, main.pt), ds = subs.length ? Math.min(...subs.map(g => dist(q.pt, g.pt))) : 999;
        let sc;
        if (kind === 'sub') sc = Math.min(Math.min(dm, 150), q.end * 2, q.dIx * 2);
        else { if (dm < 30 || ds < 20) return; sc = Math.min(q.dIx, q.end, dm); }
        if (!b || sc > b.sc) b = { ...q, sc, dm };
      });
      if (!b) return;
      const isE2 = !!(e.mode === 3 && e.e2 && e.e2.pnu === o.r.pnu);
      out.push({ kind, pnu: o.r.pnu, jibun: o.r.jibun, w: o.r.w, dec: o.r.dec || '', pt: b.pt, dIx: b.dIx, dm: b.dm, sc: b.sc, same, isE2, front: o.n * 4 });
    });
    const big = c => GATE.isBig(c) ? 1 : 0;   // 대로급은 뒤로(주출입구와 같은 이유, 참고)
    // 부출입구는 보행·보조 출입이라 간선도로도 괜찮음 → 다른 도로 우선, 그다음 대로급 뒤로
    if (kind === 'sub') return out.sort((x, y) => (y.isE2 - x.isE2) || (x.same - y.same) || (big(x) - big(y)) || (y.sc - x.sc));
    return out.sort((x, y) => ((x.w < 6) - (y.w < 6)) || (big(x) - big(y)) || ((x.dIx < 30) - (y.dIx < 30)) || (x.same - y.same) || (y.sc - x.sc));
  },
  put(z, kind, latlng) {
    const pt = this.snap(z, latlng);
    z.infra.gates = this.list(z).filter(g => kind === 'sub' || kind === 'park' || g.kind !== kind);   // 주출입구는 하나만
    z.infra.gates.push({ kind, pt });
    if (kind === 'park') delete z.infra.parkShared;
    // 주출입구가 닿은 경계 도로 = 진입도로(제25조) → 3탭 진입도로·확폭이 이 도로 기준으로 다시 계산되고 교통성 검토로도 넘어감
    let roadMsg = '';
    if (kind === 'main') {
      const r = this.roadAt(z, pt);
      if (r) { z.infra.entryPnu = r.pnu; roadMsg = ` — 닿은 ${r.jibun} 도로(현황 약 ${r.w}m)를 진입도로로 정했습니다. 3탭 진입도로 확폭이 이 도로 기준으로 바뀝니다`; }
      else roadMsg = ' — 경계 도로에 닿지 않은 자리입니다. 진입도로는 도로에 닿은 경계에 찍어야 정해집니다';
    }
    this.last = { i: z.infra.gates.length - 1, t: Date.now() };
    saveZ(); INFRA.memo = {};
    S.placing = null; $id('lmap').classList.remove('picking');
    toast(`${this.KIND[kind]}를 구역 경계에 놓았습니다${roadMsg}`, roadMsg ? 6000 : 3000); render();
    try { if (LM) LM.panTo([pt[0], pt[1]]); } catch (e) { /* 무시 */ }
    setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
  },
  // 경계 도로끼리 맞닿은 곳 = 교차로(개략). 도로 필지가 닿는 곳의 가운데
  ixOf(z) {
    const k = (z.roads && z.roads.at) || '';
    if (this._ix && this._ix.k === k && this._ix.z === z) return this._ix.v;
    const e = (z.roads && z.roads.edge) || [], v = [];
    for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) {
      try {
        const a = turf.buffer({ type: 'Feature', properties: {}, geometry: e[i].geom }, 2, { units: 'meters' }), b = turf.buffer({ type: 'Feature', properties: {}, geometry: e[j].geom }, 2, { units: 'meters' });
        const x = turf.intersect(a, b); if (x) { const c = turf.centroid(x).geometry.coordinates; v.push({ pt: [c[1], c[0]], a: e[i].jibun, b: e[j].jibun }); }
      } catch (er) { /* 무시 */ }
    }
    this._ix = { k, z, v }; return v;
  },
  // 점에서 max m(기본 15m) 안의 경계 도로(z.roads.edge) 중 가장 가까운 것
  roadAt(z, pt, max = 15) {
    let best = null;
    ((z.roads && z.roads.edge) || []).forEach(r => {
      let d = 99;
      try { const f = { type: 'Feature', properties: {}, geometry: r.geom }, p = turf.point([pt[1], pt[0]]); d = turf.booleanPointInPolygon(p, f) ? 0 : Math.min(99, ...this.lines(f).map(l => turf.pointToLineDistance(p, l, { units: 'meters' }))); } catch (er) { d = 99; }
      if (d <= max && (!best || d < best.d)) best = { r, d };
    });
    return best && best.r;
  },
  // 주차대수: 입력값 → 없으면 법정 하한(shared/criteria/traffic.json parking_housing, 평형별 세대로) → 기준표 전이면 세대당 1대
  parkCount(pl) { if (num(P.parkCount) > 0) return num(P.parkCount); const lp = legalPark(pl); return lp ? lp.legal : Math.round(pl.units * 1.0); },
  // 검사표: st ok/ng/warn/info, law 법정 적용 여부
  check(a, pl) {
    const z = Z.zones[a.key]; if (!z) return { rows: [], gates: [] };
    const gs = this.list(z), inf = pl.infra, ent = inf && inf.entry, eo = (z.infra && z.infra.edgeOpt) || {}, ix = this.ixOf(z);
    const nPark = this.parkCount(pl), rows = [];
    const add = (item, st, text, basis, law = true) => rows.push({ item, st, text, basis, law });
    const gates = gs.map((g, i) => {
      const r = this.roadAt(z, g.pt), dIx = ix.length ? Math.min(...ix.map(x => turf.distance(turf.point([g.pt[1], g.pt[0]]), turf.point([x.pt[1], x.pt[0]]), { units: 'meters' }))) : null;
      return { ...g, i, r, oneway: !!(r && (eo[r.pnu] || {}).oneway), dIx };
    });
    const main = gates.filter(g => g.kind === 'main'), sub = gates.filter(g => g.kind === 'sub'), pk = gates.filter(g => g.kind === 'park');
    gates.filter(g => this.onFac(inf, g.pt)).forEach(g => add(this.KIND[g.kind] + ' 위치', 'ng', '공원·녹지·종교용지·학교 등 공동주택 획지가 아닌 땅의 경계에 있습니다. 아파트 획지에 닿은 경계로 끌어 옮기세요.', '획지 출입(개략 판단)', false));
    // 주출입구
    if (!main.length) add('주출입구', 'warn', '아직 정하지 않았습니다. 아래 버튼을 누르고 지도에서 구역 경계를 누르세요.', '주택건설기준 등에 관한 규정 제25조①', true);
    main.forEach(g => {
      if (!g.r) add('주출입구', 'ng', '경계 도로에 닿지 않습니다(15m 안에 도로 필지 없음).', '제25조① 기간도로·진입도로 접속', true);
      else {
        const isEntry = ent && ent.e1 && g.r.pnu === ent.e1.pnu, isE2 = ent && ent.mode === 3 && ent.e2 && g.r.pnu === ent.e2.pnu;
        add('주출입구 접속 도로', isEntry || isE2 ? 'ok' : 'warn', `${esc(g.r.jibun)} (현황 약 ${g.r.w}m)${isEntry ? ' — 정비계획의 진입도로와 같음' : isE2 ? ' — 두 번째 진입도로' : ` — 정비계획의 진입도로(${ent && ent.e1 ? esc(ent.e1.jibun) : '–'})와 다름. 정비계획 탭에서 진입도로로 고르면 확폭 폭이 이 도로 기준으로 바뀜`}`, '제25조①③', true);
        if (g.oneway) add('주출입구 일방통행', 'warn', `${esc(g.r.jibun)}이 일방통행으로 표시됨 — 진출입 방향이 제한되어 교통 검토에서 위치가 바뀔 수 있음`, '교통영향평가·경찰 협의(참고)', false);
        if (g.dIx != null) add('주출입구 ↔ 교차로', g.dIx < 5 ? 'ng' : g.dIx < 30 ? 'warn' : 'ok', `가장 가까운 경계 도로 교차(개략) ${fmt(g.dIx, 1)}m`, '도로교통법 제32조(모퉁이 5m 주정차 금지) 참고 · 교차로와 가까우면 교통 검토에서 이격 요구가 흔함', false);
      }
    });
    // 차량출입 불허구간(건축선·출입 계획) 안의 차량 출입구
    gates.filter(g => g.kind !== 'sub' && BLINE.noCarAt(z, g.pt)).forEach(g => add(this.KIND[g.kind] + ' ↔ 차량출입 불허구간', 'ng', '건축선·출입 계획의 차량출입 불허구간(지도의 굵은 검은 선) 안입니다. 허용 구간으로 옮기거나 그 도로의 차량출입 설정을 바꾸세요.', '정비계획 건축선·출입 계획(도정법 시행령 제8조제3항제7호, 지구단위계획 차량출입 불허구간)', false));
    // 부출입구
    if (ent && ent.mode === 3) {
      const ok2 = sub.some(g => g.r && ent.e2 && g.r.pnu === ent.e2.pnu) || main.some(g => g.r && ent.e2 && g.r.pnu === ent.e2.pnu);
      add('두 번째 진입도로 출입구', ok2 ? 'ok' : 'warn', ok2 ? `${esc(ent.e2.jibun)}에 출입구 있음` : `제25조③(진입도로 2개)으로 계산 중 — ${ent.e2 ? esc(ent.e2.jibun) : '두 번째 진입도로'}에도 출입구(부출입구)를 두어야 그 기준이 성립`, '제25조③', true);
    } else if (!sub.length) add('부출입구', 'info', '정하지 않음. 법정 의무는 아니나 비상·보행 동선과 교통 분산을 위해 보통 둠', '실무(참고)', false);
    sub.forEach(g => { if (!g.r) add('부출입구', 'warn', '경계 도로에 닿지 않습니다.', '', false); else if (g.r.w < 4) add('부출입구 접속 도로', 'warn', `${esc(g.r.jibun)} 폭 약 ${g.r.w}m — 4m 미만`, '제25조③ 진입도로는 폭 4m 이상(참고)', false); });
    // 주차장 출입구 (부설주차장: 주차장법 시행규칙 제11조① 준용 조항)
    const pkG = pk.length ? pk : main;
    const lp = legalPark(pl);
    add('주차대수(가정)', 'info', `${fmt(nPark)}대${num(P.parkCount) > 0 ? '(입력값)' : lp ? ` — 법정 하한으로 가정: 세대당 최저 ${fmt(lp.minByUnits)}대(전용 60㎡ 이하 ${fmt(lp.u60)}세대 × ${lp.per60} + 그 밖 ${fmt(pl.units - lp.u60)}세대 × ${lp.per}) vs 전용면적 기준 ${fmt(lp.byArea)}대 중 큰 값. 위 칸에 넣으면 바뀜` : ` — 세대당 1대로 가정(${fmt(pl.units)}세대). 위 칸에 넣으면 바뀜`}`, lp ? esc(lp.basis) : '주택건설기준 등에 관한 규정 제27조·지자체 조례로 확정', false);
    add('출입구 너비·분리', nPark >= 50 ? 'info' : 'ok', nPark >= 50 ? '50대 이상: 출구·입구를 나누거나 너비 5.5m 이상 출입구' : '50대 미만: 출입구 너비 3.5m 이상', '주차장법 시행규칙 제6조제1항제4호(제11조① 준용)', true);
    if (nPark > 400) add('출구·입구 따로', pk.length >= 2 ? 'ok' : 'warn', pk.length >= 2 ? `주차장 출입구 ${pk.length}곳` : '400대 초과: 출구와 입구를 따로 설치(너비 합 5.5m 이상이고 차선으로 나누면 함께 가능) — 주차장 출입구를 2곳 이상 표시하거나 분리 계획 필요', '주차장법 시행규칙 제5조제7호(제11조① 준용)', true);
    const roadsN = new Set(((z.roads && z.roads.edge) || []).map(r => r.pnu)).size;
    pkG.forEach(g => {
      if (!g.r) return;
      if (roadsN >= 2) { const widest = Math.max(...z.roads.edge.map(r => r.w)); add('주차장 출입구 도로 선택', 'info', `${esc(g.r.jibun)}(약 ${g.r.w}m)에 둠 — 연결 도로가 둘 이상이면 자동차 교통에 지장이 적은 도로에 설치${g.r.w >= widest - 0.1 && widest >= 15 ? '. 가장 넓은 간선 쪽이면 교통 검토에서 이면도로로 옮기라는 의견이 나올 수 있음' : ''}`, '주차장법 시행규칙 제5조제6호(제11조① 준용)', true); }
      add('주차장 출입구 접속 도로 폭', g.r.w < (nPark >= 200 ? 6 : 4) ? 'warn' : 'ok', `${esc(g.r.jibun)} 약 ${g.r.w}m (${nPark >= 200 ? '200대 이상 6m' : '4m'} 기준)`, '주차장법 시행규칙 제5조제5호다목 — 노외주차장 기준(부설주차장은 준용 조항 아님, 참고)', false);
      if (g.dIx != null) add('주차장 출입구 ↔ 교차로', g.dIx < 5 ? 'ng' : 'ok', `가장 가까운 경계 도로 교차(개략) ${fmt(g.dIx, 1)}m`, '제5조제5호가목(도로교통법 제32조 모퉁이 5m) — 노외 기준, 참고', false);
    });
    add('횡단보도·학교 등 출입구와 거리', 'info', '횡단보도 5m 이내, 유치원·초등학교·노인·장애인복지시설 등 출입구 20m 이내에는 두지 않는 것으로 계획(지도에 횡단보도·학교 출입구 자료가 없어 직접 확인)', '주차장법 시행규칙 제5조제5호나·라목 — 노외 기준, 참고', false);
    // 단지 안 도로·소방
    add('단지 안 도로', 'info', '폭 1.5m 이상 보도를 포함한 7m 이상(100세대 미만·길이 35m 미만 막다른 도로 등은 4m). 설계속도 20km/h 이하', '주택건설기준 등에 관한 규정 제26조①②③', true);
    if (pl.units >= 500) add('어린이 안전보호구역', 'info', `${fmt(pl.units)}세대(500세대 이상) — 단지 안 도로에 어린이 통학버스 정차가 가능한 안전보호구역 1개소 이상`, '제26조④', true);
    if (pl.floorsTower >= 11) add('소방차 접근', 'info', `평균 ${pl.floorsTower}층(11층 이상) — 소방자동차 접근 통로 필요. 출입구 문주·필로티 유효 높이 5m 이상, 회전반경 고려(소방청 가이드라인)`, '건축법 시행령 제41조', true);
    add('일반국도 연결', 'info', '출입구가 닿는 도로가 일반국도이면 연결허가 금지구간(곡선·종단기울기 6%·교차로 금지구간 등)과 변속차로(폭 3.25m 이상) 검토. 시도·구도는 교통 협의에서 참고', '도로와 다른 시설의 연결에 관한 규칙 제3조·제6조·제8조(별표 4 미반영)', false);
    return { rows, gates, nPark };
  },
  draw(layer, a, pl) {
    const z = Z.zones[a.key]; if (!z) return;
    const col = { main: '#c92a2a', sub: '#e67700', park: '#1971c2' };
    try { BLINE.draw(layer, z); } catch (e) { /* 그림만 빠짐 */ }
    // 출입구가 차지하는 땅(건축 불가 — 주출입구 문주·진입광장, 주차장 경사로, 부출입구). /arch·개략 배치와 같은 계산(shared/gate-zones.js, 2026-11-08)
    try {
      const G = window.ArchGeom, gg = z.geojson && (z.geojson.geometry || z.geojson), r0 = gg && (gg.type === 'Polygon' ? gg.coordinates[0] : gg.type === 'MultiPolygon' ? gg.coordinates[0][0] : null);
      if (G && window.GateZones && r0 && this.list(z).length) {
        const ring = G.openRing(r0), pr = G.projector(ring), pts = G.ccw(ring.map(pr.to)), E = G.edges(pts), sbR = (ARCHC && ARCHC.가정 && ARCHC.가정.roadSetback_m) || 3;
        this.list(z).forEach(g => { if (!g.pt) return; const q = pr.to([g.pt[1], g.pt[0]]), ne = GateZones.nearestEdge(E, q); if (!ne || ne.d > 30) return;
          const bp = BLINE.proj(z), sbE = bp && bp.E.length === E.length && bp.edges[ne.edge].r ? bp.edges[ne.edge].sb : sbR;   // 그 변의 건축한계선
          const zz = GateZones.zone(g.kind, q, E[ne.edge], sbE, {});
          L.polygon(zz.poly.map(p => pr.back(p).slice().reverse()), { color: col[g.kind], weight: 1.5, dashArray: '5 3', fillColor: col[g.kind], fillOpacity: 0.15, interactive: false }).addTo(layer);
          if (g.kind === 'main' && GateZones.spine) { const r = GateZones.spine(pts, [zz]); if (r) L.polygon(r.poly.map(p => pr.back(p).slice().reverse()), { color: '#495057', weight: 1.5, fillColor: '#adb5bd', fillOpacity: 0.45 }).bindTooltip(`단지 안 비상차로 폭 ${r.w}m · 길이 약 ${fmt(r.len)}m — 동 배치 안 함(주택건설기준 등에 관한 규정 제26조)`, { sticky: true }).addTo(layer); } });
      }
    } catch (e) { /* 그림만 빠짐 */ }
    // 주출입구가 아직 없으면 추천 자리를 점선 원으로 — 누르면 그 자리에 주출입구를 놓음
    const nk = pl && pl.infra && pl.infra.entry ? this.nextKind(z, pl.infra) : null, sg = nk ? this.suggestFor(z, pl.infra, nk)[0] : null;
    if (sg) {
      const cc = col[nk];
      L.circleMarker(sg.pt, { radius: 14, color: cc, weight: 2.5, dashArray: '4 3', fillColor: '#fff', fillOpacity: 0.6 })
        .bindTooltip(`추천 ${this.KIND[nk]} — ${sg.jibun} 도로(현황 약 ${sg.w}m) · 누르면 여기에 ${this.KIND[nk]}를 놓음`, { sticky: true })
        .on('click', ev => { L.DomEvent.stop(ev); this.put(z, nk, { lat: sg.pt[0], lng: sg.pt[1] }); }).addTo(layer);
      // 이미 놓은 출입구와 40m 안이면 추천 이름표를 위로 올려 겹치지 않게
      const near = this.list(z).some(g => turf.distance(turf.point([g.pt[1], g.pt[0]]), turf.point([sg.pt[1], sg.pt[0]]), { units: 'meters' }) < 40);
      L.marker(sg.pt, { interactive: false, icon: L.divIcon({ className: 'gate-lbl', html: `<span style="background:#fff;color:${cc};border:1.5px dashed ${cc};padding:1px 6px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap">추천 ${this.KIND[nk]}</span>`, iconSize: null, iconAnchor: near ? [-16, 38] : [-16, 10] }) }).addTo(layer);
    }
    this.list(z).forEach((g, i) => {
      const r = g.kind === 'main' || g.kind === 'park' ? this.roadAt(z, g.pt) : null;
      const just = this.last && this.last.i === i && Date.now() - this.last.t < 8000;
      if (just) L.circleMarker(g.pt, { radius: 22, color: col[g.kind], weight: 3, fill: false, className: 'gate-pulse', interactive: false }).addTo(layer);
      // 끌어 옮길 수 있는 점(놓으면 경계에 다시 붙음). 누르면 지움
      const dot = L.divIcon({ className: 'gate-dot', html: `<span style="display:block;width:20px;height:20px;border-radius:50%;background:${col[g.kind]};border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);box-sizing:border-box;cursor:grab"></span>`, iconSize: [20, 20], iconAnchor: [10, 10] });
      const mk = L.marker(g.pt, { icon: dot, draggable: true, autoPan: true, zIndexOffset: 1000 })
        .bindTooltip(`${this.KIND[g.kind]}${r ? ` — ${r.jibun} 도로(현황 약 ${r.w}m)` : ''} · 끌어서 옮기기 · 누르면 지움`, { sticky: true });
      let dragged = false;
      mk.on('dragstart', () => { dragged = true; mk.closeTooltip(); });
      mk.on('dragend', () => { this.move(z, i, mk.getLatLng()); setTimeout(() => { dragged = false; }, 50); });
      mk.on('click', ev => { L.DomEvent.stop(ev); if (dragged) return; const gg = z.infra.gates.splice(i, 1)[0]; if (gg && gg.kind === 'main') delete z.infra.entryPnu; this.last = null; saveZ(); INFRA.memo = {}; render(); });
      mk.addTo(layer);
      L.marker(g.pt, { interactive: false, icon: L.divIcon({ className: 'gate-lbl', html: `<span style="background:${col[g.kind]};color:#fff;padding:2px 7px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">${g.auto ? '추천 ' : ''}${this.KIND[g.kind]}${r && g.kind === 'main' ? ` · 진입도로 ${esc(r.jibun)}` : ''}</span>`, iconSize: null, iconAnchor: [-12, 10] }) }).addTo(layer);
    });
  },
};

/* ===== 건축선·출입 계획 BLINE (2026-11-08 사용자 요구) =====
 "정비계획·지구단위계획은 건축한계선을 둔다 — 건축한계선을 정하는 때 같이 정할 것(차량출입 불허구간·전면공지·공공보행통로·공개공지)을 출입구보다 먼저"
 근거
  - 도정법 시행령 제8조제3항제6호(정비기반시설 설치계획)·제7호(건축물의 건축선에 관한 계획) — 정비계획에 담을 사항
  - 건축법 시행령 제27조의2① — 공개공지 의무는 문화집회·종교·판매·운수(여객)·업무·숙박 바닥면적 5천㎡ 이상(공동주택은 대상 아님 → 기본 없음, 상가 복합 등에서 직접 둠). 면적은 대지 10% 이하 범위에서 조례
  - 건축한계선 거리·교차로 차량출입 불허 거리·공공보행통로 폭은 지구단위계획 결정 사항이라 법정 수치가 없음 → 가정값(바꿀 수 있음, '가정' 표시)
 저장: z.infra.bl = { sb:{pnu:m}, front:{pnu:'walk'|'green'}, car:{pnu:'ix'|'all'|'free'}, ixD, walkW, walks:[{a,b,w}]|undefined(자동), walkOff, open:[{pt,area}] }
 출입구 추천(GATE.suggest·suggestFor)은 주출입구·주차장 출입구를 차량출입 불허구간 밖에서만 고름(부출입구는 보행이라 허용) */
const BLINE = {
  DEF: { ixD: 20, walkW: 6, walkMin: 200 },
  FRONT: { walk: '보도형(보도와 일체 포장·담장 없음)', green: '조경형(녹지·완충)' },
  CAR: { ix: '교차로 부근만 불허', all: '전 구간 불허', free: '허용' },
  st(z) { z.infra = z.infra || {}; return z.infra.bl || (z.infra.bl = {}); },
  get(z) { return (z && z.infra && z.infra.bl) || {}; },
  roads(z) { const m = new Map(); ((z && z.roads && z.roads.edge) || []).forEach(r => { if (r.pnu && !m.has(r.pnu)) m.set(r.pnu, r); }); return [...m.values()]; },
  sbDef() { return (typeof ARCHC !== 'undefined' && ARCHC && ARCHC.가정 && num(ARCHC.가정.roadSetback_m)) || 3; },
  sbOf(z, r) { const v = this.get(z).sb; return v && v[r.pnu] !== undefined && v[r.pnu] !== '' ? num(v[r.pnu]) : this.sbDef(); },
  frontOf(z, r) { const v = (this.get(z).front || {})[r.pnu]; return v || (num(r.w) >= 12 ? 'walk' : 'green'); },
  // 대로급(25m 이상·광로·대로 결정)은 다른 도로가 있으면 전 구간 불허(간선도로에 단지 차량 출입을 바로 내지 않음 — 가정)
  carOf(z, r) { const v = (this.get(z).car || {})[r.pnu]; if (v) return v; return GATE.isBig(r) && this.roads(z).some(x => !GATE.isBig(x)) ? 'all' : 'ix'; },
  ixD(z) { const v = this.get(z).ixD; return v !== undefined && v !== '' ? num(v) : this.DEF.ixD; },
  walkW(z) { const v = this.get(z).walkW; return num(v) > 0 ? num(v) : this.DEF.walkW; },
  // 경계 지점(도로 r에 닿음, 가장 가까운 교차로까지 dIx m)이 차량출입 불허인가
  noCar(z, r, dIx) { if (!r) return false; const c = this.carOf(z, r); return c === 'all' || (c === 'ix' && dIx < this.ixD(z)); },
  noCarAt(z, pt) { const r = GATE.roadAt(z, pt, 4); if (!r) return false; const ix = GATE.ixOf(z); const d = ix.length ? Math.min(...ix.map(x => turf.distance(turf.point([pt[1], pt[0]]), turf.point([x.pt[1], x.pt[0]]), { units: 'meters' }))) : 999; return this.noCar(z, r, d); },
  // 미터 평면: 구역 테두리 변마다 닿은 도로·건축한계선·전면공지·불허 구간(t 범위) — 지도 그림·개략 배치·/arch 넘기기가 같이 씀
  proj(z) {
    const G = window.ArchGeom; if (!G || !z || !z.geojson) return null;
    const gg = z.geojson.geometry || z.geojson, r0 = gg.type === 'Polygon' ? gg.coordinates[0] : gg.type === 'MultiPolygon' ? gg.coordinates.slice().sort((x, y) => turf.area(turf.polygon(y)) - turf.area(turf.polygon(x)))[0][0] : null;
    if (!r0) return null;
    const key = [JSON.stringify(r0).length, r0[0] && r0[0].join(','), (z.roads && z.roads.at) || '', JSON.stringify(this.get(z)), this.sbDef()].join('|');
    if (this._p && this._p.k === key && this._p.z === z) return this._p.v;
    const ring = G.openRing(r0), pr = G.projector(ring), pts = G.ccw(ring.map(pr.to)), E = G.edges(pts);
    const ix = GATE.ixOf(z).map(x => pr.to([x.pt[1], x.pt[0]])), ll = p => { const q = pr.back(p); return [q[1], q[0]]; };
    const edges = E.map(e => {
      const m = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2], r = GATE.roadAt(z, ll(m), 4);
      if (!r) return { r: null, sb: 0, front: null, noCar: [] };
      // 1m마다 불허 여부 → 연속 구간 [t0,t1]
      const n = Math.max(2, Math.ceil(e.len)), runs = []; let st = null;
      for (let k = 0; k <= n; k++) { const t = k / n, p = [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t], d = ix.length ? Math.min(...ix.map(q => Math.hypot(q[0] - p[0], q[1] - p[1]))) : 999, nc = this.noCar(z, r, d);
        if (nc && st === null) st = t; if (!nc && st !== null) { runs.push([st, t]); st = null; } }
      if (st !== null) runs.push([st, 1]);
      return { r, sb: this.sbOf(z, r), front: this.frontOf(z, r), noCar: runs.filter(q => (q[1] - q[0]) * e.len >= 1) };
    });
    const walks = this.walks(z).map(w => { const a = pr.to([w.a[1], w.a[0]]), b = pr.to([w.b[1], w.b[0]]); return Object.assign({}, w, { pa: a, pb: b, poly: this.band(a, b, num(w.w) || this.walkW(z)) }); });
    const open = (this.get(z).open || []).map(o => { const q = pr.to([o.pt[1], o.pt[0]]), ne = window.GateZones ? GateZones.nearestEdge(E, q) : null; if (!ne) return null; const e = E[ne.edge], s = Math.sqrt(Math.max(10, num(o.area))), sb = edges[ne.edge].sb || 0;
      const z0 = GateZones.zone('sub', q, e, sb, { subW: s, subD: s }); return Object.assign({}, o, { poly: [z0.q(-s / 2, sb), z0.q(s / 2, sb), z0.q(s / 2, sb + s), z0.q(-s / 2, sb + s)] }); }).filter(Boolean);
    const v = { pr, pts, E, edges, walks, open, ll };
    this._p = { k: key, z, v }; return v;
  },
  band(a, b, w) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L * w / 2, (b[0] - a[0]) / L * w / 2]; return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]; },
  // 공공보행통로: 사용자가 정한 것 → 없으면 자동 추천(서로 다른 도로 두 곳을 잇는 직선이 구역 안을 지나고 200m 이상일 때 — 큰 가구를 가로지르는 보행로, 가정)
  //  고르는 순서: 통로 가운데가 구역 중심에 가까운 것(대각선으로 모서리를 잇지 않게) → 짧은 것
  walks(z) { const s = this.get(z); if (Array.isArray(s.walks)) return s.walks; if (s.walkOff) return []; const w = this.walkSug(z); return w ? [w] : []; },
  walkSug(z) {
    const k = [(z.roads && z.roads.at) || '', JSON.stringify(z.geojson.geometry || z.geojson).length, this.walkW(z)].join('|');
    if (this._w && this._w.k === k && this._w.z === z) return this._w.v;
    let best = null;
    try {
      const pts = []; GATE.lines(z.geojson).forEach(l => { const len = turf.length(l, { units: 'meters' }); for (let d = 5; d < len; d += 10) { const c = turf.along(l, d, { units: 'meters' }).geometry.coordinates, pt = [c[1], c[0]], r = GATE.roadAt(z, pt, 3); if (r) pts.push({ pt, r }); } });
      const poly = z.geojson.type === 'Feature' ? z.geojson : { type: 'Feature', properties: {}, geometry: z.geojson }, cen = turf.centroid(poly).geometry.coordinates;
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
        if (pts[i].r.pnu === pts[j].r.pnu) continue;
        const d = turf.distance(turf.point([pts[i].pt[1], pts[i].pt[0]]), turf.point([pts[j].pt[1], pts[j].pt[0]]), { units: 'meters' });
        if (d < this.DEF.walkMin) continue;
        const cm = turf.distance(turf.point(cen), turf.point([(pts[i].pt[1] + pts[j].pt[1]) / 2, (pts[i].pt[0] + pts[j].pt[0]) / 2]), { units: 'meters' }), sc = cm * 3 + d;
        if (best && sc >= best.sc) continue;
        let inside = true; for (let f = 0.1; f < 0.95; f += 0.1) { const lat = pts[i].pt[0] + (pts[j].pt[0] - pts[i].pt[0]) * f, lng = pts[i].pt[1] + (pts[j].pt[1] - pts[i].pt[1]) * f; if (!turf.booleanPointInPolygon(turf.point([lng, lat]), poly)) { inside = false; break; } }
        if (inside) best = { d, sc, a: pts[i].pt, b: pts[j].pt };
      }
    } catch (er) { best = null; }
    const v = best ? { a: best.a, b: best.b, w: this.walkW(z), auto: true } : null;
    this._w = { k, z, v }; return v;
  },
  // 지도 찍기: 공공보행통로는 두 점(경계에 붙음), 공개공지는 한 점
  place(z, kind, latlng) {
    const s = this.st(z), pt = GATE.snap(z, latlng);
    if (kind === 'walk') {
      if (!S.blFirst) { S.blFirst = pt; toast('공공보행통로의 다른 쪽 끝(구역 경계)을 누르세요', 4000); render(); return; }
      s.walks = (Array.isArray(s.walks) ? s.walks : []).concat([{ a: S.blFirst, b: pt, w: this.walkW(z) }]); delete s.walkOff; S.blFirst = null;
      toast('공공보행통로를 놓았습니다 — 이 자리에는 동을 놓지 않습니다', 3000);
    } else if (kind === 'open') {
      const a = analyze(S.region); s.open = (s.open || []).concat([{ pt, area: Math.round((a ? a.area : 10000) * 0.05) }]);
      toast('공개공지를 놓았습니다(면적은 오른쪽 칸에서 바꿈)', 3000);
    }
    S.placing = null; $id('lmap').classList.remove('picking'); this.changed();
  },
  // 바꾸면: 추천 출입구만 있으면 새 불허 구간 기준으로 다시 추천(AUTO.ensure), 직접 놓은 출입구는 그대로 두고 검사표에서 알림
  changed() { const z = Z.zones[S.region]; if (z && z.infra && !GATE.list(z).some(g => !g.auto)) delete z.infra.gateAuto; this._p = null; this._w = null; saveZ(); INFRA.memo = {}; GATE._smp = null; render(); },
  // 지도 그림(정비계획 건축선·출입 계획도 표기): 건축한계선 붉은 파선, 전면공지(보도형 연갈색·조경형 연두), 차량출입 불허(굵은 검은 선), 공공보행통로(하늘색 띠), 공개공지(분홍)
  draw(layer, z) {
    const P0 = this.proj(z); if (!P0) return;
    const LL = p => P0.ll(p);
    P0.E.forEach((e, i) => {
      const q = P0.edges[i]; if (!q.r) return;
      const n = [-e.out[0], -e.out[1]], s = q.sb, A = [e.a[0] + n[0] * s, e.a[1] + n[1] * s], B = [e.b[0] + n[0] * s, e.b[1] + n[1] * s];
      if (s > 0) {
        L.polygon([e.a, e.b, B, A].map(LL), { stroke: false, fillColor: q.front === 'walk' ? '#d9b98c' : '#8fc98f', fillOpacity: 0.35, interactive: false }).addTo(layer);
        L.polyline([A, B].map(LL), { color: '#c2255c', weight: 2, dashArray: '8 4' }).bindTooltip(`건축한계선 ${s}m — ${esc(q.r.jibun)} 도로(약 ${q.r.w}m) · 전면공지 ${this.FRONT[q.front]}`, { sticky: true }).addTo(layer);
      }
      q.noCar.forEach(([t0, t1]) => { const a = [e.a[0] + (e.b[0] - e.a[0]) * t0, e.a[1] + (e.b[1] - e.a[1]) * t0], b = [e.a[0] + (e.b[0] - e.a[0]) * t1, e.a[1] + (e.b[1] - e.a[1]) * t1];
        L.polyline([a, b].map(LL), { color: '#212529', weight: 6, opacity: 0.85 }).bindTooltip(`차량출입 불허구간(${this.CAR[this.carOf(z, q.r)]}) — 주출입구·주차장 출입구를 두지 않음`, { sticky: true }).addTo(layer); });
    });
    P0.walks.forEach(w => L.polygon(w.poly.map(LL), { color: '#1c7ed6', weight: 1.5, dashArray: '4 3', fillColor: '#74c0fc', fillOpacity: 0.35 }).bindTooltip(`${w.auto ? '추천 ' : ''}공공보행통로 폭 ${num(w.w) || this.walkW(z)}m — 동 배치 안 함`, { sticky: true }).addTo(layer));
    P0.open.forEach(o => L.polygon(o.poly.map(LL), { color: '#d6336c', weight: 1.5, fillColor: '#faa2c1', fillOpacity: 0.35 }).bindTooltip(`공개공지 약 ${fmt(o.area)}㎡ — 동 배치 안 함`, { sticky: true }).addTo(layer));
    if (S.blFirst) L.circleMarker(S.blFirst, { radius: 7, color: '#1c7ed6', fillColor: '#fff', fillOpacity: 1, weight: 3 }).bindTooltip('공공보행통로 첫 점', { permanent: true }).addTo(layer);
  },
  // 개략 배치·/arch에 넘길 미터 평면 자료: 변별 건축한계선, 건축 불가(공공보행통로·공개공지)
  keepPolys(z) { const P0 = this.proj(z); return P0 ? P0.walks.map(w => w.poly).concat(P0.open.map(o => o.poly)) : []; },
  // /arch 넘기기(경위도): 변마다 양 끝·건축한계선·전면공지·불허 구간, 공공보행통로·공개공지 도형
  exportOf(z) {
    const P0 = this.proj(z); if (!P0) return null;
    return {
      at: new Date().toISOString(),
      edges: P0.E.map((e, i) => { const q = P0.edges[i]; return q.r ? { a: P0.ll(e.a), b: P0.ll(e.b), sb: q.sb, front: q.front, noCar: q.noCar, road: q.r.jibun, w: q.r.w } : null; }).filter(Boolean),
      walks: P0.walks.map(w => ({ poly: w.poly.map(P0.ll), w: num(w.w) || this.walkW(z), auto: !!w.auto })),
      open: P0.open.map(o => ({ poly: o.poly.map(P0.ll), area: o.area })),
    };
  },
};
