// 화면용 '묶음 자료'(스냅숏) — 접속할 때마다 물건 수천 건을 하나하나 받지 않게, 서버가 하루 한 번 미리 묶어 둔다.
//  snapshots/{name}            { version, chunks, count, bytes, builtAt }
//  snapshots/{name}/chunks/{i} { b: gzip 묶음 조각(바이트) }
//  화면은 snapshots/{name} 한 건만 읽어 버전이 같으면 브라우저에 보관한 것을 그대로 쓰고, 다를 때만 조각 몇 개를 받는다.
const zlib = require('zlib');

const CHUNK = 900 * 1000; // Firestore 문서 한도(1MiB)보다 작게

// 진단용 원본 응답(…Raw)은 화면에 필요 없어서 뺀다. 상세 화면은 물건 문서를 따로 읽는다.
function lean(v) {
  if (Array.isArray(v)) return v.map(lean);
  if (v && typeof v === 'object') {
    if (typeof v.toDate === 'function') return v.toDate().toISOString();
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (k === 'raw' || k.endsWith('Raw')) continue; o[k] = lean(x); }
    return o;
  }
  return v;
}

async function write(db, name, rows) {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(rows)), { level: 9 });
  const count = Array.isArray(rows) ? rows.length : (rows.cards || []).length;
  const version = `${Date.now().toString(36)}-${count}`;
  const parts = [];
  for (let i = 0; i < gz.length; i += CHUNK) parts.push(gz.subarray(i, i + CHUNK));
  const base = db.collection('snapshots').doc(name);
  // 조각을 먼저 다 쓰고 마지막에 안내 문서를 바꾼다(받는 도중 섞이지 않게 버전마다 조각 이름이 다름)
  for (let i = 0; i < parts.length; i++) await base.collection('chunks').doc(`${version}_${i}`).set({ b: parts[i], version, i });
  const prev = (await base.get()).data();
  await base.set({ version, chunks: parts.length, count, bytes: gz.length, builtAt: new Date().toISOString() });
  if (prev?.version) {
    const old = await base.collection('chunks').where('version', '==', prev.version).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  }
  return { name, count, kb: Math.round(gz.length / 1024), chunks: parts.length };
}

const kst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);

// 물건 두 묶음(기일 형식 '2026-10-28 17:00'(온비드)·'2026.10.28'(법원) 둘 다)
//  open  : 진행 중 화면용 — 온비드는 오늘 이후, 법원은 50일 전부터(유찰 뒤 다음 기일 대기 물건 포함). 접속 때 이것만 받음
//  recent: 완료 물건 채점 화면용 — 최근 120일 ~ 앞으로 전부
async function listings(db, scope) {
  const today = kst(new Date());
  const from = scope === 'recent' ? kst(new Date(Date.now() - 120 * 86400e3)) : today;
  const courtFrom = scope === 'recent' ? from : kst(new Date(Date.now() - 50 * 86400e3));
  const y = from.slice(0, 4);
  const col = db.collection('listings');
  const [a, b] = await Promise.all([
    col.where('bidEnd', '>=', from).where('bidEnd', '<', `${y}-~`).get(),
    col.where('bidEnd', '>=', courtFrom.replace(/-/g, '.')).get(),
  ]);
  const seen = new Set(); const out = [];
  [...a.docs, ...b.docs].forEach((d) => { if (seen.has(d.id)) return; seen.add(d.id); out.push({ id: d.id, ...lean(d.data()) }); });
  return out;
}

async function past(db) {
  const snap = await db.collection('pastResults').orderBy('bidEnd', 'desc').limit(5000).get();
  return snap.docs.map((d) => ({ id: d.id, ...lean(d.data()) }));
}

// ---------- 목록용 요약(cards) ----------
//  온비드처럼 '서버가 판정하고 화면은 보이는 것만': 화면이 하던 일(다음 기일 추정 → 회차 묶기 → 시세 붙이기 → 판정)을
//  서버가 화면과 같은 코드(shared/*.mjs)로 미리 해 두고, 목록에 필요한 칸만 남긴 요약을 묶는다.
//  화면은 이 요약만 받아 필터·정렬을 바로 하고, 물건을 누르면 그 한 건만 원본을 받는다.
const A_FIELDS = ['verdict', 'cap', 'money', 'special', 'opportunity', 'opportunities', 'renoMoney', 'upMoney', 'score', 'certainty', 'calcAnomaly',
  'anomalies', 'value', 'full', 'reasons', 'member', 'farm', 'excluded', 'estimateBasis', 'cashType', 'rightsReview', 'redev', 'ratio',
  'liquidity', 'landValue', 'gaps', 'exit', 'entry', 'market', 'shareUnknown'];
