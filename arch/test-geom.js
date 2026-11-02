// node arch/test-geom.js
const assert = require('assert');
const G = require('../shared/arch-geom.js'), C = require('../shared/criteria/arch.json');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const run = (pts, tags, far, extra = {}) => {
  const sb = tags.map(tg => tg === 'road' ? A.roadSetback_m : tg === 'arterial' ? A.arterialSetback_m : A.boundarySetback_m);
  return G.layout({ pts, setbacks: sb, tags }, Object.assign({ units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(pts) * 0.75, far, angle: 0 }, extra));
};
t('동지 정오 태양고도(북위 37.46°) ≈ 29.1°', () => { const s = G.sun(37.46, 12); assert.ok(Math.abs(s.alt * 180 / Math.PI - 29.1) < 0.2); });
t('정오 그림자는 북쪽으로', () => { const sh = G.shadow([[0,0],[10,0],[10,10],[0,10]], 30, G.sun(37.46, 12)); assert.ok(Math.max(...sh.map(p => p[1])) > 50); });
const R = run(rect(240, 200), ['road', 'boundary', 'north', 'boundary'], 250);
t('목표 용적률 250% 이하, 근접', () => { assert.ok(R.far <= 250.01, R.far); assert.ok(R.far > 200, R.far); });
t('동이 구역 안·이격 안에 있음', () => R.buildings.forEach(b => b.poly.forEach(p => { assert.ok(p[0] >= 4.9 && p[0] <= 235.1 && p[1] >= 2.9); })));
t('남북으로 겹치는 동 사이 인동간격 ≥ 0.8H(남쪽 동)', () => {
  const B = R.buildings;
  B.forEach(a => B.forEach(b => {
    if (a === b || b.ry <= a.ry) return;
    if (Math.min(a.rx + a.L, b.rx + b.L) - Math.max(a.rx, b.rx) <= 0) return;
    const gap = b.ry - (a.ry + a.D), h = R.H(a.floors);
    assert.ok(gap >= 0.8 * h - 0.6, `${a.id}→${b.id}: ${gap.toFixed(1)} < ${(0.8 * h).toFixed(1)}`);
  }));
});
t('정북 일조: 북측 경계 거리 d → 높이 ≤ 2d', () => R.buildings.forEach(b => { const d = 200 - (b.ry + b.D); assert.ok(R.H(b.floors) <= Math.max(10, 2 * d) + 1e-6, `${b.id} H=${R.H(b.floors)} d=${d}`); }));
t('남저북고(가장 남쪽 줄이 최고층을 독차지하지 않음)', () => { const m = r => Math.max(...R.buildings.filter(b => b.row === r).map(b => b.floors)); assert.ok(R.rows < 2 || Math.max(...[...Array(R.rows).keys()].slice(1).map(m)) >= m(0)); });
t('평형 비율 대략 유지(84형이 가장 많음)', () => assert.ok(R.byType[84] >= R.byType[59] && R.byType[59] > R.byType[114]));
t('간선도로변 20m 이격', () => { const R2 = run(rect(240, 200), ['arterial', 'boundary', 'boundary', 'boundary'], 250); R2.buildings.forEach(b => b.poly.forEach(p => assert.ok(p[1] >= 19.9))); });
t('일조시간 계산(남쪽 빈 땅은 충분)', () => { const r = G.sunHours(R.buildings, R.H, 37.46, [[120, -30]], C.items.find(i => i.id === 'sun_tolerance')); assert.ok(r[0].ok && r[0].total > 7); });
t('회전 배치(15°)도 구역 안', () => { const R3 = run(rect(240, 200), ['road', 'boundary', 'boundary', 'boundary'], 230, { angle: 15 }); assert.ok(R3.units > 0); R3.buildings.forEach(b => b.poly.forEach(p => assert.ok(G.inside(p[0], p[1], rect(240, 200))))); });
t('ㄱ자(오목) 구역', () => { const L = [[0,0],[200,0],[200,80],[90,80],[90,200],[0,200]]; const R4 = run(L, L.map(() => 'boundary'), 230); assert.ok(R4.units > 0); R4.buildings.forEach(b => b.poly.forEach(p => assert.ok(G.inside(p[0], p[1], L)))); });
console.log(`\n${n}개 모두 통과 — 예시 240×200m: ${R.buildings.length}개동, ${R.units}세대, 용적률 ${R.far.toFixed(1)}%, 건폐율 ${R.bcr.toFixed(1)}%, 최고 ${R.maxFloors}층, ${R.rows}줄`, R.byType);
const site = { pts: rect(240, 200), tags: ['road', 'boundary', 'north', 'boundary'] }; site.setbacks = site.tags.map(tg => tg === 'road' ? 3 : 5);
const alts = G.alternatives(site, { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: 36000, far: 250, angle: 0 });
alts.forEach(a => console.log(`  ${a.label}: ${a.buildings.length}개동 ${a.units}세대 용적률 ${a.far.toFixed(1)}% 건폐율 ${a.bcr.toFixed(1)}% 최고 ${a.maxFloors}층`));
assert.ok(alts.length >= 2 && alts.every(a => a.far <= 250.01 && a.far >= 242));
console.log('대안 통과');
// 공원·녹지: 북쪽 공원 폭 30m면 북측 경계 바로 옆 동도 더 높게
const sp = { pts: rect(240, 200), tags: ['road', 'boundary', 'park', 'boundary'] }; sp.setbacks = [3, 5, 5, 5];
const base = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: 36000, far: 250, angle: 0, fixedF: 25, lib: C.평면_라이브러리 };
const rn = G.layout(Object.assign({}, sp, { tags: ['road', 'boundary', 'north', 'boundary'] }), base), rp = G.layout(sp, Object.assign({}, base, { parkWidth: 30 }));
const north = r => Math.max(...r.buildings.map(b => b.ry + b.D));
console.log(`정북 변: 북쪽 끝 동 ${north(rn).toFixed(0)}m · ${rn.units}세대 / 공원 30m: 북쪽 끝 동 ${north(rp).toFixed(0)}m · ${rp.units}세대`);
assert.ok(north(rp) >= north(rn) && rp.units > rn.units);
console.log('공원·녹지 통과');

