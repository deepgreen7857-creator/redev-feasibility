// node arch/test-check.js — 배치 검사 부품(shared/arch-check.js) 시험
const assert = require('assert');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), C = require('../shared/criteria/arch.json');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
const A = C.가정, U = C.평면, sunN = C.items.find(i => i.id === 'sunlight_north').이격;
const rect = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];
const site = { pts: rect(240, 200), tags: ['road', 'boundary', 'north', 'boundary'] }; site.setbacks = site.tags.map(tg => tg === 'road' ? 3 : 5);
const opt = { units: U, assume: A, mix: { 59: 40, 84: 50, 114: 10 }, spacing: 0.8, sun: sunN, lot: G.area(site.pts) * 0.75, far: 250, angle: 0, crit: C.items, winRatio: 2, lib: C.평면_라이브러리 };
const R = G.layout(site, opt);
const blds = R.buildings.map(b => ({ id: b.id, poly: b.poly, floors: b.floors, form: b.form, angle: b.angle, t: b.t, n: b.n }));
const box = (x, y, L, D) => [[x, y], [x + L, y], [x + L, y + D], [x, y + D]];

t('자동 배치 결과는 규칙 위반이 없음(판상)', () => { const q = K.quick(site, blds, opt); assert.ok(q.pass, JSON.stringify(q.rules.slice(0, 3))); assert.ok(Math.abs(q.far - R.far) < 0.5, q.far + ' vs ' + R.far); });
t('대지 밖으로 나간 동 → 경계 위반', () => { const q = K.quick(site, [{ id: 1, poly: box(230, 50, 30, 12), floors: 10, form: 'slab', angle: 0, t: '84', n: 2 }], opt); assert.ok(q.rules.some(r => r.id === 'boundary')); });
t('겹친 두 동 → 겹침 위반', () => { const q = K.quick(site, [{ id: 1, poly: box(50, 50, 40, 12), floors: 10, form: 'slab', angle: 0 }, { id: 2, poly: box(70, 55, 40, 12), floors: 10, form: 'slab', angle: 0 }], opt); assert.ok(q.rules.some(r => r.id === 'collide')); });
t('앞뒤 동 거리: 낮은 남쪽 동 + 높은 북쪽 동은 10m 하한(시행령 제86조③2호나목)', () => {
  const s = { id: 1, poly: box(50, 30, 40, 12), floors: 3, form: 'slab', angle: 0 }, nb = { id: 2, poly: box(50, 30 + 12 + 9, 40, 12), floors: 10, form: 'slab', angle: 0 };
  const q = K.quick(site, [s, nb], opt), r = q.rules.find(x => x.id === 'spacing'); assert.ok(r && /나목/.test(r.근거) && r.기준.startsWith('10.0'), JSON.stringify(r));
});
t('앞뒤 동 거리: 높은 남쪽 동이면 남쪽 높이 × 0.8(가목)', () => {
  const s = { id: 1, poly: box(50, 30, 40, 12), floors: 20, form: 'slab', angle: 0 }, nb = { id: 2, poly: box(50, 30 + 12 + 30, 40, 12), floors: 10, form: 'slab', angle: 0 };
  const q = K.quick(site, [s, nb], opt), r = q.rules.find(x => x.id === 'spacing'); const need = 0.8 * (20 * A.floorHeight_m + A.groundExtra_m);
  assert.ok(r && /가목/.test(r.근거) && Math.abs(parseFloat(r.기준) - need) < 0.1, JSON.stringify(r));
});
t('판상 옆 동은 측벽 4m(마목)', () => {
  const a = { id: 1, poly: box(50, 50, 40, 12), floors: 20, form: 'slab', angle: 0 }, b = { id: 2, poly: box(93, 50, 40, 12), floors: 20, form: 'slab', angle: 0 };
  assert.ok(K.quick(site, [a, b], opt).rules.some(r => r.id === 'side' && /마목/.test(r.근거)));
  b.poly = box(95, 50, 40, 12); assert.ok(!K.quick(site, [a, b], opt).rules.some(r => r.id === 'side'));
});
t('북측 경계에 붙은 고층 → 정북 일조 위반', () => { const q = K.quick(site, [{ id: 1, poly: box(100, 180, 40, 12), floors: 25, form: 'slab', angle: 0 }], opt); assert.ok(q.rules.some(r => r.id === 'sun_north')); });
t('선호 점수 0~1, 자동 배치 용적률 채움 0.95 이상', () => { const e = K.evaluate(site, blds, opt); e.prefs.forEach(p => assert.ok(p.점수 >= 0 && p.점수 <= 1, p.id)); assert.ok(e.prefs.find(p => p.id === 'far').점수 > 0.95); assert.ok(e.score > 0 && e.score <= 1); });
t('정밀 검증: 가까운 남쪽 고층 → 수인한도 일조 위험(경험, 원인·영향·대안)', () => {
  const s = { id: 1, poly: box(10, 30, 200, 12), floors: 25, form: 'slab', angle: 0 }, nb = { id: 2, poly: box(90, 30 + 12 + 60, 40, 12), floors: 25, form: 'slab', angle: 0 };
  const v = K.verify(site, [s, nb], opt), r = v.risks.find(x => x.id === 'sun_tolerance');
  assert.ok(r && r.갈래 === '경험' && ['주의', '고위험'].includes(r.등급) && r.원인 && r.영향 && r.대안 && r.동.includes(1), JSON.stringify(v.risks));
});
console.log(`\n${n}개 모두 통과`);
const v = K.verify(site, blds, opt);
console.log(`자동 배치 ${blds.length}개동 검사: 규칙 위반 ${v.rules.length} · 위험 ${v.risks.length} (${v.risks.map(r => r.등급 + ' ' + r.항목).join(', ') || '없음'}) · 선호 점수 ${v.score.toFixed(2)}`);
