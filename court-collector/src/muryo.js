// 무료경매.kr(제일법원경매, http://www.xn--289ar2ubyal2b.kr) 자료를 사건번호별로 원본 하드에 쌓는다 — 미니PC 전용, 본인만 보는 자료(개인 보관, 재배포 안 함)
//  · 제이옥션이 막혀 있는 동안 쓰는 대체 수집기. 구조는 jauction.js 와 같다(검토 범위 우선 · 가볍게 · 하루 상한 · 느린 속도 · 같은 원본 폴더).
//  · robots.txt: 무료경매.kr 은 전체 허용(실행할 때마다 다시 확인, 막히면 멈춤).
//    단 감정평가서·매각물건명세서 PDF와 현장사진은 다른 서버(*.speedauction.co.kr)에 있고 그 서버 robots.txt 가 전부 금지 → 받지 않는다.
//    그래서 이 수집기는 무료경매.kr 화면 글자만 받는다: 사건 상세(기일현황·임차인·지역분석 등), 현황조사서, 부동산 표시목록, 기일내역, 문건접수·송달내역.
//  · 동산(자동차·선박·중기 등)은 받지 않는다. 회차는 '최초 → 1회 유찰 → 2회 유찰'로 적는다.
//  · 막히면(403·429·보안문자·차단 화면) 우회하지 않고 멈춘다 → state/muryo-blocked.txt (화면을 직접 확인한 뒤 지우면 재개)
//    연결 시간 초과가 연달아 나도 멈추고, 다음 예약 실행 때 한 번만 다시 본다(다른 IP·프록시·자매 사이트로 돌아가지 않음).
//  · 저장 위치: <원본폴더>\<법원>\<연도>\<사건번호>\  (파일 이름 끝에 _무료경매)
//      현황조사서_무료경매.txt/.html, 부동산표시목록_무료경매.txt, 기일내역_무료경매.txt, 문건접수내역_무료경매.txt, 송달내역_무료경매.txt
//      <물건번호>\물건정보_무료경매.json
//    목록(데이터베이스): <원본폴더>\_무료경매_목록.csv + _무료경매_목록.json
//  · 이미 제이옥션에서 받은 사건(_제이옥션_목록.json 완료)은 건너뛴다.
//
//  보통 실행:  node src/muryo.js            (start-jauction.cmd 가 함께 띄움)
//  지금 시작:  node src/muryo.js --now      (시간대 제한만 건너뜀)
//  시험:       node src/muryo.js --limit 1 --dry          (state/muryo-test 에 저장)
//              node src/muryo.js --case 2025타경512341 --court 인천지방법원 --dry
//  로그인(선택): node src/muryo.js --login  → 뜬 창에서 본인이 직접 로그인 → 쿠키를 state/muryo-cookies.json 에 저장
//              (지금은 로그인 없이도 모든 화면이 열려서 필수 아님. 저장해 두면 요청마다 함께 보냄)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findArchive } from './archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry');
const LOGIN = args.includes('--login');
const NOW = args.includes('--now');
const anyHour = DRY || NOW;
const LIMIT = Number(arg('--limit')) || Infinity;

const cfgAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const DEFAULT_SCOPE = [
  { name: 'A 수도권 아파트·다세대·도시형 5천만 이하', regions: ['서울', '인천', '경기'], use1: '01,03,07', minPriceMax: 50000000 },
  { name: 'B 수도권·충청 땅 3천만 이하', regions: ['서울', '인천', '경기', '충북', '충남', '대전', '세종'], use3: '41,42,43,44,45,46', minPriceMax: 30000000 },
  { name: 'B 경남 남해안 땅 3천만 이하', regions: ['경남'], use3: '41,42,43,44,45,46', minPriceMax: 30000000, addr: '통영|거제|남해군|사천|고성군|하동|진해|마산합포' },
];
const cfg = {
  enabled: true, dailyMax: 150, itemSeconds: [60, 140], pageSeconds: [4, 10], allowedHours: [[6, 23]],
  refreshDays: 7, retryMissingDays: 3, scopeDays: 45, maxListPages: 30, failStop: 8, failRests: 6, failRestMinutes: 30, skipIfJauction: true,
  // 검토 범위를 다 받으면 쉬지 않고 넓은 범위로 넘어감(수집은 멈추지 않는다)
  broad: [{ name: 'C 수도권 주거·토지 전체', regions: ['인천', '서울', '경기'], use1: '01,02,03,04,05,07', use3: '41,42,43,44,45,46,47,49' }],
  scope: DEFAULT_SCOPE,
  ...(cfgAll.muryo || {}),
};
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const ARCHIVE = DRY ? path.join(STATE, 'muryo-test') : (findArchive(env) || path.join(STATE, 'originals'));
fs.mkdirSync(ARCHIVE, { recursive: true });

