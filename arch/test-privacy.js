// node arch/test-privacy.js — 시선 간섭(창끼리 마주 봄) 경고 시험
const assert = require('assert');
const K = require('../shared/arch-check.js'), C = require('../shared/criteria/arch.json');
const box = (x, y, L, D) => [[x, y], [x + L, y], [x + L, y + D], [x, y + D]];
const opt = { assume: Object.assign({}, C.가정, { corner: { mode: 'off' } }), crit: C.items, spacing: 0.8, lat: 37.46, sun: C.items.find(i => i.id === 'sunlight_north').이격, winRatio: 2 };
const site = { pts: box(-100, -100, 300, 300), tags: ['boundary', 'boundary', 'north', 'boundary'], setbacks: [5, 5, 5, 5] };
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
t('비껴 마주 보는 탑상 두 동(대각 14.4m) → 시선 간섭', () => {
  const a = { id: 1, poly: box(0, 0, 20, 20), floors: 10, form: 'tower', angle: 0 }, b = { id: 2, poly: box(32, 28, 20, 20), floors: 10, form: 'tower', angle: 0 };
  const pv = K.privacyPair(a, b, opt); assert.ok(pv && Math.abs(pv.d - Math.hypot(12, 8)) < 0.2, JSON.stringify(pv && pv.d));
  const v = K.verify(site, [a, b], opt); const r = v.risks.find(x => x.id === 'privacy'); assert.ok(r && /심의 지적 가능/.test(r.항목), JSON.stringify(v.risks.map(x => x.id)));
  const d = K.dims(site, [a, b], opt).find(x => x.kind === 'privacy'); assert.ok(d && d.need === 15);
});
t('판상 두 동 측벽끼리 8m(창 없는 벽) → 시선 간섭 아님', () => {
  const a = { id: 1, poly: box(0, 0, 40, 12), floors: 10, form: 'slab', angle: 0 }, b = { id: 2, poly: box(48, 0, 40, 12), floors: 10, form: 'slab', angle: 0 };
  assert.strictEqual(K.privacyPair(a, b, opt), null);
});
t('탑상 정면 30m(가정 15m 이상) → 아님, 기준 바꾸면 걸림', () => {
  const a = { id: 1, poly: box(0, 0, 20, 20), floors: 5, form: 'tower', angle: 0 }, b = { id: 2, poly: box(50, 0, 20, 20), floors: 5, form: 'tower', angle: 0 };
  assert.strictEqual(K.privacyPair(a, b, opt), null);
  assert.ok(K.privacyPair(a, b, Object.assign({}, opt, { privacy: { min_m: 35 } })));
});
t('서로 등 돌린 창(같은 방향) → 아님', () => {
  const a = { id: 1, poly: box(0, 0, 40, 12), floors: 10, form: 'slab', angle: 0 }, b = { id: 2, poly: box(0, 40, 40, 12), floors: 10, form: 'slab', angle: 0 };
  // 판상 앞뒤 창은 서로 마주 봄(28m) → 15m 이상이라 아님. 간격 10m면 법정(인동) 위반이라 시선 경고는 규칙에 맡기고 빠짐
  assert.strictEqual(K.privacyPair(a, b, opt), null);
  const c = { id: 3, poly: box(0, 22, 40, 12), floors: 10, form: 'slab', angle: 0 };
  const v = K.verify(site, [a, c], opt); assert.ok(!v.risks.some(x => x.id === 'privacy'), '법정 위반 쌍은 시선 경고에서 뺌');
});
console.log(`\n${n}개 모두 통과`);
