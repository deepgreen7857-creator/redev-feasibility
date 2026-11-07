// node arch/test-gate.js — 단지 출입구 자리(shared/gate-zones.js)가 배치에서 비워지는지 시험 (2026-11-08)
//  주출입구(문주·진입광장)·주차장 출입구(지하 경사로)·부출입구 자리에 동이 서면 안 됨. 건축한계선(도로변 이격) 안쪽까지 이어짐
const assert = require('assert');
const G = require('../shared/arch-geom.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json'), SP = require('../shared/simple-plan.js'), GZ = require('../shared/gate-zones.js'), CK = require('../shared/arch-check.js');
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const L = [[0, 0], [200, 0], [230, 90], [150, 170], [60, 190], [0, 120]];
const tags = ['road', 'boundary', 'north', 'north', 'boundary', 'road'], sb = tags.map(t => (t === 'road' ? 3 : 5));
const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(L), far: 250, angle: 0, lib: C.평면_라이브러리, winRatio: 2, crit: C.items, dongTypes: DT };
const E = G.edges(L);
// 남쪽 도로 변(0번)에 주출입구·주차장 출입구, 서쪽 도로 변(5번)에 부출입구
const entries = [{ edge: 0, t: 0.35, kind: 'main' }, { edge: 0, t: 0.75, kind: 'park' }, { edge: 5, t: 0.5, kind: 'sub' }];
const zs = GZ.build(E, entries, sb, {});
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };

t('경사로 길이 = 3.6m ÷ 17% + 완화 6m ≈ 27.2m', () => assert.ok(Math.abs(GZ.rampLen({}) - (3.6 / 0.17 + 6)) < 1e-9));
t('출입구 자리는 경계에서 시작해 건축한계선 안쪽까지(주출입구 깊이 = 3 + 20m)', () => {
  const m = zs.find(z => z.kind === 'main'); assert.strictEqual(m.D, 23); assert.strictEqual(m.w, 15);
  const p = zs.find(z => z.kind === 'park'); assert.ok(Math.abs(p.D - (3 + GZ.rampLen({}))) < 1e-9);
  zs.forEach(z => { const c = z.q(0, z.D / 2); assert.ok(G.inside(c[0], c[1], L), z.name + ' 가운데가 구역 안'); });
});
t('변이 폭보다 길면 출입구가 변 끝을 넘지 않음', () => {
  const z = GZ.zone('main', [1, 0], E[0], 3, {}); assert.ok(z.poly.every(p => p[0] >= -1e-9), JSON.stringify(z.poly));
});

const base = SP.simple({ pts: L, tags, setbacks: sb }, opt);
const site = { pts: L, tags, setbacks: sb, keep: zs.map(z => GZ.keepPoly(z)) };
const withG = SP.simple(site, opt);
const inZone = b => (b.parts || [b.poly]).some(R => R.some(p => zs.some(z => G.inside(p[0], p[1], z.poly))) || zs.some(z => z.poly.some(p => G.inside(p[0], p[1], R))));
t('출입구 자리에 동이 하나도 없음(모든 안)', () => withG.variants.forEach(v => v.buildings.forEach(b => assert.ok(!inZone(b), `${v.dtype} ${b.id}동이 출입구 자리에 걸림`))));
t('법정 위반 0 유지', () => withG.variants.forEach(v => assert.strictEqual(v.rules.length, 0, v.dtype + ' ' + JSON.stringify(v.rules.slice(0, 2)))));
t('검사기(arch-check)가 출입구 침범을 잡아냄', () => {
  const v = base.variants.find(x => x.buildings.some(inZone));
  if (!v) { console.log('   (출입구 없는 배치에서도 출입구 자리를 지나는 동이 없어 생략)'); return; }
  const q = CK.quick(site, v.buildings, opt); assert.ok(q.rules.some(r => r.id === 'gate'), JSON.stringify(q.rules.map(r => r.id)));
});
const best = r => Math.max(...r.variants.map(v => v.units));
console.log(`\n${n}개 모두 통과 — 가장 많은 안: 출입구 없이 ${best(base)}세대 → 출입구 자리 비움 ${best(withG)}세대`);
