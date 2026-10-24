// jbslab 경공매·파산 수집 서버 (Firebase Functions 2세대)
// 예약 작업은 하나(collectTick)만 둔다 — 새벽 0~6시 20분마다 깨어나 정해진 순서로 이어서 수집.
// (Cloud Scheduler 작업은 계정당 3개까지 무료)
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage, getDownloadURL } = require('firebase-admin/storage');

const { Quota, kstDay } = require('./lib/dataGoKr');
const onbid = require('./lib/onbid');
const trades = require('./lib/trades');
const bankrupt = require('./lib/bankrupt');
const vworld = require('./lib/vworld');
const incheonZones = require('./lib/incheonZones');
const forecast = require('./lib/forecast');
const building = require('./lib/building');
const aiReview = require('./lib/aiReview');
const { COURTS } = require('./data/courts');

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });

setGlobalOptions({ region: 'asia-northeast3', maxInstances: 2 }); // 서울 리전

const DATA_GO_KR_KEY = defineSecret('DATA_GO_KR_KEY');
const VWORLD_KEY = defineSecret('VWORLD_KEY');
const COURT_INGEST_TOKEN = defineSecret('COURT_INGEST_TOKEN');
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
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
    // 분기 엑셀(참고 자료)은 redevZoneFiles 에 둔다. redevZones 는 사람이 확인한 정비구역 목록(관리자 전용)
    save: (p) => db.collection('redevZoneFiles').doc(p.sido).set({
      sido: p.sido, quarter: p.quarter, fileName: p.fileName, source: p.source, ntt: p.ntt, title: p.title,
      count: p.zones.length, uploadedAt: new Date().toISOString(), z: JSON.stringify(p.zones),
    }),
    log: logger.info,
  });
  await setState('incheonZones', { lastDay: kstDay(), ...(res.ntt && !res.error ? { ntt: res.ntt } : {}), lastResult: JSON.parse(JSON.stringify(res)) });
  return res;
}

// 필지별 토지이용·공시지가(30일 캐시) + 주택 공시가격. 필지번호(PNU)가 없으면 지번 주소로 브이월드 주소검색을 해서 찾는다.
async function enrichLand(item) {
  const key = VWORLD_KEY.value();
  if (!key) return {};
  const found = {};
  let pnu = vworld.normalizePnu(item.pnu);
  if (pnu && pnu !== item.pnu) Object.assign(found, { pnu, pnuSource: `온비드 필지번호 보정(${item.pnu} → ${pnu})` });
  if (!pnu) {
    // 온비드 '주소' 칸은 읍면동까지만 있고 지번은 제목에 있다 → 상세 주소, 제목, 주소 순으로 찾는다
    const addr0 = (item.detail && item.detail.addressFull) || item.title || item.address;
    let hit = await vworld.findPnu({ address: addr0, key }).catch(() => null);
    // 지번으로 못 찾으면 도로명 주소로(법원 물건 주소는 도로명인 경우가 많음) — 지번 주소도 함께 저장
    if (!hit) hit = await vworld.findPnuByRoad({ address: item.address || addr0, key }).catch(() => null);
    if (!hit) return {};
    pnu = hit.pnu;
    Object.assign(found, { pnu, pnuSource: `주소검색${hit.road ? '(도로명)' : ''}: ${hit.parcel}`, parcelAddress: hit.parcel, ...(hit.road ? { roadAddress: hit.road } : {}) });
  }
  const ref = db.collection('landCache').doc(String(pnu));
  const c = await ref.get();
  // 빈 응답(토지이용·공시지가·토지특성 모두 없음)은 캐시로 믿지 않는다 — 10/22 한때 빈 응답 366건이 30일 캐시에 묶였던 문제
  let land = c.exists && !vworld.isEmptyLand(c.data()) && (c.data().jimok || c.data().officialPrice) && Date.now() - new Date(c.data().checkedAt).getTime() < 30 * 86400e3 ? c.data() : null;
  if (!land) {
    land = await vworld.lookup({ pnu, key });
    // 받은 필지번호로 빈 응답이면 지번 주소로 필지를 다시 찾아 한 번 더 (온비드 필지번호가 틀린 경우가 많음)
    if (land.empty && !found.pnuSource?.startsWith('주소검색')) {
      const addr = (item.detail && item.detail.addressFull) || item.title || item.address;
      const hit = await vworld.findPnu({ address: addr, key }).catch(() => null);
      if (hit && hit.pnu !== pnu) {
        const again = await vworld.lookup({ pnu: hit.pnu, key });
        if (!again.empty) {
          land = again; pnu = hit.pnu;
          Object.assign(found, { pnu, pnuSource: `주소검색(받은 필지번호 ${item.pnu || '없음'}는 빈 응답): ${hit.parcel}` });
        }
      }
    }
    if (land.empty) logger.warn('브이월드 빈 응답', pnu, JSON.stringify(land.raw).slice(0, 600));
    else await db.collection('landCache').doc(String(pnu)).set(land);
  }
  const out = { ...found, land };
  // 건축HUB: 건물이 있으면 건축물대장(면적·용도·사용승인일 교차 확인), 토지·도로·맹지면 같은 법정동 최근 건축 허가
  let dkey = null; try { dkey = DATA_GO_KR_KEY.value(); } catch { dkey = null; }
  if (dkey) {
    const quota = new Quota(db);
    const addr = `${item.address || ''} ${item.title || ''} ${(item.detail && item.detail.addressFull) || ''}`;
    const cached = async (id, days, fn) => {
      const ref = db.collection('landCache').doc(id); const c = await ref.get();
      if (c.exists && Date.now() - new Date(c.data().checkedAt).getTime() < days * 86400e3) return c.data();
      const v = await fn(); if (v) await ref.set(v); return v;
    };
    const hasBuilding = Boolean(item.buildingArea) || !/토지|대지|임야|전|답|잡종지|도로|구거/.test(item.usageSmall || '');
    if (hasBuilding) {
      try { const lg = await cached(`bld_${pnu}_${building.hoOf(addr) || '0'}`, 90, () => building.ledger({ pnu, address: addr, serviceKey: dkey, quota })); if (lg) out.ledger = lg; } catch (e) { out.ledger = { error: e.message, checkedAt: new Date().toISOString() }; }
    } else {
      try { const pm = await cached(`pms_${String(pnu).slice(0, 10)}`, 30, () => building.permits({ pnu, serviceKey: dkey, quota })); if (pm) out.permits = pm; } catch (e) { out.permits = { error: e.message, checkedAt: new Date().toISOString() }; }
    }
  }
  // 도로·구거·맹지 물건은 주변 필지가 맹지인지 확인(30일 캐시)
  const roadish = /도로|구거|맹지/.test(`${item.usage || ''} ${item.usageSmall || ''} ${land.jimok || ''} ${(item.detail && item.detail.usageStatus) || ''}`);
  if (roadish) {
    const nref = db.collection('landCache').doc(`nb_${pnu}`);
    const n = await nref.get();
    let nb = n.exists && Date.now() - new Date(n.data().checkedAt).getTime() < 30 * 86400e3 ? n.data() : null;
    if (!nb) { try { nb = await vworld.neighbors({ pnu, key }); if (nb) await nref.set(nb); } catch (e) { nb = { error: e.message, checkedAt: new Date().toISOString() }; } }
    if (nb) out.neighbors = nb;
  }
  if (!/토지|대지|임야|전|답|잡종지/.test(item.usageSmall || '') || item.buildingArea) {
    const hp = await vworld.housingPrice({ pnu, address: `${item.address || ''} ${item.title || ''} ${item.detail?.addressFull || ''}`, key });
    if (hp) out.housePrice = hp;
  }
  return out;
}

