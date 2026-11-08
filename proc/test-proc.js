// node proc/test-proc.js — 정비구역 지정 절차 서류(shared/proc.js) 시험
const assert = require('assert');
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
require('../shared/feas.js'); const FE = globalThis.JbsFeas, D = require('../shared/decision.js'), P = require('../shared/proc.js');
// 기간 계산
const S = P.schedule({ open: '2027-01-15', hol: ['2027-03-01'] });
const show = d => P.iso(d);
console.log('통보', show(S.notice), '공람', show(S.open), '~', show(S.close), '설명회', show(S.brief), '의회 기한', show(S.councilEnd), '협의 기한', show(S.consultEnd), '검토', show(S.reviewEnd), '신청', show(S.apply), '위원회', show(S.committee), '고시', show(S.gosi), '총', S.total, '일');
assert.strictEqual(show(S.close), '2027-02-13');          // 1.15 시작 30일간(초일 산입)
assert.strictEqual(show(S.councilEnd), '2027-03-16');     // 통지일부터 60일(초일 불산입)
assert.strictEqual(show(S.consultEnd), '2027-02-15');     // 2.14(일) → 다음 날(민법 제161조)
assert.strictEqual(show(S.reviewEnd), '2027-03-02');      // 2.27(토) → 3.1 공휴일 → 3.2
assert.strictEqual(show(S.apply), '2027-03-16');          // 세 기한 중 가장 늦은 날
assert.ok(S.notice < S.open && S.warn.length === 0, S.warn.join(' / '));
assert.strictEqual(P.iso(P.schedule({ open: '2027-01-15', councilDate: '2027-01-20' }).councilEnd), '2027-03-22');   // 3.21(일) → 3.22
// 잘못된 입력 경고
const W = P.schedule({ open: '2027-01-15', notice: '2027-01-20', days: 20, brief: '2027-03-01', apply: '2027-02-20' }).warn;
assert.ok(W.length >= 3, W.join(' / '));
// 문서
const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320), ll = ([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)];
const ring = [[0, 0], [200, 0], [200, 170], [0, 170], [0, 0]].map(ll), park = [[0, 0], [40, 0], [40, 50], [0, 50]].map(ll);
const site = { id: 't', name: '용현동 시험구역', plan: { type: 'redev' }, geojson: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } }, quick: { prior: 24000000, members: 600 },
  arch: { exclude: [park], exKinds: ['공원'], params: { roadSb: 3 }, chosen: { units: 1000, byType: { 59: 500, 84: 500 }, supply: { 59: 79.34, 84: 110.52 }, far: 249.5, gfa: 70000, lot: 30000, maxFloors: 30, buildings: [] } } };
const R = P.docs(site, { open: '2027-01-15', loc: '인천광역시 미추홀구 용현동 100번지 일원', place: '미추홀구청 도시정비과', briefPlace: '용현동 행정복지센터' }, D, FE);
assert.strictEqual(R.list.length, 8);
assert.strictEqual(R.proposer, '미추홀구청장'); assert.strictEqual(R.council, '미추홀구의회');
const H = id => R.list.find(x => x.id === id).html;
assert.ok(/제15조제1항/.test(H('notice')) && /2027\. 1\. 15\.\(금\) ~ 2027\. 2\. 13\.\(토\) \(30일간\)/.test(H('notice')));
assert.ok(/미추홀구 공고/.test(H('gongram')) && /시행령 제13조제1항/.test(H('gongram')));
assert.ok(/60일 이내\(2027\. 3\. 16\.\(화\)까지\)/.test(H('council')) && /제8조제5항/.test(H('council')));
assert.ok(/교육지원청/.test(H('consult')) && /제30조제1항/.test(H('consult')));
assert.ok(/시행령 제13조제3항/.test(H('opinion')));
assert.ok(/인천광역시장/.test(H('apply')) && /구의회 의견/.test(H('apply')));
assert.ok(/공동 심의/.test(H('committee')) && /1,000세대/.test(H('committee')));
assert.ok(/공원/.test(H('notice')));
console.log('절차 서류 시험 통과');
