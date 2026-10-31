'use strict';
// jbslab.co.kr/urban — 정비구역 지정·정비계획 검토
// 구역계: 이 화면의 지도(브이월드)에서 안(A~E)별로 직접 그림 → 필지(연속지적)·건축물(GIS건물통합정보)·토지특성·공동주택 대장 자동 조회
//         사업성 검토 화면(localStorage 'jbsc.project.v1')의 구역계·조서를 가져올 수도 있음. '예시 구역'은 고정 그림 시연용.
// 기준값: rules/incheon.json (인천 조례 원문 대조본). 읽기 실패 시 RULES 기본값 사용.

const PY = 3.3058;
const YEAR = new Date().getFullYear();
const PROJECT_KEY = 'jbsc.project.v1';

/* ===== 기준값 ===== */
let J = null;   // incheon.json 원본
const RULES = {
  obsolete: { rcApt: 30, otherApt: 20, rcNonApt: 30, other: 20 },
  smallParcel: { 주거지역: 60, 상업지역: 150, 공업지역: 150, 녹지지역: 200, 기타: 60 },
  roadAccess: { width: 4, frontage: 4 },
  nonResM2PerUnit: 90,
  redevelopment: { minArea: 10000, obsoleteCount: 0.60, road: 0.50, small: 0.30, density: 50, obsoleteFloor: 0.50 },
  improvement: { obsoleteCount: 0.70, road: 0.30, small: 0.50, density: 70 },
  expansion: 1.20,
  far: { '제2종일반주거지역': { base: 210, allowed: 230, max: 250 }, '제3종일반주거지역': { base: 230, allowed: 250, max: 285 } },
  natHousing: { redevelopment: 0.50 },
  status: { far: 'press' },
};
function applyJson(j) {
  J = j;
  try {
    const o = j.obsolete_building;
    RULES.obsolete = { rcApt: o.apartment.rc_steel.years, otherApt: o.apartment.other.years, rcNonApt: o.non_apartment.rc_steel.years, other: o.non_apartment.other.years };
    RULES.smallParcel = j.small_parcel.min_area_by_zone_m2;
    RULES.roadAccess = { width: j.road_access_ratio.road_width_min_m, frontage: j.road_access_ratio.frontage_min_m };
    RULES.nonResM2PerUnit = j.house_density.rules.non_residential.m2_per_unit;
    const rd = j.designation_requirements.redevelopment, get = (arr, k) => arr.find(x => x.key === k).value;
    RULES.redevelopment = { minArea: rd.min_area_m2, obsoleteCount: rd.obsolete_count_ratio_min, road: get(rd.any_of, 'road_access_ratio'), small: get(rd.any_of, 'small_parcel_ratio'), density: get(rd.any_of, 'house_density'), obsoleteFloor: get(rd.any_of, 'obsolete_floor_area_ratio') };
    const im = j.designation_requirements.residential_improvement;
    RULES.improvement = { obsoleteCount: im.obsolete_count_ratio_min, road: get(im.any_of, 'road_access_ratio'), small: get(im.any_of, 'small_irregular_parcel_ratio'), density: get(im.any_of, 'house_density') };
    RULES.expansion = j.designation_requirements.expansion.max_ratio;
    const bz = j.far.by_zone;
    RULES.far = { '제2종일반주거지역': bz['제2종일반주거지역'], '제3종일반주거지역': bz['제3종일반주거지역'] };
    RULES.natHousing = { redevelopment: j.national_housing_ratio.redevelopment };
    RULES.status = { far: j.far.status };
  } catch (e) { console.warn('incheon.json 해석 실패, 기본값 사용', e); }
}
function smallLimit(zoning) {
  const z = String(zoning || '');
  const L = RULES.smallParcel;
  if (/주거/.test(z)) return L['주거지역'];
  if (/상업/.test(z)) return L['상업지역'];
  if (/공업/.test(z)) return L['공업지역'];
  if (/녹지/.test(z)) return L['녹지지역'];
  return z ? L['기타'] : L['주거지역'];
}

/* ===== 공통 도우미 ===== */
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const pct = r => r == null ? '–' : (r * 100).toFixed(1) + '%';
function won(v) {
  const neg = v < 0; v = Math.abs(v);
  const eok = Math.floor(v / 1e8); let man = Math.round((v - eok * 1e8) / 1e6) * 100; let e = eok; if (man >= 10000) { e++; man = 0; }
  const out = e >= 100 ? Math.round(v / 1e8).toLocaleString('ko-KR') + '억원' : e > 0 ? e + '억' + (man ? ' ' + man.toLocaleString('ko-KR') + '만원' : '원') : Math.round(v / 1e4).toLocaleString('ko-KR') + '만원';
  return (neg ? '−' : '') + out;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2000); }
const polyArea = pts => { let a = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a) / 2; };
const inside = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
const centroid = pts => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; const f = x1 * y2 - x2 * y1; a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f; } if (!a) return [pts[0][0], pts[0][1]]; return [cx / (3 * a), cy / (3 * a)]; };

/* ===== 주택접도율: 도로접면 추정 + 직접 지정 ===== */
// 토지특성 도로접면: 광대로·중로·소로·세로(가) = 폭 4m 이상 도로에 접한 것으로 추정, 세로(불)·맹지 = 미충족
//  세로(가)는 '폭 8m 미만·자동차 통행 가능'이라 4m 미만일 수 있음 → 판정 칸·지도 필지를 눌러 직접 지정 가능
const ACC_OVR = 'jbs-urban-access';
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
const accOvr = lsGet(ACC_OVR);
function accessFromRoad(nm) {
  if (!nm) return null;
  if (/맹지|\(불\)/.test(nm)) return false;
  if (/광대|중로|소로|세로.*\(가\)/.test(nm)) return true;
  return null;
}
const pKey = p => (D.real ? 'r:' + (p.pnu || p.jibun) : 's:' + p.id);
function applyAccess(p) {
  const o = accOvr[pKey(p)];
  if (o === true || o === false) { p.access = o; p.manual = true; p.accSrc = '직접 지정'; p.accessStr = p.accSrc; return; }
  p.manual = false;
  if (D.real) {
    const nm = p.roadSide || '';
    p.roadNm = nm;
    p.access = accessFromRoad(nm);
    p.accSrc = p.access == null ? (nm ? `도로접면 '${nm}' — 자동 판단 불가` : '도로접면 미조회') : `도로접면 '${nm}' 기준 추정`;
    p.accessStr = p.accSrc;
  } else { p.access = p.accessAuto; p.accSrc = '예시 도로 폭'; }
}
function cycleAccess(id) {
  const p = D.parcels[id]; if (!p) return;
  const k = pKey(p), cur = accOvr[k];
  if (cur === undefined) accOvr[k] = true; else if (cur === true) accOvr[k] = false; else delete accOvr[k];
  lsSet(ACC_OVR, accOvr);
  applyAccess(p);
  render();
  toast(`${p.jibun}: ${p.manual ? (p.access ? '접도 충족으로 지정' : '접도 미충족으로 지정') : '자동 판단으로 되돌림'}`);
}

/* ===== 공공 데이터 조회 (브이월드·건축물대장) ===== */
// jsonp·VWorld·splitJibun·safeUnion·ZoneKit은 ../js/zonekit.js (사업성 검토와 같이 씀)
const VW = {
  get ok() { return typeof VWORLD_KEY === 'string' && VWORLD_KEY.trim() !== ''; },
  get key() { return VWORLD_KEY.trim(); },
  async dataPage(data, geomFilter, page = 1, size = 1000) {
    const d = await jsonp('https://api.vworld.kr/req/data', {
      service: 'data', request: 'GetFeature', data, key: this.key, domain: location.origin,
      geomFilter, geometry: 'true', attribute: 'true', crs: 'EPSG:4326', format: 'json', errorformat: 'json', size, page,
    }, 25000);
    const r = d && d.response;
    if (!r || r.status === 'NOT_FOUND') return { features: [], pages: 0 };
    if (r.status !== 'OK') throw new Error((r.error && r.error.text) || '브이월드 오류');
    return { features: r.result.featureCollection.features || [], pages: +(r.page && r.page.total) || 1 };
  },
  async dataAll(data, geomFilter, maxPages = 10) {
    const first = await this.dataPage(data, geomFilter, 1);
    let all = first.features;
    for (let p = 2; p <= Math.min(first.pages, maxPages); p++) all = all.concat((await this.dataPage(data, geomFilter, p)).features);
    return all;
  },
  // 토지특성: 토지대장 면적·지목·공시지가·용도지역·도로접면. 올해 자료가 없으면 전년도
  async landChar(pnu) {
    const yr = new Date().getFullYear();
    for (const y of [yr, yr - 1]) {
      const d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu, key: this.key, domain: location.origin, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(y) });
      const f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0];
      if (f) return {
        ledgerArea: num(f.lndpclAr), jimok: f.lndcgrCodeNm || '', jiga: num(f.pblntfPclnd),
        zoning: [f.prposArea1Nm, f.prposArea2Nm].filter(x => x && x !== '지정되지않음').join(', '), roadSide: f.roadSideCodeNm || '',
      };
    }
    return null;
  },
  async search(q) {
    for (const category of ['parcel', 'road']) {
      const d = await jsonp('https://api.vworld.kr/req/search', { service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: 5, page: 1, query: q, type: 'address', category, format: 'json', errorformat: 'json', key: this.key, domain: location.origin });
      const r = d && d.response;
      if (r && r.status === 'OK' && r.result && r.result.items && r.result.items.length) {
        const it = r.result.items[0];
        return { lat: +it.point.y, lon: +it.point.x, label: (category === 'road' ? it.address.road : it.address.parcel) || it.title || q };
      }
    }
    return null;
  },
};
// 건축물대장 표제부 (공공데이터포털 건축HUB) — 공동주택 세대수 확인에 씀
const LG = {
  URL: 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrTitleInfo',
  get ok() { return typeof DATA_GO_KR_KEY === 'string' && DATA_GO_KR_KEY.trim() !== ''; },
  GAP: 300, last: 0,
  async throttle() { const w = this.last + this.GAP - Date.now(); this.last = Math.max(Date.now(), this.last + this.GAP); if (w > 0) await new Promise(r => setTimeout(r, w)); },
  async titleOf(pnu) {
    const p = String(pnu);
    const q = new URLSearchParams({ serviceKey: DATA_GO_KR_KEY.trim(), sigunguCd: p.slice(0, 5), bjdongCd: p.slice(5, 10), platGbCd: p.charAt(10) === '2' ? '1' : '0', bun: p.slice(11, 15), ji: p.slice(15, 19), numOfRows: '100', pageNo: '1', _type: 'json' });
    const res = await fetch(`${this.URL}?${q}`);
    const j = await res.json().catch(() => null);
    const h = j && j.response && j.response.header;
    if (!h || h.resultCode !== '00') throw new Error((j && j.OpenAPI_ServiceResponse && j.OpenAPI_ServiceResponse.cmmMsgHeader && j.OpenAPI_ServiceResponse.cmmMsgHeader.errMsg) || (h && h.resultMsg) || '빈 응답');
    const it = j.response.body && j.response.body.items && j.response.body.items.item;
    return !it ? [] : Array.isArray(it) ? it : [it];
  },
  async titleRetry(pnu) {
    for (let k = 0; ; k++) {
      await this.throttle();
      try { return await this.titleOf(pnu); } catch (e) {
        if (!/PER_SECOND|LIMITED_NUMBER|TIMEOUT|빈 응답/.test(e.message) || k >= 4) throw e;
        this.GAP = Math.min(1500, this.GAP + 100); await new Promise(r => setTimeout(r, 800 * (k + 1)));
      }
    }
  },
};
const PUBLIC_JIMOK = ['도', '구', '천', '제', '공'];
// 건축물 행 규칙(용도·구조·연도 추정·세대수)은 js/zonekit.js BldgRows — 사업성 검토와 같은 코드
const rowFromGis = f => ({ ...BldgRows.fromGis(f), src: 'GIS' });
const rowFromLedger = t => ({ ...BldgRows.fromLedger(t), src: '대장' });

/* ===== 지도 구역계(안)와 공부 캐시 ===== */
// Z: 안(A~E)별 구역계(GeoJSON)와 편입 필지·편입비율. CACHE: 필지(pnu)별 공부, 건축물 행
const ZONE_KEY = 'jbs-urban-zones-v1', CACHE_KEY = 'jbs-urban-cache-v1', UI_KEY = 'jbs-urban-ui';
const ZONE_IDS = ['A', 'B', 'C', 'D', 'E'];
const Z = (() => { const z = lsGet(ZONE_KEY); return { center: z.center || [37.4553, 126.6577], zoom: z.zoom || 16, count: z.count || 3, zones: z.zones || {} }; })();
const CACHE = (() => { const c = lsGet(CACHE_KEY); return { parcels: c.parcels || {}, blds: c.blds || {} }; })();
const saveZ = () => lsSet(ZONE_KEY, Z);
function saveCache() { if (!lsSet(CACHE_KEY, CACHE)) console.warn('/urban 공부 캐시가 커서 브라우저에 저장하지 못했습니다(이번 창에서는 그대로 씀)'); }
function zoneOf(id) { const z = Z.zones[id] || (Z.zones[id] = {}); z.inArea = z.inArea || {}; return z; }
const ptIn = (pt, gj) => { try { return turf.booleanPointInPolygon(turf.point([pt[1], pt[0]]), gj); } catch (e) { return false; } };
function statusMsg(t, err) { const s = document.getElementById('status'); s.hidden = !t; s.textContent = t || ''; s.classList.toggle('err', !!err); }
let busy = false;
// 지금 하는 일: 판정 화면 맨 위에 '무엇을 하는 중 + 진행률 + 끝나면 바뀌는 것'을 띄움
//  step: 1 필지 → 2 건축물 → 3 토지특성 → 4 건축물대장, 0 대기(필지 선택 반영 전)
const JOB = { zone: '', step: 0, done: 0, total: 0, active: false };
const JOB_STEPS = [
  null,
  { t: '구역 안 필지(연속지적도)를 불러오는 중', after: '필지 목록이 나옵니다' },
  { t: '건축물(GIS건물통합정보)을 불러오는 중', after: '건축물 수와 노후도가 나옵니다' },
  { t: '토지특성(대장 면적·용도지역·공시지가·도로접면)을 받는 중', after: '면적·과소필지·접도율·종전자산이 정확해집니다' },
  { t: '건축물대장에서 사용승인 연도·세대수를 채우는 중', after: '노후도 범위가 한 숫자로 좁혀지고 판정이 확정됩니다' },
];
function jobSet(zone, step, done = 0, total = 0) {
  Object.assign(JOB, { zone, step, done, total, active: true });
  const b = document.getElementById('jobBanner');
  if (b && b.dataset.zone === zone) b.outerHTML = jobHtml(); else if (S.source === 'map' && S.region === zone) render();
}
function jobEnd() { JOB.active = false; JOB.step = 0; }
function jobHtml() {
  if (!JOB.active || JOB.zone !== S.region) return '';
  const st = JOB_STEPS[JOB.step];
  const head = JOB.step === 0 ? '필지 선택을 반영하려고 기다리는 중' : `${JOB.step}/4단계 · ${st.t}`;
  const prog = JOB.total ? ` ${JOB.done}/${JOB.total}필지` : '';
  const pctw = JOB.total ? Math.round(JOB.done / JOB.total * 100) : (JOB.step ? 15 : 0);
  const after = JOB.step === 0 ? '고르기를 멈추면 구역 안 필지·건축물을 새로 불러옵니다' : `끝나면 ${st.after}. 그 전까지 아래 수치와 판정은 임시입니다.`;
  return `<div class="job" id="jobBanner" data-zone="${JOB.zone}" role="status"><div class="job-t"><span class="spin" aria-hidden="true"></span><b>${head}</b>${prog}</div>`
    + `<div class="bar"><span style="width:${pctw}%"></span></div><div class="job-s">${after}</div></div>`;
}

