// 브이월드(국토교통부 공간정보) — 토지이용계획·개별공시지가·토지특성 조회 → 정비구역/농지/규제 판정
const BASE = 'https://api.vworld.kr/ned/data';
// 인증키에 등록한 서비스 URL과 같아야 한다(다르면 빈 응답·INCORRECT_KEY). 사이트는 www.jbslab.co.kr(CNAME)인데
// 서버는 그동안 https://jbslab.co.kr 로 보냈다 — 관리자 설정 vworldDomain 또는 환경변수 VWORLD_DOMAIN 으로 바꾼다.
// 어느 값이 맞는지는 관리자 'API 연결 시험'이 후보 도메인을 하나씩 불러 원문과 함께 보여 준다.
const DEFAULT_DOMAIN = process.env.VWORLD_DOMAIN || 'https://jbslab.co.kr';
let DOMAIN = DEFAULT_DOMAIN;
const DOMAIN_CANDIDATES = ['https://www.jbslab.co.kr', 'https://jbslab.co.kr', 'www.jbslab.co.kr', 'jbslab.co.kr'];
function setDomain(d) { DOMAIN = String(d || '').trim() || DEFAULT_DOMAIN; return DOMAIN; }
const getDomain = () => DOMAIN;

function firstArray(obj) {
  if (!obj || typeof obj !== 'object') return [];
  for (const v of Object.values(obj)) {
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    if (v && typeof v === 'object') { const a = firstArray(v); if (a.length) return a; }
  }
  return [];
}