// 상세를 다시 받을 온비드 물건: 상세가 없거나 예전 판으로 받은 것. 응답이 비었던 물건은 7일 동안 건너뛴다.
async function onbidDetailBacklog() {
  const snap = await db.collection('listings').where('source', '==', 'onbid')
    .select('cltrMngNo', 'pbctCdtnNo', 'sgg', 'category', 'land', 'pnu', 'address', 'title', 'usageSmall', 'buildingArea', 'detailAt', 'detailVer', 'detailEmptyAt').get();
  const weekAgo = Date.now() - 7 * 86400e3;
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => it.cltrMngNo && (!it.detailAt || it.detailVer !== onbid.DETAIL_VERSION))
    .filter((it) => !it.detailEmptyAt || new Date(it.detailEmptyAt).getTime() < weekAgo);
}

async function runOnbid({ deadline, force = false, mode } = {}) {
  const st = await getState('onbid');
  const today = kstDay();
  if (!force && st.lastDay === today) return { skipped: '오늘 이미 수집' };
  const isSunday = new Date(Date.now() + 9 * 3600e3).getUTCDay() === 0;
  const m = mode || (!st.lastFullDay || isSunday ? 'full' : 'daily');
  const res = await onbid.collect({
    serviceKey: DATA_GO_KR_KEY.value(), quota: new Quota(db), mode: m, deadline,
    save: saveListings, log: logger.info, enrich: enrichLand, backfill: onbidDetailBacklog,
  });
  // 오류만 나고 한 건도 못 받았으면(예: 키 오류) '오늘 수집함'으로 표시하지 않는다 → 다음 실행에서 다시 시도
  const failedAll = res.rows === 0 && res.errors && res.errors.length > 0;
  if (!res.stopped && !failedAll) await setState('onbid', { lastDay: today, ...(m === 'full' ? { lastFullDay: today } : {}) });
  return { mode: m, ...res };
}

// 공시지가·토지특성이 아직 안 붙은 진행 물건에 브이월드 정보를 붙인다(온비드 상세 수집과 따로 — 상세가 밀려 있어도 땅값 계산이 되게).
// 빌라·아파트·단독(땅값 대비 최저가를 보는 종류)을 먼저, 한 번에 최대 150건.
async function runLandBacklog({ deadline, max = 150 } = {}) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // YYYY-MM-DD (kstDay는 대시 없는 형식이라 쓰지 않음)
  const snap = await db.collection('listings').select('land', 'pnu', 'address', 'title', 'usage', 'usageSmall', 'bidEnd', 'detail', 'landEmptyAt', 'landEmptyV', 'sido', 'sgg', 'buildingArea').get();
  const weekAgo = Date.now() - 7 * 86400e3;
  const home = (it) => /(다세대|연립|빌라|아파트|단독|다가구|도시형)/.test(`${it.usage || ''} ${it.usageSmall || ''}`);
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    // 지목·공시지가가 비어 있으면(토지이용만 붙은 경우 포함) 다시 — 10/22 필지번호 11번째 자리 오류로 지목 없이 저장된 온비드 365건
    .filter((it) => (!it.land || vworld.isEmptyLand(it.land) || (!it.land.jimok && !it.land.officialPrice)) && String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10) >= today)
    .filter((it) => !it.landEmptyAt || it.landEmptyV !== 4 || new Date(it.landEmptyAt).getTime() < weekAgo) // 이번 판(4) 전에 빈 값으로 표시된 것은 다시
    .sort((x, y) => Number(home(y)) - Number(home(x)));
  let done = 0; let empty = 0; const errors = [];
  for (const it of list.slice(0, max)) {
    if (Date.now() > deadline) break;
    try {
      const extra = await enrichLand(it);
      if (extra && extra.land && !extra.land.empty) {
        // 토지이용은 받았는데 지목·공시지가가 여전히 없으면 일주일 뒤 다시(20분마다 같은 물건을 반복 조회하지 않게)
        const partial = !extra.land.jimok && !extra.land.officialPrice;
        await db.collection('listings').doc(it.id).set({ ...extra, ...(partial ? { landEmptyAt: new Date().toISOString(), landEmptyV: 4 } : {}) }, { merge: true }); done++;
      } else { await db.collection('listings').doc(it.id).set({ landEmptyAt: new Date().toISOString(), landEmptyV: 4, ...(extra?.land?.raw ? { landEmptyRaw: extra.land.raw } : {}) }, { merge: true }); empty++; if (errors.length < 5 && extra?.land?.raw) errors.push(`${it.id} 빈 응답: ${JSON.stringify(extra.land.raw).slice(0, 300)}`); }
    } catch (e) { if (errors.length < 5) errors.push(`${it.id}: ${e.message}`); }
  }
  return { waiting: list.length, done, empty, errors };
}

// ── 정비구역 연계: 관리자 정비구역 목록(redevZones) ↔ 진행 물건 ──────────────
//  목록과 PNU·지번(또는 대략 경계)이 맞으면 구역 스냅숏을 물건에 붙이고(listing.redevMatch),
//  목록에 없는데 브이월드 토지이용계획에 정비구역이 찍히면 '목록 미등록 구역' 알림(adminAlerts)을 남긴다.
// 키 순서와 무관한 비교용 문자열(Firestore가 돌려주는 맵의 키 순서는 저장 순서와 다를 수 있음)
const stable = (v) => (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${k}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v ?? null));

