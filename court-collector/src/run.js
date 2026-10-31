// 법원경매 수집기 실행 — 매일 새벽 작업 스케줄러가 부른다.
//  node src/run.js            보통 실행
//  node src/run.js --limit 3 --dry   3건만 읽고 서버에 올리지 않음(시험)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pace, kstDay } from './pace.js';
import { listCourt, readDetail, backToList, Blocked } from './site.js';
import { readSpecDoc, fetchDocPdf } from './specFetch.js';
import { FileStore, listingIdOf } from './files.js';
import { pdfText, pdfPages } from './spec.js';
import { slimPdf } from './slim.js';

// 브라우저는 AppData 가 아니라 이 폴더의 node_modules 안에 둔다(npm run setup-browser 와 같은 위치).
// AppData 에 두면 설치한 프로그램과 작업 스케줄러가 서로 다른 곳을 볼 수 있다(MSIX 앱 안에서 설치한 경우 등).
process.env.PLAYWRIGHT_BROWSERS_PATH ||= '0';
const { chromium } = await import('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = Number((args[args.indexOf('--limit') + 1] || '').replace(/\D/g, '')) || Infinity;

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const logFile = path.join(LOGS, `${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };

// 물건별로 마지막 상세 수집 시각·가격을 기억해서, 바뀐 것만 상세를 다시 연다
const seenFile = path.join(STATE, 'seen.json');
const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : {};
const saveSeen = () => fs.writeFileSync(seenFile, JSON.stringify(seen));
const badFile = path.join(STATE, 'bad-rows.json');
const badRows = fs.existsSync(badFile) ? JSON.parse(fs.readFileSync(badFile, 'utf8')) : {};
const progressFile = path.join(STATE, 'progress.json');
const progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : {};
const saveProgress = () => fs.writeFileSync(progressFile, JSON.stringify(progress));

// 상세 읽기 판: 2 = 사건번호로 상세가 이 물건 것인지 확인한 뒤 읽음 / 3 = 매각물건명세서(PDF)까지 읽음
//  4 = 첨부 원본(감정평가서·현황조사서·매각물건명세서 PDF)과 사진까지 받아 하드에 보관·사이트에 올림(그 전 판은 다시 읽는다)
const DETAIL_V = 4;
const SIDO = (court) => (/서울/.test(court) ? '서울특별시' : /^인천지방법원$/.test(court) ? '인천광역시' : '경기도');

function toItem(row, detail) {
  const addr = detail?.address || row.address || '';
  const parts = addr.split(/\s+/);
  const sido = /서울|인천|경기/.test(parts[0] || '') ? parts[0].replace(/^서울$/, '서울특별시').replace(/^인천$/, '인천광역시').replace(/^경기$/, '경기도') : SIDO(row.court);
  const sgg = parts[1] && /[시군구]$/.test(parts[1]) ? (parts[2] && /구$/.test(parts[2]) ? `${parts[1]} ${parts[2]}` : parts[1]) : undefined;
  // 도로명 주소면 동이 괄호 안에 있다: '... (대림동, 유탑유블레스)'
  const emd = parts.find((p) => /[동읍면리가]$/.test(p) && p !== sgg) || (addr.match(/\(\s*([가-힣0-9]+(?:동|가|읍|면|리))\s*[,)]/) || [])[1];
  return {
    caseNo: row.caseNo, itemNo: row.itemNo || '1', court: row.court, title: detail?.title || `${addr.split(' ').slice(1, 4).join(' ')} ${row.usage || ''}`.trim(),
    usage: detail?.usage || row.usage, address: addr, sido, sgg, emd, pnu: detail?.pnu,
    appraisal: row.appraisal, minBid: row.minBid, failCount: row.failCount, bidEnd: row.bidEnd, status: row.status || '진행',
    landArea: detail?.landArea, buildingArea: detail?.buildingArea, share: detail?.share, shareRatio: detail?.shareRatio, bulk: detail?.bulk,
    thumbnail: detail?.photos?.[0], url: 'https://www.courtauction.go.kr', detailVer: detail ? DETAIL_V : undefined,
    detail: detail ? {
      photos: detail.photos || [], location: detail.appraisalSummary, shareText: detail.shareText, conditions: detail.specialConditions, baseRightDate: detail.baseRightDate,
      leases: detail.leases || [], survivingRights: detail.survivingRights, superficies: detail.superficies, documents: detail.documents || [],
      photoCount: detail.photoCount, appraisalPdf: detail.appraisalPdf, sharedDocs: detail.sharedDocs,
      // 문서별 이 물건 관련 쪽(여러 물건이 든 문서일 때 분석·화면이 이 쪽만 보게)
      docPages: detail.docInfo ? Object.fromEntries(Object.entries(detail.docInfo).filter(([, v]) => v?.pages?.length).map(([k, v]) => [k, v.pages])) : undefined,
      // 매각물건명세서: specRead=true 일 때만 '권리 확인됨'(아니면 분석기는 권리 미확인으로 봄)
      specRead: Boolean(detail.spec?.read), specWhy: detail.spec?.read ? undefined : detail.spec?.why,
      baseRightType: detail.spec?.baseRightType, distributionDeadline: detail.spec?.distributionDeadline,
      tenantNote: detail.spec?.tenantNote, specRemarks: detail.spec?.remarks, assumedAmount: detail.spec?.assumedAmount, opposableTenants: detail.spec?.opposable,
      rounds: (detail.rounds || []).map((r) => ({ round: r.round, start: r.date, minBid: r.minBid, open: r.date, result: r.result })),
      flags: {
        superficies: Boolean(detail.superficies && !/없음|해당\s*없/.test(detail.superficies)),
        survivingRights: Boolean(detail.survivingRights && !/없음|해당\s*없/.test(detail.survivingRights)),
        specRead: Boolean(detail.spec?.read),
        opposableTenants: detail.spec?.opposable || 0,
        tenants: (detail.leases || []).length,
        unclaimedTenants: (detail.leases || []).filter((l) => !l.claimed).length,
      },
    } : undefined,
  };
}

// 서버가 잠깐 느리거나(504) 끊겨도 회차를 접지 않도록: 기다렸다 다시 보낸다.
//  토큰 오류(401)·잘못된 요청(400)처럼 다시 보내도 같은 결과인 것은 바로 멈춘다.
const RETRY_WAITS = [30, 60, 120]; // 초
const MAX_UPLOAD_FAILS = 3; // 다시 보내기까지 다 실패한 묶음이 연달아 이만큼이면 이번 회차는 멈춘다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class UploadDown extends Error {}

async function postOnce(items, run) {
  const res = await fetch(env.INGEST_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INGEST_TOKEN}` },
    body: JSON.stringify({ items, run }), signal: AbortSignal.timeout(330e3), // 서버 제한(300초)보다 조금 길게
  });
  const text = await res.text();
  if (!res.ok) { const e = new Error(`업로드 실패 HTTP ${res.status} ${text.slice(0, 200)}`); e.retry = res.status >= 500 || res.status === 429; throw e; }
  return text;
}