async function fillLandChar(pnus, say, force) {
  const list = pnus.filter(k => CACHE.parcels[k] && (force || !CACHE.parcels[k].lc));
  const n = list.length; let done = 0, fail = 0;
  if (!n) return 0;
  const work = async () => {
    while (list.length) {
      const k = list.shift(), p = CACHE.parcels[k];
      try {
        const c = await VW.landChar(k);
        if (c) Object.assign(p, { ledgerArea: c.ledgerArea || p.ledgerArea || 0, jimok: c.jimok || p.jimok, jiga: c.jiga || p.jiga, zoning: c.zoning || p.zoning || '', roadSide: c.roadSide, lc: true });
        else p.lc = true;
      } catch (e) { fail++; }
      done++;
      if (done % 10 === 0 || done === n) say(`토지특성(대장 면적·용도지역·공시지가·도로접면) ${done}/${n}필지`, 3, done, n);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  return fail;
}
// 건축물대장 표제부로 보충: 공동주택 세대수, GIS건물통합정보에 사용승인 연도가 빈 건물
//  대장 동수가 GIS보다 적으면 남는 GIS 건물(연도 없는 것 우선)은 '대장 없음'으로 남김(무허가·부속건물 등)
const ledgerNeeded = k => {
  const p = CACHE.parcels[k], rows = CACHE.blds[k] || [];
  if (!rows.length || (p && p.lgV === 3)) return false;
  return rows.some(r => (r.needUnits && !r.ledger) || (!r.year && !isGhost(r)) || (!r.year && !(p && p.lgTried)));
};
// 공부 정보가 하나도 없는 GIS 건물(용도·면적·연도 모두 빈 것): 부속·가설·무허가 건물이거나 GIS 오류일 수 있음
const isGhost = r => r.src !== '조서' && BldgRows.isGhost(r);
async function fillLedger(pnus, say) {
  if (!LG.ok) return 0;
  const list = pnus.filter(ledgerNeeded);
  let i = 0, fail = 0;
  for (const k of list) {
    i++; say(`건축물대장(사용승인 연도·세대수) ${i}/${list.length}필지`, 4, i - 1, list.length);
    try {
      const rows = (await LG.titleRetry(k)).filter(t => String(t.mainAtchGbCd) !== '1');   // 부속건축물 제외(사업성 검토와 같음)
      const gis = CACHE.blds[k] || [];
      if (rows.length) {
        const pt = (gis[0] || {}).pt || null;
        const led = rows.map(t => ({ ...rowFromLedger(t), pt }));
        const extra = gis.filter(r => !r.ledger).sort((a, b) => (a.year ? 1 : 0) - (b.year ? 1 : 0)).slice(0, Math.max(0, gis.length - led.length)).map(r => ({ ...r, src: r.year ? 'GIS' : '대장 없음' }));
        CACHE.blds[k] = led.concat(extra);
      } else CACHE.blds[k] = gis.map(r => ({ ...r, src: r.year ? r.src : '대장 없음' }));
      if (CACHE.parcels[k]) { CACHE.parcels[k].lgTried = true; CACHE.parcels[k].lgV = 3; }
    } catch (e) { fail++; }
  }
  return fail;
}
// 안 하나의 필지·건축물·토지특성을 불러옴 (구역계와 10% 이상 겹치거나 한 점이 구역 안인 필지)
// 여러 안을 연달아 그려도 차례로 불러오도록 줄을 세움
let fetchQueue = Promise.resolve();
function fetchZone(id) { fetchQueue = fetchQueue.then(() => fetchZoneNow(id)).catch(() => {}); return fetchQueue; }
async function fetchZoneNow(id) {
  const z = zoneOf(id);
  if (!z.geojson) return;
  if (!VW.ok) { statusMsg('브이월드 인증키가 없어 필지를 불러올 수 없습니다.', true); return; }
  if (!/jbslab\.co\.kr$/.test(location.hostname)) toast('브이월드 키는 www.jbslab.co.kr에서만 조회됩니다');
  busy = true;
  const name = id + '안', say = (t, step, done, total) => { statusMsg(`${name}: ${t}`); if (step) jobSet(id, step, done, total); };
  let ok = false, failLc = 0, failLg = 0, nParcels = 0;
  try {
    const zone = z.geojson, box = `BOX(${turf.bbox(zone).join(',')})`;
    const inZone = f => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), zone); } catch (e) { return false; } };
    say('구역 안 필지(연속지적)를 불러오는 중…', 1);
    const feats = await VW.dataAll('LP_PA_CBND_BUBUN', box);
    const inArea = {}, kept = [];
    feats.forEach(f => {
      const pr = f.properties || {}; if (!pr.pnu) return;
      const tot = turf.area(f); let a = 0;
      try { const x = turf.intersect(f, zone); a = x ? turf.area(x) : 0; } catch (e) { a = inZone(f) ? tot : 0; }
      if (!(a >= 1 && (a / tot >= 0.1 || inZone(f)))) return;
      const r = a / tot; inArea[pr.pnu] = r >= 0.98 ? 1 : Math.round(r * 1000) / 1000; kept.push(f);
      const sp = splitJibun(pr.jibun), old = CACHE.parcels[pr.pnu] || {};
      CACHE.parcels[pr.pnu] = { ...old, jibun: sp.no, jimok: old.lc ? old.jimok : (sp.jimok === '임' ? '임야' : sp.jimok), jiga: old.jiga || num(pr.jiga), geom: f.geometry, cadArea: Math.round(tot * 10) / 10 };
    });
    nParcels = kept.length;
    say(`필지 ${kept.length}개 확인. 건축물(GIS건물통합정보)을 불러오는 중…`, 2);
    const bf = await VW.dataAll('LT_C_BLDGINFO', box);
    const byP = {};
    bf.forEach(b => {
      let pt; try { pt = turf.pointOnFeature(b); } catch (e) { return; }
      const own = kept.find(pf => { try { return turf.booleanPointInPolygon(pt, pf); } catch (e) { return false; } });
      if (!own) return;
      const k = own.properties.pnu;
      (byP[k] = byP[k] || []).push({ ...rowFromGis(b), pt: [pt.geometry.coordinates[1], pt.geometry.coordinates[0]] });
    });
    kept.forEach(pf => {
      const k = pf.properties.pnu, old = CACHE.blds[k];
      if (old && old.length && old.some(r => r.ledger)) return;   // 이미 대장으로 바꾼 필지는 유지
      CACHE.blds[k] = byP[k] || [];
      if (CACHE.parcels[k]) CACHE.parcels[k].lgTried = false;
    });
    z.inArea = inArea; z.fetchedAt = new Date().toLocaleString('sv-SE').slice(0, 16); z.from = 'map';
    saveZ(); saveCache();
    if (S.source === 'map') { D = buildMap(); D.parcels.forEach(applyAccess); render(); }
    failLc = await fillLandChar(Object.keys(inArea), say);
    saveCache();
    if (S.source === 'map') { D = buildMap(); D.parcels.forEach(applyAccess); render(); }
    failLg = await fillLedger(Object.keys(inArea), say);
    saveCache();
    ok = true;
  } catch (e) {
    statusMsg(`${name}: 불러오기에 실패했습니다 — ${e.message}`, true);
  } finally {
    busy = false; jobEnd();
    if (S.source === 'map') { D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); render(); }
  }
  if (ok) statusMsg(`${name}: 필지 ${nParcels}개와 그 위 건축물을 불러왔습니다.` + (failLc ? ` 토지특성 ${failLc}필지는 조회 실패(다시 불러오기로 재시도).` : '') + (failLg ? ` 건축물대장 ${failLg}필지는 조회 실패.` : ''));
}
// 사업성 검토 화면 프로젝트의 구역계·조서를 안으로 가져옴 (조서가 없으면 구역계만 가져와 공부를 새로 조회)
function loadProject() { try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
async function importProject(id) {
  const p = loadProject();
  if (!p || !p.area || !p.area.geojson) { toast('사업성 검토 화면에 그린 구역계가 없습니다'); return; }
  const z = zoneOf(id);
  const g = p.area.geojson;
  histOf(id).undo.push({ gj: z.geojson ? JSON.parse(JSON.stringify(z.geojson)) : null, label: '사업성 검토 구역 가져오기' }); histOf(id).redo = [];
  z.geojson = g.type === 'Feature' ? { type: 'Feature', properties: {}, geometry: g.geometry } : { type: 'Feature', properties: {}, geometry: g };
  z.inArea = {}; z.fetchedAt = '';
  const lands = (p.lands || []).filter(l => l.pnu && l.geom && !l.sample);
  if (lands.length) {
    lands.forEach(l => {
      const old = CACHE.parcels[l.pnu] || {};
      CACHE.parcels[l.pnu] = {
        ...old, jibun: l.jibun, jimok: l.ledgerJimok || l.jimok || old.jimok || '', jiga: num(l.price) || old.jiga || 0, geom: l.geom,
        cadArea: num(l.cadArea) || turf.area({ type: 'Feature', properties: {}, geometry: l.geom }), ledgerArea: num(l.ledgerArea) || old.ledgerArea || 0,
        zoning: l.zoning || old.zoning || '', roadSide: l.roadSide || old.roadSide || '', lc: !!(l.ledgerArea && l.roadSide) || !!old.lc,
      };
      z.inArea[l.pnu] = l.inRatio == null ? 1 : num(l.inRatio);
    });
    const byP = {};
    (p.buildings || []).filter(b => !b.sample && b.pnu).forEach(b => {
      (byP[b.pnu] = byP[b.pnu] || []).push({ use: b.use, structure: b.structure, structureName: b.structureName || '', year: num(b.year), floorArea: num(b.floorArea), archArea: num(b.archArea), floors: num(b.floors), basement: num(b.basement), units: num(b.units), needUnits: !!b.needUnits, ledger: !!b.ledger, name: b.name || '', src: b.ledger ? '대장' : '조서' });
    });
    Object.keys(z.inArea).forEach(k => { CACHE.blds[k] = byP[k] || []; });
    z.fetchedAt = new Date().toLocaleString('sv-SE').slice(0, 16); z.from = 'project';
  }
  saveZ(); saveCache();
  S.region = id; D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); fitZone(id); render();
  if (!lands.length) { fetchZone(id); return; }
  statusMsg(`${id}안: 사업성 검토 구역계와 조서(필지 ${lands.length}개)를 가져왔습니다.`);
  const miss = Object.keys(z.inArea).filter(k => !CACHE.parcels[k].roadSide);
  if (miss.length && VW.ok && !busy) {
    busy = true;
    try { await fillLandChar(miss, t => statusMsg(`${id}안: ${t}`)); saveCache(); statusMsg(`${id}안: 사업성 검토 조서를 가져오고 도로접면을 조회했습니다.`); }
    finally { busy = false; D = buildMap(); D.parcels.forEach(applyAccess); render(); }
  }
}
// delay(ms): 필지 선택처럼 연달아 바꿀 때는 마지막으로 바꾸고 잠시 뒤에 한 번만 불러옴
let fetchTimer = null;
const HIST = {};   // 안별 { undo: [구역계…], redo: [] } — 이 창에서만 기억
function histOf(id) { return HIST[id] || (HIST[id] = { undo: [], redo: [] }); }
function syncUndo() {
  const h = histOf(S.region), u = $id('undoBtn'), r = $id('redoBtn');
  if (u) { u.disabled = !h.undo.length; u.title = u.dataset.tip = h.undo.length ? `실행 취소: ${h.undo[h.undo.length - 1].label} (Ctrl+Z)` : '되돌릴 작업이 없습니다'; }
  if (r) { r.disabled = !h.redo.length; r.title = r.dataset.tip = h.redo.length ? `다시 실행: ${h.redo[h.redo.length - 1].label} (Ctrl+Y)` : '다시 할 작업이 없습니다'; }
}
function undoZone(redo = false) {
  const id = S.region, h = histOf(id), from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
  if (!from.length) { toast(redo ? '다시 할 작업이 없습니다' : '되돌릴 작업이 없습니다'); return; }
  const it = from.pop();
  to.push({ gj: Z.zones[id] && Z.zones[id].geojson ? JSON.parse(JSON.stringify(Z.zones[id].geojson)) : null, label: it.label });
  setZoneGeom(id, it.gj, 1500, null);
  toast(`${redo ? '다시 했습니다' : '되돌렸습니다'}: ${it.label}`);
  statusMsg(`${id}안: ${redo ? '다시 했습니다' : '되돌렸습니다'} — ${it.label}`);
}
// label: 실행 취소에 남길 작업 이름(null이면 이력에 안 남김 — 되돌리기 자체)
function setZoneGeom(id, gj, delay = 0, label = '구역계 변경') {
  const z = zoneOf(id);
  if (label !== null) {
    const h = histOf(id);
    h.undo.push({ gj: z.geojson ? JSON.parse(JSON.stringify(z.geojson)) : null, label });
    if (h.undo.length > 50) h.undo.shift();
    h.redo = [];
  }
  if (!gj) { delete Z.zones[id]; saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); render(); syncUndo(); return; }
  const geom = gj.type === 'Feature' ? gj.geometry : gj;
  z.geojson = { type: 'Feature', properties: {}, geometry: geom };
  z.inArea = {}; z.fetchedAt = ''; z.from = 'map'; delete z.roads;
  saveZ();
  D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); render();
  clearTimeout(fetchTimer);
  if (delay) { jobSet(id, 0); fetchTimer = setTimeout(() => fetchZone(id), delay); } else fetchZone(id);
  syncUndo();
}

/* ===== 지도 모드 데이터 ===== */
function toB(r, p, j) {
  const kind = kindOf(r.use), floors = num(r.floors) || 1, units = num(r.units) || 0;
  const b = {
    id: p.pnu + ':' + j, pid: p.id, use: r.use, kind, struct: r.structureName || r.structure || '', rc: ['철근콘크리트', '철골'].includes(r.structure),
    year: num(r.year), semi: false, basement: num(r.basement), unitsMax: kind === '공동' ? Math.max(1, Math.ceil(units / floors)) : 0, units, floors,
    converted: false, foot: num(r.archArea) || num(r.floorArea) / floors, floor: num(r.floorArea), lic: '허가', name: r.name || '', pt: r.pt || null,
    needUnits: !!r.needUnits && !units, src: r.src || '', ghost: isGhost(r), yearSrc: r.yearSrc || '',
    // 종교시설(용도코드 06 또는 이름). 근생 건물 한 층을 쓰는 교회는 상가 쪽이라 뺌
    religion: r.use !== '근린생활시설' && (!!r.religion || BldgRows.isReligion('', `${r.name || ''} ${r.purpose || ''}`)),
  };
  Object.assign(b, obsoleteRule(b));
  return b;
}
function buildMap() {
  const used = ZONE_IDS.filter(k => Z.zones[k] && Z.zones[k].geojson);
  const pn = new Set(); used.forEach(k => Object.keys(Z.zones[k].inArea || {}).forEach(x => pn.add(x)));
  const parcels = [...pn].filter(k => CACHE.parcels[k]).map((pnu, i) => {
    const c = CACHE.parcels[pnu], base = num(c.ledgerArea) || num(c.cadArea);
    const p = { id: i, pnu, jibun: c.jibun || pnu, jimok: c.jimok || '', base, area: base, zone: c.zoning || '', price: num(c.jiga), public: PUBLIC_JIMOK.includes(c.jimok), roadSide: c.roadSide || '', geom: c.geom, owner: '', blds: [] };
    p.allBlds = (CACHE.blds[pnu] || []).map((r, j) => toB(r, p, j));
    return p;
  });
  const byPnu = new Map(parcels.map(p => [p.pnu, p]));
  const lastUsed = used.length ? ZONE_IDS.indexOf(used[used.length - 1]) + 1 : 0;
  const keys = ZONE_IDS.slice(0, Math.min(5, Math.max(Z.count || 3, lastUsed, 1)));
  const regions = {};
  keys.forEach(k => {
    const z = Z.zones[k] || {};
    const R = { name: k + '안', geojson: z.geojson || null, fetched: !!z.fetchedAt, at: z.fetchedAt || '', from: z.from || '', inArea: z.inArea || {}, blds: {} };
    if (R.geojson) Object.keys(R.inArea).forEach(pnu => {
      const p = byPnu.get(pnu); if (!p) return;
      const r = R.inArea[pnu];
      R.blds[pnu] = p.allBlds.filter(b => r >= 0.98 || !b.pt || ptIn(b.pt, R.geojson));
    });
    regions[k] = R;
  });
  parcels.forEach(p => { p.blds = p.allBlds; });
  return { real: true, map: true, title: '지도에서 그린 구역계', parcels, byPnu, regions, keys };
}

/* ===== 건축물 판정 ===== */
function kindOf(use) {
  if (['아파트', '연립주택', '다세대주택'].includes(use)) return '공동';
  if (['단독주택', '다가구주택'].includes(use)) return '단독';
  return '비주거';
}
function obsoleteRule(b) {
  if (b.lic === '기존무허가') return { old: true, why: '기존무허가(1989.1.24. 이전)' };
  if (b.ghost) return { old: false, why: '공부 정보 없는 GIS 건물 — 무허가·부속건물 여부 확인 필요', unknown: true };
  if (!b.year) return { old: false, why: '사용승인 연도 없음 — 대장 확인 필요', unknown: true };
  let yrs, why;
  if (b.kind === '공동') {
    if (b.rc && !b.semi) { yrs = RULES.obsolete.rcApt; why = 'RC 공동주택 ' + yrs + '년'; }
    else { yrs = RULES.obsolete.otherApt; why = b.semi ? '주거용 지하층 공동주택 ' + yrs + '년' : '비RC 공동주택 ' + yrs + '년'; }
    if (b.rc && !b.semi && b.basement > 0) why += ' (지하층 있음: 주거용이면 ' + RULES.obsolete.otherApt + '년)';
  } else if (b.rc && b.kind !== '단독') { yrs = RULES.obsolete.rcNonApt; why = 'RC 건축물 ' + yrs + '년'; }
  else { yrs = RULES.obsolete.other; why = b.kind === '단독' && b.rc ? 'RC 단독주택 ' + yrs + '년(30년 제외)' : '비RC ' + yrs + '년'; }
  const age = YEAR - b.year;
  return { old: age >= yrs, why: why + ' · 경과 ' + age + '년' + (b.yearSrc ? ` (${b.yearSrc} 기준 추정)` : '') };
}
function densityUnits(b) {
  if (b.lic === '신발생무허가') return 0;
  if (b.kind === '공동') return b.converted ? 1 : Math.max(1, b.unitsMax);
  if (b.kind === '비주거') return Math.floor(b.foot / RULES.nonResM2PerUnit);
  return 1;
}

/* ===== 데이터: 예시 구역 ===== */
function buildSample() {
  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const R = rng(20261030), ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const roadV = [8, 4, 8, 4, 8, 4, 8], roadH = [6, 3, 6, 3, 6, 3, 6, 3], BW = 60, BH = 40, NC = 6, NR = 7;
  const blockX = [], blockY = []; let xx = 0; for (let c = 0; c < NC; c++) { xx += roadV[c]; blockX.push(xx); xx += BW; } const W = xx + roadV[NC];
  let yy = 0; for (let r = 0; r < NR; r++) { yy += roadH[r]; blockY.push(yy); yy += BH; } const H = yy + roadH[NR];
  const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  const roads = []; { let x = 0; for (let c = 0; c <= NC; c++) { roads.push(rect(x, 0, roadV[c], H)); x += roadV[c] + BW; } let y = 0; for (let r = 0; r <= NR; r++) { roads.push(rect(0, y, W, roadH[r])); y += roadH[r] + BH; } }
  const parcels = []; let pid = 0;
  for (let c = 0; c < NC; c++) for (let r = 0; r < NR; r++) {
    const bx = blockX[c], by = blockY[r];
    for (const half of ['top', 'bot']) {
      let px = bx; const westness = 1 - (bx + 30) / W;
      const narrowP = 0.12 + 0.38 * westness, splitP = 0.2 + 0.35 * westness;
      while (px < bx + BW - 0.01) {
        let w = R() < narrowP ? ri(4, 6) : ri(8, 15);
        if (bx + BW - (px + w) < 6) w = bx + BW - px;
        const frontW = half === 'top' ? roadH[r] : roadH[r + 1];
        const edgeL = px === bx, edgeR = Math.abs(px + w - (bx + BW)) < 0.01;
        const sideRoad = edgeL ? roadV[c] : (edgeR ? roadV[c + 1] : 0);
        const mk = (x, y, ww, hh, front, frontLen, side, sideLen) => {
          const fr = []; if (front) fr.push([front, frontLen]); if (side) fr.push([side, sideLen]);
          const access = fr.some(([rw, len]) => rw >= RULES.roadAccess.width && len >= RULES.roadAccess.frontage);
          parcels.push({ id: pid++, rings: [rect(x, y, ww, hh)], area: ww * hh, cx: x + ww / 2, cy: y + hh / 2, access, accessStr: fr.map(([a, b]) => `폭${a}m·${b}m`).join(', ') || '맹지', blds: [] });
        };
        if (R() < splitP && w <= 10) {
          const fy = half === 'top' ? by : by + 30, ky = half === 'top' ? by + 10 : by + 20;
          mk(px, fy, w, 10, frontW, w, sideRoad, 10);
          mk(px, ky, w, 10, 0, 0, sideRoad, 10);
        } else mk(px, half === 'top' ? by : by + 20, w, 20, frontW, w, sideRoad, 20);
        px += w;
      }
    }
  }
  parcels.forEach((p, i) => { p.zone = p.cx < W * 0.55 ? '제2종일반주거지역' : '제3종일반주거지역'; p.jibun = '예시동 ' + (100 + i); p.jimok = '대'; p.price = 0; p.owner = ''; p.public = false; p.accessAuto = p.access; });
  const buildings = []; let bid = 0;
  for (const p of parcels) {
    if (R() > 0.92) continue;
    const westness = 1 - p.cx / W;
    const t = R(); let use;
    if (t < 0.48) use = '단독주택'; else if (t < 0.55) use = '다가구주택'; else if (t < 0.70) use = '다세대주택'; else use = '근린생활시설';
    const kind = kindOf(use);
    const rc = kind === '단독' ? R() < 0.25 : kind === '공동' ? R() < 0.82 : R() < 0.6;
    let year = Math.round(1979 + (1 - westness) * 36 + (R() - 0.5) * 26); year = Math.max(1962, Math.min(2023, year));
    const struct = rc ? (R() < 0.9 ? '철근콘크리트' : '철골철근콘크리트') : (R() < 0.7 ? '벽돌조' : '블록조');
    const semi = kind === '공동' && year >= 1984 && year <= 2003 && R() < 0.5;
    const unitsMax = kind === '공동' ? ri(2, 3) : 0;
    const floors = kind === '단독' ? ri(1, 2) : kind === '공동' ? ri(3, 4) : ri(2, 4);
    const converted = kind === '공동' && R() < 0.12;
    const foot = Math.round(p.area * 0.55);
    let lic = '허가'; const u = R(); if (u < 0.035 && year < 1989) lic = '기존무허가'; else if (u > 0.99) lic = '신발생무허가';
    const b = { id: bid++, pid: p.id, use, kind, struct, rc, year, semi, basement: semi ? 1 : 0, unitsMax, units: unitsMax * Math.max(1, floors - (semi ? 0 : 1)), floors, converted, foot, floor: foot * floors, lic };
    p.blds.push(b); buildings.push(b);
  }
  return {
    real: false, title: '예시 구역', W, H, roads, parcels, buildings, orphans: [],
    regions: {
      A: { name: 'A안', pts: [[8, 6], [268, 6], [268, 140], [332, 140], [332, 226], [200, 226], [200, 316], [8, 316]] },
      B: { name: 'B안', pts: [[136, 49], [404, 49], [404, 316], [136, 316]] },
      C: { name: '직접 그린 안', pts: null },
    },
  };
}

