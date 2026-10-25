import test from 'node:test';
import assert from 'node:assert';
import { parseNotice, moneyOf } from './bankruptParse.js';

test('파산 매각공고 글자 정리', () => {
  assert.equal(moneyOf('금 123,450,000원'), 123450000);
  assert.equal(moneyOf('1억 2,000만원'), 120000000);
  assert.equal(moneyOf('금 일억이천만원'), 120000000);
  const t = `부동산 매각 공고
서울회생법원 2025하단11359 파산자 김○○의 파산관재인 변호사 홍길동
1. 매각대상 부동산
경기도 양평군 양평읍 매월리 104 대 330㎡
2. 매각예정가격 : 금 45,000,000원 (감정가 금 90,000,000원)
3. 입찰서 제출기한 : 2026. 11. 5.(목) 오후 5시까지
4. 입찰보증금 : 입찰가격의 10%
5. 개찰일시: 2026. 11. 6. 10:00
문의: 파산관재인 사무실 02-123-4567`;
  const r = parseNotice(t);
  assert.ok(r.addrs[0].startsWith('경기도 양평군 양평읍 매월리 104'), r.addrs[0]);
  assert.deepEqual(r.areas, [330]);
  assert.equal(r.minPrice, 45000000); assert.equal(r.appraisal, 90000000);
  assert.equal(r.due.date, '2026-11-05'); assert.equal(r.due.time, '17:00');
  assert.equal(r.deposit, '10%'); assert.equal(r.open, '2026-11-06');
  assert.equal(r.phone, '02-123-4567'); assert.equal(r.trustee, '홍길동');
});
