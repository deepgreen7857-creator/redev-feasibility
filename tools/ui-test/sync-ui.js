// 두 컴퓨터 이어서 하기 시험(2026-11-08, shared/workfile.js checkNewer): node tools/ui-test/sync-ui.js
// 브라우저 저장 공간이 따로인 '컴퓨터 A'·'컴퓨터 B' 두 창을 만들고, 홈페이지 저장(Firebase)은 이 시험 서버 메모리로 흉내 낸다.
//  1. A에서 작업 → 홈페이지에 올라감
//  2. 빈 B를 열면 '다른 컴퓨터에서 더 최근에 저장한 작업' 띠 → [이어서 하기] → B에 A 작업(사업명)이 그대로
//  3. B에서 이름을 고쳐 올림 → A를 다시 열면 띠 → [이 컴퓨터 것 계속] → 다시 열어도 같은 버전은 안 물음
//  4. A에 안 올린 변경이 있는데 B가 더 새로 올림 → A 띠에 '안 올라간 변경' 경고 → 이어받으면 A 것은 백업된 뒤 바뀜
//  5. 이미 같은 작업이면 띠가 안 뜸
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const ROOT = path.resolve(__dirname, '../..');
const MIME = { '.txt': 'text/plain', '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css' };
const PORT = 8875;
const STORE = new Map();   // '컬렉션/문서[/하위/문서]' → 자료
const srv = http.createServer((q, s) => {
  if (q.url.startsWith('/__fs')) {
    let b = ''; q.on('data', c => { b += c; }); q.on('end', () => {
      const r = JSON.parse(b || '{}'); let out = null;
      if (r.op === 'set') STORE.set(r.path, r.data);
      else if (r.op === 'del') STORE.delete(r.path);
      else if (r.op === 'get') out = STORE.has(r.path) ? STORE.get(r.path) : null;
      else if (r.op === 'list') { const n = r.path.split('/').length + 1; out = [...STORE.entries()].filter(([k]) => k.startsWith(r.path + '/') && k.split('/').length === n).map(([k, v]) => ({ id: k.split('/').pop(), data: v })); }
      s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify(out));
    });
    return;
  }
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p); fs.readFile(f, (e, d) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' }); s.end(d); });
}).listen(PORT);
const U = p => `http://localhost:${PORT}${p}`;
const FS = `const call=(op,path,data)=>fetch('${U('/__fs')}',{method:'POST',body:JSON.stringify({op,path,data})}).then(r=>r.json());`;
const STUB = {
  app: `export const getApps=()=>[];export const getApp=()=>({});export const initializeApp=()=>({});`,
  auth: `const u={email:'test@jbslab'};export const getAuth=()=>({currentUser:u});export const onAuthStateChanged=(a,cb)=>{cb(u);return()=>{};};`,
  firestore: FS + `export const getFirestore=()=>({});export const serverTimestamp=()=>Date.now();
export const collection=(db,...p)=>({path:p.join('/')});export const doc=(db,...p)=>({path:p.join('/')});
export const limit=n=>({limit:n});export const orderBy=(f,d)=>({orderBy:f,dir:d});export const where=(f,op,v)=>({where:f,v});
export const query=(c,...q)=>Object.assign({path:c.path},...q);
export const setDoc=(r,d)=>call('set',r.path,d);export const deleteDoc=r=>call('del',r.path);
export const getDoc=async r=>{const d=await call('get',r.path);return{exists:()=>d!==null,data:()=>d||undefined};};
export const getDocs=async q=>{let L=await call('list',q.path);if(q.where)L=L.filter(x=>x.data[q.where]===q.v);if(q.orderBy)L.sort((a,b)=>String(b.data[q.orderBy]).localeCompare(String(a.data[q.orderBy])));if(q.limit)L=L.slice(0,q.limit);return{docs:L.map(x=>({id:x.id,data:()=>x.data}))};};`,
};

const ok = [], bad = [];
const check = (what, got, want) => { if (got === want) { ok.push(what); console.log('  ✔', what); } else { bad.push(`${what} — 기대 '${want}', 실제 '${got}'`); console.log('  ✘', what, '기대', want, '실제', got); } };

