// /urban 정비계획 화면 코드 4b — 정비기반시설 INFRA 계산·그리기(compute 면적·위치 제안, draw 지도 그리기, 띠·경계선, 기존 시설 판정, 옮기기·놓기)
// 2026-11-13 04-infra.js(6만 8천 자)에서 떼어 냄 — INFRA 묶음의 뒷부분 기능을 Object.assign으로 같은 INFRA에 붙임(속성 순서·this 그대로)
// 도로 폭·조회·구역 나누기(block)·크기는 04-infra.js. 파일 지도: CLAUDE.md '/urban 파일 지도'
//@@HEADER-END
'use strict';
Object.assign(INFRA, {
  // a: analyze 결과, units: 계획 세대수 → { items, total, ratio, roadsReady }
  // opt.roadAdd: 확보 목표에 모자라는 면적 — 경계 도로를 모두 같은 폭만큼 더 넓혀 채움(두 번째 계산)
  compute(a, units, opt = {}) {
    const id = a.key, z = Z.zones[id];
    if (!D.map || !z || !z.geojson) return null;
    const mk = [id, units, opt.roadAdd || 0, a.area, P.infraMode, P.autoAbsorb, P.parkMode, P.sideRoadW, P.schoolArea, P.otherInfra, P.greenInfra, P.pubBldg, P.valMult, P.roadWork, P.parkWork, P.keepInnerRoads, JSON.stringify(z.infra || {}), z.roads && z.roads.at, Object.keys(z.inArea || {}).length].join('|');
    if (this.memo[mk]) return this.memo[mk];
    const zone = z.geojson, items = [];
    const W = this.entryWidth(units), sideW = num(P.sideRoadW) || 8;
    // 구역 안 기존 도로(지목 '도' 등 공공 지목) — 경계 도로 확폭량을 정할 때도 씀
    // 기존 정비기반시설 판단: 국가·지자체 소유 + 실제 기반시설로 쓰이는지 근거를 모아 판정, 화면에서 넣기/빼기로 확정
    const giAll = this.judgeExisting(a, z), giDec = ((z.infra || {}).giDec) || {};
    giAll.forEach(g => { g.dec = giDec[g.p.pnu] || ''; g.include = g.dec ? g.dec === 'in' : (g.grade === '확실' || g.grade === '확인 필요' || g.grade === '가능성 높음'); });
    // 재산관리 부서 회신(z.infra.giReply[pnu]): use 공공용 사용 · occupy 점유(대부·무단) · mismatch 지적 불부합(건물이 실제로는 필지 밖) · general 일반재산(공공용 아님)
    //  지적 불부합이면 건물 점유를 빼지 않음, 일반재산이면 자동 판정 대신 뺌(직접 '넣기'를 고르면 그대로)
    const giReply = ((z.infra || {}).giReply) || {};
    giAll.forEach(g => { g.reply = giReply[g.p.pnu] || ''; if (g.reply === 'mismatch') { g.occ = 0; g.useA = g.area; } if (g.reply === 'general' && !g.dec) g.include = false; });
    const inner = giAll.filter(g => g.include).map(g => g.p);
    // innerFull: 넣은 필지 면적 전체(존치할 때 토지이용계획에 그대로 셈) · innerOcc: 그 안 건물 점유 · innerArea: 사용 중인 부분(확보 목표·무상양도 기준)
    const giIn = giAll.filter(g => g.include);
    const innerFull = giIn.reduce((s, g) => s + g.area, 0), innerOcc = giIn.reduce((s, g) => s + (g.occ || 0), 0);
    const innerArea = Math.max(0, innerFull - innerOcc);
    // 1) 도로: 구역 경계 도로마다 '추천 계획 폭'을 잡아 모자라는 만큼 구역 쪽으로 확폭(기부채납) — 사용자가 도로별로 고름
    //  추천 = max(현황, 최소 폭(기본 8m·소로2류 하한), 일방통행이면 10m, 도시계획도로로 결정돼 있으면 그 등급 하한, 진입도로면 제25조 폭)
    //  → 같은 등급 안에서 모자라는 폭만 채우고 무작정 넓히지 않음. 다른 폭(다음 등급 등)은 화면에서 면적을 보고 고름
    //  z.infra.edgeOpt[pnu]: pw 직접 고른 계획 폭, keep 현황 유지
    //  '구역 안 기존 도로 면적만큼 확폭'을 켜면 모든 경계 도로를 같은 폭(+x m)만큼 더 넓혀 늘어난 면적을 기존 도로 면적에 맞춤
    let roadGeom = null, widenExtra = 0, entry = null;
    if (z.roads) {
      // 경계 도로별 설정(z.infra.edgeOpt[pnu]: oneway 일방통행 → 진입도로 후보에서 뺌, green 건너편 녹지 있음)
      //  진입도로는 직접 고른 도로(z.infra.entryPnu) → 없으면 일방통행이 아닌 가장 넓은 도로. 교통 검토 전까지는 '가정'
      const eo = (z.infra && z.infra.edgeOpt) || {}, pick = z.infra && z.infra.entryPnu;
      const all = z.roads.edge.slice().sort((x, y) => y.w - x.w);
      // 진입도로 후보: 일방통행이 아니고 구역에 10m 이상 닿은 도로(모퉁이만 스치는 넓은 도로는 진입도로로 보지 않음)
      //  닿은 길이 ≈ 1m 넓힐 때 구역 안에서 새로 도로가 되는 면적
      const front = r => this.widenArea(r, z, r.w + 1);
      // 부분 확폭(병목) 걸러내기: 구역에 닿은 길이 30m 미만이거나 그 도로 필지 길이(≈면적÷폭)의 50% 미만이면 '짧게 닿음'
      //  → 자동 추천에서 넓히지 않음(현황 유지). 짧은 구간만 넓히면 병목 모양이라 교통 기능이 없고, 도로 전체 확폭은 도시계획도로 결정으로 따로 검토
      const touch = new Map(all.map(r => {
        const f = front(r); let len = 0;
        try { len = turf.area({ type: 'Feature', properties: {}, geometry: r.geom }) / Math.max(r.w, 1); } catch (er) { len = 0; }
        return [r.pnu, { front: f, len, partial: f < 30 || (len > 0 && f < len * 0.5) }];
      }));
      const partialOf = r => (touch.get(r.pnu) || {}).partial;
      const cand = all.filter(r => !(eo[r.pnu] || {}).oneway && front(r) >= 10);
      const e1 = all.find(r => r.pnu === pick) || cand[0] || all[0];
      // ③ 두 번째 진입도로: 일방통행이 아니고 폭 6m 이상(4~6m는 기간도로까지 200m 이내인지 몰라 자동으로는 고르지 않음), 짧게 닿은 도로(partial)는 빼고
      const e2 = cand.filter(r => r !== e1 && r.w >= 6 && r.pnu !== pick && !partialOf(r))[0] || null;
      const W2 = this.entryWidth2(units);
      // 추천 폭은 기능상 필요한 폭만: 최소 폭·일방통행·도시계획도로 결정 등급 하한(진입도로 제25조 폭은 아래에서). 짧게 닿은 도로는 현황 유지
      const baseOf = r => partialOf(r) ? r.w : Math.max((eo[r.pnu] || {}).oneway ? Math.max(sideW, 10) : sideW, ROADCLS.lower(r.dec));
      const pwOf = (r, base) => { const o = eo[r.pnu] || {}; return num(o.pw) > 0 ? num(o.pw) : o.keep ? r.w : Math.max(base, r.w); };
      const needOf = mode => {
        const m = new Map(all.map(r => [r, pwOf(r, baseOf(r))]));
        if (mode === 1) m.set(e1, Math.max(W, pwOf(e1, Math.max(W, sideW))));
        else if (e2) { const lack = Math.max(0, W2 - (e1.w + e2.w)); m.set(e1, Math.max(pwOf(e1, sideW), e1.w + lack / 2)); m.set(e2, Math.max(pwOf(e2, sideW), e2.w + lack / 2)); }
        return m;
      };
      const edge = all;
      const build = (extra, need) => {
        const its = []; let un = null;
        edge.forEach(r => {
          const nd = need.get(r), add = Math.max(0, nd - r.w) + extra;
          if (add < 0.3) return;
          let g = null;
          try { g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, add, { units: 'meters' }), zone); } catch (er) { g = null; }
          if (!g || turf.area(g) < 1) return;
          un = un ? safeUnion([un, g]) : g;
          const kind = r === e1 ? 'entry' : (r === e2 && need === need3 ? 'entry2' : 'side');
          its.push({ kind, partial: kind === 'side' && partialOf(r), jibun: r.jibun, from: r.w, to: Math.round((Math.max(r.w, nd) + extra) * 10) / 10, extra, manual: num((eo[r.pnu] || {}).pw) > 0, oneway: !!(eo[r.pnu] || {}).oneway, dec: r.dec || '', area: turf.area(g), geom: g });
        });
        return { its, un, A: un ? turf.area(un) : 0 };
      };
      const need1 = needOf(1), need3 = e2 ? needOf(3) : null;
      const b1 = edge.length ? build(0, need1) : { its: [], un: null, A: 0 }, b3 = need3 ? build(0, need3) : null;
      // 기준: 자동이면 확폭 면적이 적은 쪽(같으면 ①), 직접 고르면 그 기준
      const em = (z.infra && z.infra.entryMode) || 'auto';
      const use3 = !!b3 && (em === '3' || (em === 'auto' && b3.A < b1.A - 1));
      let b = use3 ? b3 : b1; const need = use3 ? need3 : need1;
      entry = { mode: use3 ? 3 : 1, W, W2, e1: e1 ? { pnu: e1.pnu, jibun: e1.jibun, w: e1.w } : null, e2: e2 ? { pnu: e2.pnu, jibun: e2.jibun, w: e2.w } : null,
        A1: b1.A, A3: b3 ? b3.A : null, ok3: e2 ? e1.w + e2.w >= W2 : false, picked: !!(pick && e1 && e1.pnu === pick), em, opt: eo, sideW, per: {}, need: new Map([...need].map(([r, v]) => [r.pnu, v])) };
      // 도로별 계획 폭·확폭 면적·1m 더 넓힐 때 늘어나는 면적(부족분을 어느 도로로 채울지 판단용)
      edge.forEach(r => {
        const nd = need.get(r), add = Math.max(0, nd - r.w);
        const ar = d => { if (d < 0.05) return 0; try { const g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, d, { units: 'meters' }), zone); return g ? turf.area(g) : 0; } catch (er) { return 0; } };
        const a0 = ar(add);
        const o = eo[r.pnu] || {}, rec = (r === e1 && entry.mode === 1) ? Math.max(W, baseOf(r), r.w) : Math.max(baseOf(r), r.w);
        entry.per[r.pnu] = { pw: Math.round(nd * 10) / 10, add: Math.round(add * 10) / 10, area: a0, perM: ar(add + 1) - a0, manual: num(o.pw) > 0, keep: !!o.keep, rec: Math.round(rec * 10) / 10, dec: r.dec || '', front: (touch.get(r.pnu) || {}).front || 0, len: (touch.get(r.pnu) || {}).len || 0, partial: !!partialOf(r) };
      });
      if (opt.roadAdd > 1 && edge.length) {
        const target = b.A + opt.roadAdd;
        let lo = 0, hi = 2, best = b;
        while (hi < 40) { const t = build(hi, need); if (t.A >= target) break; hi *= 2; }
        for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2, t = build(m, need); if (t.A >= target) { hi = m; best = t; } else lo = m; if (Math.abs(t.A - target) < target * 0.01) { best = t; break; } }
        b = best; widenExtra = Math.round(hi * 10) / 10;
      }
      roadGeom = b.un; b.its.forEach(it => items.push(it));
    }
    // 직접 잘라 도로로 지정한 조각
    (z.infra && z.infra.manualRoads || []).forEach((g, k) => {
      let f = null; try { f = turf.intersect({ type: 'Feature', properties: {}, geometry: g }, zone); } catch (er) { f = null; }
      if (!f || turf.area(f) < 1) return;
      roadGeom = roadGeom ? safeUnion([roadGeom, f]) : f;
      items.push({ kind: 'manual', idx: k, jibun: '직접 지정', from: 0, to: 0, area: turf.area(f), geom: f });
    });
    let roadArea = roadGeom ? turf.area(roadGeom) : 0;
    // 종교용지(존치·대체): 종교시설 건물이 선 필지. 법정 의무는 아니나 실무상 정비계획에서 미리 잡음
    const Rg = D.regions[id] || {}, infO = z.infra || {}, relOff = infO.relOff || {};
    const relAll = a.ps.filter(p => ((Rg.blds || {})[p.pnu] || []).some(b => b.religion));
    const rel = relAll.filter(p => !relOff[p.pnu]);
    const relLand = rel.reduce((s, p) => s + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    // 예전 '종교용지 면적' 직접 입력값은 면적 지정으로 옮김
    if (infO.relArea != null && infO.relArea !== '' && !(infO.sz && infO.sz.rel)) { infO.sz = infO.sz || {}; infO.sz.rel = { mode: 'area', val: num(infO.relArea) }; delete infO.relArea; }
    const szRel = this.sizeOf(z, 'rel', relLand, a.area);
    let relArea = szRel.A;
    let relGeom = null;
    const relC = infO.relC || null;   // 있으면 대체부지(그 자리에 종교용지 면적만큼), 없으면 현 위치 존치(필지 그대로)
    if (relC && relArea > 0) relGeom = this.block(relC, relArea, zone, roadGeom, szRel.asp);
    else if (rel.length) { try { relGeom = turf.intersect(safeUnion(rel.filter(p => p.geom).map(p => ({ type: 'Feature', properties: {}, geometry: p.geom }))), zone); } catch (er) { relGeom = null; } }
    // 2) 공원·녹지
    const legal = a.area >= 50000;
    // 구역 안 기 조성 공원·녹지(지목 공원 또는 이용상황 공원): 기본계획(고시 제2026-96호) — 제척 원칙, 포함하면 기존 면적 이상 설치
    const parkExist = a.ps.filter(p => /^공(원)?$/.test(p.jimok || '') || /공원/.test(p.landUse || '')).reduce((s2, p) => s2 + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    const parkLegal = Math.max(legal ? Math.max(units * 2, a.area * 0.05) : (P.parkMode === 'always' ? a.area * parkPctOf() / 100 : 0), parkExist);
    const szPark = this.sizeOf(z, 'park', parkLegal, a.area), parkNeed = szPark.A;
    const inf = z.infra || {};
    const parkC = inf.parkC || this.defaultCenter(zone);
    const avoid0 = roadGeom && relGeom ? safeUnion([roadGeom, relGeom]) : (roadGeom || relGeom);
    // 배치 방식(감싸기·곧게·스케치·손그림, urban/placefit.js) — 고르면 정사각형 블록 대신 그 방식으로 놓음. z.infra.fit[kind]
    const fitO = inf.fit || {}, fitMsg = {};
    const fitOn = k => !!(fitO[k] && fitO[k].mode && fitO[k].mode !== 'auto' && window.PlaceFit);
    const fitRun = (k, target, anchors, occ) => {
      const o = fitO[k], anc = anchors[o.anchor || 'rel'] || null;
      let r = null; try { r = PlaceFit.run(o, { zone, anchorGeom: anc, occupied: occ.filter(g => g && g !== anc), target }); } catch (er) { r = { geom: null, ok: false, msg: '배치 계산 중 오류 — 자동 배치로 놓았습니다' }; }
      fitMsg[k] = r ? { ok: !!(r && r.ok && r.geom), msg: r.msg } : null;
      return r && r.geom ? r.geom : null;
    };
    let parkGeom = fitOn('park') ? fitRun('park', parkNeed, { rel: relGeom }, [roadGeom, relGeom]) : null;
    if (!parkGeom) parkGeom = this.block(parkC, parkNeed, zone, avoid0, szPark.asp);
    // 공원과 종교 대체부지가 맞닿거나 12m 안으로 가까우면 한 띠로 묶음: 가까운 구역 경계와 나란한 곧은 안쪽 선 하나로,
    //  두 시설 면적의 합만큼 깊이를 정하고 경계에 수직인 선 하나로 나눔(각자 정한 면적)
    let paired = false;
    if (relC && parkGeom && relGeom && !infO.noPair && !fitOn('park')) {
      try {
        if (turf.booleanIntersects(turf.buffer(parkGeom, 12, { units: 'meters' }), relGeom)) {
          // 처음 묶일 때 고른 기준 경계 변을 기억해 두고 계속 씀(만질 때마다 다른 변으로 바뀌지 않게)
          const pr = this.pairBand(zone, roadGeom, [['park', parkGeom, parkNeed], ['rel', relGeom, relArea]], infO.pairSplit, infO.pairEdge);
          if (pr) {
            parkGeom = pr.park; relGeom = pr.rel; paired = pr.pair;
            if (JSON.stringify(infO.pairEdge) !== JSON.stringify(pr.pair.edgeLL)) { infO.pairEdge = pr.pair.edgeLL; z.infra = infO; saveZ(); }
          }
        }
      } catch (er) { paired = false; }
    }
    // 3) 학교·기타
    const szSchool = this.sizeOf(z, 'school', num(P.schoolArea), a.area), schoolA = szSchool.A;
    const schoolC = inf.schoolC || (() => { const [la, lo] = parkC; return [la, lo + (Math.sqrt(parkNeed || 1) + Math.sqrt(schoolA || 1)) / 2 / (Math.cos(la * Math.PI / 180) * 111320)]; })();
    let schoolGeom = fitOn('school') && schoolA > 0 ? fitRun('school', schoolA, { rel: relGeom, park: parkGeom }, [roadGeom, relGeom, parkGeom]) : null;
    if (!schoolGeom) schoolGeom = this.block(schoolC, schoolA, zone, avoid0 ? (parkGeom ? safeUnion([avoid0, parkGeom]) : avoid0) : parkGeom, szSchool.asp);
    // 시설 블록 때문에 큰 획지와 떨어져 갇힌 작은 조각이 남으면 맞닿은 시설에 붙여 빈 땅이 생기지 않게 함
    let absorbed = 0;
    { const blocks = [['park', parkGeom], ['school', schoolGeom]].concat(relC ? [['rel', relGeom]] : []).filter(b => b[1]);
      if (blocks.length && P.autoAbsorb !== false) {
        let rest = null;
        try { rest = turf.difference(zone, safeUnion([...(roadGeom ? [roadGeom] : []), ...(!relC && relGeom ? [relGeom] : []), ...blocks.map(b => b[1])])); } catch (er) { rest = null; }
        // 큰 공동주택 획지와 떨어져 갇힌 1,000㎡ 미만 조각(시설과 구역 경계 사이 모퉁이 등)만 가장 많이 맞닿은 시설에 붙임
        //  (가는 띠는 블록을 8m 안에서 경계에 붙여 생기지 않게 함 — 큰 획지와 이어진 땅은 건드리지 않음)
        const cs = rest ? (rest.geometry.type === 'Polygon' ? [rest.geometry.coordinates] : rest.geometry.coordinates) : [];
        const pieces = cs.map(c => turf.polygon(c)).map(g => ({ g, A: turf.area(g) })).filter(x => x.A >= 1).sort((x, y) => y.A - x.A);
        const add = {};
        pieces.slice(1).forEach(({ g: pc, A }) => {
          if (A >= 1000) return;
          let near = null, bestC = 0;
          try {
            const pb = turf.buffer(pc, 1, { units: 'meters' });
            blocks.forEach(b => { let c = 0; try { const x = turf.intersect(pb, b[1]); c = x ? turf.area(x) : 0; } catch (er) { c = 0; } if (c > bestC) { bestC = c; near = b; } });
          } catch (er) { near = null; }
          if (!near) return;
          (add[near[0]] = add[near[0]] || []).push(pc); absorbed += A;
        });
        const grow = (g, k) => (add[k] ? safeUnion([g, ...add[k]]) : g);
        parkGeom = parkGeom && grow(parkGeom, 'park'); schoolGeom = schoolGeom && grow(schoolGeom, 'school'); if (relC && relGeom) relGeom = grow(relGeom, 'rel');
      } }
    // 정비기반시설도(도면) 사용 — 이미 정비기반시설 계획도가 있는 구역: 자동 배치 대신 올린 도면(z.infra.plan)의 도형을 그대로 씀
    //  구역 안 부분만, 종류끼리 겹치면 앞 순서(도로 → 공원 → 녹지 → 그 밖의 시설 → 학교 → 종교 → 공공청사)가 차지
    const DRW = (P.infraMode === 'drawing' && infO.plan && infO.plan.feats && infO.plan.feats.length) ? infO.plan : null;
    let drw = null;
    if (DRW) {
      const kindOf = f => (DRW.kinds && DRW.kinds[f.layer]) || ZoneKit.infraKind(f.layer);
      const got = {}; let taken = null;
      ['road', 'park', 'green', 'other', 'school', 'rel', 'pub'].forEach(k => {
        const gs = DRW.feats.filter(f => kindOf(f) === k).map(f => { try { return turf.intersect({ type: 'Feature', properties: {}, geometry: f.geom }, zone); } catch (er) { return null; } }).filter(g => g && turf.area(g) >= 1);
        if (!gs.length) return;
        let u = safeUnion(gs);
        if (taken && u) { try { u = turf.difference(u, taken); } catch (er) { /* 그대로 */ } }
        if (!u || turf.area(u) < 1) return;
        got[k] = u; taken = taken ? safeUnion([taken, u]) : u;
      });
      roadGeom = got.road || null; parkGeom = got.park || null; schoolGeom = got.school || null; relGeom = got.rel || null;
      roadArea = roadGeom ? turf.area(roadGeom) : 0; relArea = relGeom ? turf.area(relGeom) : 0;
      items.length = 0; paired = null;
      drw = { name: DRW.name, at: DRW.at, crs: DRW.crs, green: got.green || null, other: got.other || null, pub: got.pub || null,
        greenA: got.green ? turf.area(got.green) : 0, otherA: got.other ? turf.area(got.other) : 0, pubA: got.pub ? turf.area(got.pub) : 0,
        outside: DRW.feats.filter(f => !['zone', 'ignore', 'lot'].includes(kindOf(f))).length - Object.keys(got).length < 0 ? 0 : null };
    }
    // 남는 땅 = 공동주택 획지(구역 − 도로 확폭·지정 도로 − 공원·학교·종교용지 − 존치하는 기존 기반시설). 떨어진 덩어리마다 획지 번호
    let lots = [];
    try {
      const used = [roadGeom, parkGeom, schoolGeom, relGeom].concat(drw ? [drw.green, drw.other, drw.pub] : []).filter(Boolean);
      if (P.keepInnerRoads) inner.filter(p => p.geom).forEach(p => used.push({ type: 'Feature', properties: {}, geometry: p.geom }));
      const rest = used.length ? turf.difference(zone, safeUnion(used)) : zone;
      if (rest) {
        const cs = rest.geometry.type === 'Polygon' ? [rest.geometry.coordinates] : rest.geometry.coordinates;
        lots = cs.map(c => turf.polygon(c)).map(g => ({ geom: g, area: turf.area(g) })).filter(l => l.area >= 5).sort((x, y) => y.area - x.area)
          .map((l, i) => ({ ...l, no: i + 1, small: l.area < 1000 }));
      }
    } catch (er) { lots = []; }
    // 지도에서 '획지 붙이기'로 고른 땅을 공원·학교·종교용지에 합침 (z.infra.addTo: [{ kind, pt:[lat,lng] }])
    const merged = {}, mergeList = [], skipped = [];
    (infO.addTo || []).forEach((m, mi) => {
      const l = lots.find(x => { try { return turf.booleanPointInPolygon(turf.point([m.pt[1], m.pt[0]]), x.geom); } catch (er) { return false; } });
      if (!l) return;
      const tgt = { park: parkGeom, school: schoolGeom, rel: relGeom }[m.kind];
      if (!tgt) return;
      // 주된 공동주택 획지(가장 큰 획지·3,000㎡ 이상)를 면적 없이 통째로 붙인 것은 실수로 보고 무시함
      if (!(num(m.area) > 0) && (l === lots[0] || l.area >= 3000)) { skipped.push({ idx: mi, kind: m.kind, area: l.area }); return; }
      // 붙일 면적을 정했으면 시설에 가까운 쪽부터 그만큼만 떼어 붙임(시설 둘레를 넓혀 가며 면적을 맞춤), 나머지는 획지로 남김
      let piece = l.geom;
      const want = num(m.area);
      if (want > 0 && want < l.area * 0.98) {
        let lo = 0, hi = 5, cut = null;
        const take = d => { try { return turf.intersect(l.geom, turf.buffer(tgt, d, { units: 'meters', steps: 4 })); } catch (er) { return null; } };
        while (hi < 400) { const x = take(hi); if (x && turf.area(x) >= want) break; hi *= 2; }
        for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2, x = take(mid), A = x ? turf.area(x) : 0; if (A < want) lo = mid; else { hi = mid; cut = x; } }
        if (cut) piece = cut;
      }
      // 떼고 남은 쪽이 300㎡ 미만 자투리로 갈라지면 같이 붙임
      if (piece !== l.geom) {
        try {
          const lf = turf.difference(l.geom, piece);
          const bits = lf ? (lf.geometry.type === 'Polygon' ? [lf.geometry.coordinates] : lf.geometry.coordinates).map(c => turf.polygon(c)).filter(x => turf.area(x) < 300) : [];
          if (bits.length) piece = safeUnion([piece, ...bits]);
        } catch (er) { /* 그대로 */ }
      }
      const g = safeUnion([tgt, piece]);
      if (m.kind === 'park') parkGeom = g; else if (m.kind === 'school') schoolGeom = g; else relGeom = g;
      const pa = turf.area(piece);
      merged[m.kind] = (merged[m.kind] || 0) + pa;
      mergeList.push({ idx: mi, kind: m.kind, area: pa });
      const left = piece === l.geom ? null : (() => { try { return turf.difference(l.geom, piece); } catch (er) { return null; } })();
      const restLots = left ? (left.geometry.type === 'Polygon' ? [left.geometry.coordinates] : left.geometry.coordinates).map(c => turf.polygon(c)).map(gg => ({ geom: gg, area: turf.area(gg) })).filter(x => x.area >= 5).map(x => ({ ...x, small: x.area < 1000 })) : [];
      lots = lots.filter(x => x !== l).concat(restLots).sort((x, y) => y.area - x.area);
    });
    // 붙이기 뒤에도 큰 획지와 떨어져 남은 1,000㎡ 미만 조각은 가장 많이 맞닿은 시설에 붙임
    let relGrown = false;
    if (P.autoAbsorb !== false && lots.length > 1) {
      const blk = () => [['park', parkGeom], ['school', schoolGeom], ['rel', relGeom]].filter(b => b[1]);
      lots.slice(1).filter(l => l.area < 1000).forEach(l => {
        let near = null, bestC = 0;
        try { const pb = turf.buffer(l.geom, 1, { units: 'meters' }); blk().forEach(b => { let c = 0; try { const x = turf.intersect(pb, b[1]); c = x ? turf.area(x) : 0; } catch (er) { c = 0; } if (c > bestC) { bestC = c; near = b[0]; } }); } catch (er) { near = null; }
        if (!near) return;
        if (near === 'park') parkGeom = safeUnion([parkGeom, l.geom]); else if (near === 'school') schoolGeom = safeUnion([schoolGeom, l.geom]); else { relGeom = safeUnion([relGeom, l.geom]); relGrown = true; }
        absorbed += l.area; lots = lots.filter(x => x !== l);
      });
    }
    lots = lots.map((l, i) => ({ ...l, no: i + 1 }));
    if ((relC || merged.rel || relGrown) && relGeom) relArea = turf.area(relGeom);
    const parkArea = parkGeom ? turf.area(parkGeom) : 0, schoolArea = schoolGeom ? turf.area(schoolGeom) : 0;
    // green: 완충·경관·연결녹지 등 · other: 공용주차장·공공공지·광장 등 그 밖의 정비기반시설 · pubB: 공공청사 등(정비기반시설 아님) — 모두 입력값, 지도에는 그리지 않음
    const other = drw ? drw.otherA : num(P.otherInfra), green = drw ? drw.greenA : num(P.greenInfra), pubB = drw ? drw.pubA : num(P.pubBldg);
    const total = roadArea + (P.keepInnerRoads ? innerFull : 0) + parkArea + green + schoolArea + other + pubB + relArea;
    // 확보 목표: 구역 안 기존 공공시설(도로·구거 등 공공 지목 필지) + 도시계획시설 — 겹치는 땅은 한 번만
    let keepGeom = null, keepArea = 0, keepAll = 0, facArea = 0;
    const facList = (z.roads && z.roads.fac) || [];
    try {
      const gs = inner.filter(p => p.geom).map(p => { try { return turf.intersect({ type: 'Feature', properties: {}, geometry: p.geom }, zone); } catch (er) { return null; } }).filter(Boolean)
        .concat(facList.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom })));
      if (gs.length) { keepGeom = safeUnion(gs); keepAll = Math.max(0, turf.area(keepGeom) - innerOcc); }   // 국공유 공공시설 안 건물 점유 부분은 뺌
      facArea = facList.length ? turf.area(safeUnion(facList.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom })))) : 0;
    } catch (er) { keepAll = innerArea; }
    // 확보 목표 = 무상양도 균형: 용도폐지되는 '설치된' 국공유 정비기반시설 중 사용 중인 면적(도정법 제97조②③ — 도시·군관리계획으로 결정되어 '설치된' 도로 등)
    //  미집행 결정선은 아직 설치된 시설이 아니므로 확보 목표·상쇄에 넣지 않음(정비계획 결정·사업시행계획인가 때 도시계획시설 변경으로 정리 — 추후 할 일)
    //  기존 도로를 존치하면 용도폐지가 아니므로 목표에서 빠짐
    keepArea = P.keepInnerRoads ? 0 : innerArea;
    // 신설 정비기반시설(무상귀속, 도정법 제97조②) — 정비기반시설(법 제2조제4호·영 제3조)만 셈. 학교용지·공공청사는 정비기반시설이 아니라 뺌
    const newArea = roadArea + parkArea + green + other;
    // 무상양도 금액 비교(설치비용 상당 범위, 제97조②): 용도폐지 시설 평가액 vs 신설 시설 설치비용 — 개략
    const vmul = num(P.valMult) || 1.4, pubPrice = (() => { const w = inner.reduce((t, p) => t + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0); return w ? inner.reduce((t, p) => t + num(p.price) * (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0) / w : 0; })();
    const priv = a.ps.filter(p => !isPublicOwner(p.own) && !isPublicJimok(p.jimok)), privW = priv.reduce((t, p) => t + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    const privPrice = privW ? priv.reduce((t, p) => t + num(p.price) * (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0) / privW : 0;
    const money = {
      oldVal: (P.keepInnerRoads ? 0 : innerArea) * pubPrice * vmul,                 // 용도폐지 시설: 사용 중 면적 × 공시지가 × 배율
      newLand: newArea * privPrice * vmul,                                          // 신설 부지(사유지로 봄) 가액 — 설치비용에 넣는지는 확인 필요
      newWork: roadArea * num(P.roadWork) + (parkArea + green) * num(P.parkWork) + other * num(P.roadWork),   // 공사비(단가 입력 시)
      pubPrice, privPrice, vmul,
    };
    money.newCost = money.newLand + money.newWork;
    const short = Math.max(0, keepArea - newArea);
    // 모자라면 경계 도로를 넓혀 채우기(선택). 한 번만 다시 계산
    // (예전 '모든 경계 도로를 똑같이 넓혀 채우기'는 없앰 — 부족분은 공원·공공공지·구역 안 도로로 채움(fillGuide), 경계 도로 확폭은 기능으로만)
    const res = {
      giAll, keepArea, keepAll, facArea, facList, money, newArea, short, roadAdd: opt.roadAdd || 0, entry,
      widenExtra, paired, lots, merged, mergeList, skipped, absorbed, parkC, schoolC, relC, fitMsg, relCenter: relGeom ? (() => { const c = turf.centroid(relGeom).geometry.coordinates; return [c[1], c[0]]; })() : null,
      relAll, rel, relLand, relArea, relGeom, relManual: szRel.mode !== 'auto', szPark, szSchool, szRel, parkLegal, parkExist,
      W, sideW, units, items, roadGeom, roadArea, inner, innerArea, innerFull, innerOcc, legal, parkNeed, parkGeom, parkArea, green, pubB, schoolGeom, schoolArea, other, total,
      ratio: a.area ? total / a.area : 0, roadsReady: !!z.roads, edge: z.roads ? z.roads.edge : [], drawing: drw,
    };
    this.memo = {}; this.memo[mk] = res;
    return res;
  },
  // 지도에 그리기 (정비계획 탭·'기반시설 제안' 색 구분)
  draw(layer, a) {
    const pl = plan(a), inf = pl.infra; if (!inf) return;
    this.curPair = inf.paired || null; this.curInf = inf; if (!inf.paired) { this.divNear = null; this.divStart = null; }
    const c = n => cssVar(n);
    // 공동주택 획지(남는 땅) — 맨 아래에 옅게 칠하고 번호·면적 표시
    (inf.lots || []).forEach(l => {
      const g = L.geoJSON(l.geom, { style: { color: '#b08900', weight: 1.5, fillColor: l.small ? '#e8590c' : '#f2c94c', fillOpacity: l.small ? 0.35 : 0.28 }, interactive: true })
        .bindTooltip(`획지 ${l.no} · 공동주택용지 ${fmt(l.area)}㎡${l.small ? ' — 1,000㎡ 미만이라 단독 개발이 어려움' : ''} · 누르면 옆 시설에 붙이기`, { sticky: true }).addTo(layer);
      g.on('click', ev => {
        if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
        L.DomEvent.stop(ev);
        const kinds = [['rel', '종교용지', inf.relGeom], ['park', '공원·녹지', inf.parkGeom], ['school', '학교용지', inf.schoolGeom]].filter(k => k[2]);
        const box = document.createElement('div'); box.className = 'zk-pop';
        // 큰 공동주택 획지(가장 큰 획지이거나 3,000㎡ 이상)는 통째로 붙지 않게 면적을 꼭 넣어야 함
        const big = l.no === 1 || l.area >= 3000;
        box.innerHTML = `<div><b>획지 ${l.no}</b> · ${fmt(l.area)}㎡</div><div class="zk-pop-sub">${big ? '<b class="warn">주된 공동주택 획지입니다.</b> 붙일 면적을 넣으면 시설 쪽에서 그만큼만 떼어 붙입니다.' : '이 땅을 어디에 넣을까요?'}</div>
          <label class="zk-pop-sub" style="display:flex;gap:6px;align-items:center;margin-top:4px">붙일 면적 <input type="number" min="1" max="${Math.round(l.area)}" step="10" value="${big ? '' : Math.round(l.area)}" placeholder="${big ? '예: 300' : ''}" style="width:90px" data-want> ㎡</label>
          <div class="zk-pop-sub">${big ? '' : '줄이면 시설에 가까운 쪽부터 그만큼만 붙이고 나머지는 획지로 남깁니다.'}</div><div class="zk-pop-btns">${kinds.map(k => `<button type="button" data-k="${k[0]}">${k[1]}에 붙이기</button>`).join('')}<button type="button" data-act="out" data-k="">공동주택 획지로 두기</button></div>`;
        const pop = L.popup({ maxWidth: 300 }).setLatLng(ev.latlng).setContent(box).openOn(LM);
        const wantIn = box.querySelector('[data-want]');
        const sync = () => box.querySelectorAll('button[data-k]').forEach(b => { if (b.dataset.k) b.disabled = big && !(num(wantIn.value) > 0); });
        wantIn.oninput = sync; sync();
        box.querySelectorAll('button').forEach(b => b.onclick = () => {
          LM.closePopup(pop);
          if (!b.dataset.k) return;
          const z = Z.zones[S.region]; z.infra = z.infra || {}; z.infra.addTo = z.infra.addTo || [];
          const want = num(box.querySelector('[data-want]').value);
          z.infra.addTo.push({ kind: b.dataset.k, pt: [ev.latlng.lat, ev.latlng.lng], area: want > 0 && want < l.area * 0.98 ? want : null });
          saveZ(); INFRA.memo = {}; render(); toast(`획지 ${l.no}에서 ${fmt(Math.min(l.area, num(box.querySelector('[data-want]').value) || l.area))}㎡를 붙였습니다`);
        });
      });
      if (l.area >= 300) { try { const pt = turf.pointOnFeature(l.geom).geometry.coordinates; L.tooltip({ permanent: true, direction: 'center', className: 'lot-label' }).setLatLng([pt[1], pt[0]]).setContent(`획지${l.no}<br>${fmt(l.area)}㎡`).addTo(layer); } catch (er) { /* 무시 */ } }
    });
    // 구역 안 도시계획시설(결정된 도로·공원 등) — 주황 빗금 테두리로 참고 표시
    if (P.showFac) (inf.facList || []).forEach(f => L.geoJSON({ type: 'Feature', properties: {}, geometry: f.geom }, { style: { color: '#d9480f', weight: 1.5, dashArray: '5 3', fillColor: '#d9480f', fillOpacity: 0.08 }, interactive: true })
      .bindTooltip(`도시계획시설 ${esc(f.grp)} · ${esc(f.name)}${f.grade ? ' ' + esc(f.grade) : ''}${f.exc ? ` (${esc(f.exc)})` : ''} · 구역 안 ${fmt(f.area)}㎡`, { sticky: true }).addTo(layer));
    // 구역 밖 경계 도로는 참고로 구역 둘레 15m 안만 점선 테두리로 (색은 칠하지 않음 — 제안이 아님)
    const z0 = Z.zones[a.key], near = z0 && z0.geojson ? (() => { try { return turf.buffer(z0.geojson, 15, { units: 'meters' }); } catch (er) { return null; } })() : null;
    (inf.edge || []).forEach(r => {
      let g = { type: 'Feature', properties: {}, geometry: r.geom };
      if (near) { try { g = turf.intersect(g, near) || g; } catch (er) { /* 그대로 */ } }
      L.geoJSON(g, { style: { color: c('--ink-2'), weight: 1, dashArray: '2 4', fill: true, fillOpacity: 0 }, interactive: true })
        .bindTooltip(`구역 밖 경계 도로(참고) ${esc(r.jibun)} · 폭 약 ${r.w}m(필지 모양으로 추정)`, { sticky: true }).addTo(layer);
    });
    if (inf.drawing) {   // 정비기반시설도(도면) — 끌어 옮기지 않고 도면 그대로 표시
      const dr = inf.drawing, put = (g, col, op, t) => { if (g) L.geoJSON(g, { style: { color: col, weight: 1.5, fillColor: col, fillOpacity: op } }).bindTooltip(t, { sticky: true }).addTo(layer); };
      put(inf.roadGeom, c('--ink-2'), 0.45, `도로(도면) ${fmt(inf.roadArea)}㎡`);
      put(inf.parkGeom, c('--ok'), 0.35, `공원(도면) ${fmt(inf.parkArea)}㎡`);
      put(dr.green, '#5d9c59', 0.3, `녹지(도면) ${fmt(dr.greenA)}㎡`);
      put(dr.other, '#3a7ca5', 0.3, `그 밖의 정비기반시설(도면) ${fmt(dr.otherA)}㎡`);
      put(inf.schoolGeom, c('--accent'), 0.3, `학교용지(도면) ${fmt(inf.schoolArea)}㎡`);
      put(inf.relGeom, '#7b2cbf', 0.3, `종교용지(도면) ${fmt(inf.relArea)}㎡`);
      put(dr.pub, '#8d6e63', 0.3, `공공청사 등(도면) ${fmt(dr.pubA)}㎡`);
      return;
    }
    if (inf.relGeom) this.movable(L.geoJSON(inf.relGeom, { style: { color: '#7b2cbf', weight: 2, fillColor: '#7b2cbf', fillOpacity: 0.3 } })
      .bindTooltip(inf.relC ? `종교용지 대체부지(제안) ${fmt(inf.relArea)}㎡ · 끌어서 옮기기` : `종교용지 현 위치 존치 ${inf.rel.map(p => esc(p.jibun)).join(', ')} · ${fmt(inf.relArea)}㎡ · 끌면 대체부지로 옮겨짐`, { sticky: true }).addTo(layer), 'religion', inf.relCenter);
    inf.items.forEach(it => {
      // 짧게 닿은 도로를 직접 넓힌 것(부분 확폭)은 진회색 면 대신 빗금+점선 — '검토용'
      const lyr = L.geoJSON(it.geom, { style: it.partial ? { color: c('--warn'), weight: 1.5, dashArray: '3 4', fillColor: c('--warn'), fillOpacity: 0.6 } : { color: c('--ink'), weight: 1, fillColor: c('--ink-2'), fillOpacity: it.kind === 'manual' ? 0.7 : 0.55, dashArray: it.kind === 'manual' ? null : '4 3' } })
        .bindTooltip(it.kind === 'manual' ? `직접 지정한 도로 ${fmt(it.area)}㎡ · 누르면 지정 취소` : it.partial ? `부분 확폭(병목, 검토용) · ${esc(it.jibun)} 약 ${it.from}m → ${it.to}m · ${fmt(it.area)}㎡ — 구역에 짧게 닿은 구간만 넓힘` : `${it.kind === 'entry' ? '진입도로' : '주변 도로'} 확폭(제안) · ${esc(it.jibun)} 약 ${it.from}m → ${it.to}m · ${fmt(it.area)}㎡`, { sticky: true }).addTo(layer);
      if (it.partial) {
        const svg = lyr.getLayers()[0] && lyr.getLayers()[0]._path && lyr.getLayers()[0]._path.ownerSVGElement;
        if (svg && !svg.querySelector('#jbsHatch')) svg.insertAdjacentHTML('afterbegin', `<defs><pattern id="jbsHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${c('--warn')}" stroke-width="2"/></pattern></defs>`);
        lyr.eachLayer(l => l._path && l._path.setAttribute('fill', 'url(#jbsHatch)'));
      }
      if (it.kind === 'manual') lyr.on('click', ev => {
        L.DomEvent.stop(ev);
        const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.manualRoads) return;
        z.infra.manualRoads.splice(it.idx, 1); saveZ(); INFRA.memo = {}; render(); toast('도로 지정을 취소했습니다');
      });
    });
    if (inf.parkGeom) this.movable(L.geoJSON(inf.parkGeom, { style: { color: c('--ok'), weight: 2, fillColor: c('--ok'), fillOpacity: 0.35 } })
      .bindTooltip(`공원·녹지(제안) ${fmt(inf.parkArea)}㎡ · 끌어서 옮기기${inf.parkArea < inf.parkNeed * 0.95 ? ` — 구역 경계·도로에 걸려 필요 ${fmt(inf.parkNeed)}㎡보다 작음, 위치를 옮기세요` : ''}`, { sticky: true }).addTo(layer), 'park', this.centerOf(inf.parkGeom));
    if (inf.schoolGeom) this.movable(L.geoJSON(inf.schoolGeom, { style: { color: c('--accent'), weight: 2, fillColor: c('--accent'), fillOpacity: 0.3 } })
      .bindTooltip(`학교용지(제안) ${fmt(inf.schoolArea)}㎡ · 끌어서 옮기기`, { sticky: true }).addTo(layer), 'school', this.centerOf(inf.schoolGeom));
    // 맞닿은 시설 사이 나눔선(맨 위에): 끌면 두 시설이 면적을 주고받음(합은 그대로)
    if (inf.paired) { const sz = (Z.zones[a.key].infra || {}).sz || {}, mn = k => num((sz[k] || {}).min); this.divider(layer, inf.paired, { park: mn('park') || inf.parkLegal || 0, rel: mn('rel'), school: mn('school') }); }
  },
  // 맞닿은 두 블록을 경계 따라 한 띠로 다시 그림. items: [[kind, geom, 목표면적], …] → { kind: geom } 또는 null
  // split: 나눔선을 끌어 정한 { kind, area } — 띠(위치·깊이)는 그대로 두고 나누는 자리만 바꿈
  pairBand(zone, minus, items, split, edgeLL) {
    const U = safeUnion(items.map(x => x[1]));
    const c0 = turf.centroid(U).geometry.coordinates, lon0 = c0[0], lat0 = c0[1];
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const toM = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    // 기준 경계선: 두 시설이 가장 길게 맞닿은 구역 경계 변(2m 간격으로 재서 시설 2.5m 안에 드는 길이). 없으면 가장 가까운 변
    let best = Infinity, ed = null, bestLen = 0, edL = null;
    let nearU = null; try { nearU = turf.buffer(U, 2.5, { units: 'meters' }); } catch (er) { nearU = null; }
    const zr = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates[0]] : zone.geometry.coordinates.map(p => p[0]);
    zr.forEach(r => { for (let i = 0; i + 1 < r.length; i++) {
      const a = toM(r[i]), b = toM(r[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 4) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)), d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (d < best) { best = d; ed = [a, b]; }
      if (nearU) {
        const Ls = Math.sqrt(L2), n = Math.max(1, Math.floor(Ls / 2)); let c = 0;
        for (let k = 0; k <= n; k++) { const q = toLL([a[0] + dx * k / n, a[1] + dy * k / n]); if (turf.booleanPointInPolygon(q, nearU)) c++; }
        const len = c / (n + 1) * Ls;
        if (len > bestLen) { bestLen = len; edL = [a, b]; }
      }
    } });
    if (edL && bestLen >= 8) ed = edL;
    // 기억해 둔 기준 변이 있고 묶음에서 60m 안이면 그 변을 그대로 씀
    if (edgeLL && edgeLL.length === 2) {
      const ea = toM(edgeLL[0]), eb = toM(edgeLL[1]), dx = eb[0] - ea[0], dy = eb[1] - ea[1], L2 = dx * dx + dy * dy;
      if (L2 > 4) { const t = Math.max(0, Math.min(1, -(ea[0] * dx + ea[1] * dy) / L2)); if (Math.hypot(ea[0] + t * dx, ea[1] + t * dy) < 60) ed = [ea, eb]; }
    }
    if (!ed) return null;
    const [a, b] = ed, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let nx = -uy, ny = ux; if ((0 - a[0]) * nx + (0 - a[1]) * ny < 0) { nx = -nx; ny = -ny; }   // 경계 → 안쪽
    const P = (u, v) => toLL([a[0] + ux * u + nx * v, a[1] + uy * u + ny * v]);
    const coordsOf = g => { const gg = g.geometry || g; return gg.type === 'Polygon' ? gg.coordinates.flat() : gg.coordinates.flat(2); };
    const us = coordsOf(U).map(q => { const m = toM(q); return (m[0] - a[0]) * ux + (m[1] - a[1]) * uy; });
    const u0 = Math.min(...us), u1 = Math.max(...us);
    let free = zone; if (minus) { try { free = turf.difference(zone, minus) || zone; } catch (er) { free = zone; } }
    const box = (ua, ub, v) => turf.polygon([[P(ua, -60), P(ub, -60), P(ub, v), P(ua, v), P(ua, -60)]]);
    // 잘린 조각이 여럿이면(구역이 오목해서) 가장 큰 한 덩어리만 — 시설이 둘로 갈라지지 않게
    const cut = (ua, ub, v) => {
      let g = null; try { g = turf.intersect(box(ua, ub, v), free); } catch (er) { return null; }
      if (!g || g.geometry.type !== 'MultiPolygon') return g;
      return g.geometry.coordinates.map(c => turf.polygon(c)).sort((x, y) => turf.area(y) - turf.area(x))[0];
    };
    const total = items.reduce((t, x) => t + x[2], 0);
    // 깊이 v: 띠 면적 = 두 시설 면적 합
    let lo = 1, hi = 200, band = null;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2, g = cut(u0, u1, m), A = g ? turf.area(g) : 0; if (A >= total) { hi = m; band = g; } else lo = m; }
    if (!band) return null;
    const v = hi;
    // 나누는 선: 묶음 안에서 가운데가 경계선 방향으로 앞선 시설부터 차례로
    const order = items.map(x => { const c = toM(turf.centroid(x[1]).geometry.coordinates); return [x, (c[0] - a[0]) * ux + (c[1] - a[1]) * uy]; }).sort((p, q) => p[1] - q[1]).map(p => p[0]);
    const first = order[0].slice();
    let custom = false;
    if (split && split.area > 0) {
      const fa = split.kind === first[0] ? split.area : total - split.area;
      first[2] = Math.max(total * 0.05, Math.min(total * 0.95, fa)); custom = true;
    }
    let sl = u0, sh = u1, sp = null;
    for (let k = 0; k < 24; k++) { const m = (sl + sh) / 2, g = cut(u0, m, v), A = g ? turf.area(g) : 0; if (A >= first[2]) { sh = m; sp = g; } else sl = m; }
    if (!sp) return null;
    const rest = cut(sh, u1, v);
    if (!rest) return null;
    // 면적이 5% 넘게 어긋나면(띠가 구역 모양에 막힘) 묶지 않고 각자 둠
    if (Math.abs(turf.area(sp) + turf.area(rest) - total) > total * 0.05) return null;
    if (!custom && (Math.abs(turf.area(sp) - first[2]) > first[2] * 0.05 || Math.abs(turf.area(rest) - order[1][2]) > order[1][2] * 0.05)) return null;
    // 두 시설 사이 나눔선(끌어서 면적을 주고받는 손잡이)과, 선 위치 → 앞 시설 면적 계산 함수
    const toU = ll => { const m = toM([ll.lng, ll.lat]); return (m[0] - a[0]) * ux + (m[1] - a[1]) * uy; };
    const areaAt = u => { const g = cut(u0, u, v); return g ? turf.area(g) : 0; };
    const lineAt = u => { const p1 = P(u, 0), p2 = P(u, v); return [[p1[1], p1[0]], [p2[1], p2[0]]]; };
    const usedEdge = [toLL(a), toLL(b)].map(q => [+q[0].toFixed(7), +q[1].toFixed(7)]);
    return { [order[0][0]]: sp, [order[1][0]]: rest, pair: { edgeLL: usedEdge, kinds: [order[0][0], order[1][0]], total, u0, u1, s: sh, toU, areaAt, lineAt, custom, a1: turf.area(sp), a2: turf.area(rest) } };
  },
  // mins: { park: 최소 면적 } — 끌다가 그 아래로 줄어들면 더 못 가게 막음
  divider(layer, pr, mins = {}) {
    const name = k => ({ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[k]);
    // 보이는 선: 흰 실선(가는 테두리) + 가운데 작은 손잡이
    const edge = L.polyline(pr.lineAt(pr.s), { color: '#333', weight: 4, opacity: 0.35, interactive: false }).addTo(layer);
    const line = L.polyline(pr.lineAt(pr.s), { color: '#fff', weight: 2, opacity: 0.95, interactive: false }).addTo(layer);
    const mid = ll => [(ll[0][0] + ll[1][0]) / 2, (ll[0][1] + ll[1][1]) / 2];
    const grip = L.marker(mid(pr.lineAt(pr.s)), { keyboard: false, icon: L.divIcon({ className: 'div-grip', html: '<span>⇆</span>', iconSize: [26, 18], iconAnchor: [13, 9] }) }).addTo(layer);
    const hit = L.polyline(pr.lineAt(pr.s), { color: '#000', weight: 30, opacity: 0 }).addTo(layer)
      .bindTooltip(`${name(pr.kinds[0])} ↔ ${name(pr.kinds[1])} 나눔선 · 끌어서 면적 주고받기`, { sticky: true });
    hit.on('add', () => { const el = hit.getElement(); if (el) el.style.cursor = 'ew-resize'; });
    const el0 = hit.getElement && hit.getElement(); if (el0) el0.style.cursor = 'ew-resize';
    // 나눔선 가까이(화면 28px 안)에서 시설을 잡으면 시설을 옮기지 않고 나눔선을 끌게 함(옆 시설이 딴 데로 가지 않게)
    this.divNear = ev => {
      const ll = hit.getLatLngs(), p = LM.latLngToContainerPoint(ev.latlng), A = LM.latLngToContainerPoint(ll[0]), B = LM.latLngToContainerPoint(ll[1]);
      const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2));
      return Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy)) < 28;
    };
    this.divStart = ev => start(ev);
    const start = ev => {
      if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
      L.DomEvent.stop(ev); LM.dragging.disable(); hit.closeTooltip();
      let lo = pr.u0 + 3, hi = pr.u1 - 3;
      // 공원 최소 면적(법정·제안 기준) 아래로는 못 가게: 나눔선이 갈 수 있는 끝을 미리 구함
      pr.kinds.forEach((k, idx) => {
        const m = num(mins[k]); if (!(m > 0)) return;
        const ok = u => (idx === 0 ? pr.areaAt(u) : pr.total - pr.areaAt(u)) >= m - 0.5;
        if (!ok(pr.s)) { if (idx === 0) lo = Math.max(lo, pr.s); else hi = Math.min(hi, pr.s); return; }   // 이미 작으면 더 줄어드는 쪽만 막음
        let a0 = idx === 0 ? lo : pr.s, b0 = idx === 0 ? pr.s : hi;   // 앞 시설이면 왼쪽 끝, 뒤 시설이면 오른쪽 끝을 찾음
        for (let it = 0; it < 22; it++) { const mm = (a0 + b0) / 2; if (idx === 0 ? ok(mm) : !ok(mm)) { if (idx === 0) b0 = mm; else b0 = mm; } else { if (idx === 0) a0 = mm; else a0 = mm; } }
        if (idx === 0) lo = Math.max(lo, b0); else hi = Math.min(hi, a0);
      });
      let blocked = false; const loMin = lo > pr.u0 + 3 + 0.01, hiMin = hi < pr.u1 - 3 - 0.01;
      let u = pr.s;
      const u00 = pr.toU(ev.latlng);   // 잡은 자리에서 끈 만큼만 옮김(처음에 튀지 않게)
      const mv = e => { const want = pr.s + pr.toU(e.latlng) - u00; u = Math.max(lo, Math.min(hi, want)); if ((loMin && want < lo - 0.5) || (hiMin && want > hi + 0.5)) { if (!blocked) { blocked = true; toast(`${name(want < lo ? pr.kinds[0] : pr.kinds[1])} 최소 면적보다 작아지지 않게 여기서 멈춥니다`); } } else blocked = false; const ll = pr.lineAt(u); line.setLatLngs(ll); edge.setLatLngs(ll); hit.setLatLngs(ll); grip.setLatLng(mid(ll)); };
      const up = () => {
        LM.off('mousemove', mv); LM.off('mouseup', up); document.removeEventListener('mouseup', up); LM.dragging.enable();
        if (Math.abs(u - pr.s) < 0.5) return;
        const a1 = Math.round(pr.areaAt(u)), a2 = Math.round(pr.total - a1);
        const z = Z.zones[S.region]; z.infra = z.infra || {};
        z.infra.pairSplit = { kind: pr.kinds[0], area: a1 };   // 띠는 그대로, 나누는 자리만 기억
        saveZ(); this.memo = {}; render();
        toast(`${name(pr.kinds[0])} ${fmt(a1)}㎡ · ${name(pr.kinds[1])} ${fmt(a2)}㎡로 나눴습니다(두 시설 합 ${fmt(pr.total)}㎡ 그대로)`);
      };
      LM.on('mousemove', mv); LM.on('mouseup', up); document.addEventListener('mouseup', up);
    };
    hit.on('mousedown', start);
    grip.on('mousedown', start);
    grip.bindTooltip(`${name(pr.kinds[0])} ↔ ${name(pr.kinds[1])} 나눔선 · 끌어서 면적 주고받기`, { direction: 'top', offset: [0, -8] });
  },
  // 구역 안 필지 중 국공유이거나 공공 지목인 것 → 근거와 판정(확실 / 가능성 높음 / 아닐 가능성 / 사유(참고))
  judgeExisting(a, z) {
    const Rg = D.regions[a.key] || {}, fac = (z.roads && z.roads.fac) || [];
    const facU = fac.length ? (() => { try { return safeUnion(fac.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom }))); } catch (er) { return null; } })() : null;
    const out = [];
    a.ps.forEach(p => {
      const pub = isPublicOwner(p.own), jm = isPublicJimok(p.jimok);
      if (!pub && !jm) return;
      const f = p.geom ? { type: 'Feature', properties: {}, geometry: p.geom } : null;
      const lu = /도로|하천|구거|공원|제방/.test(p.landUse || '');
      let facR = 0, w = 99;
      if (f) {
        try { if (facU) { const x = turf.intersect(f, facU); facR = x ? turf.area(x) / turf.area(f) : 0; } } catch (er) { facR = 0; }
        try { const A = turf.area(f), P = turf.length(turf.polygonToLine(f), { units: 'kilometers' }) * 1000; w = 2 * A / (P || 1); } catch (er) { w = 99; }
      }
      const bl = ((Rg.blds || {})[p.pnu] || []), thin = w < 8, fc = facR >= 0.5;
      const cover = p.bldOver == null ? null : p.bldOver;            // 건물 도형이 필지를 덮는 비율(전체)
      const coreC = (p.bldCore == null || p.bldCore < 0) ? cover : p.bldCore;           // 가장자리 1.2m를 뺀 안쪽을 덮는 비율(처마·경계 어긋남 제외)
      // 건물 판단은 안쪽 기준: 길쭉한 도로 필지는 양쪽 처마만으로도 전체 비율이 크게 나옴
      const bldOn = coreC != null ? coreC > 0.2 : bl.length > 0, noBld = coreC != null ? coreC <= 0.05 : !bl.length;
      // 건물 점유 면적(㎡): 안쪽(가장자리 1.2m 뺌)을 건물이 덮은 넓이. 안쪽이 없는 아주 작은 필지는 전체 겹침 넓이
      //  기반시설 확보 목표·무상양도 면적에서는 이만큼을 보수적으로 뺌(사실상 건물 부지로 쓰여 도로·공원으로 확보된다고 보기 어려움)
      const inR = z.inArea[p.pnu] ?? 1, fullA = (p.base ?? p.area) * inR;
      let occ = 0;
      if (coreC != null && coreC > 0.05 && f) {
        try {
          if (p.bldCore == null || p.bldCore < 0) occ = p.bldA != null ? p.bldA : (p.bldOver || 0) * turf.area(f);
          else if (p.bldCoreA != null) occ = p.bldCoreA;
          else { const core = turf.buffer(f, -1.2, { units: 'meters' }); occ = core ? p.bldCore * turf.area(core) : 0; }
        } catch (er) { occ = 0; }
        occ = Math.min(fullA, occ * inR);
      }
      const nLedger = bl.filter(b => b.src === '대장').length, nGis = bl.length - nLedger;
      // 지목에 맞는 도시계획시설이 결정돼 있는지(공원 지목인데 공원 결정이 없으면 해제·미조성 의심)
      let facKind = '';
      if (f && fac.length) { try { const hit = fac.filter(x => { const xi = turf.intersect(f, { type: 'Feature', properties: {}, geometry: x.geom }); return xi && (turf.area(xi) >= turf.area(f) * 0.05 || turf.area(xi) >= 30); }); facKind = [...new Set(hit.map(x => x.name))].join(', '); } catch (er) { facKind = ''; } }
      // 지목은 공공(도로·공원 등)인데 토지이용상황이 주거·상업 등이면 실제 쓰임이 달라 '확인 필요'
      //  확실: 공공 지목이고 이용상황도 맞고 건물이 없음
      //  확인 필요: 지목·이용상황·건물이 서로 어긋남(지목은 공공인데 주거로 쓰임, 이용상황은 도로인데 건물이 덮음 등)
      //  가능성 높음: 지목은 '대'인데 이용상황 도로등·도시계획시설 안·(길쭉+건물 없음) 중 하나
      const conflict = (jm && !!p.landUse && !lu) || ((jm || lu) && bldOn);
      const grade = !pub ? '사유(참고)' : conflict ? '확인 필요' : (jm && (lu || !p.landUse)) ? '확실' : (lu || fc || (thin && noBld)) ? '가능성 높음' : '아닐 가능성';
      out.push({ p, pub, jm, lu, fc, thin, noBld, cover, coreC, bldOn, nLedger, nGis, facKind, w: Math.round(w * 10) / 10, grade, area: fullA, occ, useA: Math.max(0, fullA - occ) });
    });
    const ord = { '확실': 0, '확인 필요': 1, '가능성 높음': 2, '아닐 가능성': 3, '사유(참고)': 4 };
    return out.sort((x, y) => ord[x.grade] - ord[y.grade] || y.area - x.area);
  },
  // 지금 그려진 블록의 가운데 [lat, lng] — 끌어 옮길 때 기준(저장된 위치가 구역 밖이어도 보이는 자리에서 옮겨지게)
  centerOf(g) { if (!g) return null; try { const c = turf.centroid(g).geometry.coordinates; return [c[1], c[0]]; } catch (er) { return null; } },
  // 공원·학교·종교용지 도형을 마우스로 끌어 옮기기. center: 지금 블록 중심 [lat, lng]
  movable(lyr, kind, center) {
    if (!center) return lyr;
    const shift = (ll, d) => Array.isArray(ll) ? ll.map(x => shift(x, d)) : L.latLng(ll.lat + d[0], ll.lng + d[1]);
    lyr.eachLayer(l => { const el = l.getElement && l.getElement(); if (el) el.style.cursor = 'move'; });
    lyr.on('mousedown', ev => {
      if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
      const pk = { religion: 'rel', park: 'park', school: 'school' }[kind];
      if (this.divNear && this.curPair && this.curPair.kinds.includes(pk) && this.divNear(ev)) { this.divStart(ev); return; }
      L.DomEvent.stop(ev);
      const start = ev.latlng, orig = []; lyr.eachLayer(l => orig.push([l, l.getLatLngs()]));
      let d = [0, 0];
      LM.dragging.disable(); lyr.closeTooltip && lyr.closeTooltip();
      const mv = e => {
        d = [e.latlng.lat - start.lat, e.latlng.lng - start.lng]; orig.forEach(([l, ll]) => l.setLatLngs(shift(ll, d)));
        // 지도 가장자리나 화면 아래 끝에 가까우면 지도를 그쪽으로 조금씩 밀어 계속 끌 수 있게
        const sz = LM.getSize(), p = e.containerPoint, ce = e.originalEvent || {}, E = 40;
        const vb = window.innerHeight - (ce.clientY || 0) < E;
        const px = p.x < E ? -15 : p.x > sz.x - E ? 15 : 0, py = p.y < E ? -15 : (p.y > sz.y - E || vb) ? 15 : 0;
        if (px || py) LM.panBy([px, py], { animate: false });
      };
      const up = () => {
        LM.off('mousemove', mv); LM.off('mouseup', up); document.removeEventListener('mouseup', up); LM.dragging.enable();
        const px = LM.latLngToContainerPoint(start).distanceTo(LM.latLngToContainerPoint(L.latLng(start.lat + d[0], start.lng + d[1])));
        if (px < 4) { orig.forEach(([l, ll]) => l.setLatLngs(ll)); return; }
        const pk2 = { religion: 'rel', park: 'park', school: 'school' }[kind];
        if (this.curPair && this.curPair.kinds.includes(pk2) && this.curInf) {
          // 한 띠로 묶인 시설은 둘이 같이 움직임(띠 모양 유지)
          const z = Z.zones[S.region]; z.infra = z.infra || {};
          const geo = { park: this.curInf.parkGeom, rel: this.curInf.relGeom };
          this.curPair.kinds.forEach(k => { const c = this.centerOf(geo[k]); if (c) z.infra[k === 'park' ? 'parkC' : 'relC'] = [c[0] + d[0], c[1] + d[1]]; });
          delete z.infra.pairEdge;   // 새 자리에서 기준 변을 다시 고름
          saveZ(); this.memo = {}; render(); toast('붙어 있는 두 시설을 같이 옮겼습니다');
          return;
        }
        this.place(kind, L.latLng(center[0] + d[0], center[1] + d[1]));
      };
      LM.on('mousemove', mv); LM.on('mouseup', up); document.addEventListener('mouseup', up);
    });
    return lyr;
  },
  place(kind, latlng) {
    const z = Z.zones[S.region]; if (!z) return;
    z.infra = z.infra || {};
    if (kind.startsWith('gate:')) { GATE.put(z, kind.slice(5), latlng); return; }
    if (kind.startsWith('bl:')) { BLINE.place(z, kind.slice(3), latlng); return; }   // 건축선·출입 계획(공공보행통로·공개공지)
    z.infra[{ park: 'parkC', school: 'schoolC', religion: 'relC' }[kind]] = [latlng.lat, latlng.lng];
    // 시설을 옮기면 그 시설에 붙였던 획지는 풀어 줌(자리가 바뀌어 다른 땅이 붙지 않게)
    if (z.infra.addTo) z.infra.addTo = z.infra.addTo.filter(m => m.kind !== { park: 'park', school: 'school', religion: 'rel' }[kind]);
    const fk = { park: 'park', school: 'school' }[kind], fitWas = fk && z.infra.fit && z.infra.fit[fk] && z.infra.fit[fk].mode && z.infra.fit[fk].mode !== 'auto';
    if (fitWas) z.infra.fit[fk].mode = 'auto';   // 끌어서 옮기면 사용자가 정한 자리가 우선(배치 방식은 자동으로)
    saveZ(); this.memo = {};
    S.placing = null; $id('lmap').classList.remove('picking');
    render();
    // 놓은 자리에 정사각형이 안 들어가 멀리 밀려났으면 '옮겼습니다'라고 하지 않고 사실대로 알림
    const nm = { park: '공원·녹지', school: '학교용지', religion: '종교용지(대체부지)' }[kind];
    const g = this.curInf && this.curInf[{ park: 'parkGeom', school: 'schoolGeom', religion: 'relGeom' }[kind]];
    let far = 0;
    try { if (g && !turf.booleanPointInPolygon(turf.point([latlng.lng, latlng.lat]), g)) far = turf.pointToLineDistance(turf.point([latlng.lng, latlng.lat]), turf.polygonToLine(turf.flatten(g).features[0]), { units: 'meters' }); } catch (er) { far = 0; }
    if (far > 15) toast(`그 자리에는 ${nm}이(가) 반듯하게 들어가지 않아 ${Math.round(far)}m 떨어진 곳에 놓였습니다 — 아래 '배치 방식'에서 감싸기·곧게·스케치를 써 보세요`, 7000);
    else toast(`${nm} 위치를 옮겼습니다${fitWas ? " — 배치 방식은 '자동(끌어 옮기기)'로 바꿨습니다" : ''}`);
  },
});