/* ===== 분석·판정 ===== */
let D = null;
// 안 하나의 구역 면적·편입 필지·건축물. 지도 모드는 편입비율(inArea)로 필지 면적을 나눔
function zoneParts(key) {
  const R = D.regions[key];
  if (!R) return null;
  if (D.map) {
    if (!R.geojson || !R.fetched) return null;
    const ps = Object.keys(R.inArea).map(k => D.byPnu.get(k)).filter(Boolean);
    return { area: turf.area(R.geojson), ps, inR: p => R.inArea[p.pnu] ?? 1, bs: ps.flatMap(p => R.blds[p.pnu] || []) };
  }
  if (!R.pts) return null;
  const ps = D.parcels.filter(p => inside(p.cx, p.cy, R.pts));
  return { area: polyArea(R.pts), ps, inR: () => 1, bs: ps.flatMap(p => p.blds) };
}
function ghostMode() { return P.ghostMode || (P.ghostIn ? 'unknown' : 'out'); }
function regionParcels(key) { const zp = zoneParts(key); return zp ? zp.ps : []; }
function analyze(key) {
  const zp = zoneParts(key); if (!zp) return null;
  const { area, ps } = zp;
  const landA = p => (p.base ?? p.area) * zp.inR(p);
  const ghosts = zp.bs.filter(b => b.ghost);
  // 공부 없는 GIS 건물: 빼기(out) / 연도 미확인으로 넣기(unknown) / 기존무허가로 보고 노후로 넣기(old)
  const gm = ghostMode();
  ghosts.forEach(b => { b.lic = gm === 'old' ? '기존무허가' : '허가'; Object.assign(b, { unknown: false }, obsoleteRule(b)); });
  let bs = zp.bs.filter(b => b.lic !== '신발생무허가' && (gm !== 'out' || !b.ghost));
  bs.forEach(b => { if (b.old === undefined) Object.assign(b, obsoleteRule(b)); });
  const N = bs.length, oldN = bs.filter(b => b.old).length, unknownN = bs.filter(b => b.unknown).length;
  const fa = bs.reduce((s, b) => s + b.floor, 0), oldFa = bs.filter(b => b.old).reduce((s, b) => s + b.floor, 0);
  const smallN = ps.filter(p => (p.base ?? p.area) < smallLimit(p.zone)).length;
  let accN = 0, accU = 0;
  bs.forEach(b => { const a = b.pid != null ? D.parcels[b.pid].access : null; if (a === true) accN++; else if (a == null) accU++; });
  const du = bs.reduce((s, b) => s + densityUnits(b), 0);
  const landArea = ps.reduce((s, p) => s + landA(p), 0);
  const zoneArea = {}; ps.forEach(p => { const z = p.zone || '미확인'; zoneArea[z] = (zoneArea[z] || 0) + landA(p); });
  const bsOf = p => (D.map ? (D.regions[key].blds[p.pnu] || []) : p.blds);
  let owners = 0; const names = new Set();
  ps.forEach(p => {
    const apt = bsOf(p).filter(b => b.kind === '공동' && !b.converted);
    if (apt.length) owners += apt.reduce((s, b) => s + Math.max(1, b.units), 0);
    else if (!p.public) { if (p.owner) { if (!names.has(p.owner)) { names.add(p.owner); owners++; } } else owners++; }
  });
  const priorLand = ps.reduce((s, p) => s + landA(p) * p.price, 0);
  const needUnits = bs.filter(b => b.needUnits).length;
  return {
    key, area, ps, bs, N, oldN, unknownN, ghostN: ghosts.length, fa, oldFa, smallN, accN, accU, du, landArea, zoneArea, owners: Math.max(owners, 1), priorLand, needUnits, bsOf,
    oldRatio: N ? oldN / N : 0, oldFaRatio: fa ? oldFa / fa : 0, smallRatio: ps.length ? smallN / ps.length : 0,
    // 미확인 건축물이 있으면 접도율은 범위(accRatio ~ accMax)
    accRatio: N ? accN / N : 0, accMax: N ? (accN + accU) / N : 0, density: du / (area / 10000),
  };
}

const accText = a => a.accU ? `${pct(a.accRatio)}~${pct(a.accMax)}` : pct(a.accRatio);
// 접도율 '이하' 기준: 미확인이 모두 접도여도 기준 이하면 충족, 모두 미접도여도 기준 초과면 미충족, 그 사이는 확인 필요
function accJudge(a, lim) {
  const st = a.accMax <= lim ? 'ok' : a.accRatio > lim ? 'bad' : 'unk';
  const v = a.accU ? `${accText(a)} (미확인 ${a.accU}동)` : `${pct(a.accRatio)} (${a.accN}/${a.N}동)`;
  const s = st === 'ok' ? '충족' : st === 'bad' ? `${((a.accRatio - lim) * 100).toFixed(1)}%p 초과` : `미확인 ${a.accU}동에 따라 달라짐 — 도로접면 조회 또는 현황표 접도 칸을 눌러 지정`;
  return { st, v, s };
}
// 노후 동수 비율 '이상' 기준: 연도 미확인이 모두 노후여도 미달이면 미충족, 모두 비노후여도 넘으면 충족
const oldText = a => a.unknownN ? `${pct(a.oldRatio)}~${pct(a.N ? (a.oldN + a.unknownN) / a.N : 0)}` : pct(a.oldRatio);
function oldJudge(a, lim) {
  const lo = a.oldRatio, hi = a.N ? (a.oldN + a.unknownN) / a.N : 0;
  const st = lo >= lim ? 'ok' : hi < lim ? 'bad' : 'unk';
  const v = `${oldText(a)} (${a.oldN}${a.unknownN ? `+미확인 ${a.unknownN}` : ''}/${a.N}동)`;
  const s = st === 'ok' ? `기준보다 ${Math.floor(a.oldN - lim * a.N)}동 여유` : st === 'bad' ? `기준 대비 ${Math.ceil(lim * a.N - a.oldN - a.unknownN)}동 부족` : `연도 미확인 ${a.unknownN}동에 따라 달라짐 — 노후 ${Math.ceil(lim * a.N - a.oldN)}동 더 필요`;
  return { st, v, s };
}
function judge(a, type) {
  const out = [];
  const st = (ok) => ok == null ? 'unk' : ok ? 'ok' : 'bad';
  if (type === 'redev') {
    const r = RULES.redevelopment;
    out.push({ req: true, t: '구역 면적 ' + fmt(r.minArea) + '㎡ 이상', basis: '정비조례 제5조①2', v: fmt(a.area) + '㎡', st: st(a.area >= r.minArea), s: a.area >= r.minArea ? '' : `${fmt(r.minArea - a.area)}㎡ 부족` });
    out.push({ req: true, t: '노후·불량건축물 수 ' + r.obsoleteCount * 100 + '% 이상', basis: '정비조례 제5조①2, 영 별표1 제2호', ...oldJudge(a, r.obsoleteCount) });
    const opts = [
      { t: '주택접도율 ' + r.road * 100 + '% 이하', ...accJudge(a, r.road), basis: '제5조①2가, 제2조7호' },
      { t: '과소필지 ' + r.small * 100 + '% 이상', v: pct(a.smallRatio) + ` (${a.smallN}/${a.ps.length}필지)`, st: st(a.smallRatio >= r.small), s: a.smallRatio >= r.small ? '충족' : `${((r.small - a.smallRatio) * 100).toFixed(1)}%p 모자람`, basis: '제5조①2나, 제2조5호(분할제한면적 미만)' },
      { t: '호수밀도 ' + r.density + ' 이상', v: a.density.toFixed(1) + '동/ha', st: st(a.density >= r.density), s: a.density >= r.density ? '충족' : `${(r.density - a.density).toFixed(1)}동/ha 모자람`, basis: '제5조①2다, 제2조6호' },
      { t: '노후 연면적 ' + r.obsoleteFloor * 100 + '% 이상', v: pct(a.oldFaRatio), st: st(a.oldFaRatio >= r.obsoleteFloor), s: a.oldFaRatio >= r.obsoleteFloor ? '충족' : `${((r.obsoleteFloor - a.oldFaRatio) * 100).toFixed(1)}%p 모자람`, basis: '제5조①2라' },
    ];
    out.push({ group: true, t: '다음 중 하나 이상', items: opts, st: opts.some(o => o.st === 'ok') ? 'ok' : opts.some(o => o.st === 'unk') ? 'unk' : 'bad' });
  } else {
    const r = RULES.improvement;
    out.push({ req: true, t: '노후·불량건축물 수 ' + r.obsoleteCount * 100 + '% 이상', basis: '정비조례 제5조①1', ...oldJudge(a, r.obsoleteCount) });
    const opts = [
      { t: '접도율 ' + r.road * 100 + '% 이하', ...accJudge(a, r.road), basis: '제5조①1가' },
      { t: '과소·부정형·세장형 필지 ' + r.small * 100 + '% 이상', v: pct(a.smallRatio) + ' (과소필지만 집계)', st: st(a.smallRatio >= r.small), basis: '제5조①1나 — 부정형·세장형 미판정' },
      { t: '호수밀도 ' + r.density + ' 이상', v: a.density.toFixed(1) + '동/ha', st: st(a.density >= r.density), basis: '제5조①1다' },
    ];
    opts.forEach(o => { if (!o.s) o.s = o.st === 'ok' ? '충족' : o.st === 'unk' ? '확인 필요' : '미달'; });
    out.push({ group: true, t: '다음 중 하나 이상', items: opts, st: opts.some(o => o.st === 'ok') ? 'ok' : opts.some(o => o.st === 'unk') ? 'unk' : 'bad' });
  }
  const pass = out.every(o => o.st === 'ok') ? true : out.some(o => o.st === 'bad') ? false : null;
  return { items: out, pass };
}

/* ===== 계획 가정 ===== */
const P = {
  type: 'redev', infraRatio: 25, zone: '제3종일반주거지역', farMode: 'max', farCustom: 265,
  bcr: 18, mix59: 40, mix84: 50, mix114: 10, supplyFactor: 1.33, rentalRatio: 15, coreUnits: 4,
  landPrice: 300, bldValue: 60, memberPrice: 1800, salePrice: 2300, rentalPrice: 18000,
  constCost: 700, basementRatio: 55, etcRatio: 20, priorMode: 'jiga', priorMult: 1.4, ghostIn: false,
  infraMode: 'proposal', parkMode: 'legal', sideRoadW: 6, schoolArea: 0, otherInfra: 0, keepInnerRoads: false,
};
try { const s = localStorage.getItem('jbs-urban-plan'); if (s) Object.assign(P, JSON.parse(s)); } catch (e) { /* 무시 */ }
const saveP = () => { try { localStorage.setItem('jbs-urban-plan', JSON.stringify(P)); } catch (e) { /* 무시 */ } };

// 정비기반시설 비율: 지도 모드에서 '제안값 사용'이면 INFRA 제안 면적으로, 아니면 직접 입력값
//  제안은 세대수(공원 세대당 2㎡, 진입도로 폭)에 따라 바뀌고 세대수는 기반시설에 따라 바뀌므로 두 번 맞춰 계산
function plan(a) {
  if (!(D.map && P.infraMode !== 'manual')) return planCore(a, P.infraRatio);
  let pl = planCore(a, P.infraRatio), inf = null;
  for (let k = 0; k < 3; k++) {
    inf = INFRA.compute(a, pl.units);
    if (!inf) return planCore(a, P.infraRatio);
    pl = planCore(a, inf.ratio * 100);
  }
  pl.infra = inf;
  return pl;
}
function planCore(a, infraPct) {
  const site = a.area * (1 - infraPct / 100);
  const far = RULES.far[P.zone];
  const farUse = P.farMode === 'base' ? far.base : P.farMode === 'allowed' ? far.allowed : P.farMode === 'max' ? far.max : Math.min(P.farCustom, far.max);
  const gfa = site * farUse / 100;
  const mixSum = P.mix59 + P.mix84 + P.mix114 || 1;
  const avgEx = (59 * P.mix59 + 84 * P.mix84 + 114 * P.mix114) / mixSum;
  const perUnit = avgEx * P.supplyFactor;
  const units = Math.floor(gfa / perUnit);
  const footMax = site * P.bcr / 100;
  const towerFoot = perUnit * P.coreUnits;
  const floorsAvg = Math.max(1, Math.ceil(gfa / footMax));
  const towers = Math.max(1, Math.ceil(units / (P.coreUnits * floorsAvg)));
  const floorsTower = Math.ceil(units / (towers * P.coreUnits));
  const rental = Math.round(units * P.rentalRatio / 100);
  const members = Math.min(a.owners, units - rental);
  const general = Math.max(0, units - rental - members);
  const basement = gfa * P.basementRatio / 100;
  return {
    infraPct, site, far, farUse, gfa, avgEx, perUnit, units, footMax, towerFoot, floorsTower, towers, rental, members, general, basement,
    n59: Math.round(units * P.mix59 / mixSum), n84: Math.round(units * P.mix84 / mixSum), n114: Math.round(units * P.mix114 / mixSum),
  };
}
function biz(a, pl) {
  const avgPy = pl.perUnit / PY;
  const useJiga = D.real && P.priorMode === 'jiga' && a.priorLand > 0;
  const priorLand = useJiga ? a.priorLand * P.priorMult : a.landArea * P.landPrice * 1e4;
  const prior = priorLand + a.fa * P.bldValue * 1e4;
  const incMember = pl.members * avgPy * P.memberPrice * 1e4;
  const incGeneral = pl.general * avgPy * P.salePrice * 1e4;
  const incRental = pl.rental * P.rentalPrice * 1e4;
  const cost = (pl.gfa + pl.basement) / PY * P.constCost * 1e4;
  const etc = cost * P.etcRatio / 100;
  const income = incMember + incGeneral + incRental, expense = cost + etc;
  const ratio = prior ? (income - expense) / prior : 0;
  const avgPrior = prior / a.owners, right = avgPrior * ratio;
  const price84 = 84 * P.supplyFactor / PY * P.memberPrice * 1e4;
  return { prior, priorLand, useJiga, incMember, incGeneral, incRental, income, cost, etc, expense, ratio, avgPrior, right, price84, contrib: price84 - right, avgPy };
}

