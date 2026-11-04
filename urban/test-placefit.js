// 기반시설 배치 방식(PlaceFit) 시험 — 사이트와 같은 turf 6.5 필요
//   npm i @turf/turf@6.5.0 pngjs (저장소 밖 폴더에) 후  NODE_PATH=<그 폴더>/node_modules node urban/test-placefit.js
// 모양: 북쪽이 뾰족한 구역 + 북동쪽 종교부지 + 다른 시설. 필요 면적 4,500㎡에 네 방식 모두
//   면적 ±1%, 구역 밖 0, 종교부지와 겹침 0 이어야 함
global.turf = require('@turf/turf');
const PF = require('./placefit.js');
const O = [126.665, 37.452], mx = 1 / (111320 * Math.cos(37.452 * Math.PI / 180)), my = 1 / 110540;
const P = pts => turf.polygon([[...pts, pts[0]].map(([x, y]) => [O[0] + x * mx, O[1] + y * my])]);
const zone = P([[0, 0], [300, 60], [260, 140], [230, 330], [60, 120]]);
const church = P([[190, 190], [235, 200], [240, 250], [200, 240]]);
const occ = [P([[100, 40], [160, 50], [150, 110], [90, 100]])];
const T = 4500;
let fail = 0;
function chk(name, r, { tol = 0.01 } = {}) {
  const g = r.geom;
  const outA = g ? turf.area(turf.difference(g, turf.buffer(zone, 0.5, { units: 'meters' })) || turf.point([0, 0])) || 0 : 0;
  const ovA = g ? turf.area(turf.intersect(g, church) || turf.point([0, 0])) || 0 : 0;
  const ok = g && Math.abs(r.area - T) <= T * tol && outA < 1 && ovA < 1;
  if (!ok) fail++;
  console.log(`${ok ? '통과' : '실패'} ${name.padEnd(6)} ${Math.round(r.area)}㎡ 구역밖 ${Math.round(outA)} 겹침 ${Math.round(ovA)} | ${r.msg}`);
}
chk('감싸기', PF.run({ mode: 'wrap', dir: 'N' }, { zone, anchorGeom: church, occupied: occ, target: T }));
chk('곧게', PF.run({ mode: 'clean', dir: 'N' }, { zone, anchorGeom: church, occupied: occ, target: T }));
const L = pts => turf.lineString(pts.map(([x, y]) => [O[0] + x * mx, O[1] + y * my]));
chk('스케치', PF.run({ mode: 'sketch', sketch: L([[170, 255], [215, 250], [260, 262], [245, 320], [215, 325], [180, 280]]) }, { zone, anchorGeom: church, occupied: occ, target: T }));
// 꼭짓점 찍어 그린 반듯한 사각형: 키워도 모서리가 둥글어지지 않아야 함(꼭짓점 수가 그대로 적게)
{ const r = PF.run({ mode: 'sketch', sketch: P([[90, 130], [150, 130], [150, 170], [90, 170]]).geometry }, { zone, anchorGeom: church, occupied: occ, target: T });
  chk('사각형', r);
  const n = r.geom ? turf.coordAll(r.geom).length : 0;
  if (n > 12) { fail++; console.log(`실패 사각형 꼭짓점 ${n}개 — 모양이 둥글어짐`); } else console.log(`통과 사각형 꼭짓점 ${n}개(반듯함 유지)`); }
