/* /urban 4탭 개략 배치 계산 일꾼(Web Worker) — 화면이 멈추지 않게 따로 계산. 엔진은 /arch와 같은 shared/arch-geom.js
   받는 것: { id, site, opt, cand(방향 후보 °), F(빠른 추정용 기준 층수) } → 돌려주는 것: { id, r(가벼운 결과) | null } */
importScripts('../shared/arch-geom.js?v=27', '../shared/arch-check.js?v=8');
self.onmessage = e => {
  const { id, site, opt, cand, F } = e.data, G = self.ArchGeom;
  let bestA = null, top = -1, out = null;
  try {
    cand.forEach(ang => { try { const r = G.layout(site, Object.assign({}, opt, { angle: ang, fixedF: F, quick: true })); if (r.units && r.gfa > top) { top = r.gfa; bestA = ang; } } catch (er) { /* 건너뜀 */ } });
    if (bestA != null) {
      // 미리보기라 빠른 방식(3m 격자·후보 줄임)으로 — 큰 구역에서 몇 분 걸리던 것을 줄임. 정밀 배치는 /arch
      const r = G.layout(site, Object.assign({}, opt, { angle: bestA, quick: true }));
      if (r.units) out = { angle: bestA, units: r.units, maxFloors: r.maxFloors, far: r.far, bcr: r.bcr, gfa: r.gfa,
        buildings: r.buildings.map(b => ({ floors: b.floors, t: b.t, n: b.n, vname: b.vname || '', poly: b.poly, parts: b.parts, units: b.units })) };
    }
  } catch (er) { out = null; }
  self.postMessage({ id, r: out });
};
