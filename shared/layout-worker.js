/* 사업성 첫 화면(★빠른 사업성) '배치 확인' 일꾼 — 구역계가 정해지면 /arch와 같은 엔진(arch-geom.js)으로 한 번 개략 배치해
   목표 연면적(획지 × 용적률)이 실제 땅 모양·정북 일조·인동간격·채광창 이격으로 다 들어가는지 확인. 화면이 멈추지 않게 따로 계산
   받는 것: { id, ring:[[lng,lat]…], lot, far, mix:{59:40,…}, zoning } → { id, r: { units, gfa, far, maxFloors, n, target, angle } | null, err } */
importScripts('arch-geom.js?v=23', 'arch-check.js?v=2');
let C = null;
self.onmessage = async e => {
  const { id, ring, lot, far, mix, zoning } = e.data, G = self.ArchGeom;
  try {
    if (!C) C = await (await fetch('criteria/arch.json', { cache: 'no-cache' })).json();
    const rg = G.openRing(ring), pr = G.projector(rg), pts = G.ccw(rg.map(pr.to));
    // 도로 자료가 없는 화면이라 방향으로만: 북쪽을 향한 변은 정북 인접대지(일조), 나머지는 대지경계(보수적)
    const tags = G.edges(pts).map(ed => (ed.out[1] > 0.6 ? 'north' : 'boundary'));
    const A0 = C.가정, sb = tags.map(() => A0.boundarySetback_m);
    const win = (C.items || []).find(i => i.id === 'window_setback'), sun = ((C.items || []).find(i => i.id === 'sunlight_north') || {}).이격;
    const mx = {}; Object.entries(mix || {}).forEach(([t, v]) => { if (+v > 0 && C.평면[t]) mx[t] = +v; });
    if (!Object.keys(mx).length) mx[84] = 100;
    const opt = { units: C.평면, lib: C.평면_라이브러리, assume: Object.assign({}, A0), mix: mx, form: 'slab', spacing: 0.8, sun, lot, far,
      winRatio: win ? (/준주거|근린상업/.test(zoning || '') ? (win.값.근린상업_준주거_배수 || 4) : (win.값.배수 || 2)) : 0, edgeW: [] };
    const cand = new Set([0]);
    G.edges(pts).sort((x, y) => y.len - x.len).slice(0, 2).forEach(ed => { let d = Math.atan2(ed.b[1] - ed.a[1], ed.b[0] - ed.a[0]) * 180 / Math.PI; while (d > 45) d -= 90; while (d < -45) d += 90; cand.add(Math.round(d)); });
    const F = Math.round(A0.minFloors + (A0.maxFloors - A0.minFloors) * 0.6);
    let bestA = null, top = -1;
    cand.forEach(ang => { try { const r = G.layout({ pts, tags, setbacks: sb }, Object.assign({}, opt, { angle: ang, fixedF: F, quick: true })); if (r.units && r.gfa > top) { top = r.gfa; bestA = ang; } } catch (er) { /* 건너뜀 */ } });
    if (bestA == null) { self.postMessage({ id, r: null, err: '동이 들어가지 않습니다' }); return; }
    const r = G.layout({ pts, tags, setbacks: sb }, Object.assign({}, opt, { angle: bestA, quick: true }));   // 참고값이라 빠른 방식
    self.postMessage({ id, r: r.units ? { units: r.units, gfa: r.gfa, far: r.far, maxFloors: r.maxFloors, n: r.buildings.length, target: r.target || lot * far / 100, angle: bestA } : null });
  } catch (er) { self.postMessage({ id, r: null, err: String(er && er.message || er) }); }
};
