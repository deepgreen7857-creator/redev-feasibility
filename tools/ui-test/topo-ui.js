// /topo 화면 점검: 시험 구역(공원·도로 + /arch 건축선 3m) → 도면 미리보기 → 가짜 연속지적 주입 → A1 PDF·DXF·SHAPE 내려받기, 콘솔 오류 모으기
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = process.env.UI_NM || (__dirname + '/node_modules');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8765);
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|favicon|googleapis|vworld|firebase|gstatic/i.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=(a,cb)=>{cb(null);return()=>{};};' : /firebase-app/.test(u) ? 'export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});' : 'export const getFirestore=()=>({});' });   // 홈페이지 저장(Firebase)은 '로그인 안 함'으로 흉내
    if (/Turf\.js\/6\.5\.0\/turf\.min\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(NM + '/@turf/turf/turf.min.js') });
    if (/^http:\/\/localhost:8765\//.test(u)) return r.continue();
    return r.fulfill({ status: 204, body: '' });
  });
  const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320), ll = ([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)];
  const R = q => q.map(ll).concat([ll(q[0])]);
  const site = { id: 't1', name: '점검 구역', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [R([[0, 0], [200, 0], [200, 170], [0, 170]])] } }, v: { type: 'redev' },
    arch: { exclude: [R([[0, 0], [40, 0], [40, 50], [0, 50]]), R([[0, 160], [200, 160], [200, 170], [0, 170]])], exKinds: ['공원', '도로(확폭·지정)'], params: { roadSb: 3 }, chosen: { units: 1000 } } };
  const parcels = [];
  for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) parcels.push({ type: 'Feature', properties: { jibun: `${100 + i * 4 + j}대` }, geometry: { type: 'Polygon', coordinates: [R([[i * 40, j * 40], [i * 40 + 40, j * 40], [i * 40 + 40, j * 40 + 40 + (j === 3 ? 10 : 0)], [i * 40, j * 40 + 40 + (j === 3 ? 10 : 0)]])] } });
  parcels.push({ type: 'Feature', properties: { jibun: '501도' }, geometry: { type: 'Polygon', coordinates: [R([[200, -10], [212, -10], [212, 182], [200, 182]])] } });
  parcels.push({ type: 'Feature', properties: { jibun: '300대' }, geometry: { type: 'Polygon', coordinates: [R([[-30, 60], [20, 60], [20, 100], [-30, 100]])] } });   // 경계를 가로지르는 필지
  await pg.addInitScript(s => { try { localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: s } })); localStorage.setItem('jbs.sites.current', 't1'); } catch (e) {} }, site);
  await pg.goto('http://localhost:8765/topo/?site=t1'); await pg.waitForTimeout(1500);
  console.log('구역 안내:', await pg.$eval('#siteInfo', e => e.innerText), '| 도엽', await pg.$$eval('.sheet', a => a.length));
  // 브이월드 대신 가짜 연속지적
  await pg.evaluate(p => { VWorld.dataAll = async () => p; Object.defineProperty(VWorld, 'enabled', { get: () => true }); }, parcels);
  await pg.click('#fetch'); await pg.waitForTimeout(1200);
  console.log('지적:', await pg.$eval('#pcInfo', e => e.innerText));
  console.log('확인할 것:', await pg.$eval('#warn', e => e.innerText.replace(/\s+/g, ' ')));
  await pg.fill('#gosi', '2027-12'); await pg.press('#gosi', 'Tab'); await pg.waitForTimeout(300);
  await pg.screenshot({ path: __dirname + '/topo-screen.png', fullPage: false });
  await pg.emulateMedia({ media: 'print' }); await pg.pdf({ path: __dirname + '/topo-A1.pdf', preferCSSPageSize: true, printBackground: true }); await pg.emulateMedia({ media: 'screen' });
  for (const [id, n] of [['#dxf', 'topo.dxf'], ['#shp', 'topo-shape.zip']]) { const [d] = await Promise.all([pg.waitForEvent('download'), pg.click(id)]); await d.saveAs(__dirname + '/' + n); console.log('내려받음', n, d.suggestedFilename()); }
  // 축척 고정 1/1,500 → 한 장
  await pg.selectOption('#scale', '1500'); await pg.waitForTimeout(400); console.log('1/1,500 도엽', await pg.$$eval('.sheet', a => a.length));
  console.log('오류', errs.length, errs.slice(0, 8));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
