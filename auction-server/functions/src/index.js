// jbslab 경공매·파산 수집 서버 (Firebase Functions 2세대)
// 예약 작업은 하나(collectTick)만 둔다 — 새벽 0~6시 20분마다 깨어나 정해진 순서로 이어서 수집.
// (Cloud Scheduler 작업은 계정당 3개까지 무료)
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const { Quota, kstDay } = require('./lib/dataGoKr');
const onbid = require('./lib/onbid');
const trades = require('./lib/trades');
const bankrupt = require('./lib/bankrupt');
const vworld = require('./lib/vworld');
const incheonZones = require('./lib/incheonZones');
const { COURTS } = require('./data/courts');

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 2 }); // 서울 리전

const DATA_GO_KR_KEY = defineSecret('DATA_GO_KR_KEY');
const VWORLD_KEY = defineSecret('VWORLD_KEY');
const COURT_INGEST_TOKEN = defineSecret('COURT_INGEST_TOKEN');
const ADMIN_EMAILS = defineString('ADMIN_EMAILS', { default: 'deepgreen7857@gmail.com' });

const TICK_BUDGET_MS = 470 * 1000; // 함수 제한 540초 안에서 여유를 둔다

// ---------- Firestore 저장 도우미 ----------
async function saveListings(items, opts = {}) {
  const needDetail = [];
  for (let i = 0; i < items.length; i += 400) {
    const chunk = items.slice(i, i + 400);
    const refs = chunk.map((it) => db.collection('listings').doc(it.id));
    const snaps = opts.merge ? [] : await db.getAll(...refs);
    const batch = db.batch();
    chunk.forEach((it, idx) => {
      const prev = snaps[idx] && snaps[idx].exists ? snaps[idx].data() : null;
      const now = new Date().toISOString();
      const doc = { ...it, updatedAt: now };
      if (!opts.merge) {
        if (!prev) doc.firstSeenAt = now;
        // 회차·최저가·상태가 바뀌면 이력에 남기고 상세를 다시 받는다
        const changed = !prev || prev.minBid !== it.minBid || prev.round !== it.round || prev.statusCode !== it.statusCode;
        if (prev && changed) {
          const hist = Array.isArray(prev.history) ? prev.history.slice(-19) : [];
          hist.push({ at: now, round: prev.round, minBid: prev.minBid, status: prev.status, failCount: prev.failCount });
          doc.history = hist;
        }
        if (!prev || changed || !prev.detail) needDetail.push(it);
      }
      batch.set(refs[idx], doc, { merge: true });
    });
    await batch.commit();
  }
  return { needDetail };
}

async function getState(name) {
  const s = await db.collection('state').doc(name).get();
  return s.exists ? s.data() : {};
}
const setState = (name, data) => db.collection('state').doc(name).set({ ...data, updatedAt: new Date().toISOString() }, { merge: true });

async function getSettings() {
  const s = await db.collection('settings').doc('main').get();
  return s.exists ? s.data() : {};
}

async function logRun(job, result) {
  await db.collection('runs').add({ job, at: new Date().toISOString(), day: kstDay(), result: JSON.parse(JSON.stringify(result || {})) });
}

// ---------- 각 작업 ----------
async function runBankrupt({ force = false } = {}) {
  const st = await getState('bankrupt');
  if (!force && st.lastDay === kstDay()) return { skipped: '오늘 이미 수집' };
  const first = !st.maxSeq;
  const res = await bankrupt.collect({
    knownMaxSeq: st.maxSeq || 0,
    maxPages: first ? 12 : 5, // 첫 수집은 최근 약 120건(오래된 공고는 이미 만료) — 함수 제한시간(9분) 안에 끝나게
    save: (item) => db.collection('bankruptNotices').doc(item.id).set({ ...item, savedAt: new Date().toISOString() }, { merge: true }),
    log: logger.info,
  });
  await setState('bankrupt', { maxSeq: res.maxSeq, lastDay: res.errors.length && !res.saved ? st.lastDay || null : kstDay() });
  return res;
}

async function runIncheonZones({ force = false } = {}) {
  const st = await getState('incheonZones');
  if (!force && st.lastDay === kstDay()) return { skipped: '오늘 이미 확인' };
  const res = await incheonZones.collect({
    knownNtt: force ? 0 : st.ntt || 0,
    save: (p) => db.collection('redevZones').doc(p.sido).set({
      sido: p.sido, quarter: p.quarter, fileName: p.fileName, source: p.source, ntt: p.ntt, title: p.title,
      count: p.zones.length, uploadedAt: new Date().toISOString(), z: JSON.stringify(p.zones),
    }),
    log: logger.info,
  });
  await setState('incheonZones', { lastDay: kstDay(), ...(res.ntt && !res.error ? { ntt: res.ntt } : {}), lastResult: JSON.parse(JSON.stringify(res)) });
  return res;
}