/* ===== 정비기반시설 제안 ===== */
// 근거
//  - 공원·녹지: 도시공원 및 녹지 등에 관한 법률 시행규칙 별표 2 제4호 — 도시정비법 정비계획 5만㎡ 이상은
//    1세대당 2㎡ 이상 또는 개발 부지면적의 5% 이상 중 큰 면적
//  - 진입도로: 주택건설기준 등에 관한 규정 제25조제1항 — 총세대수 300 미만 6m, 500 미만 8m, 1천 미만 12m, 2천 미만 15m, 2천 이상 20m
//  - 그 밖의 주변 도로 최소 폭(기본 6m)·학교·기타 시설은 제안값(협의·심의로 정함)
const INFRA = {
  roadW: [[300, 6], [500, 8], [1000, 12], [2000, 15], [Infinity, 20]],
  entryWidth(units) { for (const [n, w] of this.roadW) if (units < n) return w; return 20; },
  perim(f) {
    const g = f.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.reduce((s, p) => s + turf.length(turf.lineString(p[0]), { units: 'meters' }), 0);
  },
  // 길쭉한 도로 필지의 폭 추정: 면적 A, 둘레 P인 직사각형의 짧은 변
  width(f) { const A = turf.area(f), Pm = this.perim(f), d = Pm * Pm - 16 * A; return d > 0 ? (Pm - Math.sqrt(d)) / 4 : Math.sqrt(A); },
  loading: {},
  // 구역 경계에 닿은 바깥 도로 필지(지목 '도')를 불러옴 → Z.zones[id].roads
  async fetchRoads(id) {
    const z = Z.zones[id];
    if (!z || !z.geojson || this.loading[id] || !VWorld.enabled) return;
    this.loading[id] = true;
    try {
      const zone = z.geojson;
      const [x0, y0, x1, y1] = turf.bbox(zone), e = 40 / 88000, n = 40 / 111000;
      const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 20);
      const near = turf.buffer(zone, 3, { units: 'meters' });
      const edge = [];
      fs.forEach(f => {
        const sp = splitJibun(f.properties.jibun);
        if (sp.jimok !== '도') return;
        let inR = 0; try { const x = turf.intersect(f, zone); inR = x ? turf.area(x) / turf.area(f) : 0; } catch (er) { inR = 0; }
        if (inR >= 0.5) return;   // 구역 안 도로는 조서(편입 필지)에서 따로 셈
        let touch = false; try { touch = turf.booleanIntersects(near, f); } catch (er) { touch = false; }
        if (!touch) return;
        edge.push({ pnu: f.properties.pnu, jibun: sp.no, w: Math.round(this.width(f) * 10) / 10, geom: f.geometry });
      });
      z.roads = { key: JSON.stringify(turf.bbox(zone)), edge, at: new Date().toLocaleString('sv-SE').slice(0, 16) };
      saveZ();
    } catch (er) { statusMsg(`${id}안: 주변 도로를 불러오지 못했습니다 — ${er.message}`, true); }
    finally { this.loading[id] = false; this.memo = {}; if (S.source === 'map') render(); }
  },
  ready(id) { const z = Z.zones[id]; return !!(z && z.roads && z.geojson && z.roads.key === JSON.stringify(turf.bbox(z.geojson))); },
  // 구역 안 한 점(중심이 구역 밖이면 구역 안 아무 점)
  defaultCenter(zone) {
    let c = turf.centerOfMass(zone);
    if (!turf.booleanPointInPolygon(c, zone)) c = turf.pointOnFeature(zone);
    return [c.geometry.coordinates[1], c.geometry.coordinates[0]];
  },
  // 면적 A인 정사각형을 중심점에 놓고 구역(도로 확폭 부분 제외)으로 자름
  block(center, A, zone, minus) {
    if (!(A > 0)) return null;
    const [lat, lon] = center, side = Math.sqrt(A), kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
    const sq = turf.bboxPolygon([lon - side / 2 / kx, lat - side / 2 / ky, lon + side / 2 / kx, lat + side / 2 / ky]);
    let g = null; try { g = turf.intersect(sq, zone); } catch (er) { g = null; }
    if (g && minus) { try { g = turf.difference(g, minus) || g; } catch (er) { /* 그대로 */ } }
    return g;
  },
  memo: {},
  // a: analyze 결과, units: 계획 세대수 → { items, total, ratio, roadsReady }
  compute(a, units) {
    const id = a.key, z = Z.zones[id];
    if (!D.map || !z || !z.geojson) return null;
    const mk = [id, units, a.area, P.parkMode, P.sideRoadW, P.schoolArea, P.otherInfra, P.keepInnerRoads, JSON.stringify(z.infra || {}), z.roads && z.roads.at, Object.keys(z.inArea || {}).length].join('|');
    if (this.memo[mk]) return this.memo[mk];
    const zone = z.geojson, items = [];
    const W = this.entryWidth(units), sideW = num(P.sideRoadW) || 6;
    // 1) 도로: 진입도로(가장 넓은 경계 도로)를 세대수 기준 폭으로, 나머지 경계 도로는 최소 폭으로 — 부족한 폭만큼 구역 안쪽으로 확폭
    let roadGeom = null;
    if (z.roads) {
      const edge = z.roads.edge.slice().sort((x, y) => y.w - x.w);
      edge.forEach((r, i) => {
        const need = i === 0 ? W : sideW;
        if (r.w >= need - 0.3) return;
        let g = null;
        try { g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, need - r.w, { units: 'meters' }), zone); } catch (er) { g = null; }
        if (!g || turf.area(g) < 1) return;
        roadGeom = roadGeom ? safeUnion([roadGeom, g]) : g;
        items.push({ kind: i === 0 ? 'entry' : 'side', jibun: r.jibun, from: r.w, to: need, area: turf.area(g), geom: g });
      });
    }
    // 직접 잘라 도로로 지정한 조각
    (z.infra && z.infra.manualRoads || []).forEach((g, k) => {
      let f = null; try { f = turf.intersect({ type: 'Feature', properties: {}, geometry: g }, zone); } catch (er) { f = null; }
      if (!f || turf.area(f) < 1) return;
      roadGeom = roadGeom ? safeUnion([roadGeom, f]) : f;
      items.push({ kind: 'manual', idx: k, jibun: '직접 지정', from: 0, to: 0, area: turf.area(f), geom: f });
    });
    const roadArea = roadGeom ? turf.area(roadGeom) : 0;
    // 구역 안 기존 도로(지목 '도')
    const inner = a.ps.filter(p => p.jimok === '도');
    const innerArea = inner.reduce((s, p) => s + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    // 종교용지(존치·대체): 종교시설 건물이 선 필지. 법정 의무는 아니나 실무상 정비계획에서 미리 잡음
    const Rg = D.regions[id] || {}, infO = z.infra || {}, relOff = infO.relOff || {};
    const relAll = a.ps.filter(p => ((Rg.blds || {})[p.pnu] || []).some(b => b.religion));
    const rel = relAll.filter(p => !relOff[p.pnu]);
    const relLand = rel.reduce((s, p) => s + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    const relArea = infO.relArea != null && infO.relArea !== '' ? num(infO.relArea) : relLand;
    let relGeom = null;
    if (rel.length) { try { relGeom = turf.intersect(safeUnion(rel.filter(p => p.geom).map(p => ({ type: 'Feature', properties: {}, geometry: p.geom }))), zone); } catch (er) { relGeom = null; } }
    // 2) 공원·녹지
    const legal = a.area >= 50000;
    const parkNeed = legal ? Math.max(units * 2, a.area * 0.05) : (P.parkMode === 'always' ? a.area * 0.05 : 0);
    const inf = z.infra || {};
    const parkC = inf.parkC || this.defaultCenter(zone);
    const avoid0 = roadGeom && relGeom ? safeUnion([roadGeom, relGeom]) : (roadGeom || relGeom);
    const parkGeom = this.block(parkC, parkNeed, zone, avoid0);
    // 3) 학교·기타
    const schoolA = num(P.schoolArea);
    const schoolC = inf.schoolC || (() => { const [la, lo] = parkC; return [la, lo + (Math.sqrt(parkNeed || 1) + Math.sqrt(schoolA || 1)) / 2 / (Math.cos(la * Math.PI / 180) * 111320)]; })();
    const schoolGeom = this.block(schoolC, schoolA, zone, avoid0 ? (parkGeom ? safeUnion([avoid0, parkGeom]) : avoid0) : parkGeom);
    const parkArea = parkGeom ? turf.area(parkGeom) : 0, schoolArea = schoolGeom ? turf.area(schoolGeom) : 0;
    const other = num(P.otherInfra);
    const total = roadArea + (P.keepInnerRoads ? innerArea : 0) + parkArea + schoolArea + other + relArea;
    const res = {
      relAll, rel, relLand, relArea, relGeom, relManual: infO.relArea != null && infO.relArea !== '',
      W, sideW, units, items, roadGeom, roadArea, inner, innerArea, legal, parkNeed, parkGeom, parkArea, schoolGeom, schoolArea, other, total,
      ratio: a.area ? total / a.area : 0, roadsReady: !!z.roads, edge: z.roads ? z.roads.edge : [],
    };
    this.memo = {}; this.memo[mk] = res;
    return res;
  },
  // 지도에 그리기 (정비계획 탭·'기반시설 제안' 색 구분)
  draw(layer, a) {
    const pl = plan(a), inf = pl.infra; if (!inf) return;
    const c = n => cssVar(n);
    // 구역 밖 경계 도로는 참고로 구역 둘레 15m 안만 점선 테두리로 (색은 칠하지 않음 — 제안이 아님)
    const z0 = Z.zones[a.key], near = z0 && z0.geojson ? (() => { try { return turf.buffer(z0.geojson, 15, { units: 'meters' }); } catch (er) { return null; } })() : null;
    (inf.edge || []).forEach(r => {
      let g = { type: 'Feature', properties: {}, geometry: r.geom };
      if (near) { try { g = turf.intersect(g, near) || g; } catch (er) { /* 그대로 */ } }
      L.geoJSON(g, { style: { color: c('--ink-2'), weight: 1, dashArray: '2 4', fill: true, fillOpacity: 0 }, interactive: true })
        .bindTooltip(`구역 밖 경계 도로(참고) ${esc(r.jibun)} · 폭 약 ${r.w}m(필지 모양으로 추정)`, { sticky: true }).addTo(layer);
    });
    if (inf.relGeom) L.geoJSON(inf.relGeom, { style: { color: '#7b2cbf', weight: 2, fillColor: '#7b2cbf', fillOpacity: 0.3 } })
      .bindTooltip(`종교용지(존치·대체 검토) ${inf.rel.map(p => esc(p.jibun)).join(', ')} · ${fmt(inf.relArea)}㎡`, { sticky: true }).addTo(layer);
    inf.items.forEach(it => {
      const lyr = L.geoJSON(it.geom, { style: { color: c('--ink'), weight: 1, fillColor: c('--ink-2'), fillOpacity: it.kind === 'manual' ? 0.7 : 0.55, dashArray: it.kind === 'manual' ? null : '4 3' } })
        .bindTooltip(it.kind === 'manual' ? `직접 지정한 도로 ${fmt(it.area)}㎡ · 누르면 지정 취소` : `${it.kind === 'entry' ? '진입도로' : '주변 도로'} 확폭(제안) · ${esc(it.jibun)} 약 ${it.from}m → ${it.to}m · ${fmt(it.area)}㎡`, { sticky: true }).addTo(layer);
      if (it.kind === 'manual') lyr.on('click', ev => {
        L.DomEvent.stop(ev);
        const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.manualRoads) return;
        z.infra.manualRoads.splice(it.idx, 1); saveZ(); INFRA.memo = {}; render(); toast('도로 지정을 취소했습니다');
      });
    });
    if (inf.parkGeom) L.geoJSON(inf.parkGeom, { style: { color: c('--ok'), weight: 2, fillColor: c('--ok'), fillOpacity: 0.35 } })
      .bindTooltip(`공원·녹지(제안) ${fmt(inf.parkArea)}㎡${inf.parkArea < inf.parkNeed * 0.95 ? ` — 구역 경계에 걸려 필요 ${fmt(inf.parkNeed)}㎡보다 작음, 위치를 옮기세요` : ''}`, { sticky: true }).addTo(layer);
    if (inf.schoolGeom) L.geoJSON(inf.schoolGeom, { style: { color: c('--accent'), weight: 2, fillColor: c('--accent'), fillOpacity: 0.3 } })
      .bindTooltip(`학교용지(제안) ${fmt(inf.schoolArea)}㎡`, { sticky: true }).addTo(layer);
  },
  place(kind, latlng) {
    const z = Z.zones[S.region]; if (!z) return;
    z.infra = z.infra || {};
    z.infra[kind === 'park' ? 'parkC' : 'schoolC'] = [latlng.lat, latlng.lng];
    saveZ(); this.memo = {};
    S.placing = null; $id('lmap').classList.remove('picking');
    toast(`${kind === 'park' ? '공원·녹지' : '학교용지'} 위치를 옮겼습니다`);
    render();
  },
};

/* ===== 화면 상태 ===== */
const S = { tab: 'zone', region: 'A', mode: 'old', drawing: false, draft: [], source: lsGet(UI_KEY).source === 'sample' ? 'sample' : 'map', placed: null };
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('map');
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
const ringStr = r => r.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ');
const $id = id => document.getElementById(id);

function setSource(src) {
  S.source = src; lsSet(UI_KEY, { source: src });
  S.drawing = false; S.draft = [];
  loadData(); render();
  if (src === 'map') fitZone(S.region);
}
function loadData() {
  if (S.source === 'sample') {
    D = buildSample(); D.keys = ['A', 'B', 'C'];
    try { const s = localStorage.getItem('jbs-urban-C-sample'); if (s) D.regions.C.pts = JSON.parse(s); } catch (e) { /* 무시 */ }
    const pad = Math.max(D.W, D.H) * 0.015;
    svg.setAttribute('viewBox', `${-pad} ${-pad} ${D.W + pad * 2} ${D.H + pad * 2}`);
  } else D = buildMap();
  D.parcels.forEach(applyAccess);
  if (!D.keys.includes(S.region)) S.region = D.keys[0];
  const isMap = S.source === 'map';
  $id('lmap').hidden = !isMap; $id('svgbox').hidden = isMap; $id('mapTools').hidden = !isMap; $id('mapSearch').hidden = !isMap; $id('vSplit').hidden = !isMap;
  $id('finishBtn').hidden = true; $id('cancelBtn').hidden = true; $id('drawBtn').hidden = false;
  $id('drawHint').innerHTML = isMap
    ? '<b>구역계 그리기</b>를 누르고 지도에서 꼭짓점을 찍은 뒤 첫 점을 다시 누르면 완성됩니다. 완성하면 그 안의 필지(연속지적)·건축물(GIS건물통합정보)·토지특성·공동주택 건축물대장을 자동으로 불러옵니다. 구역계와 10% 이상 겹치는 필지를 편입 필지로 봅니다.'
    : '그리기: 도면을 눌러 꼭짓점을 찍고 <b>완성</b>을 누르면 \'직접 그린 안\'으로 판정합니다. 구역계 안에 중심점이 들어온 필지를 편입 필지로 봅니다.';
  if (!isMap) statusMsg('');
  renderSourceBar(); syncRegionChips();
  if (isMap) initLeaflet();
}
function roadTargets() {
  if (!D.map) return [];
  const R = D.regions[S.region]; if (!R || !R.fetched) return [];
  return Object.keys(R.inArea).filter(k => { const p = D.byPnu.get(k); return p && !p.roadSide && (R.blds[k] || []).length; });
}
function ledgerTargets() {
  if (!D.map || !LG.ok) return [];
  const R = D.regions[S.region]; if (!R || !R.fetched) return [];
  return Object.keys(R.inArea).filter(ledgerNeeded);
}
function renderSourceBar() {
  const bar = $id('source'), tag = $id('demoTag');
  if (S.source === 'sample') {
    tag.textContent = '예시 구역 데이터 · 실제 지번 아님'; tag.className = 'demo';
    bar.innerHTML = `예시 구역(고정 그림)을 보는 중입니다. <button class="btn sm" id="toMap">지도에서 구역계 그리기로 돌아가기</button>`;
  } else {
    tag.textContent = '실제 지도 · 브이월드 공부 조회'; tag.className = 'demo real';
    const used = D.keys.filter(k => D.regions[k].geojson).length, rt = roadTargets().length;
    const proj = loadProject(), hasProj = !!(proj && proj.area && proj.area.geojson);
    bar.innerHTML = `<b>지도에서 구역계를 그려 판정합니다</b> · 그린 안 ${used}개`
      + (rt ? ` <button class="btn sm" id="roadBtn">도로접면 조회 (${rt}필지)</button>` : '')
      + (ledgerTargets().length ? ` <button class="btn sm" id="ledBtn" title="사용승인 연도가 빈 건물과 공동주택 세대수를 건축물대장 표제부로 채웁니다">건축물대장으로 연도·세대수 채우기 (${ledgerTargets().length}필지)</button>` : '')
      + (hasProj ? ` <button class="btn ghost sm" id="fromProj" title="사업성 검토 화면에 그린 구역계와 토지·건축물 조서를 지금 고른 안으로 가져옵니다">사업성 검토 구역 가져오기 → ${esc(S.region)}안</button>` : '')
      + ` <button class="btn ghost sm" id="toSample">예시 구역 보기</button>`;
  }
  const on = (id, fn) => { const b = $id(id); if (b) b.onclick = fn; };
  on('toMap', () => setSource('map'));
  on('toSample', () => setSource('sample'));
  on('fromProj', () => {
    const R = D.regions[S.region];
    if (R.geojson && !confirm(`${R.name}에 이미 구역계가 있습니다. 사업성 검토 구역으로 바꿀까요?`)) return;
    importProject(S.region);
  });
  on('ledBtn', async () => {
    if (busy) return; busy = true;
    const b = $id('ledBtn'); if (b) b.disabled = true;
    const id = S.region;
    try { const f = await fillLedger(ledgerTargets(), (t, st, d, n) => { statusMsg(`${id}안: ${t}`); if (st) jobSet(id, st, d, n); }); saveCache(); jobEnd(); statusMsg(f ? `건축물대장 조회 완료 · ${f}필지 실패(다시 누르면 재시도)` : '건축물대장으로 연도·세대수를 채웠습니다.'); }
    finally { busy = false; D = buildMap(); D.parcels.forEach(applyAccess); renderSourceBar(); render(); }
  });
  on('roadBtn', async () => {
    if (busy) return; busy = true;
    const b = $id('roadBtn'); if (b) b.disabled = true;
    const id = S.region;
    try { const f = await fillLandChar(roadTargets(), (t, st, d, n) => { statusMsg(`${id}안: ${t}`); if (st) jobSet(id, st, d, n); }, true); saveCache(); jobEnd(); statusMsg(f ? `도로접면 조회 완료 · ${f}필지 실패(다시 누르면 재시도)` : '도로접면 조회를 마쳤습니다.'); }
    finally { busy = false; D = buildMap(); D.parcels.forEach(applyAccess); renderSourceBar(); render(); }
  });
}
function syncRegionChips() {
  const box = $id('zoneChips');
  box.innerHTML = D.keys.map(k => {
    const R = D.regions[k], has = D.map ? !!R.geojson : !!R.pts;
    return `<button class="chip ${has ? '' : 'empty'}" data-region="${k}" aria-pressed="${k === S.region}">${esc(R.name)}${has ? '' : ' · 비어 있음'}</button>`;
  }).join('') + (D.map && D.keys.length < ZONE_IDS.length ? '<button class="chip empty" id="addZone">+ 안 추가</button>' : '');
  box.querySelectorAll('[data-region]').forEach(b => b.onclick = () => {
    if (editH) { toast('구역계 고치기를 먼저 마쳐 주세요'); return; }
    S.region = b.dataset.region; syncRegionChips(); renderSourceBar(); syncUndo(); if (D.map) fitZone(S.region); render();
  });
  const add = $id('addZone');
  if (add) add.onclick = () => { Z.count = D.keys.length + 1; saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); S.region = D.keys[D.keys.length - 1]; syncRegionChips(); render(); toast(`${S.region}안을 추가했습니다. 구역계 그리기를 누르세요`); };
}
function fillVar(p, blds) {
  const old = blds.some(b => (b.old === undefined ? obsoleteRule(b).old : b.old)), area = p.base ?? p.area;
  if (S.mode === 'old' || S.mode === 'arch') return !blds.length ? '--nobuild' : old ? '--old' : '--new';
  if (S.mode === 'small') return area < smallLimit(p.zone) ? '--small' : '--new';
  if (S.mode === 'access') return !blds.length || p.access == null ? '--nobuild' : p.access ? '--new' : '--old';
  if (S.mode === 'infra') return p.jimok === '도' ? '--road' : '--nobuild';
  return /2종/.test(p.zone) ? '--accent-soft' : /3종/.test(p.zone) ? '--warn-soft' : '--nobuild';
}
function parcelFill(p) { return `var(${fillVar(p, p.blds)})`; }
function drawMap() { if (D.map) drawLeaflet(); else drawSvg(); }

