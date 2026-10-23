// 등기부 열람본 자동 자료화 — 미니PC 전용, 관리자 혼자 보는 자료
//  서버에서 '지금 경매 중인 법원 물건 중 열람본이 아직 없는 것'을 받아(입찰일 가까운 순),
//  마이옥션에서 사건번호로 찾아 물건마다 붙은 등기부(건물·토지·집합건물) 열람본 PDF를 받는다.
//  PDF 원본은 이 PC에 보관하고, 정리한 갑구·을구·요약만 서버(관리자 전용 모음)로 보낸다.
//
//  처음 한 번:  npm run myauction-login   → 뜬 창에서 마이옥션 로그인 후 창을 닫는다(로그인 상태가 이 PC에 남음)
//  보통 실행:   node src/registry.js       (작업 스케줄러: start-registry.cmd)
//  시험:        node src/registry.js --limit 2 --dry      (서버에 안 보냄, 정리 결과는 state/registry-test.json)
//               node src/registry.js --case 2024타경571 --court 인천지방법원 --dry
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pdfRows, parseRegistry, plainText } from './registryParse.js';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
const { chromium } = await import('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');
const LOGIN = args.includes('--login');
const LIMIT = Number(arg('--limit')) || Infinity;

const cfgAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const cfg = {
  enabled: true,
  dailyMax: 120, // 하루 물건 수(물건 하나에 화면 3~4개)
  itemSeconds: [50, 120], // 물건 사이 쉬는 시간(초, 무작위)
  pageSeconds: [3, 8], // 한 물건 안에서 화면 사이
  longBreakEvery: 15, longBreakSeconds: [300, 900],
  allowedHours: [[8, 23]],
  headless: true,
  ...(cfgAll.registry || {}),
};
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
const PROFILE = path.join(STATE, 'myauction-profile');
const PDF_DIR = env.REGISTRY_DIR || cfg.dir || path.join(STATE, 'registry');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true }); fs.mkdirSync(PDF_DIR, { recursive: true });
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDay = () => kstNow().toISOString().slice(0, 10);
const logFile = path.join(LOGS, `registry-${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([a, b]) => a + Math.random() * (b - a);
const BASE = 'https://www.my-auction.co.kr';

// ── 서버 ──────────────────────────────────────────────
const RETRY_WAITS = [30, 60, 120];
async function api(body) {
  if (!env.INGEST_URL || !env.INGEST_TOKEN) { const e = new Error('.env 에 INGEST_URL, INGEST_TOKEN 이 없습니다'); e.retry = false; throw e; }
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(env.INGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INGEST_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(120e3) });
      const t = await res.text();
      if (!res.ok) { const e = new Error(`서버 HTTP ${res.status} ${t.slice(0, 200)}`); e.retry = res.status >= 500 || res.status === 429; throw e; }
      return JSON.parse(t || '{}');
    } catch (e) {
      if (e.retry === false || i >= RETRY_WAITS.length) throw e;
      log(`${e.message} — ${RETRY_WAITS[i]}초 뒤 다시(${i + 1}/${RETRY_WAITS.length})`);
      await sleep(RETRY_WAITS[i] * 1000);
    }
  }
}

// ── 하루 한도·시간대·잠금 ─────────────────────────────
const countFile = path.join(STATE, `registry-${kstDay()}.json`);
let today = fs.existsSync(countFile) ? JSON.parse(fs.readFileSync(countFile, 'utf8')).count || 0 : 0;
const bump = () => { today++; fs.writeFileSync(countFile, JSON.stringify({ count: today })); };
const inHours = () => { const h = kstNow().getUTCHours(); return cfg.allowedHours.some(([a, b]) => h >= a && h < b); };
const lockFile = path.join(STATE, 'registry.lock');
function takeLock() {
  try { const pid = Number(fs.readFileSync(lockFile, 'utf8')); if (pid && pid !== process.pid) { try { process.kill(pid, 0); log(`이미 다른 등기부 수집기(pid ${pid})가 돌고 있어 이번 실행은 하지 않음`); return false; } catch { /* 죽은 잠금 */ } } } catch { /* 없음 */ }
  fs.writeFileSync(lockFile, String(process.pid)); return true;
}
const releaseLock = () => { try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch { /* 없음 */ } };

// ── 마이옥션 ──────────────────────────────────────────
class NeedLogin extends Error {}

async function loggedIn(page) {
  await page.goto(`${BASE}/main/main.php`, { waitUntil: 'domcontentloaded', timeout: 60e3 });
  return page.locator('a:has-text("로그아웃")').first().isVisible({ timeout: 10e3 }).catch(() => false);
}

// 마이옥션 로그인 쿠키는 브라우저를 닫으면 사라지는 '세션 쿠키'라 프로필만으로는 안 남는다
//  → 로그인된 쿠키를 파일로 저장해 두고, 돌 때마다 다시 넣는다(세션 쿠키는 30일 만료로 바꿔 넣음)
const COOKIES = path.join(STATE, 'myauction-cookies.json');
async function saveCookies(ctx) {
  const list = (await ctx.cookies()).filter((c) => /my-auction|nuriauction/.test(c.domain));
  if (list.length) fs.writeFileSync(COOKIES, JSON.stringify(list));
  return list.length;
}
async function loadCookies(ctx) {
  if (!fs.existsSync(COOKIES)) return 0;
  const until = Math.floor(Date.now() / 1000) + 30 * 86400;
  const list = JSON.parse(fs.readFileSync(COOKIES, 'utf8')).map((c) => (c.expires === -1 || !c.expires ? { ...c, expires: until } : c));
  await ctx.addCookies(list).catch(() => {});
  return list.length;
}

// 법원 이름 → 마이옥션 목록에 찍히는 이름(지원은 '부천지원'처럼 지원 이름만)
const courtKey = (court) => String(court || '').trim().split(/\s+/).pop();

async function findView(page, item) {
  const m = String(item.caseNo).replace(/\s/g, '').match(/^(\d{4})타경(\d+)$/);
  if (!m) return { miss: 'caseNo' };
  const [, y, n] = m;
  const q = `npls=N&spels=Y&schs=N&pchs=N&stc=1&ipdate1=&ipdate2=&eprice1=0&eprice2=0&sno=${y}&tno=${n}&mprice1=0&mprice2=0&apoint1=0&apoint2=0&aorder=1`;
  await page.goto(`${BASE}/auction/search_list.php?${q}`, { waitUntil: 'domcontentloaded', timeout: 60e3 });
  const rows = await page.$$eval('tr', (trs) => trs.filter((t) => t.querySelector('a[href^="/view/"]'))
    .map((t) => ({ view: t.querySelector('a[href^="/view/"]').getAttribute('href'), label: t.innerText.replace(/\s+/g, ' ') })));
  const key = courtKey(item.court);
  const re = new RegExp(`${y}-${n}(?:\\((\\d+)\\))?(?!\\d)`);
  const hit = rows.find((r) => {
    const mm = r.label.match(re);
    if (!mm) return false;
    if ((mm[1] || '1') !== String(item.itemNo || '1')) return false;
    return r.label.includes(key) || r.label.includes(key.replace(/지방법원$/, ''));
  });
  return hit ? { view: hit.view.replace(/\D/g, '') } : { miss: rows.length ? 'court' : 'notFound' };
}

async function registryLinks(page, view) {
  await page.goto(`${BASE}/view/${view}`, { waitUntil: 'domcontentloaded', timeout: 60e3 });
  await page.waitForSelector('a[href^="javascript:pop_detail"]', { timeout: 15e3 }).catch(() => {});
  return page.$$eval('a[href^="javascript:pop_detail"]', (as) => as
    .map((a) => ({ label: a.textContent.replace(/\s+/g, '').replace(/New$/, ''), m: a.getAttribute('href').match(/pop_detail\('([^']+)'\s*,\s*'(\d+)'\)/) }))
    .filter((x) => x.m && /등기부/.test(x.label)).map((x) => ({ label: x.label, type: x.m[1] })));
}

async function fetchPdf(page, view, type) {
  await page.goto(`${BASE}/auction/auction_detail_view.php?type=${type}&idx=${view}`, { waitUntil: 'domcontentloaded', timeout: 60e3 });
  const src = await page.$eval('iframe', (f) => f.src).catch(() => null);
  if (!src) throw new Error('열람본 창에 PDF가 없음');
  const res = await page.context().request.get(src, { headers: { Referer: page.url() }, timeout: 60e3 });
  const buf = await res.body();
  if (!res.ok() || buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error(`PDF가 아님(HTTP ${res.status()})`);
  return buf;
}

const kindOf = (label, parsed) => parsed.kind || (label.match(/\((건물|토지|집합건물)\)/) || [])[1] || label;
const fileSafe = (s) => String(s).replace(/[\\/:*?"<>|\s]/g, '');

async function processItem(page, item) {
  const found = await findView(page, item);
  if (found.miss) return { miss: found.miss };
  await sleep(rand(cfg.pageSeconds) * 1000);
  const links = await registryLinks(page, found.view);
  if (!links.length) return { miss: 'noRegistry', view: found.view };
  const docs = [];
  for (const l of links) {
    await sleep(rand(cfg.pageSeconds) * 1000);
    const buf = await fetchPdf(page, found.view, l.type);
    const pages = await pdfRows(buf);
    const parsed = parseRegistry(pages);
    const kind = kindOf(l.label, parsed);
    const file = path.join(PDF_DIR, `${fileSafe(item.id)}_${fileSafe(kind)}_${fileSafe(l.type)}.pdf`);
    fs.writeFileSync(file, buf);
    docs.push({
      listingId: item.id, kind, label: l.label, source: 'myauction', sourceView: found.view, sourceType: l.type,
      title: parsed.title, uniqueNo: parsed.uniqueNo, address: parsed.address, viewedAt: parsed.viewedAt,
      sections: parsed.sections, summary: parsed.summary, flags: parsed.flags,
      text: plainText(pages).slice(0, 200000), pdf: { bytes: buf.length, file: path.basename(file) }, fetchedAt: new Date().toISOString(),
    });
  }
  return { docs, view: found.view };
}

async function main() {
  if (!cfg.enabled && !DRY) { log('config.json registry.enabled 가 false — 실행하지 않음'); return; }
  const ctx = await chromium.launchPersistentContext(PROFILE, { headless: LOGIN ? false : cfg.headless !== false, locale: 'ko-KR', viewport: { width: 1366, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  const stats = { targets: 0, saved: 0, files: 0, missed: 0, errors: 0, stoppedBy: null };
  try {
    if (LOGIN) {
      await page.goto(`${BASE}/main/main.php`);
      log('마이옥션 창에서 로그인하세요("자동로그인"이 있으면 체크). 로그인되면 저장하고 창이 저절로 닫힙니다.');
      let closed = false; ctx.on('close', () => { closed = true; });
      for (let i = 0; i < 600 && !closed; i++) { // 최대 30분 기다림
        await sleep(3000);
        const ok = await page.evaluate(() => /로그아웃/.test(document.body?.innerText || '')).catch(() => false);
        if (ok) { const n = await saveCookies(ctx); log(`로그인 확인 — 로그인 정보 ${n}개 저장. 이제 npm run registry-test 로 시험하세요.`); return; }
      }
      log(closed ? '로그인 전에 창이 닫혔습니다. 다시 npm run myauction-login 하세요.' : '30분 동안 로그인이 안 돼 끝냅니다.');
      return;
    }
    await loadCookies(ctx);
    if (!(await loggedIn(page))) throw new NeedLogin('마이옥션 로그인이 풀려 있음 — 미니PC에서 npm run myauction-login 으로 한 번 로그인하세요');
    await saveCookies(ctx); // 사이트가 쿠키를 새로 주면 그걸로 바꿔 둔다

    let targets;
    if (arg('--case')) targets = [{ id: `court_${String(arg('--court') || '').replace(/\s/g, '')}_${arg('--case')}_${arg('--item') || 1}`, court: arg('--court') || '', caseNo: arg('--case'), itemNo: arg('--item') || '1' }];
    else targets = (await api({ action: 'registryTargets', limit: Math.min(LIMIT, Math.max(0, cfg.dailyMax - today), 200) })).items || [];
    stats.targets = targets.length;
    log(`등기부 대상 ${targets.length}건 (오늘 ${today}/${cfg.dailyMax})`);

    let sinceBreak = 0;
    for (const [i, item] of targets.entries()) {
      if (i >= LIMIT) { stats.stoppedBy = 'test-limit'; break; }
      if (!DRY && today >= cfg.dailyMax) { stats.stoppedBy = 'limit'; log('오늘 한도 도달'); break; }
      if (!DRY && !inHours()) { stats.stoppedBy = 'hours'; log('도는 시간대가 끝남'); break; }
      if (i > 0) {
        await sleep(rand(cfg.itemSeconds) * 1000);
        if (++sinceBreak >= cfg.longBreakEvery) { const s = rand(cfg.longBreakSeconds); log(`잠깐 쉼 ${Math.round(s)}초`); await sleep(s * 1000); sinceBreak = 0; }
      }
      try {
        const r = await processItem(page, item);
        if (!DRY) bump();
        if (r.miss) {
          stats.missed++;
          log(`없음(${r.miss}): ${item.court} ${item.caseNo}(${item.itemNo || 1})`);
          if (!DRY) await api({ action: 'registryMiss', id: item.id, reason: r.miss });
          continue;
        }
        stats.files += r.docs.length;
        const brief = r.docs.map((d) => `${d.kind} 열람 ${d.viewedAt || '?'} 살아있는 기록 ${d.flags?.liveCount ?? '?'}건`).join(' / ');
        if (DRY) {
          fs.writeFileSync(path.join(STATE, 'registry-test.json'), JSON.stringify(r.docs, null, 2));
          log(`(시험) ${item.caseNo}: ${brief} — 정리 결과 state/registry-test.json`);
        } else {
          const out = await api({ action: 'registry', items: r.docs });
          stats.saved++;
          log(`저장: ${item.court} ${item.caseNo}(${item.itemNo || 1}) ${brief} ${JSON.stringify(out)}`);
        }
      } catch (e) {
        if (e instanceof NeedLogin || e.retry === false) throw e;
        stats.errors++;
        log(`오류: ${item.caseNo} — ${e.message}`);
        if (stats.errors >= 5 && stats.errors > stats.saved) { stats.stoppedBy = 'errors'; log('오류가 잦아 이번 회차는 멈춤'); break; }
      }
    }
  } catch (e) {
    stats.stoppedBy = e instanceof NeedLogin ? 'login' : 'error';
    log(`${e instanceof NeedLogin ? '로그인 필요' : '오류'}: ${e.message}`);
  } finally {
    await ctx.close().catch(() => {});
    if (!LOGIN) {
      log(`끝: ${JSON.stringify(stats)}`);
      if (!DRY) await api({ action: 'registryState', run: { ...stats, at: new Date().toISOString(), today } }).catch((e) => log(`상태 보고 실패: ${e.message}`));
    }
  }
}

if (!LOGIN && !DRY && !takeLock()) process.exit(0);
process.on('exit', releaseLock);
main().catch((e) => { log(`실행 오류: ${e.stack || e.message}`); process.exitCode = 1; });
