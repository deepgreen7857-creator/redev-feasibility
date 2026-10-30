// 한마음경매(hanmaumauction.com, 무료) — 감정평가서·매각물건명세서 PDF와 현장사진을 사건번호별 원본 폴더에 채운다 — 미니PC 전용, 개인 보관(재배포 안 함)
//  · 왜: 무료경매.kr 은 글자만 받을 수 있고(PDF·사진은 robots 금지 서버), 제이옥션은 집 IP 차단. 한마음경매는 robots 전체 허용, 파일을 자기 서버에 둠.
//  · 한계: 한마음경매 자료는 7월 초 이후 갱신이 멈춘 듯함 → 그 전에 접수된 사건만 있음. 감정평가서·사진은 바뀌지 않으니 그대로 쓰고,
//          매각물건명세서는 '한마음경매 갱신일'을 파일 이름에 붙여 옛 판일 수 있음을 표시.
//  · 대상: 원본 폴더의 무료경매·제이옥션 목록 + review 후보 중 감정평가서가 아직 없는 사건(review 먼저, 매각기일 빠른 순)
//  · 저장: <원본폴더>\<법원>\<연도>\<사건번호>\감정평가서_한마음.pdf, 매각물건명세서_한마음_<갱신일>.pdf, 사진_한마음\사진01.jpg…, 물건정보_한마음.json
//  · 사람 속도·하루 상한·막히면 멈춤(403·429·보안문자 → state/hanmaum-blocked.txt), 실패가 이어지면 30분 쉬고 이어감
//  로그인(본인이 직접): 한마음-로그인.cmd (= node src/hanmaum.js --login)   → 로그인 쿠키 state/hanmaum-cookies.json
//  보통 실행: node src/hanmaum.js   시험: node src/hanmaum.js --limit 1 --dry   한 사건: --case 2025타경1798 --court 인천지방법원
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findArchive } from './archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry'); const LOGIN = args.includes('--login'); const LIMIT = Number(arg('--limit')) || Infinity;
const cfgAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const cfg = { enabled: true, dailyMax: 120, itemSeconds: [50, 120], pageSeconds: [4, 9], photoSeconds: [1.5, 3.5], maxPhotos: 40, failStop: 6, failRests: 6, failRestMinutes: 30, recheckDays: 14, ...(cfgAll.hanmaum || {}) };
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const ARCHIVE = findArchive(env) || path.join(STATE, 'originals');
const OUT = DRY ? path.join(STATE, 'hanmaum-test') : ARCHIVE;
const kstDay = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);
const logFile = path.join(LOGS, `hanmaum-${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pause = (k) => sleep((cfg[k][0] + Math.random() * (cfg[k][1] - cfg[k][0])) * 1000);

const BASE = 'https://www.hanmaumauction.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
class Blocked extends Error {}
const blockedFile = path.join(STATE, 'hanmaum-blocked.txt');
const countFile = path.join(STATE, `hanmaum-${kstDay()}.json`);
let today = fs.existsSync(countFile) ? JSON.parse(fs.readFileSync(countFile, 'utf8')).count || 0 : 0;
const bump = () => { today++; if (!DRY) fs.writeFileSync(countFile, JSON.stringify({ count: today })); };
const lockFile = path.join(STATE, 'hanmaum.lock');
function lock() { if (fs.existsSync(lockFile)) { try { process.kill(Number(fs.readFileSync(lockFile, 'utf8')), 0); return false; } catch { /* */ } } fs.writeFileSync(lockFile, String(process.pid)); return true; }
const triedFile = path.join(STATE, 'hanmaum-tried.json'); // 사건 → 마지막으로 본 날(못 찾은 것도 recheckDays 동안 다시 안 봄)
const tried = fs.existsSync(triedFile) ? JSON.parse(fs.readFileSync(triedFile, 'utf8')) : {};
const saveTried = () => { if (!DRY) fs.writeFileSync(triedFile, JSON.stringify(tried)); };

// ── 쿠키 ──
const COOKIES = path.join(STATE, 'hanmaum-cookies.json');
let jar = fs.existsSync(COOKIES) ? JSON.parse(fs.readFileSync(COOKIES, 'utf8')) : [];
const saveJar = () => fs.writeFileSync(COOKIES, JSON.stringify(jar));
function takeCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of list) { const nv = sc.split(';')[0]; const i = nv.indexOf('='); if (i < 1) continue; const name = nv.slice(0, i).trim(); const value = nv.slice(i + 1).trim(); jar = jar.filter((c) => c.name !== name); if (value && !/deleted/.test(value)) jar.push({ name, value }); }
  if (list.length) saveJar();
}
async function get(url, { binary = false, referer = BASE + '/' } = {}) {
  const u = new URL(url, BASE); if (u.hostname !== 'www.hanmaumauction.com') throw new Error(`다른 서버는 받지 않음: ${u.hostname}`);
  const ck = jar.map((c) => `${c.name}=${c.value}`).join('; ');
  const res = await fetch(u.href, { headers: { 'User-Agent': UA, Referer: referer, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(ck ? { Cookie: ck } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(90e3) });
  takeCookies(res);
  if (res.status === 403 || res.status === 429) throw new Blocked(`HTTP ${res.status} ${u.pathname}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${u.pathname}`);
  if (binary) return { buf: Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') || '', finalUrl: res.url };
  const t = await res.text();
  if (/captcha|보안문자|자동입력\s*방지|비정상적인\s*접근|접근이\s*차단/i.test(t)) throw new Blocked(`차단/보안문자 화면 ${u.pathname}`);
  return t;
}
const textOf = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/(p|tr|li|div|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
const isPdf = (b) => b && b.subarray(0, 4).toString() === '%PDF';
const isImg = (b) => b && ((b[0] === 0xff && b[1] === 0xd8) || b.subarray(1, 4).toString() === 'PNG');
const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const loggedIn = (h) => /로그아웃/.test(h || '');

// ── 대상 ──
const courtKey = (c) => String(c || '').replace(/\s*경매[\d-]+계\s*$/, '').replace(/\s/g, '');
function targets() {
  const out = new Map(); // key 법원|사건번호 → { court, caseNo, sale, review }
  const add = (court, caseNo, sale, review) => { if (!court || !/^\d{4}타경\d+$/.test(caseNo || '')) return; const k = `${courtKey(court)}|${caseNo}`; const v = out.get(k) || { court, caseNo, sale: sale || '', review: false }; if (review) v.review = true; if (sale && (!v.sale || sale < v.sale)) v.sale = sale; out.set(k, v); };
  for (const f of ['_무료경매_목록.json', '_제이옥션_목록.json']) { try { for (const r of Object.values(JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), 'utf8')))) add(r.법원, r.사건번호, r.다음매각기일, false); } catch { /* 없음 */ } }
  try { for (const it of JSON.parse(fs.readFileSync(path.join(ROOT, '..', 'review', 'items.json'), 'utf8'))) { const m = String(it.id).match(/^(\d{4}타경\d+)/); if (m) add(String(it.court || '').replace(/\s*경매[\d-]+계\s*$/, '').trim(), m[1], '', true); } } catch { /* 없음 */ }
  const caseDir = (v) => path.join(ARCHIVE, v.court, v.caseNo.slice(0, 4), v.caseNo);
  const today0 = kstDay();
  return [...out.values()]
    .filter((v) => !(v.sale && v.sale < today0) || v.review)
    .filter((v) => { const d = caseDir(v); let has = false; try { has = fs.readdirSync(d).some((f) => /^감정평가서_.*\.pdf$/i.test(f)); } catch { /* 폴더 없음 */ } return !has; })
    .filter((v) => { const t = tried[`${courtKey(v.court)}|${v.caseNo}`]; return !t || Date.now() - t > cfg.recheckDays * 86400e3; })
    .sort((a, b) => (b.review - a.review) || String(a.sale || '9').localeCompare(String(b.sale || '9')));
}

// ── 한 사건 ──
function cardsIn(h) {
  return String(h).split(/class="card h-100 auction-card"/).slice(1).map((part) => {
    const id = (part.match(/\/auctions\/(\d+)"/) || [])[1];
    return id ? { id, text: textOf('<div ' + part.split(/class="col-md-6/)[0]).replace(/\s+/g, ' ') } : null;
  }).filter(Boolean);
}
async function grab(v) {
  const [y, num] = v.caseNo.split('타경');
  const list = await get(`/auctions?search=1&num1=${y}&num2=${num}&scale=50`, { referer: `${BASE}/auctions` });
  if (!loggedIn(list)) throw new NeedLogin();
  const want = String(v.court).replace(/\s+/g, ' ').match(/([가-힣]+지방법원)\s*([가-힣]+지원)?/) || [];
  const mine = cardsIn(list).filter((c) => {
    if (!c.text.replace(/\s/g, '').includes(v.caseNo)) return false;
    const m = c.text.match(/([가-힣]+지방법원)\s*(본원|[가-힣]+지원)/); if (!m || !want[1]) return false;
    return m[1] === want[1] && (want[2] ? m[2] === want[2] : m[2] === '본원');
  });
  tried[`${courtKey(v.court)}|${v.caseNo}`] = Date.now(); saveTried();
  if (!mine.length) { log(`${v.court} ${v.caseNo}: 한마음경매에 없음`); return 'none'; }
  const dir = path.join(OUT, v.court, y, v.caseNo); fs.mkdirSync(dir, { recursive: true });
  const got = { 감정평가서: 0, 명세서: 0, 사진: 0 };
  let k = 0;
  for (const c of mine.slice(0, 8)) {
    await pause('pageSeconds');
    const h = await get(`/auctions/${c.id}`, { referer: `${BASE}/auctions` });
    if (!h) continue;
    const upd = ((h.match(/최종 업데이트:\s*(\d{4}-\d{2}-\d{2})/) || [])[1]) || 'unknown';
    const t = textOf(h);
    if (!t.replace(/\s/g, '').includes(v.caseNo)) continue;
    const itemNo = (t.match(/물건번호\s*[:：]?\s*(\d+)/) || [])[1] || String(++k);
    const idir = path.join(dir, itemNo); fs.mkdirSync(idir, { recursive: true });
    fs.writeFileSync(path.join(idir, '물건정보_한마음.json'), JSON.stringify({ 출처: '한마음경매(hanmaumauction.com) — 개인 보관용, 재배포 금지', 한마음번호: c.id, 한마음갱신일: upd, 받은날: kstDay(), 화면글자: t.slice(0, 20000) }, null, 1));
    // PDF: 감정평가서(사건 공통) · 매각물건명세서(물건별, 갱신일 표시)
    for (const m of h.matchAll(/href="([^"]*\/auctions\/\d+\/pdfs\/\d+\/download)"[\s\S]{0,600}?(감정평가서|매각물건명세서|현황조사서)/g)) {
      const kind = m[2];
      const f = kind === '감정평가서' ? path.join(dir, '감정평가서_한마음.pdf') : kind === '매각물건명세서' ? path.join(idir, `매각물건명세서_한마음_${upd}갱신.pdf`) : path.join(dir, '현황조사서_한마음.pdf');
      if (exists(f)) continue;
      await pause('pageSeconds');
      const r = await get(m[1].replace(/&amp;/g, '&'), { binary: true, referer: `${BASE}/auctions/${c.id}` });
      if (r && isPdf(r.buf)) { fs.writeFileSync(f, r.buf); if (kind === '감정평가서') got.감정평가서++; else got.명세서++; }
    }
    // 사진(사건 공통, 처음 한 번만)
    const pdir = path.join(dir, '사진_한마음');
    if (!fs.existsSync(pdir) || !fs.readdirSync(pdir).length) {
      const imgs = [...new Set([...h.matchAll(/\/storage\/auctions\/\d+\/[A-Za-z0-9_-]+\.(?:jpe?g|png)/g)].map((x) => x[0]))].slice(0, cfg.maxPhotos);
      fs.mkdirSync(pdir, { recursive: true }); let n = 0;
      for (const src of imgs) { await pause('photoSeconds'); const r = await get(src, { binary: true, referer: `${BASE}/auctions/${c.id}` }); if (r && isImg(r.buf)) fs.writeFileSync(path.join(pdir, `사진${String(++n).padStart(2, '0')}${/png/i.test(src) ? '.png' : '.jpg'}`), r.buf); }
      got.사진 = n;
    }
  }
  log(`${v.court} ${v.caseNo}${v.review ? ' [review]' : ''}: 감정평가서 ${got.감정평가서 ? 'O' : (exists(path.join(dir, '감정평가서_한마음.pdf')) ? 'O' : 'X')} · 명세서 ${got.명세서}건 · 사진 ${got.사진}장`);
  return 'ok';
}
class NeedLogin extends Error { constructor() { super('한마음경매 로그인 필요 — 미니PC에서 한마음-로그인.cmd 를 실행해 직접 로그인하세요'); } }

async function loginMode() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
  const { chromium } = await import('playwright');
  // 창이 다른 창 뒤에 숨지 않게 화면 가득 띄우고 맨 앞으로(10/30 로그인 창을 못 찾음). 프로필이 잠겨 있으면 새 폴더로
  const prof = path.join(STATE, 'hanmaum-login-profile'); // 앞 창이 아직 떠 있어도 겹치지 않게 따로
  const ctx = await chromium.launchPersistentContext(prof, { headless: false, locale: 'ko-KR', viewport: null, args: ['--start-maximized'] });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${BASE}/login`).catch(() => {});
  await page.bringToFront().catch(() => {});
  await page.evaluate(() => { document.title = '★ 여기서 한마음경매 로그인 ★ ' + document.title; }).catch(() => {});
  log('한마음경매 창에서 직접 로그인하세요. 로그인되면 저장하고 창이 저절로 닫힙니다(최대 30분).');
  let closed = false; ctx.on('close', () => { closed = true; });
  try {
    for (let i = 0; i < 600 && !closed; i++) {
      await sleep(3000);
      const ok = await page.evaluate(() => /로그아웃/.test(document.body?.innerText || '')).catch(() => false);
      if (ok) { jar = (await ctx.cookies()).filter((c) => c.domain.includes('hanmaumauction')).map(({ name, value }) => ({ name, value })); saveJar(); log(`로그인 확인 — ${jar.length}개 저장`); return; }
    }
    log(closed ? '로그인 전에 창이 닫혔습니다.' : '30분 동안 로그인이 안 돼 끝냅니다.');
  } finally { await ctx.close().catch(() => {}); }
}

