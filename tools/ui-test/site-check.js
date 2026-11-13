// 사이트 전체 점검(2026-11-13): 모든 페이지를 열고 탭·단계 버튼을 차례로 눌러 화면 오류, 끊긴 사이트 안 링크, 사용법(manuals.json) 빈 곳을 모은다
//   node tools/ui-test/site-check.js [결과.json]
// 외부(브이월드·공공데이터·Firebase)는 막혀 있어 그 요청 실패는 오류로 세지 않음. 화면 코드에서 난 오류(pageerror)와 console.error 중 네트워크가 아닌 것만 셈
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..'), NM = __dirname + '/node_modules', PORT = 8790;
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0].split('#')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const LIB = [[/leaflet\.draw\.css/, 'leaflet-draw/dist/leaflet.draw.css'], [/leaflet\.draw\.js/, 'leaflet-draw/dist/leaflet.draw.js'], [/leaflet(\.min)?\.css/, 'leaflet/dist/leaflet.css'], [/leaflet(\.min)?\.js/, 'leaflet/dist/leaflet.js'], [/[Tt]urf/, '@turf/turf/turf.min.js'],
  [/xlsx\.full/, 'xlsx/dist/xlsx.full.min.js'], [/three\.min\.js|three@0\.128\.0\/build/, 'three/build/three.min.js'], [/proj4/, 'proj4/dist/proj4.js'], [/jszip/, 'jszip/dist/jszip.min.js'], [/pdf-lib/, 'pdf-lib/dist/pdf-lib.min.js'],
  [/chart\.umd/, 'chart.js/dist/chart.umd.js'], [/pdf\.min\.js/, 'pdfjs-dist/build/pdf.min.js'], [/pdf\.worker/, 'pdfjs-dist/build/pdf.worker.min.js']];
const THREE_EX = /three@0\.128\.0\/examples\/js\/(.+)$/;
const PAGES = [
  ['/', '사업성 검토'], ['/urban/', '정비계획 세우기'], ['/traffic/', '교통성 검토'], ['/env/', '환경성 검토'], ['/landscape/', '높이·경관'], ['/arch/', '개략 건축계획'],
  ['/panel/', '판넬·팸플릿'], ['/decision/', '결정조서(안)'], ['/proc/', '지정 절차 서류'], ['/topo/', '고시용 지형도면'], ['/library/', '검토서 라이브러리'], ['/safety/', '안전관리계획서'],
  ['/judge/', '판단기록장'], ['/review/', '정비경매 리포트'], ['/stock/', '주식'], ['/data/', '자료 보기'], ['/auction/', '입찰 판단표'], ['/guide/', '사용 설명서'],
];
const NET = /Failed to load module script|Failed to load resource|net::ERR|ERR_|status of 4\d\d|status of 5\d\d|firebase|firestore|vworld|data\.go\.kr|CORS|Access-Control|googleapis|gstatic|fetch|NetworkError|Load failed|jsonp|JSONP|timeout|시간 초과|조회 실패/i;
(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const out = { pages: {}, links: [], manuals: {} };
  for (const [p, name] of PAGES) {
    const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => { const u = r.request().url();
      if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
      if (u.startsWith(U('/'))) return r.continue();
      const m = u.match(THREE_EX); if (m && fs.existsSync(NM + '/three/examples/js/' + m[1])) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(NM + '/three/examples/js/' + m[1]) });
      for (const [re, to] of LIB) if (re.test(u) && fs.existsSync(NM + '/' + to)) return r.fulfill({ contentType: to.endsWith('.css') ? 'text/css' : 'application/javascript', body: fs.readFileSync(NM + '/' + to) });
      return r.fulfill({ status: 204, body: '' }); });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push('오류: ' + e.message.split('\n')[0]));
    pg.on('console', m => { if (m.type() === 'error' && !NET.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
    pg.on('dialog', d => d.dismiss().catch(() => {}));
    const t0 = Date.now();
    try { await pg.goto(U(p), { waitUntil: 'load', timeout: 30000 }); } catch (e) { errs.push('열기 실패: ' + e.message.split('\n')[0]); }
    await pg.waitForTimeout(2500);
    // 탭·단계 버튼 차례로(사업성: App.go, /urban: 단계 버튼, 그 밖: nav 단추) — 지우기·초기화 단추는 누르지 않음
    const clicked = await pg.evaluate(async () => {
      const done = [], wait = ms => new Promise(r => setTimeout(r, ms));
      if (window.App && App.go && window.Tabs) { for (const k of Object.keys(Tabs)) { try { App.go(k); done.push(k); } catch (e) { done.push(k + '✘' + e.message); } await wait(250); } return done; }
      const bad = /지우|삭제|초기화|처음으로|새 작업|새 사업|비우|로그아웃|내려받|다운로드|인쇄|복사|올리|저장|불러|확정|보내|열기|업로드|로그인|자동 진행|다시 받기/;
      const btns = [...document.querySelectorAll('nav button, .tabs button, [role=tab], .steps button, #tabs button, .tab')].filter(b => b.offsetParent && !bad.test(b.textContent));
      for (const b of btns.slice(0, 20)) { try { b.click(); done.push(b.textContent.trim().slice(0, 20)); } catch (e) { /* 무시 */ } await wait(300); }
      return done;
    });
    await pg.waitForTimeout(800);
    const links = await pg.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h && h.startsWith('/') && !h.startsWith('//')));
    const title = await pg.title();
    out.pages[p] = { name, title, ms: Date.now() - t0, clicked, errs: [...new Set(errs)] };
    links.forEach(h => out.links.push([p, h]));
    console.log(`${p} ${name} — 오류 ${out.pages[p].errs.length} · 누른 것 ${clicked.length}`); out.pages[p].errs.forEach(e => console.log('   ', e));
    await ctx.close();
  }
  // 끊긴 링크
  const seen = new Set(), broken = [];
  for (const [from, h] of out.links) { const k = h.split('?')[0].split('#')[0]; if (seen.has(k)) continue; seen.add(k); let f = path.join(ROOT, decodeURIComponent(k)); if (k.endsWith('/')) f = path.join(f, 'index.html'); if (!fs.existsSync(f)) broken.push([from, h]); }
  out.broken = broken; console.log('\n끊긴 사이트 안 링크', broken.length); broken.forEach(b => console.log('   ', b.join(' → ')));
  // 사용법 빈 곳
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/manuals.json'), 'utf8')).pages || {};
  out.manuals = { has: Object.keys(man), missing: PAGES.map(x => x[0]).filter(p => !man[p]) };
  console.log('사용법 없는 화면', out.manuals.missing.join(' '));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
  await br.close(); srv.close();
})().catch(e => { console.error(e); process.exit(2); });
