/* 동 틀(2026-11-07, 사용자 목록 3 '꼭짓점 2세대 V자와 2호 판상을 섞어 배치') — 일조 시뮬레이터(arch/sunsim.js)에만 있던 틀을 공용으로
   V자 꼭짓점형: 꼭짓점이 남쪽, 날개가 북서·북동(±45°), 꼭짓점에 세모 코어. 일자: 판상 2·4·6호
   돌려주는 동 꼴: 가운데 (0,0) 기준 로컬 좌표 { form, n, mixT, parts, cores, units(세대마다 고리 묶음), walls, poly(외곽 껍질), angle 0, dname }
   JbsDong(dong-lib.js)이 init된 뒤에 씀 */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('./arch-geom.js') : g.ArchGeom;
  const D2R = Math.PI / 180;
  function slab(m) {
    const T = p => [p[0] - m.L / 2, p[1] - m.D / 2];
    return { form: 'slab', n: m.n, mixT: m.mixT, parts: m.parts.map(q => q.map(T)), cores: m.cores.map(q => q.map(T)), units: (m.units || []).map(rs => rs.map(q => q.map(T))), walls: G.wallsTo(G.wallsOf(m), T, 0) };
  }
  function V(m1, m2) {
    const D = m1.D, R1 = -45 * D2R, R2 = 45 * D2R, e1 = G.rot([m1.L, D], R1), e2 = G.rot([0, D], R2);
    const T1 = p => { const q = G.rot(p, R1); return [q[0] - e1[0], q[1] - e1[1]]; }, T2 = p => { const q = G.rot(p, R2); return [q[0] - e2[0], q[1] - e2[1]]; };
    const tri = [[0, 0], T1([m1.L, 0]), T2([0, 0])], mixT = {};
    [m1, m2].forEach(m => Object.keys(m.mixT).forEach(t => { mixT[t] = (mixT[t] || 0) + m.mixT[t]; }));
    const b = { form: 'L', n: m1.n + m2.n, mixT,
      parts: [...m1.parts.map(q => q.map(T1)), ...m2.parts.map(q => q.map(T2)), tri],
      cores: [...m1.cores.map(q => q.map(T1)), ...m2.cores.map(q => q.map(T2)), tri],
      units: [...(m1.units || []).map(rs => rs.map(q => q.map(T1))), ...(m2.units || []).map(rs => rs.map(q => q.map(T2)))],
      walls: [...G.wallsTo(G.wallsOf(m1), T1, R1), ...G.wallsTo(G.wallsOf(m2), T2, R2)] };
    const all = b.parts.flat(), c = all.reduce((a, p) => [a[0] + p[0] / all.length, a[1] + p[1] / all.length], [0, 0]), Tc = p => [p[0] - c[0], p[1] - c[1]];
    b.parts = b.parts.map(q => q.map(Tc)); b.cores = b.cores.map(q => q.map(Tc)); b.units = b.units.map(rs => rs.map(q => q.map(Tc))); b.walls = b.walls.map(w => Object.assign({}, w, { a: Tc(w.a), b: Tc(w.b) }));
    b.wingUnits = [m1.n, m2.n];                                  // 날개별 세대 수(서쪽 날개 먼저)
    // 조각·세대가 어느 날개인지(계단식 층수용): 0 서쪽 날개, 1 동쪽 날개, -1 꼭짓점 세모 코어(높은 날개를 따름)
    b.partWing = [...m1.parts.map(() => 0), ...m2.parts.map(() => 1), -1];
    b.unitWing = [...(m1.units || []).map(() => 0), ...(m2.units || []).map(() => 1)];
    return b;
  }
  /* 계단식(날개별 층수, 2026-11-07 사용자 목록 3 '실제 계획 동의 날개별 층수(계단식)도 반영'): 날개 층수 [서, 동] → 조각·세대마다 층수(partFl·unitFl), floors = 높은 날개
     그림자·세대별 일조·광선 검산·세대 수·연면적이 이를 따름(JbsCheck shadowBlds·stepK). 법정 높이 상한(채광창·정북)은 높은 날개(floors) 기준으로 봄 — 안전 쪽 */
  function setWingFloors(b, wf) {
    if (!b.partWing || !b.unitWing || !wf || wf.length < 2) return Object.assign({}, b);
    const top = Math.max(wf[0], wf[1]), fl = w => (w < 0 ? top : wf[w]);
    return Object.assign({}, b, { wingFloors: [wf[0], wf[1]], floors: top, partFl: b.partWing.map(fl), unitFl: b.unitWing.map(fl) });
  }
  // JbsDong(이미 init)으로 틀 목록. 평형 배열은 시뮬레이터와 같음
  function templates(JbsDong) {
    const mk = (id, seq) => JbsDong.build(id, seq);
    const p2 = mk('P2', ['59', '74']), p4 = mk('P4', ['74', '59', '59', '74']), p6 = mk('P6', ['84', '74', '59', '59', '74', '84']);
    return [['V자 2+2호', V(p2, p2)], ['V자 4+2호', V(p4, p2)], ['V자 4+4호', V(p4, p4)], ['일자 2호', slab(p2)], ['일자 4호', slab(p4)], ['일자 6호', slab(p6)]]
      .map(([nm, b]) => Object.assign(b, { dname: nm, vname: nm, poly: G.hull(b.parts.flat()), angle: 0, center: [0, 0], t: Object.keys(b.mixT).sort((x, y) => b.mixT[y] - b.mixT[x])[0] }));
  }
  const api = { slab, V, templates, setWingFloors };
  if (isNode) module.exports = api; else g.JbsShapes = api;
})(typeof window !== 'undefined' ? window : globalThis);
