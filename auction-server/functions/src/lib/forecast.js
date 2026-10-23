// 입찰 전 예측 기록 — 매일 밤 진행 중인 물건을 화면과 같은 계산식으로 판정해 '그때 우리가 뭐라고 했는지'를 저장한다.
// 입찰(매각)기일이 되면 더 이상 고치지 않는다(결과를 보고 예측을 바꾸지 않도록). 완료 물건 화면에서 실제 결과와 비교한다.
// 계산식(분석기 버전)이 바뀌면: 이미 기록된 예측(forecast·forecastFirst)은 절대 덮어쓰지 않고,
// 새 계산은 '수정 후 참고값'(forecastRevised)에만 넣는다. 채점은 기록된 forecast 그대로.
// 법원 물건은 회차가 바뀌어도 같은 문서라서, 다음 회차 예측이 지난 회차 기록을 덮어쓰던 문제가 있었다
// → 회차(기일)가 바뀌면 지난 기록을 forecastHistory 에 그대로 옮겨 두고(지우지 않음) 새 회차 예측을 기록한다.
const RULES_VERSION = '2026-10-23d';


function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { day: d.toISOString().slice(0, 10), stamp: d.toISOString().slice(0, 16).replace('T', ' ') };
}

// 아직 입찰 전인가: 기일이 '내일 이후'(날짜만 있으면) 또는 마감 시각이 지금 이후(시각까지 있으면)
// 법원 상태 '유찰'은 지난 회차 결과다 — 다음 기일이 미래면 진행 중으로 본다(전에는 이 때문에 법원 진행 물건이 예측 기록에서 빠졌음).
// 낙찰·매각(팔림)이나 취하·취소·정지·기각·종결처럼 끝난 상태만 막는다.
const CLOSED = /(낙찰|매각|취하|취소|정지|기각|종결)/;
function beforeBid(it, now = kstNow()) {
  if (it.result?.soldPrice) return false;
  const e = String(it.bidEnd || '').replace(/\./g, '-').trim();
  if (!e) return false;
  const future = e.length <= 10 ? e.slice(0, 10) > now.day : e.slice(0, 16) > now.stamp;
  if (!future) return false;
  if (CLOSED.test(it.status || '') && !/진행/.test(it.status || '')) return false;
  return true;
}