// 시세(market)는 비교 거래 목록이 커서(건당 10KB 넘음) 목록에 쓰는 값·등급만 남긴다. 비교 거래는 상세 화면에서 다시 계산
function pickA(a) {
  if (!a) return null; const o = {};
  A_FIELDS.forEach((k) => { if (a[k] !== undefined) o[k] = a[k]; });
  if (o.market) o.market = { value: o.market.value ?? null, grade: o.market.grade ?? null };
  return lean(o);
}
// 목록·회차표·세금 판정에 쓰는 물건 칸만(상세 원문·건축물대장·등기 표시 등은 상세 화면이 따로 받음)
function slimItem(it) {
  const o = lean(it);
  ['ledger', 'registryFlags', 'courtPhotoMap', 'forecastRevised', 'neighbors', 'bidInfo'].forEach((k) => { delete o[k]; });
  if (o.detail) o.detail = { addressFull: o.detail.addressFull, appraisalFile: o.detail.appraisalFile, photos: (o.detail.photos || []).slice(0, 1) };
  if (o.land) o.land = { landUse: { redevelopment: o.land.landUse?.redevelopment || [] } };
  if (o.forecastFirst) o.forecastFirst = { rounds: o.forecastFirst.rounds || null };
  if (o.forecast) { const f = o.forecast; o.forecast = { cap: f.cap ?? null, bid: f.bid ?? null, verdict: f.verdict ?? null, value: f.value ?? null, at: f.at ?? null, rounds: f.rounds || null }; }
  if (o.courtDocs) o.courtDocs = Object.fromEntries(Object.keys(o.courtDocs).map((k) => [k, 1]));
  return o;
}

async function loadDealsMap(db, keys) {
  const now = new Date(Date.now() + 9 * 3600e3);
  const yms = [];
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); yms.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  const out = new Map(); const list = [...keys];
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async (k) => {
      const [t, l] = k.split('|');
      const snaps = await db.getAll(...yms.map((ym) => db.collection('tradeMonths').doc(`${t}_${l}_${ym}`)));
      out.set(k, snaps.flatMap((s, j) => { if (!s.exists) return []; try { return JSON.parse(s.data().d || '[]').map((r) => [...r, yms[j]]); } catch { return []; } }));
    }));
  }
  return out;
}

async function run({ db, log }) {
  const { analyze, tradeTypeOf, ANALYZER_VERSION } = await import('../shared/analyze.mjs');
  const { DEFAULT_SETTINGS, lawdOf } = await import('../shared/defaults.mjs');
  const { premiumTable, predictPrice } = await import('../shared/bidForecast.mjs');
  const { dedupeRounds, withNextCourtRound } = await import('../shared/rounds.mjs');
  const res = {};
  const s = await db.collection('settings').doc('main').get();
  const settings = { ...DEFAULT_SETTINGS, ...(s.exists ? s.data() : {}) };
  const items = await listings(db, 'open');
  const pastRows = await past(db).catch(() => []);
  const table = premiumTable([...items, ...pastRows]); // 화면과 같게: 불러온 물건 + 완료 결과
  const list = dedupeRounds(withNextCourtRound(items));
  const lawd = (it) => lawdOf(it.sido, it.sgg, `${it.emd || ''} ${it.address || ''}`);
  const keys = new Set();
  list.forEach((it) => { const l = lawd(it); if (!l) return; const t = tradeTypeOf(it); keys.add(`${t}|${l}`); if (t === 'rh') keys.add(`${t}Rent|${l}`); });
  const deals = await loadDealsMap(db, keys);
  const cards = []; let errors = 0;
  for (const it of list) {
    try {
      const l = lawd(it); const t = tradeTypeOf(it);
      const prem = predictPrice(it, table)?.premium;
      const a = analyze(it, { settings, deals: deals.get(`${t}|${l}`), bidPremium: prem });
      const av = t === 'rh' ? analyze(it, { settings, deals: deals.get(`${t}|${l}`), rentDeals: deals.get(`${t}Rent|${l}`), bidPremium: prem }) : null;
      cards.push({ it: slimItem(it), a: pickA(a), ...(av ? { av: pickA(av) } : {}) });
    } catch (e) { errors++; if (errors <= 3 && log) log(`요약 오류 ${it.id}: ${e.message}`); }
  }
  res.cards = await write(db, 'cards', { analyzerVersion: ANALYZER_VERSION, settingsAt: settings.updatedAt || null, builtFor: new Date().toISOString(), cards });
  res.cards.errors = errors;
  try { res.past = await write(db, 'past', pastRows); } catch (e) { res.past = { error: e.message }; }
  if (log) log('snapshot', res);
  return res;
}

module.exports = { run, write, lean, slimItem, pickA };