/* ===== 실제 지도 (Leaflet + 브이월드) ===== */
let LM = null, layP = null, layZ = null, layT = null, editGroup = null, editH = null, drawH = null;
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || '#888';
function initLeaflet() {
  if (LM) { setTimeout(() => LM.invalidateSize(), 30); return; }
  if (!window.L || !L.Draw || !window.turf) { statusMsg('지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침해 주세요.', true); return; }
  // 그리기 도구 안내를 한글로
  try {
    const dl = L.drawLocal;
    dl.draw.handlers.polygon.tooltip = { start: '눌러서 첫 꼭짓점을 찍으세요', cont: '눌러서 다음 꼭짓점을 찍으세요', end: '첫 점을 다시 누르면 완성됩니다' };
    dl.draw.handlers.polyline.error = '<strong>선이 서로 겹칠 수 없습니다</strong>';
    dl.draw.handlers.polyline.tooltip = { start: '자를 선의 첫 점을 누르세요', cont: '다음 점을 누르세요', end: '마지막 점을 다시 누르면 선이 끝납니다' };
    dl.edit.handlers.edit.tooltip = { text: '흰 네모(꼭짓점)를 끌어 고치세요', subtext: "다 고쳤으면 '꼭짓점 고치기 끝내기'를 누르세요" };
  } catch (e) { /* 무시 */ }
  LM = L.map('lmap', { maxZoom: 21 }).setView(Z.center, Z.zoom);
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' });
  if (VW.ok) {
    const k = VW.key, attr = '&copy; <a href="https://www.vworld.kr">VWorld</a>';
    const base = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Base/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19, attribution: attr });
    const sat = L.layerGroup([
      L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Satellite/{z}/{y}/{x}.jpeg`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19, attribution: attr }),
      L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Hybrid/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19 }),
    ]);
    // WMS 지적도는 domain을 보내면 거절됨(Referer로 확인)
    const cad = L.tileLayer.wms('https://api.vworld.kr/req/wms', { layers: 'lp_pa_cbnd_bubun', styles: 'lp_pa_cbnd_bubun', format: 'image/png', transparent: true, version: '1.3.0', minZoom: 16, maxZoom: 21, key: k });
    base.addTo(LM); cad.addTo(LM);
    L.control.layers({ '브이월드 지도': base, '위성사진': sat, 'OpenStreetMap': osm }, { '지적도 (16레벨 이상 확대 시)': cad }, { collapsed: true }).addTo(LM);
  } else osm.addTo(LM);
  L.control.scale({ imperial: false }).addTo(LM);
  LM.createPane('parcelPane').style.zIndex = 390;
  layP = L.featureGroup().addTo(LM); layZ = L.featureGroup().addTo(LM); layT = L.featureGroup().addTo(LM);
  editGroup = new L.FeatureGroup().addTo(LM);
  LM.on(L.Draw.Event.CREATED, e => { if (CUT.active) { CUT.onLine(e.layer.toGeoJSON()); return; } drawH = null; $id('drawBtn').textContent = '구역계 그리기'; const gj = e.layer.toGeoJSON(); delete ZK.rough[S.region]; setZoneGeom(S.region, gj, 0, '구역계 그리기'); fitZone(S.region); ZK.checkFit(gj, '손으로 그린 구역계'); });
  LM.on(L.Draw.Event.DRAWSTOP, () => { drawH = null; $id('drawBtn').textContent = '구역계 그리기'; });
  LM.on(L.Draw.Event.EDITED, () => { const l = editGroup.getLayers()[0]; if (l) setZoneGeom(S.region, l.toGeoJSON(), 0, '꼭짓점 고치기'); });
  LM.on('moveend', () => { const c = LM.getCenter(); Z.center = [c.lat, c.lng]; Z.zoom = LM.getZoom(); saveZ(); });
  LM.on('click', e => { if (CUT.active && !CUT.pieces) return; if (S.placing) { INFRA.place(S.placing, e.latlng); return; } if (ZK.picking && !drawH && !editH) ZK.pick(e.latlng); });
  const FullBtn = L.Control.extend({ options: { position: 'topleft' }, onAdd: () => {
    const b = L.DomUtil.create('a', 'leaflet-bar lmap-btn'); b.href = '#'; b.title = '지도 크게 보기 (Esc로 닫기)'; b.textContent = '⛶';
    L.DomEvent.on(b, 'click', ev => { L.DomEvent.stop(ev); ZK.toggleFull(); }); return b; } });
  LM.addControl(new FullBtn());
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && $id('mapWrap').classList.contains('full')) ZK.toggleFull(); });
  setTimeout(() => LM.invalidateSize(), 60);
}
function fitZone(id) {
  if (!LM || !D.map) return;
  const R = D.regions[id];
  if (R && R.geojson) { try { LM.fitBounds(L.geoJSON(R.geojson).getBounds(), { padding: [30, 30] }); } catch (e) { /* 무시 */ } }
}
function tipText(p, blds) {
  return `${p.jibun} ${p.jimok || ''} · ${fmt(p.base ?? p.area)}㎡ · ${p.zone || '용도지역 미확인'}\n접도: ${p.accSrc || '–'}`
    + (blds.length ? blds.map(b => `\n${b.use} · ${b.struct || '구조 미상'} · ${b.year || '연도 없음'} · ${b.unknown ? '확인 필요' : b.old ? '노후' : '비노후'}`).join('') : '\n건축물 없음');
}
function drawLeaflet() {
  if (!LM) { drawLegend(); return; }
  if (editH) return;   // 고치는 동안에는 다시 그리지 않음
  layP.clearLayers(); layZ.clearLayers(); layT.clearLayers(); editGroup.clearLayers();
  const R = D.regions[S.region];
  if (R && R.geojson && R.fetched) {
    const line = cssVar('--roadline'), ink = cssVar('--ink');
    Object.keys(R.inArea).forEach(pnu => {
      const p = D.byPnu.get(pnu); if (!p || !p.geom) return;
      const blds = R.blds[pnu] || [];
      const man = p.manual && S.mode === 'access';
      const lyr = L.geoJSON({ type: 'Feature', properties: {}, geometry: p.geom }, { pane: 'parcelPane', style: { color: man ? ink : line, weight: man ? 2 : 0.7, fillColor: cssVar(fillVar(p, blds)), fillOpacity: 0.62, opacity: 1 } });
      lyr.bindTooltip(tipText(p, blds), { sticky: true });
      if (S.mode === 'access' && blds.length) lyr.on('click', ev => { if (!drawH && !ZK.picking) { L.DomEvent.stop(ev); cycleAccess(p.id); } });
      lyr.addTo(layP);
    });
  }
  D.keys.forEach(k => {
    const r = D.regions[k]; if (!r.geojson) return;
    const act = k === S.region;
    const style = act ? { color: cssVar('--redline'), weight: 3, dashArray: '12 4 2 4', fill: false } : { color: cssVar('--ink-2'), weight: 2, dashArray: '5 5', fill: false, opacity: 0.7 };
    L.geoJSON(r.geojson, { style }).eachLayer(l => { l.bindTooltip(r.name + ' 구역계', { sticky: true }); (act ? editGroup : layZ).addLayer(l); });
  });
  if (ZK.rough[S.region]) L.geoJSON(ZK.rough[S.region], { style: { color: cssVar('--ink-2'), weight: 2, dashArray: '6 6', fill: false }, interactive: false }).addTo(layZ);
  S.placed = null;
  if (S.mode === 'arch' && R && R.geojson) { const a = analyze(S.region); if (a) drawTowersMap(R.geojson, plan(a)); }
  if (S.mode === 'infra' && R && R.geojson && R.fetched) {
    if (!INFRA.ready(S.region)) INFRA.fetchRoads(S.region);
    const a = analyze(S.region); if (a) INFRA.draw(layT, a);
  }
  drawLegend();
}
// 개략 주동 배치: 구역계를 미터 좌표로 펴서 격자로 놓은 뒤 다시 경위도로
function drawTowersMap(gj, pl) {
  const g = gj.geometry;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : [];
  if (!rings.length) return;
  const ring = rings.slice().sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length, lon0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  const pts = ring.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
  const back = ([x, y]) => [lat0 - y / ky, lon0 + x / kx];
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
  const gap = Math.max(fw + 14, 0.8 * pl.floorsTower * 2.9 + fh);
  const col = cssVar('--accent');
  let placed = 0;
  for (let y = Math.min(...ys) + 12; y < Math.max(...ys) - fh && placed < pl.towers; y += gap) {
    for (let x = Math.min(...xs) + 10; x < Math.max(...xs) - fw && placed < pl.towers; x += fw + 16) {
      const c = [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh]];
      if (!c.every(([px, py]) => inside(px, py, pts))) continue;
      L.polygon(c.map(back), { color: col, weight: 1, fillColor: col, fillOpacity: 0.85 }).bindTooltip(`${pl.floorsTower}층 · ${P.coreUnits}세대/층`, { sticky: true }).addTo(layT);
      placed++;
    }
  }
  S.placed = placed;
}
function startMapDraw() {
  if (!LM) return;
  if (drawH) { drawH.disable(); drawH = null; $id('drawBtn').textContent = '구역계 그리기'; return; }
  const R = D.regions[S.region];
  if (R.geojson && !confirm(`${R.name} 구역계를 새로 그릴까요? 지금 구역계는 지워집니다.`)) return;
  if (ZK.picking) ZK.setPicking(false);
  delete ZK.rough[S.region];
  drawH = new L.Draw.Polygon(LM, { allowIntersection: false, showArea: false, shapeOptions: { color: cssVar('--redline'), weight: 3 } });
  drawH.enable();
  $id('drawBtn').textContent = '그리기 취소';
  toast('지도에서 꼭짓점을 찍고, 첫 점을 다시 누르면 완성됩니다');
}
// 왼쪽 도구 막대 버튼 글자(아이콘은 그대로)
function mtLabel(b, t) { if (!b) return; b.setAttribute('aria-label', t); b.dataset.tip = b.dataset.tip ? t + (b.dataset.tip.includes(' — ') ? ' — ' + b.dataset.tip.split(' — ').slice(1).join(' — ') : '') : t; }
function toggleEdit() {
  if (!LM) return;
  const b = $id('editBtn');
  if (editH) { editH.save(); editH.disable(); editH = null; mtLabel(b, '꼭짓점 끌기'); b.classList.remove('on'); drawLeaflet(); return; }
  if (ZK.picking) ZK.setPicking(false);
  if (!editGroup.getLayers().length) { toast('먼저 구역계를 그려 주세요'); return; }
  if (editGroup.getLayers().length > 1 || D.regions[S.region].geojson.geometry.type !== 'Polygon') { toast('여러 덩어리로 된 구역계는 다시 그려 주세요'); return; }
  editH = new L.EditToolbar.Edit(LM, { featureGroup: editGroup });
  editH.enable();
  mtLabel(b, '끌기 끝내기'); b.classList.add('on');
  toast('흰 네모(꼭짓점)를 끌어 고친 뒤 왼쪽의 끌기 끝내기를 누르세요');
}
function importGeoJSONText(text) {
  let j; try { j = JSON.parse(text); } catch (e) { statusMsg('GeoJSON 파일을 읽지 못했습니다.', true); return; }
  const feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : [{ type: 'Feature', properties: {}, geometry: j }];
  const polys = [];
  feats.forEach(f => { const g = f && f.geometry; if (!g) return; if (g.type === 'Polygon') polys.push(g.coordinates); else if (g.type === 'MultiPolygon') polys.push(...g.coordinates); });
  if (!polys.length) { statusMsg('파일에 다각형(Polygon)이 없습니다.', true); return; }
  const c0 = polys[0][0][0];
  if (Math.abs(c0[0]) > 180 || Math.abs(c0[1]) > 90) { statusMsg('경위도(WGS84, EPSG:4326) 좌표의 GeoJSON만 읽을 수 있습니다. 파일 좌표계를 확인해 주세요.', true); return; }
  const merged = safeUnion(polys.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: c } })));
  delete ZK.rough[S.region];
  setZoneGeom(S.region, merged, 0, 'GeoJSON 불러오기');
  fitZone(S.region);
  ZK.checkFit(merged, '불러온 구역계');
}

function parcelFill(p) {
  const old = p.blds.some(b => (b.old === undefined ? obsoleteRule(b).old : b.old));
  if (S.mode === 'old' || S.mode === 'arch') return !p.blds.length ? 'var(--nobuild)' : old ? 'var(--old)' : 'var(--new)';
  if (S.mode === 'small') return p.area < smallLimit(p.zone) ? 'var(--small)' : 'var(--new)';
  if (S.mode === 'access') return p.access == null ? 'var(--nobuild)' : !p.blds.length ? 'var(--nobuild)' : p.access ? 'var(--new)' : 'var(--old)';
  if (S.mode === 'zone') return /2종/.test(p.zone) ? 'var(--accent-soft)' : /3종/.test(p.zone) ? 'var(--warn-soft)' : 'var(--nobuild)';
}
function drawSvg() {
  svg.innerHTML = '';
  svg.classList.toggle('drawing', S.drawing);
  const vb = svg.viewBox.baseVal, u = Math.max(D.W, D.H) / 410;   // 선 굵기 단위
  el('rect', { x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: 'var(--sheet)' });
  D.roads.forEach(r => el('polygon', { points: ringStr(r), fill: 'var(--road)' }));
  const reg = D.regions[S.region];
  const g = el('g', {});
  const inReg = new Set(reg && reg.pts ? regionParcels(S.region).map(p => p.id) : []);
  D.parcels.forEach(p => {
    const dim = reg && reg.pts && !inReg.has(p.id);
    p.rings.forEach(r => {
      const shape = el('polygon', { points: ringStr(r), fill: parcelFill(p), stroke: p.manual && S.mode === 'access' ? 'var(--ink)' : 'var(--roadline)', 'stroke-width': (p.manual && S.mode === 'access' ? 1 : 0.35) * u, opacity: dim ? 0.38 : 1 }, g);
      if (S.mode === 'access' && p.blds.length) { shape.style.cursor = 'pointer'; shape.addEventListener('click', ev => { if (S.drawing) return; ev.stopPropagation(); cycleAccess(p.id); }); }
      const t = el('title', {}, shape);
      t.textContent = `${p.jibun} ${p.jimok || ''} · ${fmt(p.area)}㎡ · ${p.zone || '용도지역 미확인'}\n접도: ${p.accessStr}` +
        (p.blds.length ? p.blds.map(b => `\n${b.use} · ${b.struct} · ${b.year || '연도 없음'} · ${(b.old ?? obsoleteRule(b).old) ? '노후' : '비노후'}`).join('') : '\n건축물 없음');
    });
  });
  for (const k of D.keys) {
    const rr = D.regions[k]; if (k === S.region || !rr.pts) continue;
    el('polygon', { points: ringStr(rr.pts), fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 0.8 * u, 'stroke-dasharray': `${3 * u} ${2 * u}`, opacity: 0.5 });
  }
  if (reg && reg.pts) {
    (reg.rings || [reg.pts]).forEach(r => el('polygon', { points: ringStr(r), fill: 'none', stroke: 'var(--redline)', 'stroke-width': 1.8 * u, 'stroke-dasharray': `${7 * u} ${2 * u} ${1.2 * u} ${2 * u}` }));
    const minY = Math.min(...reg.pts.map(q => q[1])), atX = reg.pts.find(q => q[1] === minY)[0];
    const lab = el('text', { x: atX + 3 * u, y: minY + 9 * u, fill: 'var(--redline)', 'font-size': 7.5 * u, 'font-weight': 700, 'font-family': 'IBM Plex Sans KR, sans-serif' }); lab.textContent = reg.name + ' 구역계';
  }
  S.placed = null;
  if (S.mode === 'arch' && reg && reg.pts) { const a = analyze(S.region); if (a) drawTowers(reg.pts, plan(a), u); }
  if (S.drawing) {
    if (S.draft.length) el('polyline', { points: ringStr(S.draft), fill: 'none', stroke: 'var(--redline)', 'stroke-width': 1.4 * u });
    S.draft.forEach(q => el('circle', { cx: q[0], cy: q[1], r: 2.2 * u, fill: 'var(--redline)' }));
  }
  const bar = Math.pow(10, Math.floor(Math.log10(D.W / 6))), by = vb.y + vb.height - 6 * u, bx = vb.x + 6 * u;
  el('line', { x1: bx, y1: by, x2: bx + bar, y2: by, stroke: 'var(--ink)', 'stroke-width': u });
  const st = el('text', { x: bx, y: by - 3 * u, 'font-size': 6 * u, fill: 'var(--ink)', 'font-family': 'IBM Plex Mono, monospace' }); st.textContent = `0 — ${bar}m`;
  drawLegend();
}
function drawTowers(pts, pl, u) {
  const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
  const fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
  const gap = Math.max(fw + 14, 0.8 * pl.floorsTower * 2.9 + fh);
  let placed = 0; const g = el('g', {});
  for (let y = Math.min(...ys) + 12; y < Math.max(...ys) - fh && placed < pl.towers; y += gap) {
    for (let x = Math.min(...xs) + 10; x < Math.max(...xs) - fw && placed < pl.towers; x += fw + 16) {
      const c = [[x, y], [x + fw, y], [x, y + fh], [x + fw, y + fh]]; if (!c.every(([px, py]) => inside(px, py, pts))) continue;
      el('rect', { x, y, width: fw, height: fh, fill: 'var(--accent)', opacity: 0.85, rx: u }, g);
      const t = el('text', { x: x + fw / 2, y: y + fh / 2 + 2.2 * u, 'text-anchor': 'middle', 'font-size': 5.5 * u, fill: 'var(--sheet)', 'font-family': 'IBM Plex Mono, monospace' }, g); t.textContent = pl.floorsTower + 'F';
      placed++;
    }
  }
  S.placed = placed;
}
function drawLegend() {
  const L = document.getElementById('legend');
  const m = {
    old: [['var(--old)', '노후·불량'], ['var(--new)', '비노후'], ['var(--nobuild)', '건축물 없음']],
    small: [['var(--small)', '과소필지(분할제한면적 미만, 주거 60㎡)'], ['var(--new)', '그 외']],
    access: [['var(--new)', '접도 충족'], ['var(--old)', '미충족(폭4m·4m 미만)'], ['var(--nobuild)', D.real ? '미확인·건축물 없음' : '건축물 없음'], [null, `${D.map ? '지도의' : '도면의'} 필지를 누르면 충족 → 미충족 → 자동 순으로 지정`]],
    zone: [['var(--accent-soft)', '제2종일반주거'], ['var(--warn-soft)', '제3종일반주거'], ['var(--nobuild)', '기타·미확인']],
    arch: [['var(--accent)', '개략 주동 배치'], ['var(--old)', '노후·불량(현황)']],
    infra: [['var(--ink-2)', '도로 확폭(제안)'], ['var(--road)', '구역 안 현황 도로'], ['var(--ok)', '공원·녹지(제안)'], ['var(--accent)', '학교용지(제안)'], ['#7b2cbf', '종교용지(존치·대체)']],
  }[S.mode];
  L.innerHTML = m.map(([c, t]) => c ? `<span><i style="background:${c}"></i>${t}</span>` : `<span>${t}</span>`).join('') + `<span><svg width="26" height="8" style="vertical-align:0"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--redline)" stroke-width="2" stroke-dasharray="7 2 1.2 2"/></svg> 구역계</span>`;
}
function svgPoint(evt) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(Math.max(0, Math.min(D.W, q.x)) * 10) / 10, Math.round(Math.max(0, Math.min(D.H, q.y)) * 10) / 10]; }
svg.addEventListener('click', e => { if (!S.drawing) return; S.draft.push(svgPoint(e)); document.getElementById('finishBtn').disabled = S.draft.length < 3; drawSvg(); });

