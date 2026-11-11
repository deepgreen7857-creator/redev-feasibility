// node arch/test-route.js — 단지 안 비상차로(순환형)·소방차 전용구역 시험(shared/gate-zones.js reach·firePads·routeRoad, 2026-11-11)
//  구역 4가지(육각·사각·작은·큰): 배치 뒤 동 사이 빈 땅으로 주출입구 → 동마다 소방 자리 → 주출입구. 세대수는 그대로, 차로가 동을 침범하지 않고, 소방 자리가 다 닿아야 함
const assert = require('assert');
const G = require('../shared/arch-geom.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json'), SP = require('../shared/simple-plan.js'), GZ = require('../shared/gate-zones.js');
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const sites = { 육각: [[0, 0], [200, 0], [230, 90], [150, 170], [60, 190], [0, 120]], 사각: [[0, 0], [200, 0], [200, 170], [0, 170]], 작은: [[0, 0], [110, 0], [110, 90], [0, 90]], 큰: [[0, 0], [320, 0], [320, 240], [0, 240]] };
let n = 0;
for (const [nm, L0] of Object.entries(sites)) {
  const L = G.ccw(L0), E = G.edges(L), tags = L.map(() => 'boundary'); tags[0] = 'road'; const sb = tags.map(t => (t === 'road' ? 3 : 5));
  const zs = GZ.build(E, [{ edge: 0, t: 0.35, kind: 'main' }, { edge: 0, t: 0.75, kind: 'park' }], sb, {});
  const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(L), far: 250, angle: 0, lib: C.평면_라이브러리, winRatio: 2, crit: C.items, dongTypes: DT };
  const v = SP.simple({ pts: L, tags, setbacks: sb, keep: zs.map(z => GZ.keepPoly(z)) }, opt).variants.sort((x, y) => y.units - x.units)[0];
  const rc = GZ.reach(L, v.buildings, zs, {}), fp = GZ.firePads(L, v.buildings, [], { reach: rc }), r = GZ.routeRoad(L, v.buildings, zs, { pads: fp });
  assert.ok(r && r.len > 0, nm + ' 차로 없음');
  assert.strictEqual(r.miss.length, 0, nm + ' 못 닿는 동 ' + r.miss);
  assert.ok(fp.every(f => f.ok), nm + ' 소방 자리 없는 동 ' + fp.filter(f => !f.ok).map(f => f.id));
  const hit = v.buildings.filter(bd => (bd.parts || [bd.poly]).some(R => r.polys.some(pp => R.some(p => G.inside(p[0], p[1], pp))))).length;
  assert.strictEqual(hit, 0, nm + ' 차로가 동 침범');
  n++; console.log(`통과 ${nm}: ${v.units}세대 ${v.buildings.length}개동 · 비상차로 약 ${r.len.toFixed(0)}m · 소방 자리 ${fp.length}곳`);
}
console.log(`\n${n}개 구역 모두 통과`);