// 필지별 토지이용·공시지가(30일 캐시) + 주택 공시가격
async function enrichLand(item) {
  const key = VWORLD_KEY.value();
  if (!key || !item.pnu) return {};
  const ref = db.collection('landCache').doc(String(item.pnu));
  const c = await ref.get();
  let land = c.exists && Date.now() - new Date(c.data().checkedAt).getTime() < 30 * 86400e3 ? c.data() : null;
  if (!land) { land = await vworld.lookup({ pnu: item.pnu, key }); await ref.set(land); }
  const out = { land };
  if (!/토지|대지|임야|전|답|잡종지/.test(item.usageSmall || '') || item.buildingArea) {
    const hp = await vworld.housingPrice({ pnu: item.pnu, address: `${item.address || ''} ${item.title || ''} ${item.detail?.addressFull || ''}`, key });
    if (hp) out.housePrice = hp;
  }
  return out;
}

async function runOnbid({ deadline, force = false, mode } = {}) {
  const st = await getState('onbid');
  const today = kstDay();
  if (!force && st.lastDay === today) return { skipped: '오늘 이미 수집' };
  const isSunday = new Date(Date.now() + 9 * 3600e3).getUTCDay() === 0;
  const m = mode || (!st.lastFullDay || isSunday ? 'full' : 'daily');
  const res = await onbid.collect({
    serviceKey: DATA_GO_KR_KEY.value(), quota: new Quota(db), mode: m, deadline,
    save: saveListings, log: logger.info, enrich: enrichLand,
  });
  // 오류만 나고 한 건도 못 받았으면(예: 키 오류) '오늘 수집함'으로 표시하지 않는다 → 다음 실행에서 다시 시도
  const failedAll = res.rows === 0 && res.errors && res.errors.length > 0;
  if (!res.stopped && !failedAll) await setState('onbid', { lastDay: today, ...(m === 'full' ? { lastFullDay: today } : {}) });
  return { mode: m, ...res };
}

async function runTrades({ deadline } = {}) {
  const settings = await getSettings();
  return trades.collect({
    serviceKey: DATA_GO_KR_KEY.value(), quota: new Quota(db), deadline,
    backfillMonths: Number(settings.backfillMonths || 12),
    getProgress: async (type) => (await db.collection('tradeProgress').doc(type).get()).data(),
    saveProgress: (type, p) => db.collection('tradeProgress').doc(type).set(p),
    saveMonth: ({ type, lawd, ym, deals }) => db.collection('tradeMonths').doc(`${type}_${lawd}_${ym}`).set({
      type, lawd, ym, count: deals.length, d: JSON.stringify(deals), savedAt: new Date().toISOString(),
    }),
    log: logger.info,
  });
}

async function tick({ only, force } = {}) {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const out = {};
  const settings = await getSettings();
  const enabled = { zones: settings.collectZones !== false, bankrupt: settings.collectBankrupt !== false, onbid: settings.collectOnbid !== false, trades: settings.collectTrades !== false };
  const jobs = only ? [only] : ['zones', 'bankrupt', 'onbid', 'trades'];
  for (const job of jobs) {
    if (!enabled[job] && !only) continue;
    if (Date.now() > deadline) { out[job] = { stopped: 'time' }; continue; }
    try {
      if (job === 'zones') out[job] = await runIncheonZones({ force });
      if (job === 'bankrupt') out[job] = await runBankrupt({ force });
      if (job === 'onbid') out[job] = await runOnbid({ deadline, force });
      if (job === 'trades') out[job] = await runTrades({ deadline });
    } catch (e) {
      logger.error(job, e);
      out[job] = { error: e.message };
    }
  }
  await logRun(only || 'tick', out);
  return out;
}

// ---------- 공개 함수 ----------
exports.collectTick = onSchedule(
  { schedule: '*/20 0-6 * * *', timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '512MiB', secrets: [DATA_GO_KR_KEY, VWORLD_KEY] },
  async () => { await tick(); },
);