/* ===== 우측 패널 ===== */
const side = document.getElementById('side');
function render() {
  drawMap();
  if (S.tab === 'rules') { renderRules(); return; }
  const a = analyze(S.region);
  if (!a) {
    const R = D.regions[S.region];
    if (!D.map) side.innerHTML = `<h2>${regName()}</h2><p>아직 그린 구역계가 없습니다. 도면 위 <b>구역계 그리기</b>를 눌러 꼭짓점을 찍어 보세요.</p>`;
    else if (R.geojson) side.innerHTML = `<h2>${regName()}</h2>${jobHtml()}${JOB.active && JOB.zone === S.region ? '' : '<p class="empty-guide">아직 필지·건축물을 불러오지 않았습니다. <b>필지·건축물 다시 불러오기</b>를 눌러 주세요.</p>'}`;
    else side.innerHTML = `<h2>${regName()} · 구역계가 없습니다</h2><div class="empty-guide"><ol>
      <li>지도 위 검색 칸에 주소나 지번을 넣어 대상지로 이동합니다. 예: 용현동 340</li>
      <li><b>구역계 그리기</b>를 누르고 지도에서 꼭짓점을 찍습니다. 첫 점을 다시 누르면 완성됩니다.</li>
      <li>완성하면 그 안의 필지·건축물·토지특성을 자동으로 불러와 요건판정부터 사업성까지 보여 줍니다.</li></ol>
      <p>안을 여러 개(A·B·C…) 그려 같은 기준으로 비교할 수 있습니다. 사업성 검토 화면에 그린 구역이 있으면 위의 <b>사업성 검토 구역 가져오기</b>로, 경위도(WGS84) GeoJSON 파일은 <b>GeoJSON 불러오기</b>로 넣을 수 있습니다.</p></div>`;
    return;
  }
  ({ zone: renderZone, req: renderReq, plan: renderPlan, arch: renderArch, biz: renderBiz })[S.tab](a);
  if (JOB.active && JOB.zone === S.region) side.insertAdjacentHTML('afterbegin', jobHtml());
}
const kpi = (l, v, f) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="f">${f || ''}</div></div>`;
const regName = () => esc(D.regions[S.region].name);
function renderZone(a) {
  const rows = a.bs.slice().sort((x, y) => (x.year || 9999) - (y.year || 9999)).map(b => {
    const p = b.pid != null ? D.parcels[b.pid] : null;
    return `<tr><td>${esc(p ? p.jibun : '(필지 연결 안 됨)')}</td><td>${esc(b.use)}${b.src ? ` <span class="u">${esc(b.src)}</span>` : ''}</td><td>${esc(b.struct)}</td><td class="r">${b.year || '–'}</td><td class="r">${fmt(b.floor)}</td><td>${b.unknown ? '<span class="pill warn">확인</span>' : b.old ? '<span class="pill bad">노후</span>' : '<span class="pill ok">비노후</span>'}</td><td>${esc(b.why)}</td><td>${p ? `<button class="acc ${p.access === true ? 'ok' : p.access === false ? 'bad' : ''} ${p.manual ? 'man' : ''}" data-pid="${p.id}" title="${esc(p.accSrc)} · 누르면 충족 → 미충족 → 자동">${p.access == null ? '미확인' : p.access ? '충족' : '미충족'}${p.manual ? ' · 지정' : ''}</button>` : '–'}</td><td>${b.lic}</td></tr>`;
  }).join('');
  side.innerHTML = `<h2>${regName()} 현황분석 ${D.map ? `<span class="badge v">공부 조회 ${esc(D.regions[S.region].at)}</span>` : '<span class="badge a">예시 데이터</span>'}</h2>
  <div class="kpis">
    ${kpi('구역 면적', fmt(a.area) + '㎡', D.map ? '그린 구역계 면적(도로 포함)' : '구역계 폴리곤 면적(도로 포함)')}
    ${kpi('편입 필지', a.ps.length + '필지', `${D.map ? '대장 면적×편입비율' : '조서 면적'} 합 ${fmt(a.landArea)}㎡`)}
    ${kpi('건축물', a.N + '동', `연면적 ${fmt(a.fa)}㎡` + (a.ghostN ? `<br>공부 정보 없는 GIS 건물 ${a.ghostN}동 ${({ out: '제외', unknown: '포함(연도 미확인)', old: '포함(기존무허가·노후)' })[ghostMode()]}` : ''))}
    ${kpi('노후도(동수)', oldText(a), `${a.oldN} / ${a.N}동${a.unknownN ? ` · 사용승인 연도 미확인 ${a.unknownN}동` : ''}`)}
    ${kpi('노후도(연면적)', pct(a.oldFaRatio), `${fmt(a.oldFa)} / ${fmt(a.fa)}㎡`)}
    ${kpi('과소필지', pct(a.smallRatio), `분할제한면적 미만 ${a.smallN} / ${a.ps.length}필지`)}
    ${kpi('주택접도율', accText(a), `폭4m·4m 이상 접도 ${a.accN} / ${a.N}동${a.accU ? ` · 미확인 ${a.accU}동` : ''}`)}
    ${kpi('호수밀도', a.density.toFixed(1) + '동/ha', `${a.du}동 ÷ ${(a.area / 10000).toFixed(2)}ha`)}
    ${kpi('토지등소유자(추정)', fmt(a.owners) + '명', D.map ? '소유자 정보 없음: 사유지 1필지 1인, 공동주택은 세대별' + (a.needUnits ? ` · 세대수 미확인 ${a.needUnits}동` : '') : '1필지 1인, 다세대는 호수별')}
  </div>
  ${a.ghostN ? `<div class="ghost-note"><b>공부 정보 없는 GIS 건물 ${a.ghostN}동</b> — 무허가건축물일 수 있음
    <div class="seg" role="group" aria-label="공부 없는 건물 처리" style="margin-top:6px">
      <button type="button" data-gm="out" aria-pressed="${ghostMode() === 'out'}">빼기</button><button type="button" data-gm="unknown" aria-pressed="${ghostMode() === 'unknown'}">넣기(연도 미확인)</button><button type="button" data-gm="old" aria-pressed="${ghostMode() === 'old'}">기존무허가로 넣기(노후)</button></div>
    <div class="u">GIS건물통합정보에 용도·면적·사용승인일이 모두 비어 있고 건축물대장에도 없는 건물입니다. 무허가건물·부속건물·가설건축물이거나 GIS 오류일 수 있습니다. 기존무허가건축물(1989.1.24. 당시 있던 무허가건물)은 건축물로 보아 노후도에 넣고 노후로 셉니다. 그 뒤 생긴 신발생 무허가건물은 넣지 않습니다. 오래된 주거지면 대부분 기존무허가일 가능성이 높지만, 부속 창고·화장실 등이 섞이므로 무허가건축물관리대장(구청)·항공사진(1989년 전후)·재산세 과세대장으로 확인해 고르세요. 연면적 정보가 없어 연면적 노후도에는 영향이 없습니다.</div></div>` : ''}
  <h3>건축물 현황 (준공 오래된 순)</h3>
  <div class="tscroll"><table><thead><tr><th>지번</th><th>용도</th><th>구조</th><th class="r">사용승인</th><th class="r">연면적㎡</th><th>판정</th><th>근거</th><th>접도</th><th>허가</th></tr></thead><tbody>${rows || '<tr><td colspan="9">건축물이 없습니다.</td></tr>'}</tbody></table></div>
  <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="copyTbl">표 복사(엑셀 붙여넣기용)</button></div>
  <p class="note">접도는 ${D.real ? "토지특성 <b>도로접면</b>으로 추정합니다. 광대로·중로·소로·세로(가)는 폭 4m 이상 도로에 접한 것으로, 세로(불)·맹지는 미충족으로 봅니다. 세로(가)는 '폭 8m 미만·자동차 통행 가능' 도로라 4m가 안 될 수 있으니, 현장과 다르면 접도 칸이나 도면(색 구분 '접도')의 필지를 눌러 직접 지정하세요." : '예시 구역의 도로 폭으로 판정합니다. 접도 칸을 눌러 직접 지정해 볼 수 있습니다.'}</p>
  ${D.map ? '<p class="note">자료: 필지는 브이월드 연속지적도와 토지특성(대장 면적·지목·공시지가·용도지역·도로접면), 건축물은 GIS건물통합정보이고, 공동주택은 건축물대장 표제부로 바꿔 세대수를 넣습니다(용도 옆 \'대장\' 표시).</p>' : ''}
  <p class="note">노후·불량 판정은 인천 정비조례 제3조②를 사용승인 연도에 적용한 값입니다.${D.real ? ' 공동주택의 지하층이 주거용인지는 대장만으로 알 수 없어 RC 30년으로 보고, 지하층이 있으면 근거에 표시합니다. 호수밀도의 "세대수가 가장 많은 층"은 세대수 ÷ 지상층수로 어림합니다.' : ''}</p>`;
  side.querySelectorAll('button.acc').forEach(bt => bt.onclick = () => cycleAccess(+bt.dataset.pid));
  side.querySelectorAll('[data-gm]').forEach(b => b.onclick = () => { P.ghostMode = b.dataset.gm; P.ghostIn = P.ghostMode !== 'out'; saveP(); render(); });
  document.getElementById('copyTbl').onclick = async () => {
    const head = '지번\t용도\t구조\t사용승인\t연면적\t판정\t근거\t접도\t허가';
    const body = a.bs.map(b => { const p = b.pid != null ? D.parcels[b.pid] : null; return [p ? p.jibun : '', b.use, b.struct, b.year || '', b.floor, b.unknown ? '확인' : b.old ? '노후' : '비노후', b.why, !p || p.access == null ? '미확인' : p.access ? '충족' : '미충족', b.lic].join('\t'); }).join('\n');
    try { await navigator.clipboard.writeText(head + '\n' + body); toast('표를 복사했습니다'); } catch (e) { toast('복사가 막혀 있습니다. 표를 직접 선택해 복사해 주세요'); }
  };
}
const PILL = { ok: ['ok', '충족'], bad: ['bad', '미충족'], unk: ['warn', '확인 필요'] };
function renderReq(a) {
  const j = judge(a, P.type);
  const item = o => `<div class="chk ${o.req ? 'req' : ''}"><span class="pill ${PILL[o.st][0]}">${PILL[o.st][1]}</span><div><div class="t">${o.t}</div><div class="s">${o.basis || ''}${o.s ? ' · ' + o.s : ''}</div></div><div class="num">${o.v}</div></div>`;
  const list = j.items.map(o => o.group ? `<div class="chk"><span class="pill ${PILL[o.st][0]}">${PILL[o.st][1]}</span><div style="grid-column:2/4"><div class="t">${o.t}</div><div class="checks" style="margin-top:6px">${o.items.map(item).join('')}</div></div></div>` : item(o)).join('');
  const keys = D.keys.filter(k => analyze(k));
  const cmp = keys.map(k => { const x = analyze(k), jj = judge(x, P.type); return `<tr class="${k === S.region ? 'hl' : ''}"><td>${esc(D.regions[k].name)}</td><td class="r">${fmt(x.area)}</td><td class="r">${oldText(x)}</td><td class="r">${pct(x.oldFaRatio)}</td><td class="r">${pct(x.smallRatio)}</td><td class="r">${accText(x)}</td><td class="r">${x.density.toFixed(1)}</td><td>${jj.pass === true ? '<span class="pill ok">입안 가능</span>' : jj.pass === false ? '<span class="pill bad">요건 미달</span>' : '<span class="pill warn">확인 필요</span>'}</td></tr>`; }).join('');
  const temp = JOB.active && JOB.zone === S.region;
  const vtxt = temp ? '자료를 채우는 중이라 아래 판정은 임시입니다 — 끝나면 확정됩니다' : j.pass === true ? '인천 정비조례 제5조 요건을 충족합니다' : j.pass === false ? '요건을 충족하지 못합니다 — 아래 미충족 항목을 보세요' : '확인이 필요한 항목이 있어 판정을 끝내지 못했습니다';
  side.innerHTML = `<h2>${regName()} 입안대상지역 요건판정</h2>
  <div class="field" style="max-width:260px;margin-bottom:10px"><label for="ptype">사업 유형</label><select id="ptype"><option value="redev">재개발사업</option><option value="improve">주거환경개선사업</option></select></div>
  <div class="verdict ${temp ? 'warn' : j.pass === true ? 'ok' : j.pass === false ? 'bad' : 'warn'}">${vtxt}</div>
  <div class="checks">${list}</div>
  <h3>구역 확장 한도 (영 별표1 제5호, 정비조례 제5조③)</h3>
  <p style="margin:0">도시계획위원회 심의로 입안대상지역 면적의 ${Math.round(RULES.expansion * 100)}%까지 확장할 수 있습니다. 이 안 기준 상한은 <b style="font-family:var(--f-mono)">${fmt(a.area * RULES.expansion)}㎡</b> (추가 ${fmt(a.area * (RULES.expansion - 1))}㎡)입니다.</p>
  <h3>구역계 안별 비교</h3>
  <div class="tscroll"><table><thead><tr><th>안</th><th class="r">면적㎡</th><th class="r">노후(동)</th><th class="r">노후(연면적)</th><th class="r">과소필지</th><th class="r">접도율</th><th class="r">호수밀도</th><th>판정</th></tr></thead><tbody>${cmp}</tbody></table></div>
  <p class="note">정비구역 지정은 조례 요건 외에 2030 정비기본계획(구역 경계설정 기준 등)도 따릅니다(제5조④). 기본계획 변경 고시문 대조 전입니다.</p>`;
  const sel = document.getElementById('ptype'); sel.value = P.type; sel.onchange = () => { P.type = sel.value; saveP(); render(); };
}
const field = (id, label, val, unit, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}" ${attrs}><span class="u">${unit}</span></div>`;
function bindNum(ids) { ids.forEach(id => { const e = document.getElementById(id); if (!e) return; e.addEventListener('change', () => { const v = parseFloat(e.value); if (!isNaN(v)) { P[id] = v; saveP(); render(); } }); }); }
function renderPlan(a) {
  const pl = plan(a), far = pl.far;
  const pressBadge = RULES.status.far === 'press' ? '<span class="badge p">고시문 대조 필요</span>' : '<span class="badge v">원문 대조</span>';
  const inf = pl.infra, prop = !!inf;
  const ip = pl.infraPct;
  side.innerHTML = `<h2>${regName()} 정비계획 (토지이용·밀도)</h2>
  ${D.map ? infraSection(a, pl) : ''}
  <div class="form">
    <div class="field"><label for="zone">용도지역(계획)</label><select id="zone"><option>제2종일반주거지역</option><option>제3종일반주거지역</option></select><span class="u">현황: ${Object.entries(a.zoneArea).map(([z, v]) => esc(z.replace('일반주거지역', '')) + ' ' + fmt(v) + '㎡').join(', ')}</span></div>
    ${prop ? '' : field('infraRatio', '정비기반시설 비율(도로·공원·학교 등)', P.infraRatio, D.map ? '구역 면적 대비 % · 직접 입력' : '구역 면적 대비 %, 예시 가정', 'min=0 max=60 step=1')}
    <div class="field"><label for="farMode">적용 용적률</label><select id="farMode"><option value="base">기준용적률 ${far.base}%</option><option value="allowed">허용용적률 ${far.allowed}%</option><option value="max">상한용적률 ${far.max}%</option><option value="custom">직접 입력</option></select><span class="u">2030 기본계획 · ${pressBadge}</span></div>
    ${P.farMode === 'custom' ? field('farCustom', '계획 용적률', P.farCustom, `% (상한 ${far.max}% 이내로 제한)`) : ''}
  </div>
  <h3>토지이용계획표 (개략)</h3>
  <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">면적㎡</th><th class="r">비율</th></tr></thead><tbody>
    <tr><td>정비구역</td><td class="r">${fmt(a.area)}</td><td class="r">100.0%</td></tr>
    <tr><td>공동주택 획지(대지)</td><td class="r">${fmt(pl.site)}</td><td class="r">${(100 - ip).toFixed(1)}%</td></tr>
    <tr><td>정비기반시설 계${prop ? ' (제안)' : ''}</td><td class="r">${fmt(a.area * ip / 100)}</td><td class="r">${ip.toFixed(1)}%</td></tr>
    ${prop ? `<tr><td>&nbsp;└ 도로 확폭</td><td class="r">${fmt(inf.roadArea)}</td><td class="r">${(inf.roadArea / a.area * 100).toFixed(1)}%</td></tr>
    ${P.keepInnerRoads ? `<tr><td>&nbsp;└ 구역 안 기존 도로 존치</td><td class="r">${fmt(inf.innerArea)}</td><td class="r">${(inf.innerArea / a.area * 100).toFixed(1)}%</td></tr>` : ''}
    <tr><td>&nbsp;└ 공원·녹지</td><td class="r">${fmt(inf.parkArea)}</td><td class="r">${(inf.parkArea / a.area * 100).toFixed(1)}%</td></tr>
    ${inf.schoolArea ? `<tr><td>&nbsp;└ 학교용지</td><td class="r">${fmt(inf.schoolArea)}</td><td class="r">${(inf.schoolArea / a.area * 100).toFixed(1)}%</td></tr>` : ''}
    ${inf.other ? `<tr><td>&nbsp;└ 기타(공공청사·주차장·공공공지 등)</td><td class="r">${fmt(inf.other)}</td><td class="r">${(inf.other / a.area * 100).toFixed(1)}%</td></tr>` : ''}` : ''}
  </tbody></table></div>
  <h3>건축물 밀도계획</h3>
  <div class="kpis">
    ${kpi('계획 용적률', pl.farUse + '%', `${P.zone.replace('일반주거지역', '')} · 기준 ${far.base} / 허용 ${far.allowed} / 상한 ${far.max}`)}
    ${kpi('지상 연면적(용적률 산정)', fmt(pl.gfa) + '㎡', `획지 ${fmt(pl.site)}㎡ × ${pl.farUse}%`)}
    ${kpi('국민주택규모 의무(참고)', '증가분의 ' + RULES.natHousing.redevelopment * 100 + '%', '법적상한까지 완화 시 · 정비조례 제27조')}
  </div>
  <p class="note">허용용적률은 인센티브 항목을, 상한용적률은 공공시설 부지 제공 등 공공기여를 전제로 합니다. 이 화면은 인센티브 배점과 공공기여 산식을 아직 계산하지 않고 단계만 고릅니다.</p>`;
  const z = document.getElementById('zone'); z.value = P.zone; z.onchange = () => { P.zone = z.value; saveP(); render(); };
  const f = document.getElementById('farMode'); f.value = P.farMode; f.onchange = () => { P.farMode = f.value; saveP(); render(); };
  bindNum(['infraRatio', 'farCustom', 'sideRoadW', 'schoolArea', 'otherInfra']);
  bindInfra();
}
function infraSection(a, pl) {
  const inf = pl.infra, manual = P.infraMode === 'manual';
  const head = `<div class="infra-head"><h3 style="margin:0">정비기반시설 제안</h3>
    <div class="seg" role="group" aria-label="기반시설 비율"><button type="button" data-im="proposal" aria-pressed="${!manual}">제안값 사용</button><button type="button" data-im="manual" aria-pressed="${manual}">비율 직접 입력</button></div></div>`;
  if (manual) return head + '<p class="hint">제안값 대신 아래 "정비기반시설 비율"에 넣은 값으로 계산합니다.</p>';
  if (!inf) return head;
  const lo = INFRA.loading[a.key];
  const rows = [];
  inf.items.forEach(it => rows.push(it.kind === 'manual' ? ['직접 지정한 도로', it.area, '구역계 자르기로 도로(기반시설)로 지정한 조각 — 지도에서 누르면 취소'] : [`${it.kind === 'entry' ? '진입도로' : '주변 도로'} 확폭 · ${esc(it.jibun)}`, it.area, it.kind === 'entry' ? `주택건설기준 등에 관한 규정 제25조① — ${fmt(pl.units)}세대 → 폭 ${it.to}m 이상. 현황 약 ${it.from}m(필지 모양으로 추정)` : `제안: 주변 도로 최소 ${it.to}m(소방·통행). 현황 약 ${it.from}m`]));
  if (!inf.items.length) rows.push(['도로 확폭', 0, !inf.roadsReady ? (lo ? '경계 도로를 불러오는 중…' : '경계 도로 조회 전') : inf.edge.length ? `경계 도로가 이미 기준 폭 이상(진입도로 ${inf.W}m, 주변 ${inf.sideW}m)` : '구역 경계에 닿은 도로 필지를 찾지 못함 — 진입도로 위치 확인 필요']);
  rows.push(['공원·녹지', inf.parkArea, inf.legal ? `도시공원 및 녹지 등에 관한 법률 시행규칙 별표2 제4호 — 정비계획 5만㎡ 이상: 세대당 2㎡(${fmt(pl.units * 2)}㎡)와 부지 5%(${fmt(a.area * 0.05)}㎡) 중 큰 면적 ${fmt(inf.parkNeed)}㎡` + (inf.parkArea < inf.parkNeed * 0.95 ? ' · <b class="warn">구역 경계에 걸려 모자람 — 위치를 옮기세요</b>' : '') : (P.parkMode === 'always' ? `5만㎡ 미만이라 법정 의무는 없으나 부지 5%로 제안(${fmt(inf.parkNeed)}㎡)` : `구역 ${fmt(a.area)}㎡ < 5만㎡ — 별표2 의무 없음. 2030 인천 정비기본계획 공원·녹지 기준은 고시문 대조 필요`)]);
  if (num(P.schoolArea)) rows.push(['학교용지', inf.schoolArea, '교육청 협의로 정함(입력값)']);
  if (inf.other) rows.push(['기타 시설', inf.other, '공공청사·주차장·공공공지 등(입력값)']);
  if (inf.relAll.length || inf.relManual) {
    const chips = inf.relAll.map(p => `<label class="rel-chip"><input type="checkbox" data-rel="${esc(p.pnu)}" ${inf.rel.includes(p) ? 'checked' : ''}> ${esc(p.jibun)} (${fmt((p.base ?? p.area))}㎡)</label>`).join(' ');
    rows.push([`종교용지(존치·대체) ${inf.rel.length}필지`, inf.relArea, `구역 안 종교시설(교회 등) 부지. 법정 의무는 없으나 실무상 정비계획에서 존치하거나 구역 안 대체부지로 잡아 공동주택 획지에서 뺍니다. 근생 건물의 한 층을 쓰는 교회는 상가 분양·보상 대상이라 넣지 않습니다.<br>${chips || '자동으로 찾은 필지 없음'}${inf.relManual ? ` · <b>면적 직접 입력(${fmt(inf.relArea)}㎡)</b>` : ''}`]);
  }
  rows.push([`구역 안 기존 도로 ${inf.inner.length}필지`, inf.innerArea, P.keepInnerRoads ? '존치하여 기반시설로 셈' : '폐도하여 획지에 넣음(존치하려면 아래에서 선택)']);
  return head + `
  <p class="hint">지도의 색 구분 <b>기반시설</b>에 위치를 그렸습니다. 공원·학교는 아래 버튼을 누른 뒤 지도에서 자리를 누르면 옮겨집니다.</p>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">면적㎡</th><th>근거·설명</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td class="r">${fmt(r[1])}</td><td class="wrap">${r[2]}</td></tr>`).join('')}
  <tr class="sum"><td><b>제안 계${inf.relArea ? '<br><span class="u">(기반시설 + 종교용지)</span>' : ''}</b></td><td class="r"><b>${fmt(inf.total)}</b></td><td>구역의 ${(inf.ratio * 100).toFixed(1)}%</td></tr></tbody></table></div>
  <div class="zk-btns" style="margin-top:8px">
    <button type="button" class="btn ghost sm" id="placePark">공원 위치 지도에서 정하기</button>
    ${num(P.schoolArea) ? '<button type="button" class="btn ghost sm" id="placeSchool">학교 위치 지도에서 정하기</button>' : ''}
    <button type="button" class="btn ghost sm" id="refetchRoads">경계 도로 다시 조회</button>
  </div>
  <div class="form" style="margin-top:8px">
    ${field('sideRoadW', '주변 도로 최소 폭(제안)', P.sideRoadW, 'm · 진입도로는 세대수 기준으로 자동', 'step=0.5')}
    ${field('schoolArea', '학교용지 면적', P.schoolArea, '㎡ · 교육청 협의 전이면 0', 'step=100')}
    ${field('otherInfra', '기타 기반시설 면적', P.otherInfra, '㎡ · 공공청사·주차장·공공공지 등', 'step=100')}
    <div class="field"><label for="relArea">종교용지 면적</label><input id="relArea" inputmode="decimal" value="${inf.relManual ? esc(String(Z.zones[a.key].infra.relArea)) : ''}" placeholder="자동 ${fmt(inf.relLand)}㎡"><span class="u">㎡ · 비우면 위 필지 대지면적 합. 대체부지 협의 면적이 있으면 넣으세요</span></div>
    <div class="field"><label for="parkMode">5만㎡ 미만일 때 공원·녹지</label><select id="parkMode"><option value="legal">법정 의무만(없으면 0)</option><option value="always">부지 5% 제안</option></select></div>
  </div>
  <label class="zk-opts"><input type="checkbox" id="keepInner" ${P.keepInnerRoads ? 'checked' : ''}> 구역 안 기존 도로를 존치(기반시설로 셈)</label>
  <p class="note">도로 폭은 연속지적도 필지 모양으로 어림한 값이라 실제 측량 폭과 다를 수 있습니다. 확폭 부분은 구역 안쪽으로만 잡았습니다. 위치·형태는 정비계획 입안 때 교통·공원 담당 부서 협의와 도시계획위원회 심의로 정합니다.</p>`;
}
function bindInfra() {
  side.querySelectorAll('[data-im]').forEach(b => b.onclick = () => { P.infraMode = b.dataset.im; saveP(); render(); });
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  on('placePark', () => { S.placing = 'park'; $id('lmap').classList.add('picking'); toast('지도에서 공원을 둘 자리를 누르세요'); });
  on('placeSchool', () => { S.placing = 'school'; $id('lmap').classList.add('picking'); toast('지도에서 학교용지를 둘 자리를 누르세요'); });
  on('refetchRoads', () => { const z = Z.zones[S.region]; if (z) { delete z.roads; saveZ(); INFRA.memo = {}; INFRA.fetchRoads(S.region); render(); } });
  const pm = document.getElementById('parkMode'); if (pm) { pm.value = P.parkMode; pm.onchange = () => { P.parkMode = pm.value; saveP(); INFRA.memo = {}; render(); }; }
  const zi = () => { const z = Z.zones[S.region]; if (!z) return null; z.infra = z.infra || {}; return z.infra; };
  side.querySelectorAll('[data-rel]').forEach(cb => cb.onchange = () => { const inf = zi(); if (!inf) return; inf.relOff = inf.relOff || {}; if (cb.checked) delete inf.relOff[cb.dataset.rel]; else inf.relOff[cb.dataset.rel] = true; saveZ(); INFRA.memo = {}; render(); });
  const ra = document.getElementById('relArea'); if (ra) ra.onchange = () => { const inf = zi(); if (!inf) return; const v = ra.value.trim(); if (v === '') delete inf.relArea; else inf.relArea = num(v); saveZ(); INFRA.memo = {}; render(); };
  const ki = document.getElementById('keepInner'); if (ki) ki.onchange = () => { P.keepInnerRoads = ki.checked; saveP(); INFRA.memo = {}; render(); };
}
function renderArch(a) {
  const pl = plan(a);
  side.innerHTML = `<h2>${regName()} 개략 건축계획</h2>
  <div class="form">
    ${field('bcr', '건폐율(계획)', P.bcr, '% · 예시 가정')}
    ${field('coreUnits', '주동 1개 층 세대수', P.coreUnits, '세대/층')}
    ${field('supplyFactor', '전용 → 연면적 환산계수', P.supplyFactor, '공용·주민공동시설 포함, 예시 가정', 'step=0.01')}
    ${field('rentalRatio', '임대주택 비율', P.rentalRatio, '% of 세대수 · 예시 가정')}
    ${field('mix59', '59㎡형 비율', P.mix59, '%')}
    ${field('mix84', '84㎡형 비율', P.mix84, '%')}
    ${field('mix114', '114㎡형 비율', P.mix114, '%')}
  </div>
  <h3>개략 규모</h3>
  <div class="kpis">
    ${kpi('총 세대수', fmt(pl.units) + '세대', `연면적 ${fmt(pl.gfa)}㎡ ÷ 세대당 ${pl.perUnit.toFixed(1)}㎡`)}
    ${kpi('주동', pl.towers + '개동', `평균 ${pl.floorsTower}층 · 높이 약 ${(pl.floorsTower * 2.9).toFixed(0)}m`)}
    ${kpi('건축면적 한도', fmt(pl.footMax) + '㎡', `획지 × ${P.bcr}%`)}
    ${kpi('지하 연면적(주차 등)', fmt(pl.basement) + '㎡', `지상 대비 ${P.basementRatio}%`)}
  </div>
  <h3>세대 구성</h3>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">세대</th></tr></thead><tbody>
    <tr><td>59㎡형</td><td class="r">${fmt(pl.n59)}</td></tr><tr><td>84㎡형</td><td class="r">${fmt(pl.n84)}</td></tr><tr><td>114㎡형</td><td class="r">${fmt(pl.n114)}</td></tr>
    <tr><td>조합원 분양(토지등소유자 추정 ${fmt(a.owners)}명)</td><td class="r">${fmt(pl.members)}</td></tr>
    <tr><td>일반분양</td><td class="r">${fmt(pl.general)}</td></tr>
    <tr><td>임대주택</td><td class="r">${fmt(pl.rental)}</td></tr>
  </tbody></table></div>
  <p class="note">도면의 <b>개략 배치</b>는 주동을 구역계 안에 격자로 놓아 봅니다(인동간격 높이×0.8 개략, 배치된 주동 ${S.placed ?? '–'}개동). 일조·높이·학교예정부지·문화재 위치는 /arch 단계에서 다룹니다.</p>`;
  bindNum(['bcr', 'coreUnits', 'supplyFactor', 'rentalRatio', 'mix59', 'mix84', 'mix114']);
}
function renderBiz(a) {
  const pl = plan(a), b = biz(a, pl), rp = b.ratio * 100;
  const tone = rp >= 100 ? 'ok' : rp >= 80 ? 'warn' : 'bad';
  const priorFields = D.real
    ? `<div class="field"><label for="priorMode">종전 토지 평가 방식</label><select id="priorMode"><option value="jiga">공시지가 × 배율 (조서 공시지가)</option><option value="unit">단가 직접 입력</option></select><span class="u">조서 공시지가 합 ${won(a.priorLand)}</span></div>
       ${P.priorMode === 'jiga' ? field('priorMult', '공시지가 배율', P.priorMult, '배 (감정평가 추정)', 'step=0.05') : field('landPrice', '종전 토지 평가단가', P.landPrice, '만원/㎡')}`
    : field('landPrice', '종전 토지 평가단가', P.landPrice, '만원/㎡ (감정평가 추정)');
  side.innerHTML = `<h2>${regName()} 개략 사업성</h2>
  <div class="flow">
    <div class="kpi"><div class="l">추정 비례율</div><div class="big" style="color:var(--${tone})">${rp.toFixed(1)}%</div><div class="f">(총수입 − 총사업비) ÷ 종전자산</div></div>
    <div class="kpi"><div class="l">조합원 평균 분담금 (84㎡형)</div><div class="big">${won(b.contrib)}</div><div class="f">84㎡형 조합원분양가 ${won(b.price84)} − 평균 권리가액 ${won(b.right)}</div></div>
  </div>
  <h3>가정값 <span class="badge a">예시 — 직접 바꿔 보세요</span></h3>
  <div class="form">
    ${priorFields}
    ${field('bldValue', '종전 건물 평가단가', P.bldValue, '만원/㎡ (연면적 기준)')}
    ${field('memberPrice', '조합원 분양가', P.memberPrice, '만원/평(공급)')}
    ${field('salePrice', '일반 분양가', P.salePrice, '만원/평(공급)')}
    ${field('rentalPrice', '임대주택 인수가', P.rentalPrice, '만원/세대')}
    ${field('constCost', '공사비', P.constCost, '만원/평(지상+지하 연면적)')}
    ${field('basementRatio', '지하 연면적 비율', P.basementRatio, '% of 지상 연면적')}
    ${field('etcRatio', '기타 사업비', P.etcRatio, '% of 공사비 (설계·감리·이주·금융·보상 등)')}
  </div>
  <h3>수입·지출 집계</h3>
  <div class="tscroll"><table class="ledger"><tbody>
    <tr><td>조합원 분양 ${fmt(pl.members)}세대 × 평균 ${b.avgPy.toFixed(1)}평</td><td class="r">${won(b.incMember)}</td></tr>
    <tr><td>일반 분양 ${fmt(pl.general)}세대</td><td class="r">${won(b.incGeneral)}</td></tr>
    <tr><td>임대주택 인수 ${fmt(pl.rental)}세대</td><td class="r">${won(b.incRental)}</td></tr>
    <tr class="sum"><td>총수입</td><td class="r">${won(b.income)}</td></tr>
    <tr><td>공사비 (연면적 ${fmt(pl.gfa + pl.basement)}㎡)</td><td class="r">${won(b.cost)}</td></tr>
    <tr><td>기타 사업비</td><td class="r">${won(b.etc)}</td></tr>
    <tr class="sum"><td>총사업비</td><td class="r">${won(b.expense)}</td></tr>
    <tr><td>종전자산 총액 (토지 ${b.useJiga ? '공시지가×' + P.priorMult : fmt(a.landArea) + '㎡×단가'} + 건물 ${fmt(a.fa)}㎡)</td><td class="r">${won(b.prior)}</td></tr>
    <tr class="sum"><td>개발이익 (총수입 − 총사업비)</td><td class="r">${won(b.income - b.expense)}</td></tr>
  </tbody></table></div>
  <p class="note">조합원 1인당 평균 종전자산 ${won(b.avgPrior)} × 비례율 ${rp.toFixed(1)}% = 평균 권리가액 ${won(b.right)}. 상가·부대복리시설 수입, 국공유지 처리, 세입자 손실보상 세부는 넣지 않은 개략 산정입니다. 세부 사업성은 사업성 검토 화면의 5~7단계에서 다룹니다.</p>`;
  const pm = document.getElementById('priorMode'); if (pm) { pm.value = P.priorMode; pm.onchange = () => { P.priorMode = pm.value; saveP(); render(); }; }
  bindNum(['landPrice', 'priorMult', 'bldValue', 'memberPrice', 'salePrice', 'rentalPrice', 'constCost', 'basementRatio', 'etcRatio']);
}
function renderRules() {
  const v = '<span class="badge v">조례 원문 대조</span>', p = '<span class="badge p">고시문 대조 필요</span>';
  const r = RULES.redevelopment, im = RULES.improvement, o = RULES.obsolete;
  side.innerHTML = `<h2>적용 기준 ${J ? '<span class="badge v">rules/incheon.json</span>' : '<span class="badge p">기본값(기준 파일 읽기 실패)</span>'}</h2>
  <dl class="rules">
    <dt>재개발 입안대상지역 ${v}</dt><dd>면적 ${fmt(r.minArea)}㎡ 이상 + 노후·불량건축물 수 ${r.obsoleteCount * 100}% 이상 + (주택접도율 ${r.road * 100}% 이하 / 과소필지 ${r.small * 100}% 이상 / 호수밀도 ${r.density} 이상 / 노후 연면적 ${r.obsoleteFloor * 100}% 이상) 중 하나 — 인천 정비조례 제5조①2</dd>
    <dt>주거환경개선 입안대상지역 ${v}</dt><dd>노후 ${im.obsoleteCount * 100}% 이상 + (접도율 ${im.road * 100}% 이하 / 과소·부정형·세장형 ${im.small * 100}% 이상 / 호수밀도 ${im.density} 이상) 중 하나 — 제5조①1</dd>
    <dt>노후·불량건축물 연한 ${v}</dt><dd>RC·강구조 공동주택 ${o.rcApt}년(주거용 지하층 있으면 ${o.otherApt}년), 그 밖의 공동주택 ${o.otherApt}년, RC 건축물 ${o.rcNonApt}년(단독주택 제외), 그 밖의 건축물 ${o.other}년 — 제3조②</dd>
    <dt>과소필지 ${v}</dt><dd>건축조례 제28조① 분할제한면적 미만. 주거지역 ${RULES.smallParcel['주거지역']}㎡(2024.3.28. 개정, 종전 90㎡), 상업·공업 150㎡, 녹지 200㎡ — 정비조례 제2조5호</dd>
    <dt>호수밀도 ${v}</dt><dd>1만㎡당 동수. 공동주택은 세대수가 가장 많은 층의 세대수, 단독·다가구→다세대 전환은 전환 전 동수, 비주거는 건축면적 ${RULES.nonResM2PerUnit}㎡당 1동(절사), 신발생무허가 제외 — 제2조6호</dd>
    <dt>주택접도율 ${v}</dt><dd>폭 ${RULES.roadAccess.width}m 이상 도로에 길이 ${RULES.roadAccess.frontage}m 이상 접한 대지의 건축물 수 ÷ 건축물 총수. 연장 35m 이상 막다른 도로는 폭 6m — 제2조7호</dd>
    <dt>구역 확장 ${v}</dt><dd>도시계획위원회 심의로 입안대상지역 면적의 ${Math.round(RULES.expansion * 100)}% 이하 — 제5조③</dd>
    <dt>입안 요청·제안 동의 ${v}</dt><dd>입안 요청 토지등소유자 30% 이상(제8조의2), 입안 제안 50% 이상 및 토지면적 1/2 이상(제9조)</dd>
    <dt>구청장 직접 입안 동의 ${p}</dt><dd>토지등소유자 1/2 이상 및 토지면적 1/2 이상(종전 2/3) — 2030 정비기본계획 변경(2026.4.27.)</dd>
    <dt>용적률 체계 ${RULES.status.far === 'press' ? p : v}</dt><dd>2종 기준 ${RULES.far['제2종일반주거지역'].base} / 허용 ${RULES.far['제2종일반주거지역'].allowed} / 상한 ${RULES.far['제2종일반주거지역'].max}, 3종 기준 ${RULES.far['제3종일반주거지역'].base} / 허용 ${RULES.far['제3종일반주거지역'].allowed} / 상한 ${RULES.far['제3종일반주거지역'].max}</dd>
    <dt>국민주택규모 건설비율 ${v}</dt><dd>법적상한까지 완화 시 증가 용적률의 재개발 ${RULES.natHousing.redevelopment * 100}%, 재건축 30% — 제27조</dd>
  </dl>
  <p class="note">근거: 인천광역시 도시 및 주거환경정비 조례(2025.12.31. 시행, 제7686호), 인천광역시 건축 조례(2026.7.13. 시행, 제7764호). 국가법령정보센터 원문과 2026.10.30. 대조.</p>`;
}

/* ===== 구역계 만들기 도구 (계산은 ../js/zonekit.js — 사업성 검토와 같은 코드) ===== */
const ZK = {
  picking: false,
  rough: {},   // 안별 '대략 그린 범위' (필지에 맞추기 전 선, 점선으로 비교용)
  opts() { return { fillHoles: $id('zkFill').checked, bridge: $id('zkBridge').checked, threshold: num($id('zkTh').value) || 0.5 }; },
  base() { return $id('zkBase').value.trim(); },
  list() { return $id('zkList').value.split(/[\n,;\t]+/); },
  msg(h) { $id('zkMsg').innerHTML = h; },
  say(t) { $id('zkMsg').textContent = t; if (!$id('zkTools').open) statusMsg(t); },
  ready() {
    if (!LM) return false;
    if (!VWorld.enabled) { this.say('브이월드 인증키가 있어야 합니다.'); return false; }
    if (busy || this.working) { toast('다른 작업을 하는 중입니다. 끝난 뒤 눌러 주세요'); return false; }
    return true;
  },
  setPicking(on) {
    this.picking = on;
    const b = $id('pickBtn'); mtLabel(b, on ? '넣고 빼기 끝내기' : '필지 넣고 빼기'); b.classList.toggle('on', on);
    $id('lmap').classList.toggle('picking', on);
    if (!on && LM) LM.closePopup();
    if (on) toast('지도에서 필지를 누르면 넣을지 뺄지 고를 수 있습니다');
    drawLeaflet();
  },
  // 필지 클릭: 구역 밖이면 넣고, 반 이상 구역 안이면 뺌. 연달아 고를 수 있게 판정은 마지막 클릭 2.5초 뒤에 새로 고침
  async pick(latlng) {
    const id = S.region, R = D.regions[id];
    this.say('필지 정보를 불러오는 중…');
    try {
      const f = await VWorld.parcelAt(latlng.lat, latlng.lng);
      if (!f) { this.say('이 위치에서 필지를 찾지 못했습니다.'); return; }
      const no = splitJibun(f.properties.jibun).no, fa = turf.area(f);
      // 작은 필지는 옆 필지를 잘못 누르기 쉬워서, 먼저 크게 확대해 보여 주고 다시 누르게 함
      if (fa < smallLimit('주거') && LM.getZoom() < 19) {
        LM.fitBounds(L.geoJSON(f).getBounds(), { padding: [80, 80], maxZoom: 21 });
        if (LM.getZoom() < 20) LM.setView(L.geoJSON(f).getBounds().getCenter(), 20);
        const mark = L.geoJSON(f, { style: { color: cssVar('--redline'), weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(LM);
        setTimeout(() => mark.remove(), 6000);
        this.msg(`<b>작은 필지(${esc(no)}, ${ZoneKit.f1(fa)}㎡)라 크게 확대했습니다.</b> 빨간 점선이 맞는 필지면 다시 눌러 주세요.`);
        return;
      }
      // 필지 정보와 함께 '넣기 / 빼기'를 고르게 함 (ZoneUI.choose — 사업성 검토와 같은 창)
      //  비율 대신 면적으로 판단: 구역 밖으로 1㎡ 넘게 나간 필지는 '걸침'으로 보고 넣기(나머지까지 채우기)도 할 수 있게
      const ratio = ZoneKit.inRatio(R.geojson, f), inA = fa * ratio, outA = fa - inA;
      const jm = splitJibun(f.properties.jibun).jimok;
      const full = R.geojson && outA <= 1, none = !R.geojson || inA <= 1;
      const now = !R.geojson ? '구역계가 아직 없습니다' : full ? '지금 구역 안' : none ? '지금 구역 밖'
        : `경계에 걸침 · 구역 안 ${ZoneKit.f1(inA)}㎡ / 밖 ${ZoneKit.f1(outA)}㎡ (${Math.round(ratio * 100)}% 편입)`;
      this.say(`${no} 필지를 골랐습니다. 넣을지 뺄지 선택해 주세요.`);
      const act = await ZoneUI.choose(LM, latlng, f, {
        title: `${no} ${jm} · ${ZoneKit.f1(fa)}㎡`, sub: now, color: cssVar('--accent'),
        canIn: !full, canOut: !none,
        inLabel: !none && !full ? '필지 전체 넣기' : '구역에 넣기', outLabel: !none && !full ? '걸친 부분까지 빼기' : '구역에서 빼기',
      });
      if (!act) { this.say(`${no} 필지: 그대로 두었습니다.`); return; }
      const add = act === 'in';
      const next = ZoneKit.toggle(D.regions[id].geojson, f, add);
      setZoneGeom(id, next, 2500, `${no} 필지 ${add ? '넣기' : '빼기'}`);
      this.say(`${no} 필지를 ${id}안 구역계${add ? '에 넣었습니다' : '에서 뺐습니다'}. 고치기를 멈추면 판정을 새로 고칩니다.`);
      return;

    } catch (e) { this.say('필지 조회에 실패했습니다: ' + e.message); }
  },
  // 고른 필지 → 구역계 (도로 잇기·갇힌 필지·자투리 정리) → 지금 안에 넣고 공부 조회
  async build(found, report, intro) {
    const id = S.region;
    if (!found.size) { this.say('구역에 넣을 필지가 없습니다.'); this.showReport(report); return; }
    const res = await ZoneKit.assemble(found, report, this.opts(), t => this.say(t));
    this.showReport(report);
    setZoneGeom(id, res.merged, 0, intro.replace(/ → $/, '') + '로 구역 만들기');
    fitZone(id);
    this.msg(ZoneKit.summary(report, res.merged, intro) + ' 이어서 필지·건축물을 불러옵니다.');
  },
  async fromJibuns() {
    if (!this.ready()) return;
    if (!ZoneKit.items(this.list()).length) { this.say('지번이 없습니다. 한 줄에 하나씩 넣어 주세요. 예: 387, 388-1, 산12'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요. 예: 인천광역시 미추홀구 용현동'); $id('zkBase').focus(); return; }
    const R = D.regions[S.region];
    if (R.geojson && !confirm(`${R.name} 구역계를 지번 목록의 필지로 바꿀까요?`)) return;
    this.working = true;
    try {
      delete this.rough[S.region];
      const { found, report, count } = await ZoneKit.findByJibuns(this.list(), this.base(), t => this.say(t));
      await this.build(found, report, `지번 ${count}개 → `);
    } catch (e) { this.say('실패했습니다: ' + e.message); } finally { this.working = false; }
  },
  async snap() {
    if (!this.ready()) return;
    const id = S.region, R = D.regions[id];
    if (!R.geojson) { this.say('먼저 구역계 그리기로 범위를 대략 그려 주세요.'); return; }
    this.working = true;
    try {
      const rough = JSON.parse(JSON.stringify(R.geojson));
      const r = await ZoneKit.snapPick(rough, this.opts().threshold, t => this.say(t));
      this.rough[id] = rough;
      await this.build(r.found, r.report, `그린 범위에 걸친 필지 ${r.report.length}개 → `);
    } catch (e) { this.say('필지를 불러오지 못했습니다: ' + e.message); } finally { this.working = false; }
  },
  async fromAnchors() {
    if (!this.ready()) return;
    const target = num($id('zkTarget').value);
    if (!ZoneKit.items(this.list()).length || !(target > 0)) { this.say('위치 지번(한 줄에 하나)과 목표 면적(㎡)을 넣어 주세요.'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요.'); return; }
    this.working = true;
    try {
      const a = await ZoneKit.roughFromAnchors(this.list(), this.base(), target, this.opts().threshold, t => this.say(t));
      if (!a.rough) { this.say('위치 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'); return; }
      const r = await ZoneKit.snapPick(a.rough, this.opts().threshold, t => this.say(t));
      this.rough[S.region] = a.rough;
      await this.build(r.found, r.report, `위치 지번 ${a.pts.length}개를 감싼 범위를 ${Math.round(a.d)}m 넓혀 목표 ${ZoneKit.f1(target)}㎡에 맞춤 → `);
      if (a.miss.length) $id('zkMsg').insertAdjacentHTML('beforeend', `<br>못 찾은 지번: ${a.miss.map(esc).join(', ')}`);
    } catch (e) { this.say('실패했습니다: ' + e.message); } finally { this.working = false; }
  },
  // 손으로 그리거나 불러온 구역계가 지적 경계와 많이 어긋나면 알림
  async checkFit(gj, what) {
    const r = await ZoneKit.fit(gj);
    if (!r) return;
    $id('zkTools').open = true;
    this.msg(`<b class="warn">${esc(what)}가 지적도 필지 경계와 맞지 않습니다.</b> 필지를 가로지르는 곳 ${r.cut}필지, 어긋난 면적 약 ${ZoneKit.f1(r.dev)}㎡(구역의 ${r.pct.toFixed(1)}%)`
      + (r.cutList.length ? ` · 예: ${r.cutList.map(esc).join(', ')}` : '') + '. <b>그린 구역을 필지에 맞추기</b>를 누르면 필지 경계로 정리합니다.');
  },
  showReport(report) {
    this.report = report;
    const rows = ZoneKit.reportRows(report);
    if (!rows.length) { $id('zkReport').innerHTML = ''; return; }
    const cls = r => ({ good: 'ok', auto: 'info', warn: 'bad' }[ZoneKit.reportClass(r)] || '');
    $id('zkReport').innerHTML = `<div class="zk-head"><b>필지 대조표</b> ${rows.length}건 <button class="btn ghost sm" type="button" id="zkCopy">표 복사(엑셀 붙여넣기용)</button></div>
      <div class="tscroll"><table><thead><tr><th>입력</th><th>결과</th><th>필지</th><th>지목</th><th class="r">면적㎡</th><th>비고</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.input || '–')}</td><td><span class="pill ${cls(r.result)}">${esc(r.result)}</span></td><td>${esc(r.jibun)}</td><td>${esc(r.jimok)}</td><td class="r">${r.area === '' ? '' : ZoneKit.f1(r.area)}</td><td>${esc(r.note)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $id('zkCopy').onclick = async () => {
      const text = ['입력\t결과\t필지\t지목\t면적(㎡)\t비고', ...rows.map(r => [r.input, r.result, r.jibun, r.jimok, r.area, r.note].join('\t'))].join('\n');
      try { await navigator.clipboard.writeText(text); toast('대조표를 복사했습니다'); } catch (e) { toast('복사가 막혀 있습니다. 표를 직접 선택해 복사해 주세요'); }
    };
  },
  async readFile(f) {
    let rows;
    if (/\.xlsx?$/i.test(f.name)) {
      if (!window.XLSX) { this.say('엑셀 읽기 도구를 불러오지 못했습니다. CSV로 저장해 넣어 주세요.'); return; }
      const wb = XLSX.read(await f.arrayBuffer());
      rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
    } else {
      const buf = await f.arrayBuffer();
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
      rows = text.split(/\r?\n/).map(l => l.split(/[,\t]/).map(c => c.replace(/^"|"$/g, '').trim()));
    }
    const list = ZoneKit.jibunsFromRows(rows);
    $id('zkList').value = list.join('\n');
    this.say(`${f.name}에서 지번 ${list.length}개를 읽었습니다. 기준 동을 확인하고 지번으로 구역 만들기를 누르세요.`);
  },
  toggleFull() {
    const m = $id('mapWrap'); m.classList.toggle('full');
    document.body.style.overflow = m.classList.contains('full') ? 'hidden' : '';
    setTimeout(() => LM && LM.invalidateSize(), 60);
  },
};

