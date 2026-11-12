// /urban 정비계획 화면 코드 4/12 — 정비기반시설 INFRA ①: 도로 폭·도로/소유 조회·구역 나누기(block)·크기(계산·그리기는 04b-infra-calc.js)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 정비기반시설 제안 ===== */
// 근거
//  - 공원·녹지: 도시공원 및 녹지 등에 관한 법률 시행규칙 별표 2 제4호 — 도시정비법 정비계획 5만㎡ 이상은
//    1세대당 2㎡ 이상 또는 개발 부지면적의 5% 이상 중 큰 면적
//  - 진입도로: 주택건설기준 등에 관한 규정 제25조제1항 — 총세대수 300 미만 6m, 500 미만 8m, 1천 미만 12m, 2천 미만 15m, 2천 이상 20m
//  - 그 밖의 주변 도로 최소 폭(기본 6m)·학교·기타 시설은 제안값(협의·심의로 정함)
// 도시·군계획시설(도로) 규모별 구분 — 「도시·군계획시설의 결정·구조 및 설치기준에 관한 규칙」(2026. 9. 18. 시행) 제9조제2호: 폭 하한(m), 원문 대조 2026-11-01
const ROADCLS = {
  list: [['광로1류', 70], ['광로2류', 50], ['광로3류', 40], ['광로', 40], ['대로1류', 35], ['대로2류', 30], ['대로3류', 25], ['중로1류', 20], ['중로2류', 15], ['중로3류', 12], ['소로1류', 10], ['소로2류', 8], ['소로3류', 0]],
  std: [8, 10, 12, 15, 20, 25, 30],   // 화면에서 고를 표준 폭(각 등급 하한)
  of(w) { const c = this.list.find(([, lo]) => w >= lo - 0.05); return c ? c[0] : '소로3류'; },
  lower(name) { if (!name) return 0; const c = this.list.find(([n]) => String(name).includes(n)); return c ? c[1] : 0; },
  big(name) { return /광로/.test(name) ? '광로' : /대로/.test(name) ? '대로' : /중로/.test(name) ? '중로' : '소로'; },
};
const INFRA = {
  roadW: [[300, 6], [500, 8], [1000, 12], [2000, 15], [Infinity, 20]],
  // 진입도로가 2 이상일 때(제25조③): 폭 4m 이상 진입도로 2개의 폭 합. 4~6m 도로는 기간도로와 통행거리 200m 이내일 때만 진입도로로 봄
  roadW2: [[300, 10], [500, 12], [1000, 16], [2000, 20], [Infinity, 25]],
  entryWidth(units) { for (const [n, w] of this.roadW) if (units < n) return w; return 20; },
  entryWidth2(units) { for (const [n, w] of this.roadW2) if (units < n) return w; return 25; },
  perim(f) {
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.reduce((s, p) => s + turf.length(turf.lineString(p[0]), { units: 'meters' }), 0);
  },
  // 길쭉한 도로 필지의 폭 추정: 면적 A, 둘레 P인 직사각형의 짧은 변
  width(f) { const A = turf.area(f), Pm = this.perim(f), d = Pm * Pm - 16 * A; return d > 0 ? (Pm - Math.sqrt(d)) / 4 : Math.sqrt(A); },
  loading: {},
  // 구역 경계에 닿은 바깥 도로 필지(지목 '도')를 불러옴 → Z.zones[id].roads
  async fetchRoads(id) {
    const z = Z.zones[id];
    if (!z || !z.geojson || this.loading[id] || !VWorld.enabled) return;
    this.loading[id] = true;
    try {
      const zone = z.geojson;
      const [x0, y0, x1, y1] = turf.bbox(zone), e = 40 / 88000, n = 40 / 111000;
      const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 20);
      const near = turf.buffer(zone, 3, { units: 'meters' });
      const edge = [];
      fs.forEach(f => {
        const sp = splitJibun(f.properties.jibun);
        if (sp.jimok !== '도') return;
        let inR = 0; try { const x = turf.intersect(f, zone); inR = x ? turf.area(x) / turf.area(f) : 0; } catch (er) { inR = 0; }
        if (inR >= 0.5) return;   // 구역 안 도로는 조서(편입 필지)에서 따로 셈
        let touch = false; try { touch = turf.booleanIntersects(near, f); } catch (er) { touch = false; }
        if (!touch) return;
        edge.push({ pnu: f.properties.pnu, jibun: sp.no, w: Math.round(this.width(f) * 10) / 10, geom: f.geometry });
      });
      // 구역 안 도시계획시설(브이월드 도시계획 레이어: 도로·교통·공간·유통공급·공공문화체육·방재·보건위생·환경기초·기타) — 구역 안 부분만
      const fac = [];
      const FAC = { LT_C_UPISUQ151: '도로', LT_C_UPISUQ152: '교통시설', LT_C_UPISUQ153: '공간시설', LT_C_UPISUQ154: '유통공급시설', LT_C_UPISUQ155: '공공문화체육시설', LT_C_UPISUQ156: '방재시설', LT_C_UPISUQ157: '보건위생시설', LT_C_UPISUQ158: '환경기초시설', LT_C_UPISUQ159: '기타기반시설' };
      for (const [lay, grp] of Object.entries(FAC)) {
        let ff = []; try { ff = await VWorld.dataAll(lay, `BOX(${x0},${y0},${x1},${y1})`, 10); } catch (er) { ff = []; }
        ff.forEach(f => {
          let x = null; try { x = turf.intersect(f, zone); } catch (er) { x = null; }
          if (!x || turf.area(x) < 5) return;
          const p = f.properties || {};
          fac.push({ grp, name: p.dgm_nm || p.atr_nam || grp, exc: p.exc_nam || '', grade: p.grad_se || '', area: Math.round(turf.area(x) * 10) / 10, geom: x.geometry });
        });
      }
      z.roads = { key: JSON.stringify(turf.bbox(zone)), edge, fac, facOk: true, at: new Date().toLocaleString('sv-SE').slice(0, 16) };
      saveZ();
      await this.fetchOwn(id);
      z.roads.ownOk = true; z.roads.ownOk2 = true; z.roads.ownOk3 = true; z.roads.ownOk4 = true; z.roads.ownOk5 = true; saveZ();
    } catch (er) { statusMsg(`${id}안: 주변 도로를 불러오지 못했습니다 — ${er.message}`, true); }
    finally { this.loading[id] = false; this.memo = {}; if (S.source === 'map') render(); }
  },
  // 경계 도로가 도시계획도로(UQ151)로 결정돼 있는지 — 결정 등급(소로2류 등)을 edge[].dec에 둠. 가장 많이 겹치는 결정을 씀
  async fetchEdgeDec(id) {
    const z = Z.zones[id]; if (!z || !z.roads || z.roads.edgeDecOk || this.decLoading[id] || !VWorld.enabled) return;
    this.decLoading[id] = true;
    try {
      const [x0, y0, x1, y1] = turf.bbox(z.geojson), e = 60 / 88000, n = 60 / 111000;
      const ff = await VWorld.dataAll('LT_C_UPISUQ151', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 10);
      z.roads.edge.forEach(r => {
        const rf = { type: 'Feature', properties: {}, geometry: r.geom }, ra = turf.area(rf); let best = 0, nm = '';
        ff.forEach(f => { let x = null; try { x = turf.intersect(f, rf); } catch (er) { x = null; } const A = x ? turf.area(x) : 0; if (A > best && A >= ra * 0.3) { best = A; const p = f.properties || {}; nm = (p.dgm_nm || p.atr_nam || '') + (p.exc_nam ? `(${p.exc_nam})` : ''); } });
        r.dec = nm;
      });
      z.roads.edgeDecOk = true; saveZ();
    } catch (er) { /* 다음에 다시 */ }
    finally { this.decLoading[id] = false; this.memo = {}; if (S.source === 'map') render(); }
  },
  decLoading: {},
  // 경계 도로를 폭 w까지 넓힐 때 구역 안에서 새로 도로가 되는 면적(㎡) — 화면 선택지용, 결과를 기억해 둠
  widenArea(r, z, w) {
    const add = w - r.w; if (add < 0.05) return 0;
    const k = `${r.pnu}|${Math.round(add * 100)}|${z.roads && z.roads.at}|${Object.keys(z.inArea || {}).length}`;
    this.waMemo = this.waMemo || {}; if (k in this.waMemo) return this.waMemo[k];
    let A = 0; try { const g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, add, { units: 'meters' }), z.geojson); A = g ? turf.area(g) : 0; } catch (er) { A = 0; }
    return (this.waMemo[k] = A);
  },
  // 구역 안 필지 소유구분(브이월드 토지소유정보: 국유지·시도유지·군유지·개인·법인·종교단체…) — 개인정보(이름)는 받지 않음
  //  국공유 필지는 토지이용상황(도로등·하천등)을 다시 받아 둠
  async fetchOwn(id) {
    const z = Z.zones[id]; if (!z) return;
    const list = Object.keys(z.inArea || {}).filter(k => { const c = CACHE.parcels[k]; return c && (c.own == null || (isPublicOwner(c.own) && (c.chgDate == null || c.bldOver == null || c.bldCore == null || (c.bldCore === 0 && c.bldOver > 0.05)))); });
    let i = 0, done = 0;
    const one = async k => {
      try {
        const d = await jsonp('https://api.vworld.kr/ned/data/getPossessionAttr', { pnu: k, key: VW.key, domain: location.origin, format: 'json', numOfRows: 1, pageNo: 1 });
        const f = d && d.possessions && d.possessions.field && d.possessions.field[0];
        const c = CACHE.parcels[k];
        c.own = f ? (f.posesnSeCodeNm || '') : ''; c.ownInst = f ? (f.nationInsttSeCodeNm || '') : '';
        c.chgCause = f ? (f.ownshipChgCauseCodeNm || '') : ''; c.chgDate = f ? (f.ownshipChgDe || '') : '';
        if (isPublicOwner(c.own) && !c.landUse) { try { const lc = await VW.landChar(k); if (lc) c.landUse = lc.landUse || ''; } catch (er) { /* 무시 */ } }
        // 국공유 필지: GIS 건물 도형이 필지를 얼마나 덮는지(옆 필지에 중심이 있는 건물이 걸쳐 있어도 잡힘)
        if (isPublicOwner(c.own) && (c.bldOver == null || c.bldCore == null) && c.geom) {
          try {
            const pf = { type: 'Feature', properties: {}, geometry: c.geom }, pa = turf.area(pf);
            // 가장자리 1.2m는 처마·지적 경계 어긋남으로 보고, 그 안쪽(core)을 건물이 덮는 비율을 따로 잼
            let core = null; try { core = turf.buffer(pf, -1.2, { units: 'meters' }); } catch (er) { core = null; }
            const ca = core ? turf.area(core) : 0;
            const bs = await VW.dataAll('LT_C_BLDGINFO', `BOX(${turf.bbox(pf).join(',')})`, 2);
            let cover = 0, coverC = 0, n = 0;
            bs.forEach(b => {
              try { const x = turf.intersect(pf, b); if (x && turf.area(x) >= 1) { cover += turf.area(x); n++; } } catch (er) { /* 무시 */ }
              if (core) { try { const y = turf.intersect(core, b); if (y) coverC += turf.area(y); } catch (er) { /* 무시 */ } }
            });
            c.bldOver = pa ? Math.min(1, cover / pa) : 0; c.bldOverN = n; c.bldCore = ca > 3 ? Math.min(1, coverC / ca) : -1; c.bldA = Math.min(pa, cover); c.bldCoreA = ca > 3 ? Math.min(ca, coverC) : null;   // -1: 너무 작거나 좁아 안쪽이 없음 → 전체 겹침으로 판단
          } catch (er) { c.bldOver = null; }
        }
        const p = D.byPnu && D.byPnu.get(k); if (p) { p.own = c.own; p.ownInst = c.ownInst; p.chgCause = c.chgCause; p.chgDate = c.chgDate; p.bldOver = c.bldOver; p.bldOverN = c.bldOverN; p.bldCore = c.bldCore; p.bldA = c.bldA; p.bldCoreA = c.bldCoreA; p.landUse = c.landUse || p.landUse || ''; }
      } catch (er) { /* 다음에 다시 */ }
      done++; if (done % 20 === 0 || done === list.length) statusMsg(`${id}안: 필지 소유구분 확인 ${done}/${list.length}`);
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(async () => { while (i < list.length) await one(list[i++]); }));
    if (list.length) { saveCache(); statusMsg(''); }
  },
  ready(id) { const z = Z.zones[id]; return !!(z && z.roads && z.roads.facOk && z.roads.ownOk5 && z.geojson && z.roads.key === JSON.stringify(turf.bbox(z.geojson))); },
  // 구역 안 한 점(중심이 구역 밖이면 구역 안 아무 점)
  defaultCenter(zone) {
    let c = turf.centerOfMass(zone);
    if (!turf.booleanPointInPolygon(c, zone)) c = turf.pointOnFeature(zone);
    return [c.geometry.coordinates[1], c.geometry.coordinates[0]];
  },
  // 면적 A인 정사각형을 중심점에 놓고 구역(도로 확폭 부분 제외)으로 자름
  // 계획 블록(공원·학교·종교 대체부지): 면적 A인 반듯한 정사각형을 가장 가까운 구역 경계선 방향에 맞춰 돌려 놓고,
  //  구역 밖·도로(minus)에 걸리면 자르지 않고 가까운 빈자리로 밀어 넣음(3m 간격, 최대 60m). 끝내 안 들어가면 걸린 만큼 잘라 냄
  block(center, A, zone, minus, asp0 = 1) {
    if (!(A > 0)) return null;
    try { if (A > turf.area(zone) * 0.8) return null; } catch (er) { return null; }
    const [lat0, lon0] = center, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540, side = Math.sqrt(A);
    const toM = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    // 가장 가까운 선 방향(구역 경계·도로, 그리고 이미 놓인 종교용지·공원 같은 다른 시설의 변)과 나란하게, 그 선 쪽으로 붙임
    let th = 0, best = Infinity, edge = null;
    const outer = g => { const gg = g && (g.geometry || g); return !gg ? [] : gg.type === 'Polygon' ? [gg.coordinates[0]] : gg.type === 'MultiPolygon' ? gg.coordinates.map(p => p[0]) : []; };
    const rings = outer(zone).concat(outer(minus));
    rings.forEach(r => { for (let i = 0; i + 1 < r.length; i++) {
      const a = toM(r[i]), b = toM(r[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 4) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)), d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (d < best) { best = d; th = Math.atan2(dy, dx); edge = [a, b]; }
    } });
    const ca = Math.cos(th), sa = Math.sin(th);
    let hw = side / 2, hh = side / 2;
    const sq = (cx, cy) => turf.polygon([[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]].map(([u, v]) => toLL([cx + u * ca - v * sa, cy + u * sa + v * ca]))]);
    let free = zone; if (minus) { try { free = turf.difference(zone, minus) || zone; } catch (er) { free = zone; } }
    // 들어가는지 확인: 도형 자르기(turf.intersect)는 복잡한 실제 구역계에서 자주 실패해서, 미터 좌표에서 점으로 확인함
    //  사각형 둘레(1.5m 간격)·안쪽(4m 간격) 점이 모두 구역 안·피할 곳(도로 등) 밖이고, 구역·피할 곳의 꼭짓점이 사각형 안에 없으면 들어감
    const ringsOf = g => !g ? [] : (g.geometry || g).type === 'Polygon' ? (g.geometry || g).coordinates.map(r => r.map(toM)) : (g.geometry || g).type === 'MultiPolygon' ? (g.geometry || g).coordinates.flat().map(r => r.map(toM)) : [];
    const zR = ringsOf(zone), mR = ringsOf(minus);
    const inR = (x, y, rs) => { let c = false; rs.forEach(r => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } }); return c; };
    const fitsAt = (cx, cy) => {
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [0, 0]];
      const nu = Math.max(2, Math.ceil(2 * hw / 1.5)), nv = Math.max(2, Math.ceil(2 * hh / 1.5));
      for (let i = 0; i <= nu; i++) { const u = -hw + 2 * hw * i / nu; pts.push([u, -hh], [u, hh]); }
      for (let j = 0; j <= nv; j++) { const v = -hh + 2 * hh * j / nv; pts.push([-hw, v], [hw, v]); }
      for (let u = -hw + 4; u < hw; u += 4) for (let v = -hh + 4; v < hh; v += 4) pts.push([u, v]);
      for (const [u, v] of pts) { const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca; if (!inR(x, y, zR) || (mR.length && inR(x, y, mR))) return false; }
      // 구역·피할 곳 꼭짓점이 사각형 안으로 파고들면 안 됨
      for (const r of zR.concat(mR)) for (const [x, y] of r) { const dx = x - cx, dy = y - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; if (Math.abs(u) < hw - 0.2 && Math.abs(v) < hh - 0.2) return false; }
      return true;
    };
    // 블록 변 바깥이 구역 경계까지 얕게(평균 12m 이하, 최대 25m 안에서 경계에 닿음) 남고 장애물이 없으면,
    //  그 변의 양 끝선을 곧게 연장해 경계까지 채움 → 시설 모양은 반듯한 변 + 구역 경계로만 이루어짐
    const extend = (cx, cy) => {
      const add = [];
      for (const [nu, nv, d, l] of [[1, 0, hw, hh], [-1, 0, hw, hh], [0, 1, hh, hw], [0, -1, hh, hw]]) {
        const E = 25;
        const loc = nu ? [[nu * d, -l], [nu * (d + E), -l], [nu * (d + E), l], [nu * d, l]] : [[-l, nv * d], [-l, nv * (d + E)], [l, nv * (d + E)], [l, nv * d]];
        const W = ([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
        // 먼 끝(25m)이 모두 구역 밖이어야 함(그 안에서 경계에 닿음)
        let farOut = true;
        for (let k = 0; k <= 10 && farOut; k++) { const t = -l + 2 * l * k / 10, [x, y] = W(nu ? [nu * (d + E), t] : [t, nv * (d + E)]); if (inR(x, y, zR)) farOut = false; }
        if (!farOut) continue;
        const band = turf.polygon([[...loc, loc[0]].map(q => toLL(W(q)))]);
        let inZ = null, inF = null;
        try { inZ = turf.intersect(band, zone); inF = inZ ? (minus ? turf.intersect(band, free) : inZ) : null; } catch (er) { continue; }
        if (!inZ || turf.area(inZ) < 1 || !inF) continue;
        const aZ = turf.area(inZ);
        if (turf.area(inF) < aZ * 0.98) continue;   // 사이에 도로·다른 시설이 있으면 연장 안 함
        if (aZ / (2 * l) > 12) continue;            // 평균 깊이 12m 넘으면 쓸 수 있는 땅이라 그대로 둠
        add.push(inZ);
      }
      const g = sq(cx, cy);
      if (!add.length) return g;
      try { return safeUnion([g, ...add]); } catch (er) { return g; }
    };
    // 경계까지 채우느라 면적이 늘면, 경계에 붙은 변은 그대로 두고 블록을 얇게 해서 정한 면적(A)에 맞춤
    //  n: 블록이 붙은 경계 쪽 방향(없으면 가운데를 기준으로 얇게)
    const keepArea = (x, y, n) => {
      const g0 = extend(x, y);
      if (!(turf.area(g0) > A * 1.02)) return g0;
      const hh0 = hh;
      let lo = hh0 * 0.2, hi = hh0, best = g0;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2; hh = mid;
        const sx = n ? x + n[0] * (hh0 - mid) : x, sy = n ? y + n[1] * (hh0 - mid) : y;
        const g = extend(sx, sy), a = turf.area(g);
        if (a >= A) { hi = mid; best = g; } else lo = mid;
        if (Math.abs(a - A) < A * 0.005) break;
      }
      hh = hh0;
      return best;
    };
    // 찾은 자리에서 가장 가까운 선(구역 경계·다른 시설) 쪽으로 붙임 — 사이가 8m 안쪽이라 못 쓰는 띠가 남을 때만
    const flush = (cx, cy) => {
      if (!edge) return keepArea(cx, cy, null);
      const [a, b] = edge, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      let nx = -dy / L, ny = dx / L;   // 경계선의 법선
      if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) { nx = -nx; ny = -ny; }   // 블록 → 경계선 방향
      let x = cx, y = cy;
      // 8m보다 멀면 붙이지 않음(그 사이는 쓸 수 있는 땅이라 놓은 자리를 그대로 둠). 8m 안이면 끝까지 붙임
      let moved = 0;
      for (let s = 0; s < 18; s++) { if (!fitsAt(x + nx * 0.5, y + ny * 0.5)) break; x += nx * 0.5; y += ny * 0.5; moved += 0.5; }
      if (moved >= 8.5) return keepArea(cx, cy, null);
      return keepArea(x, y, [nx, ny]);
    };
    // 정사각형 → 1:1.5 → 1:2(경계선 방향으로 길게) 순으로, 가까운 자리부터 최대 120m까지 찾음
    // 놓은 자리 둘레 120m 안에 없으면(구역 밖에 놓았거나 모퉁이라 막힌 경우) 구역 가운데에서 구역 전체를 다시 찾음
    const [zx0, zy0, zx1, zy1] = turf.bbox(zone), zc = toM([(zx0 + zx1) / 2, (zy0 + zy1) / 2]);
    const reach = Math.hypot((zx1 - zx0) * kx, (zy1 - zy0) * ky) / 2 + side;
    for (const [ox, oy, R] of [[0, 0, 120], [zc[0], zc[1], reach]]) {
      for (const asp of [...new Set([asp0, 1, 1.5, 2])]) {
        hw = side * Math.sqrt(asp) / 2; hh = side / Math.sqrt(asp) / 2;
        for (let r = 0; r <= R; r += r < 30 ? 3 : 6) {
          const n = r ? Math.max(8, Math.round(r / 2)) : 1;
          for (let k = 0; k < n; k++) {
            const cx = ox + r * Math.cos(2 * Math.PI * k / n), cy = oy + r * Math.sin(2 * Math.PI * k / n);
            if (fitsAt(cx, cy)) return flush(cx, cy);
          }
        }
      }
    }
    // 끝내 다 들어가는 자리가 없으면 놓은 자리에서 걸린 만큼 잘라 냄(잘라 내기가 실패하면 사각형 그대로)
    hw = side * Math.sqrt(asp0) / 2; hh = side / Math.sqrt(asp0) / 2;
    let g = null; try { g = turf.intersect(sq(0, 0), free); } catch (er) { g = null; }
    return g || (inR(0, 0, zR) ? sq(0, 0) : null);
  },
  // 공원·학교·종교용지 면적 정하기: 자동 / 면적(㎡) / 구역 대비 %(배율) + 가로:세로 비율. z.infra.sz[kind] = { mode, val, asp }
  sizeOf(z, kind, auto, zoneA) {
    const st = ((z.infra || {}).sz || {})[kind] || {};
    const v = num(st.val);
    // 잘못 넣은 값(구역 대비 100% 넘음, 구역의 80% 넘는 면적)은 쓰지 않고 자동값으로 — 계산이 멈추지 않게
    let A = st.mode === 'area' && v > 0 ? v : st.mode === 'pct' && v > 0 && v <= 100 ? zoneA * v / 100 : auto;
    const bad = (st.mode === 'pct' && v > 100) || A > zoneA * 0.8;
    if (bad) A = Math.min(auto, zoneA * 0.8);
    return { A, mode: st.mode || 'auto', val: st.val ?? '', asp: num(st.asp) || 1, bad };
  },
  memo: {},
};