function yms(months = 12) {
  const out = []; const now = new Date(Date.now() + 9 * 3600e3);
  for (let i = 0; i < months; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  return out;
}

async function loadDeals(db, type, lawd, cache) {
  const key = `${type}|${lawd}`;
  if (cache.has(key)) return cache.get(key);
  const months = yms(12);
  const snaps = await db.getAll(...months.map((ym) => db.collection('tradeMonths').doc(`${type}_${lawd}_${ym}`)));
  const deals = snaps.flatMap((s, i) => { if (!s.exists) return []; try { return JSON.parse(s.data().d || '[]').map((d) => [...d, months[i]]); } catch { return []; } });
  cache.set(key, deals);
  return deals;
}

// 화면(상세)과 같은 자료로 판정: 매매·아파트(입주권)·전월세 실거래
async function analyzeItem(db, it, settings, cache, analyze, tradeTypeOf, lawdOf) {
  const lawd = lawdOf(it.sido, it.sgg); const t = tradeTypeOf(it);
  const deals = lawd ? await loadDeals(db, t, lawd, cache) : [];
  const rentDeals = lawd && ['apt', 'rh', 'sh', 'offi'].includes(t) ? await loadDeals(db, `${t}Rent`, lawd, cache) : [];
  const aptDeals = lawd ? (t === 'apt' ? deals : await loadDeals(db, 'apt', lawd, cache)) : [];
  return analyze(it, { settings, deals, aptDeals, rentDeals });
}

// 같은 회차의 예측인가(기일이 같으면 같은 회차, 예전 기록은 회차·최저가로)
const dayOf = (v) => String(v || '').replace(/\./g, '-').slice(0, 10);
function sameRound(f, it) {
  if (!f) return false;
  if (f.bidEnd) return dayOf(f.bidEnd) === dayOf(it.bidEnd);
  if (!f.minBid && !f.round) return true; // 회차를 알 수 없는 기록은 같은 회차로 본다(잘못 옮기지 않게)
  return (f.round || null) === (it.round || null) && (f.minBid || null) === (it.minBid || null);
}

// 저장할 예측 요약(작게)
function summarize(it, a, day) {
  const sp = a.special;
  return {
    at: day, rules: RULES_VERSION, analyzerVersion: a.analyzerVersion || null,
    verdict: a.verdict, minBid: it.minBid || null, appraisal: it.appraisal || null, round: it.round || null, bidEnd: it.bidEnd || null,
    value: a.value ?? null, full: a.full ?? null, cap: a.cap ?? null,
    entryLabel: a.entry?.label || null, entryPrice: a.entry?.price || null,
    score: a.score?.total ?? null, grade: a.score?.grade || null,
    profit: a.money?.profit ?? null, own: a.money?.own ?? null,
    special: sp ? sp.types.map((t) => t.key) : [], floor: sp?.floorKnown ? sp.floor : null, expected: sp?.expected ?? null,
    opportunity: a.opportunity ? { kind: a.opportunity.kind, profit: a.opportunity.profit } : null,
    anomalies: (a.anomalies || []).length,
    calcAnomaly: a.calcAnomaly || null, shareUnknown: Boolean(a.shareUnknown),
    zone: a.zoneInfo?.name ? { name: a.zoneInfo.name, stage: a.zoneInfo.stage, before: a.zoneInfo.before, rights: a.rights77?.status || null } : null,
  };
}

// 진단 집계: 지분비율을 어디서 읽었나/못 읽었나, 감정가 없는 물건은 무엇으로 추정했나
function tally(stats, it, a) {
  if (a.share?.share) {
    stats.share.total++;
    if (!a.share.ratio) stats.share.unknown++;
    const k = a.share.source || '미확인'; stats.share.bySource[k] = (stats.share.bySource[k] || 0) + 1;
  }
  if (!it.appraisal) {
    stats.noAppraisal.total++;
    const used = (a.valuation?.anchors || []).filter((x) => x.used && x.value).map((x) => x.key);
    const k = used.length ? used.join('+') : a.full ? (/공시지가/.test(a.valueBasis || '') ? 'official' : 'other') : 'none';
    stats.noAppraisal.by[k] = (stats.noAppraisal.by[k] || 0) + 1;
  }
}

async function run({ db, log = console.log, deadline = Infinity }) {
  const { analyze, tradeTypeOf, ANALYZER_VERSION } = await import('../shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('../shared/defaults.mjs');
  const s = await db.collection('settings').doc('main').get();
  const settings = { ...DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
  const now = kstNow();
  const snap = await db.collection('listings').get();
  const cache = new Map();
  let batch = db.batch(); let n = 0;
  const stats = { total: snap.size, forecast: 0, revised: 0, newRound: 0, frozen: 0, errors: 0, calcAnomaly: 0, analyzerVersion: ANALYZER_VERSION, share: { total: 0, unknown: 0, bySource: {} }, noAppraisal: { total: 0, by: {} } };
  for (const doc of snap.docs) {
    if (Date.now() > deadline) { stats.stoppedBy = 'time'; break; }
    const it = { id: doc.id, ...doc.data() };
    if (!beforeBid(it, now)) { stats.frozen++; continue; }
    try {
      const a = await analyzeItem(db, it, settings, cache, analyze, tradeTypeOf, lawdOf);
      tally(stats, it, a);
      const f = summarize(it, { ...a, analyzerVersion: ANALYZER_VERSION }, now.day);
      const upd = {};
      const recorded = it.forecast ? it.forecast.analyzerVersion || null : null;
      if (it.forecast && !sameRound(it.forecast, it)) {
        // 지난 회차 예측은 그대로 이력으로(덮어쓰지 않음), 이번 회차는 지금 분석기로 새로 기록
        upd.forecastHistory = [...(Array.isArray(it.forecastHistory) ? it.forecastHistory : []), { ...it.forecast, closedAt: now.day }];
        upd.forecast = f; stats.newRound++;
      } else if (!it.forecast || recorded === ANALYZER_VERSION) { upd.forecast = f; stats.forecast++; } // 같은 분석기로 기록 중인 물건만 기일 전까지 갱신
      else { upd.forecastRevised = { ...f, note: `분석기 ${ANALYZER_VERSION} 재계산 참고값 — 기록된 예측(${it.forecast.analyzerVersion || `규칙 ${it.forecast.rules}`} · ${it.forecast.at})은 보존` }; stats.revised++; }
      if (!it.forecastFirst) upd.forecastFirst = f; // 처음 본 날의 예측도 남겨 둔다(회차가 내려가며 판단이 어떻게 바뀌었나)
      batch.set(doc.ref, upd, { merge: true }); n++;
      // 계산 이상 → 관리자 이상치 목록
      const aref = db.collection('adminAlerts').doc(`calc_${doc.id}`);
      if (a.calcAnomaly) { batch.set(aref, { type: 'calcAnomaly', listingId: doc.id, title: it.title || '', minBid: it.minBid || null, reasons: a.calcAnomaly, value: a.value ?? null, roi: a.money?.roi ?? null, analyzerVersion: ANALYZER_VERSION, at: now.day, resolved: false }, { merge: true }); n++; stats.calcAnomaly++; }
      else if (it.forecast?.calcAnomaly || it.forecastRevised?.calcAnomaly) { batch.set(aref, { resolved: true, resolvedAt: now.day }, { merge: true }); n++; }
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    } catch (e) { stats.errors++; if (stats.errors <= 5) log(`예측 오류 ${doc.id}: ${e.message}`); }
  }
  if (n) await batch.commit();
  log(`예측 기록: ${JSON.stringify(stats)}`);
  return stats;
}

module.exports = { run, beforeBid, summarize, loadDeals, analyzeItem, sameRound, tally, RULES_VERSION };