const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstDay = (plus = 0) => new Date(kstNow().getTime() + plus * 86400e3).toISOString().slice(0, 10);
const logFile = path.join(LOGS, `muryo-${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = ([a, b]) => a + Math.random() * (b - a);
const pause = (k) => sleep(rand(cfg[k]) * 1000);
function reloadCfg() {
  try { const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8')).muryo || {}; for (const k of ['enabled', 'dailyMax', 'itemSeconds', 'pageSeconds', 'allowedHours']) if (j[k] !== undefined) cfg[k] = j[k]; } catch { /* 고치는 중 */ }
}

const HOST = 'www.xn--289ar2ubyal2b.kr';
const BASE = `http://${HOST}`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const REGION = { 서울: '1100000000', 경기: '4100000000', 인천: '2800000000', 부산: '2600000000', 대구: '2700000000', 대전: '3000000000', 광주: '1200000000', 울산: '3100000000', 경북: '4700000000', 경남: '4800000000', 충북: '4300000000', 충남: '4400000000', 전북: '5200000000', 강원: '5100000000', 제주: '5000000000', 세종: '3600000000' };
const COURT_MAIN = { 서울중앙: 'A01', 서울동부: 'A02', 서울서부: 'A03', 서울남부: 'A04', 서울북부: 'A05', 인천: 'C01', 수원: 'E01', 의정부: 'D01', 부산: 'B01', 창원: 'J01', 대구: 'I01', 울산: 'N01', 광주: 'L01', 전주: 'K01', 대전: 'H01', 청주: 'G01', 춘천: 'F01', 제주: 'M01' };
const MOVABLE = /자동차|차량|승용|승합|화물|트럭|버스|오토바이|이륜|중기|건설기계|굴착기|지게차|선박|어선|항공기|유체동산|기계기구|광업권|어업권/;
class Blocked extends Error {}

const stopFile = path.join(STATE, 'muryo-stop.txt');
const blockedFile = path.join(STATE, 'muryo-blocked.txt');
const countFile = path.join(STATE, `muryo-${kstDay()}.json`);
let today = fs.existsSync(countFile) ? JSON.parse(fs.readFileSync(countFile, 'utf8')).count || 0 : 0;
const bump = () => { today++; if (!DRY) fs.writeFileSync(countFile, JSON.stringify({ count: today })); };
const inHours = () => { const h = kstNow().getUTCHours(); return cfg.allowedHours.some(([a, b]) => h >= a && h < b); };
const lockFile = path.join(STATE, 'muryo.lock');
function lock() {
  if (fs.existsSync(lockFile)) { const pid = Number(fs.readFileSync(lockFile, 'utf8')); try { process.kill(pid, 0); return false; } catch { /* 죽은 잠금 */ } }
  fs.writeFileSync(lockFile, String(process.pid)); return true;
}

// ── 쿠키(선택) ─────────────────────────────────────────
const COOKIES = path.join(STATE, 'muryo-cookies.json');
let jar = fs.existsSync(COOKIES) ? JSON.parse(fs.readFileSync(COOKIES, 'utf8')) : [];
const saveJar = () => fs.writeFileSync(COOKIES, JSON.stringify(jar));
function takeCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const sc of list) {
    const nv = sc.split(';')[0]; const i = nv.indexOf('='); if (i < 1) continue;
    const name = nv.slice(0, i).trim(); const value = nv.slice(i + 1).trim();
    jar = jar.filter((c) => c.name !== name);
    if (value && !/deleted/.test(value)) jar.push({ name, value, domain: HOST, path: '/' });
  }
  if (list.length) saveJar();
}

