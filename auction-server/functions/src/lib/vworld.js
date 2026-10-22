// 브이월드(국토교통부 공간정보) — 토지이용계획·개별공시지가·토지특성 조회 → 정비구역/농지/규제 판정
const BASE = 'https://api.vworld.kr/ned/data';
const DOMAIN = process.env.VWORLD_DOMAIN || 'https://jbslab.co.kr';

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
  if (!res.ok) throw new Error(`브이월드 HTTP_${res.status}`);
  const data = await res.json();
  const err = data && (data.response && data.response.error);
  if (err) throw new Error(`브이월드 오류: ${err.text || err.code}`);
  return firstArray(data);
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
  return {
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
  const lastToken = (s) => String(s || '').trim().split(/\s+/).pop();
  const isMountain = (s) => /\s산\s?\d/.test(s);
  const hit = items.find((it) => {
    const p = String((it.address && it.address.parcel) || '');
    return /^\d{19}$/.test(String(it.id)) && lastToken(p) === lastToken(q) && isMountain(p) === isMountain(q);
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

module.exports = { lookup, housingPrice, analyzeLandUse, firstArray, parcelAddress, findPnu, neighbors, bboxOf };