// 소형만(39·49) 구성 — 가로주택·역세권형
{
  const small = run(rect(240, 200), ['road', 'boundary', 'north', 'boundary'], 250, { mix: { 39: 50, 49: 50 } });
  const ty = Object.keys(small.byType);
  assert(ty.length && ty.every(t => t === '39' || t === '49'), '소형 구성에 다른 평형이 섞임: ' + ty);
  const TrafficCalc = require('../traffic/traffic-calc.js'), TC = require('../shared/criteria/traffic.json');
  let u60 = 0, a85 = 0; Object.entries(small.byType).forEach(([t, n]) => { if (+t <= 60) u60 += n; a85 += n * C.평면[t].전용; });
  const pk = TrafficCalc.parking(TC, { units: small.units, units60below: u60, area85below: a85, area85above: 0 });
  console.log(`소형 구성: ${small.units}세대 ${JSON.stringify(small.byType)} 법정주차 ${JSON.stringify(pk).slice(0, 160)}`);
  assert(u60 === small.units);
  console.log('소형 평형 통과');
}

// 주동 형태: 판상·탑상·혼합·Y·ㄱ·ㅁ — 모든 동이 구역 안, 세대수 > 0
['slab', 'tower', 'mix', 'Y', 'L', 'court'].forEach(form => t(`주동 형태 ${G.FORM_NAME[form]}`, () => {
  const P = rect(240, 200), R5 = run(P, ['road', 'boundary', 'north', 'boundary'], 250, { form });
  assert.ok(R5.units > 0, form + ' 세대수 0');
  R5.buildings.forEach(b => { assert.strictEqual(b.form, form === 'mix' ? b.form : form); b.parts.flat().forEach(p => assert.ok(G.inside(p[0], p[1], P))); });
}));

