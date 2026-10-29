// 제이옥션(gfauction.co.kr, 무료경매사이트) 자료를 사건번호별로 모아 원본 보관 하드에 데이터베이스로 쌓는다 — 미니PC 전용, 본인만 보는 자료
//  · 대상: config.json 의 집중 지역(가좌동·석남동) 진행 물건 + jbslab.co.kr/review 후보(저장소 review/items.json). 그 밖은 긁지 않는다.
//  · 받는 것(사건마다): 감정평가서 PDF, 매각물건명세서 PDF(물건번호별), 현황조사서·문건접수내역·송달내역(글자+화면 HTML), 현장사진 전부, 물건 기본정보
//  · 사람 속도: 사건 사이 60~150초, 화면 사이 3~8초, 사진 사이 1~3초, 하루 40사건, 08~23시. 다 받은 사건은 7일 뒤 빠진 것만 다시 봄
//  · 막히면(403·429·보안문자·차단 화면) 우회하지 않고 멈춘다 → state/jauction-blocked.txt (확인 후 지우면 재개)
//  · 저장 위치: <원본폴더>\<법원>\<연도>\<사건번호>\  (법원 수집기·등기부와 같은 자리, 파일 이름 끝에 _제이옥션)
//      감정평가서_제이옥션.pdf, 현황조사서_제이옥션.txt/.html, 문건접수내역_제이옥션.txt, 송달내역_제이옥션.txt,
//      사진_제이옥션\사진01.jpg …, <물건번호>\매각물건명세서_제이옥션.pdf, <물건번호>\물건정보_제이옥션.json
//    목록(데이터베이스): <원본폴더>\_제이옥션_목록.csv (엑셀로 열림) + _제이옥션_목록.json
//    원본폴더는 archive.js 가 찾음(표식 파일 경매원본표식.txt 가 있는 외장하드). 기준은 대법원 원본이고 이것은 참고 자료.
//  · 사이트(서버)에는 올리지 않는다.
//
//  보통 실행:  node src/jauction.js          (작업 스케줄러: start-jauction.cmd)
//  처음 한 번:  npm run jauction-login   → 뜬 창에서 제이옥션 로그인(본인이 직접) → 로그인되면 저장하고 창이 저절로 닫힘
//              (제이옥션은 회원만 상세·감정평가서·사진을 보여 준다. 로그인 쿠키는 state/jauction-cookies.json)
//  지금 시작:  npm run jauction-now        (시간대 제한 없이 바로, 하루 40사건·사람 속도는 그대로)
//  시험:       node src/jauction.js --limit 1 --dry     (1사건만, state/jauction-test 에 저장, 시간대 제한 없음)
//              node src/jauction.js --case 2026타경503672
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findArchive } from './archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');
const LOGIN = args.includes('--login');
const NOW = args.includes('--now'); // 손으로 '지금 시작'할 때: 시간대 제한만 건너뜀(하루 한도·속도는 그대로)
const anyHour = DRY || NOW;
const LIMIT = Number(arg('--limit')) || Infinity;

const cfgAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const cfg = {
  enabled: true, dailyMax: 40, itemSeconds: [60, 150], pageSeconds: [3, 8], photoSeconds: [1, 3], allowedHours: [[8, 23]],
  refreshDays: 7, retryMissingDays: 3, aheadDays: 75, maxListPages: 15,
  // 제이옥션 지역 코드: 인천(12) 서구(267) 가좌동(5717)·석남동(5723)
  areas: [{ name: '가좌동', a1: '12', a2: '267', a3: '5717' }, { name: '석남동', a1: '12', a2: '267', a3: '5723' }],
  ...(cfgAll.jauction || {}),
};
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const ARCHIVE = DRY ? path.join(STATE, 'jauction-test') : (findArchive(env) || path.join(STATE, 'originals'));
fs.mkdirSync(ARCHIVE, { recursive: true });
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDay = (plus = 0) => new Date(kstNow().getTime() + plus * 86400e3).toISOString().slice(0, 10);
const logFile = path.join(LOGS, `jauction-${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([a, b]) => a + Math.random() * (b - a);
const pause = (k) => sleep(rand(cfg[k]) * 1000);
// 돌고 있는 중에도 config.json 의 속도·한도를 다시 읽는다(창을 껐다 켜지 않아도 바뀐 설정이 바로 적용)
function reloadCfg() {
  try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).jauction || {}; for (const k of ['dailyMax', 'itemSeconds', 'pageSeconds', 'photoSeconds', 'allowedHours', 'skipUse']) if (j[k] !== undefined) cfg[k] = j[k]; } catch { /* 고치는 중이면 다음에 */ }
}
const stopFile = path.join(STATE, 'jauction-stop.txt'); // 이 파일이 생기면 지금 사건을 마치고 멈춤
// 동산(자동차·중기·선박 등)은 받지 않는다 — 부동산만
const MOVABLE = /자동차|차량|승용|승합|화물차|트럭|버스|오토바이|이륜|중기|건설기계|굴착기|지게차|선박|어선|항공기|유체동산|기계기구|광업권|어업권/;
const skipFile = path.join(STATE, 'jauction-skip.json');
const skip = new Set(fs.existsSync(skipFile) ? JSON.parse(fs.readFileSync(skipFile, 'utf8')) : []);
const saveSkip = () => fs.writeFileSync(skipFile, JSON.stringify([...skip]));

const BASE = 'https://gfauction.co.kr';
const FILES = 'https://file2.nuriauction.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
class Blocked extends Error {}
class NeedLogin extends Error {}

// ── 로그인 쿠키(제이옥션은 회원만 상세를 보여 줌) ─────
//  npm run jauction-login 으로 본인이 한 번 로그인 → 쿠키를 파일로 저장 → fetch 마다 넣고, 새로 받은 쿠키로 갱신
const COOKIES = path.join(STATE, 'jauction-cookies.json');
let jar = fs.existsSync(COOKIES) ? JSON.parse(fs.readFileSync(COOKIES, 'utf8')) : []; // [{name,value,domain,path}]
const saveJar = () => fs.writeFileSync(COOKIES, JSON.stringify(jar));
const cookieFor = (url) => { const h = new URL(url).hostname; return jar.filter((c) => h === c.domain.replace(/^\./, '') || h.endsWith(c.domain.startsWith('.') ? c.domain : '.' + c.domain)).map((c) => `${c.name}=${c.value}`).join('; '); };
function takeCookies(url, res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (!list.length) return;
  const host = new URL(url).hostname;
  for (const sc of list) {
    const [nv, ...attrs] = sc.split(';'); const i = nv.indexOf('='); if (i < 1) continue;
    const name = nv.slice(0, i).trim(); const value = nv.slice(i + 1).trim();
    const dom = (attrs.map((a) => a.trim()).find((a) => /^domain=/i.test(a)) || '').slice(7) || host;
    const del = /deleted|^$/.test(value) || attrs.some((a) => /max-age=0/i.test(a));
    jar = jar.filter((c) => !(c.name === name && c.domain.replace(/^\./, '') === dom.replace(/^\./, '')));
    if (!del) jar.push({ name, value, domain: dom, path: '/' });
  }
  saveJar();
}
const needLoginText = (t) => /무료 회원가입 후 주식회사 제이옥션의 경매정보/.test(t);

// ── 하루 한도·시간대·잠금·멈춤 ────────────────────────
const blockedFile = path.join(STATE, 'jauction-blocked.txt');
const countFile = path.join(STATE, `jauction-${kstDay()}.json`);
let today = fs.existsSync(countFile) ? JSON.parse(fs.readFileSync(countFile, 'utf8')).count || 0 : 0;
const bump = () => { today++; fs.writeFileSync(countFile, JSON.stringify({ count: today })); };
const inHours = () => { const h = kstNow().getUTCHours(); return cfg.allowedHours.some(([a, b]) => h >= a && h < b); };
const lockFile = path.join(STATE, 'jauction.lock');
function lock() {
  if (fs.existsSync(lockFile)) { const pid = Number(fs.readFileSync(lockFile, 'utf8')); try { process.kill(pid, 0); return false; } catch { /* 죽은 잠금 */ } }
  fs.writeFileSync(lockFile, String(process.pid)); return true;
}

// ── 목록(데이터베이스) ────────────────────────────────
const dbFile = path.join(ARCHIVE, '_제이옥션_목록.json');
const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : {}; // key: 법원_사건번호
function saveDb() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
  const cols = ['법원', '사건번호', '물건번호', '용도', '주소', '다음매각기일', '명세서공개일', '감정평가서', '매각물건명세서', '명세서변경', '현황조사서', '문건접수', '송달', '사진수', '마지막확인', '폴더'];
  const esc = (v) => { const s = Array.isArray(v) ? v.join(' ') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = Object.values(db).sort((a, b) => String(a.다음매각기일 || '9').localeCompare(String(b.다음매각기일 || '9'))).map((r) => cols.map((c) => esc(r[c])).join(','));
  fs.writeFileSync(path.join(ARCHIVE, '_제이옥션_목록.csv'), '\uFEFF' + [cols.join(','), ...rows].join('\r\n'));
}

// 이 물건을 이미 받았나: light 면 명세서·현황조사서까지, 아니면 전부(_full). 덜 받은 것은 3일 뒤 다시
// 매각기일 1주 전(명세서 공개일)이 지났는데 그 전에 받은 명세서뿐이면 다시 받아야 함(노트북 690e7a4)
const specDue = (r) => { const od = openDayOf(r.다음매각기일); return !!(od && kstDay() >= od && kstDay() <= r.다음매각기일 && Object.values(r.명세서받은날 || { x: '' }).some((d) => !d || d < od)); };
function doneFor(idx, light) {
  return Object.values(db).some((r) => (r.idx || []).includes(idx) && !specDue(r) && (
    (light ? r._완료 || r._full : r._full || (r._완료 && !r._light)) ? Date.now() - r._at < cfg.refreshDays * 86400e3 : Date.now() - r._at < cfg.retryMissingDays * 86400e3));
}

// ── 제이옥션 ──────────────────────────────────────────
async function get(url, { binary = false, referer = BASE + '/' } = {}) {
  const ck = cookieFor(url);
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: referer, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(ck ? { Cookie: ck } : {}) }, signal: AbortSignal.timeout(90e3) });
  takeCookies(url, res);
  if (res.status === 403 || res.status === 429) throw new Blocked(`HTTP ${res.status} ${url.split('?')[0]}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.split('?')[0]}`);
  if (binary) return Buffer.from(await res.arrayBuffer());
  const t = await res.text();
  if (/captcha|보안문자|자동입력\s*방지|비정상적인\s*접근|접근이\s*차단/i.test(t)) throw new Blocked(`차단/보안문자 화면 ${url.split('?')[0]}`);
  // 상세 화면이 '회원가입 후 이용' 안내만 돌려주면 로그인이 풀린 것(목록은 로그인 없이도 이 안내가 칸마다 붙으므로 상세에서만 판단)
  if (/detail_view\.php/.test(url) && t.length < 2000 && needLoginText(t)) throw new NeedLogin('제이옥션 로그인이 풀려 있음 — 미니PC에서 npm run jauction-login 으로 한 번 로그인하세요');
  return t;
}
const textOf = (h) => String(h || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|tr|li|h\d|div)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// 물건 번호(idx): 로그인 상태면 detail_view 링크, 아니면 목록 체크박스(aChk) 값에만 있다
const idsIn = (h) => [...new Set([...String(h).matchAll(/detail_view\.php\?idx=(\d+)|name=["']?aChk["']?[^>]*value=["']?(\d+)/g)].map((m) => m[1] || m[2]))];
/** 목록 화면의 물건 줄: idx·줄 글자(주소 포함)·매각기일 */
function rowsIn(h) {
  const out = [];
  for (const part of String(h).split(/<tr[\s>]/i).slice(1)) {
    const m = part.match(/name=["']?aChk["']?[^>]*value=["']?(\d+)/) || part.match(/detail_view\.php\?idx=(\d+)/);
    if (!m) continue;
    const t = textOf('<tr>' + part.split(/<\/tr>/i)[0]);
    const d = (t.match(/(\d{4})[.-](\d{2})[.-](\d{2})/) || []);
    out.push({ idx: m[1], text: t, sale: d[0] ? `${d[1]}-${d[2]}-${d[3]}` : '' });
  }
  return out;
}

/** 검토 범위(1단계): config.json jauction.scope — 용도·최저가 상한·시도로 검색해 매각기일 빠른 순으로 모음
 *  돌려줌: Map idx → { src, sale, light } (light=true 는 명세서·현황조사서만) */
async function collectScope() {
  const out = new Map();
  const days = cfg.scopeDays || 45;
  for (const sc of cfg.scope || []) {
    const addrRe = sc.addr ? new RegExp(sc.addr) : null;
    for (const sido of sc.sido || []) {
      let before = -1; let n0 = out.size;
      for (let page = 1; page <= (sc.pages || 80); page++) {
        const q = new URLSearchParams({ stc: '1', address1_01: sido, address1_02: '', address1_03: '', usage_codes: sc.usage, mprice2: String(sc.mprice2), ipdate1: kstDay(), ipdate2: kstDay(days), aorder: 'a.appoint_result_date', page: String(page) });
        const h = await get(`${BASE}/search/search_list.php?${q}`);
        const rows = rowsIn(h);
        for (const r of rows) {
          if (out.has(r.idx)) continue;
          if (addrRe && !addrRe.test(r.text)) continue;
          out.set(r.idx, { src: `범위:${sc.name}`, sale: r.sale, light: true });
        }
        const seen = rows.length ? rows.map((r) => r.idx).join(',') : '';
        if (!rows.length || seen === before) break; before = seen;
        await pause('pageSeconds');
      }
      log(`${sc.name} (시도 ${sido}) — ${out.size - n0}건`);
    }
  }
  // review 후보: 전부 받음(가볍게 받아 둔 것도 채움)
  const file = path.join(ROOT, '..', 'review', 'items.json');
  if (fs.existsSync(file)) {
    const cases = [...new Set(JSON.parse(fs.readFileSync(file, 'utf8')).map((it) => (String(it.id).match(/^(\d{4})타경(\d+)/) || []).slice(1, 3).join('|')).filter((x) => x.includes('|')))];
    let k = 0;
    for (const c of cases) {
      const [y, num] = c.split('|');
      const done = Object.values(db).some((r) => r.사건번호 === `${y}타경${num}` && r._full && Date.now() - (r._at || 0) < cfg.refreshDays * 86400e3);
      if (done) continue;
      await pause('pageSeconds');
      for (const r of rowsIn(await get(`${BASE}/search/search_list.php?stc=1&sno=${y}&tno=${num}`))) { out.set(r.idx, { src: 'review', sale: r.sale || (out.get(r.idx) || {}).sale || '', light: false }); k++; }
    }
    log(`review 후보(전부 받음) — ${k}건`);
  }
  return out;
}

const courtBase = (c) => String(c).replace(/\s*경매[\d-]+계\s*$/, '').trim();
const view = (type, idx) => get(`${BASE}/search/auction_detail_view.php?type=${encodeURIComponent(type)}&idx=${idx}`, { referer: `${BASE}/search/detail_view.php?idx=${idx}` });

// 팝업 머리 이후 본문만 (메뉴 글자 제거)
const bodyAfterMenu = (t) => { const i = t.indexOf('acrobat reader 설치'); return (i >= 0 ? t.slice(i + 'acrobat reader 설치'.length) : t).trim(); };

/** 대상 물건 idx 모으기: 집중 지역 진행 물건 + review 후보(사건번호 검색) */
async function collectIdx() {
  // 지역 코드 찾기용: 검색 화면을 한 번 저장해 둔다(서울·경기 코드를 config.json jauction.areas 에 넣을 때 봄)
  const areaPage = path.join(STATE, 'jauction-search-page.html');
  if (!fs.existsSync(areaPage)) { try { fs.writeFileSync(areaPage, await get(`${BASE}/search/search01.php`)); } catch { /* */ } await pause('pageSeconds'); }
  const out = new Map(); // idx → 출처
  // 지역 목록은 하루 한 번만 훑는다(같은 날 다음 실행은 저장해 둔 목록을 씀 — 서울·경기 목록은 수백 화면이라)
  // 2일 안에 훑은 목록이 있으면 그것을 씀(서울·경기 목록은 수백 화면이라 매번 훑지 않음)
  const listFile = path.join(STATE, `jauction-list-${kstDay()}.json`);
  const recent = [kstDay(), kstDay(-1), kstDay(-2)].map((d) => path.join(STATE, `jauction-list-${d}.json`)).find((f) => fs.existsSync(f));
  if (recent) {
    for (const [id, src] of JSON.parse(fs.readFileSync(recent, 'utf8'))) out.set(id, src);
    log(`오늘 훑은 지역 목록 다시 씀 — ${out.size}건`);
  } else {
  for (const a of cfg.areas) {
    let before = -1;
    for (let page = 1; page <= (a.pages || cfg.maxListPages); page++) {
      const q = new URLSearchParams({ stc: '1', address1_01: a.a1, address1_02: a.a2, address1_03: a.a3, ipdate1: kstDay(), ipdate2: kstDay(cfg.aheadDays), page: String(page) });
      const h = await get(`${BASE}/search/search_list.php?${q}`);
      idsIn(h).forEach((id) => out.has(id) || out.set(id, a.name));
      if (out.size === before) break; before = out.size;
      await pause('pageSeconds');
    }
    log(`${a.name} 진행 물건 목록 — 지금까지 ${out.size}건`);
  }
  fs.writeFileSync(listFile, JSON.stringify([...out]));
  }
  const file = path.join(ROOT, '..', 'review', 'items.json');
  if (fs.existsSync(file)) {
    const cases = [...new Set(JSON.parse(fs.readFileSync(file, 'utf8')).map((it) => (String(it.id).match(/^(\d{4})타경(\d+)/) || []).slice(1, 3).join('|')).filter((x) => x.includes('|')))];
    for (const c of cases) {
      const [y, n] = c.split('|');
      const known = Object.values(db).some((r) => r.사건번호 === `${y}타경${n}` && Date.now() - (r._at || 0) < cfg.refreshDays * 86400e3);
      if (known) continue;
      await pause('pageSeconds');
      idsIn(await get(`${BASE}/search/search_list.php?stc=1&sno=${y}&tno=${n}`)).forEach((id) => out.has(id) || out.set(id, 'review'));
    }
    log(`review 후보 포함 — 대상 물건 ${out.size}건`);
  }
  return out;
}

/** 물건 하나(idx) 기본정보 */
async function readItem(idx) {
  const h = await get(`${BASE}/search/detail_view.php?idx=${idx}`);
  if (!h) return null;
  const title = (h.match(/<title>([^<]*)<\/title>/i) || [])[1] || '';
  const t = textOf(h);
  const cm = title.match(/(\d{4})타경(\d+)\s*\[([^\]]*)\]\s*(.*)$/);
  if (!cm) return null;
  const court = (t.match(/([가-힣]+지방법원(?:\s*[가-힣]+지원)?)/) || [])[1] || '';
  const pics = [...new Set([...h.matchAll(/pic_(\d+)\.jpg/g)].map((m) => m[1]))];
  const sale = (t.match(/매각기일\s*[:：]?\s*(\d{4}[.-]\d{2}[.-]\d{2})/) || [])[1] || '';
  return { idx, year: cm[1], caseNo: `${cm[1]}타경${cm[2]}`, use: cm[3].replace(/\s*경매$/, ''), address: cm[4].trim(), court: courtBase(court), hasPic: pics.length > 0, sale: sale.replace(/\./g, '-'), text: t.slice(0, 20000) };
}

const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const isPdf = (b) => b && b.subarray(0, 4).toString() === '%PDF';
const isJpg = (b) => b && b[0] === 0xff && b[1] === 0xd8;
// 매각물건명세서는 매각기일 1주일 전부터 조회 가능 — 그 날(공개일) 전에 받은 명세서는 지난 회차 것이다
const openDayOf = (sale) => (/^\d{4}-\d{2}-\d{2}$/.test(sale || '') ? new Date(new Date(sale + 'T00:00:00Z').getTime() - 7 * 86400e3).toISOString().slice(0, 10) : '');
const fileDay = (f) => { try { return new Date(fs.statSync(f).mtimeMs + 9 * 3600e3).toISOString().slice(0, 10); } catch { return ''; } };
const staleSpec = (f, sale) => { const od = openDayOf(sale); return !!(od && kstDay() >= od && exists(f) && fileDay(f) < od); };

/** 사건 하나 받기 — 같은 사건의 물건(idx)들을 함께 */
/** light=true: 명세서·현황조사서만(감정평가서·문건·송달·사진 뺌) */
async function grabCase(items, light = false) {
  const first = items[0];
  const dir = path.join(ARCHIVE, first.court || '법원미상', first.year, first.caseNo);
  fs.mkdirSync(dir, { recursive: true });
  const got = { 감정평가서: '', 매각물건명세서: [], 현황조사서: '', 문건접수: '', 송달: '', 사진수: 0, 명세서받은날: {}, 명세서변경: [], 명세서같음: [] };
  let caseDataDir = '';

  // 감정평가서(사건 단위) — PDF 주소에서 사건 자료 폴더도 알아낸다
  const fA = path.join(dir, '감정평가서_제이옥션.pdf');
  if (!light) {
    await pause('pageSeconds');
    const v = await view('judgement', first.idx);
    const src = (String(v).match(/<iframe[^>]+src=["']([^"']+\.pdf)/i) || [])[1];
    if (src) {
      const url = new URL(src, BASE).href; caseDataDir = url.replace(/[^/]+$/, '');
      if (!exists(fA)) { await pause('pageSeconds'); const b = await get(url, { binary: true }); if (isPdf(b)) fs.writeFileSync(fA, b); }
    }
  }
  got.감정평가서 = exists(fA) ? 'O' : '';

  // 글자 문서(사건 단위): 현황조사서·문건접수내역·송달내역
  for (const [type, name, key] of [['status', '현황조사서', '현황조사서'], ['mun', '문건접수내역', '문건접수'], ['song', '송달내역', '송달']].filter(([t]) => !light || t === 'status')) {
    const fT = path.join(dir, `${name}_제이옥션.txt`);
    if (!exists(fT)) {
      await pause('pageSeconds');
      const v = await view(type, first.idx);
      const body = bodyAfterMenu(textOf(v));
      if (body.length > 30) { fs.writeFileSync(fT, body); if (type === 'status') fs.writeFileSync(path.join(dir, `${name}_제이옥션.html`), v); }
    }
    got[key] = exists(fT) ? 'O' : '';
  }

  // 매각물건명세서·물건정보(물건번호 단위)
  for (const it of items) {
    await pause('pageSeconds');
    const v = await view('mul', it.idx);
    const no = (textOf(v).match(new RegExp(`${it.caseNo}\\((\\d+)\\)`)) || [])[1] || '1';
    it.itemNo = no;
    const idir = path.join(dir, no); fs.mkdirSync(idir, { recursive: true });
    const fM = path.join(idir, '매각물건명세서_제이옥션.pdf');
    const src = (String(v).match(/<iframe[^>]+src=["']([^"']+\.pdf)/i) || [])[1];
    if (src && (!exists(fM) || staleSpec(fM, it.sale))) {
      const old = exists(fM) ? fs.readFileSync(fM) : null; const oldDay = old ? fileDay(fM) : '';
      await pause('pageSeconds'); const b = await get(new URL(src, BASE).href, { binary: true });
      if (isPdf(b)) {
        if (old && !old.equals(b)) { fs.renameSync(fM, path.join(idir, `매각물건명세서_제이옥션_${oldDay}받음.pdf`)); fs.writeFileSync(fM, b); got.명세서변경.push(no); log(`${it.caseNo}(${no}) 매각물건명세서 새로 나옴 — 이전 것은 _${oldDay}받음 으로 보관`); }
        else if (old) { fs.utimesSync(fM, new Date(), new Date()); got.명세서같음.push(no); }
        else fs.writeFileSync(fM, b);
      }
    }
    if (exists(fM)) got.명세서받은날[no] = fileDay(fM);
    if (exists(fM)) got.매각물건명세서.push(no);
    if (!caseDataDir && src) caseDataDir = new URL(src, BASE).href.replace(/\d+\/[^/]+$/, '');
    const { text, ...meta } = it;
    fs.writeFileSync(path.join(idir, '물건정보_제이옥션.json'), JSON.stringify({ 출처: '제이옥션(gfauction.co.kr)', ...meta, 받은날: kstDay(), 화면글자: text }, null, 1));
  }

  // 현장사진(사건 단위): 사진 보기 화면에서 파일 이름을 읽고 자료 폴더에서 받는다
  const pdir = path.join(dir, '사진_제이옥션');
  const already = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((f) => /\.jpe?g$/i.test(f)).length : 0;
  if (!light && first.hasPic && caseDataDir && already === 0) {
    await pause('pageSeconds');
    const pv = await get(`${FILES}/auction/pic_view.php?idx=${first.idx}&picname=pic_0.jpg`, { referer: `${BASE}/search/auction_detail_view.php?type=pic_0.jpg&idx=${first.idx}` });
    const names = [...new Set([...String(pv).matchAll(/\/(pic_[\w]+\.jpe?g)/gi)].map((m) => m[1]))]
      .sort((a, b) => Number((a.match(/(\d+)\.jpe?g$/i) || [])[1]) - Number((b.match(/(\d+)\.jpe?g$/i) || [])[1]));
    fs.mkdirSync(pdir, { recursive: true });
    let k = 0;
    for (const n of names.slice(0, 60)) {
      await pause('photoSeconds');
      const b = await get(caseDataDir + n, { binary: true, referer: `${FILES}/auction/pic_view.php` });
      if (isJpg(b)) fs.writeFileSync(path.join(pdir, `사진${String(++k).padStart(2, '0')}.jpg`), b);
    }
  }
  got.사진수 = fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((f) => /\.jpe?g$/i.test(f)).length : 0;

  const key = `${first.court}_${first.caseNo}`;
  const full = !!(got.감정평가서 && got.매각물건명세서.length && got.현황조사서 && (got.사진수 || !first.hasPic));
  const lightDone = !!(got.매각물건명세서.length && got.현황조사서);
  db[key] = {
    법원: first.court, 사건번호: first.caseNo, 물건번호: items.map((i) => i.itemNo).join(' '), 용도: first.use, 주소: first.address, 다음매각기일: first.sale,
    감정평가서: got.감정평가서, 매각물건명세서: got.매각물건명세서.join(' '), 현황조사서: got.현황조사서, 문건접수: got.문건접수, 송달: got.송달, 사진수: got.사진수,
    명세서공개일: openDayOf(first.sale), 명세서받은날: got.명세서받은날, 명세서변경: got.명세서변경.join(' '),
    마지막확인: kstDay(), 폴더: path.relative(ARCHIVE, dir), idx: items.map((i) => i.idx), _at: Date.now(),
    _완료: light ? lightDone : full, _light: light && !full, _full: full,
  };
  saveDb();
  log(`${first.court} ${first.caseNo}${light ? ' [가볍게]' : ''}: 감정평가서 ${got.감정평가서 || 'X'} · 명세서 ${got.매각물건명세서.length}건 · 현황조사서 ${got.현황조사서 || 'X'} · 사진 ${got.사진수}장`);
}

async function loginMode() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
  const { chromium } = await import('playwright');
  const ctx = await chromium.launchPersistentContext(path.join(STATE, 'jauction-profile'), { headless: false, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${BASE}/main/main.php`).catch(() => {});
  log('제이옥션 창에서 직접 로그인하세요. 로그인되면 저장하고 창이 저절로 닫힙니다(최대 30분 기다림).');
  let closed = false; ctx.on('close', () => { closed = true; });
  try {
    for (let i = 0; i < 600 && !closed; i++) {
      await sleep(3000);
      const ok = await page.evaluate(() => /로그아웃/.test(document.body?.innerText || '')).catch(() => false);
      if (ok) {
        const list = (await ctx.cookies()).filter((c) => /gfauction|nuriauction/.test(c.domain)).map(({ name, value, domain }) => ({ name, value, domain, path: '/' }));
        jar = list; saveJar();
        log(`로그인 확인 — 로그인 정보 ${list.length}개 저장. 이제 npm run jauction-test 로 시험하세요.`);
        return;
      }
    }
    log(closed ? '로그인 전에 창이 닫혔습니다. 다시 npm run jauction-login 하세요.' : '30분 동안 로그인이 안 돼 끝냅니다.');
  } finally { await ctx.close().catch(() => {}); }
}

