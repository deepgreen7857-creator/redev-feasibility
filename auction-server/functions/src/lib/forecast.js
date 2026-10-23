// 입찰 전 예측 기록 — 매일 밤 진행 중인 물건을 화면과 같은 계산식으로 판정해 '그때 우리가 뭐라고 했는지'를 저장한다.
// 입찰(매각)기일이 되면 더 이상 고치지 않는다(결과를 보고 예측을 바꾸지 않도록). 완료 물건 화면에서 실제 결과와 비교한다.
const RULES_VERSION = '2026-10-23b';

const ENDED = /(낙찰|매각|유찰|종결|취소|기각|변경|마감)/;

function kstNow() {
  const d = new Date(Date.now() + 9 * 3600e3);
  return { day: d.toISOString().slice(0, 10), stamp: d.toISOString().slice(0, 16).replace('T', ' ') };
}

// 아직 입찰 전인가: 기일이 '내일 이후'(날짜만 있으면) 또는 마감 시각이 지금 이후(시각까지 있으면)
function beforeBid(it, now = kstNow()) {
  if (it.result) return false;
  if (ENDED.test(it.status || '') && !/진행/.test(it.status || '')) return false;
  const e = String(it.bidEnd || '').replace(/\./g, '-').trim();
  if (!e) return false;
  return e.length <= 10 ? e.slice(0, 10) > now.day : e.slice(0, 16) > now.stamp;
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
function summarize(it, a, day) {
  const sp = a.special;
  return {
    at: day, rules: RULES_VERSION,
    verdict: a.verdict, minBid: it.minBid || null, appraisal: it.appraisal || null, round: it.round || null,
    value: a.value ?? null, full: a.full ?? null, cap: a.cap ?? null,
    entryLabel: a.entry?.label || null, entryPrice: a.entry?.price || null,
    score: a.score?.total ?? null, grade: a.score?.grade || null,
    profit: a.money?.profit ?? null, own: a.money?.own ?? null,
    special: sp ? sp.types.map((t) => t.key) : [], floor: sp?.floorKnown ? sp.floor : null, expected: sp?.expected ?? null,
    opportunity: a.opportunity ? { kind: a.opportunity.kind, profit: a.opportunity.profit } : null,
    anomalies: (a.anomalies || []).length,
  };
}

async function run({ db, log = console.log, deadline = Infinity }) {
  const { analyze, tradeTypeOf } = await import('../shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('../shared/defaults.mjs');
  const s = await db.collection('settings').doc('main').get();
  const settings = { ...DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
  const now = kstNow();
  const snap = await db.collection('listings').get();
  const cache = new Map();
  let batch = db.batch(); let n = 0; const stats = { total: snap.size, forecast: 0, frozen: 0, errors: 0 };
  for (const doc of snap.docs) {
    if (Date.now() > deadline) { stats.stoppedBy = 'time'; break; }
    const it = { id: doc.id, ...doc.data() };
    if (!beforeBid(it, now)) { stats.frozen++; continue; }
    try {
      const lawd = lawdOf(it.sido, it.sgg);
      const deals = lawd ? await loadDeals(db, tradeTypeOf(it), lawd, cache) : [];
      const a = analyze(it, { settings, deals });
      const f = summarize(it, a, now.day);
      const upd = { forecast: f };
      if (!it.forecastFirst) upd.forecastFirst = f; // 처음 본 날의 예측도 남겨 둔다(회차가 내려가며 판단이 어떻게 바뀌었나)
      batch.set(doc.ref, upd, { merge: true }); n++; stats.forecast++;
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    } catch (e) { stats.errors++; if (stats.errors <= 5) log(`예측 오류 ${doc.id}: ${e.message}`); }
  }
  if (n) await batch.commit();
  log(`예측 기록: ${JSON.stringify(stats)}`);
  return stats;
}

module.exports = { run, beforeBid, summarize, loadDeals, RULES_VERSION };
