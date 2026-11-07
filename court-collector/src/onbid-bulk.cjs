// 공매(온비드) 일괄 수집기 — 2026-11-07 사용자 결정: "공매는 경매수집기(서버 20분 수집)에서 빼고 한 번에 따로 받아 정리"
//
//  공공데이터포털 온비드 API(운영계정, 하루 10만 건)로 목록 → 원문(상세) → 입찰결과를 끝까지 한 번에 받는다.
//  받은 원자료는 먼저 이 PC 파일로 저장(D:\공매원본\YYYYMMDD\, 없으면 state\onbid\YYYYMMDD\)하고,
//  사이트 DB에는 수집 서버(ingestCourt, .env 의 INGEST_URL·INGEST_TOKEN)로 묶어서 올린다.
//
//  실행:  node src\onbid-bulk.cjs            (매일: 목록 전체 + 바뀐 물건 원문 + 끝난 물건 결과)
//         node src\onbid-bulk.cjs --dry      (서버에 올리지 않고 파일만 — 시험)
//         node src\onbid-bulk.cjs --limit 20 (원문을 20건만 — 시험)
//
//  원칙: 하루 한도를 다 쓰더라도 밀린 원문은 남김없이 받는다(사용자: 하루 한도는 매일 채운다).
//        입찰기간이 끝난 물건은 원문을 새로 받지 않는다(결과만 확인).
'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');            // court-collector
const REPO = path.join(ROOT, '..');                 // 저장소 루트(C:\notedata 또는 C:\jbslab)
// 서버 코드(lib/onbid.js)를 그대로 쓴다 — 그 파일이 찾는 패키지(fast-xml-parser)는 court-collector\node_modules 에서 찾게 한다
process.env.NODE_PATH = [path.join(ROOT, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter);
Module._initPaths();
const onbid = require(path.join(REPO, 'auction-server', 'functions', 'src', 'lib', 'onbid.js'));

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = (() => { const i = args.indexOf('--limit'); return i >= 0 ? Number(args[i + 1]) || 0 : 0; })();
const CONCURRENCY = 4;          // 동시에 4건 — 공공데이터 API는 사람 속도 제한이 없지만 서버에 무리 주지 않게
const PAUSE_MS = 150;           // 호출 사이 잠깐 쉼

// ── 설정 읽기 ─────────────────────────────────────────
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].trim()]));
}
const env = { ...readEnv(path.join(ROOT, '.env')), ...process.env };
const cfgJs = path.join(REPO, 'js', 'config.js');
const KEY = env.DATA_GO_KR_KEY || ((fs.existsSync(cfgJs) ? fs.readFileSync(cfgJs, 'utf8') : '').match(/DATA_GO_KR_KEY\s*=\s*'([^']+)'/) || [])[1];
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const TODAY = kst().toISOString().slice(0, 10).replace(/-/g, '');
const NOW_TEXT = kst().toISOString().slice(0, 16).replace('T', ' ');
const OUT_BASE = env.ONBID_DIR || (fs.existsSync('D:\\') ? 'D:\\공매원본' : path.join(ROOT, 'state', 'onbid'));
const OUT = path.join(OUT_BASE, TODAY);
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const LOG = path.join(ROOT, 'logs', `onbid-${TODAY}.log`);
function log(...a) {
  const line = `[${kst().toISOString().slice(11, 19)}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(LOG, `${line}\n`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const appendJsonl = (name, rows) => { if (rows.length) fs.appendFileSync(path.join(OUT, name), rows.map((r) => JSON.stringify(r)).join('\n') + '\n'); };

// ── 수집 서버로 보내기 ─────────────────────────────────
async function post(body, tries = 4) {
  if (DRY) return { ok: true, dry: true, needDetail: [] };
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(env.INGEST_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INGEST_TOKEN}` },
        body: JSON.stringify(body), signal: AbortSignal.timeout(280e3),
      });
      const t = await res.text();
      if (res.status === 401) throw Object.assign(new Error('토큰이 맞지 않음(.env INGEST_TOKEN 확인)'), { fatal: true });
      if (!res.ok) throw new Error(`서버 ${res.status} ${t.slice(0, 200)}`);
      const j = JSON.parse(t);
      if (j.ok === false) throw Object.assign(new Error(`서버 거절: ${j.error || t.slice(0, 200)}${j.error === '모르는 동작' ? ' [SERVER_OLD] 서버에 새 공매 저장 동작이 아직 배포되지 않음' : ''}`), { fatal: j.error === '모르는 동작' });
      return j;
    } catch (e) {
      last = e;
      if (e.fatal) throw e;
      await sleep(3000 * 2 ** i);
    }
  }
  throw last;
}

