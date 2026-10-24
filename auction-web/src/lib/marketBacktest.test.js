import test from 'node:test';
import assert from 'node:assert/strict';
import { backtest } from './marketBacktest.js';

test('시세 성적표: 앞선 달 거래만으로 최근 거래를 맞히고 오차를 잰다', () => {
  const deals = [];
  const ym = ['202601', '202602', '202603', '202604', '202605', '202606'];
  ym.forEach((m, i) => { for (let k = 0; k < 6; k++) deals.push([3e8 * (1 + i * 0.005) + k * 2e6, 84, 5 + k, 1, '1', '한빛', 2000, false, '중개거래', '부평동', null, m]); });
  const r = backtest('apt', deals);
  assert.ok(r.covered > 0);
  assert.ok(r.all.error < 0.05, String(r.all.error));
  assert.ok(r.byGrade.length >= 1);
});
