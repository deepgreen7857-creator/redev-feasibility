// node tools/ui-test/bline-ui.js — /urban 건축선·출입 계획(BLINE) 시험: 가짜 구역(약 265×222m)과 경계 도로 3개(남 15m·서 30m 대로·동 8m)로 변별 건축한계선·차량출입 불허구간·공공보행통로 자동 추천·공개공지·설명 칸·지도 그림 (2026-11-08)
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../..')), LIB = path.join(process.env.HOME || '/root', 'tools/node_modules');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const CDN = { 'leaflet/1.9.4/leaflet.min.js': 'leaflet/dist/leaflet.js', 'leaflet/1.9.4/leaflet.min.css': 'leaflet/dist/leaflet.css', 'leaflet.draw/1.0.4/leaflet.draw.js': 'leaflet-draw/dist/leaflet.draw.js', 'leaflet.draw/1.0.4/leaflet.draw.css': 'leaflet-draw/dist/leaflet.draw.css', 'Turf.js/6.5.0/turf.min.js': '@turf/turf/turf.min.js', 'xlsx/0.18.5/xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js' };
const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.txt': 'text/plain' };
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; fs.readFile(path.join(ROOT, p), (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
  await ctx.route('**/*', r => { const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=()=>{};export const GoogleAuthProvider=class{};export const signInWithPopup=async()=>{};export const signOut=async()=>{};' : 'export const initializeApp=()=>({});export const getFirestore=()=>({});export const doc=()=>({});export const getDoc=async()=>({exists:()=>false});export const setDoc=async()=>{};export const collection=()=>({});export const getDocs=async()=>({docs:[]});export const query=()=>({});export const orderBy=()=>({});export const limit=()=>({});export const serverTimestamp=()=>0;export const deleteDoc=async()=>{};export const where=()=>({});' });
    const m = u.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/(.+)$/); if (m && CDN[m[1]]) return r.fulfill({ contentType: m[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(LIB, CDN[m[1]])) });
    if (u.startsWith(U('/'))) return r.continue(); return r.fulfill({ status: 503, body: '' }); });
  const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.dismiss());
  await pg.goto(U('/urban/')); await pg.waitForTimeout(2500);
  const res = await pg.evaluate(() => {
    const out = {}, x0 = 126.6600, y0 = 37.4400, x1 = 126.6630, y1 = 37.4420, dx = 0.00012, dy = 0.0001;   // 도로 띠 약 10m
    const poly = c => ({ type: 'Polygon', coordinates: [c.concat([c[0]])] });
    const zone = { type: 'Feature', properties: {}, geometry: poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) };
    const z = { geojson: zone, infra: {}, roads: { at: 't1', edge: [
      { pnu: 'S', jibun: '남쪽 100', w: 15, geom: poly([[x0 - dx, y0 - dy], [x1 + dx, y0 - dy], [x1 + dx, y0], [x0 - dx, y0]]) },
      { pnu: 'W', jibun: '서쪽 200', w: 30, geom: poly([[x0 - dx, y0 - dy], [x0, y0 - dy], [x0, y1 + dy], [x0 - dx, y1 + dy]]) },
      { pnu: 'E', jibun: '동쪽 300', w: 8, geom: poly([[x1, y0 - dy], [x1 + dx, y0 - dy], [x1 + dx, y1 + dy], [x1, y1 + dy]]) } ] } };
    Z.zones.T = z;
    out.roads = BLINE.roads(z).map(r => r.pnu);
    out.car = BLINE.roads(z).map(r => r.pnu + ':' + BLINE.carOf(z, r));
    out.front = BLINE.roads(z).map(r => r.pnu + ':' + BLINE.frontOf(z, r));
    out.ix = GATE.ixOf(z).length;
    const P0 = BLINE.proj(z);
    out.edges = P0.edges.map((q, i) => (q.r ? q.r.pnu : '-') + ' sb' + q.sb + ' 불허' + q.noCar.map(([a, b]) => (a * P0.E[i].len).toFixed(0) + '~' + (b * P0.E[i].len).toFixed(0)).join(',') + ' 길이' + P0.E[i].len.toFixed(0));
    out.walk = P0.walks.map(w => (w.auto ? '자동 ' : '') + Math.hypot(w.pb[0] - w.pa[0], w.pb[1] - w.pa[1]).toFixed(0) + 'm');
    // 남쪽 도로 가운데는 허용, 남서 모서리 근처(교차로)는 불허, 서쪽 대로는 전부 불허
    const mid = [y0, (x0 + x1) / 2], corner = [y0, x0 + 0.00005], west = [(y0 + y1) / 2, x0];
    out.noCarMid = BLINE.noCarAt(z, mid); out.noCarCorner = BLINE.noCarAt(z, corner); out.noCarWest = BLINE.noCarAt(z, west);
    // 사용자 변경: 남쪽 건축한계선 5m, 서쪽 대로 허용
    const s = BLINE.st(z); s.sb = { S: 5 }; s.car = { W: 'free' }; BLINE._p = null;
    const P1 = BLINE.proj(z); out.after = P1.edges.map(q => (q.r ? q.r.pnu : '-') + ' sb' + q.sb + ' 불허구간' + q.noCar.length);
    out.noCarWest2 = BLINE.noCarAt(z, west);
    out.keep = BLINE.keepPolys(z).length;
    out.exp = (() => { const e = BLINE.exportOf(z); return { edges: e.edges.length, walks: e.walks.length, sbS: (e.edges.find(q => q.road === '남쪽 100') || {}).sb }; })();
    // 공개공지 추가 → keep 늘어남
    s.open = [{ pt: [y0, (x0 + x1) / 2], area: 900 }]; BLINE._p = null; out.keep2 = BLINE.keepPolys(z).length;
    out.openArea = Math.round(turf.area(turf.polygon([BLINE.proj(z).open[0].poly.map(p => BLINE.proj(z).ll(p).slice().reverse()).concat([BLINE.proj(z).ll(BLINE.proj(z).open[0].poly[0]).slice().reverse()])])));
    // 설명 칸 그리기
    const html = blineSection({ key: 'T' }); out.section = /건축한계선/.test(html) && /data-blsb="S"/.test(html) && /공공보행통로/.test(html) && /공개공지/.test(html);
    // 지도 그림
    const lay = L.layerGroup(); BLINE.draw(lay, z); out.drawn = lay.getLayers().length;
    delete Z.zones.T; return out;
  });
  console.log(JSON.stringify(res, null, 1)); console.log('화면 오류', errs);
  await br.close(); srv.close();
})();