// ── robots.txt ────────────────────────────────────────
async function robotsAllows(paths) {
  const res = await fetch(`${BASE}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30e3) });
  if (!res.ok) return res.status === 404; // 없으면 허용
  const lines = (await res.text()).split(/\r?\n/).map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  let mine = false; const dis = []; const allow = [];
  for (const l of lines) {
    const [k, ...v] = l.split(':'); const key = k.trim().toLowerCase(); const val = v.join(':').trim();
    if (key === 'user-agent') mine = val === '*';
    else if (mine && key === 'disallow' && val) dis.push(val);
    else if (mine && key === 'allow' && val) allow.push(val);
  }
  return paths.every((p) => { const d = dis.filter((x) => p.startsWith(x)).sort((a, b) => b.length - a.length)[0]; const a = allow.filter((x) => p.startsWith(x)).sort((x, y) => y.length - x.length)[0]; return !d || (a && a.length >= d.length); });
}

// ── 화면 받기(무료경매.kr 만) ──────────────────────────
async function get(pathOrUrl, { method = 'GET', form = null, referer = `${BASE}/v1/index/index.htm` } = {}) {
  const url = new URL(pathOrUrl, BASE);
  if (url.hostname !== HOST) throw new Error(`다른 서버는 받지 않음: ${url.hostname}`);
  const ck = jar.map((c) => `${c.name}=${c.value}`).join('; ');
  const headers = { 'User-Agent': UA, Referer: referer, 'Accept-Language': 'ko-KR,ko;q=0.9', ...(ck ? { Cookie: ck } : {}) };
  let body;
  if (form) { body = new URLSearchParams(form).toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  const res = await fetch(url.href, { method, headers, body, signal: AbortSignal.timeout(60e3) });
  takeCookies(res);
  if (res.status === 403 || res.status === 429) throw new Blocked(`HTTP ${res.status} ${url.pathname}`);
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}`);
  const buf = await res.arrayBuffer();
  const t = new TextDecoder(/utf-?8/i.test(res.headers.get('content-type') || '') ? 'utf-8' : 'euc-kr').decode(buf);
  if (/captcha|보안문자|자동입력\s*방지|비정상적인\s*접근|접근이\s*차단|접속이\s*제한/i.test(t)) throw new Blocked(`차단/보안문자 화면 ${url.pathname}`);
  return t;
}
const ent = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'");
const textOf = (h) => ent(ent(String(h || '').replace(/\r/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<br\s*\/?>|<\/(p|tr|li|h\d|div|table)>/gi, '\n').replace(/<\/t[dh]>/gi, '\t').replace(/<[^>]+>/g, ' ')))
  .replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim();
// 실명 가리기: 사이트가 대부분 가려 주지만(김OO) 표시목록 등에 남는 이름이 있음 → 성만 남김
const maskNames = (t) => String(t)
  .replace(/(순위번호\s*\d+번\s+)([가-힣])([가-힣]{1,3})(\s*지분)/g, (m, a, b, c, d) => a + b + 'O'.repeat(c.length) + d)
  .replace(/((?:소유자|채무자|성명)\s*[:：]\s*)([가-힣])([가-힣]{1,2})(?=[\s,(]|$)/gm, (m, a, b, c) => a + b + 'O'.repeat(c.length));

const SUPPORT_MAIN = { 부천지원: '인천지방법원', 성남지원: '수원지방법원', 여주지원: '수원지방법원', 평택지원: '수원지방법원', 안산지원: '수원지방법원', 안양지원: '수원지방법원', 고양지원: '의정부지방법원', 남양주지원: '의정부지방법원', 진주지원: '창원지방법원', 통영지원: '창원지방법원', 밀양지원: '창원지방법원', 거창지원: '창원지방법원', 마산지원: '창원지방법원', 천안지원: '대전지방법원', 홍성지원: '대전지방법원', 공주지원: '대전지방법원', 논산지원: '대전지방법원', 서산지원: '대전지방법원', 충주지원: '청주지방법원', 제천지원: '청주지방법원', 영동지원: '청주지방법원' };
function normCourt(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/([가-힣]+)지원$/); if (m && !/지방법원/.test(s)) return SUPPORT_MAIN[m[0]] ? `${SUPPORT_MAIN[m[0]]} ${m[0]}` : s;
  return s;
}
const courtCode = (court) => { const k = Object.keys(COURT_MAIN).find((x) => String(court).replace(/\s/g, '').startsWith(x)); return k ? COURT_MAIN[k] : '0'; };

