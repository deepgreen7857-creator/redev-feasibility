// /proc 화면 점검: 시험 구역 + /arch 확정안 → 위치·공람 시작일 입력 → 일정표·문서 8가지 → 문서 고치기 저장·되돌리기 → A4 PDF·워드, 콘솔 오류 모으기
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
  const site = { id: 't1', name: '점검 구역', plan: { type: 'redev' }, geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [R([[0, 0], [200, 0], [200, 170], [0, 170]])] } }, v: { type: 'redev' }, quick: { prior: 24000000, members: 600 },
    arch: { exclude: [R([[0, 0], [40, 0], [40, 50], [0, 50]])], exKinds: ['공원'], params: { roadSb: 3 }, chosen: { units: 1000, byType: { 59: 500, 84: 500 }, supply: { 59: 79.34, 84: 110.52 }, far: 249.5, gfa: 70000, lot: 30000, maxFloors: 30, buildings: [] } } };
  await pg.addInitScript(s => { try { if (!localStorage.getItem('jbs.sites.v1')) localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: s } })); localStorage.setItem('jbs.sites.current', 't1'); } catch (e) {} }, site);
  await pg.goto('http://localhost:8765/decision/?site=t1'); await pg.waitForTimeout(1200);
  await pg.click('#toProc'); await pg.waitForURL(/\/proc\//); await pg.waitForTimeout(1200);
  console.log('처음:', await pg.$eval('#siteInfo', e => e.innerText), '| 문서', await pg.$$eval('.pdoc', a => a.length));
  await pg.fill('#loc', '인천광역시 미추홀구 용현동 100번지 일원'); await pg.press('#loc', 'Tab');
  await pg.fill('#open', '2027-01-15'); await pg.dispatchEvent('#open', 'change');
  await pg.fill('#place', '미추홀구청 도시정비과'); await pg.press('#place', 'Tab');
  await pg.fill('#hol', '2027-03-01'); await pg.dispatchEvent('#hol', 'change'); await pg.waitForTimeout(400);
  console.log('일정:', await pg.$eval('#siteInfo', e => e.innerText));
  console.log('의회 문서:', await pg.$eval('#d-council .body', e => e.innerText.replace(/\s+/g, ' ').slice(0, 260)));
  // 문서 고치기 → 다시 열어도 남음 → 되돌리기
  await pg.focus('#d-notice .body'); await pg.evaluate(() => { const h = document.querySelector('#d-notice .body h1'); const r = document.createRange(); r.selectNodeContents(h); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }); await pg.keyboard.type(' (수정)'); await pg.waitForTimeout(300); console.log('입력 직후:', await pg.$eval('#d-notice .body h1', e => e.innerText), await pg.evaluate(() => Object.keys((JSON.parse(localStorage.getItem('jbs-proc-v1')||'{}').t1||{}).edits||{})));
  await pg.reload(); await pg.waitForTimeout(1200);
  const kept = await pg.$eval('#d-notice .body h1', e => e.innerText); console.log('고친 제목 남음:', kept);
  await pg.click('#d-notice [data-undo]'); await pg.waitForTimeout(300); console.log('되돌림:', await pg.$eval('#d-notice .body h1', e => e.innerText));
  await pg.screenshot({ path: __dirname + '/proc-screen.png' });
  await pg.emulateMedia({ media: 'print' }); await pg.pdf({ path: __dirname + '/proc-A4.pdf', preferCSSPageSize: true, printBackground: true, format: 'A4' }); await pg.emulateMedia({ media: 'screen' });
  const [d] = await Promise.all([pg.waitForEvent('download'), pg.click('#word')]); await d.saveAs(__dirname + '/proc.doc'); console.log('워드 크기', fs.statSync(__dirname + '/proc.doc').size);
  console.log('오류', errs.length, errs.slice(0, 8));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