/* ===== 구역계 자르기 (계산은 ZoneKit.split — 사업성 검토와 같은 코드) ===== */
const CUT = {
  active: false, pieces: null, layer: null, handler: null,
  start() {
    if (!LM) return;
    const R = D.regions[S.region];
    if (!R.geojson) { toast('먼저 구역계를 그려 주세요'); return; }
    if (drawH || editH) { toast('그리기·고치기를 먼저 마쳐 주세요'); return; }
    if (ZK.picking) ZK.setPicking(false);
    this.active = true; this.pieces = null;
    mtLabel($id('cutBtn'), '자르기 그만두기'); $id('cutBtn').classList.add('on');
    // 필지 꼭짓점·구역 경계에 붙는 선 긋기 (ZoneUI.lineTool — 공통)
    const id = S.region;
    this.handler = ZoneUI.lineTool(LM, {
      color: cssVar('--redline'),
      features: () => {
        const fs = [R.geojson];
        Object.keys(R.inArea || {}).forEach(k => { const p = D.byPnu.get(k); if (p && p.geom) fs.push({ type: 'Feature', properties: {}, geometry: p.geom }); });
        const z = Z.zones[id]; if (z && z.roads) z.roads.edge.forEach(r => fs.push({ type: 'Feature', properties: {}, geometry: r.geom }));
        const nb = this.near[id]; if (nb && nb.key === this.zoneKey(R)) nb.feats.forEach(f => fs.push(f));
        return fs;
      },
      say: t => statusMsg(`${id}안 자르기: ${t}`),
      onDone: line => this.onLine(line),
      onCancel: () => { this.stop(); statusMsg(''); },
    });
    this.loadNear(id);
  },
  // 맞은편 도로 필지까지 붙도록 구역 둘레 60m 안 필지 경계를 불러 둠(안별로 한 번)
  near: {},
  zoneKey(R) { return JSON.stringify(turf.bbox(R.geojson)); },
  async loadNear(id) {
    const R = D.regions[id], key = this.zoneKey(R);
    if (!VWorld.enabled || (this.near[id] && this.near[id].key === key)) return;
    const [x0, y0, x1, y1] = turf.bbox(R.geojson), e = 60 / 88000, n = 60 / 111000;
    try {
      statusMsg(`${id}안 자르기: 맞은편 필지 경계 불러오는 중…`);
      const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 20);
      this.near[id] = { key, feats: fs.map(f => ({ type: 'Feature', properties: {}, geometry: f.geometry })) };
      if (this.active && this.handler && S.region === id) { this.handler.reload(); statusMsg(`${id}안 자르기: 둘레 필지 ${fs.length}개 경계에도 붙습니다. 끝점(□)·중간점(△)·수직점(⊥)·근처점(⧗)`); }
    } catch (er) { if (this.active) statusMsg(`${id}안 자르기: 둘레 필지를 못 불러와 구역 안 필지에만 붙습니다.`, true); }
  },
  stop() {
    this.active = false; this.pieces = null;
    if (this.handler) { try { this.handler.stop(); } catch (e) { /* 무시 */ } this.handler = null; }
    if (this.layer) { this.layer.remove(); this.layer = null; }
    LM && LM.closePopup();
    const b = $id('cutBtn'); if (b) { mtLabel(b, '구역계 자르기'); b.classList.remove('on'); }
  },
  onLine(line) {
    const id = S.region, R = D.regions[id];
    const pieces = ZoneKit.split(R.geojson, line);
    this.handler = null;
    if (!pieces.length) { statusMsg(`${id}안: 선이 구역계를 끝까지 가로지르지 않아 나뉘지 않았습니다. 구역 밖에서 시작해 구역 밖에서 끝나게 그어 주세요.`, true); this.stop(); return; }
    this.pieces = pieces;
    const cols = ['--accent', '--warn', '--ok', '--small', '--old'];
    this.layer = L.featureGroup().addTo(LM);
    pieces.forEach((pc, i) => {
      const col = cssVar(cols[i % cols.length]);
      const lyr = L.geoJSON(pc, { style: { color: col, weight: 2, fillColor: col, fillOpacity: 0.35 } }).addTo(this.layer);
      lyr.bindTooltip(`조각 ${i + 1} · ${fmt(turf.area(pc))}㎡`, { permanent: pieces.length <= 6, direction: 'center', className: 'cut-tip' });
      lyr.on('click', ev => { L.DomEvent.stop(ev); this.choose(pc, i, ev.latlng); });
    });
    statusMsg(`${id}안: ${pieces.length}조각으로 나뉘었습니다. 뺄 조각이나 도로로 지정할 조각을 누르세요.`);
  },
  choose(pc, i, latlng) {
    const id = S.region, A = turf.area(pc);
    const box = document.createElement('div');
    box.className = 'pick-pop';
    box.innerHTML = `<div><b>조각 ${i + 1}</b> · ${ZoneKit.f1(A)}㎡</div>
      <div class="pick-btns" style="flex-direction:column"><button type="button" class="btn sm" data-act="out">이 조각 구역에서 빼기</button><button type="button" class="btn ghost sm" data-act="road">이 조각을 도로(기반시설)로 지정</button><button type="button" class="btn ghost sm" data-act="no">그만두기</button></div>`;
    L.popup({ closeButton: true, maxWidth: 260 }).setLatLng(latlng).setContent(box).openOn(LM);
    box.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act; LM.closePopup();
      if (act === 'no') { this.stop(); statusMsg(''); return; }
      if (act === 'out') {
        const next = ZoneKit.removePiece(D.regions[id].geojson, pc);
        this.stop();
        setZoneGeom(id, next, 0, `구역계 자르기(${ZoneKit.f1(A)}㎡ 빼기)`);
        statusMsg(`${id}안: ${ZoneKit.f1(A)}㎡를 구역에서 뺐습니다. 실행 취소로 되돌릴 수 있습니다.`);
      } else {
        const z = zoneOf(id); z.infra = z.infra || {}; z.infra.manualRoads = z.infra.manualRoads || [];
        z.infra.manualRoads.push(pc.geometry); saveZ(); INFRA.memo = {};
        this.stop();
        if (S.mode !== 'infra') { S.mode = 'infra'; syncMode(); }
        render();
        statusMsg(`${id}안: ${ZoneKit.f1(A)}㎡를 도로(기반시설)로 지정했습니다. 정비계획 탭 기반시설 제안표에 들어갑니다. 지도에서 누르면 지정을 취소합니다.`);
      }
    });
  },
};