async function upload(items, run) {
  if (DRY) {
    fs.writeFileSync(path.join(STATE, 'test-run.json'), JSON.stringify(items, null, 2));
    log(`(시험) 올리지 않음: ${items.length}건 — 전체는 state/test-run.json, 첫 건: ${JSON.stringify(items[0] || {}).slice(0, 300)}`); return;
  }
  if (!env.INGEST_URL || !env.INGEST_TOKEN) { const e = new Error('.env 에 INGEST_URL, INGEST_TOKEN 이 없습니다'); e.retry = false; throw e; }
  for (let i = 0; ; i++) {
    try { log(`업로드: ${(await postOnce(items, run)).slice(0, 300)}`); return; } catch (e) {
      // 네트워크 끊김·제한시간 초과는 e.retry 가 없음 → 다시 보냄
      if (e.retry === false || i >= RETRY_WAITS.length) throw e;
      log(`${e.message} — ${RETRY_WAITS[i]}초 뒤 다시 보냄(${i + 1}/${RETRY_WAITS.length})`);
      await sleep(RETRY_WAITS[i] * 1000);
    }
  }
}

// 같은 수집기가 두 개 동시에 돌지 않게(작업을 멈춰도 node 가 남아 있는 경우) — 살아 있는 쪽이 있으면 이번 것은 그냥 끝낸다
const lockFile = path.join(STATE, 'run.lock');
function takeLock() {
  if (DRY) return true;
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    if (pid && pid !== process.pid) { try { process.kill(pid, 0); log(`이미 다른 수집기(pid ${pid})가 돌고 있어 이번 실행은 하지 않음`); return false; } catch { /* 죽은 잠금 — 넘어감 */ } }
  } catch { /* 잠금 파일 없음 */ }
  fs.writeFileSync(lockFile, String(process.pid));
  return true;
}
function releaseLock() {
  try { if (Number(fs.readFileSync(lockFile, 'utf8')) === process.pid) fs.unlinkSync(lockFile); } catch { /* 없음 */ }
}

