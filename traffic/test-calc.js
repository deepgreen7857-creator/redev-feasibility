// 단위테스트: node traffic/test-calc.js
const assert = require('assert');
const C = require('../shared/criteria/traffic.json'), T = require('../shared/templates/traffic_ko.json');
const X = require('./traffic-calc.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };

t('교통영향평가: 5만㎡ 이상이면 대상', () => assert.strictEqual(X.tia(C, { type: 'redev', siteArea: 50000 }).result, '대상'));
t('교통영향평가: 49,999㎡이면 대상 아님', () => assert.strictEqual(X.tia(C, { type: 'redev', siteArea: 49999 }).result, '대상 아님'));
t('교통영향평가: 면적 없으면 ○○', () => assert.strictEqual(X.tia(C, { type: 'redev' }).result, '○○'));
t('교통영향평가: 조례 미확인이라 확인필요 표시', () => assert.strictEqual(X.tia(C, { type: 'redev', siteArea: 60000 }).unconfirmed, true));
t('진입도로: 299세대는 6m', () => assert.strictEqual(X.accessRoad(C, { units: 299, roads: [{ name: 'a', w: 6 }] }).required, 6));
t('진입도로: 300세대는 8m', () => assert.strictEqual(X.accessRoad(C, { units: 300, roads: [{ name: 'a', w: 6 }] }).required, 8));
t('진입도로: 1,000세대 15m, 12m 도로 하나면 미충족', () => assert.strictEqual(X.accessRoad(C, { units: 1000, roads: [{ name: 'a', w: 12 }] }).result, '미충족'));
t('진입도로: 1,000세대 12m+8m 합 20m면 합계 기준 충족', () => assert.ok(/합계/.test(X.accessRoad(C, { units: 1000, roads: [{ name: 'a', w: 12 }, { name: 'b', w: 8 }] }).result)));
t('진입도로: 2,000세대 20m 도로면 충족', () => assert.strictEqual(X.accessRoad(C, { units: 2000, roads: [{ name: 'a', w: 20 }] }).result, '충족'));
t('주차: 85이하 8,500㎡ + 85초과 700㎡ → 100+10=110', () => assert.strictEqual(X.parking(C, { area85below: 8500, area85above: 700 }).byArea, 110));
t('주차: 끝수 1대 (85.1㎡ → 2대)', () => assert.strictEqual(X.parking(C, { area85below: 85.1 }).byArea, 2));
t('주차: 세대당 최저 100세대 중 60이하 40세대 → 28+60=88', () => assert.strictEqual(X.parking(C, { units: 100, units60below: 40 }).minByUnits, 88));
t('주차: 둘 중 큰 값', () => assert.strictEqual(X.parking(C, { units: 100, units60below: 0, area85below: 5950 }).legal, 100));
t('발생량: 원단위 비어 있으면 값 없음', () => assert.strictEqual(X.trips(C, { units: 500 }).value, null));
t('종합: 미충족이면 확폭 문장과 배치 조건', () => {
  const r = X.run(C, T, { type: 'redev', siteArea: 52000, units: 1000, roads: [{ name: '○○로', w: 12, level: '국지도로' }], station: '숭의역', stationDist: 400 });
  assert.ok(r.list.some(s => /확폭/.test(s)));
  assert.strictEqual(r.constraints.확폭_검토_도로[0].필요_m, 15);
  assert.strictEqual(r.constraints.역_방향_보행축, '숭의역');
  assert.ok(r.list.some(s => /교통영향평가서/.test(s)));
});
console.log(`\n${n}개 모두 통과`);