// ── 목록 검색 ─────────────────────────────────────────
function searchForm({ region = '0', use1 = '', use3 = '', minPriceMax = 99999999999999, page = 1, courtMain = '0', year = '0', num = '', all = false }) {
  const [ys, ms, ds] = (all ? '2000-01-01' : kstDay()).split('-'); const [ye, me, de] = (all ? '2030-12-31' : kstDay(cfg.scopeDays)).split('-');
  return { search_type: '', courtNo: '', courtNo2: '', fix_sell_date: '', next_sell_date: '', use1: use1 ? use1.replace(/,?$/, ',') : '', use2: '', use3: use3 ? use3.replace(/,?$/, ',') : '', use4: '', use5: '', page: String(page), mtype: '6',
    courtNo_main: courtMain, courtNo_sub: '0', eventNo: year, eventNo2: num, sell_yyyy_s: ys, sell_mm_s: ms, sell_dd_s: ds, sell_yyyy_e: ye, sell_mm_e: me, sell_dd_e: de,
    region_code1: region, region_code2: '0', region_code3: '0', auction_result: all ? '99' : '1,2,8,17', p_estprice1: '1', p_estprice2: '99999999999999', p_minprice1: '1', p_minprice2: String(minPriceMax),
    orderby: 't2.selldate|asc', list_view_cnt: '100' };
}
/** 목록 줄: 사건 열쇠·물건번호·용도·주소글자·최저가·매각기일 */
function rowsIn(h) {
  h = String(h);
  const re = /info_result_switch\.php\?courtNo=([A-Z]\d\d)(?:&(?:amp;)?courtNo2=([A-Z0-9]*))?&(?:amp;)?eventNo1=(\d{4})&(?:amp;)?eventNo2=(\d+)&(?:amp;)?objNo=(\d+)/g;
  // 한 물건 줄 안에 같은 링크가 여러 번 나온다 → 링크가 바뀌는 곳에서 끊어 그 사이 글자를 그 물건 줄로 본다
  const hits = []; let m;
  while ((m = re.exec(h))) { const id = `${m[1]}|${m[2] || ''}|${m[3]}|${m[4]}|${m[5]}`; if (!hits.length || hits[hits.length - 1].id !== id) hits.push({ id, m, at: m.index }); }
  const out = [];
  hits.forEach((x, k) => {
    const seg = h.slice(x.at, k + 1 < hits.length ? hits[k + 1].at : x.at + 6000);
    const key = `${x.m[1]}|${x.m[2] || ''}|${x.m[3]}|${x.m[4]}`;
    if (out.some((r) => r.key === key && r.objNo === x.m[5])) return;
    const bc = (seg.match(/bid_choice\d+ value='([^']+)'/) || h.slice(Math.max(0, x.at - 1500), x.at).match(/bid_choice\d+ value='([^']+)'(?![\s\S]*bid_choice)/) || [])[1] || '';
    const t = textOf(seg.slice(seg.indexOf('>') + 1)).replace(/\s+/g, ' ');
    const d = t.match(/(\d{4}-\d{2}-\d{2})/);
    const mp = t.match(/@\s*([\d,]+)/);
    out.push({ key, courtNo: x.m[1], courtNo2: x.m[2] || '', year: x.m[3], num: x.m[4], objNo: x.m[5], use: bc.split('-')[4] || '', text: t, sale: d ? d[1] : '', minPrice: mp ? Number(mp[1].replace(/,/g, '')) : 0 });
  });
  return out;
}
async function listPage(form) { return rowsIn(await get('/v1/s01/01.htm', { method: 'POST', form, referer: `${BASE}/v1/s01/01.htm` })); }

