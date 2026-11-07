// node arch/test-refine-mix.js — 일조 연계 다듬기 + V자 꼭짓점형·2호 판상 섞기(shared/dong-shapes.js) 시험
const assert = require('assert');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), Rf = require('../shared/sun-refine.js'), S = require('../shared/dong-shapes.js'), D = require('../shared/dong-lib.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json');
D.init({ units: C.평면, lib: C.평면_라이브러리, types: DT });
const T = S.templates(D);
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const site = { pts: rect(240, 200), tags: ['road', 'boundary', 'north', 'boundary'] }; site.setbacks = site.tags.map(t => t === 'road' ? 3 : 5);
const A = Object.assign({}, C.가정, { corner: { mode: 'min10', min_m: 10 } });
const opt = { units: C.평면, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: C.items.find(i => i.id === 'sunlight_north').이격, lot: G.area(site.pts) * 0.75, far: 300, angle: 0, crit: C.items, winRatio: 2, lib: C.평면_라이브러리, lat: 37.46 };
(async () => {
  assert.strictEqual(T.length, 6); const v22 = T.find(t => t.dname === 'V자 2+2호');
  assert.ok(v22.n === 4 && v22.units.length === 4 && v22.wingUnits.join() === '2,2', 'V자 2+2호 세대 4');
  // 혼자 놓은 V자 2+2호 39층은 미달 0(지난 시험 결과와 같아야)
  const solo = Rf.moved(v22, [120, 100], 0); solo.id = 1; solo.floors = 39;
  const s1 = Rf.netOf(site, [solo], Object.assign({}, opt, { assume: Object.assign({}, A, { maxFloors: 40 }) }), 3); assert.strictEqual(s1.dead + s1.low, 0, 'V자 혼자 미달 0');
  const blds = G.layout(site, opt).buildings, budget = +process.argv[2] || 30000;
  const r0 = await Rf.refine(site, blds, opt, { budget, seed: 5 });
  const r1 = await Rf.refine(site, blds, opt, { budget, seed: 5, shapes: T });
  const kinds = {}; r1.steps.forEach(s => { kinds[s.kind] = (kinds[s.kind] || 0) + 1; });
  const forms = {}; r1.blds.forEach(b => { const k = b.dname || b.vname || b.form; forms[k] = (forms[k] || 0) + 1; });
  console.log(`출발 순 ${r0.start.net} → 섞기 없이 ${r0.best.net}(${r0.blds.length}개동) / 섞기 ${r1.best.net}(${r1.blds.length}개동) · 채택 수 ${JSON.stringify(kinds)}`);
  console.log('섞기 결과 동 구성', JSON.stringify(forms));
  console.log('규칙', r0.best.legal, r1.best.legal, r1.best.bad, '빠른', r1.best.fast, '엔진', r1.best.net);
  assert.ok(r1.best.legal && r0.best.legal, '규칙');
  assert.ok(r1.best.net >= r0.start.net, '순세대가 출발보다 줄면 안 됨');
  assert.ok(Math.abs(r1.best.fast - r1.best.net) <= Math.max(12, r1.best.net * 0.06), `빠른 ${r1.best.fast} ≈ 엔진 ${r1.best.net}`);
  console.log('\nV자·2호 판상 섞기 시험 통과');
})().catch(e => { console.error(e); process.exit(1); });