async function loggedIn() {
  if (!jar.length) return false;
  const t = await get(`${BASE}/main/main.php`);
  return /로그아웃/.test(t || '');
}

async function main() {
  if (LOGIN) return loginMode();
  if (!cfg.enabled) return log('config.json jauction.enabled=false — 쉼');
  if (fs.existsSync(blockedFile)) return log(`멈춤 상태(${blockedFile}) — 제이옥션 화면을 직접 확인한 뒤 이 파일을 지우면 다시 받음`);
  if (!lock()) return log('이미 다른 제이옥션 수집기가 돌고 있음');
  log(`시작 — 보관 폴더 ${ARCHIVE}${DRY ? ' (시험)' : ''}, 오늘 ${today}/${cfg.dailyMax}사건`);
  let n = 0;
  try {
    if (!anyHour && !inHours()) return log('쉬는 시간대 — 다음 실행에 이어서');
    if (!(await loggedIn())) throw new NeedLogin('제이옥션 로그인 안 됨 — 미니PC에서 npm run jauction-login 으로 한 번 로그인하세요(본인이 직접)');
    let idxs;
    if (arg('--case')) {
      const m = arg('--case').match(/^(\d{4})타경(\d+)/);
      idxs = new Map(idsIn(await get(`${BASE}/search/search_list.php?stc=1&sno=${m[1]}&tno=${m[2]}`)).map((i) => [i, 'case']));
    } else {
      // 1단계: 검토 범위(용도·최저가 상한) + review 후보. 다 받았으면 2단계: 넓은 지역 전체(config areas)
      idxs = await collectScope();
      const scopeLeft = [...idxs.entries()].filter(([i, v]) => !doneFor(i, v.light) && !skip.has(i)).length;
      log(`검토 범위 — 대상 ${idxs.size}건, 남은 것 ${scopeLeft}건`);
      if (!scopeLeft) { log('검토 범위를 다 받음 — 넓은 지역(서울·경기 전체 등)으로 넘어감'); idxs = new Map([...(await collectIdx())].map(([i, src]) => [i, { src, sale: '', light: false }])); }
    }
    if (idxs.size && typeof [...idxs.values()][0] === 'string') idxs = new Map([...idxs].map(([i, src]) => [i, { src, sale: '', light: false }]));
    // 이미 받은 물건(최근 확인·완료)은 건너뛴다
    const fresh = (idx) => doneFor(idx, idxs.get(idx)?.light);
    // 받는 순서: 집중 지역(앞의 두 지역) → review 후보 → 넓은 지역(config 순서대로)
    // 받는 순서: 매각기일 빠른 순(검토 범위·review). 넓은 지역은 config 순서대로
    const rank = (src) => { if (/^범위:|^review$|^case$/.test(src)) return 0; const k = cfg.areas.findIndex((x) => x.name === src); return k < 0 ? 99 : k + 1; };
    const key = (i) => { const v = idxs.get(i); return [rank(v.src), v.sale || '9999-99-99']; };
    const todo = [...idxs.keys()].filter((i) => !fresh(i) && !skip.has(i)).sort((x, y) => { const a = key(x); const b = key(y); return a[0] - b[0] || a[1].localeCompare(b[1]); });
    log(`대상 ${idxs.size}건 중 이번에 볼 물건 ${todo.length}건`);
    const seenCase = new Set();
    for (const idx of todo) {
      if (n >= LIMIT) break;
      if (today >= cfg.dailyMax) { log('오늘 한도 — 내일 이어서'); break; }
      if (!anyHour && !inHours()) { log('쉬는 시간대 — 다음 실행에 이어서'); break; }
      reloadCfg();
      if (fs.existsSync(stopFile)) { try { fs.unlinkSync(stopFile); } catch { /* */ } log('멈춤 요청(jauction-stop.txt) — 여기서 멈춤'); break; }
      if (n > 0) await pause('itemSeconds');
      try {
        const it = await readItem(idx);
        if (!it) { log(`idx ${idx}: 물건 정보를 못 읽음`); continue; }
        if (MOVABLE.test(String(it.use || '').replace(/주차|차고/g, ''))) { skip.add(idx); saveSkip(); log(`idx ${idx}: 동산(${it.use}) — 받지 않음`); continue; }
        const ck = `${it.court}_${it.caseNo}`;
        if (seenCase.has(ck)) continue; seenCase.add(ck);
        // 같은 사건의 다른 물건번호 idx 도 함께
        const sib = [it];
        const listed = idsIn(await get(`${BASE}/search/search_list.php?stc=1&sno=${it.year}&tno=${it.caseNo.split('타경')[1]}`)).filter((i) => i !== idx);
        for (const o of listed.slice(0, 11)) { await pause('pageSeconds'); const s = await readItem(o); if (s && s.court === it.court && s.caseNo === it.caseNo) sib.push(s); }
        n++; bump();
        // 30사건마다 사이트(/data) 올리기를 따로 돌림(이미 돌고 있으면 그쪽이 알아서 건너뜀)
        if (!DRY && n % 30 === 0) { try { const { spawn } = await import('node:child_process'); spawn(process.execPath, [path.join(ROOT, 'src', 'datasync.js')], { cwd: ROOT, detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* */ } }
        await grabCase(sib, !!idxs.get(idx)?.light && !sib.some((s) => idxs.get(s.idx) && !idxs.get(s.idx).light));
      } catch (e) {
        if (e instanceof Blocked || e instanceof NeedLogin) throw e;
        log(`idx ${idx}: 실패 ${e.message}`);
      }
    }
  } catch (e) {
    if (e instanceof Blocked) { fs.writeFileSync(blockedFile, `${new Date().toISOString()} ${e.message}\n`); log(`막힘 — 우회하지 않고 멈춤: ${e.message}`); }
    else if (e instanceof NeedLogin) log(`로그인 필요 — ${e.message}`);
    else log(`오류: ${e.stack || e.message}`);
  } finally {
    saveDb();
    try { fs.unlinkSync(lockFile); } catch { /* */ }
    log(`끝 — 이번에 ${n}사건`);
  }
}
await main();
