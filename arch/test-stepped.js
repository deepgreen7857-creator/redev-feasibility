// node arch/test-stepped.js — 계단식(날개별 층수) 시험: 세대 수·연면적·세대별 일조·광선 검산이 날개 층수를 따르는지
const assert = require('assert');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), V = require('../shared/sun-verify.js'), Rf = require('../shared/sun-refine.js'), S = require('../shared/dong-shapes.js'), D = require('../shared/dong-lib.js'), C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json');
D.init({ units: C.평면, lib: C.평면_라이브러리, types: DT });
const T = S.templates(D), v44 = T.find(t => t.dname === 'V자 4+4호');
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const site = { pts: rect(300, 300), tags: ['boundary', 'boundary', 'boundary', 'boundary'], setbacks: [5, 5, 5, 5] };
const A = Object.assign({}, C.가정, { maxFloors: 40, corner: { mode: 'off' } }), opt = { units: C.평면, assume: A, crit: C.items, lat: 37.46, spacing: 0.8 };
const put = (b, x, y, f) => { const m = Rf.moved(b, [x, y], 0); m.id = 1; m.floors = f; return m; };
let n = 0; const t = (name, fn) => Promise.resolve(fn()).then(() => { n++; console.log('통과', name); });
(async () => {
  await t('날개 층수 [30, 20] → 세대 4×30 + 4×20 = 200, 연면적도 같은 비율', () => {
    const b = put(v44, 150, 150, 30), s = S.setWingFloors(b, [30, 20]);
    assert.strictEqual(s.floors, 30); assert.strictEqual(K.unitsOf(b), 240); assert.strictEqual(K.unitsOf(s), 200);
    assert.ok(Math.abs(K.gfaOf(s, opt) / K.gfaOf(b, opt) - 200 / 240) < 1e-9);
    const us = K.unitSun(site, [s], opt); assert.strictEqual(us.total, 200, '세대별 일조 총세대');
  });
  await t('남쪽 V자의 동쪽 날개를 낮추면 그 북동쪽 동 저층 일조가 나아짐(엔진·광선 둘 다)', async () => {
    const south = put(v44, 150, 100, 35), north = Object.assign(put(v44, 162, 140, 30), { id: 2 });
    const low = S.setWingFloors(south, [35, 12]);
    const a = K.unitSun(site, [south, north], opt), b = K.unitSun(site, [low, north], opt);
    const lostN = r => r.per[2] ? r.per[2].lost : 0;
    console.log(`   북쪽 동 미달: 날개 같을 때 ${lostN(a)} → 동쪽 날개 12층 ${lostN(b)}`);
    assert.ok(lostN(b) <= lostN(a));
    const vo = { fh: A.floorHeight_m, groundExtra: A.groundExtra_m, lat: 37.46 };
    const r = await V.check([low, north], b, vo); console.log(`   광선 검산 일치 ${(r.rate * 100).toFixed(1)}%`); assert.ok(r.rate >= 0.97);
  });
  await t('다듬기 빠른 채점도 날개 층수를 따름', () => {
    const s = S.setWingFloors(put(v44, 150, 150, 30), [30, 20]), cur = Rf.attachCols(site, [s], opt);
    const f = Rf.fastNet(cur, V.sunTrack({ lat: 37.46, step: 5 }), opt, 3); assert.strictEqual(f.gross, 200);
  });
  console.log(`\n${n}개 모두 통과`);
})().catch(e => { console.error(e); process.exit(1); });
