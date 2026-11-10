// 구역 원본 이어짐 시험(2026-11-10, shared/project.js 구역 원본) — push 전에: node tools/ui-test/zone-ui.js
// 확인하는 것
//  1. /urban에서 구역계를 바꾸면 → 원본 구역이 됨
//  2. 검토 도구(/traffic)를 열면 → 지금 공통 구역 도형이 원본으로 바뀌고 '맞췄습니다' 띠
//  3. 사업성 화면을 열면 → 지도 구역이 원본으로 바뀌고 띠
//  4. 이미 같은 구역인 화면은 아무것도 안 바꿈(띠 없음)
//  5. 열려 있던 옛 사업성 창이 다른 저장을 해도 옛 구역을 원본으로 되올리지 않음
//  6. /urban은 원본과 같은 안(B안)이 있으면 그 안을 고르기만 하고 A안은 그대로
//  7. 검토 도구 띠 [되돌리기] → 예전 도형으로, 원본도 그것으로
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = __dirname + '/node_modules', PORT = 8772;
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const LIB = [[/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/[Tt]urf/, '@turf/turf/turf.min.js']];
const ok = [], bad = [];
const check = (what, got, want) => { if (got === want) { ok.push(what); console.log('  ✔', what); } else { bad.push(`${what} — 기대 '${want}', 실제 '${got}'`); console.log('  ✘', what, '기대', want, '실제', got); } };
const sq = (x0, y0, d) => { const c = [126.66 + x0 * 1e-5, 37.46 + y0 * 1e-5], e = d * 1e-5; return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[c[0], c[1]], [c[0] + e, c[1]], [c[0] + e, c[1] + e], [c[0], c[1] + e], [c[0], c[1]]]] } }; };
const A = sq(0, 0, 100), B = sq(20, 0, 120), C = sq(0, 30, 90), E = sq(300, 300, 80);
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => { const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (u.startsWith(U('/'))) return r.continue();
    for (const [re, to] of LIB) if (re.test(u) && fs.existsSync(NM + '/' + to)) return r.fulfill({ contentType: to.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(NM + '/' + to) });
    return r.fulfill({ status: 204, body: '' }); });
  const errs = [], watch = pg => pg.on('pageerror', e => errs.push(pg.url().replace(U(''), '') + ' ' + e.message));
  const H = async (pg, gj) => pg.evaluate(g => JbsProject.zoneHash(g), gj);
  const master = async pg => pg.evaluate(() => { const z = JbsProject.zone(); return z ? z.h + '|' + z.from : '(없음)'; });
  const note = async pg => pg.evaluate(() => !!document.getElementById('jbsZoneNote'));
  const pg = await ctx.newPage(); watch(pg);
  await pg.goto(U('/robots.txt'));
  await pg.evaluate(({ A }) => {
    localStorage.clear();
    localStorage.setItem('jbs.project.v1', JSON.stringify({ name: '시험 구역 주택재개발정비사업' }));
    localStorage.setItem('jbsc.project.v1', JSON.stringify({ meta: { name: '시험 구역 주택재개발정비사업', type: 'redevelopment' }, area: { geojson: A, drawnArea: 10000 }, plan: {}, lands: [], buildings: [] }));
    localStorage.setItem('jbs-urban-zones-v1', JSON.stringify({ title: '시험 구역 주택재개발정비사업', count: 2, zones: { A: { geojson: A, inArea: {}, from: 'map' } } }));
    localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: { id: 't1', name: '시험 구역 주택재개발정비사업', geojson: A, v: { type: 'redev' }, plan: { type: 'redev' }, constraints: {} } } }));
    localStorage.setItem('jbs.sites.current', 't1');
  }, { A });
  let hA, hB, hC, hE;
  console.log('1. /urban에서 구역계 바꾸기');
  await pg.goto(U('/urban/')); await pg.waitForTimeout(2500);
  hA = await H(pg, A); hB = await H(pg, B); hC = await H(pg, C); hE = await H(pg, E);
  check('꼭짓점 순서가 달라도 같은 구역', await pg.evaluate(g => { const r = g.geometry.coordinates[0].slice(0, -1).reverse(); r.push(r[0]); return JbsProject.zoneHash({ type: 'Polygon', coordinates: [r] }); }, A), hA);

  check('처음엔 원본 없음(바꾼 화면이 없음)', await master(pg), '(없음)');
  await pg.evaluate(B => setZoneGeom('A', B, 0, '시험'), B); await pg.waitForTimeout(500);
  check('원본 = B (정비계획)', await master(pg), hB + '|urban');

  console.log('2. 검토 도구 열기');
  await pg.goto(U('/traffic/')); await pg.waitForTimeout(900);
  check('공통 구역 도형 = B', await pg.evaluate(() => JbsProject.zoneHash(JbsSite.get('t1').geojson)), hB);
  check('맞췄습니다 띠', await note(pg), true);
  await pg.goto(U('/env/')); await pg.waitForTimeout(700);
  check('같은 구역이면 띠 없음', await note(pg), false);

  console.log('3. 사업성 화면 열기');
  await pg.goto(U('/')); await pg.waitForTimeout(3500); for (let i = 0; i < 20 && !(await note(pg)); i++) await pg.waitForTimeout(500);
  check('사업성 구역 = B', await pg.evaluate(() => JbsProject.zoneHash(S.area.geojson)), hB);
  check('사업성 띠', await note(pg), true);
  check('원본 그대로 B', (await master(pg)).split('|')[0], hB);

  console.log('4·5. 옛 창이 옛 구역을 되올리지 않음');
  const old = await ctx.newPage(); watch(old);
  await old.goto(U('/')); await old.waitForTimeout(2500);   // 이 창은 B를 봄
  const up = await ctx.newPage(); watch(up);
  await up.goto(U('/urban/')); await up.waitForTimeout(2500);
  await up.evaluate(C => setZoneGeom('A', C, 0, '시험'), C); await up.waitForTimeout(400);
  check('원본 = C', (await master(up)).split('|')[0], hC);
  await old.evaluate(() => { S.meta.memo = '가격 고침'; saveState(); }); await old.waitForTimeout(300);
  check('옛 창 저장 뒤에도 원본 C', (await master(old)).split('|')[0], hC);
  await old.close();

  console.log('6. /urban 원본과 같은 안이 있으면 고르기만');
  await up.evaluate(E => { Z.count = 2; Z.zones.B = { geojson: E, inArea: {}, from: 'map' }; saveZ(); }, E);
  await up.evaluate(E => { const s = JbsSite.get('t1'); s.geojson = E; JbsSite.save(s); }, E);   // 검토 도구 쪽에서 E로 바꾼 셈
  check('원본 = E (검토 도구)', await master(up), hE + '|site');
  await up.goto(U('/urban/')); await up.waitForTimeout(2500);
  check('B안이 골라짐', await up.evaluate(() => S.region), 'B');
  check('A안은 C 그대로', await up.evaluate(() => JbsProject.zoneHash(Z.zones.A.geojson)), hC);
  check('띠 없음(바꾼 것 없음)', await note(up), false);
  await up.close();

  console.log('7. 검토 도구 [되돌리기]');
  const u2 = await ctx.newPage(); watch(u2);
  await u2.goto(U('/urban/')); await u2.waitForTimeout(2500);
  await u2.evaluate(A => setZoneGeom(S.region, A, 0, '시험'), A); await u2.waitForTimeout(400);
  await u2.goto(U('/decision/')); await u2.waitForTimeout(900);
  check('결정조서 쪽 구역 = A', await u2.evaluate(() => JbsProject.zoneHash(JbsSite.get(localStorage.getItem('jbs.sites.current')).geojson)), hA);
  await Promise.all([u2.waitForNavigation(), u2.click('#jbsZoneUndo')]); await u2.waitForTimeout(800);
  check('되돌린 뒤 구역 = E', await u2.evaluate(() => JbsProject.zoneHash(JbsSite.get(localStorage.getItem('jbs.sites.current')).geojson)), hE);
  check('원본도 E(되돌리기)', await master(u2), hE + '|undo');

  console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`); bad.forEach(b => console.log('  - ' + b));
  const rel = errs.filter(e => /JbsProject|adopt|zone|구역/i.test(e)); console.log('관련 화면 오류', rel.length, rel.slice(0, 5)); if (errs.length - rel.length) console.log('(참고) 외부 라이브러리를 막아서 생긴 다른 오류', errs.length - rel.length);
  await br.close(); srv.close(); process.exit(bad.length || rel.length ? 1 : 0);
})().catch(e => { console.error('시험 실패', e.message); srv.close(); process.exit(1); });
