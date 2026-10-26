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
test('인천 신설구: 국토부 새 코드(서해구 28275·검단구 28290·영종구 28155·제물포구 28125)', () => {
  assert.equal(lawdOf('인천광역시', '서해구'), '28275'); assert.equal(lawdOf('인천광역시', '서구', '석남동'), '28275'); assert.equal(lawdOf('인천광역시', '서구', '마전동'), '28290');
  assert.equal(lawdOf('인천광역시', '중구', '운서동'), '28155'); assert.equal(lawdOf('인천광역시', '중구', '신포동'), '28125');
  assert.ok(lawdOf('인천광역시', '서구'));
  assert.equal(lawdOf('인천광역시', '남동구'), '28200');
});

import { analyze } from './analyze.js';
import { DEFAULT_SETTINGS } from '../data/defaults.js';
test('건물면적이 없으면 건축물대장 전유면적으로 전세 시세 계산', () => {
  const rent = Array.from({ length: 6 }, (_, i) => [2e8 + i * 1e6, 50, 3, 1, '1', 'A빌라', 2005, false, '신규', '신월동', 0]);
  const it = { source: 'court', usage: '다세대', sido: '서울특별시', sgg: '양천구', emd: '신월동', appraisal: 3.6e8, minBid: 3.6e8, ledger: { unit: { exclusiveArea: 50 } } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: [], rentDeals: rent });
  assert.ok(a.jeonse && a.jeonse.value > 0);
});

import { marketEstimate, floorOf } from './analyze.js';
test('저층 아파트: 같은 단지 저층 거래가 있으면 저층 거래만으로 시세', () => {
  assert.equal(floorOf({ title: '○○아파트 제101동 제1층 제102호' }), 1);
  assert.equal(floorOf({ title: '○○ 제지층 제비01호' }), 0);
  const d = (price, floor) => [price, 59, floor, 1, '1', '한양', 1990, false, '중개거래', '선부동'];
  const deals = [d(2e8, 10), d(2.1e8, 12), d(2e8, 8), d(2.05e8, 9), d(1.6e8, 1), d(1.7e8, 2), d(1.65e8, 1)];
  const it = { usage: '아파트', title: '선부동 한양아파트 제1층 제101호', emd: '선부동', buildingArea: 59 };
  const m = marketEstimate(it, deals);
  assert.ok(m.value < 1.8e8 && m.value > 1.5e8, String(m.value));
  assert.ok(/닮은 거래/.test(m.basis));
});

test('거래 폭이 커도 면적·층·연식·시점이 닮은 거래 위주로 시세', () => {
  // 같은 동 거래: 새 대형(비쌈)과 오래된 소형(쌈)이 섞여 중앙값은 의미 없음 → 물건(1995년·40㎡·3층)과 닮은 거래로
  const now = new Date(); const ym = (k) => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const deals = [];
  for (let i = 0; i < 8; i++) deals.push([4e8 + i * 1e7, 84, 10 + i, 1, '1', '새아파트', 2018, false, '중개거래', '부평동', null, ym(i)]);
  for (let i = 0; i < 6; i++) deals.push([1.2e8 + i * 2e6, 40, 2 + i, 1, '1', '오래된아파트', 1995, false, '중개거래', '부평동', null, ym(i)]);
  const it = { usage: '아파트', title: '부평동 어느아파트 제3층 제301호', emd: '부평동', buildingArea: 40, buildYear: 1995 };
  const m = marketEstimate(it, deals.filter((d) => d[1] >= 32 && d[1] <= 48).concat(deals.filter((d) => d[1] === 84)));
  // 40㎡ ±20%만 남는 기존 단계 때문에 대형은 빠지고, 남은 소형끼리 비교
  assert.ok(m.value > 1.1e8 && m.value < 1.4e8, String(m.value));
});

test('Claude 검토가 보류면 지금 매력으로 두지 않음', () => {
  const base = { source: 'onbid', category: 'public', usage: '다세대', sido: '경기도', sgg: '고양시 일산서구', emd: '덕이동', appraisal: 2.43e8, minBid: 9.72e7, buildingArea: 51, failCount: 3 };
  const a1 = analyze({ ...base, aiReview: { verdict: '보류', conclusion: '권리 원문 미수집' } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.notEqual(a1.verdict, 'now');
});

test('자료가 덜 모이면 판정하지 않음(자료 수집 중)', () => {
  const it = { source: 'onbid', category: 'public', usage: '다세대', sido: '경기도', sgg: '고양시 일산서구', emd: '덕이동', appraisal: 2.43e8, minBid: 1.7e8, buildingArea: 51 };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.verdict, 'pending');
  assert.ok(a.gaps.required.some((g) => /공매 원문/.test(g)));
  assert.ok(a.gaps.required.some((g) => /실거래/.test(g)));
});

test('집중 지역: 인천 서구(서해구) 가좌동·석남동만', async () => {
  const { inFocus } = await import('../data/defaults.js');
  assert.equal(inFocus({ sido: '인천광역시', sgg: '서구', emd: '가좌동', title: '인천 서구 가좌동 123' }), true);
  assert.equal(inFocus({ sido: '인천광역시', sgg: '서해구', address: '인천광역시 서해구 석남동 45-6 101호' }), true);
  assert.equal(inFocus({ sido: '인천광역시', sgg: '서구', address: '인천광역시 서구 청라동 1' }), false);
  assert.equal(inFocus({ sido: '인천광역시', sgg: '서구', address: '인천광역시 서구 염곡로 12 (가좌동, 한빛빌라)' }), true);
  assert.equal(inFocus({ sido: '서울특별시', sgg: '구로구', address: '서울 구로구 가좌동' }), false);
});
