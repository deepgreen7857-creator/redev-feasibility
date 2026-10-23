import test from 'node:test';
import assert from 'node:assert/strict';
import { premiumTable, predictPrice, isFirstRound, scoreErrors, bidOutcome } from './bidForecast.js';

const sold = (minBid, price, extra = {}) => ({ source: 'onbid', category: 'public', usage: '부동산 > 주거용건물 > 아파트', usageSmall: '아파트', minBid, result: { soldPrice: price }, ...extra });

test('첫 회차: 유찰 0회 또는 최저가 = 감정가, 모르면 null', () => {
  assert.equal(isFirstRound({ failCount: 0 }), true);
  assert.equal(isFirstRound({ failCount: 2, appraisal: 100, minBid: 100 }), false);
  assert.equal(isFirstRound({ appraisal: 100, minBid: 100 }), true);
  assert.equal(isFirstRound({ appraisal: 100, minBid: 70 }), false);
  assert.equal(isFirstRound({}), null);
});

test('예상 낙찰가: 같은 종류 중앙값, 자기 자신은 빼고(사후 채점)', () => {
  const items = [sold(100, 105), sold(100, 110), sold(100, 102), sold(100, 200)];
  const t = premiumTable(items);
  assert.equal(predictPrice({ ...items[0], result: null }, t).price, 110); // [1.02,1.05,1.1,2] 중앙값 1.1
  const self = predictPrice(items[3], t, { self: true }); // 2 를 빼면 [1.02,1.05,1.1] → 1.05
  assert.equal(self.price, 105);
});

test('성적: 오차·승률·필요 가산 폭·등급', () => {
  const s = scoreErrors([0.01, -0.01, 0.03, -0.02, 0.05, 0, 0.02, -0.03, 0.01, 0.04]);
  assert.equal(s.n, 10);
  assert.ok(s.error <= 0.03);
  assert.equal(s.grade, 'A'); // 절대오차 중앙값 2%
});

test('입찰 결과: 유찰이면 단독 낙찰, 상한 넘으면 입찰 안 함', () => {
  assert.equal(bidOutcome({}, 100, 120, 'fail').kind, 'alone');
  assert.equal(bidOutcome({}, 130, 120, 'fail').kind, 'skip');
  assert.equal(bidOutcome(sold(90, 95), 100, 120, 'sold').kind, 'win');
  assert.equal(bidOutcome(sold(90, 105), 100, 120, 'sold').kind, 'lose');
});

import { lawdOf } from '../data/defaults.js';
test('인천 신설구는 개편 전 구 시세 코드로 연결', () => {
  assert.equal(lawdOf('인천광역시', '서해구'), lawdOf('인천광역시', '서구'));
  assert.equal(lawdOf('인천광역시', '영종구'), lawdOf('인천광역시', '중구'));
  assert.ok(lawdOf('인천광역시', '서구'));
  assert.equal(lawdOf('인천광역시', '남동구'), '28200');
});