const files = new FileStore({ root: ROOT, stateDir: STATE, env, log, dry: DRY });
const slimStats = { n: 0, before: 0, after: 0 }; // 사이트용으로 줄인 PDF 수·줄이기 전후 용량
const appraisalKinds = {}; // 감정평가서: text=글자 PDF, scan=스캔본(글자 없음), broken=글꼴 깨짐

// 상세를 읽은 물건의 첨부를 받는다: 사진(화면에 있음) + 감정평가서·현황조사서 팝업 PDF + 명세서 PDF(이미 받은 것)

// 사이트에 올릴 PDF: 글자·쪽은 그대로 두고 사진만 화면용으로 줄인 것. 쪽 수나 글자가 원본과 다르면 원본 그대로 올린다.
async function sitePdf(buf, name, caseNo) {
  try {
    const r = await slimPdf(buf);
    if (!r.changed) return null;
    const [a, b] = await Promise.all([pdfText(buf), pdfText(r.buf)]);
    if (a.replace(/\s/g, '') !== b.replace(/\s/g, '')) { log(`${name} 줄이기 후 글자가 달라 원본 사용 ${caseNo}`); return null; }
    slimStats.before += r.before; slimStats.after += r.after; slimStats.n++;
    return r.buf;
  } catch (e) { log(`${name} 줄이기 실패(원본 사용) ${caseNo}: ${e.message}`); return null; }
}

// 병합·중복사건: 감정평가서·현황조사서 하나에 여러 사건·여러 물건이 함께 들어 있을 수 있다.
//  → 문서에 나오는 사건번호들(cases)과 이 물건 주소(지번·도로명·동호수)가 나오는 쪽(pages)을 찾아 둔다.
//    분석·화면은 이 쪽을 보고, 다른 물건 내용을 이 물건 것으로 읽지 않게 한다.
const squash = (t) => String(t || '').replace(/\s+/g, '');
function addrKeys(addr) {
  const a = String(addr || '');
  const keys = [];
  const j = a.match(/([가-힣][가-힣0-9]*(?:동|가|리))\s+(산\s*)?(\d+(?:-\d+)?)/); // '101동 1203호'의 동은 제외(한글로 시작하는 동만)
  if (j) keys.push(`${j[1]}${j[2] ? '산' : ''}${j[3]}`);
  const r = a.match(/([가-힣][가-힣0-9]*(?:로|길))\s*(\d+(?:-\d+)?)/);
  if (r) keys.push(`${r[1]}${r[2]}`);
  const ho = (a.match(/(?:제\s*)?(\d+)\s*호/) || [])[1];
  const dong = (a.match(/(?:제\s*)?(\d+)\s*동(?!\S*[가-힣]동)/) || [])[1];
  return { keys, ho, dong };
}
function docInfo(pages, addr) {
  const all = pages.join('\n');
  const cases = [...new Set((all.match(/\d{4}\s*타경\s*\d+/g) || []).map(squash))];
  const { keys, ho, dong } = addrKeys(addr);
  const hit = []; const strong = [];
  pages.forEach((t, i) => {
    const q = squash(t);
    if (!keys.some((k) => q.includes(k))) return;
    hit.push(i + 1);
    if (ho && q.includes(`${ho}호`) && (!dong || q.includes(`${dong}동`))) strong.push(i + 1);
  });
  return { cases, pages: (strong.length ? strong : hit).slice(0, 40), multi: cases.length > 1, totalPages: pages.length };
}

// 같은 사건의 다른 물건번호가 최근에 받은 문서 — 다시 열지 않고 이어 쓴다(하루 화면 수 아낌)
const docSeenFile = path.join(STATE, 'doc-seen.json');
const docSeen = fs.existsSync(docSeenFile) ? JSON.parse(fs.readFileSync(docSeenFile, 'utf8')) : {};
const saveDocSeen = () => fs.writeFileSync(docSeenFile, JSON.stringify(docSeen));

