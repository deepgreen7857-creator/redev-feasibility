import test from 'node:test';
import assert from 'node:assert/strict';
import { roundPlan, futureRounds, soldRateTable } from './roundPlan.js';
import { premiumTable } from './bidForecast.js';

test('회차별 진입: 몇 회 더 유찰되면 상한 아래로, 그때까지 남아 있을 확률', () => {
  assert.equal(futureRounds({ source: 'court', minBid: 1e8 }, 0.3, 3)[2].price, 49000000);
  const done = [];
  for (let i = 0; i < 20; i++) done.push({ usage: '다세대', appraisal: 1e8, minBid: 7e7, result: { soldPrice: 7.5e7, status: '낙찰' } });
  for (let i = 0; i < 20; i++) done.push({ usage: '다세대', appraisal: 1e8, minBid: 7e7, result: { status: '유찰' } });
  const it = { source: 'court', usage: '다세대', appraisal: 1e8, minBid: 1e8 };
  const plan = roundPlan(it, { cap: 6e7 }, { premium: premiumTable(done), rates: soldRateTable(done), courtRate: 0.3 });
  assert.ok(plan.firstOk && plan.firstOk.k >= 1);
  assert.ok(plan.firstOk.survive < 1);
});

test('공매는 공고의 회차별 실제 날짜, 법원은 5주 간격 추정', () => {
  const g = futureRounds({ source: 'onbid', minBid: 1e8, bidEnd: '2026-11-02', roundList: [{ bidEnd: '2026-11-02 10:00', minBid: 1e8 }, { bidEnd: '2026-11-09 10:00', minBid: 9e7 }] });
  assert.equal(g[1].date, '2026-11-09'); assert.equal(g[1].actual, true);
  const c = futureRounds({ source: 'court', minBid: 1e8, bidEnd: '2026.11.05' }, 0.3, 3);
  assert.equal(c[1].date, '2026-12-10'); assert.equal(c[1].actual, false);
});