/** 검토 범위 + review 후보 → Map key → { rows:[…], src, sale, light } */
async function collectScope({ skipReview = false } = {}) {
  const out = new Map();
  const add = (r, src, light) => { const v = out.get(r.key) || { rows: [], src, sale: r.sale, light }; if (!v.rows.some((x) => x.objNo === r.objNo)) v.rows.push(r); if (!light) { v.light = false; v.src = src; } if (r.sale && (!v.sale || r.sale < v.sale)) v.sale = r.sale; out.set(r.key, v); };
  for (const sc of cfg.scope || []) {
    const addrRe = sc.addr ? new RegExp(sc.addr) : null;
    for (const reg of sc.regions || []) {
      const n0 = out.size; let before = '';
      for (let page = 1; page <= cfg.maxListPages; page++) {
        const rows = await listPage(searchForm({ region: REGION[reg] || reg, use1: sc.use1, use3: sc.use3, minPriceMax: sc.minPriceMax, page }));
        const sig = rows.map((r) => r.key + r.objNo).join(',');
        if (!rows.length || sig === before) break; before = sig;
        for (const r of rows) {
          if (MOVABLE.test(r.use)) continue;
          if (sc.minPriceMax && r.minPrice > sc.minPriceMax) continue;
          if (addrRe && !addrRe.test(r.text)) continue;
          add(r, `범위:${sc.name}`, true);
        }
        if (rows.length < 100) break;
        await pause('pageSeconds');
      }
      log(`${sc.name} (${reg}) — ${out.size - n0}사건`);
      await pause('pageSeconds');
    }
  }
  // review 후보: 전부 받음
  const file = path.join(ROOT, '..', 'review', 'items.json');
  if (!skipReview && fs.existsSync(file)) {
    let k = 0;
    for (const it of JSON.parse(fs.readFileSync(file, 'utf8'))) {
      const m = String(it.id).match(/^(\d{4})타경(\d+)/); if (!m) continue;
      const court = normCourt(String(it.court || '').replace(/\s*경매[\d-]+계\s*$/, ''));
      if (muryoDone(court, `${m[1]}타경${m[2]}`, false) || jauctionDone(court, `${m[1]}타경${m[2]}`, false)) continue;
      await pause('pageSeconds');
      const rows = await listPage(searchForm({ courtMain: courtCode(court), year: m[1], num: m[2], all: true }));
      const cc = courtCode(court); // 사이트가 법원 조건을 무시하고 전국 같은 사건번호를 돌려주므로 목록 단계에서 법원 코드로 거름(헛 화면 줄이기)
      for (const r of rows.filter((x) => x.year === m[1] && x.num === m[2] && (cc === '0' || x.courtNo === cc))) { r.wantCourt = court; add(r, 'review', false); k++; }
    }
    log(`review 후보(전부 받음) — ${k}건`);
  }
  return out;
}

// ── 목록(데이터베이스) ────────────────────────────────
const dbFile = path.join(ARCHIVE, '_무료경매_목록.json');
const db = fs.existsSync(dbFile) ? JSON.parse(fs.readFileSync(dbFile, 'utf8')) : {};
let jdb = {};
try { jdb = JSON.parse(fs.readFileSync(path.join(ARCHIVE, '_제이옥션_목록.json'), 'utf8')); } catch { /* 없음 */ }
function saveDb() {
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 1));
  const cols = ['법원', '사건번호', '물건번호', '용도', '주소', '감정가', '최저가', '현재회차', '다음매각기일', '현황조사서', '표시목록', '기일내역', '문건접수', '송달', '마지막확인', '폴더'];
  const esc = (v) => { const s = Array.isArray(v) ? v.join(' ') : String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = Object.values(db).sort((a, b) => String(a.다음매각기일 || '9').localeCompare(String(b.다음매각기일 || '9'))).map((r) => cols.map((c) => esc(r[c])).join(','));
  fs.writeFileSync(path.join(ARCHIVE, '_무료경매_목록.csv'), '\uFEFF' + [cols.join(','), ...rows].join('\r\n'));
}
const fresh = (r, light) => !!r && ((light ? r._완료 || r._full : r._full) ? Date.now() - r._at < cfg.refreshDays * 86400e3 : Date.now() - r._at < cfg.retryMissingDays * 86400e3);
function muryoDone(court, caseNo, light) { return fresh(db[`${court}_${caseNo}`], light); }
function jauctionDone(court, caseNo, light) {
  if (!cfg.skipIfJauction) return false;
  const r = Object.values(jdb).find((x) => x.사건번호 === caseNo && (!court || x.법원 === court));
  return !!(r && (light ? r._완료 || r._full : r._full) && Date.now() - (r._at || 0) < cfg.refreshDays * 86400e3);
}
const doneByCaseNo = (caseNo, light) => Object.values(db).some((r) => r.사건번호 === caseNo && fresh(r, light)) || jauctionDone('', caseNo, light);

