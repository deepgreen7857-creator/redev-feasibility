// 위치가 바뀌면 설정 초기화 시험(2026-11-13, JBSLAB_작업기준서 오류기록 1번) — push 전에: node tools/ui-test/site-reset-ui.js
// 재발 확인 방법(작업기준서): 구역 A 설정 → 구역 B(다른 위치)로 변경 → 모든 설정값이 기본값인지
//  1. 사업성 화면: A에서 준주거·재건축·용적률 등 고침 → 겹치는 구역으로 고치면 그대로 / 다른 위치로 바꾸면 기본값 + 띠, [되돌리기]로 예전 사업 그대로
//  2. 사업성 화면: 구역을 지운 뒤 다른 곳을 그려도 초기화(예전엔 지우면 비교할 구역이 없어 그대로 남았음)
//  3. /urban: 안을 모두 지운 뒤 다른 곳을 그려도 계획 가정(P) 초기화
//  4. 검토 도구(공통 구역): 원본이 다른 위치로 바뀌면 예전 구역 조건을 끌고 오지 않고 새 구역으로
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = __dirname + '/node_modules', PORT = 8774;
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const LIB = [[/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/[Tt]urf/, '@turf/turf/turf.min.js']];
const ok = [], bad = [];
const check = (what, got, want) => { if (JSON.stringify(got) === JSON.stringify(want)) { ok.push(what); console.log('  ✔', what); } else { bad.push(`${what} — 기대 '${JSON.stringify(want)}', 실제 '${JSON.stringify(got)}'`); console.log('  ✘', what, '기대', want, '실제', got); } };
const sq = (x0, y0, d) => { const c = [126.66 + x0 * 1e-5, 37.46 + y0 * 1e-5], e = d * 1e-5; return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[c[0], c[1]], [c[0] + e, c[1]], [c[0] + e, c[1] + e], [c[0], c[1] + e], [c[0], c[1]]]] } }; };
const A = sq(0, 0, 100), A2 = sq(20, 0, 120), E = sq(400, 400, 80), F = sq(-500, 300, 90);
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => { const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (u.startsWith(U('/'))) return r.continue();
    for (const [re, to] of LIB) if (re.test(u) && fs.existsSync(NM + '/' + to)) return r.fulfill({ contentType: to.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(NM + '/' + to) });
    return r.fulfill({ status: 204, body: '' }); });
  const errs = [], watch = pg => pg.on('pageerror', e => errs.push(pg.url().replace(U(''), '') + ' ' + e.message));
  const note = async pg => pg.evaluate(() => { const b = document.getElementById('jbsZoneNote'); return b ? b.textContent : ''; });
  const pg = await ctx.newPage(); watch(pg);
  await pg.goto(U('/robots.txt'));
  await pg.evaluate(({ A }) => {
    localStorage.clear();
    localStorage.setItem('jbs.project.v1', JSON.stringify({ name: '시험 구역 재건축' }));
    localStorage.setItem('jbsc.project.v1', JSON.stringify({ meta: { name: '시험 구역 재건축', type: 'reconstruction', zoning: '준주거지역', zoningManual: true }, area: { geojson: A, drawnArea: 10000 }, plan: { far: 400, infraMode: 'ratio', infraRatio: 12 }, lands: [], buildings: [] }));
  }, { A });

  console.log('1. 사업성 화면 — A에서 설정 고침');
  await pg.goto(U('/')); await pg.waitForTimeout(3000);
  await pg.evaluate(() => { App.go('area'); }); await pg.waitForTimeout(600);
  await pg.evaluate(() => { Quick.ensure(); Object.assign(S.quick, { zone: '준주거지역_순수공동주택', zoneManual: true, farStep: 'custom', farCustom: 330, infraLevel: 'custom', infraPct: 12 }); S.prior.multiplier = 1.9; saveState(); });
  const before = await pg.evaluate(() => ({ type: S.meta.type, zone: S.quick.zone, far: S.plan.far, mul: S.prior.multiplier }));
  check('A 설정(재건축·준주거·용적률 400·배율 1.9)', before, { type: 'reconstruction', zone: '준주거지역_순수공동주택', far: 400, mul: 1.9 });
  await pg.evaluate(A2 => MapView.setZoneGeo(A2, '시험', '시험', true), A2); await pg.waitForTimeout(300);
  check('겹치는 구역으로 고치면 설정 그대로', await pg.evaluate(() => ({ type: S.meta.type, zone: S.quick.zone, far: S.plan.far, mul: S.prior.multiplier })), before);
  check('겹치면 초기화 띠 없음', /기본값으로 되돌렸습니다/.test(await note(pg)), false);

  console.log('   다른 위치(E)로 바꾸기');
  await pg.evaluate(E => MapView.setZoneGeo(E, '시험', '시험', true), E); await pg.waitForTimeout(500);
  const d = await pg.evaluate(() => { const D = defaultState(); Quick.ensure(); return {
    type: S.meta.type === D.meta.type, zoningManual: S.meta.zoningManual === false, plan: JSON.stringify(S.plan) === JSON.stringify(D.plan), prior: JSON.stringify(S.prior) === JSON.stringify(D.prior),
    sales: S.sales.length === D.sales.length && S.sales.every(x => !x.units), quickZoneManual: !S.quick.zoneManual, quickFar: S.quick.farStep, quickInfra: S.quick.infraLevel, name: S.meta.name,
    lands: S.lands.length, area: Math.round(turf.area(S.area.geojson)) }; });
  check('E: 사업 유형 기본값', d.type, true);
  check('E: 용도지역 직접 고름 표시 풀림', d.zoningManual, true);
  check('E: 계획(용적률·기반시설) 기본값', d.plan, true);
  check('E: 종전자산 배율 기본값', d.prior, true);
  check('E: 분양 표 기본값', d.sales, true);
  check('E: 빠른 사업성 용도지역 직접 고름 풀림', d.quickZoneManual, true);
  check('E: 빠른 사업성 용적률 단계 기본(base)', d.quickFar, 'base');
  check('E: 빠른 사업성 기반시설 평균(avg)', d.quickInfra, 'avg');
  check('E: 사업명은 남김', d.name, '시험 구역 재건축');
  check('E: 구역은 새 구역', d.area > 0, true);
  check('E: 초기화 띠', /기본값으로 되돌렸습니다/.test(await note(pg)), true);
  check('E: 저장된 값도 기본값', await pg.evaluate(() => { const v = JSON.parse(localStorage.getItem('jbsc.project.v1')); return [v.meta.type, v.plan.far, v.quick && v.quick.zoneManual || false]; }), ['redevelopment', 250, false]);

  console.log('   [되돌리기] → 예전 사업 그대로');
  await pg.click('#jbsZoneUndo'); await pg.waitForTimeout(500);
  check('되돌리기: A 설정 돌아옴', await pg.evaluate(() => ({ type: S.meta.type, zone: S.quick.zone, far: S.plan.far, mul: S.prior.multiplier })), before);
  check('되돌리기: 구역도 예전(A2)', await pg.evaluate(A2 => JbsProject.zoneHash(S.area.geojson) === JbsProject.zoneHash(A2), A2), true);

  console.log('2. 구역을 지운 뒤 다른 곳(F)을 그리기');
  await pg.evaluate(() => { MapView.items.clearLayers(); MapView.save(); }); await pg.waitForTimeout(300);
  check('지운 뒤에도 설정은 아직 그대로(지우기만으로는 초기화 안 함)', await pg.evaluate(() => S.meta.type), 'reconstruction');
  await pg.evaluate(F => { L.geoJSON(F).eachLayer(l => MapView.items.addLayer(l)); MapView.save(); }, F); await pg.waitForTimeout(500);
  check('지운 뒤 다른 곳 → 사업 유형 기본값', await pg.evaluate(() => S.meta.type), 'redevelopment');
  check('지운 뒤 다른 곳 → 용적률 기본값', await pg.evaluate(() => S.plan.far), 250);
  check('지운 뒤 다른 곳 → 빠른 사업성 용도지역 직접 고름 풀림', await pg.evaluate(() => !(S.quick && S.quick.zoneManual)), true);

  console.log('3. /urban — 안을 모두 지운 뒤 다른 곳');
  await pg.evaluate(({ A }) => {
    localStorage.setItem('jbs-urban-zones-v1', JSON.stringify({ title: '시험 구역 재건축', count: 1, zones: { A: { geojson: A, inArea: {}, from: 'map' } } }));
    localStorage.setItem('jbs-urban-plan', JSON.stringify({ zone: '준주거지역', zoneUser: true, infraRatio: 12, farMode: 'custom', farCustom: 330, parkMode: 'none' }));
    localStorage.removeItem('jbs.project.v1'); localStorage.setItem('jbs.project.v1', JSON.stringify({ name: '시험 구역 재건축' }));
  }, { A });
  await pg.goto(U('/urban/')); await pg.waitForTimeout(2500);
  check('/urban A안 준주거', await pg.evaluate(() => P.zone), '준주거지역');
  await pg.evaluate(() => setZoneGeom('A', null, 0, '지우기')); await pg.waitForTimeout(300);
  await pg.evaluate(E => setZoneGeom('A', E, 0, '그리기'), E); await pg.waitForTimeout(800);
  check('/urban 지운 뒤 다른 곳 → 용도지역 기본값', await pg.evaluate(() => P.zone), '제3종일반주거지역');
  check('/urban 계획 가정 전부 기본값', await pg.evaluate(() => { const a = Object.assign({}, P), b = Object.assign({}, P_DEFAULT); delete a.v54road; delete b.v54road; return JSON.stringify(a) === JSON.stringify(b); }), true);
  check('/urban 겹치는 구역 고치기는 그대로', await pg.evaluate(E => { P.zone = '준주거지역'; saveP(); const e2 = JSON.parse(JSON.stringify(E)); e2.geometry.coordinates[0][2][0] += 0.0001; setZoneGeom('A', e2, 0, '고치기'); return P.zone; }, E), '준주거지역');

  console.log('4. 검토 도구 — 원본이 다른 위치로 바뀌면 새 구역');
  await pg.evaluate(({ A, F }) => {
    localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: { id: 't1', name: '시험 구역 재건축', geojson: A, plan: { type: 'recon' }, constraints: { traffic: { 진입도로: 12 } }, arch: { chosen: { units: 900 } } } } }));
    localStorage.setItem('jbs.sites.current', 't1');
    JbsProject.offerZone(F, 'urban');
  }, { A, F });
  await pg.goto(U('/traffic/')); await pg.waitForTimeout(900);
  const s4 = await pg.evaluate(F => { const cur = localStorage.getItem('jbs.sites.current'), s = JbsSite.get(cur); return { cur: cur !== 't1', cons: !s.constraints || !Object.keys(s.constraints).length, arch: !s.arch, geo: JbsProject.zoneHash(s.geojson) === JbsProject.zoneHash(F), old: !!JbsSite.get('t1').constraints.traffic }; }, F);
  check('검토 도구: 새 구역으로 바뀜', s4.cur, true);
  check('검토 도구: 예전 교통 조건 안 끌고 옴', s4.cons, true);
  check('검토 도구: 예전 건축 확정안 안 끌고 옴', s4.arch, true);
  check('검토 도구: 새 구역 도형 = 원본', s4.geo, true);
  check('검토 도구: 예전 구역은 목록에 그대로', s4.old, true);
  check('검토 도구: 띠', /새 구역으로 시작/.test(await note(pg)), true);
  await pg.click('#jbsZoneUndo'); await pg.waitForTimeout(900);
  check('검토 도구 되돌리기 → 예전 구역', await pg.evaluate(() => localStorage.getItem('jbs.sites.current')), 't1');

  check('콘솔 오류 0', errs, []);
  console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`); bad.forEach(b => console.log(' -', b));
  await br.close(); srv.close(); process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