async function keepAttachments(page, pace, row, detail) {
  const base = { court: row.court, caseNo: row.caseNo, itemNo: row.itemNo || '1' };
  const addr = detail.address || row.address;
  (detail.photoData || []).forEach((ph, i) => {
    const kind = `사진${String(i + 1).padStart(2, '0')}`;
    files.keep({ ...base, kind, buf: ph.orig, ext: ph.origExt, upBuf: ph.small, upExt: 'jpg' });
  });
  const got = {};
  detail.docInfo = {};
  const pdfMeta = async (buf, name) => {
    try { const info = docInfo(await pdfPages(buf), addr); detail.docInfo[name] = info; return info; } catch { return {}; }
  };
  if (detail.spec?.pdf) {
    const meta = await pdfMeta(detail.spec.pdf, '매각물건명세서');
    const small = await sitePdf(detail.spec.pdf, '매각물건명세서', row.caseNo);
    files.keepDoc({ ...base, kind: '매각물건명세서', buf: detail.spec.pdf, upBuf: small, meta });
    got['매각물건명세서'] = detail.spec.how;
  }
  const base2 = files.folderOf(row.court, row.caseNo, row.itemNo || '1');
  let photoNo = (detail.photoData || []).length;
  // 감정평가서는 받지 않는다(2026-10-26 결정): 법원 화면 안에서 한국감정평가사협회 뷰어로만 보여 주고
  //  "무단 복제 및 링크하여 사용하는 경우 형사처벌" 경고가 붙어 있음 + 실제로도 거의 다 못 받으면서 화면 수만 썼음.
  //  감정평가 내용은 상세 화면의 '감정평가요항표 요약'(appraisalSummary)으로 대신하고, 원문은 법원 사이트에서 직접 본다.
  //  다시 켜려면 config.json 에 "fetchAppraisal": true (권하지 않음)
  for (const name of cfg.fetchAppraisal ? ['감정평가서', '현황조사서'] : ['현황조사서']) {
    if (!(detail.documents || []).some((d) => d.name === name)) continue;
    const seenKey = `${row.court}_${squash(row.caseNo)}_${name}`;
    const prev = docSeen[seenKey];
    // 같은 사건 다른 물건번호가 7일 안에 받은 것이 있으면 그대로 쓴다(쪽 찾기는 이 물건 주소로 다시)
    if (prev && Date.now() - prev.at < cfg.refreshDetailAfterDays * 86400e3) {
      let ok = false;
      if (prev.hash) {
        let meta = prev.meta || {};
        try { const ent = files.index[prev.hash]; if (ent && fs.existsSync(ent.orig)) meta = await pdfMeta(fs.readFileSync(ent.orig), name); } catch { /* 쪽 찾기 실패 — 전체 문서로 */ }
        ok = files.reuseDoc({ ...base, kind: name, hash: prev.hash, meta });
      }
      if (prev.textFile && fs.existsSync(prev.textFile)) { files.keepText({ ...base, kind: name, file: prev.textFile }); detail.docInfo[name] = prev.textInfo; ok = true; }
      for (const ph of prev.photos || []) {
        if (photoNo >= 30 || !fs.existsSync(ph.up)) continue;
        photoNo++; files.keepFile({ ...base, kind: `사진${String(photoNo).padStart(2, '0')}`, path: ph.up, contentType: 'image/jpeg' });
      }
      if (ok) { got[name] = 'reuse'; continue; }
    }
    if (!pace.canContinue()) break;
    await pace.beforePage();
    const r = await fetchDocPdf(page, name, { log, waitSec: name === '감정평가서' ? 45 : 25, html: name === '현황조사서' });
    const seen = { at: Date.now(), photos: [] };
    if (r.pdf) {
      const meta = await pdfMeta(r.pdf, name);
      const small = await sitePdf(r.pdf, name, row.caseNo);
      seen.hash = files.keepDoc({ ...base, kind: name, buf: r.pdf, upBuf: small, meta });
      got[name] = r.how;
    }
    // 현황조사서 글자 화면: 원문 글자를 그대로 저장(OCR 없음)하고, 팝업 안 사진도 사진 번호를 이어서 받는다
    if (r.text) {
      fs.mkdirSync(base2, { recursive: true });
      const tf = path.join(base2, `${name}.txt`);
      fs.writeFileSync(tf, r.text);
      // 점유자 이름 등이 있어 공개 물건 정보에는 넣지 않고 관리자 전용(courtFiles)으로만 보낸다
      files.keepText({ ...base, kind: name, file: tf });
      const cases = [...new Set((r.text.match(/\d{4}\s*타경\s*\d+/g) || []).map(squash))];
      detail.docInfo[name] = { cases, multi: cases.length > 1 };
      seen.textFile = tf; seen.textInfo = detail.docInfo[name];
      got[name] = got[name] || 'html';
    }
    for (const ph of r.photos || []) {
      if (photoNo >= 30) break;
      photoNo++;
      const kind = `사진${String(photoNo).padStart(2, '0')}`;
      files.keep({ ...base, kind, buf: ph.orig, ext: ph.origExt, upBuf: ph.small, upExt: 'jpg' });
      seen.photos.push({ up: path.join(base2, `${kind}_사이트용.jpg`) });
    }
    if (seen.hash || seen.textFile) { docSeen[seenKey] = seen; saveDocSeen(); }
    // 감정평가서: 글자 PDF인지(드래그되는 문서) 스캔본인지 확인하고, 글자는 하드에 함께 저장(나중에 핵심 문장 걸러내기에 씀)
    if (name === '감정평가서' && r.pdf) {
      try {
        const t = await pdfText(r.pdf);
        const n = t.replace(/\s/g, '').length;
        const hangul = (t.match(/[가-힣]/g) || []).length;
        const kind = n < 500 ? 'scan' : hangul / n < 0.2 ? 'broken' : 'text';
        detail.appraisalPdf = { textKind: kind, chars: n };
        fs.mkdirSync(base2, { recursive: true });
        if (kind !== 'scan') fs.writeFileSync(path.join(base2, '감정평가서.txt'), t);
        appraisalKinds[kind] = (appraisalKinds[kind] || 0) + 1;
      } catch (e) { appraisalKinds.error = (appraisalKinds.error || 0) + 1; log(`감정평가서 글자 확인 실패 ${row.caseNo}: ${e.message}`); }
    }
    if (!r.pdf && !r.text) log(`${name} 못 받음 ${row.caseNo}: ${r.why}`);
  }
  // 사이트에는 '무엇을 받았는지'만 적는다(열기 주소는 서버가 관리자 전용으로 따로 둠)
  detail.documents = (detail.documents || []).map((d) => ({ name: d.name, got: Boolean(got[d.name]) }));
  detail.photoCount = photoNo;
  // 문서에 다른 사건이 함께 있으면 표시 — 분석기는 이 물건 쪽(pages)만 근거로 써야 함
  const multi = Object.entries(detail.docInfo).filter(([, v]) => v?.multi);
  if (multi.length) {
    detail.sharedDocs = Object.fromEntries(multi.map(([k, v]) => [k, { cases: v.cases.slice(0, 20), pages: v.pages || [] }]));
    log(`여러 사건이 든 문서 ${row.caseNo}: ${multi.map(([k, v]) => `${k}(${v.cases.join(',')})`).join(' / ')}`);
  }
  delete detail.photoData;
  if (detail.spec) delete detail.spec.pdf;
}