// ── 사건 하나 받기 ─────────────────────────────────────
const exists = (f) => { try { return fs.statSync(f).size > 0; } catch { return false; } };
const roundName = (n) => (n <= 0 ? '최초' : `${n}회 유찰`);
function parseView(h) {
  const t = textOf(h);
  const cm = t.match(/([가-힣]+지방법원(?:\s*[가-힣]+지원)?|[가-힣]+지원)\s*\n?\s*(\d{4})타경(\d+)/);
  const num = (re) => { const m = t.match(re); return m ? Number(m[1].replace(/,/g, '')) : 0; };
  const s0 = t.indexOf('기일현황'); const s1 = t.indexOf('감정평가', s0 + 1);
  const sched = s0 >= 0 ? t.slice(s0, s1 > s0 ? s1 : undefined) : '';
  const fails = (sched.match(/유찰/g) || []).length;
  return {
    text: t, court: cm ? normCourt(cm[1]) : '', caseNo: cm ? `${cm[2]}타경${cm[3]}` : '',
    address: ((t.match(/소재지\s*\n?\s*([^\n]+?)\s*(?:사건접수|\n)/) || [])[1] || '').trim(),
    use: ((t.match(/물건종별\s*([^\s\t]+)/) || [])[1] || '').trim(),
    appraisal: num(/감\s*정\s*가\s*([\d,]+)\s*원/), minPrice: num(/최\s*저\s*가\s*(?:\(\d+%\)\s*)?([\d,]+)\s*원/),
    sale: (t.match(/매각기일\s*:\s*(\d{4}-\d{2}-\d{2})/) || [])[1] || '', round: roundName(fails),
  };
}
const qs = (o) => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== undefined && v !== null)).toString();
/** 확대 화면의 실제 내용(iframe)을 받아 글자로 */
async function zoomDoc(r, tab) {
  const p = { courtNo: r.courtNo, ...(r.courtNo2 ? { courtNo2: r.courtNo2 } : {}), eventNo1: r.year, eventNo2: r.num, objNo: r.objNo };
  // 11(문건접수·송달)은 한 화면에 둘 다 있음(송달은 #chapter 위치)
  const inner = await get(`/auctionInfo/zoom/info-result-zoom${tab}_ifrm.htm?${qs({ ...p, ...(tab === 12 || tab === 11 ? { tab } : {}) })}`, { referer: `${BASE}/auctionInfo/zoom/info-result-zoom${tab}.htm?${qs(p)}` });
  let text = maskNames(textOf(inner).replace(/^[\s\S]*?맵옥션-경매물건 이제 지도로 검색하자!!\s*/, ''));
  if (/No input file specified/i.test(text) || text.length < 15) text = '';
  return { html: inner, text };
}

/** light=true: 상세(물건번호별)+현황조사서만 */
async function grabCase(v) {
  const light = v.light;
  const rows = [...v.rows].sort((a, b) => Number(a.objNo) - Number(b.objNo));
  const got = { 현황조사서: '', 표시목록: '', 기일내역: '', 문건접수: '', 송달: '', 물건: [] };
  let first = null; let dir = '';
  for (const r of rows.slice(0, 12)) {
    await pause('pageSeconds');
    const h = await get('/auctionInfo/view.php', { method: 'POST', form: { courtNo: r.courtNo, courtNo2: r.courtNo2, eventNo1: r.year, eventNo2: r.num, objNo: r.objNo }, referer: `${BASE}/auctionInfo/info_result_switch.php` });
    const info = parseView(h);
    if (!info.caseNo) { log(`${r.year}타경${r.num}(${r.objNo}): 상세를 못 읽음`); continue; }
    if (r.wantCourt && info.court && r.wantCourt.replace(/\s/g, '') !== info.court.replace(/\s/g, '')) { log(`${info.caseNo}: 다른 법원(${info.court}) — 건너뜀`); return 'other-court'; }
    if (MOVABLE.test(info.use)) { log(`${info.caseNo}: 동산(${info.use}) — 받지 않음`); return 'movable'; }
    if (!first) { first = { ...r, ...info }; dir = path.join(ARCHIVE, info.court || '법원미상', info.caseNo.slice(0, 4), info.caseNo); fs.mkdirSync(dir, { recursive: true }); }
    const idir = path.join(dir, r.objNo); fs.mkdirSync(idir, { recursive: true });
    const { text, ...meta } = info;
    fs.writeFileSync(path.join(idir, '물건정보_무료경매.json'), JSON.stringify({ 출처: '무료경매.kr(제일법원경매) — 개인 보관용, 재배포 금지', 물건번호: r.objNo, ...meta, 받은날: kstDay(), 화면글자: maskNames(text) }, null, 1));
    got.물건.push(r.objNo);
  }
  if (!first) return 'fail';
  const r0 = first;
  const docs = [[6, '현황조사서', '현황조사서', {}]];
  if (!light) docs.push([8, '부동산표시목록', '표시목록'], [12, '기일내역', '기일내역'], [11, '문건접수내역', '문건접수']);
  for (const [tab, name, key] of docs) {
    const fT = path.join(dir, `${name}_무료경매.txt`);
    const fS = path.join(dir, '송달내역_무료경매.txt');
    // 기일내역·문건/송달은 진행 중 바뀌므로 다시 받음, 나머지는 있으면 건너뜀
    if (!exists(fT) || tab === 12 || tab === 11) {
      await pause('pageSeconds');
      const d = await zoomDoc(r0, tab);
      if (d.text && tab === 11) {
        const k = d.text.search(/\n\s*송달내역\s*\n/);
        fs.writeFileSync(fT, k > 0 ? d.text.slice(0, k).trim() : d.text);
        if (k > 0) fs.writeFileSync(fS, d.text.slice(k).trim());
      } else if (d.text) { fs.writeFileSync(fT, d.text); if (tab === 6) fs.writeFileSync(path.join(dir, `${name}_무료경매.html`), maskNames(d.html)); }
    }
    got[key] = exists(fT) ? 'O' : '';
    if (tab === 11) got.송달 = exists(fS) ? 'O' : '';
  }
  const key = `${r0.court}_${r0.caseNo}`;
  const full = !!(got.현황조사서 && got.기일내역 && got.물건.length);
  db[key] = {
    법원: r0.court, 사건번호: r0.caseNo, 물건번호: got.물건.join(' '), 용도: r0.use, 주소: r0.address, 감정가: r0.appraisal, 최저가: r0.minPrice, 현재회차: r0.round, 다음매각기일: r0.sale || v.sale,
    현황조사서: got.현황조사서, 표시목록: got.표시목록, 기일내역: got.기일내역, 문건접수: got.문건접수, 송달: got.송달,
    마지막확인: kstDay(), 폴더: path.relative(ARCHIVE, dir), 열쇠: v.rows[0].key, _at: Date.now(), _완료: !!(got.물건.length && got.현황조사서), _full: full, _light: light && !full,
  };
  saveDb();
  log(`${r0.court} ${r0.caseNo}${light ? ' [가볍게]' : ''} (${r0.round}, 매각기일 ${r0.sale || '-'}): 물건 ${got.물건.length}건 · 현황조사서 ${got.현황조사서 || 'X'}${light ? '' : ` · 표시목록 ${got.표시목록 || 'X'} · 기일 ${got.기일내역 || 'X'} · 문건 ${got.문건접수 || 'X'} · 송달 ${got.송달 || 'X'}`}`);
  return 'ok';
}

