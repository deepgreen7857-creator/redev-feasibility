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
