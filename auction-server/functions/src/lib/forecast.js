// 입찰 전 예측 기록 — 매일 밤 진행 중인 물건을 화면과 같은 계산식으로 판정해 '그때 우리가 뭐라고 했는지'를 저장한다.
// 입찰(매각)기일이 되면 더 이상 고치지 않는다(결과를 보고 예측을 바꾸지 않도록). 완료 물건 화면에서 실제 결과와 비교한다.
// 계산식(분석기 버전)이 바뀌면: 이미 기록된 예측(forecast·forecastFirst)은 절대 덮어쓰지 않고,
// 새 계산은 '수정 후 참고값'(forecastRevised)에만 넣는다. 채점은 기록된 forecast 그대로.
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

// 저장할 예측 요약(작게)
function summarize(it, a, day, bid = null, plan = null) {
  const sp = a.special;
  const R = (x) => (x ? { k: x.k, date: x.date || null, price: x.price, bid: x.bid, survive: Math.round(x.survive * 1000) / 1000 } : null);
  return {
    // 유찰 예측 — 몇 회 더 유찰되면 매력인가, 몇 회 뒤에 팔릴 것 같나(완료 후 실제와 채점)
    rounds: plan ? { failCount: typeof it.failCount === 'number' ? it.failCount : null, firstOk: R(plan.firstOk), best: R(plan.best), expectSale: R(plan.expectSale) } : null,
    // 우리 입찰가(예상 낙찰가, 가산 0%) — 완료 물건 채점은 이 값 그대로
    bid: bid?.price || null, bidPremium: bid?.premium || null, bidScope: bid?.scope || null,
    at: day, rules: RULES_VERSION, analyzerVersion: a.analyzerVersion || null,
    verdict: a.verdict, minBid: it.minBid || null, appraisal: it.appraisal || null, round: it.round || null,
    value: a.value ?? null, full: a.full ?? null, cap: a.cap ?? null,
    entryLabel: a.entry?.label || null, entryPrice: a.entry?.price || null,
    score: a.score?.total ?? null, grade: a.score?.grade || null,
    profit: a.money?.profit ?? null, own: a.money?.own ?? null,
    special: sp ? sp.types.map((t) => t.key) : [], floor: sp?.floorKnown ? sp.floor : null, expected: sp?.expected ?? null,
    opportunity: a.opportunity ? { kind: a.opportunity.kind, profit: a.opportunity.profit } : null,
    anomalies: (a.anomalies || []).length,
    calcAnomaly: a.calcAnomaly || null, shareUnknown: Boolean(a.shareUnknown),
  };
}

