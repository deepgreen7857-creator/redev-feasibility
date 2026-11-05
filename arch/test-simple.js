// node arch/test-simple.js — 기본 배치(shared/simple-plan.js) 시험: 같은 모양 동을 일정하게 놓고 법정 위반이 없어야 함
const assert = require('assert');
const G = require('../shared/arch-geom.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json'), SP = require('../shared/simple-plan.js');
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const L = [[0, 0], [200, 0], [230, 90], [150, 170], [60, 190], [0, 120]], site = { pts: L, tags: ['road', 'boundary', 'north', 'north', 'boundary', 'road'] };
site.setbacks = site.tags.map(t => (t === 'road' ? 3 : 5));
const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(L), far: 250, angle: 0, lib: C.평면_라이브러리, winRatio: 2, crit: C.items, dongTypes: DT };
const r = SP.simple(site, opt);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
t('동 타입 6가지(판상 4·6·8·10호, 꺾인 판상 3호, 탑상 4호) 모두 배치가 나옴', () => assert.deepStrictEqual(r.variants.map(v => v.dtype), SP.TYPES));
t('모든 안 법정 위반 0(경계·동 사이 거리·정북 일조·채광창)', () => r.variants.forEach(v => assert.strictEqual(v.rules.length, 0, v.dtype + ' ' + JSON.stringify(v.rules.slice(0, 2)))));
t('한 안 안에서는 같은 동 타입·같은 평형 배열만', () => r.variants.forEach(v => { assert.ok(v.buildings.every(b => b.dtype === v.dtype && b.seq.join() === v.seq.join()), v.dtype); }));
t('줄은 나란히(같은 줄 동은 같은 높이에서 시작)', () => r.variants.forEach(v => { const rows = {}; v.buildings.forEach(b => { (rows[b.row] = rows[b.row] || []).push(b); }); Object.values(rows).forEach(bs => { const ys = bs.map(b => Math.min(...b.parts.flat().map(p => G.rot(p, -v.angle * Math.PI / 180)[1]))); assert.ok(Math.max(...ys) - Math.min(...ys) < 0.01, v.dtype); }); }));
t('계산 10초 이내', () => assert.ok(r.ms < 10000, r.ms));
console.log(`\n${n}개 모두 통과`);
r.variants.forEach(v => console.log(`  ${v.label}: ${v.seq.join('-')} · ${v.Flo}~${v.Fhi}층 · ${v.buildings.length}동 ${v.units}세대 · 용적률 ${v.far.toFixed(0)}% · 평형 비율 차이 ${v.mixErr.toFixed(2)}`));
