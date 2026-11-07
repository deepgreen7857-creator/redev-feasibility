// node decision/test-decision.js — 정비계획 결정 도서(shared/decision.js) 시험
const assert = require('assert');
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
require('../shared/feas.js'); const FE = globalThis.JbsFeas, D = require('../shared/decision.js');
const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320);
const ll = ([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)];
const ring = [[0, 0], [200, 0], [200, 170], [0, 170], [0, 0]].map(ll);
const park = [[0, 0], [40, 0], [40, 50], [0, 50]].map(ll), road = [[0, 160], [200, 160], [200, 170], [0, 170]].map(ll);
const site = { id: 't', name: '용현동 시험구역', plan: { type: 'redev' }, geojson: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] } },
  profile: { zoning: '제3종일반주거지역' }, v: { roads: [{ name: '100-1 도로', w: '6', pw: '12', role: '진입도로', dec: '소로2류' }] },
  quick: { prior: 24000000, members: 600, ratio: 95 },
  arch: { exclude: [park, road], exKinds: ['공원·녹지', '도로(확폭·지정)'], params: { roadSb: 3, axisN: 1, axisB: 0, axisW: 20, lowCap: 12 },
    chosen: { units: 1000, byType: { 49: 150, 59: 400, 84: 450 }, supply: { 49: 68.36, 59: 79.34, 84: 110.52 }, far: 249.5, bcr: 18.2, gfa: 70000, lot: 28000, maxFloors: 30, maxHeight: 89.5, buildings: [] } },
  constraints: { env: { 소음_검토_도로: ['간선 1'], 북측_일조_높이제한: true }, landscape: { 통경축_개방률_퍼센트: 22, 경계부_층수_점감_대상동: [3] } } };
const R = D.build(site, { feas: FE, assume: FE.get(), location: '인천광역시 미추홀구 용현동 100번지 일원' });
const T = id => R.parts.flatMap(p => p.tables).find(t => t.id === id);
const txt = t => JSON.stringify(t.rows);
assert.strictEqual(R.parts.length, 3); assert.strictEqual(R.parts[1].title, '지구단위계획에 관한 결정');
assert.ok(/용현동 시험구역 주택재개발정비사업/.test(txt(T('name'))));
assert.ok(/3[34],\d{3}\.\d/.test(txt(T("zone"))), txt(T("zone")));
const lu = T('landuse'); console.log('토지이용', lu.rows.map(r => r.join(' | ')).join('\n  '));
assert.ok(/공원/.test(txt(lu)) && /도로/.test(txt(lu)) && /획지1/.test(txt(lu)) && /위치 미정/.test(txt(lu)));
const s1 = T('share1'), s2 = T('share2'); console.log('분담금', s1.rows.map(r => r.slice(0, 3).join(' ')).join(' / ')); console.log('  ', s2.rows.map(r => r.join(' | ')).join('\n   '));
assert.ok(s2 && s2.rows.length === 3 && T('share3').rows.length === 5);
assert.ok(/12\.0/.test(txt(T('facRoad'))) && /소로2류/.test(txt(T('facRoad'))));
assert.ok(/공원/.test(txt(T('facOther'))));
assert.ok(T('rental') && /5%/.test(txt(T('rental'))));
assert.ok(/85㎡ 이하/.test(T('size').note));
assert.ok(/간선 1/.test(txt(T('env'))) && /재해영향/.test(txt(T('env'))));
assert.ok(/교육지원청/.test(txt(T('edu'))));
assert.ok(/12층 이하/.test(txt(T('dheight'))) && /3m 후퇴/.test(txt(T('dline'))) && /통경축/.test(txt(T('detc'))));
assert.ok(/지구단위계획구역/.test(txt(T('dz'))));
const cons = T('consult'); assert.ok(cons.rows.length >= 12 && /교육환경평가 갈음/.test(txt(cons)) && /재해영향평가 갈음/.test(txt(cons)));
// 재건축이면 임대주택 부서가 빠지고 세입자 대책이 임차인으로
const R2 = D.build(Object.assign({}, site, { plan: { type: 'recon' }, name: '유원아파트' }), { feas: FE, assume: FE.get() });
const T2 = id => R2.parts.flatMap(p => p.tables).find(t => t.id === id);
assert.ok(/주택재건축/.test(JSON.stringify(T2('name').rows)) && !/주택 부서/.test(JSON.stringify(T2('consult').rows)) && /임차인/.test(JSON.stringify(T2('tenant').rows)));
// 확정안 없으면 산출 불가 표시
const R3 = D.build(Object.assign({}, site, { arch: {} }), { feas: FE });
assert.ok(/산출 불가/.test(JSON.stringify(R3.parts[0].tables.find(t => t.id === 'share1').rows)));
console.log('\n정비계획 결정 도서 시험 통과');