async function run({ db, log = console.log, deadline = Infinity }) {
  const { analyze, tradeTypeOf, ANALYZER_VERSION } = await import('../shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('../shared/defaults.mjs');
  const { premiumTable, predictPrice } = await import('../shared/bidForecast.mjs');
  const { roundPlan, soldRateTable } = await import('../shared/roundPlan.mjs');
  const { courtRate } = await import('../shared/analyze.mjs');
  const s = await db.collection('settings').doc('main').get();
  const settings = { ...DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
  const now = kstNow();
  // 메모리 아끼기(10-24부터 물건이 2만 7천 건으로 늘어 1GB를 넘겨 'internal' 오류로 죽던 문제):
  //  ① 기준표(낙찰가÷최저가, 낙찰률)는 필요한 칸만 골라 읽는다(select)
  //  ② 예측할 물건은 기일이 오늘 이후인 것만, 500건씩 나눠 읽으며 바로 처리한다(기일 빠른 것부터)
  const TABLE_FIELDS = ['result', 'minBid', 'appraisal', 'status', 'failCount', 'round', 'source', 'usageSmall', 'usage', 'title', 'detail.landCategory', 'land.jimok', 'buildingArea', 'landArea', 'caseNo', 'address', 'bidEnd'];
  const [lsSnap, past] = await Promise.all([
    db.collection('listings').select(...TABLE_FIELDS).get(),
    db.collection('pastResults').select(...TABLE_FIELDS).get().catch(() => ({ docs: [] })),
  ]);
  const ids = new Set(lsSnap.docs.map((d) => d.id));
  const doneItems = [...lsSnap.docs.map((d) => d.data()), ...past.docs.filter((d) => !ids.has(d.id)).map((d) => d.data())];
  const table = premiumTable(doneItems);
  const rates = soldRateTable(doneItems); // 회차별 '남아 있을 확률'용 낙찰률
  const totalListings = lsSnap.size;
  // 같은 물건의 회차표(화면과 같은 방식) — 진입 시점을 공고의 실제 회차 가격으로 계산하게
  const { dedupeRounds } = await import('../shared/rounds.mjs');
  const roundsByKey = new Map();
  dedupeRounds(lsSnap.docs.map((d) => ({ id: d.id, ...d.data() })), now.day).forEach((g) => { if (g.groupIds) g.groupIds.forEach((id) => roundsByKey.set(id, g.roundList)); });
  const cache = new Map();
  let batch = db.batch(); let n = 0; const stats = { total: totalListings, scanned: 0, forecast: 0, revised: 0, frozen: 0, errors: 0, calcAnomaly: 0, analyzerVersion: ANALYZER_VERSION };
  // bidEnd 는 '2026-10-28 17:00'(온비드)과 '2026.10.28'(법원) 두 형식 — 웹 화면과 같은 방식으로 형식별 범위를 나눠 읽는다
  const y = now.day.slice(0, 4);
  const ranges = [
    db.collection('listings').where('bidEnd', '>=', now.day).where('bidEnd', '<', `${y}-~`).orderBy('bidEnd'),
    db.collection('listings').where('bidEnd', '>=', now.day.replace(/-/g, '.')).orderBy('bidEnd'),
  ];
  const seen = new Set();
  async function* pages() {
    for (const q of ranges) {
      let last = null;
      for (;;) {
        const snap = await (last ? q.startAfter(last) : q).limit(500).get();
        if (snap.empty) break;
        yield snap.docs;
        last = snap.docs[snap.docs.length - 1];
        if (snap.size < 500) break;
      }
    }
  }
  outer: for await (const docs of pages()) for (const doc of docs) {
    if (seen.has(doc.id)) continue; seen.add(doc.id); stats.scanned++;
    if (Date.now() > deadline) { stats.stoppedBy = 'time'; break outer; }
    const it = { id: doc.id, ...doc.data() };
    if (!beforeBid(it, now)) { stats.frozen++; continue; }
    try {
      const lawd = lawdOf(it.sido, it.sgg);
      const deals = lawd ? await loadDeals(db, tradeTypeOf(it), lawd, cache) : [];
      const rl = roundsByKey.get(it.id);
      // 이 회차부터의 회차표(앞 회차는 뺌)
      if (rl) { const i = rl.findIndex((r) => r.id === it.id); if (i >= 0 && rl.length - i > 1) it.roundList = rl.slice(i); }
      const a = analyze(it, { settings, deals, bidPremium: predictPrice(it, table)?.premium });
      let plan = null; try { plan = roundPlan(it, a, { premium: table, rates, courtRate: courtRate(it, settings).rate }); } catch { plan = null; }
      const f = summarize(it, { ...a, analyzerVersion: ANALYZER_VERSION }, now.day, predictPrice(it, table), plan);
      const upd = {};
      const recorded = it.forecast ? it.forecast.analyzerVersion || null : null;
      if (!it.forecast || recorded === ANALYZER_VERSION) { upd.forecast = f; stats.forecast++; } // 같은 분석기로 기록 중인 물건만 기일 전까지 갱신
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

module.exports = { run, beforeBid, summarize, loadDeals, RULES_VERSION };