async function main() {
  if (!cfg.enabled && !DRY) { log('config.json 의 enabled 가 false — 실행하지 않음'); return; }
  if (DRY) cfg.allowedHours = [0, 24]; // 시험(--dry)은 낮에도 돌려 볼 수 있게 시간대 제한을 풂(화면 간 쉬는 시간은 그대로)
  const pace = new Pace(cfg, STATE, log);
  if (!DRY && !pace.canContinue()) return; // 오늘 한도를 이미 채웠거나 시간대 밖이면 사이트에 접속하지 않음
  let browser = null; let page = null;
  const open = async () => {
    browser = await chromium.launch({ headless: cfg.headless !== false });
    page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 1366, height: 900 } })).newPage();
  };
  await open();
  // lastError: 이번 회차 마지막 오류(상태판에 보임, 없으면 null로 지움) · files: 첨부 저장·올리기 수
  const stats = { listed: 0, detailed: 0, uploaded: 0, stoppedBy: null, lastError: null, attachErrors: 0, files: files.stats };
  let buffer = [];
  let uploadFails = 0;
  let flushAt = cfg.uploadBatch; // 실패한 뒤에는 한 묶음이 더 쌓였을 때 다시 시도(물건 하나마다 재시도하지 않게)
  // 한 묶음(uploadBatch)씩 보낸다. 다시 보내기까지 실패하면 그 물건들은 들고 있다가 다음에 함께 보내고 수집은 계속한다.
  const flush = async () => {
    while (buffer.length) {
      const chunk = buffer.slice(0, cfg.uploadBatch);
      try { await upload(chunk, { ...stats, at: new Date().toISOString() }); } catch (e) {
        if (e.retry === false) throw e;
        uploadFails++;
        if (uploadFails >= MAX_UPLOAD_FAILS) throw new UploadDown(`서버 전송이 ${uploadFails}번 연달아 실패: ${e.message}`);
        flushAt = buffer.length + cfg.uploadBatch;
        log(`업로드 보류(${uploadFails}/${MAX_UPLOAD_FAILS}): ${buffer.length}건은 들고 있다가 다음에 다시 보냄 — ${e.message}`);
        return;
      }
      uploadFails = 0; stats.uploaded += chunk.length; buffer = buffer.slice(chunk.length);
      // 물건이 서버에 생긴 뒤에 그 물건의 첨부를 올린다
      await files.upload(chunk.map((it) => listingIdOf(it.court, it.caseNo, it.itemNo)));
    }
    flushAt = cfg.uploadBatch;
  };
  try {
    // 지난번에 못 올린 첨부부터 보낸다(물건은 이미 서버에 있음)
    if (files.pending.length) { log(`밀린 첨부 ${files.pending.length}개 올리기`); await files.upload(); }
    // 법원 사이트가 잠깐 느려 화면이 안 뜨는 오류(waitFor… Timeout 등)로 회차를 통째로 접지 않는다:
    //  5분 쉬고 브라우저를 새로 열어 같은 법원부터 이어감(이미 읽은 물건은 상세를 안 엶). 한 회차에 3번까지.
    // 집중 지역(config.focus): 회차마다 먼저 그 지역 법원을 돌며 상세(명세서·첨부)는 그 지역 물건만 연다 — 범위를 좁혀 먼저 100% 채우기(2026-10-26)
    //  집중 지역을 한 바퀴 다 돈 뒤 시간·화면 수가 남으면 나머지 법원(서울·경기 등)을 평소처럼 이어서 돈다(2026-10-27, 남는 시간 쉬지 않게)
    //  나머지 법원은 progress.restCourt 로 따로 이어 감(다음 회차에도 멈춘 법원부터)
    const focus = cfg.focus?.courts?.length ? cfg.focus : null;
    const focusRe = focus?.address ? new RegExp(focus.address) : null;
    // 검토 범위(config.focus.scope): 용도·최저가 상한에 맞는 물건은 집중 지역 밖이어도 상세(원본 PDF·사진)를 연다 — 제이옥션 차단 대체(2026-10-30)
    const scopeRules = (focus?.scope || []).map((r) => ({ re: new RegExp(r.usage), max: r.maxMinBid }));
    const inScope = (row) => scopeRules.some((r) => r.re.test(String(row.usage || '')) && Number(row.minBid || 0) > 0 && Number(row.minBid) <= r.max);
    // 매각(종료)되면 대법원 서류가 내려가므로, 매각기일이 가까운 검토 범위 물건부터 상세를 연다(2026-10-31)
    //  1단계 '급한 것': 집중 지역 + 검토 범위 중 매각기일 urgentDays(기본 6일) 안 → 2단계 '검토 범위': 나머지 검토 범위 → 3단계: 그 밖(목록만)
    const urgentDays = cfg.focus?.urgentDays || 6;
    const daysLeft = (row) => { const m = String(row.bidEnd || '').match(/(\d{4})\.(\d{2})\.(\d{2})/); if (!m) return 99; return Math.floor((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(...kstDay().split('-').map((x, i) => (i === 1 ? +x - 1 : +x)))) / 86400e3); };
    const urgentRe = { test: (s, row) => (focusRe && focusRe.test(s)) || (inScope(row) && daysLeft(row) <= urgentDays) };
    const phases = focus
      ? [{ name: '급한 것', list: focus.courts, key: 'court', re: urgentRe },
        ...(scopeRules.length ? [{ name: '검토 범위', list: focus.courts, key: 'scopeCourt', re: { test: (s, row) => (focusRe && focusRe.test(s)) || inScope(row) } }] : []),
        { name: '나머지', list: cfg.courts.filter((c) => !focus.courts.includes(c)), key: 'restCourt', re: null }]
      : [{ name: '전체', list: cfg.courts, key: 'court', re: null }];
    let phaseAt = 0; // 화면 오류로 다시 열어도 끝난 단계는 다시 돌지 않음
    const collect = async () => {
     for (; phaseAt < phases.length; phaseAt++) {
      const ph = phases[phaseAt];
      const courtList = ph.list;
      if (!courtList.length) continue;
      if (phaseAt > 0) log(`${phases[phaseAt - 1].name} 법원을 다 돌아 ${ph.name} 법원으로 넘어감`);
      // 지난번에 멈춘 법원부터 이어서
      const start = Math.max(0, courtList.indexOf(progress[ph.key] || ''));
      const courts = [...courtList.slice(start), ...courtList.slice(0, start)];
      outer: for (let ci = 0; ci < courts.length; ci++) {
        const court = courts[ci];
        progress[ph.key] = court; saveProgress();
        log(`법원: ${court}`);
        for await (const row of listCourt(page, court, pace)) {
          // 한동안 봤으면 끊고 쉰다: 올릴 것 올리고, 브라우저 닫고, 쉬었다가 같은 법원 처음부터 다시(이미 본 물건은 상세를 안 엶)
          if (!DRY && pace.sessionOver()) {
            await flush(); await browser.close(); browser = null;
            await pace.restBetweenSessions();
            if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break outer; }
            await open(); ci--; continue outer;
          }
          if (!row) continue;
          stats.listed++;
          const key = `${row.court}_${row.caseNo}_${row.itemNo || 1}`;
          const prev = seen[key];
          let stale = !prev || prev.v !== DETAIL_V || prev.minBid !== row.minBid || prev.status !== row.status || Date.now() - (prev.at || 0) > cfg.refreshDetailAfterDays * 86400e3;
          let detail = null;
          // 같은 물건에서 화면 오류가 두 번 나면 오늘은 건너뛴다(한 물건 때문에 회차가 계속 같은 자리에서 멈추던 문제 대비)
          if (stale && ph.re && !ph.re.test(`${row.address || ''} ${row.title || ''}`, row)) stale = false; // 이 단계 대상이 아니면 목록 정보만(다음 단계에서 엶)
          if (stale && (badRows[key]?.n || 0) >= 2 && Date.now() - badRows[key].at < 86400e3) { stale = false; log(`건너뜀(화면 오류 반복): ${row.caseNo}`); }
          if (stale) {
            if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break outer; }
            await pace.beforePage();
            try { await row.open(); } catch (e) {
              badRows[key] = { n: (badRows[key]?.n || 0) + 1, at: Date.now() }; fs.writeFileSync(badFile, JSON.stringify(badRows));
              throw e;
            }
            detail = await readDetail(page);
            // 상세가 이 물건 것인지 확인: 사건번호가 다르면 상세를 버리고 목록 정보만 올린다(다음에 다시 읽음)
            const cn = (x) => String(x || '').replace(/\s/g, '');
            if (detail && detail.caseText && !cn(detail.caseText).includes(cn(row.caseNo))) {
              log(`상세 어긋남: 목록 ${row.caseNo} ↔ 상세 ${detail.caseText} — 상세 버림`);
              detail = null;
            }
            // 매각물건명세서(새 창 PDF) — 말소기준권리·임차인·인수 권리·지상권·비고를 여기서만 알 수 있다
            // 명세서는 매각기일 1주 전쯤 올라온다 — 상세 화면에 버튼이 없으면 열지 않는다(화면 수 아낌, '버튼 없음' 실패로 세지 않음)
            const specListed = detail && (detail.documents || []).some((d) => d.name === '매각물건명세서');
            if (detail && !specListed) detail.spec = { read: false, why: '명세서 아직 게시 전' };
            if (detail && specListed) {
              await pace.beforePage();
              const spec = await readSpecDoc(page, { log });
              detail.spec = spec;
              if (spec.read) {
                detail.baseRightDate = spec.baseRightDate || detail.baseRightDate;
                detail.leases = spec.leases || [];
                detail.survivingRights = spec.survivingRights;
                if (spec.superficies) detail.superficies = spec.superficies;
                stats.specRead = (stats.specRead || 0) + 1;
              } else { stats.specMissed = (stats.specMissed || 0) + 1; log(`명세서 못 읽음 ${row.caseNo}: ${spec.why}`); }
            }
            if (detail) {
              // 첨부 원본: 사진 + 감정평가서·현황조사서(팝업) — 사람이 버튼을 눌러 보는 것과 같은 요청, 화면 수에 넣어 셈
              // 첨부에서 오류가 나도 회차 전체를 멈추지 않는다(물건 정보는 그대로 올리고, 오류는 상태판에 남김)
              try { await keepAttachments(page, pace, row, detail); } catch (e) {
                stats.attachErrors++; stats.lastError = `첨부 ${row.caseNo}: ${e.message}`.slice(0, 300);
                log(`첨부 받기 오류(건너뜀) ${row.caseNo}: ${e.stack || e.message}`);
                delete detail.photoData; if (detail.spec) delete detail.spec.pdf;
                for (const p of await page.context().pages()) if (p !== page) await p.close().catch(() => {}); // 열린 문서 창 정리
              }
            }
            await backToList(page);
            stats.detailed++;
            if (detail) { seen[key] = { minBid: row.minBid, status: row.status, at: Date.now(), v: DETAIL_V }; saveSeen(); }
          }
          buffer.push(toItem(row, detail));
          if (buffer.length >= flushAt) await flush();
          if (stats.detailed >= LIMIT) { stats.stoppedBy = 'test-limit'; break outer; }
          if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break outer; }
        }
        progress[ph.key] = courtList[(courtList.indexOf(court) + 1) % courtList.length]; saveProgress();
      }
      // break outer(한도·시간대 끝)로 나왔으면 다음 단계로 넘어가지 않음
      if (stats.stoppedBy) return;
     }
    };
    for (let retries = 0; ; retries++) {
      try { await collect(); break; } catch (e) {
        if (DRY || e instanceof Blocked || e instanceof UploadDown || e.retry === false || retries >= 3) throw e;
        log(`화면 오류(${retries + 1}/3): ${e.message.split('\n')[0]} — 5분 쉬고 브라우저를 새로 열어 이어감`);
        try { await flush(); } catch (e2) { log(`업로드 오류: ${e2.message}`); }
        if (browser) await browser.close().catch(() => {});
        browser = null;
        await sleep(300e3);
        if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break; }
        await open();
      }
    }
    await flush();
  } catch (e) {
    stats.stoppedBy = e instanceof Blocked ? 'blocked' : e instanceof UploadDown ? 'upload' : 'error';
    stats.lastError = String(e.message || e).slice(0, 300);
    log(`${e instanceof Blocked ? '차단 감지' : e instanceof UploadDown ? '서버 전송 중단' : '오류'}: ${e.message}`);
    if (!(e instanceof UploadDown)) { try { await flush(); } catch (e2) { log(`업로드 오류: ${e2.message}`); } }
    if (e instanceof Blocked) fs.writeFileSync(path.join(STATE, 'blocked.txt'), `${new Date().toISOString()} ${e.message}\n`);
  } finally {
    if (browser) await browser.close();
    // 끝내 못 보낸 물건은 '읽음' 표시를 지워 다음 회차에 상세를 다시 읽어 보내게 한다(안 그러면 7일 동안 빠짐)
    if (buffer.length && !DRY) {
      for (const it of buffer) delete seen[`${it.court}_${it.caseNo}_${it.itemNo || 1}`];
      saveSeen();
      log(`못 보낸 ${buffer.length}건은 다음 회차에 다시 읽음`);
    }
    stats.files = { ...files.stats, pending: files.pending.length, appraisal: appraisalKinds, slim: { n: slimStats.n, beforeMB: +(slimStats.before / 1048576).toFixed(1), afterMB: +(slimStats.after / 1048576).toFixed(1) } };
    log(`끝: ${JSON.stringify(stats)} / 오늘 연 화면 ${pace.count} / 원본 보관 폴더 ${files.dir}`);
  }
}

if (fs.existsSync(path.join(STATE, 'blocked.txt')) && !DRY) {
  log('지난 실행에서 차단이 감지되어 멈춰 있습니다. 확인 후 state/blocked.txt 를 지우면 다시 돌아갑니다.');
} else {
  // 브라우저 실행 실패처럼 try 밖에서 난 오류도 로그에 남긴다(작업 스케줄러로 돌 때는 화면 출력이 안 보임)
  if (!takeLock()) process.exit(0);
  process.on('exit', releaseLock);
  main().catch((e) => {
    log(`실행 오류: ${e.stack || e.message}`);
    try { fs.statSync(chromium.executablePath()); } catch (e2) { log(`진단: 브라우저 파일 확인 실패 ${e2.code} ${e2.message} / LOCALAPPDATA=${process.env.LOCALAPPDATA} USERPROFILE=${process.env.USERPROFILE} PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH || ''}`); }
    process.exitCode = 1;
  });
}
