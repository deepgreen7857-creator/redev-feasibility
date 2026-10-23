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
import { parseAskingRows, pickByArea } from './askingParse.js';
test('호갱노노 매물 글: 면적 같이 읽고 같은 면적만', () => {
  const t = '용현자이크레스트아파트 전문 매매 118전세 8월세 2 전화 문의 이 단지 매물 실매물 확인 매매 6억 1,500 115A / 84m², 112동 고층 2곳에서 등록 실매물 확인 매매 5억 7,000 102D / 74m², 112동 14층 실매물 확인 전세 3억 7,000 102C / 74m², 109동 실매물 확인 매매 4억 9,000 82A / 59m², 101동 6층';
  const rows = parseAskingRows(t);
  assert.deepEqual(rows, [{ price: 61500, area: 84 }, { price: 57000, area: 74 }, { price: 49000, area: 59 }]);
  assert.deepEqual(pickByArea(rows, 84.9).rows, [{ price: 61500, area: 84 }]);
  assert.equal(pickByArea(rows, 120).noSame, 3);
});
test('네이버 형식 115/84m²', () => {
  assert.deepEqual(parseAskingRows('매매 5억 2,000\n아파트 115/84m², 10/25층'), [{ price: 52000, area: 84 }]);
});
