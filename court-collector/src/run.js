// 법원경매 수집기 실행 — 매일 새벽 작업 스케줄러가 부른다.
//  node src/run.js            보통 실행
//  node src/run.js --limit 3 --dry   3건만 읽고 서버에 올리지 않음(시험)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pace, kstDay } from './pace.js';
import { listCourt, readDetail, backToList, Blocked } from './site.js';

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
const progressFile = path.join(STATE, 'progress.json');
const progress = fs.existsSync(progressFile) ? JSON.parse(fs.readFileSync(progressFile, 'utf8')) : {};
const saveProgress = () => fs.writeFileSync(progressFile, JSON.stringify(progress));

const SIDO = (court) => (/서울/.test(court) ? '서울특별시' : /^인천지방법원$/.test(court) ? '인천광역시' : '경기도');

function toItem(row, detail) {
  const addr = detail?.address || row.address || '';
  const parts = addr.split(/\s+/);
  const sido = /서울|인천|경기/.test(parts[0] || '') ? parts[0].replace(/^서울$/, '서울특별시').replace(/^인천$/, '인천광역시').replace(/^경기$/, '경기도') : SIDO(row.court);
  const sgg = parts[1] && /[시군구]$/.test(parts[1]) ? (parts[2] && /구$/.test(parts[2]) ? `${parts[1]} ${parts[2]}` : parts[1]) : undefined;
  const emd = parts.find((p) => /[동읍면리가]$/.test(p) && p !== sgg);
  return {
    caseNo: row.caseNo, itemNo: row.itemNo || '1', court: row.court, title: detail?.title || `${addr.split(' ').slice(1, 4).join(' ')} ${row.usage || ''}`.trim(),
    usage: detail?.usage || row.usage, address: addr, sido, sgg, emd, pnu: detail?.pnu,
    appraisal: row.appraisal, minBid: row.minBid, failCount: row.failCount, bidEnd: row.bidEnd, status: row.status || '진행',
    landArea: detail?.landArea, buildingArea: detail?.buildingArea, share: detail?.share, bulk: detail?.bulk,
    thumbnail: detail?.photos?.[0], url: 'https://www.courtauction.go.kr',
    detail: detail ? {
      photos: detail.photos || [], location: detail.appraisalSummary, conditions: detail.specialConditions, baseRightDate: detail.baseRightDate,
      leases: detail.leases || [], survivingRights: detail.survivingRights, superficies: detail.superficies, documents: detail.documents || [],
      rounds: (detail.rounds || []).map((r) => ({ round: r.round, start: r.date, minBid: r.minBid, open: r.date, result: r.result })),
      flags: {
        superficies: Boolean(detail.superficies && !/없음|해당\s*없/.test(detail.superficies)),
        survivingRights: Boolean(detail.survivingRights && !/없음|해당\s*없/.test(detail.survivingRights)),
        tenants: (detail.leases || []).length,
        unclaimedTenants: (detail.leases || []).filter((l) => !l.claimed).length,
      },
    } : undefined,
  };
}

