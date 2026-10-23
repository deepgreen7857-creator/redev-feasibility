// 분석기 수정 뒤 기존 물건 전체 재계산 — '수정 후 참고값'(forecastRevised)에만 저장한다.
//  · 기록된 예측(forecast·forecastFirst·forecastHistory)은 절대 건드리지 않는다. 완료 물건 채점은 기록된 값 그대로.
//  · 수정 전(기록된 예측)과 수정 후 값이 크게 달라진 물건, 정비구역이 새로 연결된 물건을 보고서(recalcReports)로 남긴다.
//  · 한 번에 다 못 하면(함수 제한 9분) 커서를 남기고, 관리자 화면에서 다시 누르면 이어서 한다.
const { FieldValue } = require('firebase-admin/firestore');
const { summarize, analyzeItem, tally } = require('./forecast');

const PAGE = 300;
const LIST_CAP = 1000; // 보고서 목록 최대 건수(문서 1MB 한도)

// 크게 달라졌나: 판정이 바뀌었거나, 가치·매수상한이 30% 넘게 바뀌었거나, 계산 이상·지분비율 미확인이 새로 생김
function bigChange(before, after) {
  if (!before) return null;
  const why = [];
  if (before.verdict !== after.verdict) why.push(`판정 ${before.verdict} → ${after.verdict}`);
  const rel = (x, y) => (x && y ? Math.abs(y - x) / Math.abs(x) : x || y ? 1 : 0);
  for (const [k, name] of [['value', '가치'], ['cap', '매수상한']]) {
    const x = before[k] ?? null; const y = after[k] ?? null;
    if ((x === null) !== (y === null)) why.push(`${name} ${x === null ? '없음' : Math.round(x / 1e4).toLocaleString('ko-KR') + '만'} → ${y === null ? '없음' : Math.round(y / 1e4).toLocaleString('ko-KR') + '만'}`);
    else if (x !== null && rel(x, y) > 0.3) why.push(`${name} ${Math.round(x / 1e4).toLocaleString('ko-KR')}만 → ${Math.round(y / 1e4).toLocaleString('ko-KR')}만`);
  }
  if (!before.calcAnomaly && after.calcAnomaly) why.push('계산 이상 새로 표시');
  if (!before.shareUnknown && after.shareUnknown) why.push('지분비율 미확인으로 금액 계산 중단');
  return why.length ? why : null;
}