// ── 로그인(선택) ───────────────────────────────────────
async function loginMode() {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
  const { chromium } = await import('playwright');
  const ctx = await chromium.launchPersistentContext(path.join(STATE, 'muryo-profile'), { headless: false, locale: 'ko-KR', viewport: { width: 1280, height: 900 } });
  const page = ctx.pages()[0] || await ctx.newPage();
  await page.goto(`${BASE}/v1/index/index.htm`).catch(() => {});
  log('무료경매.kr 창에서 직접 로그인하세요. 로그인되면 저장하고 창이 저절로 닫힙니다(최대 30분).');
  let closed = false; ctx.on('close', () => { closed = true; });
  try {
    for (let i = 0; i < 600 && !closed; i++) {
      await sleep(3000);
      const ok = await page.evaluate(() => /로그아웃/.test(document.body?.innerText || '')).catch(() => false);
      if (ok) { jar = (await ctx.cookies()).filter((c) => c.domain.includes('xn--289ar2ubyal2b')).map(({ name, value }) => ({ name, value, domain: HOST, path: '/' })); saveJar(); log(`로그인 확인 — ${jar.length}개 저장`); return; }
    }
    log(closed ? '로그인 전에 창이 닫혔습니다.' : '30분 동안 로그인이 안 돼 끝냅니다.');
  } finally { await ctx.close().catch(() => {}); }
}

