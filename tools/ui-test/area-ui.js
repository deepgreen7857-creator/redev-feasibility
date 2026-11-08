// 2단계 구역 만들기 정리 점검(2026-11-08): 방법 고르기 상자·지도 아래 막대·기반시설 비율 칸·남은 위치 비우기
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = __dirname + '/node_modules';
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8766);
const MAP = [[/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/turf/i, '@turf/turf/turf.min.js']];
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const pg = await (await br.newContext({ viewport: { width: 1500, height: 900 } })).newPage(), errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load|ERR_|MIME|firebase|gstatic/i.test(m.text())) errs.push(m.text()); });
  await pg.route('**/*', async r => { const u = r.request().url();
    if (/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (u.startsWith('http://localhost:8766/')) return r.continue();
    for (const [re, to] of MAP) if (re.test(u) && fs.existsSync(NM + '/' + to)) return r.fulfill({ contentType: to.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(NM + '/' + to) });
    return r.fulfill({ status: 204, body: '' }); });
  // 예전 작업에서 남은 위치·용도지역(대표 지번·구역 없음)
  await pg.addInitScript(() => { try { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('jbsc.project.v1', JSON.stringify({ meta: { name: '새 정비사업', type: 'redevelopment', location: '인천광역시 강화군 길상면 선두리 1053-79', zoning: '준주거지역' }, area: {}, plan: { infraMode: 'auto', infraRatio: 20 }, lands: [], buildings: [] })); } } catch (e) {} });
  await pg.goto('http://localhost:8766/'); await pg.waitForTimeout(2500);
  console.log('남은 위치·용도지역 비움:', JSON.stringify(await pg.evaluate(() => [S.meta.location, S.meta.zoning])));
  await pg.evaluate(() => App.go('area')); await pg.waitForTimeout(1500);
  console.log('구역 없음 상자:', (await pg.$eval('#addrParcelBox', e => e.innerText)).replace(/\s+/g, ' ').slice(0, 200));
  console.log('막대:', await pg.$eval('#zoneBar', e => e.innerText));
  console.log('접힌 상자:', JSON.stringify(await pg.$$eval('.zk-more', a => a.map(d => [d.id, d.open]))));
  await pg.click('#zkList'); await pg.waitForTimeout(500); console.log('② 누르면 지번 상자 열림:', await pg.$eval('#zkJibun', d => d.open));
  console.log('비율 칸(조서 없음 → 대신 쓸 비율):', await pg.$eval('#infraRatioBox', e => !e.hidden && e.innerText.split('\n')[0]));
  // 구역을 하나 넣고 막대·완료 버튼
  await pg.evaluate(() => { const c = [126.66, 37.46], d = 0.001; S.area.geojson = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[c[0], c[1]], [c[0] + d, c[1]], [c[0] + d, c[1] + d], [c[0], c[1] + d], [c[0], c[1]]]] } }; S.area.drawnArea = 9800; S.area.mode = 'drawn'; S.lands = [{ jibun: '1', jimok: '대', area: 9000 }, { jibun: '2', jimok: '도', area: 800 }]; App.update(true); });
  await pg.waitForTimeout(800);
  console.log('구역 있음 막대:', (await pg.$eval('#zoneBar', e => e.innerText)).replace(/\s+/g, ' '));
  console.log('비율 칸(자동·조서 있음 → 숨김):', await pg.$eval('#infraRatioBox', e => e.hidden));
  await pg.click('#zbDone'); await pg.waitForTimeout(800);
  console.log('완료 누른 뒤 탭:', await pg.evaluate(() => App.current), '완료 표시', await pg.evaluate(() => !!S.area.confirmedSig));
  await pg.evaluate(() => App.go('area')); await pg.waitForTimeout(800);
  console.log('다시 와 보면:', (await pg.$eval('#zoneBar', e => e.innerText)).replace(/\s+/g, ' '));
  await pg.evaluate(() => { S.plan.infraMode = 'ratio'; App.update(true); }); await pg.waitForTimeout(300);
  console.log('비율 방식이면 비율 칸:', await pg.$eval('#infraRatioBox', e => !e.hidden && e.innerText.split('\n')[0]));
  await pg.screenshot({ path: __dirname + '/area-screen.png' });
  console.log('오류', errs.length, errs.slice(0, 5));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