/* ===== 이벤트 ===== */
function syncMode() { document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === S.mode)); }
document.querySelectorAll('nav.steps button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll('nav.steps button').forEach(x => x.setAttribute('aria-selected', x === b));
  if (S.tab === 'arch' && S.mode !== 'arch') { S.mode = 'arch'; syncMode(); }
  if (S.tab === 'plan' && D && D.map && S.mode !== 'infra') { S.mode = 'infra'; syncMode(); }
  render();
});
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; syncMode(); render(); });
const drawBtn = $id('drawBtn'), finBtn = $id('finishBtn'), canBtn = $id('cancelBtn');
function endDraw() { S.drawing = false; S.draft = []; drawBtn.hidden = false; finBtn.hidden = true; canBtn.hidden = true; }
drawBtn.onclick = () => {
  if (D.map) { startMapDraw(); return; }
  S.drawing = true; S.draft = []; drawBtn.hidden = true; finBtn.hidden = false; finBtn.disabled = true; canBtn.hidden = false; drawSvg(); toast('도면을 눌러 꼭짓점을 찍으세요');
};
canBtn.onclick = () => { endDraw(); drawSvg(); };
finBtn.onclick = () => {
  if (S.draft.length < 3) return;
  D.regions.C.pts = S.draft.slice();
  try { localStorage.setItem('jbs-urban-C-sample', JSON.stringify(D.regions.C.pts)); } catch (e) { /* 무시 */ }
  endDraw(); S.region = 'C'; syncRegionChips(); render(); toast('직접 그린 안으로 판정했습니다');
};
$id('editBtn').onclick = toggleEdit;
$id('cutBtn').onclick = () => (CUT.active ? (CUT.stop(), statusMsg('')) : CUT.start());
$id('undoBtn').onclick = () => undoZone(false);
$id('redoBtn').onclick = () => undoZone(true);
document.addEventListener('keydown', e => {
  if (!D || !D.map || drawH || editH) return;
  const t = e.target; if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undoZone(e.shiftKey); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); undoZone(true); }
});
$id('pickBtn').onclick = () => { if (!LM) return; if (drawH) { toast('그리기를 먼저 마쳐 주세요'); return; } ZK.setPicking(!ZK.picking); };
$id('zkJibunBtn').onclick = () => ZK.fromJibuns();
$id('zkSnapBtn').onclick = () => ZK.snap();
$id('zkAnchorBtn').onclick = () => ZK.fromAnchors();
$id('zkFileBtn').onclick = () => { $id('zkFile').value = ''; $id('zkFile').click(); };
$id('zkFile').onchange = e => { const f = e.target.files[0]; if (f) ZK.readFile(f); };
$id('fetchBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('먼저 구역계를 그려 주세요'); return; }
  if (busy) { toast('불러오는 중입니다'); return; }
  fetchZone(S.region);
};
$id('geoInBtn').onclick = () => {
  const R = D.regions[S.region];
  if (R.geojson && !confirm(`${R.name} 구역계를 파일 내용으로 바꿀까요?`)) return;
  $id('geoFile').value = ''; $id('geoFile').click();
};
$id('geoFile').onchange = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => importGeoJSONText(String(r.result)); r.readAsText(f); };
$id('geoOutBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('내보낼 구역계가 없습니다'); return; }
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [{ ...R.geojson, properties: { name: R.name } }] }, null, 1)], { type: 'application/geo+json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `구역계_${R.name}.geojson`; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$id('clearBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('지울 구역계가 없습니다'); return; }
  if (!confirm(`${R.name} 구역계와 판정 결과를 지울까요?`)) return;
  setZoneGeom(S.region, null, 0, '안 지우기'); statusMsg(`${S.region}안 구역계를 지웠습니다. 실행 취소로 되돌릴 수 있습니다.`);
};
$id('searchForm').onsubmit = async e => {
  e.preventDefault();
  const q = $id('searchQ').value.trim(); if (!q || !LM) return;
  if (!VW.ok) { toast('브이월드 인증키가 없어 검색할 수 없습니다'); return; }
  try {
    const r = await VW.search(/인천|미추홀|서울|경기|부산|대구|광주|대전|울산|세종|강원|충|전|경|제주/.test(q) ? q : '인천광역시 미추홀구 ' + q);
    if (!r) { toast('주소를 찾지 못했습니다'); return; }
    LM.setView([r.lat, r.lon], 18); toast(r.label);
    const m = String(r.label).match(/^(.*?[가-힣]+(동|리|가))(\s|\d|$)/);
    if (m && !$id('zkBase').value.trim()) $id('zkBase').value = m[1].trim();
  } catch (err) { toast('검색에 실패했습니다: ' + err.message); }
};

fetch('rules/incheon.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) applyJson(j); }).catch(() => {}).finally(() => {
  loadData();
  const first = D.map && D.keys.find(k => D.regions[k].geojson);
  if (first) { S.region = first; syncRegionChips(); renderSourceBar(); fitZone(first); }
  render();
});


/* ===== 화면 크기 조절: 지도 ↔ 설명 너비, 지도 높이 (끌기·화살표 키, 두 번 누르면 처음대로) ===== */
(() => {
  const KEY = 'jbs-urban-split', root = document.documentElement;
  const st = (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ } };
  let t = 0; const fit = () => { clearTimeout(t); t = setTimeout(() => { if (typeof LM !== 'undefined' && LM) LM.invalidateSize(); }, 60); };
  const apply = () => {
    if (st.lw) root.style.setProperty('--lw', st.lw + '%'); else root.style.removeProperty('--lw');
    if (st.mh) root.style.setProperty('--mh', st.mh + 'px'); else root.style.removeProperty('--mh');
    fit();
  };
  apply();
  const lay = document.querySelector('.layout');
  const drag = (el, onMove) => {
    if (!el) return;
    el.addEventListener('pointerdown', e => {
      e.preventDefault(); el.setPointerCapture(e.pointerId); el.classList.add('drag'); document.body.classList.add('resizing');
      const mv = ev => { onMove(ev); apply(); };
      const up = () => { el.classList.remove('drag'); document.body.classList.remove('resizing'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); save(); };
      el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
    });
  };
  const h = document.getElementById('hSplit'), v = document.getElementById('vSplit');
  drag(h, ev => { const r = lay.getBoundingClientRect(); st.lw = Math.round(Math.min(80, Math.max(25, (ev.clientX - r.left) / r.width * 100)) * 10) / 10; });
  drag(v, ev => { const m = document.getElementById('lmap').getBoundingClientRect(); st.mh = Math.round(Math.min(window.innerHeight * 1.5, Math.max(260, ev.clientY - m.top))); });
  const key = (el, k1, k2, f) => el && el.addEventListener('keydown', e => { const d = e.key === k1 ? -1 : e.key === k2 ? 1 : 0; if (!d) return; e.preventDefault(); f(d * (e.shiftKey ? 5 : 1)); apply(); save(); });
  key(h, 'ArrowLeft', 'ArrowRight', d => { st.lw = Math.min(80, Math.max(25, (st.lw || 53) + d * 2)); });
  key(v, 'ArrowUp', 'ArrowDown', d => { st.mh = Math.max(260, (st.mh || 560) + d * 20); });
  if (h) h.addEventListener('dblclick', () => { delete st.lw; apply(); save(); });
  if (v) v.addEventListener('dblclick', () => { delete st.mh; apply(); save(); });
})();
