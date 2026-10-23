import test from 'node:test';
import assert from 'node:assert';
import { toManwon, parseAsking, summarize } from './askingParse.js';
test('금액 읽기', () => {
  assert.equal(toManwon('5억 2,000'), 52000);
  assert.equal(toManwon('5억'), 50000);
  assert.equal(toManwon('9,800'), 9800);
});
test('매매만 뽑기', () => {
  const t = '래미안 101동\n매매 5억 2,000\n아파트 84/59m²\n전세 3억\n매매5억 4,500 확인매물\n월세 1,000/80\n매매 4억';
  assert.deepEqual(parseAsking(t), [52000, 54500, 40000]);
});
test('요약', () => {
  assert.deepEqual(summarize([40000, 52000, 54500]), { low: 40000, high: 54500, n: 3 });
  assert.deepEqual(summarize([1, 40000, 41000, 42000, 43000, 900000]).low, 40000);
});