async function runZoneMatch({ deadline = Date.now() + 120e3, listingIds } = {}) {
  const { zoneStatus } = await import('./shared/zoneMatch.mjs');
  const zones = (await db.collection('redevZones').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  let docs;
  if (listingIds?.length) docs = (await db.getAll(...listingIds.map((id) => db.collection('listings').doc(id)))).filter((d) => d.exists);
  else docs = (await db.collection('listings').select('sido', 'sgg', 'emd', 'pnu', 'address', 'title', 'detail', 'land', 'ledger', 'usage', 'usageSmall', 'manual', 'bidEnd', 'redevMatch').get()).docs;
  const list = docs.map((d) => ({ id: d.id, ...d.data() })).filter((it) => listingIds || String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10) >= today);
  const polySidos = new Set(zones.filter((z) => z.boundary && z.boundary.polygon).map((z) => z.sido));
  const key = (() => { try { return VWORLD_KEY.value(); } catch { return null; } })();
  const stats = { zones: zones.length, listings: list.length, listed: 0, unlisted: 0, none: 0, unchecked: 0, changed: 0, alerts: 0 };
  let batch = db.batch(); let n = 0;
  const flush = async () => { if (n) { await batch.commit(); batch = db.batch(); n = 0; } };
  for (const it of list) {
    if (Date.now() > deadline) { stats.stoppedBy = 'time'; break; }
    // 경계 다각형이 있는 시도의 물건만 필지 중심점을 구한다(30일 캐시)
    let geo = null;
    if (key && it.pnu && polySidos.has(it.sido)) {
      const gref = db.collection('landCache').doc(`geo_${it.pnu}`); const g = await gref.get();
      if (g.exists && Date.now() - new Date(g.data().checkedAt).getTime() < 30 * 86400e3) geo = g.data().geo;
      else { try { geo = await vworld.centroid({ pnu: it.pnu, key }); await gref.set({ geo, checkedAt: new Date().toISOString() }); } catch (e) { logger.warn('centroid', it.id, e.message); } }
    }
    const m = zoneStatus(it, zones, { geo });
    stats[m.status] = (stats[m.status] || 0) + 1;
    const prev = it.redevMatch || {};
    const same = stable({ ...prev, checkedAt: null }) === stable({ ...m, checkedAt: null });
    if (!same) { batch.set(db.collection('listings').doc(it.id), { redevMatch: m }, { merge: true }); n++; stats.changed++; }
    const aref = db.collection('adminAlerts').doc(`zone_${it.id}`);
    if (m.status === 'unlisted' && prev.status !== 'unlisted') {
      batch.set(aref, { type: 'zoneUnlisted', listingId: it.id, title: it.title || '', sido: it.sido || null, sgg: it.sgg || null, pnu: it.pnu || null, vworld: m.vworld, at: new Date().toISOString(), resolved: false }, { merge: true }); n++; stats.alerts++;
    } else if (m.status !== 'unlisted' && prev.status === 'unlisted') {
      batch.set(aref, { resolved: true, resolvedAt: new Date().toISOString(), resolvedBy: m.status }, { merge: true }); n++;
    }
    if (n >= 400) await flush();
  }
  await flush();
  return stats;
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

// 온비드 입찰 결과: 입찰이 끝났는데 결과가 없는 물건을 물건상세 입찰정보로 조회해 낙찰가·낙찰가율을 채운다.
// 결과가 아직 안 올라온 물건은 하루 뒤 다시(최대 5번).
async function runOnbidResults({ deadline, max = 400 } = {}) {
  const now = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  const snap = await db.collection('listings').where('source', '==', 'onbid')
    .select('cltrMngNo', 'pbctCdtnNo', 'round', 'minBid', 'bidEnd', 'status', 'result', 'resultTries', 'resultCheckedAt').get();
  const dayAgo = Date.now() - 20 * 3600e3;
  const targets = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((it) => it.cltrMngNo && it.pbctCdtnNo && !it.result && String(it.bidEnd || '') && String(it.bidEnd) < now)
    .filter((it) => (it.resultTries || 0) < 5 && (!it.resultCheckedAt || new Date(it.resultCheckedAt).getTime() < dayAgo))
    .sort((a, b) => String(b.bidEnd).localeCompare(String(a.bidEnd)))
    .slice(0, max);
  // 같은 물건의 다른 회차(유찰 뒤 새로 올라온 회차) — 그 회차를 조회하면 이전 회차 결과가 나온다
  const siblings = new Map();
  snap.docs.forEach((d) => { const x = d.data(); if (!x.cltrMngNo) return; (siblings.get(x.cltrMngNo) || siblings.set(x.cltrMngNo, []).get(x.cltrMngNo)).push({ id: d.id, ...x }); });
  const quota = new Quota(db);
  const stats = { targets: targets.length, filled: 0, pending: 0, errors: 0 };
  for (const it of targets) {
    if (Date.now() > deadline) { stats.stoppedBy = 'time'; break; }
    if ((await quota.remaining('onbid-bid')) <= 0) { stats.stoppedBy = 'quota'; break; }
    try {
      const info = await onbid.fetchBidInfo({ cltrMngNo: it.cltrMngNo, pbctCdtnNo: it.pbctCdtnNo, serviceKey: DATA_GO_KR_KEY.value(), quota });
      let result = onbid.resultFor(it, info);
      if (!result) {
        const later = (siblings.get(it.cltrMngNo) || []).filter((x) => x.pbctCdtnNo !== it.pbctCdtnNo && Number(x.round || 0) > Number(it.round || 0))
          .sort((a, b) => Number(b.round || 0) - Number(a.round || 0))[0];
        if (later && (await quota.remaining('onbid-bid')) > 0) {
          const info2 = await onbid.fetchBidInfo({ cltrMngNo: later.cltrMngNo, pbctCdtnNo: later.pbctCdtnNo, serviceKey: DATA_GO_KR_KEY.value(), quota });
          result = onbid.resultFor(it, info2);
          if (info2) await db.collection('listings').doc(later.id).set({ bidInfo: info2 }, { merge: true });
        }
      }
      const upd = { resultCheckedAt: new Date().toISOString(), resultTries: (it.resultTries || 0) + 1 };
      if (info) upd.bidInfo = info;
      if (result) { upd.result = result; stats.filled++; } else stats.pending++;
      await db.collection('listings').doc(it.id).set(upd, { merge: true });
    } catch (e) { stats.errors++; if (stats.errors <= 3) logger.warn('onbid result', it.id, e.message); }
  }
  return stats;
}

// 온비드 물건 입찰결과목록: 개찰일 기간으로 끝난 물건 전체를 받아 '완료 물건'을 채운다.
//  매일: 최근 4일 / 남는 한도로: 과거 7일씩 거슬러 올라가며 최대 365일(채점 자료)
const ymd8 = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
async function saveResultRows(rows) {
  let created = 0; let updated = 0;
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const refs = chunk.map((r) => db.collection('listings').doc(r.id));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    chunk.forEach((r, k) => {
      // 우리가 진행 중에 모았던 물건이면 결과만 붙이고, 처음 보는 과거 물건은 별도 모음(pastResults)에 — 진행 목록이 과거 물건에 묻히지 않게
      if (snaps[k].exists) { batch.set(refs[k], { result: r.result, status: r.status }, { merge: true }); updated++; } else { batch.set(db.collection('pastResults').doc(r.id), { ...r, fromResultList: true, savedAt: new Date().toISOString() }); created++; }
    });
    await batch.commit();
  }
  return { created, updated };
}
async function fetchResultRange({ from, to, quota, deadline }) {
  const parts = [...onbid.CAPITAL_SIDO.map((sido) => ({ sido, prptDivCd: onbid.PROPERTY_CODES })), { sido: null, prptDivCd: onbid.BANKRUPT_CODE }];
  let rows = 0; let stopped = null; const errors = [];
  for (const part of parts) {
    for (let pageNo = 1; pageNo <= 50; pageNo++) {
      if (Date.now() > deadline) { stopped = 'time'; break; }
      if ((await quota.remaining('onbid-result-list')) <= 0) { stopped = 'quota'; break; }
      try {
        const page = await onbid.fetchResultPage({ ...part, from, to, pageNo, serviceKey: DATA_GO_KR_KEY.value(), quota });
        const mapped = page.rows.filter((r) => r.cltrMngNo).map(onbid.mapResultRow).filter((r) => !part.sido || !r.sido || r.sido === part.sido);
        if (mapped.length) await saveResultRows(mapped);
        rows += mapped.length;
        if (!page.rows.length || pageNo * 100 >= (page.total || 0)) break;
      } catch (e) { errors.push(`${part.sido || '파산'} ${from}~${to}: ${e.message}`); break; }
    }
    if (stopped) break;
  }
  return { rows, stopped, errors };
}
async function runOnbidResultList({ deadline, force } = {}) {
  const st = await getState('onbidResults');
  const quota = new Quota(db);
  const now = new Date(Date.now() + 9 * 3600e3);
  const out = {};
  if (force || st.lastDay !== kstDay()) {
    out.recent = await fetchResultRange({ from: ymd8(new Date(now - 4 * 86400e3)), to: ymd8(now), quota, deadline });
    if (!out.recent.stopped && !(out.recent.rows === 0 && out.recent.errors.length)) await setState('onbidResults', { lastDay: kstDay() });
  }
  // 과거로 거슬러 올라가기
  let cursor = st.backfillCursor ? new Date(st.backfillCursor) : new Date(now - 5 * 86400e3);
  const limit = new Date(now - Number((await getSettings()).resultBackfillDays || 365) * 86400e3);
  out.backfill = { weeks: 0, rows: 0 };
  while (cursor > limit && Date.now() < deadline) {
    const from = new Date(cursor - 6 * 86400e3);
    const r = await fetchResultRange({ from: ymd8(from), to: ymd8(cursor), quota, deadline });
    if (r.stopped || (r.rows === 0 && r.errors.length)) { out.backfill.stopped = r.stopped || 'error'; out.backfill.errors = r.errors.slice(0, 3); break; }
    out.backfill.weeks++; out.backfill.rows += r.rows;
    cursor = new Date(from - 86400e3);
    await setState('onbidResults', { backfillCursor: cursor.toISOString() });
  }
  out.backfill.cursor = ymd8(cursor);
  return out;
}

