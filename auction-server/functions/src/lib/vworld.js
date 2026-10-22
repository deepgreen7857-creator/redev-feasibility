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

module.exports = { lookup, analyzeLandUse, firstArray };
