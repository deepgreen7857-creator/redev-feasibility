// 정비계획 화면(/urban) 동작 기록 시험(2026-11-08, urban.js 쪼개기 때 만듦)
//   node tools/ui-test/urban-ui.js [저장소 경로] [기록 파일]
// 하는 일: 예시 구역과 지도 모드(구역계를 미리 넣어 둠)에서 1~5단계·적용 기준 탭, 지도 표시 버튼을 차례로 누르며
//   오른쪽 설명 칸 글자·예시 지적도 그림·저장값·화면 오류를 기록한다.
// 쓰는 법: 고치기 전 기록과 고친 뒤 기록을 비교 — 코드를 옮기기만 했는데(쪼개기·정리) 기록이 달라지면 무언가 깨진 것.
//   node tools/ui-test/urban-ui.js . /tmp/전.json → 고침 → node tools/ui-test/urban-ui.js . /tmp/후.json → node tools/ui-test/urban-ui.js --비교 /tmp/전.json /tmp/후.json
// 외부(브이월드·cdnjs)는 막혀 있어도 됨: 지도 라이브러리는 ~/tools/node_modules(leaflet·leaflet-draw·turf·xlsx)에서 대신 줌, 공부 조회는 실패로 기록(양쪽 같음)
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');

if (process.argv[2] === '--비교') {
  const a = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')), b = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  let diff = 0;
  for (const k of keys) {
    const x = JSON.stringify(a[k]), y = JSON.stringify(b[k]);
    if (x !== y) { diff++; console.log('✘ 다름:', k); console.log('   전:', (x || '').slice(0, 300)); console.log('   후:', (y || '').slice(0, 300)); }
  }
  console.log(`비교 ${keys.length}항목 / 다름 ${diff}`);
  process.exit(diff ? 1 : 0);
}

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../..'));
const OUT = process.argv[3] || '/tmp/urban-ui.json';
const LIB = path.join(process.env.HOME || '/root', 'tools/node_modules');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PORT = 8772 + Math.floor(Math.random() * 100);
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const CDN = {
  'leaflet/1.9.4/leaflet.min.js': 'leaflet/dist/leaflet.js', 'leaflet/1.9.4/leaflet.min.css': 'leaflet/dist/leaflet.css',
  'leaflet.draw/1.0.4/leaflet.draw.js': 'leaflet-draw/dist/leaflet.draw.js', 'leaflet.draw/1.0.4/leaflet.draw.css': 'leaflet-draw/dist/leaflet.draw.css',
  'Turf.js/6.5.0/turf.min.js': '@turf/turf/turf.min.js', 'xlsx/0.18.5/xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
};
const h = s => crypto.createHash('md5').update(String(s)).digest('hex').slice(0, 12);
// 시각·난수처럼 매번 바뀌는 글자는 지움
const norm = s => String(s || '').replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?/g, '(시각)').replace(/\d{1,2}:\d{2}(:\d{2})?/g, '(시각)');

// 지도 모드 시험용 구역계(학익동 부근, 가짜 좌표 사각형 — 공부 조회는 실패)
const ZONE = { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[126.6600, 37.4400], [126.6630, 37.4400], [126.6630, 37.4420], [126.6600, 37.4420], [126.6600, 37.4400]]] } };