// 여러 건을 동시에(CONCURRENCY) 처리
async function pool(list, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (i < list.length) { const k = i++; await fn(list[k], k); await sleep(PAUSE_MS); }
  });
  await Promise.all(workers);
}

const isQuota = (e) => e && String(e.code) === '22';
const isAuth = (e) => e && ['20', '30', '31', '32'].includes(String(e.code));

async function main() {
  const t0 = Date.now();
  if (!KEY) throw new Error('공공데이터포털 인증키(DATA_GO_KR_KEY)를 js\\config.js 나 .env 에서 찾지 못함');
  if (!DRY && (!env.INGEST_URL || !env.INGEST_TOKEN)) throw new Error('.env 에 INGEST_URL, INGEST_TOKEN 이 없음(법원경매 수집기와 같은 값)');
  log(`=== 공매 일괄 수집 시작${DRY ? ' (시험: 서버에 안 올림)' : ''} — 원자료 폴더 ${OUT}`);
  const stats = { listPages: 0, listRows: 0, saved: 0, needDetail: 0, details: 0, detailEmpty: 0, results: 0, resultPending: 0, resultRows: 0, errors: [] };
  const err = (m) => { stats.errors.push(m); if (stats.errors.length <= 30) log('오류', m); };

  // 1) 우리 DB에 이미 있는 공매 물건(원문·결과를 다시 받을지 판단용)
  const known = new Map();
  if (!DRY) {
    const k = await post({ action: 'onbidKnown' });
    for (const row of k.items) { const o = Object.fromEntries(k.fields.map((f, i) => [f, row[i]])); known.set(o.id, o); }
    log(`DB 공매 물건 ${known.size}건`);
  }

  // 2) 목록 전체(수도권 전부 + 파산자산 전국 + 수도권 밖 땅·섬) — 끝까지
  const listed = new Map();
  let stopped = null;
  for (const part of onbid.partitions()) {
    for (let pageNo = 1; ; pageNo++) {
      let page;
      try {
        page = await onbid.fetchListPage({ part, pageNo, serviceKey: KEY });
      } catch (e) {
        if (isQuota(e) || isAuth(e)) { stopped = `목록 ${e.message}`; break; }
        err(`목록 ${part.label} ${pageNo}쪽: ${e.message}`); break;
      }
      stats.listPages++;
      const items = page.rows.filter((r) => r.cltrMngNo).map(onbid.mapListRow).filter((it) => !part.keep || part.keep(it)).map(onbid.withFlags);
      for (const it of items) listed.set(it.id, it);
      appendJsonl('목록.jsonl', items);
      if (!page.rows.length || pageNo * 100 >= page.total) break;
      await sleep(PAUSE_MS);
    }
    log(`목록 ${part.label}: 누적 ${listed.size}건`);
    if (stopped) break;
  }
  stats.listRows = listed.size;
  // 목록이 한 건도 안 왔으면(인터넷·키·서비스 문제) 여기서 멈춘다 — 빈 결과로 '오늘 수집 완료'를 찍지 않게
  if (!listed.size) throw new Error(`목록을 한 건도 받지 못함 — ${stats.errors[0] || stopped || '원인 불명'}`);
  if (stopped) err(stopped);

  // 3) 목록 저장 → 서버가 '새로 들어왔거나 회차·최저가·상태가 바뀐 물건'을 알려 줌
  const all = [...listed.values()];
  const needDetail = new Set();
  for (let i = 0; i < all.length; i += 200) {
    const chunk = all.slice(i, i + 200);
    try {
      const r = await post({ action: 'onbidSave', items: chunk });
      stats.saved += chunk.length;
      (r.needDetail || []).forEach((id) => needDetail.add(id));
    } catch (e) { err(`목록 저장 ${i}~: ${e.message}`); if (e.fatal) throw e; }
  }
  log(`목록 저장 ${stats.saved}건, 서버가 원문 필요하다고 한 것 ${needDetail.size}건`);

  // 4) 원문(상세): 서버가 알려 준 것 + 진행 중인데 원문이 없거나 옛 판인 것 — 입찰 끝난 물건은 빼고
  const live = (it) => !it.bidEnd || String(it.bidEnd).replace(/\./g, '-') >= NOW_TEXT.slice(0, 10);
  const targets = all.filter((it) => {
    if (!live(it)) return false;
    if (needDetail.has(it.id) || DRY) return true;
    const k = known.get(it.id);
    return !k || (!k.detailEmpty && Number(k.detailVer || 0) < onbid.DETAIL_VERSION);
  }).sort((a, b) => onbid.score(b) - onbid.score(a));
  const todo = LIMIT ? targets.slice(0, LIMIT) : targets;
  stats.needDetail = targets.length;
  log(`원문 받을 물건 ${targets.length}건${LIMIT ? ` (시험: ${todo.length}건만)` : ''}`);
  let buf = []; let quotaHit = false;
  const flush = async () => {
    if (!buf.length) return;
    const send = buf; buf = [];
    try { await post({ action: 'onbidSave', merge: true, items: send }); } catch (e) { err(`원문 저장: ${e.message}`); if (e.fatal) throw e; }
  };
  await pool(todo, async (it, k) => {
    if (quotaHit) return;
    try {
      const raw = await onbid.fetchDetail({ cltrMngNo: it.cltrMngNo, pbctCdtnNo: it.pbctCdtnNo, serviceKey: KEY, raw: true });
      const at = new Date().toISOString();
      if (!raw) { stats.detailEmpty++; buf.push({ id: it.id, detailEmptyAt: at }); }
      else {
        const detail = onbid.mapDetail(raw);
        appendJsonl('원문.jsonl', [{ id: it.id, raw }]);
        const doc = { id: it.id, detail, detailAt: at, detailVer: onbid.DETAIL_VERSION };
        if (!it.pnu && detail.pnu) doc.pnu = detail.pnu;
        buf.push(doc); stats.details++;
      }
    } catch (e) {
      if (isQuota(e) || isAuth(e)) { quotaHit = true; err(`원문 중단: ${e.message}`); return; }
      err(`원문 ${it.id}: ${e.message}`);
    }
    if (buf.length >= 50) await flush();
    if ((k + 1) % 500 === 0) log(`원문 ${k + 1}/${todo.length} (받음 ${stats.details}, 빈 원문 ${stats.detailEmpty})`);
  });
  await flush();
  log(`원문 끝: 받음 ${stats.details}, 빈 원문 ${stats.detailEmpty}${quotaHit ? ' — 한도·인증으로 중단' : ''}`);

  // 5) 입찰 끝난 물건 결과(낙찰·유찰·낙찰가) — 결과 없는 것, 하루 한 번, 최대 5번
  if (!DRY) {
    const dayAgo = Date.now() - 20 * 3600e3;
    const ended = [...known.values()].filter((k) => k.cltrMngNo && k.pbctCdtnNo && !k.hasResult && k.bidEnd && String(k.bidEnd) < NOW_TEXT
      && (k.resultTries || 0) < 5 && (!k.resultCheckedAt || new Date(k.resultCheckedAt).getTime() < dayAgo));
    log(`결과 확인할 끝난 물건 ${ended.length}건`);
    const out = [];
    await pool(ended, async (k) => {
      try {
        const info = await onbid.fetchBidInfo({ cltrMngNo: k.cltrMngNo, pbctCdtnNo: k.pbctCdtnNo, serviceKey: KEY });
        const result = onbid.resultFor({ round: k.round, minBid: k.minBid }, info);
        const upd = { id: k.id, resultCheckedAt: new Date().toISOString(), resultTries: (k.resultTries || 0) + 1 };
        if (info) upd.bidInfo = info;
        if (result) { upd.result = result; stats.results++; } else stats.resultPending++;
        out.push(upd);
      } catch (e) { if (!isQuota(e)) err(`결과 ${k.id}: ${e.message}`); }
    });
    appendJsonl('결과.jsonl', out);
    for (let i = 0; i < out.length; i += 200) {
      try { await post({ action: 'onbidSave', merge: true, items: out.slice(i, i + 200) }); } catch (e) { err(`결과 저장: ${e.message}`); }
    }
    log(`결과: 채움 ${stats.results}, 아직 ${stats.resultPending}`);

    // 6) 입찰결과목록: 최근 4일 개찰된 것 전부(채점 자료)
    const from = kst(new Date(Date.now() - 4 * 86400e3)).toISOString().slice(0, 10).replace(/-/g, '');
    const parts = [...onbid.CAPITAL_SIDO.map((sido) => ({ sido, prptDivCd: onbid.PROPERTY_CODES })), { sido: null, prptDivCd: onbid.BANKRUPT_CODE }];
    for (const part of parts) {
      for (let pageNo = 1; pageNo <= 50; pageNo++) {
        try {
          const page = await onbid.fetchResultPage({ ...part, from, to: TODAY, pageNo, serviceKey: KEY });
          const rows = page.rows.filter((r) => r.cltrMngNo).map(onbid.mapResultRow).filter((r) => !part.sido || !r.sido || r.sido === part.sido);
          appendJsonl('입찰결과목록.jsonl', rows);
          if (rows.length) await post({ action: 'onbidResultRows', rows });
          stats.resultRows += rows.length;
          if (!page.rows.length || pageNo * 100 >= (page.total || 0)) break;
        } catch (e) { err(`결과목록 ${part.sido || '파산'}: ${e.message}`); break; }
      }
    }
    log(`입찰결과목록 ${stats.resultRows}행`);
  }

  // 7) 수집 기록 → 관리자 화면 '수집 현황'
  const min = Math.round((Date.now() - t0) / 60000);
  const state = { listedDay: TODAY, lastBulk: { day: TODAY, minutes: min, ...stats, errors: stats.errors.slice(0, 10), errorCount: stats.errors.length } };
  if (!stopped && !quotaHit) { state.lastDay = TODAY; state.lastFullDay = TODAY; }
  try { await post({ action: 'onbidState', state }); } catch (e) { log('수집 기록 저장 실패', e.message); }
  if (!DRY && !stopped) { try { await post({ action: 'onbidState', name: 'onbidResults', state: { lastDay: TODAY } }); } catch { /* 무시 */ } }
  fs.writeFileSync(path.join(OUT, '요약.json'), JSON.stringify(state, null, 1));
  log(`=== 끝 (${min}분) 목록 ${stats.listRows} · 원문 ${stats.details}/${stats.needDetail} · 결과 ${stats.results} · 결과목록 ${stats.resultRows} · 오류 ${stats.errors.length}`);
}

main().catch((e) => { log('멈춤:', e.message); process.exitCode = /SERVER_OLD/.test(e.message) ? 3 : 1; });
