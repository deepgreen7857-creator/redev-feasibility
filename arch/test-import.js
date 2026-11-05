// node arch/test-import.js — 배치도 올려서 검토(shared/plan-import.js): DXF 글자 읽기·동 알아보기·검사 부품 연결
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const G = require('../shared/arch-geom.js'), K = require('../shared/arch-check.js'), IM = require('../shared/plan-import.js'), C = require('../shared/criteria/arch.json');
// zonekit.js의 dxfPolys(브라우저 파일)를 그대로 불러와 씀
const ctx = { window: {}, console, TextDecoder }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(__dirname + '/../js/zonekit.js', 'utf8') + '\n;this.ZK = ZoneKit;', ctx);
const ZK = ctx.ZK;
let n = 0; const t = (name, fn) => { fn(); n++; console.log('통과', name); };
const A = C.가정, site = { pts: [[0, 0], [240, 0], [240, 200], [0, 200]], tags: ['road', 'boundary', 'north', 'boundary'], setbacks: [3, 5, 5, 5] };
const opt = { assume: A, spacing: 0.8, sun: C.items.find(i => i.id === 'sunlight_north').이격, winRatio: 2, crit: C.items, lot: 40000 };
// 시험 도면: 판상 동 3개(101동 25층, 102동 20층, 103동 층수 글자 없음) + 구역 경계 + 도로 폴리선
const box = (x, y, L, D) => [[x, y], [x + L, y], [x + L, y + D], [x, y + D]];
const lw = (layer, q) => `0\nLWPOLYLINE\n8\n${layer}\n90\n${q.length}\n70\n1\n` + q.map(p => `10\n${p[0]}\n20\n${p[1]}`).join('\n') + '\n';
const tx = (layer, x, y, s) => `0\nTEXT\n8\n${layer}\n10\n${x}\n20\n${y}\n1\n${s}\n`;
const dxf = '0\nSECTION\n2\nENTITIES\n' + lw('구역경계', site.pts) + lw('A-동', box(30, 20, 60, 13)) + lw('A-동', box(30, 80, 60, 13)) + lw('A-동', box(130, 20, 60, 13)) + lw('도로', box(0, -10, 240, 8))
  + tx('A-TEXT', 50, 26, '101동') + tx('A-TEXT', 60, 24, '25F') + tx('A-TEXT', 50, 86, '102동 20층') + tx('A-TEXT', 150, 26, '103동') + '0\nENDSEC\n0\nEOF\n';
const polys = ZK.dxfPolys(dxf), texts = IM.dxfTexts(dxf);
t('DXF 닫힌 폴리선·글자 읽기', () => { assert.strictEqual(polys.length, 5); assert.strictEqual(texts.length, 4); assert.ok(texts.some(x => x.s === '102동 20층')); });
const rows = IM.recognize(polys, texts, site, opt);
t('동 알아보기: 대지 안 동 3개(구역 경계·도로 제외), 동 번호·층수 글자, 판상', () => {
  assert.strictEqual(rows.length, 3, JSON.stringify(rows.map(r => r.layer)));
  const r101 = rows.find(r => r.id === 101), r102 = rows.find(r => r.id === 102), r103 = rows.find(r => r.id === 103);
  assert.ok(r101 && r101.floors === 25 && r101.conf === '높음' && r101.form === 'slab' && Math.abs(r101.angle) < 0.1);
  assert.ok(r102 && r102.floors === 20); assert.ok(r103 && r103.floorsFrom === '가정' && r103.conf === '보통');
});
t('확인한 동으로 검사: 101동(25층)–102동(20층) 앞뒤 47m < 높이 × 0.8 → 동 사이 거리 위반', () => {
  const blds = IM.toBuildings(rows, opt), q = K.quick(site, blds, opt), r = q.rules.find(x => x.id === 'spacing');
  assert.ok(r && r.동.includes(101), JSON.stringify(q.rules));
  assert.ok(K.dims(site, blds, opt).some(d => d.kind === 'spacing' && d.판정 === '위반'));
});
t('블록(INSERT)으로 넣은 동: 블록 정의 × 삽입점·회전 → 동 2개 + 블록 안 층수 글자', () => {
  const blk = '0\nSECTION\n2\nBLOCKS\n0\nBLOCK\n8\n0\n2\nAPT_A\n10\n0\n20\n0\n' + lw('0', box(0, 0, 50, 12)) + tx('0', 10, 6, '15F') + '0\nENDBLK\n0\nENDSEC\n';
  const ent = '0\nSECTION\n2\nENTITIES\n' + lw('구역경계', site.pts) + '0\nINSERT\n8\nA-동\n2\nAPT_A\n10\n40\n20\n30\n0\nINSERT\n8\nA-동\n2\nAPT_A\n10\n120\n20\n100\n50\n90\n0\nENDSEC\n0\nEOF\n';
  const d = blk + ent, ins = IM.dxfInserts(d);
  assert.strictEqual(ins.polys.length, 2); assert.strictEqual(ins.texts.length, 2);
  const rows2 = IM.recognize(ZK.dxfPolys(d).concat(ins.polys), IM.dxfTexts(d).concat(ins.texts), site, opt);
  assert.strictEqual(rows2.length, 2, JSON.stringify(rows2.map(r => r.layer + r.area)));
  assert.ok(rows2.every(r => r.floors === 15), JSON.stringify(rows2.map(r => r.floors)));
  assert.ok(rows2.some(r => Math.abs(Math.abs(r.angle) - 90) < 1), '90° 돌린 동');
});
console.log(`\n${n}개 모두 통과`);
