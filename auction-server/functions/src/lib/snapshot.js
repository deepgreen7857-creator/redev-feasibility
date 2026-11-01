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
  const version = `${Date.now().toString(36)}-${rows.length}`;
  const parts = [];
  for (let i = 0; i < gz.length; i += CHUNK) parts.push(gz.subarray(i, i + CHUNK));
  const base = db.collection('snapshots').doc(name);
  // 조각을 먼저 다 쓰고 마지막에 안내 문서를 바꾼다(받는 도중 섞이지 않게 버전마다 조각 이름이 다름)
  for (let i = 0; i < parts.length; i++) await base.collection('chunks').doc(`${version}_${i}`).set({ b: parts[i], version, i });
  const prev = (await base.get()).data();
  await base.set({ version, chunks: parts.length, count: rows.length, bytes: gz.length, builtAt: new Date().toISOString() });
  if (prev?.version) {
    const old = await base.collection('chunks').where('version', '==', prev.version).get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
  }
  return { name, count: rows.length, kb: Math.round(gz.length / 1024), chunks: parts.length };
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

// 시세: 물건이 있는 (종류·시군구)의 최근 12개월 실거래를 한 묶음으로. 화면의 키 '종류|법정동코드5' 그대로
async function deals(db, keys) {
  const now = new Date(Date.now() + 9 * 3600e3);
  const yms = [];
  for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); yms.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  const out = {};
  const list = [...keys];
  for (let i = 0; i < list.length; i += 20) {
    await Promise.all(list.slice(i, i + 20).map(async (k) => {
      const [t, l] = k.split('|');
      const refs = yms.map((ym) => db.collection('tradeMonths').doc(`${t}_${l}_${ym}`));
      const snaps = await db.getAll(...refs);
      out[k] = snaps.flatMap((s, j) => { if (!s.exists) return []; try { return JSON.parse(s.data().d || '[]').map((r) => [...r, yms[j]]); } catch { return []; } });
    }));
  }
  return out;
}

// keysOf(rows) → Set('종류|법정동코드5') : 화면과 같은 규칙(shared 모듈)으로 만든다
async function run({ db, log, keysOf }) {
  const res = {};
  const rows = await listings(db, 'open');
  res.open = await write(db, 'open', rows);
  try { res.recent = await write(db, 'recent', await listings(db, 'recent')); } catch (e) { res.recent = { error: e.message }; }
  try { res.past = await write(db, 'past', await past(db)); } catch (e) { res.past = { error: e.message }; }
  try {
    const keys = keysOf ? keysOf(rows) : new Set();
    const map = await deals(db, keys);
    res.deals = await write(db, 'deals', [map]);
  } catch (e) { res.deals = { error: e.message }; }
  if (log) log('snapshot', res);
  return res;
}

module.exports = { run, write, lean };