async function get(op, params, key, fetcher) {
  const u = new URL(`${BASE}/${op}`);
  u.searchParams.set('key', key);
  u.searchParams.set('domain', DOMAIN);
  u.searchParams.set('format', 'json');
  u.searchParams.set('numOfRows', '100');
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  const res = await fetcher(u, { signal: AbortSignal.timeout(20000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`브이월드 HTTP_${res.status} ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`브이월드 응답이 JSON이 아님: ${text.replace(/\s+/g, ' ').slice(0, 200)}`); }
  const err = data && (data.response && data.response.error);
  if (err) throw new Error(`브이월드 오류: ${err.text || err.code}`);
  // NED 응답은 오류(인증키·도메인 불일치 등)도 빈 목록 + resultCode/resultMsg 로 오는 경우가 있다 → 원문을 붙여 둔다
  const rows = firstArray(data);
  const code = findKey(data, 'resultCode'); const msg = findKey(data, 'resultMsg');
  if (!rows.length && code && !/^(0+|OK|NORMAL_SERVICE|INFO-000)?$/i.test(String(code))) throw new Error(`브이월드 오류: ${msg || code}(${code})`);
  Object.defineProperty(rows, 'raw', { value: text.replace(/\s+/g, ' ').slice(0, 300), enumerable: false });
  return rows;
}

function findKey(obj, key) {
  if (!obj || typeof obj !== 'object') return null;
  if (key in obj && typeof obj[key] !== 'object') return obj[key];
  for (const v of Object.values(obj)) { const r = findKey(v, key); if (r !== null && r !== undefined) return r; }
  return null;
}

// 토지이용·공시지가·토지특성 모두 빈 응답(오류 표시 없음) — 키/도메인·일시 장애일 수 있어 캐시하지 않는다
function isEmptyLand(land) {
  return Boolean(land) && !land.landUseError && !land.officialPrice && !land.jimok && !land.area && !(land.landUse && land.landUse.items && land.landUse.items.length);
}

const RE = {
  redevelop: /(정비구역|정비예정구역|재개발|재건축|도시환경정비|주거환경개선|재정비촉진|가로주택|소규모주택정비|관리지역\(소규모\)|도시재생)/,
  farmPromotion: /농업진흥/,
  greenbelt: /개발제한구역/,
  permitZone: /토지거래(계약에관한)?허가구역/,
  zone: /(제[12]종전용주거지역|제[123]종일반주거지역|준주거지역|중심상업지역|일반상업지역|근린상업지역|유통상업지역|전용공업지역|일반공업지역|준공업지역|보전녹지지역|생산녹지지역|자연녹지지역|보전관리지역|생산관리지역|계획관리지역|농림지역|자연환경보전지역)/,
  military: /군사기지|군사시설보호/,
  park: /도시공원|공원/,
  road: /(도로|소로|중로|대로|광로)/,
};

function analyzeLandUse(rows) {
  const names = rows.map((r) => ({
    name: r.prposAreaDstrcCodeNm || r.prposAreaDstrcNm || r.lndcgrCodeNm || '',
    relation: r.cnflcAtNm || r.cnflcAt || '',
  })).filter((x) => x.name);
  const all = names.map((x) => x.name).join(', ');
  const zone = (names.find((x) => RE.zone.test(x.name)) || {}).name || null;
  const roadConflict = names.filter((x) => RE.road.test(x.name) && /저촉/.test(x.relation)).map((x) => x.name);
  return {
    zone,
    items: names,
    redevelopment: names.filter((x) => RE.redevelop.test(x.name)).map((x) => x.name),
    farmPromotion: RE.farmPromotion.test(all),
    greenbelt: RE.greenbelt.test(all),
    permitZone: RE.permitZone.test(all),
    military: RE.military.test(all),
    roadConflict,
  };
}

async function lookup({ pnu, key, fetcher = fetch, year }) {
  if (!key) throw new Error('브이월드 인증키가 설정되지 않았습니다.');
  if (!/^\d{19}$/.test(String(pnu || ''))) throw new Error('PNU(19자리)가 없습니다.');
  const y = year || String(new Date().getFullYear());
  const [use, price, prevPrice, chars] = await Promise.allSettled([
    get('getLandUseAttr', { pnu }, key, fetcher),
    get('getIndvdLandPriceAttr', { pnu, stdrYear: y }, key, fetcher),
    get('getIndvdLandPriceAttr', { pnu, stdrYear: String(Number(y) - 1) }, key, fetcher),
    get('getLandCharacteristics', { pnu, stdrYear: String(Number(y) - 1) }, key, fetcher),
  ]);
  const priceRows = (price.status === 'fulfilled' && price.value.length ? price.value : prevPrice.status === 'fulfilled' ? prevPrice.value : []);
  const p = priceRows[0] || {};
  const c = (chars.status === 'fulfilled' && chars.value[0]) || {};
  const rawOf = (r) => (r.status === 'fulfilled' ? r.value.raw : `오류: ${r.reason && r.reason.message}`);
  const out = {
    pnu,
    landUse: use.status === 'fulfilled' ? analyzeLandUse(use.value) : null,
    landUseError: use.status === 'rejected' ? use.reason.message : null,
    officialPrice: p.pblntfPclnd ? Number(p.pblntfPclnd) : null, // 원/㎡
    officialPriceYear: p.stdrYear || null,
    jimok: c.lndcgrCodeNm || null,
    area: c.lndpclAr ? Number(c.lndpclAr) : null,
    terrain: c.tpgrphHgCodeNm || null,
    roadSide: c.roadSideCodeNm || null,
    checkedAt: new Date().toISOString(),
  };
  if (isEmptyLand(out)) { out.empty = true; out.raw = { landUse: rawOf(use), price: rawOf(price), chars: rawOf(chars) }; }
  else { // 빈 값/오류가 섞여 있으면 원문을 남겨 둔다(진단용)
    const errs = [use, price, chars].filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    if (errs.length) out.errors = errs;
  }
  return out;
}

// 필지 중심점 [경도, 위도] — 정비구역 '대략 경계' 다각형 대조용(연속지적도)
async function centroid({ pnu, key, fetcher = fetch }) {
  if (!key || !/^\d{19}$/.test(String(pnu || ''))) return null;
  const f = (await cadastral({ attrFilter: `pnu:=:${pnu}` }, key, fetcher))[0];
  const bb = f && bboxOf(f.geometry);
  return bb ? [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2] : null;
}

// 주택 공시가격(시가표준액): 공동주택가격(호별) → 없으면 개별주택가격
// address 에서 '제205호', '205호' 같은 호수를 찾아 맞는 호를 고르고, 못 찾으면 그 필지 호들의 최솟값·최댓값만 돌려준다.
async function housingPrice({ pnu, address, key, fetcher = fetch, year }) {
  if (!key || !/^\d{19}$/.test(String(pnu || ''))) return null;
  const y = Number(year || new Date().getFullYear());
  const ho = (String(address || '').match(/제?\s*(\d{1,5})\s*호/) || [])[1];
  const dong = (String(address || '').match(/제?\s*(\d{1,4})\s*동(?=\s|제|\d|$)/) || [])[1];
  for (const yr of [y, y - 1]) {
    let rows = [];
    try { rows = await get('getApartHousingPriceAttr', { pnu, stdrYear: String(yr), numOfRows: '1000' }, key, fetcher); } catch { rows = []; }
    if (rows.length) {
      const prices = rows.map((r) => ({ price: Number(r.pblntfPc || r.pblntfPrc || 0), ho: String(r.hoNm || '').replace(/\D/g, ''), dong: String(r.dongNm || '').replace(/\D/g, '') })).filter((r) => r.price > 0);
      if (prices.length) {
        const hit = ho ? prices.find((r) => r.ho === ho && (!dong || !r.dong || r.dong === dong)) : null;
        const sorted = prices.map((r) => r.price).sort((a, b) => a - b);
        return { kind: '공동주택', year: yr, price: hit ? hit.price : null, min: sorted[0], max: sorted[sorted.length - 1], matched: Boolean(hit), units: prices.length };
      }
    }
    try { rows = await get('getIndvdHousingPriceAttr', { pnu, stdrYear: String(yr) }, key, fetcher); } catch { rows = []; }
    const r = rows.find((x) => Number(x.housePc || x.housePrc || 0) > 0);
    if (r) { const v = Number(r.housePc || r.housePrc); return { kind: '개별주택', year: yr, price: v, min: v, max: v, matched: true, units: 1 }; }
  }
  return null;
}

// 주소 글에서 지번 주소 부분만 떼어 낸다: '… 암사동 515-7 제3층 제301호' → '… 암사동 515-7', '… 낙양동 산 104-1' 그대로
function parcelAddress(address) {
  const s = String(address || '').replace(/\s+/g, ' ').trim();
  const m = s.match(/^(.+?\s(?:산\s?)?\d+(?:-\d+)?)(?=\s|,|$)/);
  return m ? m[1].replace(/\s산(\d)/, ' 산 $1') : null;
}

// 주소 끝의 지번: { mountain, no: '56' | '56-1' } — '산 56', '산56', '산56번지' 모두 같게
function jibunKey(address) {
  const m = String(address || '').replace(/\s+/g, ' ').trim().match(/(?:^|\s)(산\s?)?(\d+(?:-\d+)?)(?:\s*번지)?$/);
  return m ? { mountain: Boolean(m[1]), no: m[2] } : null;
}

// 지번 주소 → PNU(19자리). 브이월드 주소검색(지번)에서 지번이 정확히 같은 결과만 쓴다.
async function findPnu({ address, key, fetcher = fetch }) {
  const q = parcelAddress(address);
  if (!key || !q) return null;
  const u = new URL('https://api.vworld.kr/req/search');
  const params = { service: 'search', request: 'search', version: '2.0', size: '10', page: '1', query: q, type: 'address', category: 'parcel', format: 'json', errorformat: 'json', key, domain: DOMAIN };
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetcher(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`브이월드 주소검색 HTTP_${res.status}`);
  const data = await res.json();
  const items = (data && data.response && data.response.result && data.response.result.items) || [];
  // '산 56'·'산56' 모두 같은 지번으로 본다(전에는 질의를 '산 56'으로 바꾼 뒤 끝 글자만 비교해 '산56' 결과와 어긋났음).
  // PNU 11번째 자리(2 = 산)도 맞아야 한다.
  const hit = items.find((it) => {
    const p = String((it.address && it.address.parcel) || '');
    const id = String(it.id);
    if (!/^\d{19}$/.test(id)) return false;
    const a = jibunKey(p); const b = jibunKey(q);
    return Boolean(a && b) && a.no === b.no && a.mountain === b.mountain && (id[10] === '2') === b.mountain;
  });
  return hit ? { pnu: String(hit.id), parcel: hit.address.parcel, query: q } : null;
}

// ── 주변 필지 맹지 확인 ─────────────────────────────────────────────
// 도로 부지·맹지 물건의 가치는 '이 땅이 아니면 길이 없는 이웃 필지'가 있느냐에 달려 있다.
// ① 연속지적도(LP_PA_CBND_BUBUN)에서 이 필지의 경계를 받아 ② 경계상자를 약간 넓혀 주변 필지를 찾고
// ③ 각 필지의 토지특성 '도로접면'이 맹지인지 본다. (경계상자 기준이라 실제로 붙어 있지 않은 필지가 섞일 수 있음)
async function cadastral(params, key, fetcher) {
  const u = new URL('https://api.vworld.kr/req/data');
  const base = { service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', format: 'json', errorformat: 'json', crs: 'EPSG:4326', geometry: 'true', size: '200', page: '1', key, domain: DOMAIN };
  for (const [k, v] of Object.entries({ ...base, ...params })) u.searchParams.set(k, v);
  const res = await fetcher(u, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`브이월드 지적도 HTTP_${res.status}`);
  const data = await res.json();
  const r = data && data.response;
  if (r && r.status && r.status !== 'OK' && r.status !== 'NOT_FOUND') throw new Error(`브이월드 지적도 오류: ${(r.error && (r.error.text || r.error.code)) || r.status}`);
  return (r && r.result && r.result.featureCollection && r.result.featureCollection.features) || [];
}

function bboxOf(geom) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const walk = (c) => {
    if (typeof c[0] === 'number') { minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]); minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]); } else c.forEach(walk);
  };
  walk((geom && geom.coordinates) || []);
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

const JIMOK_SUFFIX = /\s*([가-힣]{1,3})$/;
async function neighbors({ pnu, key, fetcher = fetch, year, max = 25 }) {
  if (!key || !/^\d{19}$/.test(String(pnu || ''))) return null;
  const self = await cadastral({ attrFilter: `pnu:=:${pnu}` }, key, fetcher);
  if (!self.length) return { pnu, error: '지적도에서 필지를 찾지 못함', checkedAt: new Date().toISOString() };
  const bb = bboxOf(self[0].geometry);
  if (!bb) return { pnu, error: '필지 경계 없음', checkedAt: new Date().toISOString() };
  const pad = 0.00006; // 약 5~6m
  const box = `BOX(${bb[0] - pad},${bb[1] - pad},${bb[2] + pad},${bb[3] + pad})`;
  const around = (await cadastral({ geomFilter: box }, key, fetcher)).filter((f) => f.properties && String(f.properties.pnu) !== String(pnu));
  const y = Number(year || new Date().getFullYear()) - 1;
  const list = [];
  for (const f of around.slice(0, max)) {
    const p = f.properties;
    const jibun = String(p.jibun || '');
    const jimok = (jibun.match(JIMOK_SUFFIX) || [])[1] || null;
    let roadSide = null;
    // 도로·구거·하천 필지는 맹지 판단 대상이 아님
    if (!/^(도|구|천|제|철)$/.test(jimok || '')) {
      try { const c = (await get('getLandCharacteristics', { pnu: p.pnu, stdrYear: String(y) }, key, fetcher))[0] || {}; roadSide = c.roadSideCodeNm || null; } catch { roadSide = null; }
    }
    list.push({ pnu: String(p.pnu), jibun, jimok, roadSide, landlocked: /맹지/.test(roadSide || '') });
  }
  return {
    pnu, checkedAt: new Date().toISOString(), total: around.length, checked: list.length,
    landlocked: list.filter((x) => x.landlocked).length, list,
    note: '경계상자 기준 주변 필지(실제 인접 여부는 지적도로 확인)',
  };
}

// 진단: 같은 PNU를 후보 도메인마다 불러 어느 도메인이 인증키에 등록돼 있는지 본다(응답 원문 포함)
async function probeDomains({ pnu, key, fetcher = fetch, candidates = DOMAIN_CANDIDATES }) {
  const keep = DOMAIN; const out = [];
  try {
    for (const d of [...new Set([keep, ...candidates])]) {
      DOMAIN = d;
      try {
        const rows = await get('getLandUseAttr', { pnu }, key, fetcher);
        out.push({ domain: d, ok: rows.length > 0, rows: rows.length, raw: rows.raw || null });
      } catch (e) { out.push({ domain: d, ok: false, rows: 0, raw: e.message.slice(0, 300) }); }
    }
  } finally { DOMAIN = keep; }
  return out;
}

module.exports = { lookup, housingPrice, analyzeLandUse, firstArray, parcelAddress, jibunKey, findPnu, neighbors, bboxOf, centroid, isEmptyLand, setDomain, getDomain, probeDomains, DOMAIN_CANDIDATES, get DOMAIN() { return DOMAIN; } };

