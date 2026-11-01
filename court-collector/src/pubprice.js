// 주택 공시가격 1억 이하 판정(2026-11-01 정민님: "최저가 5천만 이하는 빼고 공시가격 1억 이하만")
//  사이트(jbslab-auction) listings 에 서버가 브이월드로 붙여 둔 housePrice 를 읽어 사건번호별로 판정한다.
//   ok   = 공시가격 1억 이하 확인 → 가장 먼저 받음
//   over = 공시가격 1억 초과 확인 → 받지 않음
//   (없음) = 아직 공시가 미확인 → 빼지 않고 ok 다음 순서로 받음(확인 전 추정으로 제외하지 않음)
const FS_BASE = 'https://firestore.googleapis.com/v1/projects/jbslab-auction/databases/(default)/documents';
export const PUB_CAP = 100000000;
const kst = (plus = 0) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10).replace(/-/g, '.');
const val = (v) => { if (!v) return null; if ('stringValue' in v) return v.stringValue; if ('integerValue' in v) return Number(v.integerValue); if ('doubleValue' in v) return v.doubleValue; if ('booleanValue' in v) return v.booleanValue; if ('nullValue' in v) return null; if ('mapValue' in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])); return null; };
function verdictOf(hp) {
  if (!hp || typeof hp !== 'object') return null;
  const p = Number(hp.price) || 0; const mn = Number(hp.min) || 0; const mx = Number(hp.max) || 0;
  if (hp.matched && p > 0) return p <= PUB_CAP ? 'ok' : 'over';
  if (mx > 0 && mx <= PUB_CAP) return 'ok';      // 같은 단지 최고가도 1억 이하
  if (mn > PUB_CAP) return 'over';               // 같은 단지 최저가도 1억 초과
  return null;
}
let cache = null; let cacheAt = 0;
/** Map 사건번호 → [{ court, v }] (기일 오늘~60일, 법원경매만) */
export async function loadPubPrice(log = () => {}) {
  if (cache && Date.now() - cacheAt < 3 * 3600e3) return cache;
  const out = new Map(); let after = null; let n = 0; let ok = 0; let over = 0;
  try {
    for (let p = 0; p < 40; p++) {
      const sq = { from: [{ collectionId: 'listings' }], where: { compositeFilter: { op: 'AND', filters: [
        { fieldFilter: { field: { fieldPath: 'bidEnd' }, op: 'GREATER_THAN_OR_EQUAL', value: { stringValue: kst() } } },
        { fieldFilter: { field: { fieldPath: 'bidEnd' }, op: 'LESS_THAN', value: { stringValue: kst(60) } } }] } },
        orderBy: [{ field: { fieldPath: 'bidEnd' } }, { field: { fieldPath: '__name__' } }], limit: 500,
        select: { fields: ['court', 'caseNo', 'source', 'bidEnd', 'housePrice', 'land.housePrice'].map((f) => ({ fieldPath: f })) } };
      if (after) sq.startAt = { values: after, before: false };
      const res = await fetch(`${FS_BASE}:runQuery`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: sq }), signal: AbortSignal.timeout(60e3) });
      if (!res.ok) { log(`공시가 목록 실패 HTTP ${res.status}`); break; }
      const docs = (await res.json()).filter((x) => x.document).map((x) => x.document);
      for (const d of docs) {
        const f = d.fields || {}; if (val(f.source) !== 'court') continue;
        const caseNo = String(val(f.caseNo) || '').match(/\d{4}타경\d+/)?.[0]; if (!caseNo) continue;
        const land = val(f.land) || {};
        const v = verdictOf(val(f.housePrice)) || verdictOf(land.housePrice);
        n++; if (v === 'ok') ok++; if (v === 'over') over++;
        (out.get(caseNo) || out.set(caseNo, []).get(caseNo)).push({ court: String(val(f.court) || ''), v });
      }
      if (docs.length < 500) break;
      const last = docs[docs.length - 1]; after = [last.fields.bidEnd, { referenceValue: last.name }];
    }
  } catch (e) { log(`공시가 목록 오류 ${e.message} — 공시가 판정 없이 진행`); }
  log(`공시가 판정 — 사이트 법원 물건 ${n}건 중 1억 이하 ${ok}건, 1억 초과(받지 않음) ${over}건, 미확인 ${n - ok - over}건`);
  cache = out; cacheAt = Date.now();
  return out;
}
const ck = (s) => String(s || '').replace(/\s|지방법원|법원|지원/g, '');
/** 'ok' | 'over' | null — 한 사건에 물건이 여럿이면 하나라도 ok 면 ok, 전부 over 면 over */
export function pubVerdict(map, court, caseNo) {
  const cn = String(caseNo || '').match(/\d{4}타경\d+/)?.[0]; if (!map || !cn) return null;
  let rows = map.get(cn) || []; const c = ck(court);
  if (c) { const same = rows.filter((r) => ck(r.court).includes(c) || c.includes(ck(r.court))); if (same.length) rows = same; }
  if (rows.some((r) => r.v === 'ok')) return 'ok';
  if (rows.length && rows.every((r) => r.v === 'over')) return 'over';
  return null;
}
/** 정렬용 등급: 1억 이하 확인 0, 미확인 1, 초과 9 */
export const pubRank = (v) => (v === 'ok' ? 0 : v === 'over' ? 9 : 1);