// 채광창 이격(시행령 제86조③1호·⑥): 남쪽 도로 변(도로 폭 12m)에서 공동주택은 도로 중심선까지 → 높이 ≤ 2 × (거리 + 6)
t('채광창 벽면 → 인접 대지경계선(도로 중심선) 높이 ≤ 2×거리', () => {
  const P = rect(240, 200), W12 = [12, 0, 0, 0];
  ['slab', 'tower'].forEach(form => {
    const R6 = run(P, ['road', 'boundary', 'boundary', 'boundary'], 250, { form, winRatio: 2, edgeW: W12, lib: C.평면_라이브러리 });
    R6.buildings.forEach(b => {
      const dS = Math.min(...b.poly.map(p => p[1])), dW = Math.min(...b.poly.map(p => p[0])), dE = 240 - Math.max(...b.poly.map(p => p[0])), dN = 200 - Math.max(...b.poly.map(p => p[1]));
      const h = R6.H(b.floors);
      assert.ok(h <= 2 * (dS + 6) + 0.01, `${form} ${b.id} 남 ${h} > 2×(${dS.toFixed(1)}+6)`);
      assert.ok(h <= 2 * dN + 0.01, `${form} ${b.id} 북 ${h} > 2×${dN.toFixed(1)}`);
      if (form === 'tower') { assert.ok(h <= 2 * dW + 0.01 && h <= 2 * dE + 0.01, `${form} ${b.id} 옆`); }
    });
    console.log(`  ${form}: ${R6.buildings.length}개동 ${R6.units}세대 용적률 ${R6.far.toFixed(1)}% 최고 ${R6.maxFloors}층 · 동 크기 ${R6.buildings[0].L.toFixed(1)}×${R6.buildings[0].D.toFixed(1)}m`);
  });
});

// 성격이 '대지경계'로 표시된 변이라도 도로가 닿아 있으면(edgeW) 중심선까지 잼 — 표시 실수에 덜 민감하게
t('도로가 닿은 변은 성격 표시와 관계없이 도로 중심선 적용', () => {
  const P = rect(240, 200);
  const a = run(P, ['boundary', 'boundary', 'boundary', 'boundary'], 300, { form: 'tower', winRatio: 2, lib: C.평면_라이브러리, quick: 1 });
  const b = run(P, ['boundary', 'boundary', 'boundary', 'boundary'], 300, { form: 'tower', winRatio: 2, edgeW: [20, 20, 20, 20], lib: C.평면_라이브러리, quick: 1 });
  assert.ok(b.far >= a.far - 0.01, `도로 폭이 들어가면 용적률이 줄면 안 됨 ${a.far} → ${b.far}`);
  console.log(`  대지경계만 ${a.far.toFixed(1)}% → 사방 20m 도로 ${b.far.toFixed(1)}%`);
});

// 정남 기준(건축법 제61조③): 북쪽 '정북' 변 제한은 빠지고 남쪽 변에 같은 거리 적용
t('정남 기준 일조: 남쪽 경계에서 높이 10m 초과 부분 높이의 1/2 이상', () => {
  const P = rect(240, 200);
  const R7 = run(P, ['boundary', 'boundary', 'north', 'boundary'], 250, { southBase: true });
  R7.buildings.forEach(b => {
    const dS = Math.min(...b.poly.map(p => p[1])), h = R7.H(b.floors);
    if (h > 10) assert.ok(dS + 0.01 >= h * sunN.높이10m초과_높이비, `${b.id} 남쪽 ${dS.toFixed(1)}m < ${h}/2`);
  });
  console.log(`  정남 기준: ${R7.buildings.length}개동 ${R7.units}세대 용적률 ${R7.far.toFixed(1)}%`);
});