(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const rec = {};
  const run = async (label, prep) => {
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.addInitScript(() => { Math.random = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })(); const D0 = Date; const fixed = new D0('2026-11-08T12:00:00+09:00').getTime(); self.Date = class extends D0 { constructor(...a) { super(...(a.length ? a : [fixed])); } static now() { return fixed; } }; });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=(a,cb)=>{cb(null);return()=>{};};' : /firebase-app/.test(u) ? 'export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});' : 'export const getFirestore=()=>({});' });   // 홈페이지 저장(Firebase)은 '로그인 안 함'으로 흉내
      const m = u.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/(.+)$/);
      if (m && CDN[m[1]]) return r.fulfill({ contentType: m[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(LIB, CDN[m[1]])) });
      if (u.startsWith(U('/'))) return r.continue();
      return r.fulfill({ status: 503, body: '' });   // 외부 조회는 실패
    });
    const pg = await ctx.newPage();
    const errs = [];
    pg.on('pageerror', e => errs.push(norm(e.message)));
    pg.on('dialog', d => d.dismiss());
    await pg.goto(U('/robots.txt'));
    await pg.evaluate(prep || (() => localStorage.clear()), ZONE);
    await pg.goto(U('/urban/')); await pg.waitForTimeout(2500);
    const snap = async tag => {
      rec[`${label}/${tag}/설명칸`] = norm(await pg.$eval('#side', e => e.innerText).catch(() => '(없음)'));
      rec[`${label}/${tag}/출처줄`] = norm(await pg.$eval('#source', e => e.innerText).catch(() => '(없음)'));
      rec[`${label}/${tag}/예시그림`] = h(await pg.$eval('#map', e => e.innerHTML).catch(() => ''));
      rec[`${label}/${tag}/지도요소수`] = await pg.$$eval('#lmap path, #lmap .leaflet-marker-icon, .leaflet-pane path', a => a.length).catch(() => -1);
    };
    await snap('처음');
    for (const t of ['zone', 'req', 'arch', 'plan', 'biz', 'rules', 'zone']) {
      const b = await pg.$(`nav.steps button[data-tab="${t}"]`); if (!b) continue;
      await b.click(); await pg.waitForTimeout(700); await snap(`탭-${t}`);
    }
    for (const m of ['small', 'access', 'zone', 'infra', 'arch', 'old']) {
      const b = await pg.$(`[data-mode="${m}"]`); if (!b || !(await b.isVisible())) continue;
      await b.click(); await pg.waitForTimeout(500); await snap(`지도-${m}`);
    }
    rec[`${label}/저장값`] = await pg.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^jbs/.test(k)) o[k] = localStorage.getItem(k).replace(/"(updated|at|savedAt|time|ts)":"[^"]*"/g, '"$1":"(시각)"').replace(/"(updated|at|savedAt|time|ts)":\d+/g, '"$1":0'); } return o; }).then(o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, h(v)])));
    rec[`${label}/화면오류`] = errs;
    await ctx.close();
  };

  // 1. 예시 구역
  await run('예시', () => { localStorage.clear(); });
  // 2. 지도 모드: A안 구역계를 미리 넣음
  await run('지도', z => {
    localStorage.clear();
    localStorage.setItem('jbs-urban-zones-v1', JSON.stringify({ title: '시험 구역 주택재개발정비사업', zones: { A: { geojson: z } } }));
  });

  // 3. 예시 구역 화면을 직접 눌러서
  {
    const ctx = await br.newContext({ viewport: { width: 1500, height: 950 } });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
    if (/gstatic\.com\/firebasejs\//.test(u)) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: /firebase-auth/.test(u) ? 'export const getAuth=()=>({currentUser:null});export const onAuthStateChanged=(a,cb)=>{cb(null);return()=>{};};' : /firebase-app/.test(u) ? 'export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});' : 'export const getFirestore=()=>({});' });   // 홈페이지 저장(Firebase)은 '로그인 안 함'으로 흉내
      const m = u.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/(.+)$/);
      if (m && CDN[m[1]]) return r.fulfill({ contentType: m[1].endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(path.join(LIB, CDN[m[1]])) });
      if (u.startsWith(U('/'))) return r.continue();
      return r.fulfill({ status: 503, body: '' });
    });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(norm(e.message))); pg.on('dialog', d => d.dismiss());
    await pg.goto(U('/urban/')); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await pg.waitForTimeout(2000);
    const b = await pg.$('#toSample');
    rec['예시보기/버튼있음'] = !!b;
    if (b) {
      await b.click(); await pg.waitForTimeout(1200);
      for (const t of ['zone', 'req', 'arch', 'plan', 'biz', 'rules']) {
        const x = await pg.$(`nav.steps button[data-tab="${t}"]`); if (!x) continue;
        await x.click(); await pg.waitForTimeout(700);
        rec[`예시보기/탭-${t}/설명칸`] = norm(await pg.$eval('#side', e => e.innerText).catch(() => '(없음)'));
        rec[`예시보기/탭-${t}/예시그림`] = h(await pg.$eval('#map', e => e.innerHTML).catch(() => ''));
      }
      for (const m of ['small', 'access', 'zone', 'infra', 'arch', 'old']) {
        const x = await pg.$(`[data-mode="${m}"]`); if (!x || !(await x.isVisible())) continue;
        await x.click(); await pg.waitForTimeout(500);
        rec[`예시보기/지도-${m}/예시그림`] = h(await pg.$eval('#map', e => e.innerHTML).catch(() => ''));
        rec[`예시보기/지도-${m}/설명칸`] = norm(await pg.$eval('#side', e => e.innerText).catch(() => '(없음)'));
      }
    }
    rec['예시보기/화면오류'] = errs;
    await ctx.close();
  }

  fs.writeFileSync(OUT, JSON.stringify(rec, null, 1));
  const errN = Object.entries(rec).filter(([k]) => /화면오류$/.test(k)).reduce((a, [, v]) => a + v.length, 0);
  console.log(`기록 ${Object.keys(rec).length}항목 → ${OUT} / 화면 오류 ${errN}`);
  Object.entries(rec).filter(([k, v]) => /화면오류$/.test(k) && v.length).forEach(([k, v]) => console.log(' ', k, v.slice(0, 4)));
  await br.close(); srv.close();
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