async function main() {
  if (LOGIN) return loginMode();
  if (!cfg.enabled) return log('config.json muryo.enabled=false — 쉼');
  if (fs.existsSync(blockedFile)) return log(`멈춤 상태(${blockedFile}) — 무료경매.kr 화면을 직접 확인한 뒤 이 파일을 지우면 다시 받음`);
  if (!lock()) return log('이미 다른 무료경매 수집기가 돌고 있음');
  log(`시작 — 보관 폴더 ${ARCHIVE}${DRY ? ' (시험)' : ''}, 오늘 ${today}/${cfg.dailyMax}사건`);
  let n = 0;
  try {
    if (!anyHour && !inHours()) return log('쉬는 시간대 — 다음 실행에 이어서');
    if (today >= cfg.dailyMax) return log('오늘 한도 — 내일 이어서');
    if (!(await robotsAllows(['/v1/s01/01.htm', '/auctionInfo/view.php', '/auctionInfo/zoom/']))) return log('robots.txt 가 막고 있음 — 받지 않고 끝냄');
    let todo;
    if (arg('--case')) {
      const m = arg('--case').match(/^(\d{4})타경(\d+)/);
      const court = normCourt(arg('--court') || '');
      const rows = (await listPage(searchForm({ courtMain: court ? courtCode(court) : '0', year: m[1], num: m[2], all: true }))).filter((x) => x.year === m[1] && x.num === m[2]);
      const by = new Map(); for (const r of rows) { if (court) r.wantCourt = court; const v = by.get(r.key) || { rows: [], src: 'case', sale: r.sale, light: false }; v.rows.push(r); by.set(r.key, v); }
      todo = [...by.values()];
      if (!todo.length) log(`${arg('--case')}: 무료경매.kr 에서 못 찾음`);
    } else {
      const all = await collectScope();
      const caseOf = (v) => `${v.rows[0].year}타경${v.rows[0].num}`;
      const left = [...all.values()].filter((v) => !doneByCaseNo(caseOf(v), v.light));
      const byJ = [...all.values()].filter((v) => jauctionDone('', caseOf(v), v.light)).length;
      log(`검토 범위 — 대상 ${all.size}사건, 제이옥션에서 이미 받은 것 ${byJ}사건, 남은 것 ${left.length}사건`);
      if (!left.length && cfg.broad?.length) {
        log('검토 범위를 다 받음 — 넓은 범위로 넘어감');
        const keep = cfg.scope; cfg.scope = cfg.broad; const wide = await collectScope({ skipReview: true }); cfg.scope = keep;
        for (const v of wide.values()) if (!doneByCaseNo(caseOf(v), true)) left.push(v);
        log(`넓은 범위 — 남은 것 ${left.length}사건`);
      }
      todo = left.sort((a, b) => (a.src === 'review' ? 0 : 1) - (b.src === 'review' ? 0 : 1) || String(a.sale || '9').localeCompare(String(b.sale || '9')));
    }
    let failRun = 0; let restRounds = 0;
    for (const v of todo) {
      if (n >= LIMIT) break;
      reloadCfg();
      if (!cfg.enabled) { log('config 에서 꺼짐 — 멈춤'); break; }
      if (today >= cfg.dailyMax) { log('오늘 한도 — 내일 이어서'); break; }
      if (!anyHour && !inHours()) { log('쉬는 시간대 — 다음 실행에 이어서'); break; }
      if (fs.existsSync(stopFile)) { try { fs.unlinkSync(stopFile); } catch { /* */ } log('멈춤 요청(muryo-stop.txt) — 여기서 멈춤'); break; }
      if (n > 0) await pause('itemSeconds');
      try {
        const rc = await grabCase(v);
        if (rc === 'ok') { n++; bump(); failRun = 0; }
        else if (rc === 'fail') failRun++;
      } catch (e) {
        if (e instanceof Blocked) throw e;
        log(`${v.rows[0].year}타경${v.rows[0].num}: 실패 ${e.cause?.code || ''} ${e.message}`);
        if (++failRun >= cfg.failStop) {
          if (++restRounds > cfg.failRests) { log(`연달아 실패가 ${cfg.failRests}번 쉬어도 계속됨 — 이번 실행은 여기까지(다음 예약 실행 때 이어서)`); break; }
          log(`연달아 ${cfg.failStop}번 실패 — 그만두지 않고 ${cfg.failRestMinutes}분 쉰 뒤 같은 자리부터 다시(${restRounds}/${cfg.failRests}, 우회 없음)`);
          await sleep(cfg.failRestMinutes * 60e3); failRun = 0;
          if (!anyHour && !inHours()) { log('쉬는 시간대 — 다음 실행에 이어서'); break; }
        }
      }
    }
  } catch (e) {
    if (e instanceof Blocked) { fs.writeFileSync(blockedFile, `${new Date().toISOString()} ${e.message}\n`); log(`막힘 — 우회하지 않고 멈춤: ${e.message}`); }
    else log(`오류: ${e.cause?.code || ''} ${e.stack || e.message}`);
  } finally {
    saveDb();
    try { fs.unlinkSync(lockFile); } catch { /* */ }
    log(`끝 — 이번에 ${n}사건`);
  }
}
await main();