// runZoneMatch: index.js 의 정비구역 연결(전체 물건) — 연결 전후를 비교해 새로 연결된 물건을 돌려준다
async function run({ db, log = console.log, deadline = Infinity, reset = false, runZoneMatch }) {
  const { ANALYZER_VERSION, analyze, tradeTypeOf } = await import('../shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('../shared/defaults.mjs');
  const s = await db.collection('settings').doc('main').get();
  const settings = { ...DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
  const stRef = db.collection('state').doc('recalc');
  let st = (await stRef.get()).data() || {};
  const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  // 새 분석기 버전이거나 처음부터 다시 → 새 보고서
  if (reset || st.version !== ANALYZER_VERSION || st.done) {
    const reportRef = db.collection('recalcReports').doc();
    await reportRef.set({
      analyzerVersion: ANALYZER_VERSION, startedAt: new Date().toISOString(), day, done: false, phase: 'zones',
      counts: { processed: 0, written: 0, current: 0, noBaseline: 0, bigChanges: 0, newZoneLinks: 0, calcAnomaly: 0, errors: 0 },
      share: { total: 0, unknown: 0, bySource: {} }, noAppraisal: { total: 0, by: {} }, bigChanges: [], newZoneLinks: [],
    });
    st = { version: ANALYZER_VERSION, reportId: reportRef.id, phase: 'zones', cursor: null, done: false };
    await stRef.set(st);
  }
  const reportRef = db.collection('recalcReports').doc(st.reportId);

  // ① 정비구역 다시 연결(진행·완료 전체) — 새로 연결된 물건 목록
  if (st.phase === 'zones') {
    const z = await runZoneMatch({ deadline: Math.min(deadline, Date.now() + 240e3), all: true });
    const links = (z.newlyListed || []).slice(0, LIST_CAP);
    await reportRef.set({ zoneMatch: { ...z, newlyListed: undefined }, ...(links.length ? { newZoneLinks: FieldValue.arrayUnion(...links) } : {}), counts: { newZoneLinks: FieldValue.increment(links.length) } }, { merge: true });
    if (z.stoppedBy) { log(`재계산: 정비구역 연결 시간 초과 — 다시 누르면 이어서`); return { ...(await reportRef.get()).data(), id: reportRef.id, partial: true }; }
    st = { ...st, phase: 'analyze', cursor: null };
    await stRef.set(st);
  }

  // ② 판정 다시 계산 → forecastRevised 만
  const cache = new Map();
  let cursor = st.cursor || null; let stopped = false;
  const tallyStats = { share: { total: 0, unknown: 0, bySource: {} }, noAppraisal: { total: 0, by: {} } };
  const counts = { processed: 0, written: 0, current: 0, noBaseline: 0, bigChanges: 0, calcAnomaly: 0, errors: 0 };
  const changes = [];
  while (!stopped) {
    let q = db.collection('listings').orderBy('__name__').limit(PAGE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    let batch = db.batch(); let n = 0;
    for (const doc of snap.docs) {
      if (Date.now() > deadline) { stopped = true; break; }
      const it = { id: doc.id, ...doc.data() };
      cursor = doc.id; counts.processed++;
      try {
        const a = await analyzeItem(db, it, settings, cache, analyze, tradeTypeOf, lawdOf);
        tally(tallyStats, it, a);
        const f = summarize(it, { ...a, analyzerVersion: ANALYZER_VERSION }, day);
        if (a.calcAnomaly) counts.calcAnomaly++;
        const before = it.forecast || null;
        if (before && before.analyzerVersion === ANALYZER_VERSION) { counts.current++; continue; } // 이미 지금 분석기로 기록 중
        if (!before) counts.noBaseline++;
        batch.set(doc.ref, { forecastRevised: { ...f, recalcAt: new Date().toISOString(), note: before ? `분석기 ${ANALYZER_VERSION} 재계산 참고값 — 기록된 예측(${before.analyzerVersion || `규칙 ${before.rules}`} · ${before.at})은 보존` : `분석기 ${ANALYZER_VERSION} 재계산 참고값 — 입찰 전 기록 없음(채점에 쓰지 않음)` } }, { merge: true });
        n++; counts.written++;
        const why = bigChange(before, f);
        if (why) { counts.bigChanges++; if (changes.length < LIST_CAP) changes.push({ id: doc.id, title: it.title || '', minBid: it.minBid || null, before: { verdict: before.verdict, value: before.value ?? null, cap: before.cap ?? null, version: before.analyzerVersion || before.rules || null }, after: { verdict: f.verdict, value: f.value, cap: f.cap }, why }); }
      } catch (e) { counts.errors++; if (counts.errors <= 5) log(`재계산 오류 ${doc.id}: ${e.message}`); }
      if (n >= 400) { await batch.commit(); batch = db.batch(); n = 0; }
    }
    if (n) await batch.commit();
    if (snap.size < PAGE) break;
  }

  // 보고서에 이번 몫을 더한다(여러 번 나눠 돌아도 합계가 맞게)
  const inc = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, FieldValue.increment(v)]));
  const incMap = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, FieldValue.increment(v)]));
  await reportRef.set({
    counts: inc(counts),
    share: { total: FieldValue.increment(tallyStats.share.total), unknown: FieldValue.increment(tallyStats.share.unknown), bySource: incMap(tallyStats.share.bySource) },
    noAppraisal: { total: FieldValue.increment(tallyStats.noAppraisal.total), by: incMap(tallyStats.noAppraisal.by) },
    ...(changes.length ? { bigChanges: FieldValue.arrayUnion(...changes) } : {}),
    updatedAt: new Date().toISOString(), cursor: stopped ? cursor : null, done: !stopped, phase: stopped ? 'analyze' : 'done',
  }, { merge: true });
  await stRef.set({ ...st, cursor: stopped ? cursor : null, done: !stopped, phase: stopped ? 'analyze' : 'done' });
  log(`재계산(${ANALYZER_VERSION}): ${JSON.stringify(counts)}${stopped ? ' — 시간 초과, 이어서 하려면 다시 실행' : ''}`);
  return { ...(await reportRef.get()).data(), id: reportRef.id, partial: stopped };
}

module.exports = { run, bigChange };