function requireAdmin(request) {
  const email = request.auth && request.auth.token && request.auth.token.email;
  const admins = ADMIN_EMAILS.value().split(',').map((s) => s.trim().toLowerCase());
  if (!email || !admins.includes(email.toLowerCase())) throw new HttpsError('permission-denied', '관리자만 쓸 수 있습니다.');
}

// 관리자: 지금 수집 (job: zones | bankrupt | onbid | trades)
exports.runNow = onCall({ timeoutSeconds: 540, memory: '512MiB', secrets: [DATA_GO_KR_KEY, VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const job = request.data && request.data.job;
  if (!['zones', 'bankrupt', 'onbid', 'trades'].includes(job)) throw new HttpsError('invalid-argument', 'job 값이 잘못되었습니다.');
  return tick({ only: job, force: true });
});

// 관리자: API 연결 시험 — 각 API를 한 번씩 불러 결과코드와 첫 줄의 항목 이름을 돌려준다
exports.testApis = onCall({ timeoutSeconds: 120, secrets: [DATA_GO_KR_KEY, VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const key = DATA_GO_KR_KEY.value();
  const quota = new Quota(db);
  const results = [];
  const tryOne = async (name, fn) => {
    try { const r = await fn(); results.push({ name, ok: true, ...r }); } catch (e) { results.push({ name, ok: false, code: e.code || null, message: e.message }); }
  };
  await tryOne('온비드 부동산 물건목록', async () => {
    const r = await onbid.fetchListPage({ part: { sido: '인천광역시', prptDivCd: onbid.PROPERTY_CODES, pvctTrgtYn: 'N' }, pageNo: 1, serviceKey: key, quota });
    return { total: r.total, fields: Object.keys(r.rows[0] || {}).slice(0, 40) };
  });
  await tryOne('온비드 파산자산(전국)', async () => {
    const r = await onbid.fetchListPage({ part: { sido: null, prptDivCd: onbid.BANKRUPT_CODE, pvctTrgtYn: 'N' }, pageNo: 1, serviceKey: key, quota });
    return { total: r.total, sample: r.rows[0] ? onbid.mapListRow(r.rows[0]).title : null };
  });
  for (const [type, t] of Object.entries(trades.TYPES)) {
    await tryOne(`실거래가 ${t.name}`, async () => {
      const ym = trades.ymList(2)[1];
      const deals = await trades.fetchMonth({ type, lawd: '28237', ym, serviceKey: key, quota });
      return { total: deals.length, sample: deals[0] || null };
    });
  }
  await tryOne('브이월드 토지이용계획', async () => {
    const r = await vworld.lookup({ pnu: (request.data && request.data.pnu) || '2823710100100010000', key: VWORLD_KEY.value() });
    return { zone: r.landUse && r.landUse.zone, officialPrice: r.officialPrice, error: r.landUseError };
  });
  await tryOne('인천 정비사업 추진현황 게시판', async () => {
    const res = await fetch(incheonZones.LIST, { signal: AbortSignal.timeout(20000) });
    const posts = incheonZones.parseList(await res.text());
    return { total: posts.length, sample: posts[0] ? `${posts[0].title} (글 ${posts[0].ntt})` : null };
  });
  await tryOne('대법원 회생·파산 게시판', async () => {
    const res = await fetch(`${bankrupt.LIST}?pageIndex=1`, { signal: AbortSignal.timeout(20000) });
    const parsed = bankrupt.parseList(await bankrupt.decodeHtml(res));
    return { total: parsed.rows.length, sample: parsed.rows[0] ? parsed.rows[0].title : null };
  });
  return { results };
});

// 토지이용계획·공시지가 조회(정비구역·농업진흥·개발제한 판정). 결과는 캐시해 두고 누구나 읽는다.
exports.landCheck = onCall({ timeoutSeconds: 60, secrets: [VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const { pnu, listingId } = request.data || {};
  const cacheRef = db.collection('landCache').doc(String(pnu || 'none'));
  const cached = await cacheRef.get();
  const fresh = cached.exists && Date.now() - new Date(cached.data().checkedAt).getTime() < 30 * 86400e3;
  const land = fresh ? cached.data() : await vworld.lookup({ pnu, key: VWORLD_KEY.value() });
  if (!fresh) await cacheRef.set(land);
  let housePrice = null;
  if (listingId) {
    const it = (await db.collection('listings').doc(listingId).get()).data() || {};
    housePrice = await vworld.housingPrice({ pnu, address: `${it.address || ''} ${it.title || ''} ${it.detail?.addressFull || ''}`, key: VWORLD_KEY.value() }).catch(() => null);
    await db.collection('listings').doc(listingId).set({ land, pnu, ...(housePrice ? { housePrice } : {}) }, { merge: true });
  }
  return { ...land, housePrice };
});

// 첫 설치 때 기본 설정 넣기(관리자 화면의 "기본값 넣기" 버튼)
exports.seedSettings = onCall({}, async (request) => {
  requireAdmin(request);
  const ref = db.collection('settings').doc('main');
  const snap = await ref.get();
  if (snap.exists && !(request.data && request.data.overwrite)) return { ok: true, existed: true };
  await ref.set({
    courts: COURTS,
    backfillMonths: 12,
    collectZones: true, collectBankrupt: true, collectOnbid: true, collectTrades: true,
    priorityRegions: ['인천광역시 부평구', '인천광역시 계양구'],
    analysisExclude: [{ sido: '인천광역시', sgg: '미추홀구', scope: 'redevelopment' }],
    marginRate: 0.1,
    settlementRatio: 0.9,
    // 투기과열지구 — 2025.10.16 지정(2026.6 기준 확인). 지정·해제 때 관리자 화면에서 고칠 것
    overheated: [{ sido: '서울특별시', sgg: '*' }, ...['과천시', '광명시', '성남시 분당구', '성남시 수정구', '성남시 중원구', '수원시 영통구', '수원시 장안구', '수원시 팔달구', '안양시 동안구', '용인시 수지구', '의왕시', '하남시'].map((sgg) => ({ sido: '경기도', sgg }))],
    updatedAt: new Date().toISOString(),
  });
  return { ok: true };
});

// ---------- 법원경매 수집기(전용 PC)가 보내는 자료 받기 ----------
// POST /ingestCourt  머리글 Authorization: Bearer <COURT_INGEST_TOKEN>
// 본문 { items: [ {caseNo, court, itemNo, ...} ], run: { ... } }
const COURT_FIELDS = ['caseNo', 'itemNo', 'court', 'title', 'usage', 'usageSmall', 'address', 'sido', 'sgg', 'emd', 'pnu', 'appraisal', 'minBid', 'failCount', 'round',
  'bidEnd', 'status', 'landArea', 'buildingArea', 'share', 'bulk', 'thumbnail', 'url', 'detail', 'history'];

function cleanCourtItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const caseNo = String(raw.caseNo || '').replace(/\s/g, '');
  const court = String(raw.court || '').trim();
  if (!/^\d{4}타경\d+$/.test(caseNo) || !court) return null;
  const item = { source: 'court', category: 'court' };
  for (const k of COURT_FIELDS) if (raw[k] !== undefined && raw[k] !== null && raw[k] !== '') item[k] = raw[k];
  for (const k of ['appraisal', 'minBid', 'failCount', 'landArea', 'buildingArea']) if (item[k] !== undefined) item[k] = Number(String(item[k]).replace(/[^\d.]/g, '')) || null;
  const itemNo = String(raw.itemNo || '1').replace(/\D/g, '') || '1';
  item.itemNo = itemNo;
  item.id = `court_${court.replace(/\s/g, '')}_${caseNo}_${itemNo}`;
  if (item.detail && JSON.stringify(item.detail).length > 60000) delete item.detail.raw;
  return item;
}

exports.ingestCourt = onRequest({ secrets: [COURT_INGEST_TOKEN, VWORLD_KEY], timeoutSeconds: 300, memory: '512MiB', cors: false }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST만 받습니다'); return; }
  const auth = String(req.get('authorization') || '');
  if (!COURT_INGEST_TOKEN.value() || auth !== `Bearer ${COURT_INGEST_TOKEN.value()}`) { res.status(401).send('토큰이 맞지 않습니다'); return; }
  const body = req.body || {};
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map(cleanCourtItem).filter(Boolean);
  const { needDetail } = await saveListings(items);
  let enriched = 0;
  for (const it of items.filter((x) => x.pnu).slice(0, 50)) {
    try { const extra = await enrichLand(it); if (Object.keys(extra).length) { await db.collection('listings').doc(it.id).set(extra, { merge: true }); enriched++; } } catch (e) { logger.warn('court enrich', it.id, e.message); }
  }
  if (body.run) await setState('court', { lastRun: new Date().toISOString(), lastDay: kstDay(), ...JSON.parse(JSON.stringify(body.run)) });
  res.json({ ok: true, received: Array.isArray(body.items) ? body.items.length : 0, saved: items.length, changed: needDetail.length, enriched });
});