async function upload(items, run) {
  if (DRY) {
    fs.writeFileSync(path.join(STATE, 'test-run.json'), JSON.stringify(items, null, 2));
    log(`(시험) 올리지 않음: ${items.length}건 — 전체는 state/test-run.json, 첫 건: ${JSON.stringify(items[0] || {}).slice(0, 300)}`); return;
  }
  if (!env.INGEST_URL || !env.INGEST_TOKEN) throw new Error('.env 에 INGEST_URL, INGEST_TOKEN 이 없습니다');
  const res = await fetch(env.INGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INGEST_TOKEN}` }, body: JSON.stringify({ items, run }) });
  if (!res.ok) throw new Error(`업로드 실패 HTTP ${res.status} ${await res.text()}`);
  log(`업로드: ${JSON.stringify(await res.json())}`);
}

async function main() {
  if (!cfg.enabled && !DRY) { log('config.json 의 enabled 가 false — 실행하지 않음'); return; }
  if (DRY) cfg.allowedHours = [0, 24]; // 시험(--dry)은 낮에도 돌려 볼 수 있게 시간대 제한을 풂(화면 간 쉬는 시간은 그대로)
  const pace = new Pace(cfg, STATE, log);
  if (!DRY && !pace.canContinue()) return; // 오늘 한도를 이미 채웠거나 시간대 밖이면 사이트에 접속하지 않음
  const browser = await chromium.launch({ headless: cfg.headless !== false });
  const page = await (await browser.newContext({ locale: 'ko-KR', viewport: { width: 1366, height: 900 } })).newPage();
  const stats = { listed: 0, detailed: 0, uploaded: 0, stoppedBy: null };
  let buffer = [];
  const flush = async () => { if (buffer.length) { await upload(buffer, { ...stats, at: new Date().toISOString() }); stats.uploaded += buffer.length; buffer = []; } };
  try {
    // 지난번에 멈춘 법원부터 이어서
    const start = Math.max(0, cfg.courts.indexOf(progress.court || ''));
    const courts = [...cfg.courts.slice(start), ...cfg.courts.slice(0, start)];
    outer: for (const court of courts) {
      progress.court = court; saveProgress();
      log(`법원: ${court}`);
      for await (const row of listCourt(page, court, pace)) {
        if (!row) continue;
        stats.listed++;
        const key = `${row.court}_${row.caseNo}_${row.itemNo || 1}`;
        const prev = seen[key];
        const stale = !prev || prev.minBid !== row.minBid || prev.status !== row.status || Date.now() - (prev.at || 0) > cfg.refreshDetailAfterDays * 86400e3;
        let detail = null;
        if (stale) {
          if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break outer; }
          await pace.beforePage();
          await row.open();
          detail = await readDetail(page);
          await backToList(page);
          stats.detailed++;
          seen[key] = { minBid: row.minBid, status: row.status, at: Date.now() }; saveSeen();
        }
        buffer.push(toItem(row, detail));
        if (buffer.length >= cfg.uploadBatch) await flush();
        if (stats.detailed >= LIMIT) { stats.stoppedBy = 'test-limit'; break outer; }
        if (!pace.canContinue()) { stats.stoppedBy = 'limit'; break outer; }
      }
      progress.court = cfg.courts[(cfg.courts.indexOf(court) + 1) % cfg.courts.length]; saveProgress();
    }
    await flush();
  } catch (e) {
    stats.stoppedBy = e instanceof Blocked ? 'blocked' : 'error';
    log(`${e instanceof Blocked ? '차단 감지' : '오류'}: ${e.message}`);
    try { await flush(); } catch (e2) { log(`업로드 오류: ${e2.message}`); }
    if (e instanceof Blocked) fs.writeFileSync(path.join(STATE, 'blocked.txt'), `${new Date().toISOString()} ${e.message}\n`);
  } finally {
    await browser.close();
    log(`끝: ${JSON.stringify(stats)} / 오늘 연 화면 ${pace.count}`);
  }
}

if (fs.existsSync(path.join(STATE, 'blocked.txt')) && !DRY) {
  log('지난 실행에서 차단이 감지되어 멈춰 있습니다. 확인 후 state/blocked.txt 를 지우면 다시 돌아갑니다.');
} else {
  // 브라우저 실행 실패처럼 try 밖에서 난 오류도 로그에 남긴다(작업 스케줄러로 돌 때는 화면 출력이 안 보임)
  main().catch((e) => {
    log(`실행 오류: ${e.stack || e.message}`);
    try { fs.statSync(chromium.executablePath()); } catch (e2) { log(`진단: 브라우저 파일 확인 실패 ${e2.code} ${e2.message} / LOCALAPPDATA=${process.env.LOCALAPPDATA} USERPROFILE=${process.env.USERPROFILE} PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH || ''}`); }
    process.exitCode = 1;
  });
}
