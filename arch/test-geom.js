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
t('줄 사이 인동간격 ≥ 0.8H(앞줄)', () => {
  const rows = [...new Set(R.buildings.map(b => b.row))].sort((a, b) => a - b);
  for (let i = 1; i < rows.length; i++) {
    const front = R.buildings.filter(b => b.row === rows[i - 1]), back = R.buildings.filter(b => b.row === rows[i]);
    const gap = Math.min(...back.map(b => b.ry)) - Math.max(...front.map(b => b.ry + b.D));
    const h = Math.max(...front.map(b => R.H(b.floors)));
    assert.ok(gap >= 0.8 * h - 0.6, `줄${i}: ${gap.toFixed(1)} < ${(0.8 * h).toFixed(1)}`);
  }
});
t('정북 일조: 북측 경계 거리 d → 높이 ≤ 2d', () => R.buildings.forEach(b => { const d = 200 - (b.ry + b.D); assert.ok(R.H(b.floors) <= Math.max(10, 2 * d) + 1e-6, `${b.id} H=${R.H(b.floors)} d=${d}`); }));
t('남저북고(뒷줄이 같거나 높음)', () => { const m = r => Math.max(...R.buildings.filter(b => b.row === r).map(b => b.floors)); assert.ok(m(R.rows - 1) >= m(0)); });
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
const base = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: 36000, far: 250, angle: 0, fixedF: 25 };
const rn = G.layout(Object.assign({}, sp, { tags: ['road', 'boundary', 'north', 'boundary'] }), base), rp = G.layout(sp, Object.assign({}, base, { parkWidth: 30 }));
const north = r => Math.max(...r.buildings.map(b => b.ry + b.D));
console.log(`정북 변: 북쪽 끝 동 ${north(rn).toFixed(0)}m · ${rn.units}세대 / 공원 30m: 북쪽 끝 동 ${north(rp).toFixed(0)}m · ${rp.units}세대`);
assert.ok(north(rp) > north(rn) && rp.units >= rn.units);
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
