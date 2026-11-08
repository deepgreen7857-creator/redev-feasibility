// 본 화면 점검: 사업명 두 칸 맞춤, 지도 휠(누르기 전엔 페이지 스크롤)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = process.env.UI_NM || (__dirname + '/node_modules');
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(8765);
const MAP = [[/leaflet\/1\.9\.4\/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/leaflet\/1\.9\.4\/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet\.draw\/1\.0\.4\/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet\.draw\/1\.0\.4\/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/Turf\.js\/6\.5\.0\/turf\.min\.js/, '@turf/turf/turf.min.js'], [/three\.js\/r128\/three\.min\.js/, 'three/build/three.min.js'], [/three@0\.128\.0\/(examples\/js\/.*\.js)/, 'three/$1']];
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1500, height: 1000 }, acceptDownloads: true }), pg = await ctx.newPage(), errs = [];
  pg.on('pageerror', e => errs.push('pageerror: ' + e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_|favicon|googleapis|vworld|firebase|gstatic/i.test(m.text())) errs.push('console: ' + m.text()); });
  await pg.route('**/*', async r => {
    const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=(a,cb)=>{cb(null);return()=>{};};' : /firebase-app/.test(u) ? 'export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});' : 'export const getFirestore=()=>({});' });   // 홈페이지 저장(Firebase)은 '로그인 안 함'으로 흉내
    if (/Turf\.js\/6\.5\.0\/turf\.min\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(NM + '/@turf/turf/turf.min.js') });
    for (const [re, to] of MAP) { const m = u.match(re); if (m) { const f = NM + '/' + to.replace('$1', m[1] || ''); if (fs.existsSync(f)) return r.fulfill({ contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(f) }); } }
    if (/^http:\/\/localhost:8765\//.test(u)) return r.continue();
    return r.fulfill({ status: 204, body: '' });
  });
  await pg.goto('http://localhost:8765/'); await pg.waitForTimeout(2500);
  const ins = await pg.$$('[data-bind="meta.name"]'); await ins[1].fill('이름 맞춤 시험'); await pg.waitForTimeout(300);
  console.log('사업명 두 칸:', await pg.$$eval('[data-bind="meta.name"]', a => a.map(i => i.value)));
  await pg.click('.tab[data-tab="area"], [data-tab="area"]').catch(() => {}); await pg.waitForTimeout(1500);
  const z0 = await pg.evaluate(() => MapView.map && MapView.map.getZoom());
  await pg.$eval('#map', e => e.scrollIntoView({ block: 'center' })); await pg.waitForTimeout(300);
  const box = await pg.$eval('#map', e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await pg.mouse.move(box[0], box[1]); await pg.mouse.wheel(0, 600); await pg.waitForTimeout(600);
  const z1 = await pg.evaluate(() => MapView.map.getZoom());
  await pg.mouse.click(box[0], box[1]); await pg.mouse.wheel(0, 600); await pg.waitForTimeout(800);
  const z2 = await pg.evaluate(() => MapView.map.getZoom() + ' 켜짐=' + MapView.map.scrollWheelZoom.enabled());
  await pg.keyboard.down('Control'); await pg.mouse.wheel(0, 300); await pg.keyboard.up('Control'); await pg.waitForTimeout(600); console.log('Ctrl+휠 뒤', await pg.evaluate(() => MapView.map.getZoom()));
  console.log('휠(누르기 전) 줌', z0, '→', z1, '| 누른 뒤', z2);
  console.log('오류', errs.length, errs.slice(0, 6));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
