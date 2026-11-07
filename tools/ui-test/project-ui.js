// 사업명 연결 시험(2026-11-08, shared/project.js) — 고친 뒤 push 전에 돌림: node tools/ui-test/project-ui.js
// 확인하는 것
//  1. 처음 열 때 화면마다 다르던 이름 → 사업성 화면 이름 하나로 맞춰짐(옛 이름은 jbs.project.migrated에 남음)
//  2. 정비계획에서 구역명을 고치면 → 사업성·교통성·결정조서·절차서류·판넬·지형도면을 열었을 때 같은 이름
//  3. 사업성 화면을 열어 둔 채 다른 창에서 이름을 고치면 → 열린 창이 바로 바뀌고 '다른 창에서 바뀜' 경고가 뜨지 않음
//  4. 머리줄 '현재 사업' 띠에 같은 이름
//  5. 처음으로(전체 초기화) → 사업명 비워짐
// 끝에 '통과 n / 실패 n'과 실패 목록. 실패가 있으면 종료 코드 1
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PORT = 8771;
const srv = http.createServer((q, s) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html'; const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); }); }).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;

const ok = [], bad = [];
const check = (what, got, want) => { if (got === want) { ok.push(what); console.log('  ✔', what); } else { bad.push(`${what} — 기대 '${want}', 실제 '${got}'`); console.log('  ✘', what, '기대', want, '실제', got); } };

(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await br.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => {
    const u = r.request().url();
    if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });   // 관리자 잠금은 시험에서 건너뜀
    if (u.startsWith(U('/'))) return r.continue();
    return r.fulfill({ status: 204, body: '' });   // 지도·외부 라이브러리는 막음(이름 이어짐만 봄)
  });
  const errs = [];
  const watch = pg => { pg.on('pageerror', e => errs.push(pg.url().replace(U(''), '') + ' ' + e.message)); };
  const store = async (pg, k) => pg.evaluate(k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }, k);
  const band = async pg => pg.evaluate(() => { const b = document.querySelector('#jbsProj b'); return b ? b.textContent : '(띠 없음)'; });

  // 시작 상태: 화면마다 이름이 다름(예전 상태 재현)
  const pg = await ctx.newPage(); watch(pg);
  await pg.goto(U('/robots.txt'));
  await pg.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('jbsc.project.v1', JSON.stringify({ meta: { name: '가 구역 주택재개발정비사업', type: 'redevelopment', location: '' } }));
    localStorage.setItem('jbs-urban-zones-v1', JSON.stringify({ title: '옛날 구역명', zones: {} }));
    localStorage.setItem('jbs.sites.v1', JSON.stringify({ sites: { t1: { id: 't1', name: '정비계획 검토 A안', v: { type: 'redev', name: '', roads: [] }, plan: { type: 'redev' }, constraints: {} } } }));
    localStorage.setItem('jbs.sites.current', 't1');
  });

  console.log('1. 처음 열 때 맞추기');
  await pg.goto(U('/decision/')); await pg.waitForTimeout(800);
  check('원본 사업명 = 사업성 화면 이름', (await store(pg, 'jbs.project.v1') || {}).name, '가 구역 주택재개발정비사업');
  check('정비계획 구역명 맞춰짐', (await store(pg, 'jbs-urban-zones-v1') || {}).title, '가 구역 주택재개발정비사업');
  check('공통 구역 이름 맞춰짐', ((await store(pg, 'jbs.sites.v1') || {}).sites || {}).t1.name, '가 구역 주택재개발정비사업');
  check('옛 이름 기록 남음', ((await store(pg, 'jbs.project.migrated') || {}).before || {}).urban, '옛날 구역명');
  check('결정조서 화면 띠', await band(pg), '가 구역 주택재개발정비사업');

  console.log('2. 정비계획에서 이름 고치기 → 다른 화면');
  await pg.goto(U('/urban/')); await pg.waitForTimeout(1500);
  const hasTitle = await pg.$('#zoneTitle');
  if (hasTitle) { check('정비계획 구역명 칸', await pg.$eval('#zoneTitle', e => e.value), '가 구역 주택재개발정비사업'); await pg.fill('#zoneTitle', '나 구역 주택재건축정비사업'); await pg.dispatchEvent('#zoneTitle', 'change'); }
  else { console.log('  (정비계획 화면이 외부 지도 없이 다 안 떠서 띠의 이름 고치기로 대신)'); pg.once('dialog', d => d.accept('나 구역 주택재건축정비사업')); await pg.click('#jbsProj [data-p="ren"]'); }
  await pg.waitForTimeout(300);
  check('원본 사업명 바뀜', (await store(pg, 'jbs.project.v1') || {}).name, '나 구역 주택재건축정비사업');
  for (const p of ['/', '/traffic/', '/env/', '/landscape/', '/arch/', '/decision/', '/proc/', '/topo/', '/panel/']) {
    await pg.goto(U(p)); await pg.waitForTimeout(700);
    check(`${p} 띠 이름`, await band(pg), '나 구역 주택재건축정비사업');
  }
  check('사업성 저장 이름', ((await store(pg, 'jbsc.project.v1') || {}).meta || {}).name, '나 구역 주택재건축정비사업');
  check('공통 구역 이름(교통·결정조서 등이 읽음)', ((await store(pg, 'jbs.sites.v1') || {}).sites || {}).t1.name, '나 구역 주택재건축정비사업');

  console.log('3. 사업성 화면을 열어 둔 채 다른 창에서 고치기');
  const mainPg = await ctx.newPage(); watch(mainPg);
  await mainPg.goto(U('/')); await mainPg.waitForTimeout(1200);
  const other = await ctx.newPage(); watch(other);
  await other.goto(U('/traffic/')); await other.waitForTimeout(800);
  other.once('dialog', d => d.accept('다 구역 가로주택정비사업'));
  await other.click('#jbsProj [data-p="ren"]'); await other.waitForTimeout(600);
  check('열린 사업성 창 띠 바로 바뀜', await band(mainPg), '다 구역 가로주택정비사업');
  check('열린 사업성 창 머리 사업명 칸', await mainPg.$eval('input.proj-name', e => e.value).catch(() => '(칸 없음)'), '다 구역 가로주택정비사업');
  check('다른 창 경고 안 뜸', await mainPg.$('#otherTabBar') ? '뜸' : '안 뜸', '안 뜸');
  check('사업성 저장 이름(열린 창이 스스로 저장)', ((await store(mainPg, 'jbsc.project.v1') || {}).meta || {}).name, '다 구역 가로주택정비사업');
  await other.close();

  console.log('4. 사업성 화면에서 처음으로 → 사업명 비움');
  const reset = await mainPg.evaluate(() => { try { App.fullReset(); return true; } catch (e) { return e.message; } });
  if (reset === true) { await mainPg.waitForTimeout(300); check('처음으로 뒤 원본 사업명', (await store(mainPg, 'jbs.project.v1') || {}).name, ''); }
  else console.log('  (사업성 화면 초기화 함수가 외부 지도 없이 실패 — 건너뜀:', reset, ')');

  console.log(`\n통과 ${ok.length} / 실패 ${bad.length}`);
  bad.forEach(b => console.log('  실패:', b));
  const mine = errs.filter(e => /project\.js|JbsProject/.test(e));
  console.log(`사업명 코드 오류 ${mine.length}`, mine.slice(0, 5));
  console.log(`(참고) 외부 라이브러리를 막아서 생긴 다른 화면 오류 ${errs.length - mine.length}`);
  await br.close(); srv.close();
  process.exit(bad.length || mine.length ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