(async () => {
  const br = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const computer = async () => {
    const ctx = await br.newContext({ viewport: { width: 1300, height: 850 } });
    await ctx.route('**/*', r => {
      const u = r.request().url();
      if (/\/shared\/gate\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: '' });
      const m = u.match(/gstatic\.com\/firebasejs\/[^/]+\/firebase-(app|auth|firestore)\.js/);
      if (m) return r.fulfill({ contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: STUB[m[1]] });
      if (u.startsWith(U('/'))) return r.continue();
      return r.fulfill({ status: 503, body: '' });
    });
    const pg = await ctx.newPage(); const errs = [];
    pg.on('pageerror', e => errs.push(e.message)); pg.on('dialog', d => d.accept());
    pg.errs = errs; return pg;
  };
  const band = pg => pg.evaluate(() => { const b = document.querySelector('#jbsProj b'); return b ? b.textContent : '(띠 없음)'; });
  const bar = pg => pg.evaluate(() => { const b = document.getElementById('jbsSyncBar'); return b && !b.hidden ? b.innerText : ''; });
  const upload = pg => pg.evaluate(async () => { await JbsWork.autoVersion('시험'); return localStorage.getItem('jbsw:lastCloudHash'); });
  const open = async (pg, p) => { await pg.goto(U(p)); await pg.waitForTimeout(4500); };

  const A = await computer(), B = await computer();
  console.log('1. A에서 작업 → 올림');
  await A.goto(U('/robots.txt'));
  await A.evaluate(() => { localStorage.clear(); localStorage.setItem('jbs-urban-zones-v1', JSON.stringify({ title: '가 구역 주택재개발정비사업', zones: { A: { geojson: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[126.66, 37.44], [126.663, 37.44], [126.663, 37.442], [126.66, 37.44]]] } } } } })); });
  await open(A, '/decision/');
  check('A 띠 사업명', await band(A), '가 구역 주택재개발정비사업');
  check('A는 띠(다른 컴퓨터 알림) 없음', await bar(A), '');
  await upload(A);
  check('홈페이지에 버전 올라감', [...STORE.keys()].filter(k => /^jbsWork\/[^/]+$/.test(k)).length >= 1, true);

  console.log('2. 빈 B를 열면 묻지 않고 바로 맞춤(2026-11-13 서버가 원본)');
  await B.goto(U('/robots.txt')); await B.evaluate(() => localStorage.clear());
  await B.goto(U('/traffic/')); await B.waitForTimeout(9000);   // 열고 2.5초 뒤 확인 → 받아서 다시 엶
  check('B 띠(알림) 없음 — 바로 맞춤', await bar(B), '');
  check('B가 A 작업 이어받음(띠 사업명)', await band(B), '가 구역 주택재개발정비사업');
  await open(B, '/traffic/');
  check('B 다시 열면 그대로', await band(B), '가 구역 주택재개발정비사업');

  console.log('3. B에서 이름 고쳐 올림 → A(안 올린 변경 없음)는 바로 맞춤');
  await B.evaluate(() => JbsProject.setName('나 구역 주택재건축정비사업', 'edit'));
  await B.waitForTimeout(300); await upload(B);
  await A.goto(U('/decision/')); await A.waitForTimeout(9000);
  check('A 띠 없음 — 바로 맞춤', await bar(A), '');
  check('A 사업명이 B 것으로', await band(A), '나 구역 주택재건축정비사업');

  console.log('3-2. A에 안 올린 변경 + B가 새로 올림 → 띠 → 이 컴퓨터 것 계속');
  await B.evaluate(() => JbsProject.setName('라 구역 주택재개발정비사업', 'edit')); await B.waitForTimeout(300); await upload(B);
  await A.evaluate(() => { localStorage.setItem('jbs-memo-test', 'A만의 변경'); });
  await open(A, '/decision/');
  check('A에 알림', /다른 컴퓨터에서 더 최근/.test(await bar(A)), true);
  check('A 알림에 B 사업명', /라 구역 주택재개발정비사업/.test(await bar(A)), true);
  await A.click('#jbsSyncBar [data-s="keep"]'); await A.waitForTimeout(800);
  check('계속 쓰기 → 알림 닫힘', await bar(A), '');
  check('A 사업명 그대로', await band(A), '나 구역 주택재건축정비사업');
  await open(A, '/decision/');
  check('A 다시 열어도 같은 버전은 안 물음', await bar(A), '');

  console.log('4. A에 안 올린 변경 + B가 더 새로 올림 → 경고 → 이어받기');
  // 3에서 A가 '계속 쓰기'를 골라 A 작업이 새 버전으로 올라갔을 수 있음 → B를 다시 맞춘 뒤 새로 고쳐 올림
  await B.evaluate(() => JbsProject.setName('다 구역 가로주택정비사업', 'edit')); await B.waitForTimeout(300); await upload(B);
  await A.evaluate(() => { localStorage.setItem('jbs-memo-test', '안 올린 변경 2'); });
  await open(A, '/decision/');
  const a2 = await bar(A);
  check('A에 알림', /다른 컴퓨터에서 더 최근/.test(a2), true);
  check('A 알림에 안 올린 변경 경고', /안 올라간 변경/.test(a2), true);
  const before = [...STORE.values()].filter(v => v && v.kind === 'backup').length;
  await Promise.all([A.waitForNavigation({ timeout: 15000 }), A.click('#jbsSyncBar [data-s="take"]')]); await A.waitForTimeout(4500);
  check('A가 B 작업 이어받음', await band(A), '다 구역 가로주택정비사업');
  check('A 것은 이어받기 전 백업됨', [...STORE.values()].filter(v => v && v.kind === 'backup').length > before, true);

  console.log('5. 같은 작업이면 알림 없음');
  await open(B, '/decision/');
  check('B 알림 없음', await bar(B), '');

  const errs = [...A.errs, ...B.errs].filter(e => /workfile|JbsWork|checkNewer|jbsSync/i.test(e));
  console.log(`\n통과 ${ok.length} / 실패 ${bad.length} / 관련 화면 오류 ${errs.length}`, errs.slice(0, 3));
  bad.forEach(b => console.log('  실패:', b));
  await br.close(); srv.close();
  process.exit(bad.length || errs.length ? 1 : 0);
})().catch(e => { console.error(e); srv.close(); process.exit(1); });