// 손으로 꼬이게 그은 8자 모양도 면적을 맞춰야 함
chk('꼬인선', PF.run({ mode: 'sketch', sketch: L([[90, 130], [150, 170], [150, 130], [90, 170], [92, 132], [100, 131]]) }, { zone, anchorGeom: church, occupied: occ, target: T }));
// 손그림: 용지를 래스터로 만들고 빨간 펜으로 끝이 덜 닫힌 타원을 그린 뒤 읽기
const { meta } = PF.makeSheet({ zone, features: [{ geom: church, name: '종교' }], widthPx: 700 });
const W = meta.width, H = meta.height, data = new Uint8ClampedArray(W * H * 4).fill(255);
const toPx = ([x, y]) => { const lo = O[0] + x * mx, la = O[1] + y * my; return [(lo - meta.bbox[0]) / (meta.bbox[2] - meta.bbox[0]) * W, (meta.bbox[3] - la) / (meta.bbox[3] - meta.bbox[1]) * H]; };
const [cx, cy] = toPx([120, 170]), [ex] = toPx([150, 170]), rx = ex - cx, ry = rx * 0.75;
for (let t = 0; t < Math.PI * 2 * 0.95; t += 0.002) {
  const x = Math.round(cx + rx * Math.cos(t)), y = Math.round(cy + ry * Math.sin(t));
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const i = ((y + dy) * W + (x + dx)) * 4; data[i] = 220; data[i + 1] = 30; data[i + 2] = 30; }
}
const rd = PF.readSheet({ width: W, height: H, data }, meta);
const drawnA = rd.shapes[0] ? turf.area(rd.shapes[0]) : 0, expect = Math.PI * 30 * 22.5;
const readOk = Math.abs(drawnA - expect) < expect * 0.15;
if (!readOk) fail++;
console.log(`${readOk ? '통과' : '실패'} 손그림 읽기 ${Math.round(drawnA)}㎡(그린 타원 약 ${Math.round(expect)}㎡) | ${rd.msg}`);
chk('손그림', PF.run({ mode: 'sketch', sketch: rd.shapes[0] }, { zone, anchorGeom: church, occupied: occ, target: T }));
// 구역을 가로지르는 선 하나(사용자 사례: 뾰족한 끝을 잘라 공원으로) — 선 바깥쪽(작은 쪽)이 시설, 북쪽 끝에 '남는 획지'가 없어야 함
{ const tip = 2500, cutLine = L([[40, 200], [150, 215], [270, 205]]);
  const r = PF.run({ mode: 'sketch', sketch: cutLine.geometry }, { zone, occupied: [], target: tip });
  const ok = r.geom && Math.abs(r.area - tip) < tip * 0.01 && turf.booleanPointInPolygon(turf.point([O[0] + 230 * mx, O[1] + 320 * my]), r.geom);
  if (!ok) fail++; console.log(`${ok ? '통과' : '실패'} 나누는선 ${Math.round(r.area)}㎡(필요 ${tip}) 북쪽 끝 포함 ${!!ok} | ${r.msg}`);
  // 같은 선을 용지에 초록 펜으로 그어 올리기
  const D2 = new Uint8ClampedArray(W * H * 4).fill(255);
  const [ax, ay] = toPx([40, 200]), [bx, by] = toPx([150, 215]), [qx, qy] = toPx([270, 205]);
  for (const [[sx, sy], [tx, ty]] of [[[ax, ay], [bx, by]], [[bx, by], [qx, qy]]]) for (let t = 0; t <= 1; t += 0.002) {
    const x = Math.round(sx + (tx - sx) * t), y = Math.round(sy + (ty - sy) * t);
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const i = ((y + dy) * W + (x + dx)) * 4; D2[i] = 30; D2[i + 1] = 180; D2[i + 2] = 60; }
  }
  const rl = PF.readSheet({ width: W, height: H, data: D2 }, meta);
  const lineOk = rl.lines && rl.lines.length === 1 && !rl.shapes.length;
  if (!lineOk) fail++; console.log(`${lineOk ? '통과' : '실패'} 선 읽기 | ${rl.msg}`);
  if (lineOk) { const r2 = PF.run({ mode: 'upload', sketch: rl.lines[0].geometry }, { zone, occupied: [], target: tip });
    const ok2 = r2.geom && Math.abs(r2.area - tip) < tip * 0.01; if (!ok2) fail++; console.log(`${ok2 ? '통과' : '실패'} 올린 선   ${Math.round(r2.area)}㎡ | ${r2.msg}`); } }
// 면적 부족은 실패로 알려야 함
const big = PF.run({ mode: 'wrap', dir: 'N' }, { zone, anchorGeom: church, occupied: occ, target: 60000 });
if (big.ok) fail++;
console.log(`${big.ok ? '실패' : '통과'} 부족 알림 | ${big.msg}`);
process.exit(fail ? 1 : 0);
