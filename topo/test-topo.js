// node topo/test-topo.js — 고시용 지형도면(shared/topo.js) 시험. turf 6.5: NODE_PATH=tools/ui-test/node_modules
const assert = require('assert'), fs = require('fs'), path = require('path');
globalThis.turf = require('@turf/turf');
const TP = require('../shared/topo.js');
// 1) 좌표 변환: 중부원점 원점 · 알려진 점(proj4 있으면 대조)
const o = TP.tm(127, 38); assert.ok(Math.abs(o[0] - 200000) < 1e-6 && Math.abs(o[1] - 600000) < 1e-6);
let proj4 = null; try { proj4 = require('proj4'); } catch (e) { /* 없음 */ }
if (proj4) { const def = '+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +units=m +no_defs';
  for (const [lo, la] of [[126.66, 37.46], [126.3, 37.2], [127.9, 38.6], [126.65, 37.45]]) { const a = TP.tm(lo, la), b = proj4('WGS84', def, [lo, la]); assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.005, `${lo},${la} ${a} vs ${b}`); }
  console.log('좌표 변환 proj4와 0.5cm 안 일치'); }
// 2) 시험 구역(200×170m) + 공원·도로 + 주변 지적
const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320), ll = ([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)];
const R = q => q.map(ll).concat([ll(q[0])]);
const site = { id: 't', name: '용현동 시험구역', geojson: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [R([[0, 0], [200, 0], [200, 170], [0, 170]])] } },
  arch: { exclude: [R([[0, 0], [40, 0], [40, 50], [0, 50]]), R([[0, 160], [200, 160], [200, 170], [0, 170]])], exKinds: ['공원·녹지', '도로(확폭·지정)'], params: { roadSb: 3 } } };
const pf = (q, jibun) => ({ type: 'Feature', properties: { jibun, pnu: jibun }, geometry: { type: 'Polygon', coordinates: [R(q)] } });
const parcels = [];
for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) parcels.push(pf([[i * 40, j * 40], [i * 40 + 40, j * 40], [i * 40 + 40, j * 40 + 40 + (j === 3 ? 10 : 0)], [i * 40, j * 40 + 40 + (j === 3 ? 10 : 0)]], `${100 + i * 4 + j}대`));
parcels.push(pf([[0, 170], [200, 170], [200, 182], [0, 182]], '500도'), pf([[200, -10], [212, -10], [212, 182], [200, 182]], '501도'));
const M = TP.model(site, parcels, {});
assert.ok(!M.error); console.log('구역', M.zoneA.toFixed(1), '획지', M.lotA.toFixed(1), '시설', M.placedA.toFixed(1), '가로지름', M.cross.length, '건축한계선', M.bline.length, M.bline.map(l => l.length));
assert.ok(Math.abs(M.zoneA - 34000) < 340, M.zoneA);   // 시험 구역 환산(110540·111320)이 대략값이라 1% 안
assert.ok(Math.abs(M.lotA + M.placedA - M.zoneA) < 2);
assert.ok(M.land.some(x => x.kind === '공원') && M.land.some(x => x.kind === '도로') && M.land.some(x => x.kind === '획지'));
assert.strictEqual(M.cross.length, 0, '시험 구역 경계는 지적선 기준');
// 건축한계선: 획지가 구역 안 도로(북)·구역 밖 도로(동)를 향함 → 두 변 이어진 선 하나, 북쪽 선은 y≈157, 동쪽 선은 x≈197
assert.ok(M.bline.length >= 1);
const pts = M.bline.flat(), base = TP.tm(lon0, lat0);
const rel = p => [p[0] - base[0], p[1] - base[1]];
assert.ok(pts.some(p => Math.abs(rel(p)[1] - 157) < 0.6), '북쪽 3m 후퇴');
assert.ok(pts.some(p => Math.abs(rel(p)[0] - 197) < 0.6), '동쪽 3m 후퇴');
assert.ok(pts.every(p => rel(p)[0] > 30 || rel(p)[1] > 100), '공원 쪽에는 없음');
// 3) 축척·도엽
const S = TP.sheets(M); console.log('축척 1/' + S.scale, '도엽', S.list.length);
assert.strictEqual(S.scale, 500); assert.strictEqual(S.list.length, 1);
const big = TP.model(Object.assign({}, site, { geojson: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [R([[0, 0], [1500, 0], [1500, 120], [120, 120], [120, 900], [0, 900]])] } }, arch: {} }), [], {});   // ㄱ자 큰 구역 → 빈 도엽은 빠짐
const S2 = TP.sheets(big); console.log('큰 구역 1/' + S2.scale, '도엽', S2.list.length, '총괄도 1/' + S2.overview.scale); assert.strictEqual(S2.scale, 1200); assert.ok(S2.list.length >= 2 && S2.overview.scale >= 5000); const full = Math.ceil((1500 * 1.0 + 50) / (TP.MAPW * 1.2)) * Math.ceil((900 + 50) / (TP.MAPH * 1.2)); assert.ok(S2.list.length < full, `빈 도엽 빠짐 ${S2.list.length}/${full}`);
// 4) SVG·DXF·SHP
const out = process.env.TOPO_OUT || path.join(__dirname, '_out'); fs.mkdirSync(out, { recursive: true });
const meta = { title: '용현동 시험구역 주택재개발정비구역 지정 지형도면', org: '인천광역시', place: '인천광역시 미추홀구 용현동 100번지 일원', date: '2026. 11. 8.' };
const sv = TP.svg(M, S.list[0], S, meta, 'sheet'); assert.ok(/<svg/.test(sv) && /획지1/.test(sv) && /건축한계선/.test(sv) && /X=/.test(sv)); fs.writeFileSync(out + '/sheet1.svg', sv);
fs.writeFileSync(out + '/overview.svg', TP.svg(big, S2.list[0], S2, meta, 'overview'));
const dx = TP.dxf(M, meta); assert.ok(/AC1009/.test(dx) && /\\U\+C815/.test(dx)); fs.writeFileSync(out + '/topo.dxf', dx);
const files = TP.shapes(M); assert.ok(files['정비구역.shp'] && files['토지이용계획.dbf'] && files['건축한계선.shp']);
Object.entries(files).forEach(([n, b]) => fs.writeFileSync(out + '/' + n, b));
fs.writeFileSync(out + '/topo.zip', TP.zip(files));
console.log('고시용 지형도면 시험 통과 →', out);
