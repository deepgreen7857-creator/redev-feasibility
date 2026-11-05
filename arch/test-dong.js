// node arch/test-dong.js — 동 타입 라이브러리(shared/dong-lib.js) 시험
const assert = require('assert');
const C = require('../shared/criteria/arch.json'), DT = require('../shared/criteria/dong-types.json');
const D = require('../shared/dong-lib.js').init({ units: C.평면, lib: C.평면_라이브러리, types: DT });
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
const area = q => { let a = 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += q[j][0] * q[i][1] - q[i][0] * q[j][1]; return Math.abs(a / 2); };
// 두 볼록 사각형(축 정렬이 아닐 수 있음)의 겹침: 외접사각형 겹침 면적으로 어림(축 정렬 조각은 정확)
const bb = q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))];
const ov = (a, b) => { const A = bb(a), B = bb(b); return Math.max(0, Math.min(A[2], B[2]) - Math.max(A[0], B[0])) * Math.max(0, Math.min(A[3], B[3]) - Math.max(A[1], B[1])); };

t('평형별 실제 평면 범위(59·84 판상은 사례 10건 이상)', () => {
  const R = D.ranges();
  [59, 84].forEach(k => { assert.ok(R[k].slab.n >= 10, k); assert.ok(R[k].slab.폭[0] < C.평면[k].폭 && R[k].slab.폭[1] > C.평면[k].폭, `${k} 대표 폭이 범위 안`); });
});
t('대표 평면이 들어가면 대표, 좁은 자리면 실제 사례, 그래도 안 되면 조정 평면', () => {
  const a = D.unitFor('84', 'slab'); assert.strictEqual(a.폭, C.평면[84].폭);
  const b = D.unitFor('84', 'slab', 13); assert.ok(b.폭 <= 13 && !b.adjusted, '실제 사례');
  const R = D.ranges()[84].slab, c = D.unitFor('84', 'slab', R.폭[0] + 0.05); assert.ok(c && c.폭 <= R.폭[0] + 0.05);
  assert.strictEqual(D.unitFor('84', 'slab', 6), null, '범위 밖은 못 만듦');
});
t('조정 평면은 면적 같게(폭 줄이면 깊이 늘어남)', () => {
  const rep = C.평면[59], R = D.ranges()[59].slab; const w = R.폭[0] + 0.01;
  const u = D.unitFor('59', 'slab', w); if (u.adjusted) assert.ok(Math.abs(u.폭 * u.깊이 - rep.폭 * rep.깊이) < 0.01);
});
t('판상 4호 배열: 끝 ≥ 가운데, 좌우 대칭', () => {
  const A = D.assignments('P4', ['59', '84']).map(a => a.join('-'));
  assert.ok(A.includes('84-59-59-84') && A.includes('84-84-84-84') && A.includes('59-59-59-59'));
  assert.ok(!A.includes('59-84-84-59'), '가운데가 더 크면 안 됨');
});
t('꺾인 판상: 모서리 세대 ≤ 날개 세대', () => {
  const A = D.assignments('B4', ['74', '84']).map(a => a.join('-'));
  assert.ok(A.includes('84-74-84-84'), A.join(' '));  // 양주회천 2601동 꼴
  assert.ok(!A.some(s => s.split('-')[1] === '84' && s.includes('74')), '모서리가 날개보다 크면 안 됨');
});
t('혼합 판상 4호 동: 세대 4·코어 2, 세대끼리 안 겹침, 길이 = 세대 폭 합 + 코어', () => {
  const m = D.build('P4', ['84', '59', '59', '84']);
  assert.strictEqual(m.units.length, 4); assert.strictEqual(m.cores.length, 2); assert.deepStrictEqual(m.mixT, { 84: 2, 59: 2 });
  const L = 2 * C.평면[84].폭 + 2 * C.평면[59].폭 + 2 * C.평면_라이브러리.판상_코어.폭_m; assert.ok(Math.abs(m.L - L) < 1e-6, m.L + ' vs ' + L);
  const main = m.units.map(rs => rs[rs.length > 2 ? 1 : 0]);
  for (let i = 0; i < main.length; i++) for (let j = i + 1; j < main.length; j++) assert.ok(ov(main[i], main[j]) < 0.01, `${i}-${j}`);
});
t('탑상 4호 혼합(59·84): 코어 1, 세대 4가 코어와 안 겹침', () => {
  const m = D.build('T4', ['84', '59', '84', '59']); assert.strictEqual(m.cores.length, 1); assert.strictEqual(m.units.length, 4);
  m.units.forEach(rs => rs.forEach(q => assert.ok(ov(q, m.cores[0]) < 0.5)));
});
t('꺾인 판상 4호: 코어 2, 날개가 남쪽 동 위로', () => {
  const m = D.build('B4', ['84', '74', '84', '84']); assert.strictEqual(m.cores.length, 2); assert.ok(m.D > C.평면[84].깊이 + 2 * C.평면[84].폭 - 0.1);
});
t('목록: 59·84로 만들 수 있는 동이 10가지 이상, 단일·혼합 모두', () => {
  const cat = D.catalog(['59', '84']); assert.ok(cat.length >= 10, cat.length);
  assert.ok(cat.some(m => Object.keys(m.mixT).length === 1) && cat.some(m => Object.keys(m.mixT).length === 2));
});
t('Y자 꼬리 늘리기: 날개 2세대(Y6)는 6세대·코어 1, 날개 3세대(Y9)는 피난 메모', () => {
  const m6 = D.build('Y6', ['59', '84', '59', '84', '59', '84']); assert.strictEqual(m6.units.length, 6); assert.strictEqual(m6.cores.length, 1);
  const m3 = D.build('Y3', ['84', '84', '84']); assert.ok(m6.D > m3.D + 5, '꼬리가 길어짐');
  const m9 = D.build('Y9', Array(9).fill('59')); assert.ok(m9.notes.some(x => /피난/.test(x)));
  assert.ok(D.assignments('Y6', ['59', '84']).every(a => [1, 3, 5].every(i => +a[i] >= +a[i - 1])), '날개 끝 ≥ 안쪽');
});
t('T자: 앞동 2호+꼬리 1(코어 1), 꼬리 2(코어 2), 앞동 4호+꼬리 2(코어 3), 꼬리 평형 ≤ 앞동', () => {
  assert.strictEqual(D.build('TJ3', ['84', '84', '59']).cores.length, 1);
  assert.strictEqual(D.build('TJ4', ['84', '84', '59', '59']).cores.length, 2);
  const m = D.build('TJ6', ['84', '84', '84', '84', '59', '59']); assert.strictEqual(m.cores.length, 3); assert.strictEqual(m.units.length, 6);
  assert.ok(!D.assignments('TJ4', ['59', '84']).some(a => a.slice(2).some(x => +x > Math.min(+a[0], +a[1]))));
});
console.log(`\n${n}개 모두 통과`);
const R = D.ranges(); console.log('평형별 판상 폭·깊이 범위(m):'); Object.keys(R).forEach(k => { const s = R[k].slab; if (s) console.log(`  ${k}㎡ 사례 ${s.n}건 폭 ${s.폭.map(v => v.toFixed(1)).join('~')} 깊이 ${s.깊이.map(v => v.toFixed(1)).join('~')} 베이 ${s.베이.join('/')} (${s.상태})`); });