async function main() {
  if (LOGIN) return loginMode();
  if (!cfg.enabled) return log('config.json hanmaum.enabled=false — 쉼');
  if (fs.existsSync(blockedFile)) return log(`멈춤 상태(${blockedFile}) — 한마음경매 화면을 확인한 뒤 이 파일을 지우면 다시 받음`);
  if (!lock()) return log('이미 다른 한마음 수집기가 돌고 있음');
  let n = 0;
  try {
    if (today >= cfg.dailyMax) return log('오늘 한도 — 내일 이어서');
    let todo = targets();
    if (arg('--case')) todo = [{ court: arg('--court') || '인천지방법원', caseNo: arg('--case'), sale: '', review: true }];
    log(`시작 — 감정평가서 없는 사건 ${todo.length}건, 오늘 ${today}/${cfg.dailyMax}`);
    let failRun = 0; let rests = 0; let k0 = 0;
    for (const v of todo) {
      if (n >= LIMIT || today >= cfg.dailyMax) break;
      if (k0++ > 0) await pause('itemSeconds'); // 찾기만 하고 없던 사건 뒤에도 쉼(10/30 처음 몇 건이 1초 간격으로 돌았음)
      try { const rc = await grab(v); if (rc === 'ok') { n++; bump(); } failRun = 0; } catch (e) {
        if (e instanceof Blocked || e instanceof NeedLogin) throw e;
        log(`${v.caseNo}: 실패 ${e.cause?.code || ''} ${e.message}`);
        if (++failRun >= cfg.failStop) { if (++rests > cfg.failRests) { log('쉬어도 실패가 계속됨 — 다음 예약 실행 때 이어서'); break; } log(`연달아 실패 — ${cfg.failRestMinutes}분 쉬고 이어감(우회 없음)`); await sleep(cfg.failRestMinutes * 60e3); failRun = 0; }
      }
    }
  } catch (e) {
    if (e instanceof Blocked) { fs.writeFileSync(blockedFile, `${new Date().toISOString()} ${e.message}\n`); log(`막힘 — 우회하지 않고 멈춤: ${e.message}`); }
    else log(`${e instanceof NeedLogin ? '로그인 필요' : '오류'}: ${e.message}`);
  } finally { try { fs.unlinkSync(lockFile); } catch { /* */ } log(`끝 — 이번에 ${n}사건`); }
}
await main();
