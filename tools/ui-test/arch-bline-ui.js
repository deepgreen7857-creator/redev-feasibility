// node tools/ui-test/arch-bline-ui.js [배치도 svg 저장 경로] — /arch가 /urban 건축선·출입 계획(site.urbanBl)을 받아 배치·배치도에 반영하는지(건축한계선 6m·소음 이격·차량출입 불허구간·공공보행통로·출입구 자리) (2026-11-08)
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
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=(a,cb)=>{cb(null);return()=>{};};' : /firebase-app/.test(u) ? 'export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});' : 'export const getFirestore=()=>({});' });   // 홈페이지 저장(Firebase)은 '로그인 안 함'으로 흉내
    for (const [re, to] of MAP) { const m = u.match(re); if (m) { const f = NM + '/' + to.replace('$1', m[1] || ''); return r.fulfill({ contentType: f.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(f) }); } }
    if (/^http:\/\/localhost:8765\//.test(u)) return r.continue();
    return r.fulfill({ status: 204, body: '' });
  });
  // 시험 구역: 위도 37.46 경도 126.66 근처 200×170m 네모
  const lat0 = 37.46, lon0 = 126.66, dLat = m => m / 110540, dLon = m => m / (Math.cos(lat0 * Math.PI / 180) * 111320);
  const ring = [[0, 0], [200, 0], [200, 170], [0, 170], [0, 0]].map(([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)]);
  const LL = ([x, y]) => [lat0 + dLat(y), lon0 + dLon(x)], GJ = c => ({ type: 'Polygon', coordinates: [c.concat([c[0]]).map(([x, y]) => [lon0 + dLon(x), lat0 + dLat(y)])] });
  const urbanBl = { edges: [
      { a: LL([0, 0]), b: LL([200, 0]), sb: 6, front: 'walk', noCar: [[0, 0.1]], road: '남쪽', w: 15 },
      { a: LL([0, 170]), b: LL([0, 0]), sb: 3, front: 'walk', noCar: [[0, 1]], road: '서쪽 대로', w: 30 } ],
    walks: [{ poly: [[97, 0], [103, 0], [103, 170], [97, 170]].map(LL), w: 6 }], open: [] };
  const site = { id: 't1', name: '점검 구역', geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }, v: { type: 'redev', far: 280, floors: 35, roads: [] }, constraints: {},
    profile: { roadGeoms: [{ name: '남쪽 도로', w: 15, geom: GJ([[-10, -15], [210, -15], [210, 0], [-10, 0]]) }, { name: '서쪽 대로', w: 30, geom: GJ([[-30, -15], [0, -15], [0, 180], [-30, 180]]) }] }, urbanBl };
  await pg.addInitScript(s => { try { localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: s } })); localStorage.setItem('jbs.sites.current', 't1'); } catch (e) {} }, site);
  await pg.goto('http://localhost:8765/arch/?site=t1'); await pg.waitForTimeout(2500);
  console.log('구역 불러옴:', await pg.evaluate(() => (document.querySelector('#p_siteArea') || {}).value));
  await pg.click('#run'); await pg.waitForFunction(() => document.querySelectorAll('#alts .alt').length > 0, null, { timeout: 240000 });
  console.log('대안:', await pg.$$eval('#alts .alt', b => b.map(x => x.innerText.replace(/\s+/g, ' ')).join(' / ')));
  const svg = await pg.$eval('#planSvg', e => e.innerHTML);
  console.log('배치도: 건축한계선 6m', /건축한계선 6m/.test(svg), '· 소음 이격', /소음 이격/.test(svg), '· 불허 범례', /차량출입 불허구간/.test(svg), '· 보행통로', /공공보행통로/.test(svg));
  console.log('출입구 표시:', (svg.match(/주출입구\(문주\)|주차장 출입구 · 경사로 \d+m|부출입구\(보행\)/g) || []).join(', '));
  const big = await pg.$eval('#planSvg svg', e => e.outerHTML); require('fs').writeFileSync(process.argv[2] || '/tmp/arch-bline.svg', big);
  console.log('메시지:', (await pg.$eval('#msg', e => e.innerText)).slice(0, 200));
  console.log('오류', errs.length, errs.slice(0, 8));
  await br.close(); srv.close();
})().catch(e => { console.error('점검 실패', e.message); process.exit(1); });
