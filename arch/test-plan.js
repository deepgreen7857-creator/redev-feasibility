// node arch/test-plan.js — 심화 배치 엔진(shared/site-plan.js) 시험(작은 반복으로 빠르게)
const assert = require('assert');
const G = require('../shared/arch-geom.js'), PL = require('../shared/site-plan.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json');
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const L = [[0, 0], [200, 0], [230, 90], [150, 170], [60, 190], [0, 120]];
const site = { pts: L, tags: ['road', 'boundary', 'north', 'north', 'boundary', 'road'] }; site.setbacks = site.tags.map(t => t === 'road' ? 3 : 5);
const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(L), far: 250, angle: 0, lib: C.평면_라이브러리, winRatio: 2, crit: C.items, dongTypes: DT };
const res = PL.plan(site, opt, { seed: 3, pop: 6, gens: 2, kids: 4, elite: 2 });
assert.ok(res.variants.length === 3, '세 가지 안');
res.variants.forEach(v => { assert.strictEqual(v.rules.length, 0, v.label + ' 규칙 위반 없음'); assert.ok(v.units > 0 && v.far <= 250.05, v.label); });
assert.ok(new Set(res.variants.map(v => v.buildings.map(b => b.dtype + b.floors).join())).size === 3, '세 안이 서로 다름');
console.log('통과 심화 배치 세 가지 안(규칙 위반 없음·서로 다름)', res.variants.map(v => `${v.label} ${v.units}세대 ${v.far.toFixed(0)}%`).join(' / '), `· 구도 ${res.decodes}회 ${(res.ms / 1000).toFixed(0)}초`);
