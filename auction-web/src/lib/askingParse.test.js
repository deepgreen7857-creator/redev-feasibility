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

import { condOf } from './askingParse.js';
test('호가 매물 설명에서 집 상태 읽기', () => {
  assert.equal(condOf('15/20층 남향 올수리 입주가능'), 'top');
  assert.equal(condOf('급매 저층'), 'urgent');
  assert.equal(condOf('기본상태 수리필요'), 'basic');
  assert.equal(condOf('남향 역세권'), null);
  const rows = parseAskingRows('매매 3억 2,000 84m² 올수리 확장 매매 2억 8,000 84m² 기본 상태 저층 매매 2억 7,500 84m² 급매');
  assert.deepEqual(rows.map((r) => r.cond), ['top', 'basic', 'urgent']);
});

test('디스코·직방 형식(전용 우선)', () => {
  const r = parseAskingRows('정원빌딩 매매 107억 3000만원 대지 302m² · 연 805m² · 5F');
  assert.equal(r[0].price, 1073000); assert.equal(r[0].area, 302);
  const z = parseAskingRows('매매 2억 3,000 관리비 5만 투룸 · 공급 52㎡ 전용 38.5㎡ · 3층');
  assert.equal(z[0].price, 23000); assert.equal(z[0].area, 38.5);
});

import { isBasement } from './askingParse.js';
test('지하 매물 구분', () => {
  assert.equal(isBasement('투룸 · 전용 38㎡ · 반지하'), true);
  assert.equal(isBasement('전용 40㎡ B1/4층'), true);
  assert.equal(isBasement('전용 40㎡ -1/4층'), true);
  assert.equal(isBasement('대지 302m² · 연 805m² · 5F / B1'), false);
  assert.equal(isBasement('전용 40㎡ 3/4층'), false);
  assert.equal(parseAskingRows('매매 1억 2,000 전용 40㎡ 반지하 매매 1억 9,000 전용 41㎡ 3/4층').map((r) => !!r.basement).join(), 'true,false');
});