async function tick({ only, force } = {}) {
  const started = Date.now();
  const deadline = started + TICK_BUDGET_MS;
  const out = {};
  const settings = await getSettings();
  const enabled = { zones: settings.collectZones !== false, bankrupt: settings.collectBankrupt !== false, onbid: settings.collectOnbid !== false, results: settings.collectOnbid !== false, resultList: settings.collectOnbid !== false, trades: settings.collectTrades !== false, land: settings.collectLand !== false, zoneMatch: true };
  const jobs = only ? [only] : ['zones', 'bankrupt', 'onbid', 'land', 'zoneMatch', 'resultList', 'results', 'trades'];
  for (const job of jobs) {
    if (!enabled[job] && !only) continue;
    if (Date.now() > deadline) { out[job] = { stopped: 'time' }; continue; }
    try {
      if (job === 'zones') out[job] = await runIncheonZones({ force });
      if (job === 'bankrupt') out[job] = await runBankrupt({ force });
      if (job === 'onbid') out[job] = await runOnbid({ deadline, force });
      if (job === 'results') out[job] = await runOnbidResults({ deadline });
      if (job === 'resultList') out[job] = await runOnbidResultList({ deadline, force });
      if (job === 'trades') out[job] = await runTrades({ deadline });
      if (job === 'land') out[job] = await runLandBacklog({ deadline: Math.min(deadline, Date.now() + 120e3) });
      if (job === 'zoneMatch') out[job] = await runZoneMatch({ deadline: Math.min(deadline, Date.now() + 120e3) });
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

// 매일 밤 11시 40분: 진행 중인 물건을 판정해 '입찰 전 예측'을 저장(기일이 된 물건은 그대로 굳힘)
exports.forecastTick = onSchedule(
  { schedule: '40 23 * * *', timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '1GiB' },
  async () => { await forecast.run({ db, log: logger.info, deadline: Date.now() + TICK_BUDGET_MS }); },
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
  if (!['zones', 'bankrupt', 'onbid', 'resultList', 'results', 'trades', 'land', 'zoneMatch'].includes(job)) throw new HttpsError('invalid-argument', 'job 값이 잘못되었습니다.');
  return tick({ only: job, force: true });
});

// 관리자: 예측 기록 지금 실행
exports.forecastNow = onCall({ timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  requireAdmin(request);
  return forecast.run({ db, log: logger.info, deadline: Date.now() + TICK_BUDGET_MS });
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
  await tryOne('온비드 상세', async () => {
    const list = await onbid.fetchListPage({ part: { sido: '인천광역시', prptDivCd: onbid.PROPERTY_CODES, pvctTrgtYn: 'N' }, pageNo: 1, serviceKey: key, quota });
    const first = list.rows.find((r) => r.cltrMngNo);
    if (!first) return { total: 0, message: '목록에 물건이 없어 상세를 시험하지 못했습니다.' };
    const row = await onbid.fetchDetail({ cltrMngNo: first.cltrMngNo, pbctCdtnNo: first.pbctCdtnNo, serviceKey: key, quota, raw: true });
    if (!row) return { total: 0, cltrMngNo: first.cltrMngNo, message: '상세 응답이 비어 있습니다.' };
    // 항목 이름 전체와 형태(배열이면 첫 줄의 항목 이름), 사진·지도 값 예시
    const shape = (v) => (Array.isArray(v) ? `배열 ${v.length}건 [${Object.keys(v[0] || {}).join(',')}]` : v === null || v === undefined ? '비어 있음' : typeof v === 'object' ? `객체 {${Object.keys(v).join(',')}}` : `글자 ${String(v).length}자`);
    const media = {};
    for (const k of Object.keys(row).filter((k) => /poto|Url|lmap|lrm|vdo|urlAdr/i.test(k))) {
      const v = row[k];
      media[k] = { 형태: shape(v), 예시: Array.isArray(v) ? (v[0] && (v[0].urlAdr || JSON.stringify(v[0]))) || null : v ? String(v).slice(0, 300) : null, 구분자: typeof v === 'string' ? (v.includes('|') ? '|' : v.includes(',http') ? ',' : '없음(한 건)') : null };
    }
    const mapped = onbid.mapDetail(row);
    // 관리자 화면은 sample 글자를 그대로 보여 주므로 확인할 내용을 여기에 모은다
    const mediaText = Object.entries(media).map(([k, m]) => `${k}=${m.형태}${m.구분자 ? `(구분자 ${m.구분자})` : ''}`).join(', ');
    return {
      total: Object.keys(row).length,
      cltrMngNo: first.cltrMngNo, pbctCdtnNo: first.pbctCdtnNo,
      fields: Object.keys(row),
      shapes: Object.fromEntries(Object.entries(row).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => [k, shape(v)])),
      media,
      sample: `${first.cltrMngNo} → 해석: 사진 ${mapped.photos.length}장 · 지도 ${mapped.mapUrls.length}장 · 등기 ${mapped.rights.length}건 · 임차 ${mapped.leases.length}건 · 지목 ${mapped.landCategory || '—'}`
        + ` ‖ 사진·지도 항목: ${mediaText}`
        + ` ‖ 목록형 항목: ${Object.entries(row).filter(([, v]) => v && typeof v === 'object').map(([k, v]) => `${k}=${shape(v)}`).join(', ')}`
        + ` ‖ 항목 ${Object.keys(row).length}개: ${Object.keys(row).join(', ')}`,
    };
  });
  await tryOne('온비드 입찰결과(물건상세 입찰정보)', async () => {
    const list = await onbid.fetchListPage({ part: { sido: '인천광역시', prptDivCd: onbid.PROPERTY_CODES, pvctTrgtYn: 'N' }, pageNo: 1, serviceKey: key, quota });
    const row = list.rows.find((r) => r.cltrMngNo && Number(r.usbdNft || 0) > 0) || list.rows.find((r) => r.cltrMngNo);
    if (!row) return { total: 0, message: '목록에 물건이 없어 시험하지 못했습니다.' };
    const info = await onbid.fetchBidInfo({ cltrMngNo: row.cltrMngNo, pbctCdtnNo: row.pbctCdtnNo, serviceKey: key, quota });
    if (!info) return { total: 0, cltrMngNo: row.cltrMngNo, message: '응답이 비어 있습니다.' };
    return { total: info.history.length, cltrMngNo: row.cltrMngNo, sample: `유찰 ${info.failCount ?? '—'}회 · 직전 결과 ${info.prevResult || '—'} · 이력 ${info.history.map((h) => `${h.round}회 ${h.status} ${h.minBid || ''}${h.soldPrice ? `→낙찰 ${h.soldPrice}` : ''}`).join(' / ') || '없음'} · 보증금 ${info.deposit || '—'}` };
  });
  await tryOne('온비드 물건 입찰결과목록', async () => {
    const to = new Date(Date.now() + 9 * 3600e3); const from = new Date(to - 3 * 86400e3);
    const p = await onbid.fetchResultPage({ sido: '인천광역시', prptDivCd: onbid.PROPERTY_CODES, from: from.toISOString().slice(0, 10).replace(/-/g, ''), to: to.toISOString().slice(0, 10).replace(/-/g, ''), pageNo: 1, serviceKey: key, quota });
    const m = p.rows.slice(0, 3).map(onbid.mapResultRow);
    return { total: p.total, fields: Object.keys(p.rows[0] || {}).slice(0, 40), sample: m.map((x) => `${x.title} · ${x.result.status} · 낙찰 ${x.result.soldPrice || '—'} · ${x.result.rate ? Math.round(x.result.rate * 100) + '%' : '—'} · 입찰자 ${x.result.bidders ?? '—'}`).join(' / ') };
  });
  await tryOne('건축HUB 건축물대장·인허가', async () => {
    const any = (await db.collection('listings').where('source', '==', 'onbid').limit(30).get()).docs.map((d) => d.data()).find((x) => x.pnu);
    const pnu = (any && any.pnu) || '2823710100100010000';
    const lg = await building.ledger({ pnu, address: any ? any.address : '', serviceKey: key, quota });
    const pm = await building.permits({ pnu, serviceKey: key, quota });
    return { total: (lg?.titles?.length || 0) + (pm?.total || 0), sample: `${pnu} · 대장 ${lg?.titles?.length || 0}동 ${lg?.titles?.[0]?.mainPurpose || ''} ${lg?.useApr || ''} · 같은 동 허가 ${pm?.total ?? '—'}건(신축 ${pm?.newBuild ?? '—'})` };
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
    // 빈 값이면 원문을 그대로 보여 준다(인증키 등록 도메인 불일치 등 진단용). 호출 도메인: vworld.DOMAIN
    const head = `도메인 ${vworld.DOMAIN} · 용도지역 ${(r.landUse && r.landUse.zone) || '—'} · 공시지가 ${r.officialPrice || '—'}`;
    return { total: r.empty ? 0 : 1, zone: r.landUse && r.landUse.zone, officialPrice: r.officialPrice, error: r.landUseError, sample: r.empty ? `${head} ‖ 빈 응답 원문: ${JSON.stringify(r.raw).slice(0, 600)}` : `${head}${r.errors ? ` ‖ 오류: ${r.errors.join(' / ')}` : ''}` };
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

// 관리자: Claude(대화창)가 크롬으로 사이트·법원 원문을 직접 보고 쓴 검토를 붙인다 — API 키·요금 없음.
//  review: aiReviewNow 와 같은 모양(conclusion·verdict·bidRange·disagree·risks·checks·ruleSuggestions…)
//  spec(선택): Claude가 매각물건명세서를 직접 읽은 내용 → 물건 상세에 넣어 분석기가 바로 반영(수집기가 못 읽은 물건 보충)
const CHAT_VERDICTS = ['입찰 검토', '조건부 검토', '보류', '제외'];
exports.saveChatReview = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);
  const { listingId, review, spec } = request.data || {};
  if (!listingId || !review || typeof review !== 'object') throw new HttpsError('invalid-argument', '물건 번호와 검토 내용이 필요합니다.');
  if (!CHAT_VERDICTS.includes(review.verdict)) throw new HttpsError('invalid-argument', `verdict 는 ${CHAT_VERDICTS.join('·')} 중 하나여야 합니다.`);
  if (JSON.stringify(review).length > 30000) throw new HttpsError('invalid-argument', '검토 내용이 너무 깁니다.');
  let ref = db.collection('listings').doc(listingId); let snap = await ref.get();
  if (!snap.exists) { ref = db.collection('pastResults').doc(listingId); snap = await ref.get(); }
  if (!snap.exists) throw new HttpsError('not-found', '물건을 찾지 못했습니다.');
  const out = { ...review, by: 'claude-chat', at: new Date().toISOString() };
  const patch = { aiReview: out };
  const prev = snap.data().aiReview;
  if (prev) patch.aiReviewHistory = FieldValue.arrayUnion({ ...prev, replacedAt: out.at }); // 이전 검토는 지우지 않고 남김
  if (spec && typeof spec === 'object') {
    const d = snap.data().detail || {};
    const leases = Array.isArray(spec.leases) ? spec.leases.slice(0, 20).map((l) => ({ deposit: Number(l.deposit) || null, rent: Number(l.rent) || null, moveIn: l.moveIn || null, fixedDate: l.fixedDate || null, claimed: Boolean(l.claimed) })) : d.leases || [];
    patch.detail = {
      ...d, specRead: true, specBy: 'claude-chat', specAt: out.at,
      baseRightDate: spec.baseRightDate || d.baseRightDate || null, baseRightType: spec.baseRightType || d.baseRightType || null,
      leases, survivingRights: spec.survivingRights || null, superficies: spec.superficies || d.superficies || null,
      assumedAmount: Number(spec.assumedAmount) || null, specRemarks: spec.remarks || d.specRemarks || null,
      flags: { ...(d.flags || {}), specRead: true, tenants: leases.length, unclaimedTenants: leases.filter((l) => !l.claimed).length, survivingRights: Boolean(spec.survivingRights), superficies: Boolean(spec.superficies) },
    };
  }
  await ref.set(patch, { merge: true });
  if (Array.isArray(review.ruleSuggestions) && review.ruleSuggestions.length) {
    await db.collection('ruleSuggestions').add({ listingId, title: snap.data().title || '', at: out.at, items: review.ruleSuggestions, verdict: review.verdict, by: 'claude-chat' });
  }
  return out;
});

// 토지이용계획·공시지가 조회(정비구역·농업진흥·개발제한 판정). 결과는 캐시해 두고 누구나 읽는다.
// 관리자: Claude 검토 받기 — 물건 1건의 원자료와 사이트 계산을 Claude에게 보내 독립 재검토(누를 때만, 하루 한도)
exports.aiReviewNow = onCall({ timeoutSeconds: 180, memory: '1GiB', secrets: [ANTHROPIC_API_KEY] }, async (request) => {
  requireAdmin(request);
  const { listingId } = request.data || {};
  if (!listingId) throw new HttpsError('invalid-argument', '물건이 없습니다.');
  const settings = await getSettings();
  const limit = Number(settings.aiDailyLimit || 30);
  const qref = db.collection('quota').doc(`ai-review_${kstDay()}`);
  const used = ((await qref.get()).data() || {}).count || 0;
  if (used >= limit) throw new HttpsError('resource-exhausted', `오늘 Claude 검토 한도(${limit}건)를 다 썼습니다.`);
  let ref = db.collection('listings').doc(listingId); let snap = await ref.get();
  if (!snap.exists) { ref = db.collection('pastResults').doc(listingId); snap = await ref.get(); }
  if (!snap.exists) throw new HttpsError('not-found', '물건을 찾지 못했습니다.');
  const item = { id: snap.id, ...snap.data() };
  // 화면과 같은 계산식으로 사이트 판단을 다시 만든다
  const { analyze, tradeTypeOf } = await import('./shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('./shared/defaults.mjs');
  const st = { ...DEFAULT_SETTINGS, ...settings };
  const lawd = lawdOf(item.sido, item.sgg); const t = tradeTypeOf(item); const cache = new Map();
  const deals = lawd ? await forecast.loadDeals(db, t, lawd, cache) : [];
  const rentDeals = lawd && ['apt', 'rh', 'sh', 'offi'].includes(t) ? await forecast.loadDeals(db, `${t}Rent`, lawd, cache) : [];
  const aptDeals = lawd ? (t === 'apt' ? deals : await forecast.loadDeals(db, 'apt', lawd, cache)) : [];
  const analysis = analyze(item, { settings: st, deals, aptDeals, rentDeals });
  const out = await aiReview.review({ item, analysis, apiKey: ANTHROPIC_API_KEY.value(), model: settings.aiModel || 'claude-sonnet-5-5' });
  await ref.set({ aiReview: out }, { merge: true });
  await qref.set({ count: used + 1, api: 'ai-review', day: kstDay() }, { merge: true });
  if (Array.isArray(out.ruleSuggestions) && out.ruleSuggestions.length) {
    await db.collection('ruleSuggestions').add({ listingId, title: item.title || '', at: out.at, items: out.ruleSuggestions, verdict: out.verdict });
  }
  return out;
});

// 관리자: 정비구역 목록을 고친 뒤 물건 다시 연결(전체 또는 물건 몇 개)
exports.zoneMatchNow = onCall({ timeoutSeconds: 300, memory: '512MiB', secrets: [VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const ids = Array.isArray(request.data && request.data.listingIds) ? request.data.listingIds.slice(0, 100).map(String) : null;
  const out = await runZoneMatch({ deadline: Date.now() + 270e3, listingIds: ids });
  await logRun('zoneMatch', out);
  return out;
});

exports.landCheck = onCall({ timeoutSeconds: 60, secrets: [VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const { pnu, listingId } = request.data || {};
  const cacheRef = db.collection('landCache').doc(String(pnu || 'none'));
  const cached = await cacheRef.get();
  const fresh = cached.exists && !vworld.isEmptyLand(cached.data()) && Date.now() - new Date(cached.data().checkedAt).getTime() < 30 * 86400e3;
  const land = fresh ? cached.data() : await vworld.lookup({ pnu, key: VWORLD_KEY.value() });
  if (!fresh && !land.empty) await cacheRef.set(land);
  let housePrice = null;
  if (listingId) {
    const it = (await db.collection('listings').doc(listingId).get()).data() || {};
    housePrice = await vworld.housingPrice({ pnu, address: `${it.address || ''} ${it.title || ''} ${it.detail?.addressFull || ''}`, key: VWORLD_KEY.value() }).catch(() => null);
    await db.collection('listings').doc(listingId).set({ land, pnu, ...(housePrice ? { housePrice } : {}) }, { merge: true });
  }
  // 주변 필지 맹지 확인(요청 시)
  let neighbors = null;
  if (request.data && request.data.neighbors) {
    neighbors = await vworld.neighbors({ pnu, key: VWORLD_KEY.value() }).catch((e) => ({ error: e.message, checkedAt: new Date().toISOString() }));
    if (neighbors) {
      await db.collection('landCache').doc(`nb_${pnu}`).set(neighbors);
      if (listingId) await db.collection('listings').doc(listingId).set({ neighbors }, { merge: true });
    }
  }
  return { ...land, housePrice, neighbors };
});

// 관리자: 이 물건 상세 지금 받기(온비드) — 상세·사진·권리를 받고 토지이용까지 붙여 갱신된 물건을 돌려준다
exports.fetchDetailNow = onCall({ timeoutSeconds: 120, secrets: [DATA_GO_KR_KEY, VWORLD_KEY] }, async (request) => {
  requireAdmin(request);
  const listingId = request.data && request.data.listingId;
  if (!listingId) throw new HttpsError('invalid-argument', 'listingId 가 없습니다.');
  const ref = db.collection('listings').doc(String(listingId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', '물건을 찾을 수 없습니다.');
  const item = { id: snap.id, ...snap.data() };
  if (item.source !== 'onbid' || !item.cltrMngNo) throw new HttpsError('failed-precondition', '온비드 물건만 상세를 받을 수 있습니다.');
  const stats = { details: 0, errors: [] };
  await onbid.fetchDetails([item], {
    serviceKey: DATA_GO_KR_KEY.value(), quota: new Quota(db), save: saveListings, enrich: enrichLand, deadline: Date.now() + 100e3, stats,
  }, new Set());
  if (!stats.details) return { ok: false, message: stats.errors[0] || '온비드 상세 응답이 비어 있습니다.' };
  const fresh = (await ref.get()).data();
  return { ok: true, listing: { id: listingId, ...fresh }, errors: stats.errors };
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
  'bidEnd', 'status', 'landArea', 'buildingArea', 'share', 'shareRatio', 'bulk', 'thumbnail', 'url', 'detail', 'history', 'result', 'detailVer'];

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

// ---------- 등기부 열람본(미니PC 등기부 수집기) — 관리자 전용 ----------
//  registryTargets: 지금 경매 중인 법원 물건 중 열람본이 없는 것(입찰일 가까운 순, 없음 표시는 7일 뒤 다시)
//  registry: 정리한 열람본 저장 → registry 모음(관리자만 읽음). 물건에는 이름 없는 표시(registryFlags)만 붙인다
//  registryMiss: 마이옥션에서 못 찾음/열람본 없음 표시, registryState: 수집기 회차 결과
const plain = (v) => JSON.parse(JSON.stringify(v ?? null));
async function handleRegistry(body) {
  if (body.action === 'registryTargets') {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const weekAgo = Date.now() - 7 * 86400e3;
    const snap = await db.collection('listings').where('source', '==', 'court').select('court', 'caseNo', 'itemNo', 'bidEnd', 'status', 'registryAt', 'registryMissAt').get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((it) => !it.registryAt && String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10) >= today)
      .filter((it) => !/취하|기각|매각|종국/.test(it.status || ''))
      .filter((it) => !it.registryMissAt || new Date(it.registryMissAt).getTime() < weekAgo)
      .sort((a, b) => String(a.bidEnd).localeCompare(String(b.bidEnd)))
      .slice(0, Math.min(Number(body.limit) || 50, 200))
      .map(({ id, court, caseNo, itemNo, bidEnd }) => ({ id, court, caseNo, itemNo: itemNo || '1', bidEnd }));
    return { ok: true, items };
  }
  if (body.action === 'registry') {
    const docs = (Array.isArray(body.items) ? body.items : []).filter((d) => d && /^court_/.test(String(d.listingId || '')) && d.kind).slice(0, 10);
    const byListing = {};
    for (const d of docs) {
      const id = `${d.listingId}_${String(d.kind).replace(/[^\w가-힣]/g, '')}_${String(d.sourceType || d.sourceView || '').replace(/[^\w]/g, '')}`;
      await db.collection('registry').doc(id).set({ ...plain(d), savedAt: new Date().toISOString() });
      (byListing[d.listingId] ||= []).push(d);
    }
    for (const [lid, list] of Object.entries(byListing)) {
      const f = {}; // 종류별 표시를 합침(살아 있는 기록 수는 더하고, 나머지는 하나라도 있으면)
      for (const d of list) for (const [k, v] of Object.entries(d.flags || {})) {
        if (v === undefined || v === null) continue;
        if (typeof v === 'number') f[k] = (f[k] || 0) + v;
        else if (Array.isArray(v)) f[k] = [...(f[k] || []), ...v];
        else if (k === 'baseRight') { if (!f.baseRight || String(v.date) < String(f.baseRight.date)) f.baseRight = v; }
        else f[k] = f[k] || v;
      }
      await db.collection('listings').doc(lid).set(plain({
        registryAt: new Date().toISOString(), registryKinds: list.map((d) => d.kind),
        registryViewedAt: list.map((d) => d.viewedAt).filter(Boolean).sort()[0] || null, registryFlags: f,
      }), { merge: true });
    }
    return { ok: true, saved: docs.length, listings: Object.keys(byListing).length };
  }
  if (body.action === 'registryMiss') {
    if (!/^court_/.test(String(body.id || ''))) return { ok: false };
    await db.collection('listings').doc(String(body.id)).set({ registryMissAt: new Date().toISOString(), registryMissReason: String(body.reason || '') }, { merge: true });
    return { ok: true };
  }
  if (body.action === 'registryState') { await setState('registry', { lastRun: new Date().toISOString(), lastDay: kstDay(), ...plain(body.run || {}) }); return { ok: true }; }
  return { ok: false, error: '모르는 동작' };
}

// ---------- 법원 첨부(미니PC 수집기) ----------
//  file: PDF(감정평가서·현황조사서·매각물건명세서)·줄인 사진을 저장소 court/<물건>/ 에 저장
//   · PDF 열기 주소는 courtFiles/<물건> (관리자만 읽음)에만 둔다 → 일반 회원 화면에는 열기 버튼이 없다
//   · 물건(listings)에는 받았는지·크기만(courtDocs), 사진은 공개 주소(courtPhotoMap, 첫 장은 thumbnail)
//  fileMeta: 너무 커서 미니PC 하드에만 둔 문서 표시
const DOC_KIND = /^(감정평가서|현황조사서|매각물건명세서)$/;
const PHOTO_KIND = /^사진\d{2}$/;
const LISTING_ID = /^court_[가-힣A-Za-z0-9]+_\d{4}타경\d+_\d+$/;
// 같은 문서(병합·중복사건, 한 사건의 여러 물건번호)는 내용 해시로 한 번만 저장하고 물건마다 연결만 한다.
//  courtDocShared/<해시>: 이 문서를 쓰는 물건들(관리자 전용) → 화면에 '이 문서에 함께 든 사건' 표시
const HASH = /^[0-9a-f]{20}$/;
const cleanMeta = (m) => {
  const o = {};
  if (Array.isArray(m?.pages)) o.pages = m.pages.map(Number).filter((n) => n > 0 && n < 5000).slice(0, 40);
  if (Array.isArray(m?.cases)) o.cases = m.cases.map(String).filter((c) => /^\d{4}타경\d+$/.test(c)).slice(0, 30);
  if (Number(m?.totalPages)) o.totalPages = Number(m.totalPages);
  return o;
};
async function linkDoc(lid, kind, info) {
  const { hash } = info;
  let sharedWith = [];
  if (hash) {
    const ref = db.collection('courtDocShared').doc(hash);
    await ref.set({ kind, listingIds: FieldValue.arrayUnion(lid), updatedAt: info.at }, { merge: true });
    sharedWith = ((await ref.get()).data()?.listingIds || []).filter((x) => x !== lid);
  }
  await db.collection('courtFiles').doc(lid).set({ [kind]: { ...info, sharedWith: sharedWith.slice(0, 50) } }, { merge: true });
  await db.collection('listings').doc(lid).set({ courtDocs: { [kind]: plain({ size: info.size || null, at: info.at, local: info.local || undefined, shared: sharedWith.length || undefined, pages: info.pages?.length ? info.pages : undefined, cases: info.cases?.length > 1 ? info.cases : undefined }) } }, { merge: true });
  return sharedWith.length;
}

async function handleCourtFile(body) {
  const lid = String(body.listingId || ''); const kind = String(body.kind || '');
  if (!LISTING_ID.test(lid)) return { ok: false, error: '물건 번호 형식' };
  if (!DOC_KIND.test(kind) && !PHOTO_KIND.test(kind)) return { ok: false, error: '첨부 종류' };
  const at = new Date().toISOString();
  const hash = HASH.test(String(body.hash || '')) ? String(body.hash) : null;
  const meta = cleanMeta(body.meta);
  if (body.action === 'fileText') {
    // 현황조사서 원문 글자(팝업 화면 글자, OCR 아님) — 점유자 이름 등이 있어 관리자 전용 courtFiles 에만
    if (!DOC_KIND.test(kind)) return { ok: false, error: '첨부 종류' };
    const text = String(body.text || '').slice(0, 200000);
    if (!text.trim()) return { ok: false, error: '빈 글자' };
    await db.collection('courtFiles').doc(lid).set({ [`${kind}글자`]: text, [`${kind}글자At`]: at }, { merge: true });
    await db.collection('listings').doc(lid).set({ courtDocs: { [`${kind}글자`]: { chars: text.length, at } } }, { merge: true });
    return { ok: true };
  }
  if (body.action === 'fileMeta') {
    if (!DOC_KIND.test(kind)) return { ok: false, error: '첨부 종류' };
    await linkDoc(lid, kind, { size: Number(body.size) || null, local: true, at, hash, ...meta });
    return { ok: true };
  }
  if (body.action === 'fileRef') {
    // 같은 내용 문서가 이미 올라와 있으면 파일 없이 연결만
    if (!DOC_KIND.test(kind) || !hash) return { ok: false, error: '연결 정보' };
    const file = getStorage().bucket().file(`court/docs/${kind}_${hash}.pdf`);
    const [exists] = await file.exists();
    if (!exists) return { ok: true, need: true };
    const [md] = await file.getMetadata();
    const shared = await linkDoc(lid, kind, { url: await getDownloadURL(file), size: Number(md.size) || null, at, hash, ...meta });
    return { ok: true, linked: true, shared };
  }
  const buf = Buffer.from(String(body.data || ''), 'base64');
  const isJpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;
  const isPdfBuf = buf.length > 4 && buf.slice(0, 4).toString() === '%PDF';
  if (!buf.length || buf.length > 23 * 1024 * 1024) return { ok: false, error: '크기' };
  if (PHOTO_KIND.test(kind) ? !isJpg : !isPdfBuf) return { ok: false, error: '파일 형식' };
  const bucket = getStorage().bucket();
  if (PHOTO_KIND.test(kind)) {
    const file = bucket.file(`court/${lid}/${kind}.jpg`);
    await file.save(buf, { contentType: 'image/jpeg', resumable: false, metadata: { cacheControl: 'private, max-age=86400' } });
    const url = await getDownloadURL(file);
    const upd = { courtPhotoMap: { [kind]: url } };
    if (kind === '사진01') upd.thumbnail = url;
    await db.collection('listings').doc(lid).set(upd, { merge: true });
    return { ok: true, kind, size: buf.length };
  }
  // PDF: 해시가 있으면 공유 경로(한 번만 저장), 없으면 물건 경로
  const file = bucket.file(hash ? `court/docs/${kind}_${hash}.pdf` : `court/${lid}/${kind}.pdf`);
  const [exists] = hash ? await file.exists() : [false];
  if (!exists) await file.save(buf, { contentType: 'application/pdf', resumable: false, metadata: { cacheControl: 'private, max-age=86400' } });
  const shared = await linkDoc(lid, kind, { url: await getDownloadURL(file), size: buf.length, at, hash, ...meta });
  return { ok: true, kind, size: buf.length, shared };
}

exports.ingestCourt = onRequest({ secrets: [COURT_INGEST_TOKEN, VWORLD_KEY, DATA_GO_KR_KEY], timeoutSeconds: 300, memory: '1GiB', cors: false }, async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('POST만 받습니다'); return; }
  const auth = String(req.get('authorization') || '');
  if (!COURT_INGEST_TOKEN.value() || auth !== `Bearer ${COURT_INGEST_TOKEN.value()}`) { res.status(401).send('토큰이 맞지 않습니다'); return; }
  const body = req.body || {};
  if (['file', 'fileMeta', 'fileText', 'fileRef'].includes(body.action)) {
    try { res.json(await handleCourtFile(body)); } catch (e) { logger.error('court file', body.listingId, body.kind, e.message); res.status(500).json({ ok: false, error: e.message.slice(0, 200) }); }
    return;
  }
  if (body.action) { res.json(await handleRegistry(body)); return; }
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 200).map(cleanCourtItem).filter(Boolean);
  const { needDetail } = await saveListings(items);
  // 땅 정보 붙이기는 90초까지만. 브이월드·건축HUB가 느린 날 20건을 다 붙이다 300초를 넘겨 504가 나던 문제(10/23).
  // 못 붙인 물건은 새벽 정기 작업(runLandBacklog, 20분마다)이 이어서 붙인다.
  const enrichUntil = Date.now() + 90e3;
  let enriched = 0; let enrichLeft = 0;
  for (const it of items.filter((x) => x.pnu || x.address).slice(0, 50)) {
    if (Date.now() > enrichUntil) { enrichLeft++; continue; }
    try { const extra = await enrichLand(it); if (Object.keys(extra).length) { await db.collection('listings').doc(it.id).set(extra, { merge: true }); enriched++; } } catch (e) { logger.warn('court enrich', it.id, e.message); }
  }
  if (body.run) await setState('court', { lastRun: new Date().toISOString(), lastDay: kstDay(), ...JSON.parse(JSON.stringify(body.run)) });
  res.json({ ok: true, received: Array.isArray(body.items) ? body.items.length : 0, saved: items.length, changed: needDetail.length, enriched, enrichLeft });
});

