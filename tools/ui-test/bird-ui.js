// /arch 화면 점검: 배치안 만들기 → 위험요소 카드(시선 간섭·검토 의견 문안) → 정밀 검산 → 일조 연계 다듬기, 콘솔 오류 모으기
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = process.env.UI_NM || (__dirname + '/node_modules');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8765);
const MAP = [[/leaflet\/1\.9\.4\/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/leaflet\/1\.9\.4\/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet\.draw\/1\.0\.4\/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet\.draw\/1\.0\.4\/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/Turf\.js\/6\.5\.0\/turf\.min\.js/, '@turf/turf/turf.min.js'], [/three\.js\/r128\/three\.min\.js/, 'three/build/three.min.js'], [/three@0\.128\.0\/(examples\/js\/.*\.js)/, 'three/$1']];
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const pg = await br.newPage({ viewport: { width: 1400, height: 1000 } }), errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|favicon|googleapis|vworld|firebase|gstatic/i.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    for (const [re, to] of MAP) { const m = u.match(re); if (m) { const f = NM + '/' + to.replace('$1', m[1] || ''); return r.fulfill({ contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(f) }); } }
    if (/^http:\/\/localhost:8765\//.test(u)) return r.continue();
    return r.fulfill({ status: 204, body: '' });
  });
  // 시험 구역: 위도 37.46 경도 126.66 근처 200×170m 네모
  const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320);
  const ring = [[0, 0], [200, 0], [200, 170], [0, 170], [0, 0]].map(([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)]);
  const site = { id: 't1', name: '점검 구역', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }, v: { type: 'redev', far: 280, floors: 35, roads: [] }, constraints: {} };
  await pg.addInitScript(s => { try { if (!localStorage.getItem('jbs.sites.v1')) localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: s } })); localStorage.setItem('jbs.sites.current', 't1'); } catch (e) {} }, site);
  await pg.goto('http://localhost:8765/arch/?site=t1'); await pg.waitForTimeout(2500);
  console.log('구역 불러옴:', await pg.evaluate(() => (document.querySelector('#p_siteArea') || {}).value));
  await pg.click('#run'); await pg.waitForFunction(() => document.querySelectorAll('#alts .alt').length > 0, null, { timeout: 240000 });
  pg.on('dialog', d => d.accept());
  await pg.click('#confirm'); await pg.waitForTimeout(800);
  await pg.click('.otabs [data-v="bird"]'); await pg.waitForTimeout(500);
  await pg.waitForFunction(() => /그리는 데/.test((document.querySelector('#birdNote') || {}).textContent || ''), null, { timeout: 120000 });
  const [np] = await Promise.all([pg.context().waitForEvent('page'), pg.click('#birdToPanel')]);
  np.on('pageerror', e => errs.push('panel pageerror: ' + e.message));
  await np.waitForLoadState(); await np.waitForTimeout(2500);
  console.log('판넬 조감도 들어옴:', await np.evaluate(() => !!document.querySelector('.panel .bird img')));
  await np.screenshot({ path: __dirname + '/panel-bird.png' });
  console.log('오류', errs.length, errs.slice(0, 8));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
