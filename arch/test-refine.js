// node arch/test-refine.js — 일조 연계 다듬기(shared/sun-refine.js) 시험: 간격을 좁힌(단서 경로) 배치에서 출발해 순세대가 늘고 규칙은 지키는지
const assert = require('assert');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), Rf = require('../shared/sun-refine.js'), C = require('../shared/criteria/arch.json');
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const site = { pts: rect(240, 200), tags: ['road', 'boundary', 'north', 'boundary'] }; site.setbacks = site.tags.map(t => t === 'road' ? 3 : 5);
const A = Object.assign({}, C.가정, { corner: { mode: 'min10', min_m: 10 } });
const opt = { units: C.평면, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.45, sideGap_m: 4, sun: C.items.find(i => i.id === 'sunlight_north').이격, lot: G.area(site.pts) * 0.75, far: 300, angle: 0, crit: C.items, winRatio: 2, lib: C.평면_라이브러리, lat: 37.46 };
(async () => {
  const L = G.layout(site, opt), blds = L.buildings;
  let t = Date.now(); const s0 = Rf.netOf(site, blds, opt, 3); console.log(`출발: ${blds.length}개동 세대 ${s0.gross} · 저층 비움 ${s0.low} · 못 쓰는 줄 ${s0.dead} → 순 ${s0.net} (일조 계산 ${Date.now() - t}ms)`);
  const budget = +process.argv[2] || 40000;
  const r = await Rf.refine(site, blds, opt, { budget, seed: 3, onProgress: s => { if (s.round % 3 === 0) console.log(`  ${s.round}바퀴 순 ${s.net} (${s.n}개동, 시도 ${s.tries}, ${(s.ms / 1000).toFixed(0)}초)`); } });
  console.log(`결과: ${r.blds.length}개동 세대 ${r.best.gross} · 저층 비움 ${r.best.low} · 못 쓰는 줄 ${r.best.dead} → 순 ${r.best.net} · 규칙 ${r.best.legal ? '통과' : '위반 ' + r.best.bad.join(', ')} · 채택 ${r.steps.length}수/${r.tries}시도 · ${(r.ms / 1000).toFixed(0)}초`);
  assert.ok(r.best.net >= s0.net, '순세대가 줄면 안 됨');
  assert.ok(r.best.legal, '규칙 위반 없어야');
  const q = K.quick(site, r.blds, opt); assert.ok(!q.rules.some(x => !['spacing', 'side'].includes(x.id)), '검사 다시 통과');
  // 옮긴 동의 벽·세대 조각이 같이 따라갔는지(moved)
  const b = blds[0], m = Rf.moved(b, [5, 3], 10 * Math.PI / 180);
  assert.ok(Math.abs(G.area(m.poly) - G.area(b.poly)) < 1e-6 && Math.abs(m.angle - b.angle - 10) < 1e-9 && m.units.length === b.units.length);
  assert.strictEqual(K.unitSun(site, [m], opt).cols.length, K.unitSun(site, [b], opt).cols.length, '옮긴 동도 세대 창을 그대로 찾아야');
  assert.ok(Math.abs(r.best.fast - r.best.net) <= Math.max(10, r.best.net * 0.03), `빠른 채점 ${r.best.fast} ≈ 엔진 ${r.best.net}`);
  console.log('\n일조 연계 다듬기 시험 통과');
})().catch(e => { console.error(e); process.exit(1); });
