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
    RULES.farFormula = j.far.max_incentive_formula || null;
    RULES.zoneUp = j.zone_upgrade_location || null;
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
function toast(m, ms = 2000) { const t = document.getElementById('toast'); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
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
        ledgerArea: num(f.lndpclAr), jimok: f.lndcgrCodeNm || '', jiga: num(f.pblntfPclnd), landUse: f.ladUseSittnNm || '',
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
// 지목은 연속지적 약칭('도')이나 대장 전체 이름('도로')으로 올 수 있어 둘 다 봄
const PUBLIC_JIMOK_FULL = { 도로: '도', 구거: '구', 하천: '천', 제방: '제', 공원: '공' };
const isPublicJimok = j => PUBLIC_JIMOK.includes(j) || !!PUBLIC_JIMOK_FULL[j];
// 국가·지자체 소유(토지소유정보 소유구분)
const isPublicOwner = o => /국유|시\s*도유|도유|시유|군유|구유|공유지|지자체/.test(String(o || ''));
// 건축물 행 규칙(용도·구조·연도 추정·세대수)은 js/zonekit.js BldgRows — 사업성 검토와 같은 코드
const rowFromGis = f => ({ ...BldgRows.fromGis(f), src: 'GIS' });
const rowFromLedger = t => ({ ...BldgRows.fromLedger(t), src: '대장' });

/* ===== 지도 구역계(안)와 공부 캐시 ===== */
// Z: 안(A~E)별 구역계(GeoJSON)와 편입 필지·편입비율. CACHE: 필지(pnu)별 공부, 건축물 행
const ZONE_KEY = 'jbs-urban-zones-v1', CACHE_KEY = 'jbs-urban-cache-v1', UI_KEY = 'jbs-urban-ui';
const ZONE_IDS = ['A', 'B', 'C', 'D', 'E'];
const Z = (() => { const z = lsGet(ZONE_KEY); return { title: z.title || '', center: z.center || [37.4553, 126.6577], zoom: z.zoom || 16, count: z.count || 3, zones: z.zones || {} }; })();
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
        if (c) Object.assign(p, { ledgerArea: c.ledgerArea || p.ledgerArea || 0, jimok: c.jimok || p.jimok, jiga: c.jiga || p.jiga, zoning: c.zoning || p.zoning || '', roadSide: c.roadSide, landUse: c.landUse || p.landUse || '', lc: true });
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
    const p = { id: i, pnu, landUse: c.landUse || '', own: c.own || '', ownInst: c.ownInst || '', chgCause: c.chgCause || '', chgDate: c.chgDate || '', bldOver: c.bldOver, bldOverN: c.bldOverN || 0, bldCore: c.bldCore, bldA: c.bldA, bldCoreA: c.bldCoreA, jibun: c.jibun || pnu, jimok: c.jimok || '', base, area: base, zone: c.zoning || '', price: num(c.jiga), public: isPublicJimok(c.jimok), roadSide: c.roadSide || '', geom: c.geom, owner: '', blds: [] };
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
  infraMode: 'proposal', parkMode: 'legal', sideRoadW: 8, schoolArea: 0, otherInfra: 0, greenInfra: 0, pubBldg: 0, parkCount: 0, valMult: 1.4, roadWork: 0, parkWork: 0, showFac: false, keepInnerRoads: false,
};
try { const s = localStorage.getItem('jbs-urban-plan'); if (s) Object.assign(P, JSON.parse(s)); } catch (e) { /* 무시 */ }
// v54: 주변 도로 최소 폭 기본 6m → 8m(소로2류 하한, 양방향 통행)
if (!P.v54road) { if (num(P.sideRoadW) === 6) P.sideRoadW = 8; P.v54road = true; }
const saveP = () => { try { localStorage.setItem('jbs-urban-plan', JSON.stringify(P)); } catch (e) { /* 무시 */ } };

// 정비기반시설 비율: 지도 모드에서 '제안값 사용'이면 INFRA 제안 면적으로, 아니면 직접 입력값
//  제안은 세대수(공원 세대당 2㎡, 진입도로 폭)에 따라 바뀌고 세대수는 기반시설에 따라 바뀌므로 두 번 맞춰 계산
// 상한용적률 산식(2030 기본계획 변경 고시 제2026-96호): 허용 + [1.5 × (공공시설등 부지제공 면적 / 제공·확보 후 면적) × 기준]
//  부지제공 면적 = 새로 설치하는 공공시설 − 용도폐지되는 '설치된' 기존 공공시설(사용 중 면적). 존치 시설은 그대로 있으므로 빼지 않음
//   기본계획 원문은 '기정 도시계획시설 면적을 차감'이지만, 미집행 결정선은 설치된 시설이 아니어서 상쇄 대상으로 보지 않음(실무 판단)
//  학교·공공청사 부지는 1.0(군·구 요청 시)
//  제공·확보 후 면적 = 공동주택 획지. 상한용적률을 넘지 않음. 허용용적률(인센티브)을 다 받는다고 가정
function farCalcOf(inf, site) {
  const far = RULES.far[P.zone], F = RULES.farFormula || { public_facility_build: 1.5, public_facility_land_only: 1.0 };
  const newPub = inf.roadArea + inf.parkArea + (inf.green || 0) + inf.other;   // 새로 설치하는 공공시설
  const old = P.keepInnerRoads ? 0 : (inf.innerArea || 0);   // 용도폐지되는 '설치된' 기존 공공시설(사용 중 면적) — 미집행 결정선은 상쇄하지 않음
  const pa = Math.max(0, newPub - old), pb = inf.schoolArea + (inf.pubB || 0);
  const raw = far.allowed + (F.public_facility_build * pa + F.public_facility_land_only * pb) / (site || 1) * far.base;
  return { v: Math.round(Math.min(far.max, raw) * 10) / 10, raw, pa, pb, newPub, fac: old, site, capped: raw > far.max };
}
// 개략 주동 배치 — 오른쪽 '개략 규모'와 지도가 같은 결과를 쓰도록 계산 단계에서 배치함
//  기반시설 제안이 있으면 공동주택 획지(1,000㎡ 미만 제외) 안에만, 없으면 구역계 안에 격자로 놓음
//  땅 모양 때문에 계산상 동 수보다 적게 들어가면 들어간 동 수로 동당 층수를 올려 세대수를 맞춤(층수가 오르면 인동간격도 넓어지므로 다시 배치)
const TOWERS = {
  memo: {},
  rot: ([x, y], t) => [x * Math.cos(t) - y * Math.sin(t), x * Math.sin(t) + y * Math.cos(t)],
  outer(gm) { const t = gm && (gm.geometry || gm); return !t ? [] : t.type === 'Polygon' ? [t.coordinates[0]] : t.type === 'MultiPolygon' ? t.coordinates.map(c => c[0]) : []; },
  area(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a / 2); },
  // 가장 긴 변 방향(라디안)
  mainAngle(pts) {
    let best = 0, ang = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const dx = pts[i][0] - pts[j][0], dy = pts[i][1] - pts[j][1], L2 = dx * dx + dy * dy;
      if (L2 > best) { best = L2; ang = Math.atan2(dy, dx); }
    }
    while (ang > Math.PI / 2) ang -= Math.PI; while (ang <= -Math.PI / 2) ang += Math.PI;
    return ang;
  },
  pack(polys, fw, fh, F, maxN) {
    const gap = Math.max(fw + 14, 0.8 * F * 2.9 + fh), sx = fw + 16;
    const big = polys.slice().sort((p, q) => this.area(q) - this.area(p));
    const angs = [0]; if (big[0]) { const m = this.mainAngle(big[0]); if (Math.abs(m) > 0.05) angs.push(m); }
    let best = [];
    for (const th of angs) for (const ox of [0, sx / 2]) for (const oy of [0, gap / 3, 2 * gap / 3]) {
      const out = [];
      for (const poly of big) {
        if (out.length >= maxN) break;
        const rp = poly.map(q => this.rot(q, -th));
        const xs = rp.map(q => q[0]), ys = rp.map(q => q[1]);
        const fits = (x, y) => [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh], [x + fw / 2, y], [x + fw / 2, y + fh], [x, y + fh / 2], [x + fw, y + fh / 2]].every(([px, py]) => inside(px, py, rp));
        for (let y = Math.min(...ys) + 3 + oy; y < Math.max(...ys) - fh && out.length < maxN; y += gap) {
          for (let x = Math.min(...xs) + 3 + ox; x < Math.max(...xs) - fw && out.length < maxN; x += sx) {
            if (fits(x, y)) out.push([[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh]].map(q => this.rot(q, th)));
          }
        }
      }
      if (out.length > best.length) best = out;
    }
    return best;
  },
  solve(polys, pl) {
    const core = P.coreUnits, fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
    let F = pl.floorsTower, rects = [];
    for (let it = 0; it < 12; it++) {
      const got = this.pack(polys, fw, fh, F, pl.towers);
      if (!got.length) break;
      rects = got;
      const need = Math.ceil(pl.units / (got.length * core));
      if (need <= F) { F = need; break; }   // 지금 층수의 인동간격으로 놓은 배치에 다 담김
      F = need;                              // 층수를 올리고 그 높이의 인동간격으로 다시 놓음
    }
    return { rects, F };
  },
  fit(a, pl) {
    const R0 = D.regions[a.key], zg = (R0 && R0.geojson) || (Z.zones[a.key] && Z.zones[a.key].geojson);
    if (!zg || !(pl.units > 0) || !(pl.towerFoot > 0)) return pl;
    const ring = this.outer(zg).sort((p, q) => this.area(q) - this.area(p))[0]; if (!ring) return pl;
    const lat0 = ring.reduce((t, c) => t + c[1], 0) / ring.length, lon0 = ring.reduce((t, c) => t + c[0], 0) / ring.length;
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const toLocal = r => r.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
    const back = ([x, y]) => [lat0 - y / ky, lon0 + x / kx];
    const lots = pl.infra && Array.isArray(pl.infra.lots) && pl.infra.lots.length ? pl.infra.lots.filter(l => l.geom && !l.small) : null;
    const polys = (lots && lots.length ? lots.flatMap(l => this.outer(l.geom)) : this.outer(zg)).map(toLocal);
    const key = [a.key, pl.units, pl.towers, pl.floorsTower, pl.towerFoot.toFixed(2), P.coreUnits, JSON.stringify(polys.map(q => q.map(v => [Math.round(v[0] * 2), Math.round(v[1] * 2)])))].join('|');
    if (!this.memo[key]) { const ks = Object.keys(this.memo); if (ks.length > 40) this.memo = {}; this.memo[key] = this.solve(polys, pl); }
    const r = this.memo[key];
    const out = Object.assign({}, pl, { towersCalc: pl.towers, floorsCalc: pl.floorsTower, placedIn: lots && lots.length ? 'lots' : 'zone' });
    if (!r.rects.length) { out.rects = []; out.mapFail = true; return out; }
    out.towers = r.rects.length; out.floorsTower = r.F; out.rects = r.rects.map(c => c.map(back));
    return out;
  },
};
// 지도 화면이면 실제로 놓이는 배치로 동 수·층수를 맞춘 값을 씀(개략 규모·높이·소방 검토·지도가 모두 이 값)
function plan(a) {
  const pl = planRaw(a);
  if (!D.map) return pl;
  try { return TOWERS.fit(a, pl); } catch (er) { console.warn('개략 배치 계산 실패', er); return pl; }
}
function planRaw(a) {
  if (!(D.map && P.infraMode !== 'manual')) return planCore(a, P.infraRatio);
  let pl = planCore(a, P.infraRatio), inf = null;
  let fc = null;
  for (let k = 0; k < 3; k++) {
    inf = INFRA.compute(a, pl.units);
    if (!inf) return planCore(a, P.infraRatio);
    fc = farCalcOf(inf, a.area * (1 - inf.ratio));
    pl = planCore(a, inf.ratio * 100, fc);
  }
  pl.infra = inf; pl.farCalc = fc;
  return pl;
}
function planCore(a, infraPct, farCalc) {
  const site = a.area * (1 - infraPct / 100);
  const far = RULES.far[P.zone];
  const farUse = P.farMode === 'base' ? far.base : P.farMode === 'allowed' ? far.allowed : P.farMode === 'max' ? far.max : P.farMode === 'calc' ? (farCalc ? farCalc.v : far.max) : Math.min(P.farCustom, far.max);
  const gfa = site * farUse / 100;
  // 세대수는 공통 계산(shared/feas.js) — 사업성 검토 첫 화면과 같은 식·같은 평형 비율·같은 임대 비율(임대 49㎡형)
  //  평형은 전용㎡ 키 {39, 49, 59, 74, 84, 101, 114 …} — 비율이 0이거나 빈 평형은 빠짐
  const FA = JbsFeas.get(), U = JbsFeas.units(gfa, FA), mix = JbsFeas.mixOf(FA);
  const mixSum = Object.values(mix).reduce((s, v) => s + num(v), 0) || 1;
  const avgEx = Object.keys(mix).reduce((s, t) => s + num(t) * num(mix[t]), 0) / mixSum;
  // 평형별 세대(임대 포함) — 임대는 49㎡형으로 셈. 검토서 도구로 넘기는 byType {전용㎡: 세대수}
  const byType = {}; Object.keys(U.sale).forEach(t => { if (U.sale[t] > 0) byType[t] = U.sale[t]; });
  if (U.rental > 0) byType[49] = (byType[49] || 0) + U.rental;
  const units = U.total, perUnit = U.perUnit || 1;
  const footMax = site * P.bcr / 100;
  const towerFoot = perUnit * P.coreUnits;
  const floorsAvg = Math.max(1, Math.ceil(gfa / footMax));
  const towers = Math.max(1, Math.ceil(units / (P.coreUnits * floorsAvg)));
  const floorsTower = Math.ceil(units / (towers * P.coreUnits));
  const rental = U.rental;
  const members = Math.min(a.owners, units - rental);
  const general = Math.max(0, units - rental - members);
  const basement = gfa * P.basementRatio / 100;
  return {
    infraPct, site, far, farUse, gfa, avgEx, perUnit, units, footMax, towerFoot, floorsTower, towers, rental, members, general, basement,
    n59: U.sale[59] || 0, n84: U.sale[84] || 0, n114: U.sale[114] || 0, U, byType,   // n59 등·U.sale은 분양 세대(임대 제외), byType은 임대 포함
  };
}
// 개략 사업성 — 첫 화면 ★빠른 사업성과 같은 가정값·같은 계산(shared/feas.js JbsFeas). 금액은 원 단위로 돌려줌(won 표시용)
function biz(a, pl) {
  const A = JbsFeas.get();
  const useJiga = D.real && a.priorLand > 0;
  const landUnit = A.avgLand || P.landPrice;   // 만원/㎡ — 공시지가가 없을 때
  const priorLand = useJiga ? a.priorLand * A.priorMul : a.landArea * landUnit * A.priorMul * 1e4;
  const U = pl.U || JbsFeas.units(pl.gfa, A);
  const rentLandUnit = a.landArea > 0 ? priorLand / 1e4 / a.landArea : 0;   // 임대 부속토지 감정단가(만원/㎡)
  const m = JbsFeas.money({ sale: U.sale, rental: U.rental, rentSupply: U.rentSupply, supply: U.supply, members: pl.members, owners: a.owners, farArea: pl.gfa, resArea: U.resArea, prior: priorLand / 1e4, lotArea: pl.site, landUnit: rentLandUnit }, A);
  const W = v => v * 1e4, saleU = m.types.reduce((n, t) => n + m.sale[t], 0);
  const avgPy = saleU ? m.types.reduce((s, t) => s + m.sale[t] * m.sup(t), 0) / saleU / PY : pl.perUnit / PY;
  const price84 = W(m.memberPrice * m.sup(84) / PY);
  const right = isFinite(m.right) ? W(m.right) : 0;
  return { prior: priorLand, priorLand, useJiga, landUnit, incMember: W(m.byCat['조합원'] || 0), incGeneral: W(m.byCat['일반'] || 0), incRental: W(m.byCat['임대'] || 0),
    income: W(m.rev), cost: W(m.construction), etc: W(m.etc), expense: W(m.cost), ratio: isFinite(m.ratio) ? m.ratio / 100 : 0,
    avgPrior: a.owners ? priorLand / a.owners : 0, right, price84, contrib: price84 - right, avgPy, planGfa: m.planGfa, m, A };
}

/* ===== 정비기반시설 제안 ===== */
// 근거
//  - 공원·녹지: 도시공원 및 녹지 등에 관한 법률 시행규칙 별표 2 제4호 — 도시정비법 정비계획 5만㎡ 이상은
//    1세대당 2㎡ 이상 또는 개발 부지면적의 5% 이상 중 큰 면적
//  - 진입도로: 주택건설기준 등에 관한 규정 제25조제1항 — 총세대수 300 미만 6m, 500 미만 8m, 1천 미만 12m, 2천 미만 15m, 2천 이상 20m
//  - 그 밖의 주변 도로 최소 폭(기본 6m)·학교·기타 시설은 제안값(협의·심의로 정함)
// 도시·군계획시설(도로) 규모별 구분 — 「도시·군계획시설의 결정·구조 및 설치기준에 관한 규칙」(2026. 9. 18. 시행) 제9조제2호: 폭 하한(m), 원문 대조 2026-11-01
const ROADCLS = {
  list: [['광로1류', 70], ['광로2류', 50], ['광로3류', 40], ['광로', 40], ['대로1류', 35], ['대로2류', 30], ['대로3류', 25], ['중로1류', 20], ['중로2류', 15], ['중로3류', 12], ['소로1류', 10], ['소로2류', 8], ['소로3류', 0]],
  std: [8, 10, 12, 15, 20, 25, 30],   // 화면에서 고를 표준 폭(각 등급 하한)
  of(w) { const c = this.list.find(([, lo]) => w >= lo - 0.05); return c ? c[0] : '소로3류'; },
  lower(name) { if (!name) return 0; const c = this.list.find(([n]) => String(name).includes(n)); return c ? c[1] : 0; },
  big(name) { return /광로/.test(name) ? '광로' : /대로/.test(name) ? '대로' : /중로/.test(name) ? '중로' : '소로'; },
};
const INFRA = {
  roadW: [[300, 6], [500, 8], [1000, 12], [2000, 15], [Infinity, 20]],
  // 진입도로가 2 이상일 때(제25조③): 폭 4m 이상 진입도로 2개의 폭 합. 4~6m 도로는 기간도로와 통행거리 200m 이내일 때만 진입도로로 봄
  roadW2: [[300, 10], [500, 12], [1000, 16], [2000, 20], [Infinity, 25]],
  entryWidth(units) { for (const [n, w] of this.roadW) if (units < n) return w; return 20; },
  entryWidth2(units) { for (const [n, w] of this.roadW2) if (units < n) return w; return 25; },
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
      // 구역 안 도시계획시설(브이월드 도시계획 레이어: 도로·교통·공간·유통공급·공공문화체육·방재·보건위생·환경기초·기타) — 구역 안 부분만
      const fac = [];
      const FAC = { LT_C_UPISUQ151: '도로', LT_C_UPISUQ152: '교통시설', LT_C_UPISUQ153: '공간시설', LT_C_UPISUQ154: '유통공급시설', LT_C_UPISUQ155: '공공문화체육시설', LT_C_UPISUQ156: '방재시설', LT_C_UPISUQ157: '보건위생시설', LT_C_UPISUQ158: '환경기초시설', LT_C_UPISUQ159: '기타기반시설' };
      for (const [lay, grp] of Object.entries(FAC)) {
        let ff = []; try { ff = await VWorld.dataAll(lay, `BOX(${x0},${y0},${x1},${y1})`, 10); } catch (er) { ff = []; }
        ff.forEach(f => {
          let x = null; try { x = turf.intersect(f, zone); } catch (er) { x = null; }
          if (!x || turf.area(x) < 5) return;
          const p = f.properties || {};
          fac.push({ grp, name: p.dgm_nm || p.atr_nam || grp, exc: p.exc_nam || '', grade: p.grad_se || '', area: Math.round(turf.area(x) * 10) / 10, geom: x.geometry });
        });
      }
      z.roads = { key: JSON.stringify(turf.bbox(zone)), edge, fac, facOk: true, at: new Date().toLocaleString('sv-SE').slice(0, 16) };
      saveZ();
      await this.fetchOwn(id);
      z.roads.ownOk = true; z.roads.ownOk2 = true; z.roads.ownOk3 = true; z.roads.ownOk4 = true; z.roads.ownOk5 = true; saveZ();
    } catch (er) { statusMsg(`${id}안: 주변 도로를 불러오지 못했습니다 — ${er.message}`, true); }
    finally { this.loading[id] = false; this.memo = {}; if (S.source === 'map') render(); }
  },
  // 경계 도로가 도시계획도로(UQ151)로 결정돼 있는지 — 결정 등급(소로2류 등)을 edge[].dec에 둠. 가장 많이 겹치는 결정을 씀
  async fetchEdgeDec(id) {
    const z = Z.zones[id]; if (!z || !z.roads || z.roads.edgeDecOk || this.decLoading[id] || !VWorld.enabled) return;
    this.decLoading[id] = true;
    try {
      const [x0, y0, x1, y1] = turf.bbox(z.geojson), e = 60 / 88000, n = 60 / 111000;
      const ff = await VWorld.dataAll('LT_C_UPISUQ151', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 10);
      z.roads.edge.forEach(r => {
        const rf = { type: 'Feature', properties: {}, geometry: r.geom }, ra = turf.area(rf); let best = 0, nm = '';
        ff.forEach(f => { let x = null; try { x = turf.intersect(f, rf); } catch (er) { x = null; } const A = x ? turf.area(x) : 0; if (A > best && A >= ra * 0.3) { best = A; const p = f.properties || {}; nm = (p.dgm_nm || p.atr_nam || '') + (p.exc_nam ? `(${p.exc_nam})` : ''); } });
        r.dec = nm;
      });
      z.roads.edgeDecOk = true; saveZ();
    } catch (er) { /* 다음에 다시 */ }
    finally { this.decLoading[id] = false; this.memo = {}; if (S.source === 'map') render(); }
  },
  decLoading: {},
  // 경계 도로를 폭 w까지 넓힐 때 구역 안에서 새로 도로가 되는 면적(㎡) — 화면 선택지용, 결과를 기억해 둠
  widenArea(r, z, w) {
    const add = w - r.w; if (add < 0.05) return 0;
    const k = `${r.pnu}|${Math.round(add * 100)}|${z.roads && z.roads.at}|${Object.keys(z.inArea || {}).length}`;
    this.waMemo = this.waMemo || {}; if (k in this.waMemo) return this.waMemo[k];
    let A = 0; try { const g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, add, { units: 'meters' }), z.geojson); A = g ? turf.area(g) : 0; } catch (er) { A = 0; }
    return (this.waMemo[k] = A);
  },
  // 구역 안 필지 소유구분(브이월드 토지소유정보: 국유지·시도유지·군유지·개인·법인·종교단체…) — 개인정보(이름)는 받지 않음
  //  국공유 필지는 토지이용상황(도로등·하천등)을 다시 받아 둠
  async fetchOwn(id) {
    const z = Z.zones[id]; if (!z) return;
    const list = Object.keys(z.inArea || {}).filter(k => { const c = CACHE.parcels[k]; return c && (c.own == null || (isPublicOwner(c.own) && (c.chgDate == null || c.bldOver == null || c.bldCore == null || (c.bldCore === 0 && c.bldOver > 0.05)))); });
    let i = 0, done = 0;
    const one = async k => {
      try {
        const d = await jsonp('https://api.vworld.kr/ned/data/getPossessionAttr', { pnu: k, key: VW.key, domain: location.origin, format: 'json', numOfRows: 1, pageNo: 1 });
        const f = d && d.possessions && d.possessions.field && d.possessions.field[0];
        const c = CACHE.parcels[k];
        c.own = f ? (f.posesnSeCodeNm || '') : ''; c.ownInst = f ? (f.nationInsttSeCodeNm || '') : '';
        c.chgCause = f ? (f.ownshipChgCauseCodeNm || '') : ''; c.chgDate = f ? (f.ownshipChgDe || '') : '';
        if (isPublicOwner(c.own) && !c.landUse) { try { const lc = await VW.landChar(k); if (lc) c.landUse = lc.landUse || ''; } catch (er) { /* 무시 */ } }
        // 국공유 필지: GIS 건물 도형이 필지를 얼마나 덮는지(옆 필지에 중심이 있는 건물이 걸쳐 있어도 잡힘)
        if (isPublicOwner(c.own) && (c.bldOver == null || c.bldCore == null) && c.geom) {
          try {
            const pf = { type: 'Feature', properties: {}, geometry: c.geom }, pa = turf.area(pf);
            // 가장자리 1.2m는 처마·지적 경계 어긋남으로 보고, 그 안쪽(core)을 건물이 덮는 비율을 따로 잼
            let core = null; try { core = turf.buffer(pf, -1.2, { units: 'meters' }); } catch (er) { core = null; }
            const ca = core ? turf.area(core) : 0;
            const bs = await VW.dataAll('LT_C_BLDGINFO', `BOX(${turf.bbox(pf).join(',')})`, 2);
            let cover = 0, coverC = 0, n = 0;
            bs.forEach(b => {
              try { const x = turf.intersect(pf, b); if (x && turf.area(x) >= 1) { cover += turf.area(x); n++; } } catch (er) { /* 무시 */ }
              if (core) { try { const y = turf.intersect(core, b); if (y) coverC += turf.area(y); } catch (er) { /* 무시 */ } }
            });
            c.bldOver = pa ? Math.min(1, cover / pa) : 0; c.bldOverN = n; c.bldCore = ca > 3 ? Math.min(1, coverC / ca) : -1; c.bldA = Math.min(pa, cover); c.bldCoreA = ca > 3 ? Math.min(ca, coverC) : null;   // -1: 너무 작거나 좁아 안쪽이 없음 → 전체 겹침으로 판단
          } catch (er) { c.bldOver = null; }
        }
        const p = D.byPnu && D.byPnu.get(k); if (p) { p.own = c.own; p.ownInst = c.ownInst; p.chgCause = c.chgCause; p.chgDate = c.chgDate; p.bldOver = c.bldOver; p.bldOverN = c.bldOverN; p.bldCore = c.bldCore; p.bldA = c.bldA; p.bldCoreA = c.bldCoreA; p.landUse = c.landUse || p.landUse || ''; }
      } catch (er) { /* 다음에 다시 */ }
      done++; if (done % 20 === 0 || done === list.length) statusMsg(`${id}안: 필지 소유구분 확인 ${done}/${list.length}`);
    };
    await Promise.all([1, 2, 3, 4, 5, 6].map(async () => { while (i < list.length) await one(list[i++]); }));
    if (list.length) { saveCache(); statusMsg(''); }
  },
  ready(id) { const z = Z.zones[id]; return !!(z && z.roads && z.roads.facOk && z.roads.ownOk5 && z.geojson && z.roads.key === JSON.stringify(turf.bbox(z.geojson))); },
  // 구역 안 한 점(중심이 구역 밖이면 구역 안 아무 점)
  defaultCenter(zone) {
    let c = turf.centerOfMass(zone);
    if (!turf.booleanPointInPolygon(c, zone)) c = turf.pointOnFeature(zone);
    return [c.geometry.coordinates[1], c.geometry.coordinates[0]];
  },
  // 면적 A인 정사각형을 중심점에 놓고 구역(도로 확폭 부분 제외)으로 자름
  // 계획 블록(공원·학교·종교 대체부지): 면적 A인 반듯한 정사각형을 가장 가까운 구역 경계선 방향에 맞춰 돌려 놓고,
  //  구역 밖·도로(minus)에 걸리면 자르지 않고 가까운 빈자리로 밀어 넣음(3m 간격, 최대 60m). 끝내 안 들어가면 걸린 만큼 잘라 냄
  block(center, A, zone, minus, asp0 = 1) {
    if (!(A > 0)) return null;
    try { if (A > turf.area(zone) * 0.8) return null; } catch (er) { return null; }
    const [lat0, lon0] = center, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540, side = Math.sqrt(A);
    const toM = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    // 가장 가까운 선 방향(구역 경계·도로, 그리고 이미 놓인 종교용지·공원 같은 다른 시설의 변)과 나란하게, 그 선 쪽으로 붙임
    let th = 0, best = Infinity, edge = null;
    const outer = g => { const gg = g && (g.geometry || g); return !gg ? [] : gg.type === 'Polygon' ? [gg.coordinates[0]] : gg.type === 'MultiPolygon' ? gg.coordinates.map(p => p[0]) : []; };
    const rings = outer(zone).concat(outer(minus));
    rings.forEach(r => { for (let i = 0; i + 1 < r.length; i++) {
      const a = toM(r[i]), b = toM(r[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 4) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)), d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (d < best) { best = d; th = Math.atan2(dy, dx); edge = [a, b]; }
    } });
    const ca = Math.cos(th), sa = Math.sin(th);
    let hw = side / 2, hh = side / 2;
    const sq = (cx, cy) => turf.polygon([[[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]].map(([u, v]) => toLL([cx + u * ca - v * sa, cy + u * sa + v * ca]))]);
    let free = zone; if (minus) { try { free = turf.difference(zone, minus) || zone; } catch (er) { free = zone; } }
    // 들어가는지 확인: 도형 자르기(turf.intersect)는 복잡한 실제 구역계에서 자주 실패해서, 미터 좌표에서 점으로 확인함
    //  사각형 둘레(1.5m 간격)·안쪽(4m 간격) 점이 모두 구역 안·피할 곳(도로 등) 밖이고, 구역·피할 곳의 꼭짓점이 사각형 안에 없으면 들어감
    const ringsOf = g => !g ? [] : (g.geometry || g).type === 'Polygon' ? (g.geometry || g).coordinates.map(r => r.map(toM)) : (g.geometry || g).type === 'MultiPolygon' ? (g.geometry || g).coordinates.flat().map(r => r.map(toM)) : [];
    const zR = ringsOf(zone), mR = ringsOf(minus);
    const inR = (x, y, rs) => { let c = false; rs.forEach(r => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } }); return c; };
    const fitsAt = (cx, cy) => {
      const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [0, 0]];
      const nu = Math.max(2, Math.ceil(2 * hw / 1.5)), nv = Math.max(2, Math.ceil(2 * hh / 1.5));
      for (let i = 0; i <= nu; i++) { const u = -hw + 2 * hw * i / nu; pts.push([u, -hh], [u, hh]); }
      for (let j = 0; j <= nv; j++) { const v = -hh + 2 * hh * j / nv; pts.push([-hw, v], [hw, v]); }
      for (let u = -hw + 4; u < hw; u += 4) for (let v = -hh + 4; v < hh; v += 4) pts.push([u, v]);
      for (const [u, v] of pts) { const x = cx + u * ca - v * sa, y = cy + u * sa + v * ca; if (!inR(x, y, zR) || (mR.length && inR(x, y, mR))) return false; }
      // 구역·피할 곳 꼭짓점이 사각형 안으로 파고들면 안 됨
      for (const r of zR.concat(mR)) for (const [x, y] of r) { const dx = x - cx, dy = y - cy, u = dx * ca + dy * sa, v = -dx * sa + dy * ca; if (Math.abs(u) < hw - 0.2 && Math.abs(v) < hh - 0.2) return false; }
      return true;
    };
    // 블록 변 바깥이 구역 경계까지 얕게(평균 12m 이하, 최대 25m 안에서 경계에 닿음) 남고 장애물이 없으면,
    //  그 변의 양 끝선을 곧게 연장해 경계까지 채움 → 시설 모양은 반듯한 변 + 구역 경계로만 이루어짐
    const extend = (cx, cy) => {
      const add = [];
      for (const [nu, nv, d, l] of [[1, 0, hw, hh], [-1, 0, hw, hh], [0, 1, hh, hw], [0, -1, hh, hw]]) {
        const E = 25;
        const loc = nu ? [[nu * d, -l], [nu * (d + E), -l], [nu * (d + E), l], [nu * d, l]] : [[-l, nv * d], [-l, nv * (d + E)], [l, nv * (d + E)], [l, nv * d]];
        const W = ([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca];
        // 먼 끝(25m)이 모두 구역 밖이어야 함(그 안에서 경계에 닿음)
        let farOut = true;
        for (let k = 0; k <= 10 && farOut; k++) { const t = -l + 2 * l * k / 10, [x, y] = W(nu ? [nu * (d + E), t] : [t, nv * (d + E)]); if (inR(x, y, zR)) farOut = false; }
        if (!farOut) continue;
        const band = turf.polygon([[...loc, loc[0]].map(q => toLL(W(q)))]);
        let inZ = null, inF = null;
        try { inZ = turf.intersect(band, zone); inF = inZ ? (minus ? turf.intersect(band, free) : inZ) : null; } catch (er) { continue; }
        if (!inZ || turf.area(inZ) < 1 || !inF) continue;
        const aZ = turf.area(inZ);
        if (turf.area(inF) < aZ * 0.98) continue;   // 사이에 도로·다른 시설이 있으면 연장 안 함
        if (aZ / (2 * l) > 12) continue;            // 평균 깊이 12m 넘으면 쓸 수 있는 땅이라 그대로 둠
        add.push(inZ);
      }
      const g = sq(cx, cy);
      if (!add.length) return g;
      try { return safeUnion([g, ...add]); } catch (er) { return g; }
    };
    // 경계까지 채우느라 면적이 늘면, 경계에 붙은 변은 그대로 두고 블록을 얇게 해서 정한 면적(A)에 맞춤
    //  n: 블록이 붙은 경계 쪽 방향(없으면 가운데를 기준으로 얇게)
    const keepArea = (x, y, n) => {
      const g0 = extend(x, y);
      if (!(turf.area(g0) > A * 1.02)) return g0;
      const hh0 = hh;
      let lo = hh0 * 0.2, hi = hh0, best = g0;
      for (let k = 0; k < 14; k++) {
        const mid = (lo + hi) / 2; hh = mid;
        const sx = n ? x + n[0] * (hh0 - mid) : x, sy = n ? y + n[1] * (hh0 - mid) : y;
        const g = extend(sx, sy), a = turf.area(g);
        if (a >= A) { hi = mid; best = g; } else lo = mid;
        if (Math.abs(a - A) < A * 0.005) break;
      }
      hh = hh0;
      return best;
    };
    // 찾은 자리에서 가장 가까운 선(구역 경계·다른 시설) 쪽으로 붙임 — 사이가 8m 안쪽이라 못 쓰는 띠가 남을 때만
    const flush = (cx, cy) => {
      if (!edge) return keepArea(cx, cy, null);
      const [a, b] = edge, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
      let nx = -dy / L, ny = dx / L;   // 경계선의 법선
      if ((cx - a[0]) * nx + (cy - a[1]) * ny > 0) { nx = -nx; ny = -ny; }   // 블록 → 경계선 방향
      let x = cx, y = cy;
      // 8m보다 멀면 붙이지 않음(그 사이는 쓸 수 있는 땅이라 놓은 자리를 그대로 둠). 8m 안이면 끝까지 붙임
      let moved = 0;
      for (let s = 0; s < 18; s++) { if (!fitsAt(x + nx * 0.5, y + ny * 0.5)) break; x += nx * 0.5; y += ny * 0.5; moved += 0.5; }
      if (moved >= 8.5) return keepArea(cx, cy, null);
      return keepArea(x, y, [nx, ny]);
    };
    // 정사각형 → 1:1.5 → 1:2(경계선 방향으로 길게) 순으로, 가까운 자리부터 최대 120m까지 찾음
    // 놓은 자리 둘레 120m 안에 없으면(구역 밖에 놓았거나 모퉁이라 막힌 경우) 구역 가운데에서 구역 전체를 다시 찾음
    const [zx0, zy0, zx1, zy1] = turf.bbox(zone), zc = toM([(zx0 + zx1) / 2, (zy0 + zy1) / 2]);
    const reach = Math.hypot((zx1 - zx0) * kx, (zy1 - zy0) * ky) / 2 + side;
    for (const [ox, oy, R] of [[0, 0, 120], [zc[0], zc[1], reach]]) {
      for (const asp of [...new Set([asp0, 1, 1.5, 2])]) {
        hw = side * Math.sqrt(asp) / 2; hh = side / Math.sqrt(asp) / 2;
        for (let r = 0; r <= R; r += r < 30 ? 3 : 6) {
          const n = r ? Math.max(8, Math.round(r / 2)) : 1;
          for (let k = 0; k < n; k++) {
            const cx = ox + r * Math.cos(2 * Math.PI * k / n), cy = oy + r * Math.sin(2 * Math.PI * k / n);
            if (fitsAt(cx, cy)) return flush(cx, cy);
          }
        }
      }
    }
    // 끝내 다 들어가는 자리가 없으면 놓은 자리에서 걸린 만큼 잘라 냄(잘라 내기가 실패하면 사각형 그대로)
    hw = side * Math.sqrt(asp0) / 2; hh = side / Math.sqrt(asp0) / 2;
    let g = null; try { g = turf.intersect(sq(0, 0), free); } catch (er) { g = null; }
    return g || (inR(0, 0, zR) ? sq(0, 0) : null);
  },
  // 공원·학교·종교용지 면적 정하기: 자동 / 면적(㎡) / 구역 대비 %(배율) + 가로:세로 비율. z.infra.sz[kind] = { mode, val, asp }
  sizeOf(z, kind, auto, zoneA) {
    const st = ((z.infra || {}).sz || {})[kind] || {};
    const v = num(st.val);
    // 잘못 넣은 값(구역 대비 100% 넘음, 구역의 80% 넘는 면적)은 쓰지 않고 자동값으로 — 계산이 멈추지 않게
    let A = st.mode === 'area' && v > 0 ? v : st.mode === 'pct' && v > 0 && v <= 100 ? zoneA * v / 100 : auto;
    const bad = (st.mode === 'pct' && v > 100) || A > zoneA * 0.8;
    if (bad) A = Math.min(auto, zoneA * 0.8);
    return { A, mode: st.mode || 'auto', val: st.val ?? '', asp: num(st.asp) || 1, bad };
  },
  memo: {},
  // a: analyze 결과, units: 계획 세대수 → { items, total, ratio, roadsReady }
  // opt.roadAdd: 확보 목표에 모자라는 면적 — 경계 도로를 모두 같은 폭만큼 더 넓혀 채움(두 번째 계산)
  compute(a, units, opt = {}) {
    const id = a.key, z = Z.zones[id];
    if (!D.map || !z || !z.geojson) return null;
    const mk = [id, units, opt.roadAdd || 0, a.area, P.infraMode, P.autoAbsorb, P.parkMode, P.sideRoadW, P.schoolArea, P.otherInfra, P.greenInfra, P.pubBldg, P.valMult, P.roadWork, P.parkWork, P.keepInnerRoads, JSON.stringify(z.infra || {}), z.roads && z.roads.at, Object.keys(z.inArea || {}).length].join('|');
    if (this.memo[mk]) return this.memo[mk];
    const zone = z.geojson, items = [];
    const W = this.entryWidth(units), sideW = num(P.sideRoadW) || 8;
    // 구역 안 기존 도로(지목 '도' 등 공공 지목) — 경계 도로 확폭량을 정할 때도 씀
    // 기존 정비기반시설 판단: 국가·지자체 소유 + 실제 기반시설로 쓰이는지 근거를 모아 판정, 화면에서 넣기/빼기로 확정
    const giAll = this.judgeExisting(a, z), giDec = ((z.infra || {}).giDec) || {};
    giAll.forEach(g => { g.dec = giDec[g.p.pnu] || ''; g.include = g.dec ? g.dec === 'in' : (g.grade === '확실' || g.grade === '확인 필요' || g.grade === '가능성 높음'); });
    // 재산관리 부서 회신(z.infra.giReply[pnu]): use 공공용 사용 · occupy 점유(대부·무단) · mismatch 지적 불부합(건물이 실제로는 필지 밖) · general 일반재산(공공용 아님)
    //  지적 불부합이면 건물 점유를 빼지 않음, 일반재산이면 자동 판정 대신 뺌(직접 '넣기'를 고르면 그대로)
    const giReply = ((z.infra || {}).giReply) || {};
    giAll.forEach(g => { g.reply = giReply[g.p.pnu] || ''; if (g.reply === 'mismatch') { g.occ = 0; g.useA = g.area; } if (g.reply === 'general' && !g.dec) g.include = false; });
    const inner = giAll.filter(g => g.include).map(g => g.p);
    // innerFull: 넣은 필지 면적 전체(존치할 때 토지이용계획에 그대로 셈) · innerOcc: 그 안 건물 점유 · innerArea: 사용 중인 부분(확보 목표·무상양도 기준)
    const giIn = giAll.filter(g => g.include);
    const innerFull = giIn.reduce((s, g) => s + g.area, 0), innerOcc = giIn.reduce((s, g) => s + (g.occ || 0), 0);
    const innerArea = Math.max(0, innerFull - innerOcc);
    // 1) 도로: 구역 경계 도로마다 '추천 계획 폭'을 잡아 모자라는 만큼 구역 쪽으로 확폭(기부채납) — 사용자가 도로별로 고름
    //  추천 = max(현황, 최소 폭(기본 8m·소로2류 하한), 일방통행이면 10m, 도시계획도로로 결정돼 있으면 그 등급 하한, 진입도로면 제25조 폭)
    //  → 같은 등급 안에서 모자라는 폭만 채우고 무작정 넓히지 않음. 다른 폭(다음 등급 등)은 화면에서 면적을 보고 고름
    //  z.infra.edgeOpt[pnu]: pw 직접 고른 계획 폭, keep 현황 유지
    //  '구역 안 기존 도로 면적만큼 확폭'을 켜면 모든 경계 도로를 같은 폭(+x m)만큼 더 넓혀 늘어난 면적을 기존 도로 면적에 맞춤
    let roadGeom = null, widenExtra = 0, entry = null;
    if (z.roads) {
      // 경계 도로별 설정(z.infra.edgeOpt[pnu]: oneway 일방통행 → 진입도로 후보에서 뺌, green 건너편 녹지 있음)
      //  진입도로는 직접 고른 도로(z.infra.entryPnu) → 없으면 일방통행이 아닌 가장 넓은 도로. 교통 검토 전까지는 '가정'
      const eo = (z.infra && z.infra.edgeOpt) || {}, pick = z.infra && z.infra.entryPnu;
      const all = z.roads.edge.slice().sort((x, y) => y.w - x.w);
      // 진입도로 후보: 일방통행이 아니고 구역에 10m 이상 닿은 도로(모퉁이만 스치는 넓은 도로는 진입도로로 보지 않음)
      //  닿은 길이 ≈ 1m 넓힐 때 구역 안에서 새로 도로가 되는 면적
      const front = r => this.widenArea(r, z, r.w + 1);
      // 부분 확폭(병목) 걸러내기: 구역에 닿은 길이 30m 미만이거나 그 도로 필지 길이(≈면적÷폭)의 50% 미만이면 '짧게 닿음'
      //  → 자동 추천에서 넓히지 않음(현황 유지). 짧은 구간만 넓히면 병목 모양이라 교통 기능이 없고, 도로 전체 확폭은 도시계획도로 결정으로 따로 검토
      const touch = new Map(all.map(r => {
        const f = front(r); let len = 0;
        try { len = turf.area({ type: 'Feature', properties: {}, geometry: r.geom }) / Math.max(r.w, 1); } catch (er) { len = 0; }
        return [r.pnu, { front: f, len, partial: f < 30 || (len > 0 && f < len * 0.5) }];
      }));
      const partialOf = r => (touch.get(r.pnu) || {}).partial;
      const cand = all.filter(r => !(eo[r.pnu] || {}).oneway && front(r) >= 10);
      const e1 = all.find(r => r.pnu === pick) || cand[0] || all[0];
      // ③ 두 번째 진입도로: 일방통행이 아니고 폭 6m 이상(4~6m는 기간도로까지 200m 이내인지 몰라 자동으로는 고르지 않음), 짧게 닿은 도로(partial)는 빼고
      const e2 = cand.filter(r => r !== e1 && r.w >= 6 && r.pnu !== pick && !partialOf(r))[0] || null;
      const W2 = this.entryWidth2(units);
      // 추천 폭은 기능상 필요한 폭만: 최소 폭·일방통행·도시계획도로 결정 등급 하한(진입도로 제25조 폭은 아래에서). 짧게 닿은 도로는 현황 유지
      const baseOf = r => partialOf(r) ? r.w : Math.max((eo[r.pnu] || {}).oneway ? Math.max(sideW, 10) : sideW, ROADCLS.lower(r.dec));
      const pwOf = (r, base) => { const o = eo[r.pnu] || {}; return num(o.pw) > 0 ? num(o.pw) : o.keep ? r.w : Math.max(base, r.w); };
      const needOf = mode => {
        const m = new Map(all.map(r => [r, pwOf(r, baseOf(r))]));
        if (mode === 1) m.set(e1, Math.max(W, pwOf(e1, Math.max(W, sideW))));
        else if (e2) { const lack = Math.max(0, W2 - (e1.w + e2.w)); m.set(e1, Math.max(pwOf(e1, sideW), e1.w + lack / 2)); m.set(e2, Math.max(pwOf(e2, sideW), e2.w + lack / 2)); }
        return m;
      };
      const edge = all;
      const build = (extra, need) => {
        const its = []; let un = null;
        edge.forEach(r => {
          const nd = need.get(r), add = Math.max(0, nd - r.w) + extra;
          if (add < 0.3) return;
          let g = null;
          try { g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, add, { units: 'meters' }), zone); } catch (er) { g = null; }
          if (!g || turf.area(g) < 1) return;
          un = un ? safeUnion([un, g]) : g;
          const kind = r === e1 ? 'entry' : (r === e2 && need === need3 ? 'entry2' : 'side');
          its.push({ kind, partial: kind === 'side' && partialOf(r), jibun: r.jibun, from: r.w, to: Math.round((Math.max(r.w, nd) + extra) * 10) / 10, extra, manual: num((eo[r.pnu] || {}).pw) > 0, oneway: !!(eo[r.pnu] || {}).oneway, dec: r.dec || '', area: turf.area(g), geom: g });
        });
        return { its, un, A: un ? turf.area(un) : 0 };
      };
      const need1 = needOf(1), need3 = e2 ? needOf(3) : null;
      const b1 = edge.length ? build(0, need1) : { its: [], un: null, A: 0 }, b3 = need3 ? build(0, need3) : null;
      // 기준: 자동이면 확폭 면적이 적은 쪽(같으면 ①), 직접 고르면 그 기준
      const em = (z.infra && z.infra.entryMode) || 'auto';
      const use3 = !!b3 && (em === '3' || (em === 'auto' && b3.A < b1.A - 1));
      let b = use3 ? b3 : b1; const need = use3 ? need3 : need1;
      entry = { mode: use3 ? 3 : 1, W, W2, e1: e1 ? { pnu: e1.pnu, jibun: e1.jibun, w: e1.w } : null, e2: e2 ? { pnu: e2.pnu, jibun: e2.jibun, w: e2.w } : null,
        A1: b1.A, A3: b3 ? b3.A : null, ok3: e2 ? e1.w + e2.w >= W2 : false, picked: !!(pick && e1 && e1.pnu === pick), em, opt: eo, sideW, per: {}, need: new Map([...need].map(([r, v]) => [r.pnu, v])) };
      // 도로별 계획 폭·확폭 면적·1m 더 넓힐 때 늘어나는 면적(부족분을 어느 도로로 채울지 판단용)
      edge.forEach(r => {
        const nd = need.get(r), add = Math.max(0, nd - r.w);
        const ar = d => { if (d < 0.05) return 0; try { const g = turf.intersect(turf.buffer({ type: 'Feature', properties: {}, geometry: r.geom }, d, { units: 'meters' }), zone); return g ? turf.area(g) : 0; } catch (er) { return 0; } };
        const a0 = ar(add);
        const o = eo[r.pnu] || {}, rec = (r === e1 && entry.mode === 1) ? Math.max(W, baseOf(r), r.w) : Math.max(baseOf(r), r.w);
        entry.per[r.pnu] = { pw: Math.round(nd * 10) / 10, add: Math.round(add * 10) / 10, area: a0, perM: ar(add + 1) - a0, manual: num(o.pw) > 0, keep: !!o.keep, rec: Math.round(rec * 10) / 10, dec: r.dec || '', front: (touch.get(r.pnu) || {}).front || 0, len: (touch.get(r.pnu) || {}).len || 0, partial: !!partialOf(r) };
      });
      if (opt.roadAdd > 1 && edge.length) {
        const target = b.A + opt.roadAdd;
        let lo = 0, hi = 2, best = b;
        while (hi < 40) { const t = build(hi, need); if (t.A >= target) break; hi *= 2; }
        for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2, t = build(m, need); if (t.A >= target) { hi = m; best = t; } else lo = m; if (Math.abs(t.A - target) < target * 0.01) { best = t; break; } }
        b = best; widenExtra = Math.round(hi * 10) / 10;
      }
      roadGeom = b.un; b.its.forEach(it => items.push(it));
    }
    // 직접 잘라 도로로 지정한 조각
    (z.infra && z.infra.manualRoads || []).forEach((g, k) => {
      let f = null; try { f = turf.intersect({ type: 'Feature', properties: {}, geometry: g }, zone); } catch (er) { f = null; }
      if (!f || turf.area(f) < 1) return;
      roadGeom = roadGeom ? safeUnion([roadGeom, f]) : f;
      items.push({ kind: 'manual', idx: k, jibun: '직접 지정', from: 0, to: 0, area: turf.area(f), geom: f });
    });
    let roadArea = roadGeom ? turf.area(roadGeom) : 0;
    // 종교용지(존치·대체): 종교시설 건물이 선 필지. 법정 의무는 아니나 실무상 정비계획에서 미리 잡음
    const Rg = D.regions[id] || {}, infO = z.infra || {}, relOff = infO.relOff || {};
    const relAll = a.ps.filter(p => ((Rg.blds || {})[p.pnu] || []).some(b => b.religion));
    const rel = relAll.filter(p => !relOff[p.pnu]);
    const relLand = rel.reduce((s, p) => s + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    // 예전 '종교용지 면적' 직접 입력값은 면적 지정으로 옮김
    if (infO.relArea != null && infO.relArea !== '' && !(infO.sz && infO.sz.rel)) { infO.sz = infO.sz || {}; infO.sz.rel = { mode: 'area', val: num(infO.relArea) }; delete infO.relArea; }
    const szRel = this.sizeOf(z, 'rel', relLand, a.area);
    let relArea = szRel.A;
    let relGeom = null;
    const relC = infO.relC || null;   // 있으면 대체부지(그 자리에 종교용지 면적만큼), 없으면 현 위치 존치(필지 그대로)
    if (relC && relArea > 0) relGeom = this.block(relC, relArea, zone, roadGeom, szRel.asp);
    else if (rel.length) { try { relGeom = turf.intersect(safeUnion(rel.filter(p => p.geom).map(p => ({ type: 'Feature', properties: {}, geometry: p.geom }))), zone); } catch (er) { relGeom = null; } }
    // 2) 공원·녹지
    const legal = a.area >= 50000;
    // 구역 안 기 조성 공원·녹지(지목 공원 또는 이용상황 공원): 기본계획(고시 제2026-96호) — 제척 원칙, 포함하면 기존 면적 이상 설치
    const parkExist = a.ps.filter(p => /^공(원)?$/.test(p.jimok || '') || /공원/.test(p.landUse || '')).reduce((s2, p) => s2 + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    const parkLegal = Math.max(legal ? Math.max(units * 2, a.area * 0.05) : (P.parkMode === 'always' ? a.area * 0.05 : 0), parkExist);
    const szPark = this.sizeOf(z, 'park', parkLegal, a.area), parkNeed = szPark.A;
    const inf = z.infra || {};
    const parkC = inf.parkC || this.defaultCenter(zone);
    const avoid0 = roadGeom && relGeom ? safeUnion([roadGeom, relGeom]) : (roadGeom || relGeom);
    // 배치 방식(감싸기·곧게·스케치·손그림, urban/placefit.js) — 고르면 정사각형 블록 대신 그 방식으로 놓음. z.infra.fit[kind]
    const fitO = inf.fit || {}, fitMsg = {};
    const fitOn = k => !!(fitO[k] && fitO[k].mode && fitO[k].mode !== 'auto' && window.PlaceFit);
    const fitRun = (k, target, anchors, occ) => {
      const o = fitO[k], anc = anchors[o.anchor || 'rel'] || null;
      let r = null; try { r = PlaceFit.run(o, { zone, anchorGeom: anc, occupied: occ.filter(g => g && g !== anc), target }); } catch (er) { r = { geom: null, ok: false, msg: '배치 계산 중 오류 — 자동 배치로 놓았습니다' }; }
      fitMsg[k] = r ? { ok: !!(r && r.ok && r.geom), msg: r.msg } : null;
      return r && r.geom ? r.geom : null;
    };
    let parkGeom = fitOn('park') ? fitRun('park', parkNeed, { rel: relGeom }, [roadGeom, relGeom]) : null;
    if (!parkGeom) parkGeom = this.block(parkC, parkNeed, zone, avoid0, szPark.asp);
    // 공원과 종교 대체부지가 맞닿거나 12m 안으로 가까우면 한 띠로 묶음: 가까운 구역 경계와 나란한 곧은 안쪽 선 하나로,
    //  두 시설 면적의 합만큼 깊이를 정하고 경계에 수직인 선 하나로 나눔(각자 정한 면적)
    let paired = false;
    if (relC && parkGeom && relGeom && !infO.noPair && !fitOn('park')) {
      try {
        if (turf.booleanIntersects(turf.buffer(parkGeom, 12, { units: 'meters' }), relGeom)) {
          // 처음 묶일 때 고른 기준 경계 변을 기억해 두고 계속 씀(만질 때마다 다른 변으로 바뀌지 않게)
          const pr = this.pairBand(zone, roadGeom, [['park', parkGeom, parkNeed], ['rel', relGeom, relArea]], infO.pairSplit, infO.pairEdge);
          if (pr) {
            parkGeom = pr.park; relGeom = pr.rel; paired = pr.pair;
            if (JSON.stringify(infO.pairEdge) !== JSON.stringify(pr.pair.edgeLL)) { infO.pairEdge = pr.pair.edgeLL; z.infra = infO; saveZ(); }
          }
        }
      } catch (er) { paired = false; }
    }
    // 3) 학교·기타
    const szSchool = this.sizeOf(z, 'school', num(P.schoolArea), a.area), schoolA = szSchool.A;
    const schoolC = inf.schoolC || (() => { const [la, lo] = parkC; return [la, lo + (Math.sqrt(parkNeed || 1) + Math.sqrt(schoolA || 1)) / 2 / (Math.cos(la * Math.PI / 180) * 111320)]; })();
    let schoolGeom = fitOn('school') && schoolA > 0 ? fitRun('school', schoolA, { rel: relGeom, park: parkGeom }, [roadGeom, relGeom, parkGeom]) : null;
    if (!schoolGeom) schoolGeom = this.block(schoolC, schoolA, zone, avoid0 ? (parkGeom ? safeUnion([avoid0, parkGeom]) : avoid0) : parkGeom, szSchool.asp);
    // 시설 블록 때문에 큰 획지와 떨어져 갇힌 작은 조각이 남으면 맞닿은 시설에 붙여 빈 땅이 생기지 않게 함
    let absorbed = 0;
    { const blocks = [['park', parkGeom], ['school', schoolGeom]].concat(relC ? [['rel', relGeom]] : []).filter(b => b[1]);
      if (blocks.length && P.autoAbsorb !== false) {
        let rest = null;
        try { rest = turf.difference(zone, safeUnion([...(roadGeom ? [roadGeom] : []), ...(!relC && relGeom ? [relGeom] : []), ...blocks.map(b => b[1])])); } catch (er) { rest = null; }
        // 큰 공동주택 획지와 떨어져 갇힌 1,000㎡ 미만 조각(시설과 구역 경계 사이 모퉁이 등)만 가장 많이 맞닿은 시설에 붙임
        //  (가는 띠는 블록을 8m 안에서 경계에 붙여 생기지 않게 함 — 큰 획지와 이어진 땅은 건드리지 않음)
        const cs = rest ? (rest.geometry.type === 'Polygon' ? [rest.geometry.coordinates] : rest.geometry.coordinates) : [];
        const pieces = cs.map(c => turf.polygon(c)).map(g => ({ g, A: turf.area(g) })).filter(x => x.A >= 1).sort((x, y) => y.A - x.A);
        const add = {};
        pieces.slice(1).forEach(({ g: pc, A }) => {
          if (A >= 1000) return;
          let near = null, bestC = 0;
          try {
            const pb = turf.buffer(pc, 1, { units: 'meters' });
            blocks.forEach(b => { let c = 0; try { const x = turf.intersect(pb, b[1]); c = x ? turf.area(x) : 0; } catch (er) { c = 0; } if (c > bestC) { bestC = c; near = b; } });
          } catch (er) { near = null; }
          if (!near) return;
          (add[near[0]] = add[near[0]] || []).push(pc); absorbed += A;
        });
        const grow = (g, k) => (add[k] ? safeUnion([g, ...add[k]]) : g);
        parkGeom = parkGeom && grow(parkGeom, 'park'); schoolGeom = schoolGeom && grow(schoolGeom, 'school'); if (relC && relGeom) relGeom = grow(relGeom, 'rel');
      } }
    // 정비기반시설도(도면) 사용 — 이미 정비기반시설 계획도가 있는 구역: 자동 배치 대신 올린 도면(z.infra.plan)의 도형을 그대로 씀
    //  구역 안 부분만, 종류끼리 겹치면 앞 순서(도로 → 공원 → 녹지 → 그 밖의 시설 → 학교 → 종교 → 공공청사)가 차지
    const DRW = (P.infraMode === 'drawing' && infO.plan && infO.plan.feats && infO.plan.feats.length) ? infO.plan : null;
    let drw = null;
    if (DRW) {
      const kindOf = f => (DRW.kinds && DRW.kinds[f.layer]) || ZoneKit.infraKind(f.layer);
      const got = {}; let taken = null;
      ['road', 'park', 'green', 'other', 'school', 'rel', 'pub'].forEach(k => {
        const gs = DRW.feats.filter(f => kindOf(f) === k).map(f => { try { return turf.intersect({ type: 'Feature', properties: {}, geometry: f.geom }, zone); } catch (er) { return null; } }).filter(g => g && turf.area(g) >= 1);
        if (!gs.length) return;
        let u = safeUnion(gs);
        if (taken && u) { try { u = turf.difference(u, taken); } catch (er) { /* 그대로 */ } }
        if (!u || turf.area(u) < 1) return;
        got[k] = u; taken = taken ? safeUnion([taken, u]) : u;
      });
      roadGeom = got.road || null; parkGeom = got.park || null; schoolGeom = got.school || null; relGeom = got.rel || null;
      roadArea = roadGeom ? turf.area(roadGeom) : 0; relArea = relGeom ? turf.area(relGeom) : 0;
      items.length = 0; paired = null;
      drw = { name: DRW.name, at: DRW.at, crs: DRW.crs, green: got.green || null, other: got.other || null, pub: got.pub || null,
        greenA: got.green ? turf.area(got.green) : 0, otherA: got.other ? turf.area(got.other) : 0, pubA: got.pub ? turf.area(got.pub) : 0,
        outside: DRW.feats.filter(f => !['zone', 'ignore', 'lot'].includes(kindOf(f))).length - Object.keys(got).length < 0 ? 0 : null };
    }
    // 남는 땅 = 공동주택 획지(구역 − 도로 확폭·지정 도로 − 공원·학교·종교용지 − 존치하는 기존 기반시설). 떨어진 덩어리마다 획지 번호
    let lots = [];
    try {
      const used = [roadGeom, parkGeom, schoolGeom, relGeom].concat(drw ? [drw.green, drw.other, drw.pub] : []).filter(Boolean);
      if (P.keepInnerRoads) inner.filter(p => p.geom).forEach(p => used.push({ type: 'Feature', properties: {}, geometry: p.geom }));
      const rest = used.length ? turf.difference(zone, safeUnion(used)) : zone;
      if (rest) {
        const cs = rest.geometry.type === 'Polygon' ? [rest.geometry.coordinates] : rest.geometry.coordinates;
        lots = cs.map(c => turf.polygon(c)).map(g => ({ geom: g, area: turf.area(g) })).filter(l => l.area >= 5).sort((x, y) => y.area - x.area)
          .map((l, i) => ({ ...l, no: i + 1, small: l.area < 1000 }));
      }
    } catch (er) { lots = []; }
    // 지도에서 '획지 붙이기'로 고른 땅을 공원·학교·종교용지에 합침 (z.infra.addTo: [{ kind, pt:[lat,lng] }])
    const merged = {}, mergeList = [], skipped = [];
    (infO.addTo || []).forEach((m, mi) => {
      const l = lots.find(x => { try { return turf.booleanPointInPolygon(turf.point([m.pt[1], m.pt[0]]), x.geom); } catch (er) { return false; } });
      if (!l) return;
      const tgt = { park: parkGeom, school: schoolGeom, rel: relGeom }[m.kind];
      if (!tgt) return;
      // 주된 공동주택 획지(가장 큰 획지·3,000㎡ 이상)를 면적 없이 통째로 붙인 것은 실수로 보고 무시함
      if (!(num(m.area) > 0) && (l === lots[0] || l.area >= 3000)) { skipped.push({ idx: mi, kind: m.kind, area: l.area }); return; }
      // 붙일 면적을 정했으면 시설에 가까운 쪽부터 그만큼만 떼어 붙임(시설 둘레를 넓혀 가며 면적을 맞춤), 나머지는 획지로 남김
      let piece = l.geom;
      const want = num(m.area);
      if (want > 0 && want < l.area * 0.98) {
        let lo = 0, hi = 5, cut = null;
        const take = d => { try { return turf.intersect(l.geom, turf.buffer(tgt, d, { units: 'meters', steps: 4 })); } catch (er) { return null; } };
        while (hi < 400) { const x = take(hi); if (x && turf.area(x) >= want) break; hi *= 2; }
        for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2, x = take(mid), A = x ? turf.area(x) : 0; if (A < want) lo = mid; else { hi = mid; cut = x; } }
        if (cut) piece = cut;
      }
      // 떼고 남은 쪽이 300㎡ 미만 자투리로 갈라지면 같이 붙임
      if (piece !== l.geom) {
        try {
          const lf = turf.difference(l.geom, piece);
          const bits = lf ? (lf.geometry.type === 'Polygon' ? [lf.geometry.coordinates] : lf.geometry.coordinates).map(c => turf.polygon(c)).filter(x => turf.area(x) < 300) : [];
          if (bits.length) piece = safeUnion([piece, ...bits]);
        } catch (er) { /* 그대로 */ }
      }
      const g = safeUnion([tgt, piece]);
      if (m.kind === 'park') parkGeom = g; else if (m.kind === 'school') schoolGeom = g; else relGeom = g;
      const pa = turf.area(piece);
      merged[m.kind] = (merged[m.kind] || 0) + pa;
      mergeList.push({ idx: mi, kind: m.kind, area: pa });
      const left = piece === l.geom ? null : (() => { try { return turf.difference(l.geom, piece); } catch (er) { return null; } })();
      const restLots = left ? (left.geometry.type === 'Polygon' ? [left.geometry.coordinates] : left.geometry.coordinates).map(c => turf.polygon(c)).map(gg => ({ geom: gg, area: turf.area(gg) })).filter(x => x.area >= 5).map(x => ({ ...x, small: x.area < 1000 })) : [];
      lots = lots.filter(x => x !== l).concat(restLots).sort((x, y) => y.area - x.area);
    });
    // 붙이기 뒤에도 큰 획지와 떨어져 남은 1,000㎡ 미만 조각은 가장 많이 맞닿은 시설에 붙임
    let relGrown = false;
    if (P.autoAbsorb !== false && lots.length > 1) {
      const blk = () => [['park', parkGeom], ['school', schoolGeom], ['rel', relGeom]].filter(b => b[1]);
      lots.slice(1).filter(l => l.area < 1000).forEach(l => {
        let near = null, bestC = 0;
        try { const pb = turf.buffer(l.geom, 1, { units: 'meters' }); blk().forEach(b => { let c = 0; try { const x = turf.intersect(pb, b[1]); c = x ? turf.area(x) : 0; } catch (er) { c = 0; } if (c > bestC) { bestC = c; near = b[0]; } }); } catch (er) { near = null; }
        if (!near) return;
        if (near === 'park') parkGeom = safeUnion([parkGeom, l.geom]); else if (near === 'school') schoolGeom = safeUnion([schoolGeom, l.geom]); else { relGeom = safeUnion([relGeom, l.geom]); relGrown = true; }
        absorbed += l.area; lots = lots.filter(x => x !== l);
      });
    }
    lots = lots.map((l, i) => ({ ...l, no: i + 1 }));
    if ((relC || merged.rel || relGrown) && relGeom) relArea = turf.area(relGeom);
    const parkArea = parkGeom ? turf.area(parkGeom) : 0, schoolArea = schoolGeom ? turf.area(schoolGeom) : 0;
    // green: 완충·경관·연결녹지 등 · other: 공용주차장·공공공지·광장 등 그 밖의 정비기반시설 · pubB: 공공청사 등(정비기반시설 아님) — 모두 입력값, 지도에는 그리지 않음
    const other = drw ? drw.otherA : num(P.otherInfra), green = drw ? drw.greenA : num(P.greenInfra), pubB = drw ? drw.pubA : num(P.pubBldg);
    const total = roadArea + (P.keepInnerRoads ? innerFull : 0) + parkArea + green + schoolArea + other + pubB + relArea;
    // 확보 목표: 구역 안 기존 공공시설(도로·구거 등 공공 지목 필지) + 도시계획시설 — 겹치는 땅은 한 번만
    let keepGeom = null, keepArea = 0, keepAll = 0, facArea = 0;
    const facList = (z.roads && z.roads.fac) || [];
    try {
      const gs = inner.filter(p => p.geom).map(p => { try { return turf.intersect({ type: 'Feature', properties: {}, geometry: p.geom }, zone); } catch (er) { return null; } }).filter(Boolean)
        .concat(facList.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom })));
      if (gs.length) { keepGeom = safeUnion(gs); keepAll = Math.max(0, turf.area(keepGeom) - innerOcc); }   // 국공유 공공시설 안 건물 점유 부분은 뺌
      facArea = facList.length ? turf.area(safeUnion(facList.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom })))) : 0;
    } catch (er) { keepAll = innerArea; }
    // 확보 목표 = 무상양도 균형: 용도폐지되는 '설치된' 국공유 정비기반시설 중 사용 중인 면적(도정법 제97조②③ — 도시·군관리계획으로 결정되어 '설치된' 도로 등)
    //  미집행 결정선은 아직 설치된 시설이 아니므로 확보 목표·상쇄에 넣지 않음(정비계획 결정·사업시행계획인가 때 도시계획시설 변경으로 정리 — 추후 할 일)
    //  기존 도로를 존치하면 용도폐지가 아니므로 목표에서 빠짐
    keepArea = P.keepInnerRoads ? 0 : innerArea;
    // 신설 정비기반시설(무상귀속, 도정법 제97조②) — 정비기반시설(법 제2조제4호·영 제3조)만 셈. 학교용지·공공청사는 정비기반시설이 아니라 뺌
    const newArea = roadArea + parkArea + green + other;
    // 무상양도 금액 비교(설치비용 상당 범위, 제97조②): 용도폐지 시설 평가액 vs 신설 시설 설치비용 — 개략
    const vmul = num(P.valMult) || 1.4, pubPrice = (() => { const w = inner.reduce((t, p) => t + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0); return w ? inner.reduce((t, p) => t + num(p.price) * (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0) / w : 0; })();
    const priv = a.ps.filter(p => !isPublicOwner(p.own) && !isPublicJimok(p.jimok)), privW = priv.reduce((t, p) => t + (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0);
    const privPrice = privW ? priv.reduce((t, p) => t + num(p.price) * (p.base ?? p.area) * (z.inArea[p.pnu] ?? 1), 0) / privW : 0;
    const money = {
      oldVal: (P.keepInnerRoads ? 0 : innerArea) * pubPrice * vmul,                 // 용도폐지 시설: 사용 중 면적 × 공시지가 × 배율
      newLand: newArea * privPrice * vmul,                                          // 신설 부지(사유지로 봄) 가액 — 설치비용에 넣는지는 확인 필요
      newWork: roadArea * num(P.roadWork) + (parkArea + green) * num(P.parkWork) + other * num(P.roadWork),   // 공사비(단가 입력 시)
      pubPrice, privPrice, vmul,
    };
    money.newCost = money.newLand + money.newWork;
    const short = Math.max(0, keepArea - newArea);
    // 모자라면 경계 도로를 넓혀 채우기(선택). 한 번만 다시 계산
    // (예전 '모든 경계 도로를 똑같이 넓혀 채우기'는 없앰 — 부족분은 공원·공공공지·구역 안 도로로 채움(fillGuide), 경계 도로 확폭은 기능으로만)
    const res = {
      giAll, keepArea, keepAll, facArea, facList, money, newArea, short, roadAdd: opt.roadAdd || 0, entry,
      widenExtra, paired, lots, merged, mergeList, skipped, absorbed, parkC, schoolC, relC, fitMsg, relCenter: relGeom ? (() => { const c = turf.centroid(relGeom).geometry.coordinates; return [c[1], c[0]]; })() : null,
      relAll, rel, relLand, relArea, relGeom, relManual: szRel.mode !== 'auto', szPark, szSchool, szRel, parkLegal, parkExist,
      W, sideW, units, items, roadGeom, roadArea, inner, innerArea, innerFull, innerOcc, legal, parkNeed, parkGeom, parkArea, green, pubB, schoolGeom, schoolArea, other, total,
      ratio: a.area ? total / a.area : 0, roadsReady: !!z.roads, edge: z.roads ? z.roads.edge : [], drawing: drw,
    };
    this.memo = {}; this.memo[mk] = res;
    return res;
  },
  // 지도에 그리기 (정비계획 탭·'기반시설 제안' 색 구분)
  draw(layer, a) {
    const pl = plan(a), inf = pl.infra; if (!inf) return;
    this.curPair = inf.paired || null; this.curInf = inf; if (!inf.paired) { this.divNear = null; this.divStart = null; }
    const c = n => cssVar(n);
    // 공동주택 획지(남는 땅) — 맨 아래에 옅게 칠하고 번호·면적 표시
    (inf.lots || []).forEach(l => {
      const g = L.geoJSON(l.geom, { style: { color: '#b08900', weight: 1.5, fillColor: l.small ? '#e8590c' : '#f2c94c', fillOpacity: l.small ? 0.35 : 0.28 }, interactive: true })
        .bindTooltip(`획지 ${l.no} · 공동주택용지 ${fmt(l.area)}㎡${l.small ? ' — 1,000㎡ 미만이라 단독 개발이 어려움' : ''} · 누르면 옆 시설에 붙이기`, { sticky: true }).addTo(layer);
      g.on('click', ev => {
        if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
        L.DomEvent.stop(ev);
        const kinds = [['rel', '종교용지', inf.relGeom], ['park', '공원·녹지', inf.parkGeom], ['school', '학교용지', inf.schoolGeom]].filter(k => k[2]);
        const box = document.createElement('div'); box.className = 'zk-pop';
        // 큰 공동주택 획지(가장 큰 획지이거나 3,000㎡ 이상)는 통째로 붙지 않게 면적을 꼭 넣어야 함
        const big = l.no === 1 || l.area >= 3000;
        box.innerHTML = `<div><b>획지 ${l.no}</b> · ${fmt(l.area)}㎡</div><div class="zk-pop-sub">${big ? '<b class="warn">주된 공동주택 획지입니다.</b> 붙일 면적을 넣으면 시설 쪽에서 그만큼만 떼어 붙입니다.' : '이 땅을 어디에 넣을까요?'}</div>
          <label class="zk-pop-sub" style="display:flex;gap:6px;align-items:center;margin-top:4px">붙일 면적 <input type="number" min="1" max="${Math.round(l.area)}" step="10" value="${big ? '' : Math.round(l.area)}" placeholder="${big ? '예: 300' : ''}" style="width:90px" data-want> ㎡</label>
          <div class="zk-pop-sub">${big ? '' : '줄이면 시설에 가까운 쪽부터 그만큼만 붙이고 나머지는 획지로 남깁니다.'}</div><div class="zk-pop-btns">${kinds.map(k => `<button type="button" data-k="${k[0]}">${k[1]}에 붙이기</button>`).join('')}<button type="button" data-act="out" data-k="">공동주택 획지로 두기</button></div>`;
        const pop = L.popup({ maxWidth: 300 }).setLatLng(ev.latlng).setContent(box).openOn(LM);
        const wantIn = box.querySelector('[data-want]');
        const sync = () => box.querySelectorAll('button[data-k]').forEach(b => { if (b.dataset.k) b.disabled = big && !(num(wantIn.value) > 0); });
        wantIn.oninput = sync; sync();
        box.querySelectorAll('button').forEach(b => b.onclick = () => {
          LM.closePopup(pop);
          if (!b.dataset.k) return;
          const z = Z.zones[S.region]; z.infra = z.infra || {}; z.infra.addTo = z.infra.addTo || [];
          const want = num(box.querySelector('[data-want]').value);
          z.infra.addTo.push({ kind: b.dataset.k, pt: [ev.latlng.lat, ev.latlng.lng], area: want > 0 && want < l.area * 0.98 ? want : null });
          saveZ(); INFRA.memo = {}; render(); toast(`획지 ${l.no}에서 ${fmt(Math.min(l.area, num(box.querySelector('[data-want]').value) || l.area))}㎡를 붙였습니다`);
        });
      });
      if (l.area >= 300) { try { const pt = turf.pointOnFeature(l.geom).geometry.coordinates; L.tooltip({ permanent: true, direction: 'center', className: 'lot-label' }).setLatLng([pt[1], pt[0]]).setContent(`획지${l.no}<br>${fmt(l.area)}㎡`).addTo(layer); } catch (er) { /* 무시 */ } }
    });
    // 구역 안 도시계획시설(결정된 도로·공원 등) — 주황 빗금 테두리로 참고 표시
    if (P.showFac) (inf.facList || []).forEach(f => L.geoJSON({ type: 'Feature', properties: {}, geometry: f.geom }, { style: { color: '#d9480f', weight: 1.5, dashArray: '5 3', fillColor: '#d9480f', fillOpacity: 0.08 }, interactive: true })
      .bindTooltip(`도시계획시설 ${esc(f.grp)} · ${esc(f.name)}${f.grade ? ' ' + esc(f.grade) : ''}${f.exc ? ` (${esc(f.exc)})` : ''} · 구역 안 ${fmt(f.area)}㎡`, { sticky: true }).addTo(layer));
    // 구역 밖 경계 도로는 참고로 구역 둘레 15m 안만 점선 테두리로 (색은 칠하지 않음 — 제안이 아님)
    const z0 = Z.zones[a.key], near = z0 && z0.geojson ? (() => { try { return turf.buffer(z0.geojson, 15, { units: 'meters' }); } catch (er) { return null; } })() : null;
    (inf.edge || []).forEach(r => {
      let g = { type: 'Feature', properties: {}, geometry: r.geom };
      if (near) { try { g = turf.intersect(g, near) || g; } catch (er) { /* 그대로 */ } }
      L.geoJSON(g, { style: { color: c('--ink-2'), weight: 1, dashArray: '2 4', fill: true, fillOpacity: 0 }, interactive: true })
        .bindTooltip(`구역 밖 경계 도로(참고) ${esc(r.jibun)} · 폭 약 ${r.w}m(필지 모양으로 추정)`, { sticky: true }).addTo(layer);
    });
    if (inf.drawing) {   // 정비기반시설도(도면) — 끌어 옮기지 않고 도면 그대로 표시
      const dr = inf.drawing, put = (g, col, op, t) => { if (g) L.geoJSON(g, { style: { color: col, weight: 1.5, fillColor: col, fillOpacity: op } }).bindTooltip(t, { sticky: true }).addTo(layer); };
      put(inf.roadGeom, c('--ink-2'), 0.45, `도로(도면) ${fmt(inf.roadArea)}㎡`);
      put(inf.parkGeom, c('--ok'), 0.35, `공원(도면) ${fmt(inf.parkArea)}㎡`);
      put(dr.green, '#5d9c59', 0.3, `녹지(도면) ${fmt(dr.greenA)}㎡`);
      put(dr.other, '#3a7ca5', 0.3, `그 밖의 정비기반시설(도면) ${fmt(dr.otherA)}㎡`);
      put(inf.schoolGeom, c('--accent'), 0.3, `학교용지(도면) ${fmt(inf.schoolArea)}㎡`);
      put(inf.relGeom, '#7b2cbf', 0.3, `종교용지(도면) ${fmt(inf.relArea)}㎡`);
      put(dr.pub, '#8d6e63', 0.3, `공공청사 등(도면) ${fmt(dr.pubA)}㎡`);
      return;
    }
    if (inf.relGeom) this.movable(L.geoJSON(inf.relGeom, { style: { color: '#7b2cbf', weight: 2, fillColor: '#7b2cbf', fillOpacity: 0.3 } })
      .bindTooltip(inf.relC ? `종교용지 대체부지(제안) ${fmt(inf.relArea)}㎡ · 끌어서 옮기기` : `종교용지 현 위치 존치 ${inf.rel.map(p => esc(p.jibun)).join(', ')} · ${fmt(inf.relArea)}㎡ · 끌면 대체부지로 옮겨짐`, { sticky: true }).addTo(layer), 'religion', inf.relCenter);
    inf.items.forEach(it => {
      // 짧게 닿은 도로를 직접 넓힌 것(부분 확폭)은 진회색 면 대신 빗금+점선 — '검토용'
      const lyr = L.geoJSON(it.geom, { style: it.partial ? { color: c('--warn'), weight: 1.5, dashArray: '3 4', fillColor: c('--warn'), fillOpacity: 0.6 } : { color: c('--ink'), weight: 1, fillColor: c('--ink-2'), fillOpacity: it.kind === 'manual' ? 0.7 : 0.55, dashArray: it.kind === 'manual' ? null : '4 3' } })
        .bindTooltip(it.kind === 'manual' ? `직접 지정한 도로 ${fmt(it.area)}㎡ · 누르면 지정 취소` : it.partial ? `부분 확폭(병목, 검토용) · ${esc(it.jibun)} 약 ${it.from}m → ${it.to}m · ${fmt(it.area)}㎡ — 구역에 짧게 닿은 구간만 넓힘` : `${it.kind === 'entry' ? '진입도로' : '주변 도로'} 확폭(제안) · ${esc(it.jibun)} 약 ${it.from}m → ${it.to}m · ${fmt(it.area)}㎡`, { sticky: true }).addTo(layer);
      if (it.partial) {
        const svg = lyr.getLayers()[0] && lyr.getLayers()[0]._path && lyr.getLayers()[0]._path.ownerSVGElement;
        if (svg && !svg.querySelector('#jbsHatch')) svg.insertAdjacentHTML('afterbegin', `<defs><pattern id="jbsHatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" stroke="${c('--warn')}" stroke-width="2"/></pattern></defs>`);
        lyr.eachLayer(l => l._path && l._path.setAttribute('fill', 'url(#jbsHatch)'));
      }
      if (it.kind === 'manual') lyr.on('click', ev => {
        L.DomEvent.stop(ev);
        const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.manualRoads) return;
        z.infra.manualRoads.splice(it.idx, 1); saveZ(); INFRA.memo = {}; render(); toast('도로 지정을 취소했습니다');
      });
    });
    if (inf.parkGeom) this.movable(L.geoJSON(inf.parkGeom, { style: { color: c('--ok'), weight: 2, fillColor: c('--ok'), fillOpacity: 0.35 } })
      .bindTooltip(`공원·녹지(제안) ${fmt(inf.parkArea)}㎡ · 끌어서 옮기기${inf.parkArea < inf.parkNeed * 0.95 ? ` — 구역 경계·도로에 걸려 필요 ${fmt(inf.parkNeed)}㎡보다 작음, 위치를 옮기세요` : ''}`, { sticky: true }).addTo(layer), 'park', this.centerOf(inf.parkGeom));
    if (inf.schoolGeom) this.movable(L.geoJSON(inf.schoolGeom, { style: { color: c('--accent'), weight: 2, fillColor: c('--accent'), fillOpacity: 0.3 } })
      .bindTooltip(`학교용지(제안) ${fmt(inf.schoolArea)}㎡ · 끌어서 옮기기`, { sticky: true }).addTo(layer), 'school', this.centerOf(inf.schoolGeom));
    // 맞닿은 시설 사이 나눔선(맨 위에): 끌면 두 시설이 면적을 주고받음(합은 그대로)
    if (inf.paired) { const sz = (Z.zones[a.key].infra || {}).sz || {}, mn = k => num((sz[k] || {}).min); this.divider(layer, inf.paired, { park: mn('park') || inf.parkLegal || 0, rel: mn('rel'), school: mn('school') }); }
  },
  // 맞닿은 두 블록을 경계 따라 한 띠로 다시 그림. items: [[kind, geom, 목표면적], …] → { kind: geom } 또는 null
  // split: 나눔선을 끌어 정한 { kind, area } — 띠(위치·깊이)는 그대로 두고 나누는 자리만 바꿈
  pairBand(zone, minus, items, split, edgeLL) {
    const U = safeUnion(items.map(x => x[1]));
    const c0 = turf.centroid(U).geometry.coordinates, lon0 = c0[0], lat0 = c0[1];
    const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const toM = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    // 기준 경계선: 두 시설이 가장 길게 맞닿은 구역 경계 변(2m 간격으로 재서 시설 2.5m 안에 드는 길이). 없으면 가장 가까운 변
    let best = Infinity, ed = null, bestLen = 0, edL = null;
    let nearU = null; try { nearU = turf.buffer(U, 2.5, { units: 'meters' }); } catch (er) { nearU = null; }
    const zr = zone.geometry.type === 'Polygon' ? [zone.geometry.coordinates[0]] : zone.geometry.coordinates.map(p => p[0]);
    zr.forEach(r => { for (let i = 0; i + 1 < r.length; i++) {
      const a = toM(r[i]), b = toM(r[i + 1]), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 4) continue;
      const t = Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)), d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
      if (d < best) { best = d; ed = [a, b]; }
      if (nearU) {
        const Ls = Math.sqrt(L2), n = Math.max(1, Math.floor(Ls / 2)); let c = 0;
        for (let k = 0; k <= n; k++) { const q = toLL([a[0] + dx * k / n, a[1] + dy * k / n]); if (turf.booleanPointInPolygon(q, nearU)) c++; }
        const len = c / (n + 1) * Ls;
        if (len > bestLen) { bestLen = len; edL = [a, b]; }
      }
    } });
    if (edL && bestLen >= 8) ed = edL;
    // 기억해 둔 기준 변이 있고 묶음에서 60m 안이면 그 변을 그대로 씀
    if (edgeLL && edgeLL.length === 2) {
      const ea = toM(edgeLL[0]), eb = toM(edgeLL[1]), dx = eb[0] - ea[0], dy = eb[1] - ea[1], L2 = dx * dx + dy * dy;
      if (L2 > 4) { const t = Math.max(0, Math.min(1, -(ea[0] * dx + ea[1] * dy) / L2)); if (Math.hypot(ea[0] + t * dx, ea[1] + t * dy) < 60) ed = [ea, eb]; }
    }
    if (!ed) return null;
    const [a, b] = ed, L = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    let nx = -uy, ny = ux; if ((0 - a[0]) * nx + (0 - a[1]) * ny < 0) { nx = -nx; ny = -ny; }   // 경계 → 안쪽
    const P = (u, v) => toLL([a[0] + ux * u + nx * v, a[1] + uy * u + ny * v]);
    const coordsOf = g => { const gg = g.geometry || g; return gg.type === 'Polygon' ? gg.coordinates.flat() : gg.coordinates.flat(2); };
    const us = coordsOf(U).map(q => { const m = toM(q); return (m[0] - a[0]) * ux + (m[1] - a[1]) * uy; });
    const u0 = Math.min(...us), u1 = Math.max(...us);
    let free = zone; if (minus) { try { free = turf.difference(zone, minus) || zone; } catch (er) { free = zone; } }
    const box = (ua, ub, v) => turf.polygon([[P(ua, -60), P(ub, -60), P(ub, v), P(ua, v), P(ua, -60)]]);
    // 잘린 조각이 여럿이면(구역이 오목해서) 가장 큰 한 덩어리만 — 시설이 둘로 갈라지지 않게
    const cut = (ua, ub, v) => {
      let g = null; try { g = turf.intersect(box(ua, ub, v), free); } catch (er) { return null; }
      if (!g || g.geometry.type !== 'MultiPolygon') return g;
      return g.geometry.coordinates.map(c => turf.polygon(c)).sort((x, y) => turf.area(y) - turf.area(x))[0];
    };
    const total = items.reduce((t, x) => t + x[2], 0);
    // 깊이 v: 띠 면적 = 두 시설 면적 합
    let lo = 1, hi = 200, band = null;
    for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2, g = cut(u0, u1, m), A = g ? turf.area(g) : 0; if (A >= total) { hi = m; band = g; } else lo = m; }
    if (!band) return null;
    const v = hi;
    // 나누는 선: 묶음 안에서 가운데가 경계선 방향으로 앞선 시설부터 차례로
    const order = items.map(x => { const c = toM(turf.centroid(x[1]).geometry.coordinates); return [x, (c[0] - a[0]) * ux + (c[1] - a[1]) * uy]; }).sort((p, q) => p[1] - q[1]).map(p => p[0]);
    const first = order[0].slice();
    let custom = false;
    if (split && split.area > 0) {
      const fa = split.kind === first[0] ? split.area : total - split.area;
      first[2] = Math.max(total * 0.05, Math.min(total * 0.95, fa)); custom = true;
    }
    let sl = u0, sh = u1, sp = null;
    for (let k = 0; k < 24; k++) { const m = (sl + sh) / 2, g = cut(u0, m, v), A = g ? turf.area(g) : 0; if (A >= first[2]) { sh = m; sp = g; } else sl = m; }
    if (!sp) return null;
    const rest = cut(sh, u1, v);
    if (!rest) return null;
    // 면적이 5% 넘게 어긋나면(띠가 구역 모양에 막힘) 묶지 않고 각자 둠
    if (Math.abs(turf.area(sp) + turf.area(rest) - total) > total * 0.05) return null;
    if (!custom && (Math.abs(turf.area(sp) - first[2]) > first[2] * 0.05 || Math.abs(turf.area(rest) - order[1][2]) > order[1][2] * 0.05)) return null;
    // 두 시설 사이 나눔선(끌어서 면적을 주고받는 손잡이)과, 선 위치 → 앞 시설 면적 계산 함수
    const toU = ll => { const m = toM([ll.lng, ll.lat]); return (m[0] - a[0]) * ux + (m[1] - a[1]) * uy; };
    const areaAt = u => { const g = cut(u0, u, v); return g ? turf.area(g) : 0; };
    const lineAt = u => { const p1 = P(u, 0), p2 = P(u, v); return [[p1[1], p1[0]], [p2[1], p2[0]]]; };
    const usedEdge = [toLL(a), toLL(b)].map(q => [+q[0].toFixed(7), +q[1].toFixed(7)]);
    return { [order[0][0]]: sp, [order[1][0]]: rest, pair: { edgeLL: usedEdge, kinds: [order[0][0], order[1][0]], total, u0, u1, s: sh, toU, areaAt, lineAt, custom, a1: turf.area(sp), a2: turf.area(rest) } };
  },
  // mins: { park: 최소 면적 } — 끌다가 그 아래로 줄어들면 더 못 가게 막음
  divider(layer, pr, mins = {}) {
    const name = k => ({ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[k]);
    // 보이는 선: 흰 실선(가는 테두리) + 가운데 작은 손잡이
    const edge = L.polyline(pr.lineAt(pr.s), { color: '#333', weight: 4, opacity: 0.35, interactive: false }).addTo(layer);
    const line = L.polyline(pr.lineAt(pr.s), { color: '#fff', weight: 2, opacity: 0.95, interactive: false }).addTo(layer);
    const mid = ll => [(ll[0][0] + ll[1][0]) / 2, (ll[0][1] + ll[1][1]) / 2];
    const grip = L.marker(mid(pr.lineAt(pr.s)), { keyboard: false, icon: L.divIcon({ className: 'div-grip', html: '<span>⇆</span>', iconSize: [26, 18], iconAnchor: [13, 9] }) }).addTo(layer);
    const hit = L.polyline(pr.lineAt(pr.s), { color: '#000', weight: 30, opacity: 0 }).addTo(layer)
      .bindTooltip(`${name(pr.kinds[0])} ↔ ${name(pr.kinds[1])} 나눔선 · 끌어서 면적 주고받기`, { sticky: true });
    hit.on('add', () => { const el = hit.getElement(); if (el) el.style.cursor = 'ew-resize'; });
    const el0 = hit.getElement && hit.getElement(); if (el0) el0.style.cursor = 'ew-resize';
    // 나눔선 가까이(화면 28px 안)에서 시설을 잡으면 시설을 옮기지 않고 나눔선을 끌게 함(옆 시설이 딴 데로 가지 않게)
    this.divNear = ev => {
      const ll = hit.getLatLngs(), p = LM.latLngToContainerPoint(ev.latlng), A = LM.latLngToContainerPoint(ll[0]), B = LM.latLngToContainerPoint(ll[1]);
      const dx = B.x - A.x, dy = B.y - A.y, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p.x - A.x) * dx + (p.y - A.y) * dy) / L2));
      return Math.hypot(p.x - (A.x + t * dx), p.y - (A.y + t * dy)) < 28;
    };
    this.divStart = ev => start(ev);
    const start = ev => {
      if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
      L.DomEvent.stop(ev); LM.dragging.disable(); hit.closeTooltip();
      let lo = pr.u0 + 3, hi = pr.u1 - 3;
      // 공원 최소 면적(법정·제안 기준) 아래로는 못 가게: 나눔선이 갈 수 있는 끝을 미리 구함
      pr.kinds.forEach((k, idx) => {
        const m = num(mins[k]); if (!(m > 0)) return;
        const ok = u => (idx === 0 ? pr.areaAt(u) : pr.total - pr.areaAt(u)) >= m - 0.5;
        if (!ok(pr.s)) { if (idx === 0) lo = Math.max(lo, pr.s); else hi = Math.min(hi, pr.s); return; }   // 이미 작으면 더 줄어드는 쪽만 막음
        let a0 = idx === 0 ? lo : pr.s, b0 = idx === 0 ? pr.s : hi;   // 앞 시설이면 왼쪽 끝, 뒤 시설이면 오른쪽 끝을 찾음
        for (let it = 0; it < 22; it++) { const mm = (a0 + b0) / 2; if (idx === 0 ? ok(mm) : !ok(mm)) { if (idx === 0) b0 = mm; else b0 = mm; } else { if (idx === 0) a0 = mm; else a0 = mm; } }
        if (idx === 0) lo = Math.max(lo, b0); else hi = Math.min(hi, a0);
      });
      let blocked = false; const loMin = lo > pr.u0 + 3 + 0.01, hiMin = hi < pr.u1 - 3 - 0.01;
      let u = pr.s;
      const u00 = pr.toU(ev.latlng);   // 잡은 자리에서 끈 만큼만 옮김(처음에 튀지 않게)
      const mv = e => { const want = pr.s + pr.toU(e.latlng) - u00; u = Math.max(lo, Math.min(hi, want)); if ((loMin && want < lo - 0.5) || (hiMin && want > hi + 0.5)) { if (!blocked) { blocked = true; toast(`${name(want < lo ? pr.kinds[0] : pr.kinds[1])} 최소 면적보다 작아지지 않게 여기서 멈춥니다`); } } else blocked = false; const ll = pr.lineAt(u); line.setLatLngs(ll); edge.setLatLngs(ll); hit.setLatLngs(ll); grip.setLatLng(mid(ll)); };
      const up = () => {
        LM.off('mousemove', mv); LM.off('mouseup', up); document.removeEventListener('mouseup', up); LM.dragging.enable();
        if (Math.abs(u - pr.s) < 0.5) return;
        const a1 = Math.round(pr.areaAt(u)), a2 = Math.round(pr.total - a1);
        const z = Z.zones[S.region]; z.infra = z.infra || {};
        z.infra.pairSplit = { kind: pr.kinds[0], area: a1 };   // 띠는 그대로, 나누는 자리만 기억
        saveZ(); this.memo = {}; render();
        toast(`${name(pr.kinds[0])} ${fmt(a1)}㎡ · ${name(pr.kinds[1])} ${fmt(a2)}㎡로 나눴습니다(두 시설 합 ${fmt(pr.total)}㎡ 그대로)`);
      };
      LM.on('mousemove', mv); LM.on('mouseup', up); document.addEventListener('mouseup', up);
    };
    hit.on('mousedown', start);
    grip.on('mousedown', start);
    grip.bindTooltip(`${name(pr.kinds[0])} ↔ ${name(pr.kinds[1])} 나눔선 · 끌어서 면적 주고받기`, { direction: 'top', offset: [0, -8] });
  },
  // 구역 안 필지 중 국공유이거나 공공 지목인 것 → 근거와 판정(확실 / 가능성 높음 / 아닐 가능성 / 사유(참고))
  judgeExisting(a, z) {
    const Rg = D.regions[a.key] || {}, fac = (z.roads && z.roads.fac) || [];
    const facU = fac.length ? (() => { try { return safeUnion(fac.map(f => ({ type: 'Feature', properties: {}, geometry: f.geom }))); } catch (er) { return null; } })() : null;
    const out = [];
    a.ps.forEach(p => {
      const pub = isPublicOwner(p.own), jm = isPublicJimok(p.jimok);
      if (!pub && !jm) return;
      const f = p.geom ? { type: 'Feature', properties: {}, geometry: p.geom } : null;
      const lu = /도로|하천|구거|공원|제방/.test(p.landUse || '');
      let facR = 0, w = 99;
      if (f) {
        try { if (facU) { const x = turf.intersect(f, facU); facR = x ? turf.area(x) / turf.area(f) : 0; } } catch (er) { facR = 0; }
        try { const A = turf.area(f), P = turf.length(turf.polygonToLine(f), { units: 'kilometers' }) * 1000; w = 2 * A / (P || 1); } catch (er) { w = 99; }
      }
      const bl = ((Rg.blds || {})[p.pnu] || []), thin = w < 8, fc = facR >= 0.5;
      const cover = p.bldOver == null ? null : p.bldOver;            // 건물 도형이 필지를 덮는 비율(전체)
      const coreC = (p.bldCore == null || p.bldCore < 0) ? cover : p.bldCore;           // 가장자리 1.2m를 뺀 안쪽을 덮는 비율(처마·경계 어긋남 제외)
      // 건물 판단은 안쪽 기준: 길쭉한 도로 필지는 양쪽 처마만으로도 전체 비율이 크게 나옴
      const bldOn = coreC != null ? coreC > 0.2 : bl.length > 0, noBld = coreC != null ? coreC <= 0.05 : !bl.length;
      // 건물 점유 면적(㎡): 안쪽(가장자리 1.2m 뺌)을 건물이 덮은 넓이. 안쪽이 없는 아주 작은 필지는 전체 겹침 넓이
      //  기반시설 확보 목표·무상양도 면적에서는 이만큼을 보수적으로 뺌(사실상 건물 부지로 쓰여 도로·공원으로 확보된다고 보기 어려움)
      const inR = z.inArea[p.pnu] ?? 1, fullA = (p.base ?? p.area) * inR;
      let occ = 0;
      if (coreC != null && coreC > 0.05 && f) {
        try {
          if (p.bldCore == null || p.bldCore < 0) occ = p.bldA != null ? p.bldA : (p.bldOver || 0) * turf.area(f);
          else if (p.bldCoreA != null) occ = p.bldCoreA;
          else { const core = turf.buffer(f, -1.2, { units: 'meters' }); occ = core ? p.bldCore * turf.area(core) : 0; }
        } catch (er) { occ = 0; }
        occ = Math.min(fullA, occ * inR);
      }
      const nLedger = bl.filter(b => b.src === '대장').length, nGis = bl.length - nLedger;
      // 지목에 맞는 도시계획시설이 결정돼 있는지(공원 지목인데 공원 결정이 없으면 해제·미조성 의심)
      let facKind = '';
      if (f && fac.length) { try { const hit = fac.filter(x => { const xi = turf.intersect(f, { type: 'Feature', properties: {}, geometry: x.geom }); return xi && (turf.area(xi) >= turf.area(f) * 0.05 || turf.area(xi) >= 30); }); facKind = [...new Set(hit.map(x => x.name))].join(', '); } catch (er) { facKind = ''; } }
      // 지목은 공공(도로·공원 등)인데 토지이용상황이 주거·상업 등이면 실제 쓰임이 달라 '확인 필요'
      //  확실: 공공 지목이고 이용상황도 맞고 건물이 없음
      //  확인 필요: 지목·이용상황·건물이 서로 어긋남(지목은 공공인데 주거로 쓰임, 이용상황은 도로인데 건물이 덮음 등)
      //  가능성 높음: 지목은 '대'인데 이용상황 도로등·도시계획시설 안·(길쭉+건물 없음) 중 하나
      const conflict = (jm && !!p.landUse && !lu) || ((jm || lu) && bldOn);
      const grade = !pub ? '사유(참고)' : conflict ? '확인 필요' : (jm && (lu || !p.landUse)) ? '확실' : (lu || fc || (thin && noBld)) ? '가능성 높음' : '아닐 가능성';
      out.push({ p, pub, jm, lu, fc, thin, noBld, cover, coreC, bldOn, nLedger, nGis, facKind, w: Math.round(w * 10) / 10, grade, area: fullA, occ, useA: Math.max(0, fullA - occ) });
    });
    const ord = { '확실': 0, '확인 필요': 1, '가능성 높음': 2, '아닐 가능성': 3, '사유(참고)': 4 };
    return out.sort((x, y) => ord[x.grade] - ord[y.grade] || y.area - x.area);
  },
  // 지금 그려진 블록의 가운데 [lat, lng] — 끌어 옮길 때 기준(저장된 위치가 구역 밖이어도 보이는 자리에서 옮겨지게)
  centerOf(g) { if (!g) return null; try { const c = turf.centroid(g).geometry.coordinates; return [c[1], c[0]]; } catch (er) { return null; } },
  // 공원·학교·종교용지 도형을 마우스로 끌어 옮기기. center: 지금 블록 중심 [lat, lng]
  movable(lyr, kind, center) {
    if (!center) return lyr;
    const shift = (ll, d) => Array.isArray(ll) ? ll.map(x => shift(x, d)) : L.latLng(ll.lat + d[0], ll.lng + d[1]);
    lyr.eachLayer(l => { const el = l.getElement && l.getElement(); if (el) el.style.cursor = 'move'; });
    lyr.on('mousedown', ev => {
      if (CUT.active || ZK.picking || drawH || editH || S.placing || (typeof RefOverlay !== "undefined" && RefOverlay.step)) return;
      const pk = { religion: 'rel', park: 'park', school: 'school' }[kind];
      if (this.divNear && this.curPair && this.curPair.kinds.includes(pk) && this.divNear(ev)) { this.divStart(ev); return; }
      L.DomEvent.stop(ev);
      const start = ev.latlng, orig = []; lyr.eachLayer(l => orig.push([l, l.getLatLngs()]));
      let d = [0, 0];
      LM.dragging.disable(); lyr.closeTooltip && lyr.closeTooltip();
      const mv = e => {
        d = [e.latlng.lat - start.lat, e.latlng.lng - start.lng]; orig.forEach(([l, ll]) => l.setLatLngs(shift(ll, d)));
        // 지도 가장자리나 화면 아래 끝에 가까우면 지도를 그쪽으로 조금씩 밀어 계속 끌 수 있게
        const sz = LM.getSize(), p = e.containerPoint, ce = e.originalEvent || {}, E = 40;
        const vb = window.innerHeight - (ce.clientY || 0) < E;
        const px = p.x < E ? -15 : p.x > sz.x - E ? 15 : 0, py = p.y < E ? -15 : (p.y > sz.y - E || vb) ? 15 : 0;
        if (px || py) LM.panBy([px, py], { animate: false });
      };
      const up = () => {
        LM.off('mousemove', mv); LM.off('mouseup', up); document.removeEventListener('mouseup', up); LM.dragging.enable();
        const px = LM.latLngToContainerPoint(start).distanceTo(LM.latLngToContainerPoint(L.latLng(start.lat + d[0], start.lng + d[1])));
        if (px < 4) { orig.forEach(([l, ll]) => l.setLatLngs(ll)); return; }
        const pk2 = { religion: 'rel', park: 'park', school: 'school' }[kind];
        if (this.curPair && this.curPair.kinds.includes(pk2) && this.curInf) {
          // 한 띠로 묶인 시설은 둘이 같이 움직임(띠 모양 유지)
          const z = Z.zones[S.region]; z.infra = z.infra || {};
          const geo = { park: this.curInf.parkGeom, rel: this.curInf.relGeom };
          this.curPair.kinds.forEach(k => { const c = this.centerOf(geo[k]); if (c) z.infra[k === 'park' ? 'parkC' : 'relC'] = [c[0] + d[0], c[1] + d[1]]; });
          delete z.infra.pairEdge;   // 새 자리에서 기준 변을 다시 고름
          saveZ(); this.memo = {}; render(); toast('붙어 있는 두 시설을 같이 옮겼습니다');
          return;
        }
        this.place(kind, L.latLng(center[0] + d[0], center[1] + d[1]));
      };
      LM.on('mousemove', mv); LM.on('mouseup', up); document.addEventListener('mouseup', up);
    });
    return lyr;
  },
  place(kind, latlng) {
    const z = Z.zones[S.region]; if (!z) return;
    z.infra = z.infra || {};
    if (kind.startsWith('gate:')) { GATE.put(z, kind.slice(5), latlng); return; }
    z.infra[{ park: 'parkC', school: 'schoolC', religion: 'relC' }[kind]] = [latlng.lat, latlng.lng];
    // 시설을 옮기면 그 시설에 붙였던 획지는 풀어 줌(자리가 바뀌어 다른 땅이 붙지 않게)
    if (z.infra.addTo) z.infra.addTo = z.infra.addTo.filter(m => m.kind !== { park: 'park', school: 'school', religion: 'rel' }[kind]);
    const fk = { park: 'park', school: 'school' }[kind], fitWas = fk && z.infra.fit && z.infra.fit[fk] && z.infra.fit[fk].mode && z.infra.fit[fk].mode !== 'auto';
    if (fitWas) z.infra.fit[fk].mode = 'auto';   // 끌어서 옮기면 사용자가 정한 자리가 우선(배치 방식은 자동으로)
    saveZ(); this.memo = {};
    S.placing = null; $id('lmap').classList.remove('picking');
    render();
    // 놓은 자리에 정사각형이 안 들어가 멀리 밀려났으면 '옮겼습니다'라고 하지 않고 사실대로 알림
    const nm = { park: '공원·녹지', school: '학교용지', religion: '종교용지(대체부지)' }[kind];
    const g = this.curInf && this.curInf[{ park: 'parkGeom', school: 'schoolGeom', religion: 'relGeom' }[kind]];
    let far = 0;
    try { if (g && !turf.booleanPointInPolygon(turf.point([latlng.lng, latlng.lat]), g)) far = turf.pointToLineDistance(turf.point([latlng.lng, latlng.lat]), turf.polygonToLine(turf.flatten(g).features[0]), { units: 'meters' }); } catch (er) { far = 0; }
    if (far > 15) toast(`그 자리에는 ${nm}이(가) 반듯하게 들어가지 않아 ${Math.round(far)}m 떨어진 곳에 놓였습니다 — 아래 '배치 방식'에서 감싸기·곧게·스케치를 써 보세요`, 7000);
    else toast(`${nm} 위치를 옮겼습니다${fitWas ? " — 배치 방식은 '자동(끌어 옮기기)'로 바꿨습니다" : ''}`);
  },
};

/* ===== 기반시설 배치 방식 화면 (urban/placefit.js 계산) =====
 z.infra.fit[kind] = { mode: 'auto'|'wrap'|'clean'|'sketch'|'upload', anchor: 'rel'|'park', dir: 'N'|'S'|'E'|'W', sketch: GeoJSON, keepSize, sheet: 용지 meta }
 - 자동: 지금처럼 정사각형 블록을 끌어 옮김(INFRA.block)
 - 감싸기·곧게: 기준 시설(종교용지·공원)과 방향을 고르면 그쪽 빈 땅을 구역 모양대로 채움(모자라면 감싸기/ㄱ자로 이어 붙임)
 - 스케치: 지도에 마우스·손가락으로 대충 그은 모양 → 구역 안 빈 땅으로 자르고 필요 면적에 맞춤
 - 손그림: 스케치 용지(PNG) 내려받기 → 색 펜으로 그리기 → 올리기. 올린 그림 파일은 화면에서 모양만 읽고 어디에도 저장·전송하지 않음 */
const FITUI = {
  KIND: { park: '공원·녹지', school: '학교용지' },
  MODES: [['auto', '자동(끌어 옮기기)'], ['wrap', '감싸기'], ['clean', '깔끔하게(곧게)'], ['sketch', '마우스 스케치'], ['upload', '손그림 올리기']],
  get(key, kind) { const z = Z.zones[key]; return ((z && z.infra && z.infra.fit) || {})[kind] || { mode: 'auto' }; },
  set(kind, f) { const z = Z.zones[S.region]; if (!z) return; z.infra = z.infra || {}; z.infra.fit = z.infra.fit || {}; z.infra.fit[kind] = z.infra.fit[kind] || { mode: 'auto' }; f(z.infra.fit[kind]); saveZ(); INFRA.memo = {}; render(); },
  panel(key, inf) {
    if (!window.PlaceFit) return '';
    const kinds = ['park'].concat(inf.szSchool && inf.szSchool.A > 0 ? ['school'] : []);
    return `<div class="fit-wrap" style="margin-top:10px">` + kinds.map(k => {
      const o = this.get(key, k), m = o.mode || 'auto', fm = (inf.fitMsg || {})[k];
      const anchors = [['rel', '종교용지']].concat(k === 'school' ? [['park', '공원·녹지']] : []);
      const hasAnc = { rel: !!inf.relGeom, park: !!inf.parkGeom };
      let sub = '';
      if (m === 'wrap' || m === 'clean') {
        sub = `<div style="margin-top:6px">기준 시설 <select data-fitanchor="${k}">${anchors.map(([v, t]) => `<option value="${v}" ${(o.anchor || 'rel') === v ? 'selected' : ''} ${hasAnc[v] ? '' : 'disabled'}>${t}${hasAnc[v] ? '' : '(없음)'}</option>`).join('')}</select>
          &nbsp;방향 <span class="seg" role="group" aria-label="붙일 방향">${[['N', '북'], ['E', '동'], ['S', '남'], ['W', '서']].map(([d, t]) => `<button type="button" data-fitdir="${k}:${d}" aria-pressed="${(o.dir || 'N') === d}">${t}</button>`).join('')}</span></div>
          <span class="u">${m === 'wrap' ? '그 방향 빈 땅을 구역 모양대로 먼저 채우고, 모자라면 기준 시설 옆으로 감싸 이어 붙입니다.' : '기준 시설 변 폭 그대로 곧은 띠로 붙이고, 막히면 채울 만큼 채운 뒤 옆으로 곧게 꺾습니다(ㄱ자).'}</span>`;
      } else if (m === 'sketch') {
        sub = `<div style="margin-top:6px"><button type="button" class="btn sm" data-fitpoly="${k}">꼭짓점 찍어 그리기(반듯하게)</button>
          <button type="button" class="btn ghost sm" data-fitdraw="${k}">손으로 그리기</button>
          ${o.sketch ? `<button type="button" class="btn ghost sm" data-fitclear="${k}">그린 모양 지우기</button>` : ''}
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitkeep="${k}" ${o.keepSize ? 'checked' : ''}> 그린 크기 그대로(면적 맞추지 않음)</label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitstraight="${k}" ${o.straight !== false ? 'checked' : ''}> 가르는 선은 곧게 펴기</label></div>
          <span class="u"><b>꼭짓점 찍어 그리기</b>: 지도에서 모서리를 차례로 누르고, 첫 점을 다시 누르거나 두 번 눌러 끝냅니다(되돌리기 Backspace, 취소 Esc). 직선으로 이어져 반듯한 모양이 됩니다. <b>점 두 개만 찍고 두 번 누르면</b> 구역을 가르는 곧은 선이 됩니다(선 바깥쪽이 시설). <b>손으로 그리기</b>: 누른 채 한 바퀴(또는 구역을 가로지르는 선 한 줄 — 선 바깥쪽 작은 쪽이 시설). 구역 밖·도로·다른 시설에 걸린 부분은 잘라 내고, 모양은 그대로 둔 채 같은 비율로 키우거나 줄여 필요 면적에 맞춥니다.</span>`;
      } else if (m === 'upload') {
        sub = `<div style="margin-top:6px"><button type="button" class="btn ghost sm" data-fitsheet="${k}">① 스케치 용지 내려받기</button>
          <label class="btn ghost sm" style="cursor:pointer">② 그린 그림 올리기<input type="file" accept="image/*" data-fitupload="${k}" hidden></label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitkeep="${k}" ${o.keepSize ? 'checked' : ''}> 그린 크기 그대로</label>
          <label class="zk-opts" style="display:inline"><input type="checkbox" data-fitstraight="${k}" ${o.straight !== false ? 'checked' : ''}> 가르는 선은 곧게 펴기</label></div>
          <span class="u">용지(구역·시설이 회색으로 그려진 그림)를 그림판·휴대폰·태블릿에서 열어 빨강·파랑 같은 색 펜으로 원하는 자리를 그린 뒤 그대로 올리세요. 끝이 덜 닫혀도 됩니다. <b>구역을 가로지르는 선 한 줄</b>만 그으면 그 선 바깥쪽(작은 쪽)을 시설로 씁니다(면적을 맞출 때는 선을 평행으로 옮김, 선 자리 그대로 쓰려면 '그린 크기 그대로'). 자르거나 돌리면 위치가 맞지 않습니다. 종이에 출력해 그린 사진은 아직 안 되고 스캔본은 됩니다. 올린 그림은 모양만 읽고 저장하지 않습니다.${o.sheet ? '' : ' <b>먼저 ①로 용지를 내려받으세요.</b>'}</span>`;
      }
      const msg = m !== 'auto' && fm ? `<div class="${fm.ok ? '' : 'warn'}" style="margin-top:6px"><b>${fm.ok ? '배치 결과' : '확인 필요'}</b> ${esc(fm.msg)}</div>`
        : (m === 'sketch' && !o.sketch) || (m === 'upload' && !o.sketch) ? '<div class="u" style="margin-top:6px">아직 그린 모양이 없어 자동 배치로 보이고 있습니다.</div>' : '';
      return `<div class="fit-box" style="border:1px solid var(--line,#ddd);border-radius:8px;padding:8px 10px;margin-top:6px"><b>${this.KIND[k]} 배치 방식</b>
        <div class="seg" role="group" aria-label="${this.KIND[k]} 배치 방식" style="margin-top:4px;flex-wrap:wrap">${this.MODES.map(([v, t]) => `<button type="button" data-fitmode="${k}:${v}" aria-pressed="${m === v}">${t}</button>`).join('')}</div>${sub}${msg}</div>`;
    }).join('') + `</div>`;
  },
  bind(side) {
    side.querySelectorAll('[data-fitmode]').forEach(b => b.onclick = () => { const [k, v] = b.dataset.fitmode.split(':'); this.set(k, o => { o.mode = v; if (!o.anchor) o.anchor = 'rel'; if (!o.dir) o.dir = 'N'; }); });
    side.querySelectorAll('[data-fitdir]').forEach(b => b.onclick = () => { const [k, d] = b.dataset.fitdir.split(':'); this.set(k, o => { o.dir = d; }); });
    side.querySelectorAll('[data-fitanchor]').forEach(el => el.onchange = () => this.set(el.dataset.fitanchor, o => { o.anchor = el.value; }));
    side.querySelectorAll('[data-fitkeep]').forEach(el => el.onchange = () => this.set(el.dataset.fitkeep, o => { o.keepSize = el.checked; }));
    side.querySelectorAll('[data-fitstraight]').forEach(el => el.onchange = () => this.set(el.dataset.fitstraight, o => { o.straight = el.checked; }));
    side.querySelectorAll('[data-fitdraw]').forEach(b => b.onclick = () => this.draw(b.dataset.fitdraw));
    side.querySelectorAll('[data-fitclear]').forEach(b => b.onclick = () => this.set(b.dataset.fitclear, o => { o.sketch = null; }));
    side.querySelectorAll('[data-fitpoly]').forEach(b => b.onclick = () => this.drawPoly(b.dataset.fitpoly));
    side.querySelectorAll('[data-fitsheet]').forEach(b => b.onclick = () => this.sheet(b.dataset.fitsheet));
    side.querySelectorAll('[data-fitupload]').forEach(el => el.onchange = () => { const f = el.files && el.files[0]; el.value = ''; if (f) this.upload(el.dataset.fitupload, f); });
  },
  // 꼭짓점 찍어 그리기: 누를 때마다 점을 더해 직선으로 이음 → 첫 점 다시 누르기·두 번 누르기·Enter로 끝(반듯한 공원·녹지용)
  drawPoly(kind) {
    if (!LM) return;
    const el = LM.getContainer(); let pts = [], shape = null, guide = null, lastT = 0, downAt = null;
    LM.doubleClickZoom.disable(); el.classList.add('picking');
    toast('모서리를 차례로 누르세요 — 첫 점을 다시 누르거나 두 번 눌러 끝냅니다 (Backspace 되돌리기 · Esc 취소)', 6000);
    const ll = e => LM.mouseEventToLatLng(e);
    const redraw = hover => {
      const all = hover ? pts.concat([hover]) : pts;
      if (shape) shape.remove(); if (guide) guide.remove();
      shape = all.length >= 3 ? L.polygon(all, { color: '#d6336c', weight: 3, fillOpacity: 0.12, interactive: false }).addTo(LM) : L.polyline(all, { color: '#d6336c', weight: 3, interactive: false }).addTo(LM);
      guide = L.layerGroup(pts.map((p, i) => L.circleMarker(p, { radius: i ? 4 : 6, color: '#d6336c', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }))).addTo(LM);
    };
    const end = save => {
      el.removeEventListener('pointerdown', pd, true); el.removeEventListener('pointerup', pu, true); el.removeEventListener('pointermove', pm, true); window.removeEventListener('keydown', kd);
      el.classList.remove('picking'); LM.doubleClickZoom.enable(); if (shape) shape.remove(); if (guide) guide.remove();
      setTimeout(() => { if (this._polyOff) this._polyOff(); }, 0);
      if (save && pts.length >= 3) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'Polygon', coordinates: [[...pts.map(p => [p.lng, p.lat]), [pts[0].lng, pts[0].lat]]] }; });
      else if (save && pts.length === 2) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }; });   // 점 두 개 = 곧은 나누는 선
      else if (save) toast('점을 2개(가르는 직선) 또는 3개 이상(모양) 찍어 주세요');
    };
    // 누르고 거의 움직이지 않고 떼면 '점 찍기', 끌면 지도 이동(그대로 둠)
    const pd = e => { if (e.button !== 0) return; downAt = [e.clientX, e.clientY]; e.stopPropagation(); };
    const pu = e => {
      if (!downAt) return; const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]); downAt = null;
      if (moved > 5) return;
      e.stopPropagation(); e.preventDefault();
      const p = ll(e), now = Date.now();
      if (pts.length >= 3 && LM.latLngToContainerPoint(p).distanceTo(LM.latLngToContainerPoint(pts[0])) < 12) { end(true); return; }
      if (now - lastT < 350 && pts.length >= 2) { end(true); return; }
      lastT = now; pts.push(p); redraw();
    };
    const pm = e => { if (pts.length && !downAt) redraw(ll(e)); };
    const kd = e => { if (e.key === 'Escape') end(false); else if (e.key === 'Enter') end(true); else if (e.key === 'Backspace' && pts.length) { e.preventDefault(); pts.pop(); redraw(); } };
    const ck = e => { e.stopPropagation(); };   // 점 찍는 동안 지도 클릭(필지 넣기 등)이 같이 일어나지 않게
    el.addEventListener('pointerdown', pd, true); el.addEventListener('pointerup', pu, true); el.addEventListener('pointermove', pm, true); el.addEventListener('click', ck, true); window.addEventListener('keydown', kd);
    this._polyOff = () => el.removeEventListener('click', ck, true);
  },
  // 지도에 손으로 긋기(마우스·터치 모두 — pointer 이벤트)
  draw(kind) {
    if (!LM) return;
    const el = LM.getContainer(); let pts = [], line = null, down = false;
    LM.dragging.disable(); el.classList.add('picking'); el.style.touchAction = 'none';
    toast('지도에서 누른 채로 원하는 자리를 한 바퀴 그리세요 — 손을 떼면 끝납니다 (Esc: 취소)', 4000);
    const ll = e => LM.mouseEventToLatLng(e);
    const end = save => {
      el.removeEventListener('pointerdown', pd, true); el.removeEventListener('pointermove', pm, true);
      window.removeEventListener('pointerup', pu, true); window.removeEventListener('pointercancel', pu, true); window.removeEventListener('keydown', kd);
      LM.dragging.enable(); el.classList.remove('picking'); el.style.touchAction = ''; if (line) line.remove();
      if (save && pts.length >= 6) this.set(kind, o => { o.mode = 'sketch'; o.sketch = { type: 'LineString', coordinates: pts.map(p => [p.lng, p.lat]) }; });
      else if (save) toast('너무 짧게 그렸습니다 — 다시 그려 주세요');
    };
    // 한 번 누른 채 그린 한 획만 씀. 손 뗌은 창 전체에서 먼저(capture) 받음 — 지도 프로그램이 중간에 가로채면 획이 끝나지 않고 다음 누름이 새 획이 되던 문제
    const pd = e => { if (e.button !== 0) return; e.preventDefault(); e.stopPropagation(); if (down) return; down = true; pts = [ll(e)]; if (line) line.remove(); line = L.polyline(pts, { color: '#d6336c', weight: 3, dashArray: '6 4', interactive: false }).addTo(LM); try { el.setPointerCapture(e.pointerId); } catch (er) { /* 무시 */ } };
    const pm = e => { if (!down) return; e.preventDefault(); const p = ll(e), q = pts[pts.length - 1]; if (LM.latLngToContainerPoint(p).distanceTo(LM.latLngToContainerPoint(q)) >= 4) { pts.push(p); line.setLatLngs(pts); } };
    const pu = () => { if (down) { down = false; end(true); } };
    const kd = e => { if (e.key === 'Escape') end(false); };
    el.addEventListener('pointerdown', pd, true); el.addEventListener('pointermove', pm, true);
    window.addEventListener('pointerup', pu, true); window.addEventListener('pointercancel', pu, true); window.addEventListener('keydown', kd);
  },
  // 스케치 용지(PNG) 내려받기 — 구역·도로 확폭·다른 시설을 회색으로
  sheet(kind) {
    const z = Z.zones[S.region]; if (!z) return;
    const inf = INFRA.curInf || {};
    const feats = [['도로', inf.roadGeom], ['종교', inf.relGeom], ['공원', kind !== 'park' && inf.parkGeom], ['학교', kind !== 'school' && inf.schoolGeom]].filter(f => f[1]).map(([name, geom]) => ({ name, geom }));
    const { svg, meta } = PlaceFit.makeSheet({ zone: z.geojson, features: feats });
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = meta.width; c.height = meta.height;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(b => {
        const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `스케치용지_${(z.name || S.region)}_${this.KIND[kind]}.png`.replace(/[\\/:*?"<>|]/g, '_');
        document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      }, 'image/png');
      this.set(kind, o => { o.mode = 'upload'; o.sheet = meta; });
      toast('용지를 내려받았습니다 — 색 펜으로 그린 뒤 ②로 올리세요', 4000);
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  },
  upload(kind, file) {
    const o = this.get(S.region, kind);
    if (!o.sheet) { toast('먼저 ① 스케치 용지를 내려받아 그 위에 그려 주세요', 4000); return; }
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const sc = Math.min(1, 1600 / img.naturalWidth), w = Math.round(img.naturalWidth * sc), h = Math.round(img.naturalHeight * sc);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h); cx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      let r; try { r = PlaceFit.readSheet(cx.getImageData(0, 0, w, h), o.sheet); } catch (er) { r = { shapes: [], msg: '그림을 읽지 못했습니다' }; }
      if (!r.shapes.length && r.lines && r.lines.length) { this.set(kind, oo => { oo.mode = 'upload'; oo.sketch = r.lines[0].geometry; }); toast(r.msg, 5000); return; }
      if (!r.shapes.length) { toast(r.msg, 5000); return; }
      this.set(kind, oo => { oo.mode = 'upload'; oo.sketch = r.shapes[0].geometry; });
      toast(r.shapes.length > 1 ? `그린 모양 ${r.shapes.length}개 중 가장 큰 것을 썼습니다` : '그린 모양을 읽어 배치했습니다', 4000);
    };
    img.onerror = () => { URL.revokeObjectURL(url); toast('그림 파일을 열지 못했습니다(PNG·JPG를 올려 주세요)'); };
    img.src = url;
  },
};

/* ===== 단지 출입구(주·부출입구, 주차장 출입구) — 위치 가정과 기준 검사 =====
 근거(원문 대조 2026-11-01, 국가법령정보센터)
  - 주택건설기준 등에 관한 규정(2026. 9. 8. 시행) 제25조(진입도로) ①③, 제26조(주택단지 안의 도로) ①②④
  - 주차장법 시행규칙(2026. 7. 27. 시행) 제11조① — 부설주차장에 제5조제6호·제7호, 제6조제1항제1~8호 등을 준용.
    제5조제5호(횡단보도 5m·학교 등 20m·폭 4m 미만 도로 금지)는 노외주차장 기준으로 부설주차장에는 준용 조항에 없음 → '참고'
  - 도로와 다른 시설의 연결에 관한 규칙(2021. 8. 27. 시행, 현행) — 일반국도에 연결할 때만 적용(제3조). 별표 4(교차로 연결 금지구간)는 미반영
  - 건축법 시행령 제41조 — 11층 이상 등은 소방자동차 접근 통로 */
const GATE = {
  KIND: { main: '주출입구', sub: '부출입구', park: '주차장 출입구' },
  list(z) { return ((z && z.infra && z.infra.gates) || []); },
  // 다각형 테두리를 LineString 여러 개로(구멍·여러 덩어리 포함) — pointToLineDistance·nearestPointOnLine은 LineString만 받음
  lines(f) { try { return turf.flatten(turf.polygonToLine(f)).features.filter(l => l.geometry.type === 'LineString'); } catch (er) { return []; } },
  put(z, kind, latlng) {
    const zone = z.geojson; let pt = [latlng.lat, latlng.lng];
    // 구역(획지) 경계에 붙임
    try {
      let best = null; this.lines(zone).forEach(f => { const n = turf.nearestPointOnLine(f, turf.point([latlng.lng, latlng.lat]), { units: 'meters' }); if (!best || n.properties.dist < best.properties.dist) best = n; });
      if (best) pt = [best.geometry.coordinates[1], best.geometry.coordinates[0]];
    } catch (er) { /* 그대로 */ }
    z.infra.gates = this.list(z).filter(g => kind === 'sub' || kind === 'park' || g.kind !== kind);   // 주출입구는 하나만
    z.infra.gates.push({ kind, pt });
    // 주출입구가 닿은 경계 도로 = 진입도로(제25조) → 3탭 진입도로·확폭이 이 도로 기준으로 다시 계산되고 교통성 검토로도 넘어감
    let roadMsg = '';
    if (kind === 'main') {
      const r = this.roadAt(z, pt);
      if (r) { z.infra.entryPnu = r.pnu; roadMsg = ` — 닿은 ${r.jibun} 도로(현황 약 ${r.w}m)를 진입도로로 정했습니다. 3탭 진입도로 확폭이 이 도로 기준으로 바뀝니다`; }
      else roadMsg = ' — 경계 도로에 닿지 않은 자리입니다. 진입도로는 도로에 닿은 경계에 찍어야 정해집니다';
    }
    this.last = { i: z.infra.gates.length - 1, t: Date.now() };
    saveZ(); INFRA.memo = {};
    S.placing = null; $id('lmap').classList.remove('picking');
    toast(`${this.KIND[kind]}를 구역 경계에 놓았습니다${roadMsg}`, roadMsg ? 6000 : 3000); render();
    try { if (LM) LM.panTo([pt[0], pt[1]]); } catch (e) { /* 무시 */ }
    setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
  },
  // 점에서 15m 안의 경계 도로(z.roads.edge) 중 가장 가까운 것
  roadAt(z, pt) {
    const p = turf.point([pt[1], pt[0]]); let best = null;
    ((z.roads && z.roads.edge) || []).forEach(r => { if (!r.geom) return; let d = Infinity;
      try { const f = { type: 'Feature', properties: {}, geometry: r.geom }; d = turf.booleanPointInPolygon(p, f) ? 0 : Math.min(...this.lines(f).map(l => turf.pointToLineDistance(p, l, { units: 'meters' }))); } catch (er) { d = Infinity; }
      if (d <= 15 && (!best || d < best.d)) best = { d, pnu: r.pnu, jibun: r.jibun, w: r.w }; });
    return best;
  },
  // 경계 도로끼리 맞닿은 곳 = 교차로(개략). 도로 필지가 닿는 곳의 가운데
  ixOf(z) {
    const k = (z.roads && z.roads.at) || '';
    if (this._ix && this._ix.k === k && this._ix.z === z) return this._ix.v;
    const e = (z.roads && z.roads.edge) || [], v = [];
    for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) {
      try {
        const a = turf.buffer({ type: 'Feature', properties: {}, geometry: e[i].geom }, 2, { units: 'meters' }), b = turf.buffer({ type: 'Feature', properties: {}, geometry: e[j].geom }, 2, { units: 'meters' });
        const x = turf.intersect(a, b); if (x) { const c = turf.centroid(x).geometry.coordinates; v.push({ pt: [c[1], c[0]], a: e[i].jibun, b: e[j].jibun }); }
      } catch (er) { /* 무시 */ }
    }
    this._ix = { k, z, v }; return v;
  },
  roadAt(z, pt) {
    let best = null;
    ((z.roads && z.roads.edge) || []).forEach(r => {
      let d = 99;
      try { const f = { type: 'Feature', properties: {}, geometry: r.geom }, p = turf.point([pt[1], pt[0]]); d = turf.booleanPointInPolygon(p, f) ? 0 : Math.min(99, ...this.lines(f).map(l => turf.pointToLineDistance(p, l, { units: 'meters' }))); } catch (er) { d = 99; }
      if (d <= 15 && (!best || d < best.d)) best = { r, d };
    });
    return best && best.r;
  },
  // 주차대수: 입력값 → 없으면 법정 하한(shared/criteria/traffic.json parking_housing, 평형별 세대로) → 기준표 전이면 세대당 1대
  parkCount(pl) { if (num(P.parkCount) > 0) return num(P.parkCount); const lp = legalPark(pl); return lp ? lp.legal : Math.round(pl.units * 1.0); },
  // 검사표: st ok/ng/warn/info, law 법정 적용 여부
  check(a, pl) {
    const z = Z.zones[a.key]; if (!z) return { rows: [], gates: [] };
    const gs = this.list(z), inf = pl.infra, ent = inf && inf.entry, eo = (z.infra && z.infra.edgeOpt) || {}, ix = this.ixOf(z);
    const nPark = this.parkCount(pl), rows = [];
    const add = (item, st, text, basis, law = true) => rows.push({ item, st, text, basis, law });
    const gates = gs.map((g, i) => {
      const r = this.roadAt(z, g.pt), dIx = ix.length ? Math.min(...ix.map(x => turf.distance(turf.point([g.pt[1], g.pt[0]]), turf.point([x.pt[1], x.pt[0]]), { units: 'meters' }))) : null;
      return { ...g, i, r, oneway: !!(r && (eo[r.pnu] || {}).oneway), dIx };
    });
    const main = gates.filter(g => g.kind === 'main'), sub = gates.filter(g => g.kind === 'sub'), pk = gates.filter(g => g.kind === 'park');
    // 주출입구
    if (!main.length) add('주출입구', 'warn', '아직 정하지 않았습니다. 아래 버튼을 누르고 지도에서 구역 경계를 누르세요.', '주택건설기준 등에 관한 규정 제25조①', true);
    main.forEach(g => {
      if (!g.r) add('주출입구', 'ng', '경계 도로에 닿지 않습니다(15m 안에 도로 필지 없음).', '제25조① 기간도로·진입도로 접속', true);
      else {
        const isEntry = ent && ent.e1 && g.r.pnu === ent.e1.pnu, isE2 = ent && ent.mode === 3 && ent.e2 && g.r.pnu === ent.e2.pnu;
        add('주출입구 접속 도로', isEntry || isE2 ? 'ok' : 'warn', `${esc(g.r.jibun)} (현황 약 ${g.r.w}m)${isEntry ? ' — 정비계획의 진입도로와 같음' : isE2 ? ' — 두 번째 진입도로' : ` — 정비계획의 진입도로(${ent && ent.e1 ? esc(ent.e1.jibun) : '–'})와 다름. 정비계획 탭에서 진입도로로 고르면 확폭 폭이 이 도로 기준으로 바뀜`}`, '제25조①③', true);
        if (g.oneway) add('주출입구 일방통행', 'warn', `${esc(g.r.jibun)}이 일방통행으로 표시됨 — 진출입 방향이 제한되어 교통 검토에서 위치가 바뀔 수 있음`, '교통영향평가·경찰 협의(참고)', false);
        if (g.dIx != null) add('주출입구 ↔ 교차로', g.dIx < 5 ? 'ng' : g.dIx < 30 ? 'warn' : 'ok', `가장 가까운 경계 도로 교차(개략) ${fmt(g.dIx, 1)}m`, '도로교통법 제32조(모퉁이 5m 주정차 금지) 참고 · 교차로와 가까우면 교통 검토에서 이격 요구가 흔함', false);
      }
    });
    // 부출입구
    if (ent && ent.mode === 3) {
      const ok2 = sub.some(g => g.r && ent.e2 && g.r.pnu === ent.e2.pnu) || main.some(g => g.r && ent.e2 && g.r.pnu === ent.e2.pnu);
      add('두 번째 진입도로 출입구', ok2 ? 'ok' : 'warn', ok2 ? `${esc(ent.e2.jibun)}에 출입구 있음` : `제25조③(진입도로 2개)으로 계산 중 — ${ent.e2 ? esc(ent.e2.jibun) : '두 번째 진입도로'}에도 출입구(부출입구)를 두어야 그 기준이 성립`, '제25조③', true);
    } else if (!sub.length) add('부출입구', 'info', '정하지 않음. 법정 의무는 아니나 비상·보행 동선과 교통 분산을 위해 보통 둠', '실무(참고)', false);
    sub.forEach(g => { if (!g.r) add('부출입구', 'warn', '경계 도로에 닿지 않습니다.', '', false); else if (g.r.w < 4) add('부출입구 접속 도로', 'warn', `${esc(g.r.jibun)} 폭 약 ${g.r.w}m — 4m 미만`, '제25조③ 진입도로는 폭 4m 이상(참고)', false); });
    // 주차장 출입구 (부설주차장: 주차장법 시행규칙 제11조① 준용 조항)
    const pkG = pk.length ? pk : main;
    const lp = legalPark(pl);
    add('주차대수(가정)', 'info', `${fmt(nPark)}대${num(P.parkCount) > 0 ? '(입력값)' : lp ? ` — 법정 하한으로 가정: 세대당 최저 ${fmt(lp.minByUnits)}대(전용 60㎡ 이하 ${fmt(lp.u60)}세대 × ${lp.per60} + 그 밖 ${fmt(pl.units - lp.u60)}세대 × ${lp.per}) vs 전용면적 기준 ${fmt(lp.byArea)}대 중 큰 값. 위 칸에 넣으면 바뀜` : ` — 세대당 1대로 가정(${fmt(pl.units)}세대). 위 칸에 넣으면 바뀜`}`, lp ? esc(lp.basis) : '주택건설기준 등에 관한 규정 제27조·지자체 조례로 확정', false);
    add('출입구 너비·분리', nPark >= 50 ? 'info' : 'ok', nPark >= 50 ? '50대 이상: 출구·입구를 나누거나 너비 5.5m 이상 출입구' : '50대 미만: 출입구 너비 3.5m 이상', '주차장법 시행규칙 제6조제1항제4호(제11조① 준용)', true);
    if (nPark > 400) add('출구·입구 따로', pk.length >= 2 ? 'ok' : 'warn', pk.length >= 2 ? `주차장 출입구 ${pk.length}곳` : '400대 초과: 출구와 입구를 따로 설치(너비 합 5.5m 이상이고 차선으로 나누면 함께 가능) — 주차장 출입구를 2곳 이상 표시하거나 분리 계획 필요', '주차장법 시행규칙 제5조제7호(제11조① 준용)', true);
    const roadsN = new Set(((z.roads && z.roads.edge) || []).map(r => r.pnu)).size;
    pkG.forEach(g => {
      if (!g.r) return;
      if (roadsN >= 2) { const widest = Math.max(...z.roads.edge.map(r => r.w)); add('주차장 출입구 도로 선택', 'info', `${esc(g.r.jibun)}(약 ${g.r.w}m)에 둠 — 연결 도로가 둘 이상이면 자동차 교통에 지장이 적은 도로에 설치${g.r.w >= widest - 0.1 && widest >= 15 ? '. 가장 넓은 간선 쪽이면 교통 검토에서 이면도로로 옮기라는 의견이 나올 수 있음' : ''}`, '주차장법 시행규칙 제5조제6호(제11조① 준용)', true); }
      add('주차장 출입구 접속 도로 폭', g.r.w < (nPark >= 200 ? 6 : 4) ? 'warn' : 'ok', `${esc(g.r.jibun)} 약 ${g.r.w}m (${nPark >= 200 ? '200대 이상 6m' : '4m'} 기준)`, '주차장법 시행규칙 제5조제5호다목 — 노외주차장 기준(부설주차장은 준용 조항 아님, 참고)', false);
      if (g.dIx != null) add('주차장 출입구 ↔ 교차로', g.dIx < 5 ? 'ng' : 'ok', `가장 가까운 경계 도로 교차(개략) ${fmt(g.dIx, 1)}m`, '제5조제5호가목(도로교통법 제32조 모퉁이 5m) — 노외 기준, 참고', false);
    });
    add('횡단보도·학교 등 출입구와 거리', 'info', '횡단보도 5m 이내, 유치원·초등학교·노인·장애인복지시설 등 출입구 20m 이내에는 두지 않는 것으로 계획(지도에 횡단보도·학교 출입구 자료가 없어 직접 확인)', '주차장법 시행규칙 제5조제5호나·라목 — 노외 기준, 참고', false);
    // 단지 안 도로·소방
    add('단지 안 도로', 'info', '폭 1.5m 이상 보도를 포함한 7m 이상(100세대 미만·길이 35m 미만 막다른 도로 등은 4m). 설계속도 20km/h 이하', '주택건설기준 등에 관한 규정 제26조①②③', true);
    if (pl.units >= 500) add('어린이 안전보호구역', 'info', `${fmt(pl.units)}세대(500세대 이상) — 단지 안 도로에 어린이 통학버스 정차가 가능한 안전보호구역 1개소 이상`, '제26조④', true);
    if (pl.floorsTower >= 11) add('소방차 접근', 'info', `평균 ${pl.floorsTower}층(11층 이상) — 소방자동차 접근 통로 필요. 출입구 문주·필로티 유효 높이 5m 이상, 회전반경 고려(소방청 가이드라인)`, '건축법 시행령 제41조', true);
    add('일반국도 연결', 'info', '출입구가 닿는 도로가 일반국도이면 연결허가 금지구간(곡선·종단기울기 6%·교차로 금지구간 등)과 변속차로(폭 3.25m 이상) 검토. 시도·구도는 교통 협의에서 참고', '도로와 다른 시설의 연결에 관한 규칙 제3조·제6조·제8조(별표 4 미반영)', false);
    return { rows, gates, nPark };
  },
  draw(layer, a) {
    const z = Z.zones[a.key]; if (!z) return;
    const col = { main: '#c92a2a', sub: '#e67700', park: '#1971c2' };
    this.list(z).forEach((g, i) => {
      const r = g.kind === 'main' || g.kind === 'park' ? this.roadAt(z, g.pt) : null;
      const just = this.last && this.last.i === i && Date.now() - this.last.t < 8000;
      if (just) L.circleMarker(g.pt, { radius: 22, color: col[g.kind], weight: 3, fill: false, className: 'gate-pulse', interactive: false }).addTo(layer);
      L.circleMarker(g.pt, { radius: 10, color: '#fff', weight: 3, fillColor: col[g.kind], fillOpacity: 1 }).bindTooltip(`${this.KIND[g.kind]}${r ? ` — ${r.jibun} 도로(현황 약 ${r.w}m)` : ''} · 누르면 지움`, { sticky: true }).on('click', ev => { L.DomEvent.stop(ev); z.infra.gates.splice(i, 1); this.last = null; saveZ(); render(); }).addTo(layer);
      L.marker(g.pt, { interactive: false, icon: L.divIcon({ className: 'gate-lbl', html: `<span style="background:${col[g.kind]};color:#fff;padding:2px 7px;border-radius:4px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.35)">${this.KIND[g.kind]}${r && g.kind === 'main' ? ` · 진입도로 ${esc(r.jibun)}` : ''}</span>`, iconSize: null, iconAnchor: [-12, 10] }) }).addTo(layer);
    });
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
    bar.innerHTML = `<label class="zname">구역명 <input id="zoneTitle" value="${esc(Z.title || '')}" placeholder="예: 용현1구역 주택재개발정비구역" aria-label="구역명"></label> · 그린 안 ${used}개`
      + (rt ? ` <button class="btn sm" id="roadBtn">도로접면 조회 (${rt}필지)</button>` : '')
      + (ledgerTargets().length ? ` <button class="btn sm" id="ledBtn" title="사용승인 연도가 빈 건물과 공동주택 세대수를 건축물대장 표제부로 채웁니다">건축물대장으로 연도·세대수 채우기 (${ledgerTargets().length}필지)</button>` : '')
      + (hasProj ? ` <button class="btn ghost sm" id="fromProj" title="사업성 검토 화면에 그린 구역계와 토지·건축물 조서를 지금 고른 안으로 가져옵니다">사업성 검토 구역 가져오기 → ${esc(S.region)}안</button>` : '')
      + ` <button class="btn ghost sm" id="toSample">예시 구역 보기</button>`;
  }
  const on = (id, fn) => { const b = $id(id); if (b) b.onclick = fn; };
  const zt = $id('zoneTitle'); if (zt) zt.onchange = () => { Z.title = zt.value.trim(); saveZ(); syncTitle(); render(); };
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
  LM.on('click', e => { if (typeof RefOverlay !== 'undefined' && RefOverlay.step) { RefOverlay.onClick(e); return; } if (CUT.active && !CUT.pieces) return; if (S.placing) { INFRA.place(S.placing, e.latlng); return; } if (ZK.picking && !drawH && !editH) ZK.pick(e.latlng); });
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
// 토지이동 연혁(브이월드 토지이동이력: 분할·합병·지목변경·구획정리 등 — 종전 지번은 사유에 나옴). 마우스를 올릴 때 받아 둠
const MOVES = {
  wait: {},
  get(pnu) { const c = CACHE.parcels[pnu]; return c && c.moves; },
  async load(pnu) {
    const c = CACHE.parcels[pnu]; if (!c || c.moves) return c && c.moves;
    if (this.wait[pnu]) return this.wait[pnu];
    this.wait[pnu] = (async () => {
      try {
        const d = await jsonp('https://api.vworld.kr/ned/data/getLandMoveAttr', { pnu, key: VW.key, domain: location.origin, format: 'json', numOfRows: 30, pageNo: 1 });
        const fs = (d && d.landMoves && d.landMoves.field) || [];
        c.moves = fs.map(f => ({ d: f.ladMvmnDe || '', why: f.ladMvmnPrvonshCodeNm || '', jm: f.lndcgrCodeNm || '', a: num(f.lndpclAr) }))
          .filter(m => m.d).sort((x, y) => (x.d < y.d ? 1 : -1));
        saveCache();
      } catch (er) { c.moves = null; }
      delete this.wait[pnu];
      return c.moves;
    })();
    return this.wait[pnu];
  },
  // 툴팁용 글: 최근 것부터 6개, 분할·합병·지목변경처럼 종전 지번이 드러나는 사유를 앞에
  text(list) {
    if (!list) return '\n토지이동: 불러오는 중…';
    if (!list.length) return '\n토지이동 연혁 없음';
    const key = m => /분할|합병|등록전환|지목변경|구획|환지|신규등록|말소/.test(m.why) ? 0 : 1;
    const xs = list.slice().sort((x, y) => key(x) - key(y) || (x.d < y.d ? 1 : -1)).slice(0, 6);
    return '\n토지이동(종전 지번·사유):' + xs.map(m => `\n · ${m.d} ${m.why}${m.jm ? ` (${m.jm}` : ''}${m.a ? ` ${fmt(m.a, 1)}㎡` : ''}${m.jm ? ')' : ''}`).join('') + (list.length > 6 ? `\n · 외 ${list.length - 6}건` : '');
  },
};
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
      lyr.bindTooltip(tipText(p, blds) + (MOVES.get(pnu) ? MOVES.text(MOVES.get(pnu)) : ''), { sticky: true });
      // 마우스를 올리면 토지이동 연혁(종전 지번)을 받아 툴팁에 덧붙임
      lyr.on('mouseover', () => { if (MOVES.get(pnu)) return; lyr.setTooltipContent(tipText(p, blds) + MOVES.text(null)); MOVES.load(pnu).then(list => { lyr.setTooltipContent(tipText(p, blds) + MOVES.text(list || [])); }); });
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
  S.placed = null; S.placedIn = null; S.placedNeed = null; S.placedFloors = null; S.placedFloorsCalc = null;
  if (S.mode === 'arch' && R && R.geojson) { const a = analyze(S.region); if (a) { const pl = plan(a); drawInfraLite(pl); if (!ARCHLAY.draw(a, pl)) drawTowersMap(R.geojson, pl); GATE.draw(layT, a); } if (R.fetched && !INFRA.ready(S.region)) INFRA.fetchRoads(S.region); }
  if (S.mode === 'infra' && R && R.geojson && R.fetched) {
    if (!INFRA.ready(S.region)) INFRA.fetchRoads(S.region);
    const a = analyze(S.region); if (a) INFRA.draw(layT, a);
  }
  drawLegend();
}
// 개략 주동 배치: 구역계를 미터 좌표로 펴서 격자로 놓은 뒤 다시 경위도로
/* ===== 4탭 개략 배치: /arch와 같은 배치 엔진(shared/arch-geom.js)으로 실제 평면 모양 동을 놓음 (2026-11-04 사용자 결정 '1번') =====
 - 대지: 구역계, 건축 불가 = 3탭 정비기반시설(공원·도로 확폭·학교 등) — 그 경계에서 대지경계 이격만큼 띄움
 - 경계 성격: 도로가 닿은 변 'road'(폭 20m 이상 'arterial'), 북쪽을 향한 변 'north', 나머지 'boundary' (/arch '경계 자동 지정'과 같은 규칙)
 - 형태는 판상, 방향은 0°와 긴 변 방향 중 연면적 큰 쪽. 세대수 숫자는 여전히 개략 계산(용적률 연면적 ÷ 공급면적)이고 이 그림은 배치 확인용
 - 계산은 화면을 그린 뒤 따로(setTimeout) 하고 결과를 기억(같은 조건이면 다시 계산 안 함) */
const ARCHLAY = {
  memo: {}, busy: '',
  key(a, pl) { const z = Z.zones[a.key] || {}; return [a.key, Math.round(pl.site), Math.round(pl.farUse), JSON.stringify(JbsFeas.mixOf(JbsFeas.get())), JSON.stringify((z.infra || {}).fit || {}), JSON.stringify(((pl.infra || {}).lots || []).map(l => Math.round(l.area || 0))), Math.round((pl.infra || {}).relArea || 0), P.infraMode, z.roads && z.roads.at].join('|'); },
  input(a, pl) {
    const C = ARCHC, G = window.ArchGeom, z = Z.zones[a.key];
    if (!C || !G || !C.평면 || !C.가정 || !z || !z.geojson) return null;
    const g = z.geojson.geometry || z.geojson, ring0 = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.slice().sort((x, y) => turf.area(turf.polygon(y)) - turf.area(turf.polygon(x)))[0][0] : null;
    if (!ring0) return null;
    const ring = G.openRing(ring0), pr = G.projector(ring), pts = G.ccw(ring.map(pr.to));
    const ringsOf = gm => { const t = gm && (gm.geometry || gm); return !t ? [] : t.type === 'Polygon' ? [t.coordinates[0]] : t.type === 'MultiPolygon' ? t.coordinates.map(c => c[0]) : []; };
    const roads = ((z.roads && z.roads.edge) || []).filter(r => r.geom).map(r => ({ w: +r.w || 0, polys: ringsOf(r.geom).map(rg => G.openRing(rg).map(pr.to)) }));
    const tags = G.edges(pts).map(e => {
      const m = [(e.a[0] + e.b[0]) / 2 + e.out[0] * 3, (e.a[1] + e.b[1]) / 2 + e.out[1] * 3];
      const hit = roads.find(r => r.polys.some(pl2 => G.inside(m[0], m[1], pl2) || pl2.some((q, k) => G.segDist(m, q, pl2[(k + 1) % pl2.length]) < 4)));
      if (hit) return hit.w >= 20 ? 'arterial' : 'road';
      return e.out[1] > 0.6 ? 'north' : 'boundary';
    });
    const A0 = C.가정, sb = tags.map(t => t === 'road' ? A0.roadSetback_m : t === 'arterial' ? A0.arterialSetback_m : A0.boundarySetback_m);
    const inf = pl.infra || {}, exclude = [];
    [inf.parkGeom, inf.roadGeom, inf.schoolGeom, inf.relGeom, inf.pubB && inf.pubB.geom, inf.other && inf.other.geom, inf.green && inf.green.geom].forEach(gm => ringsOf(gm).forEach(rg => { const q = G.openRing(rg).map(pr.to); if (q.length >= 3) exclude.push(q); }));
    (inf.lots || []).filter(l => l.small && l.geom).forEach(l => ringsOf(l.geom).forEach(rg => exclude.push(G.openRing(rg).map(pr.to))));
    const zoning = String(a.zone || P.zone || '');
    const win = (C.items || []).find(i => i.id === 'window_setback'), sun = ((C.items || []).find(i => i.id === 'sunlight_north') || {}).이격;
    const mix = {}; Object.entries(JbsFeas.mixOf(JbsFeas.get())).forEach(([t, v]) => { if (num(v) > 0 && C.평면[t]) mix[t] = num(v); });
    if (!Object.keys(mix).length) return null;
    return { pr, pts, site: { pts, tags, setbacks: sb, exclude }, opt: { units: C.평면, lib: C.평면_라이브러리, assume: Object.assign({}, A0), mix, form: 'slab', spacing: 0.8, sun, lot: pl.site, far: pl.farUse, winRatio: win ? (/준주거|근린상업/.test(zoning) ? (win.값.근린상업_준주거_배수 || 4) : (win.값.배수 || 2)) : 0, edgeW: [], exSetback: A0.boundarySetback_m || 0 } };
  },
  cands(I) {
    const G = window.ArchGeom, cand = new Set([0]);
    G.edges(I.pts).sort((x, y) => y.len - x.len).slice(0, 2).forEach(e => { let d = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI; while (d > 45) d -= 90; while (d < -45) d += 90; cand.add(Math.round(d)); });
    const A = I.opt.assume;
    return { cand: [...cand], F: Math.round(A.minFloors + (A.maxFloors - A.minFloors) * 0.6) };
  },
  // 방향은 빠른 추정(quick, 기준 층수 하나)으로 고르고 고른 방향에서만 한 번 자세히 — /arch '배치안 만들기'와 같은 방식. 일꾼(Worker)에서 계산
  solve(I, done) {
    const c = this.cands(I);
    try {
      if (!this.wk) { this.wk = new Worker('archlay-worker.js?v=3'); this.cb = {}; this.wk.onmessage = e => { const f = this.cb[e.data.id]; delete this.cb[e.data.id]; if (f) f(e.data.r); }; this.wk.onerror = () => { Object.values(this.cb).forEach(f => f(null)); this.cb = {}; this.wk = null; }; }
      const id = (this.seq = (this.seq || 0) + 1); this.cb[id] = done;
      this.wk.postMessage({ id, site: I.site, opt: I.opt, cand: c.cand, F: c.F });
      // 90초가 넘으면 일꾼을 멈추고 예전 네모 그림으로(화면에 '계산 중'이 계속 남지 않게)
      setTimeout(() => { if (this.cb[id]) { const f = this.cb[id]; delete this.cb[id]; try { this.wk.terminate(); } catch (e) { /* 무시 */ } this.wk = null; Object.values(this.cb).forEach(g => g(null)); this.cb = {}; f(null); } }, 90000);
    } catch (e) { done(null); }
  },
  // 결과가 있으면 그리고 true. 없으면 계산을 걸어 두고 false(그동안은 예전 네모 그림)
  draw(a, pl) {
    let k; try { k = this.key(a, pl); } catch (e) { return false; }
    const r = this.memo[k];
    if (r === undefined) {
      if (this.busy !== k) {
        this.busy = k;
        const fin = res => {
          if (Object.keys(this.memo).length > 20) this.memo = {};
          this.memo[k] = res; this.busy = '';
          if (S.mode === 'arch' && S.region === a.key) render();
        };
        let I = null; try { I = this.input(a, pl); } catch (e) { console.warn('개략 배치(엔진) 입력 실패', e); }
        if (!I) setTimeout(() => fin(null), 0); else this.solve(I, r => { if (r) r.pr = I.pr; fin(r); });
      }
      S.archLay = { busy: true };
      return false;
    }
    if (!r) { S.archLay = { fail: true }; return false; }
    const col = cssVar('--accent');
    r.buildings.forEach(b => {
      const ll = q => q.map(p => { const c = r.pr.back(p); return [c[1], c[0]]; });
      const tip = `${b.floors}층 · ${b.t}㎡형 층당 ${b.n}세대 · ${fmt(b.n * b.floors)}세대${b.vname ? ` · 평면 ${esc(b.vname)}` : ''}`;
      (b.parts && b.parts.length ? b.parts : [b.poly]).forEach(q => L.polygon(ll(q), { color: '#1f2933', weight: 1, fillColor: col, fillOpacity: 0.85 }).bindTooltip(tip, { sticky: true }).addTo(layT));
      (b.units || []).forEach(rs => rs.forEach(q => L.polygon(ll(q), { color: '#fff', weight: 0.5, fill: false, interactive: false }).addTo(layT)));
    });
    S.archLay = { n: r.buildings.length, units: r.units, maxF: r.maxFloors, far: r.far, bcr: r.bcr, angle: r.angle };
    return true;
  },
};

// 개략 배치 화면에도 3탭에서 정한 정비기반시설(공원·녹지·도로·학교 등)과 공동주택 획지 경계를 함께 보여 줌(읽기 전용) — 주동이 그 밖에만 놓였는지 눈으로 확인
function drawInfraLite(pl) {
  const inf = pl && pl.infra; if (!inf) return;
  const add = (g, st, tip) => { if (!g) return; try { L.geoJSON(g, { style: Object.assign({ weight: 1.5, fillOpacity: 0.55 }, st), interactive: !!tip }).eachLayer(l => { if (tip) l.bindTooltip(tip, { sticky: true }); l.addTo(layT); }); } catch (e) { /* 무시 */ } };
  add(inf.roadGeom, { color: '#7a7f86', fillColor: '#b9bec4' }, `도로(확폭 포함) ${fmt(inf.roadArea || 0)}㎡`);
  add(inf.parkGeom, { color: '#2f7d4a', fillColor: '#6fbf7e' }, `공원·녹지 ${fmt(inf.parkArea || 0)}㎡ — 주동을 놓지 않음`);
  add(inf.schoolGeom, { color: '#7a5aa6', fillColor: '#b9a3d6' }, `학교용지 ${fmt(inf.schoolArea || 0)}㎡`);
  add(inf.relGeom, { color: '#7b2cbf', fillColor: '#c9a7e8' }, `종교용지${inf.relC ? '(대체부지)' : '(현 위치 존치)'} ${fmt(inf.relArea || 0)}㎡ — 주동을 놓지 않음`);
  (Array.isArray(inf.lots) ? inf.lots : []).forEach((l, i) => add(l.geom, { color: '#1f2933', weight: 2, dashArray: '6 4', fill: false }, `공동주택 획지${inf.lots.length > 1 ? ' ' + (i + 1) : ''} ${fmt(l.area || turf.area(l.geom))}㎡${l.small ? ' (작아서 배치 제외)' : ''}`));
}
function drawTowersMap(gj, pl) {
  if (pl.rects) {
    const col0 = cssVar('--accent');
    pl.rects.forEach(c => L.polygon(c, { color: col0, weight: 1, fillColor: col0, fillOpacity: 0.85 }).bindTooltip(`${pl.floorsTower}층 · ${P.coreUnits}세대/층 · 높이 약 ${(pl.floorsTower * 2.9).toFixed(0)}m${pl.placedIn === 'lots' ? ' · 공동주택 획지 안' : ''}`, { sticky: true }).addTo(layT));
    S.placed = pl.rects.length; S.placedIn = pl.placedIn; S.placedNeed = pl.towersCalc; S.placedFloors = pl.floorsTower; S.placedFloorsCalc = pl.floorsCalc;
    return;
  }
  const g = gj.geometry;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : [];
  if (!rings.length) return;
  const ring = rings.slice().sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
  const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length, lon0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  const pts = ring.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
  const back = ([x, y]) => [lat0 - y / ky, lon0 + x / kx];
  const fw = Math.sqrt(pl.towerFoot * 2.2), fh = pl.towerFoot / fw;
  const gap = Math.max(fw + 14, 0.8 * pl.floorsTower * 2.9 + fh);
  const col = cssVar('--accent');
  // 기반시설 제안이 있으면 공동주택 획지(구역 − 도로·공원·학교·종교용지 등) 안에만 놓음. 1,000㎡ 미만 작은 획지는 뺌
  const toLocal = r => r.map(c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky]);
  const outer = gm => { const t = gm && (gm.geometry || gm); return !t ? [] : t.type === 'Polygon' ? [t.coordinates[0]] : t.type === 'MultiPolygon' ? t.coordinates.map(c => c[0]) : []; };
  const lots = pl.infra && Array.isArray(pl.infra.lots) && pl.infra.lots.length ? pl.infra.lots.filter(l => l.geom && !l.small).sort((a, b) => b.area - a.area) : null;
  const areas = lots ? lots.flatMap(l => outer(l.geom)).map(toLocal) : [pts];
  let placed = 0;
  for (const poly of areas) {
    const xs = poly.map(q => q[0]), ys = poly.map(q => q[1]);
    // 모서리와 변 가운데가 모두 그 땅 안이어야 놓음
    const fits = (x, y) => [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh], [x + fw / 2, y], [x + fw / 2, y + fh], [x, y + fh / 2], [x + fw, y + fh / 2]].every(([px, py]) => inside(px, py, poly));
    for (let y = Math.min(...ys) + (lots ? 3 : 12); y < Math.max(...ys) - fh && placed < pl.towers; y += gap) {
      for (let x = Math.min(...xs) + (lots ? 3 : 10); x < Math.max(...xs) - fw && placed < pl.towers; x += fw + 16) {
        if (!fits(x, y)) continue;
        const c = [[x, y], [x + fw, y], [x + fw, y + fh], [x, y + fh]];
        L.polygon(c.map(back), { color: col, weight: 1, fillColor: col, fillOpacity: 0.85 }).bindTooltip(`${pl.floorsTower}층 · ${P.coreUnits}세대/층${lots ? ' · 공동주택 획지 안' : ''}`, { sticky: true }).addTo(layT);
        placed++;
      }
    }
  }
  S.placed = placed; S.placedIn = lots ? 'lots' : 'zone'; S.placedNeed = pl.towers;
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
  S.placed = null; S.placedIn = null; S.placedNeed = null; S.placedFloors = null; S.placedFloorsCalc = null;
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
    infra: [['var(--ink-2)', '도로 확폭(제안)'], ['var(--road)', '구역 안 현황 도로'], ['var(--ok)', '공원·녹지(제안)'], ['var(--accent)', '학교용지(제안)'], ['#7b2cbf', '종교용지(존치·대체)'], ['#f2c94c', '공동주택 획지(남는 땅)'], [null, `<label style="cursor:pointer"><input type="checkbox" id="showFac" ${P.showFac ? 'checked' : ''} onchange="P.showFac=this.checked;saveP();render()"> 도시계획시설 결정선(참고) 보기</label>`]],
  }[S.mode];
  L.innerHTML = m.map(([c, t]) => c ? `<span><i style="background:${c}"></i>${t}</span>` : `<span>${t}</span>`).join('') + `<span><svg width="26" height="8" style="vertical-align:0"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--redline)" stroke-width="2" stroke-dasharray="7 2 1.2 2"/></svg> 구역계</span>`;
}
function svgPoint(evt) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(Math.max(0, Math.min(D.W, q.x)) * 10) / 10, Math.round(Math.max(0, Math.min(D.H, q.y)) * 10) / 10]; }
svg.addEventListener('click', e => { if (!S.drawing) return; S.draft.push(svgPoint(e)); document.getElementById('finishBtn').disabled = S.draft.length < 3; drawSvg(); });

/* ===== 우측 패널 ===== */
const side = document.getElementById('side');
// /arch·검토서 바로가기: 지금 보고 있는 안(S.region)을 ?urban= 으로 넘김(그린 구역계가 없으면 그냥 도구 첫 화면)
const toolHref = t => { const z = Z.zones[S.region]; return `../${t}/` + (z && z.geojson ? `?urban=${encodeURIComponent(S.region)}` : ''); };
function syncToolLinks() { document.querySelectorAll('a[data-tool]').forEach(a => { a.href = toolHref(a.dataset.tool); }); }
let toolBusy = false;
// 이동 전에 지금 안을 저장하고, 주변 도로(경계 도로 폭·소유구분)를 아직 안 불러왔으면 불러온 뒤 이동 — /arch가 도로 변을 정할 때 씀
document.addEventListener('click', async e => {
  const a = e.target.closest && e.target.closest('a[data-tool]'); if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
  const id = S.region, z = Z.zones[id], url = toolHref(a.dataset.tool);
  saveZ();
  if (!z || !z.geojson || INFRA.ready(id) || !VWorld.enabled) { a.href = url; return; }
  e.preventDefault();
  if (toolBusy) return; toolBusy = true;
  toast(`${id}안 주변 도로를 불러오는 중… 끝나면 이동합니다`, 60000);
  try {
    if (!INFRA.loading[id]) await INFRA.fetchRoads(id);
    for (let k = 0; k < 120 && INFRA.loading[id]; k++) await new Promise(r => setTimeout(r, 500));
  } finally { toolBusy = false; }
  if (!INFRA.ready(id)) toast('주변 도로를 다 불러오지 못했습니다 — 도로 자료 없이 이동합니다', 2500);
  saveZ(); location.href = url;
});
function render() {
  syncToolLinks();
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
  stepNav();
}
// 각 탭 맨 아래 '다음 단계' 버튼(2026-11-04 사용자 요구: 기반시설을 정한 뒤 다음으로 넘어가는 버튼). 지금 정한 값은 저장된 상태로 넘어감
function stepNav() {
  // 화면 탭 순서 = 위 '정비계획 순서'(주출입구 → 정비기반시설 → 교통성 …)와 같게: 출입구·개략 배치가 정비기반시설보다 앞
  const ORDER = [['zone', '구역계·현황'], ['req', '요건판정'], ['arch', '출입구·개략 배치'], ['plan', '정비기반시설'], ['biz', '사업성']];
  const i = ORDER.findIndex(([k]) => k === S.tab); if (i < 0) return;
  const prev = ORDER[i - 1], next = ORDER[i + 1];
  const nextLabel = S.tab === 'arch' ? '출입구 정함 → 다음: 정비기반시설(도로 확폭·공원)' : next ? `다음: ${next[1]} →` : '';
  side.insertAdjacentHTML('beforeend', `<div class="stepnav" style="display:flex;justify-content:space-between;gap:8px;margin:18px 0 6px;padding-top:12px;border-top:1px solid var(--line)">
    ${prev ? `<button type="button" class="btn ghost" data-stepgo="${prev[0]}">← ${prev[1]}</button>` : '<span></span>'}
    ${S.tab === 'plan' ? `<button type="button" class="btn" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-handoffnav="traffic" ${handoffReady() ? '' : 'disabled'}>기반시설 확정 → 다음: 3 교통성 검토(계획값을 넘김)</button>` : next ? `<button type="button" class="btn" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-stepgo="${next[0]}">${nextLabel}</button>` : S.tab === 'biz' ? `<a class="btn" style="background:var(--ink);color:var(--paper);text-decoration:none" data-tool="arch" href="${toolHref('arch')}">다음: 자세한 배치(/arch) →</a>` : ''}</div>`);
  side.querySelectorAll('[data-handoffnav]').forEach(b => b.onclick = () => { const a = analyze(S.region); if (a) handoff(a, b.dataset.handoffnav); });
  side.querySelectorAll('[data-stepgo]').forEach(b => b.onclick = () => {
    saveZ(); try { saveP(); } catch (e) { /* 무시 */ }
    const t = document.querySelector(`nav.steps button[data-tab="${b.dataset.stepgo}"]`); if (t) t.click();
    if (b.dataset.stepgo === 'arch' && S.region) setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); else window.scrollTo({ top: 0, behavior: 'smooth' }); }, 300);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
const kpi = (l, v, f) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="f">${f || ''}</div></div>`;
// 화면 제목·내보내기에 구역명(있으면)을 붙임: "용현1구역 · A안"
const regName = () => esc((Z.title ? Z.title + ' · ' : '') + D.regions[S.region].name);
function syncTitle() { document.title = (Z.title ? Z.title + ' — ' : '') + 'jbslab 정비계획 검토'; }
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
// 관련 평가 대상(개략) — 교통영향평가·환경영향평가·소규모 환경영향평가·전략환경영향평가. 기준값은 shared/criteria(검토서 도구와 같은 표)
function evalSection(a) {
  const T = CRIT.traffic || {}, E = CRIT.environment || {};
  if (!CRIT.traffic && !CRIT.environment) return '<h3>관련 평가 대상 (개략)</h3><p class="hint">기준표(shared/criteria)를 불러오는 중…</p>';
  const green = Object.entries(a.zoneArea || {}).some(([z, v]) => /녹지/.test(z) && v > 0);
  const row = (name, it, hit, how, link) => {
    if (!it) return `<tr><td>${name}</td><td><span class="pill warn">기준 없음</span></td><td class="wrap u">기준표에 항목이 없습니다</td><td></td></tr>`;
    const chk = /확인필요/.test(it['상태'] || '') || it['값'] == null;
    const st = it['값'] == null ? '<span class="pill warn">확인 필요</span>' : hit ? '<span class="pill info">대상</span>' : '<span class="pill ok">대상 아님</span>';
    return `<tr><td>${name}${link ? `<br><a class="u" href="${link}">검토서 도구 →</a>` : ''}</td><td>${st}</td><td class="wrap">${how}${chk ? ' <b class="warn">※ 기준 확인 필요</b>' : ''}</td><td class="wrap u">${esc(it['근거'] || '')}${it['상태'] ? `<br>${esc(it['상태'])}` : ''}</td></tr>`;
  };
  const tia = T.tia_redev_site_area, eia = E.eia_redev_area, sm = E.small_eia_urban, se = E.strategic_eia;
  const smV = sm ? (green ? (sm['녹지지역_값'] || sm['값']) : sm['값']) : 0;
  return `<h3>관련 평가 대상 (개략)</h3>
  <p class="hint">구역 면적 ${fmt(a.area)}㎡ 기준의 1차 판정입니다. 기준값은 교통성·환경성 검토서 도구와 같은 표(shared/criteria)를 씁니다. 실제 대상 여부는 사업계획 면적·조례·협의로 확정합니다.</p>
  <div class="tscroll"><table class="gi-tbl"><thead><tr><th>평가</th><th>판정</th><th>내용</th><th>근거</th></tr></thead><tbody>
  ${row('교통영향평가', tia, tia && a.area >= tia['값'], tia ? `정비사업 부지면적 ${fmt(tia['값'])}㎡ 이상 → 이 안 ${fmt(a.area)}㎡${tia['제출시기'] ? `. 제출: ${esc(tia['제출시기'])}` : ''}` : '', '../traffic/')}
  ${row('환경영향평가', eia, eia && a.area >= eia['값'], eia ? `도시정비사업 ${fmt(eia['값'])}㎡ 이상 → 이 안 ${fmt(a.area)}㎡` : '', '../env/')}
  ${row('소규모 환경영향평가', sm, sm && a.area >= smV && !(eia && a.area >= eia['값']), sm ? `도시지역 ${fmt(sm['값'])}㎡ 이상(녹지지역 ${fmt(sm['녹지지역_값'] || 0)}㎡) — 환경영향평가 대상이면 제외${green ? '. 구역에 녹지지역이 있어 녹지 기준 적용' : ''}${sm['협의시기'] ? `. 협의: ${esc(sm['협의시기'])}` : ''}` : '', '../env/')}
  ${row('전략환경영향평가', se, se && se['값'] != null && a.area >= se['값'], se && se['값'] != null ? `정비구역 지정 — 환경영향평가 대상 규모(${fmt(se['값'])}㎡) 이상일 때만 → 이 안 ${fmt(a.area)}㎡${se['협의시기'] ? `. 협의: ${esc(se['협의시기'])}` : ''}` : '정비계획이 별표 2 대상인지 원문 확인 전', '../env/')}
  </tbody></table></div>`;
}
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
  <p class="note">정비구역 지정은 조례 요건 외에 2030 정비기본계획(구역 경계설정 기준 등)도 따릅니다(제5조④). 기본계획 변경 고시문 대조 전입니다.</p>
  ${evalSection(a)}`;
  const sel = document.getElementById('ptype'); sel.value = P.type; sel.onchange = () => { P.type = sel.value; saveP(); render(); };
}
// 공통 가정값(shared/feas.js) 입력칸 — 사업성 검토 첫 화면과 같은 값
const feasField = (k, unit, attrs = 'step="any"') => `<div class="field"><label for="feas_${k}">${JbsFeas.LABEL[k] || k}</label><input id="feas_${k}" data-feas="${k}" type="number" value="${JbsFeas.get()[k] ?? ''}" ${attrs}><span class="u">${unit}</span></div>`;
const field = (id, label, val, unit, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="number" value="${val}" ${attrs}><span class="u">${unit}</span></div>`;
function bindNum(ids) { ids.forEach(id => { const e = document.getElementById(id); if (!e) return; e.addEventListener('change', () => { const v = parseFloat(e.value); if (!isNaN(v)) { P[id] = v; saveP(); render(); } }); }); }
// 토지이용계획표의 정비기반시설·종교용지 행
//  정비기반시설 계 = 도로 + 공원 + 녹지 + 그 밖의 정비기반시설(공용주차장·공공공지·광장 등) — 도정법 제2조제4호·영 제3조
//  학교용지·공공청사·종교용지는 정비기반시설이 아니라 따로 줄을 둠(무상귀속 대상 아님)
//  도로 = 계 − 공원 − 녹지 − 그 밖의 정비기반시설 → 경계 도로 확폭·직접 지정한 도로·존치하는 기존 도로를 모두 담아 하위 합이 계와 같게 함
// 본 화면(사업성)이 '정비계획(/urban) 계획값'으로 대지면적을 잡을 수 있게 계획값을 저장
function saveUrbanOut(a, pl) {
  const inf = pl.infra; if (!inf || !a.area) return;
  const other = inf.schoolArea + (inf.pubB || 0) + (inf.relArea || 0), infraA = inf.total - other;
  // /arch(개략 건축계획)가 건축 불가 영역으로 쓰도록 기반시설 도형 저장: 도로(확폭·지정·존치), 공원·녹지, 학교용지, 종교용지(존치·대체), 공동주택 획지
  try {
    const r7 = g => g && g.geometry ? { type: g.geometry.type, coordinates: JSON.parse(JSON.stringify(g.geometry.coordinates, (k, v) => typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v)) } : null;
    const keep = (P.keepInnerRoads && inf.inner) ? inf.inner.filter(q => q.geom).map(q => r7({ geometry: q.geom })) : [];
    const all = JSON.parse(localStorage.getItem('jbs-urban-infra-v1') || '{}');
    all[a.key] = { at: new Date().toLocaleString('sv-SE').slice(0, 16), road: r7(inf.roadGeom), park: r7(inf.parkGeom), school: r7(inf.schoolGeom), rel: r7(inf.relGeom), green: inf.drawing ? r7(inf.drawing.green) : null, other: inf.drawing ? r7(inf.drawing.other) : null, pub: inf.drawing ? r7(inf.drawing.pub) : null, fromDrawing: inf.drawing ? inf.drawing.name : null, relKeep: !inf.relC, keepRoads: keep, lots: (inf.lots || []).map(l => ({ no: l.no, area: Math.round(l.area), geom: r7(l.geom) })) };
    localStorage.setItem('jbs-urban-infra-v1', JSON.stringify(all));
  } catch (e) { /* 무시 */ }
  try { localStorage.setItem('jbs-urban-out', JSON.stringify({ title: Z.title || '', region: a.key, at: new Date().toLocaleString('sv-SE').slice(0, 16), area: a.area, infra: infraA, other, site: pl.site, units: pl.units, short: inf.short, keepArea: inf.keepArea })); } catch (e) { /* 무시 */ }
}
function luRows(a, pl) {
  const inf = pl.infra, A = a.area || 1, pc = v => (v / A * 100).toFixed(1) + '%';
  const tr = (t, v, cls = '') => `<tr${cls ? ` class="${cls}"` : ''}><td>${t}</td><td class="r">${fmt(v)}</td><td class="r">${pc(v)}</td></tr>`;
  if (!inf) return tr('정비기반시설 계', A * pl.infraPct / 100);
  const infraA = inf.total - (inf.relArea || 0) - inf.schoolArea - (inf.pubB || 0);
  const roadT = Math.max(0, infraA - inf.parkArea - (inf.green || 0) - inf.other);
  const manual = inf.items.filter(it => it.kind === 'manual').reduce((t, it) => t + it.area, 0), widen = inf.roadArea - manual;
  const kept = P.keepInnerRoads ? inf.innerFull : 0;
  const parts = inf.drawing ? [`정비기반시설도(${esc(inf.drawing.name)}) 도로 ${fmt(inf.roadArea)}`] : [widen > 0.5 ? `경계 도로 확폭 ${fmt(widen)}` : '', manual > 0.5 ? `직접 지정 ${fmt(manual)}` : '', kept > 0.5 ? `기존 도로 존치 ${fmt(kept)}` : ''].filter(Boolean);
  const notInfra = '<br><span class="u">정비기반시설 아님(무상귀속 대상 아님) — 공동주택 획지에서 뺌</span>';
  let h = (inf.schoolArea ? tr('학교용지' + notInfra, inf.schoolArea) : '')
    + ((inf.pubB || 0) ? tr('공공청사 등' + notInfra, inf.pubB) : '')
    + (inf.relArea ? tr('종교용지(존치·대체)' + notInfra, inf.relArea) : '')
    + tr(inf.drawing ? '정비기반시설 계 (정비기반시설도)' : '정비기반시설 계 (제안)', infraA)
    + tr(`&nbsp;└ 도로(신설·존치)<br><span class="u">${parts.join(' · ') || '도로로 잡은 면적 없음'}</span>`, roadT)
    + tr('&nbsp;└ 공원', inf.parkArea)
    + tr('&nbsp;└ 녹지<br><span class="u">완충·경관·연결녹지 등 — 아래 \'녹지 면적\'에 입력</span>', inf.green || 0)
    + (inf.other ? tr('&nbsp;└ 그 밖의 정비기반시설<br><span class="u">공용주차장·공공공지·광장 등</span>', inf.other) : '');
  // 확보 목표와 맞춰 보기: 모자라면 그만큼은 구역 안 도로로 더 잡아야 하므로 참고 줄로 보여 줌(면적 계산에는 넣지 않음)
  if (inf.short > 1) {
    const inf2 = infraA + inf.short, site2 = Math.max(0, pl.site - inf.short);
    h += `<tr class="note-row"><td colspan="3" class="wrap"><b class="warn">확보 목표 ${fmt(inf.keepArea)}㎡보다 신설 ${fmt(inf.newArea)}㎡가 ${fmt(inf.short)}㎡ 모자람</b> — 이만큼은 구역 안 도로(✂ 구역계 자르기로 '도로로 지정')나 경계 도로 넓히기로 더 잡아야 합니다. 부족분까지 도로로 잡으면 정비기반시설 ${fmt(inf2)}㎡(${pc(inf2)}) · 도로 ${fmt(roadT + inf.short)}㎡ · 공동주택 획지 ${fmt(site2)}㎡(${pc(site2)})가 됩니다.</td></tr>`;
  }
  return h;
}
// 용도지역 상향 입지요건(2030 기본계획 변경 고시 제2026-96호 [기준2]) — 계획 용도지역이 현황보다 높을 때 경계 도로 폭(개발 후)으로 1차 확인
function zoneUpCheck(a, pl) {
  const Zu = RULES.zoneUp; if (!Zu) return '';
  const rank = z => /준주거/.test(z) ? 4 : /제3종/.test(z) ? 3 : /제2종/.test(z) ? 2 : /제1종/.test(z) ? 1 : 0;
  const cur = Object.entries(a.zoneArea || {}).sort((x, y) => y[1] - x[1]).map(([z]) => z)[0] || '';
  if (!(rank(P.zone) > rank(cur) && rank(cur) > 0)) return '';
  const need = (Zu.min_road_m || {})[P.zone], inf = pl.infra, z = Z.zones[a.key] || {};
  const ws = ((z.roads && z.roads.edge) || []).map(r => ({ j: r.jibun, w: Math.max(r.w, num(((inf && inf.entry && inf.entry.per) || {})[r.pnu] && inf.entry.per[r.pnu].pw)) }));
  const best = ws.sort((x, y) => y.w - x.w)[0];
  const ok = need && best && best.w >= need;
  const pc = (Zu.public_contribution || {})[`${cur.replace('일반주거지역', '')}→${P.zone.replace('일반주거지역', '')}`];
  return `<div class="field" style="grid-column:1/-1"><span class="u"><b>용도지역 상향 입지요건</b>(${esc(cur)} → ${esc(P.zone)}): ${esc(Zu[P.zone] || '')}. ${need ? `경계 도로 계획 폭 최대 ${best ? `${esc(best.j)} ${fmt(best.w, 1)}m` : '–'} → ${ok ? `<b class="good">${need}m 이상 충족</b>` : `<b class="warn">${need}m 이상 도로 없음</b>`}` : ''}. 연접 용도지역은 지도로 직접 확인하세요.${pc ? ` 공공기여 ${Math.round(pc * 100)}% 이상(법정의무시설·부가차로 포함).` : ''}</span></div>`;
}
// 교통성 검토서 결과(site.constraints.traffic.확폭_검토_도로 [{도로:'○○ 도로', 현재_m, 필요_m}]) → 경계 도로 계획 폭에 한 번에 적용
//  도로 이름은 site-store가 '(지번) 도로'로 만든 것 → z.roads.edge의 jibun으로 찾아 edgeOpt[pnu].pw
function trafficWidenInfo() {
  if (!window.JbsSite) return null;
  const site = JbsSite.list().find(x => x.source === 'urban:' + S.region), tr = site && site.constraints && site.constraints.traffic;
  if (!tr) return null;
  const z = Z.zones[S.region], edges = (z && z.roads && z.roads.edge) || [];
  const rows = (tr.확폭_검토_도로 || []).map(r => { const jb = String(r.도로 || '').replace(/\s*도로$/, '').trim(); const e = edges.find(x => String(x.jibun) === jb); return { name: r.도로, now: r.현재_m, need: r.필요_m, pnu: e && e.pnu }; });
  return { at: tr.at || site.updated || '', rows, entry: tr.진입_가능_도로 || [] };
}
function trafficWidenBox() {
  const t = trafficWidenInfo(); if (!t) return '';
  if (!t.rows.length) return `<p class="note" style="background:#f3f8f3;border:1px solid #cfe3cf;border-radius:6px;padding:6px 8px">교통성 검토서(${esc(t.at)}): 확폭이 필요한 진입도로 없음${t.entry.length ? ` · 진입 가능 도로 ${esc(t.entry.join(', '))}` : ''}.</p>`;
  const inf = (Z.zones[S.region] || {}).infra || {}, eo = inf.edgeOpt || {};
  const applied = t.rows.every(r => r.pnu && eo[r.pnu] && num(eo[r.pnu].pw) >= num(r.need));
  return `<div style="background:#fff7e6;border:1px solid #f0c36d;border-radius:6px;padding:8px 10px;margin:6px 0">
    <b>교통성 검토서 결과(${esc(t.at)})</b> — 확폭 검토 도로: ${t.rows.map(r => `${esc(r.name)} 현재 ${r.now}m → 필요 ${r.need}m${r.pnu ? '' : ' <span class="warn">(경계 도로 목록에서 못 찾음)</span>'}`).join(' · ')}
    <div style="margin-top:6px"><button type="button" class="btn sm" data-trwiden="1" ${applied ? 'disabled' : ''}>${applied ? '적용됨 — 계획 폭에 반영되어 있습니다' : '추천 폭 적용(이 도로들 계획 폭을 필요 폭으로)'}</button> <span class="u">적용 뒤 아래 표에서 도로별로 다시 고칠 수 있습니다. /arch는 [정비계획 기반시설 불러오기]로 새 획지를 받습니다.</span></div></div>`;
}
function renderPlan(a) {
  const pl = plan(a), far = pl.far;
  saveUrbanOut(a, pl);
  const pressBadge = RULES.status.far === 'press' ? '<span class="badge p">고시문 대조 필요</span>' : '<span class="badge v">원문 대조</span>';
  const inf = pl.infra, prop = !!inf;
  const ip = pl.infraPct;
  side.innerHTML = `<h2>${regName()} 정비계획 (토지이용·밀도)</h2>
  ${D.map ? infraSection(a, pl) : ''}
  <div class="form">
    <div class="field"><label for="zone">용도지역(계획)</label><select id="zone"><option>제2종일반주거지역</option><option>제3종일반주거지역</option></select><span class="u">현황: ${Object.entries(a.zoneArea).map(([z, v]) => esc(z.replace('일반주거지역', '')) + ' ' + fmt(v) + '㎡').join(', ')}</span></div>
    ${prop ? '' : field('infraRatio', '정비기반시설 비율(도로·공원·학교 등)', P.infraRatio, D.map ? '구역 면적 대비 % · 직접 입력' : '구역 면적 대비 %, 예시 가정', 'min=0 max=60 step=1')}
    <div class="field"><label for="farMode">적용 용적률</label><select id="farMode"><option value="base">기준용적률 ${far.base}%</option><option value="allowed">허용용적률 ${far.allowed}%</option><option value="max">상한용적률 ${far.max}%</option>${pl.farCalc ? `<option value="calc">산식(공공시설 제공) ${pl.farCalc.v}%</option>` : ''}<option value="custom">직접 입력</option></select><span class="u">2030 기본계획 · ${pressBadge}</span></div>
    ${P.farMode === 'custom' ? field('farCustom', '계획 용적률', P.farCustom, `% (상한 ${far.max}% 이내로 제한)`) : ''}
    ${zoneUpCheck(a, pl)}
  </div>
  <h3>토지이용계획표 (개략)</h3>
  <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">면적㎡</th><th class="r">비율</th></tr></thead><tbody>
    <tr><td>정비구역</td><td class="r">${fmt(a.area)}</td><td class="r">100.0%</td></tr>
    <tr><td>공동주택 획지(대지)</td><td class="r">${fmt(pl.site)}</td><td class="r">${(pl.site / a.area * 100).toFixed(1)}%</td></tr>
    ${luRows(a, pl)}
  </tbody></table></div>
  <h3>건축물 밀도계획</h3>
  <div class="kpis">
    ${kpi('계획 용적률', pl.farUse + '%', `${P.zone.replace('일반주거지역', '')} · 기준 ${far.base} / 허용 ${far.allowed} / 상한 ${far.max}`)}
    ${kpi('지상 연면적(용적률 산정)', fmt(pl.gfa) + '㎡', `획지 ${fmt(pl.site)}㎡ × ${pl.farUse}%`)}
    ${kpi('국민주택규모 의무(참고)', '증가분의 ' + RULES.natHousing.redevelopment * 100 + '%', '법적상한까지 완화 시 · 정비조례 제27조')}
  </div>
  ${pl.farCalc ? (() => { const c = pl.farCalc, f2 = RULES.far[P.zone]; return `<p class="note"><b>상한용적률 산식</b>(2030 기본계획 변경 고시 제2026-96호): 허용 ${f2.allowed}% + [1.5 × 공공시설 제공 ${fmt(c.pa)}㎡${c.pb ? ` + 1.0 × 학교·공공청사 부지 ${fmt(c.pb)}㎡` : ''} ÷ 획지 ${fmt(c.site)}㎡ × 기준 ${f2.base}%] = <b>${c.raw.toFixed(1)}%</b>${c.capped ? ` → 상한 ${f2.max}%로 제한` : ''}. 공공시설 제공 면적 = 새로 설치하는 공공시설 ${fmt(c.newPub)}㎡ − 용도폐지되는 설치된 기존 공공시설 ${fmt(c.fac)}㎡(사용 중 면적). 존치 시설과 미집행 결정선은 빼지 않습니다(기본계획 원문은 '기정 도시계획시설 차감' — 인천시 산정 사례로 확인 필요). ${c.pa < 1 ? '<b class="warn">새 공공시설이 용도폐지되는 기존 시설보다 작아 산식 인센티브가 없음</b>' : ''}${!c.capped ? (() => { const needPa = Math.max(0, (f2.max - f2.allowed) / (1.5 * f2.base) * c.site - (c.pb / 1.5)); return ` 상한 ${f2.max}%까지 받으려면 공공시설 제공 약 ${fmt(needPa)}㎡(새 공공시설 약 ${fmt(needPa + c.fac)}㎡, 지금보다 ${fmt(Math.max(0, needPa + c.fac - c.newPub))}㎡ 더) 필요 — 획지가 줄어드는 만큼은 반영 안 한 개략값.`; })() : ''} 허용용적률 인센티브(9개 항목, 최대 20%·지역업체 참여 시 40%)를 다 받는다고 가정한 값입니다.</p>`; })() : ''}
  ${D.map ? todoSection(a, pl) : ''}
  <p class="note">허용용적률은 인센티브 항목을, 상한용적률은 공공시설 부지 제공 등 공공기여를 전제로 합니다. 이 화면은 인센티브 배점과 공공기여 산식을 아직 계산하지 않고 단계만 고릅니다.</p>`;
  const z = document.getElementById('zone'); z.value = P.zone; z.onchange = () => { P.zone = z.value; saveP(); render(); };
  const f = document.getElementById('farMode'); f.value = P.farMode; f.onchange = () => { P.farMode = f.value; saveP(); render(); };
  bindNum(['infraRatio', 'farCustom', 'sideRoadW', 'schoolArea', 'otherInfra', 'greenInfra', 'pubBldg', 'valMult', 'roadWork', 'parkWork']);
  bindInfra(a);
}
function sideWOf() { return num(P.sideRoadW) || 8; }
// 기존 정비기반시설(국공유) 판단표 — 담당자·정비업체가 근거를 보고 넣기/빼기로 확정
// 진입도로(가정) — 경계 도로별 역할·일방통행·건너편 녹지, 제25조 ①(진입도로 1개)과 ③(2개 폭 합) 비교
// 면적 부족분 채우기 안내 — 경계 도로 확폭은 기능(진입도로 제25조·도시계획도로 결정·교통성 검토)으로만 정하므로 여기서 쓰지 않음
//  순서: ① 공원·녹지 늘리기(법정·제안 기준 이상) ② 공공공지 ③ 구역 안 도로(✂ 남기기/신설). 자동 적용은 공원 면적만
function fillGuide(inf, need) {
  if (!(need > 1)) return '';
  const to = Math.ceil(((inf.parkNeed || 0) + need) / 10) * 10;
  return `<ol style="margin:2px 0 0 18px"><li>공원·녹지 면적 늘리기 — 지금 ${fmt(inf.parkNeed || 0)}㎡ → ${fmt(to)}㎡ <button type="button" class="btn ghost sm" data-parkto="${to}">공원 면적 ${fmt(to)}㎡로</button></li>
    <li>공공공지 — 아래 '그 밖의 정비기반시설 면적'에 넣기</li><li>구역 안 도로 — 지도에서 ✂로 구역 안 도로를 남기거나 새로 지정</li></ol>`;
}
const FILL_NOTE = '도로 확폭은 기능(진입도로 기준·도시계획도로 결정·교통성 검토)으로만 정하므로 부족분 채우기에는 쓰지 않습니다. 공원·공공공지·구역 안 도로로 채우세요.';
// 면적 목표(확보 목표 부족분·상한용적률 도달)별로 모자라는 면적과 채우는 방법 안내
function shortGuide(inf, pl) {
  const goals = [];
  if (inf.short > 1) goals.push(['확보 목표(면적) 부족분', inf.short]);
  const c = pl.farCalc, f2 = RULES.far[P.zone];
  if (c && !c.capped && f2) { const needPa = Math.max(0, (f2.max - f2.allowed) / (1.5 * f2.base) * c.site - c.pb / 1.5), more = needPa + c.fac - c.newPub; if (more > 1) goals.push([`상한용적률 ${f2.max}% 도달(지금 산식 ${c.v}%)`, more]); }
  if (!goals.length) return '';
  return `<div style="margin-top:8px"><b>면적 목표별 모자라는 면적</b><ul style="margin:4px 0 0 18px">${goals.map(([t, need]) => `<li><b>${t}</b> ${fmt(need)}㎡${fillGuide(inf, need)}</li>`).join('')}</ul>
    <p class="u" style="margin:4px 0 0">${FILL_NOTE} 획지가 줄어드는 만큼 산식이 조금 달라지니 채운 뒤 다시 확인하세요.</p></div>`;
}
function entrySection(inf, pl) {
  const e = inf.entry; if (!e || !inf.roadsReady) return '';
  const z = Z.zones[S.region] || {}, edge = (z.roads && z.roads.edge || []).slice().sort((x, y) => y.w - x.w), eo = e.opt || {};
  if (z.roads && !z.roads.edgeDecOk) setTimeout(() => INFRA.fetchEdgeDec(S.region), 0);
  const role = r => (e.e1 && r.pnu === e.e1.pnu) ? '<b>진입도로</b>' : (e.mode === 3 && e.e2 && r.pnu === e.e2.pnu) ? '<b>두 번째 진입도로</b>' : '주변 도로';
  const wide = edge.filter(r => r.w >= 20 && !(eo[r.pnu] || {}).green);
  // 도로별 고를 폭: 현황 유지 · 추천 · 같은 대분류(소로/중로/대로) 안의 표준 폭 · 다음 등급 하나 — 각각 늘어나는 도로 면적을 같이 보여 줌
  const opts = r => {
    const p = e.per[r.pnu] || {}, big = ROADCLS.big(ROADCLS.of(r.w));
    const ws = new Set([p.rec]);
    ROADCLS.std.filter(w => w > r.w + 0.2).forEach((w, i) => { if (ROADCLS.big(ROADCLS.of(w)) === big || i === 0) ws.add(w); });
    if (p.manual) ws.add(p.pw);
    const list = [...ws].filter(w => w > r.w + 0.2).sort((x, y) => x - y);
    const cur = p.keep ? 'keep' : p.manual ? String(p.pw) : 'auto';
    const lab = w => `${w}m ${ROADCLS.of(w)} · +${fmt(INFRA.widenArea(r, z, w))}㎡`;
    return `<select data-edgesel="${esc(r.pnu)}" aria-label="${esc(r.jibun)} 계획 폭" style="max-width:230px">
      <option value="auto" ${cur === 'auto' ? 'selected' : ''}>추천 ${p.rec > r.w + 0.2 ? lab(p.rec) : '현황 유지(확폭 필요 없음)'}</option>
      <option value="keep" ${cur === 'keep' ? 'selected' : ''}>현황 유지 ${r.w}m · 0㎡</option>
      ${list.map(w => `<option value="${w}" ${cur === String(w) ? 'selected' : ''}>${lab(w)}</option>`).join('')}
      <option value="custom">직접 입력…</option></select>`;
  };
  const why = r => {
    const p = e.per[r.pnu] || {}, o = eo[r.pnu] || {}, isE1 = e.e1 && r.pnu === e.e1.pnu && e.mode === 1;
    const rs = [], fr = p.front || INFRA.widenArea(r, z, r.w + 1);
    const isEntry = (e.e1 && r.pnu === e.e1.pnu) || (e.mode === 3 && e.e2 && r.pnu === e.e2.pnu);
    if (isE1 && e.W > r.w) rs.push(`진입도로 제25조 ${e.W}m`);
    if (e.e1 && r.pnu === e.e1.pnu && fr < 10) rs.push(`<b class="warn">구역에 닿은 길이 약 ${fmt(fr)}m — 모퉁이만 닿아 진입도로로 쓰기 어려움, 다른 도로를 고르세요</b>`);
    else if (isEntry && fr < 30) rs.push(`<b class="warn">구역에 닿은 길이 약 ${fmt(fr)}m — 짧게 닿음, 진입도로로 적정한지 확인하세요</b>`);
    // 짧게 닿은 도로(부분 확폭이 되는 도로): 자동으로는 현황 유지, 직접 넓히면 병목 경고
    if (p.partial && !isEntry) {
      const how = `구역에 닿은 구간 약 ${fmt(fr)}m${p.len ? `(도로 필지 길이 약 ${fmt(p.len)}m)` : ''}`;
      if (p.manual && p.pw > r.w + 0.2) return `<b class="warn">부분 확폭(병목) — ${how}뿐이라 연속 확폭이 아님. 도로 전체 확폭은 도시계획도로 결정으로 따로 검토</b>`;
      return `${how} — 짧게 닿아 넓히면 병목이 되므로 현황 유지${p.dec ? ` · 도시계획도로 ${esc(p.dec)} 결정 — 도로 전체 확폭은 결정 사항으로 따로 검토` : ''}`;
    }
    if (p.dec) rs.push(`도시계획도로 ${esc(p.dec)} 결정(하한 ${ROADCLS.lower(p.dec)}m)`);
    if (o.oneway && r.w < 10) rs.push('일방통행 → 양방향 10m');
    if (e.sideW > r.w) rs.push(`최소 폭 ${e.sideW}m`);
    return rs.length ? rs.join(' · ') : `현황 ${ROADCLS.of(r.w)} — 같은 등급 안이라 확폭 필요 없음`;
  };
  return `<details class="gi" open><summary><b>경계 도로·진입도로 (가정 — 교통 검토 후 확정)</b> — ${e.mode === 3 ? `제25조③ 2개 진입도로 ${esc(e.e1.jibun)}(${e.e1.w}m) + ${esc(e.e2.jibun)}(${e.e2.w}m)` : `제25조① ${e.e1 ? `${esc(e.e1.jibun)}(현황 약 ${e.e1.w}m) → ${e.W}m 이상` : '경계 도로 없음'}`} · 경계 도로 확폭 ${fmt(inf.roadArea)}㎡</summary>
    <p class="hint">구역 경계 도로는 구역 쪽으로 넓혀 기부채납합니다. 도로마다 <b>추천 폭</b>은 기능상 필요한 폭만 채운 값입니다(진입도로 제25조·도시계획도로 결정 등급·일방통행·최소 폭 중 큰 값). <b>확폭은 면적 부족분 채우기에 쓰지 않습니다.</b> 구역에 30m 미만 또는 도로 필지 길이의 절반 미만만 닿은 도로는 넓히면 병목이 되므로 현황 유지로 추천합니다.</p>
    <p class="hint">${fmt(pl.units)}세대 기준 — ① 진입도로 1개: 폭 ${e.W}m 이상 · ③ 진입도로 2개: 각 4m 이상, 폭 합 ${e.W2}m 이상(4~6m 도로는 기간도로와 통행거리 200m 이내일 때만 — 자동으로는 6m 이상만 고름). 확폭 면적: ① ${fmt(e.A1)}㎡${e.A3 != null ? ` · ③ ${fmt(e.A3)}㎡` : ' · ③ 고를 두 번째 도로 없음'}.</p>
    ${trafficWidenBox()}
    <div class="seg" role="group" aria-label="진입도로 기준" style="margin:4px 0"><button type="button" data-entrymode="auto" aria-pressed="${e.em === 'auto'}">자동(확폭 적은 쪽)</button><button type="button" data-entrymode="1" aria-pressed="${e.em === '1'}">① 진입도로 1개</button><button type="button" data-entrymode="3" aria-pressed="${e.em === '3'}" ${e.e2 ? '' : 'disabled'}>③ 진입도로 2개</button></div>
    <div class="tscroll"><table class="gi-tbl"><thead><tr><th>지번</th><th class="r">현황 폭(m)</th><th>등급(현황)</th><th>역할</th><th>계획 폭</th><th>추천 근거</th><th class="r">확폭㎡</th><th class="r" title="계획 폭을 1m 더 넓힐 때 새로 도로가 되는 면적 ≈ 구역에 닿은 길이(m)">+1m당㎡<br><span class="u">≈닿은 길이</span></th><th>진입도로로</th><th>일방통행</th><th>건너편 녹지</th></tr></thead><tbody>
    ${edge.map(r => `<tr><td><button type="button" class="linkbtn" data-edgefocus="${esc(r.pnu)}">${esc(r.jibun)}</button></td><td class="r">${r.w}</td><td>${ROADCLS.of(r.w)}${(e.per[r.pnu] || {}).dec ? `<br><span class="u">결정 ${esc(e.per[r.pnu].dec)}</span>` : ''}</td><td>${role(r)}</td>
      <td>${opts(r)}</td><td class="wrap u">${why(r)}</td>
      <td class="r">${fmt((e.per[r.pnu] || {}).area || 0)}</td><td class="r">${fmt((e.per[r.pnu] || {}).perM || 0)}</td>
      <td><input type="radio" name="entryPick" data-entrypick="${esc(r.pnu)}" ${e.e1 && r.pnu === e.e1.pnu ? 'checked' : ''} aria-label="${esc(r.jibun)} 진입도로로"></td>
      <td><input type="checkbox" data-edgeopt="oneway" data-pnu="${esc(r.pnu)}" ${(eo[r.pnu] || {}).oneway ? 'checked' : ''} aria-label="${esc(r.jibun)} 일방통행"></td>
      <td><input type="checkbox" data-edgeopt="green" data-pnu="${esc(r.pnu)}" ${(eo[r.pnu] || {}).green ? 'checked' : ''} aria-label="${esc(r.jibun)} 건너편 녹지"></td></tr>`).join('')}
    </tbody></table></div>
    ${e.picked ? '<button type="button" class="btn ghost sm" id="entryAuto">진입도로 자동으로 되돌리기</button>' : ''}
    ${shortGuide(inf, pl)}
    <p class="u" style="margin:4px 0 0">현황 폭은 필지 모양으로 추정한 값입니다. 진입도로 자동 선택은 구역에 10m 이상 닿은 도로만 봅니다(모퉁이만 스치는 도로 제외). 진입도로는 제25조 폭 아래로 고를 수 없습니다(골라도 제25조 폭으로 계산). 일방통행 도로는 진입도로 후보에서 뺍니다. 건너편 녹지가 있는 쪽은 구역 안에 완충녹지를 따로 두지 않아도 되는 것으로 봅니다.${z.roads && !z.roads.edgeDecOk ? ' 도시계획도로 결정 여부를 확인하는 중…' : ''}${wide.length ? ` <b class="warn">폭 20m 이상 경계 도로(${wide.map(r => esc(r.jibun)).join(', ')})에 닿아 있음 — 소음·완충녹지 필요 여부를 검토하세요(건너편 녹지가 있으면 체크).</b>` : ''}</p>
  </details>`;
}
// 무상양도 금액 비교(개략): 용도폐지 시설 평가액 vs 신설 정비기반시설 설치비용(부지가액 + 공사비)
function moneyBox(inf) {
  const m = inf.money; if (!m) return '';
  const won = v => fmt(Math.round(v / 1e6)) + '백만원';
  const hasWork = num(P.roadWork) > 0 || num(P.parkWork) > 0;
  const ok = m.newCost >= m.oldVal - 1;
  const unk = (inf.giAll || []).filter(x => x.pub && x.include && !x.reply).length;
  return `<div style="margin-top:4px"><b>무상양도 금액 비교(개략 — 확정은 사업시행계획인가 때 감정평가 후)</b> — 용도폐지 시설 ${won(m.oldVal)}(사용 중 면적 × 공시지가 평균 ${fmt(m.pubPrice)}원/㎡ × ${m.vmul}) vs 신설 설치비용 ${won(m.newCost)}(부지 ${won(m.newLand)} = 신설 면적 × 사유지 공시지가 평균 ${fmt(m.privPrice)}원/㎡ × ${m.vmul}${hasWork ? ` + 공사비 ${won(m.newWork)}` : ' + 공사비 <b>단가 미입력</b>'}) → ${ok ? '<b class="good">설치비용이 커서 용도폐지 시설 전부 무상양도 가능(개략)</b>' : `<b class="warn">설치비용이 ${won(m.oldVal - m.newCost)} 모자람 — 모자라는 만큼은 유상 매입</b>`}
    <div class="u">감정평가 배율 ${m.vmul}·공사비 단가는 가정값입니다(아래 입력). 실제 무상양도 범위는 사업시행계획인가 때 용도폐지 시설 감정평가액과 신설 시설 설치비용을 비교해 정하고, 관리청 의견을 듣습니다(제97조②④). 무상양도는 <b>행정재산</b>만 대상이고 <b>일반재산은 빠집니다</b>(매수 대상, 대법원 2026다202915)${unk ? ` — 넣은 국공유 ${unk}필지는 행정재산·일반재산 회신 전이라, 일반재산이면 위 용도폐지 금액에서 빠지고 매수비로 넘어갑니다` : ''}.</div></div>`;
}
// 추후 할 일(지정 단계에서 결정하지 않고 남겨 두는 것)
function todoSection(a, pl) {
  const inf = pl.infra, z = Z.zones[a.key] || {}, items = [];
  const fac = (inf && inf.facList) || [];
  if (fac.length) items.push(`구역 안 도시계획시설 결정선 ${fac.length}건 ${fmt(fac.reduce((t, f) => t + (f.area || 0), 0))}㎡ — 정비계획 결정·사업시행계획인가 때 도시계획시설 변경(폐지·선형 조정) 검토. 미집행이면 실효(국토계획법 제48조, 결정 고시 후 20년) 시기도 확인`);
  if (inf && (inf.giAll || []).some(x => x.pub && x.grade !== '확실' && !x.reply)) items.push('국공유 필지 재산관리 부서 조회(행정재산·일반재산 구분, 점유·대부) — 일반재산은 무상양도 대상이 아님(대법원 2026. 9. 3. 선고 2026다202915). 판단표의 엑셀로 요청');
  if (inf && inf.money && inf.innerArea > 0 && !P.keepInnerRoads) items.push('무상양도 범위 확정 — 사업시행계획인가 때 용도폐지 시설(행정재산) 감정평가액과 신설 정비기반시설 설치비용 비교, 관리청 의견 청취(도정법 제97조②④). 일반재산·초과분은 매수');
  if (inf && inf.entry) items.push('진입도로·주출입구 위치 — 교통영향평가·경찰 협의 뒤 확정(지금은 가정)');
  if (inf && inf.money && !(num(P.roadWork) > 0)) items.push('정비기반시설 공사비 단가 — 설계·관리청 협의로 정해 무상양도 금액 비교에 넣기');
  if (!items.length) return '';
  return `<h3>추후 할 일</h3><ol class="todo">${items.map(t => `<li>${t}</li>`).join('')}</ol>`;
}
function giSection(inf) {
  const g = inf.giAll || [];
  if (!INFRA.ready(S.region)) return '<p class="hint">국공유 필지 소유구분·도시계획시설을 확인하는 중…</p>';
  const pubs = g.filter(x => x.pub), priv = g.filter(x => !x.pub);
  const chk = (b, t) => `<span class="ev ${b ? 'on' : ''}" title="${t}">${b ? '✓' : '·'} ${t}</span>`;
  const gradeCls = { '확실': 'ok', '확인 필요': 'bad', '가능성 높음': 'info', '아닐 가능성': '', '사유(참고)': '' };
  const inA = pubs.filter(x => x.include).reduce((t, x) => t + x.area, 0);
  const inUse = pubs.filter(x => x.include).reduce((t, x) => t + x.useA, 0), inOcc = inA - inUse;
  return `<details class="gi" ${pubs.some(x => x.grade !== '확실' && !x.dec) ? 'open' : ''}>
    <summary><b>기존 정비기반시설 판단</b> — 국공유 ${pubs.length}필지 중 ${pubs.filter(x => x.include).length}필지 ${fmt(inA)}㎡ 넣음${inOcc >= 1 ? ` (사용 중 도로 등 ${fmt(inUse)}㎡ / 건물 점유 ${fmt(inOcc)}㎡ — 점유분은 확보 목표·무상양도에서 뺌)` : ''}${pubs.filter(x => x.grade === '확인 필요' && !x.dec).length ? ` · <b class="warn">확인 필요 ${pubs.filter(x => x.grade === '확인 필요' && !x.dec).length}필지</b>(지목과 실제 쓰임이 다름)` : ''}${priv.length ? ` · 사유 도로 등 ${priv.length}필지(목표 제외, 참고)` : ''}</summary>
    <p class="hint">국가·지자체 소유이면서 실제 도로·구거·공원 등으로 쓰이는 땅만 확보 목표(무상양도 대상)에 넣습니다. 재산관리 부서 회신을 '회신' 칸에 넣으면 반영됩니다(지적 불부합 → 건물 점유를 빼지 않음, 일반재산 → 뺌). 근거를 보고 '판단'을 바꾸면 확보 목표가 바로 다시 계산됩니다. 지번을 누르면 지도에서 보여 줍니다(위성사진은 지도 오른쪽 위 층 단추).</p>
    <div class="tscroll"><table class="gi-tbl"><thead><tr><th>지번</th><th>지목</th><th>소유</th><th>토지이용상황</th><th>근거</th><th>건물·결정·취득</th><th>자동 판정</th><th>판단</th><th title="재산관리 부서 조회 회신">회신</th><th class="r">편입㎡</th><th class="r" title="필지 안쪽(가장자리 1.2m 뺌)을 건물이 덮은 넓이 — 확보 목표·무상양도에서 뺌">건물 점유㎡</th><th class="r">사용 중㎡</th></tr></thead><tbody>
    ${g.map(x => `<tr class="${x.include ? 'inc' : ''}">
      <td><button type="button" class="linkbtn" data-gifocus="${esc(x.p.pnu)}">${esc(x.p.jibun)}</button></td>
      <td>${esc(x.p.jimok)}</td><td>${esc(x.p.own || '확인 중')}${x.p.ownInst && x.p.ownInst !== '구분없음' ? `<br><span class="u">${esc(x.p.ownInst)}</span>` : ''}</td><td>${esc(x.p.landUse || '–')}</td>
      <td class="evs">${chk(x.jm, '공공 지목')}${chk(x.lu, '이용상황 도로등')}${chk(x.fc, '도시계획시설 안')}${chk(x.thin, `길쭉함(폭 약 ${x.w}m)`)}${x.bldOn ? '<span class="ev bad">✕ 건물 있음</span>' : chk(x.noBld, '건물 없음')}</td>
      <td class="u">${x.noBld ? '건물 없음' : `건물 ${x.nLedger + x.nGis}동${x.nGis ? `(대장 없음 ${x.nGis})` : ''}`}${x.cover > 0.05 ? `<br>건물 겹침 ${Math.round(x.cover * 100)}% <span title="필지 가장자리 1.2m(처마·지적 경계 어긋남)를 뺀 안쪽 기준">(안쪽 ${Math.round((x.coreC || 0) * 100)}%)</span>${x.bldOn ? ' <b class="warn">점유 의심</b>' : ' — 대부분 가장자리(처마·경계 어긋남)'}` : ''}<br>${x.facKind ? `결정: ${esc(x.facKind)}` : '도시계획시설 결정 없음'}<br>${x.p.chgDate ? `${esc(x.p.chgDate)} ${esc(x.p.chgCause || '')}` : ''}</td>
      <td><span class="pill ${gradeCls[x.grade]}">${x.grade}</span></td>
      <td>${x.pub ? `<select data-gidec="${esc(x.p.pnu)}" aria-label="${esc(x.p.jibun)} 판단"><option value="" ${!x.dec ? 'selected' : ''}>자동(${x.grade === '아닐 가능성' ? '뺌' : '넣음'})</option><option value="in" ${x.dec === 'in' ? 'selected' : ''}>넣기(무상양도 대상)</option><option value="out" ${x.dec === 'out' ? 'selected' : ''}>빼기</option></select>` : '<span class="u">사유 — 제외</span>'}</td>
      <td>${x.pub ? `<select data-gireply="${esc(x.p.pnu)}" aria-label="${esc(x.p.jibun)} 회신"><option value="">–</option>${[['use', '행정재산(공공용)'], ['occupy', '행정재산·점유(대부·무단)'], ['mismatch', '지적 불부합'], ['general', '일반재산(무상양도 제외)']].map(([v, t]) => `<option value="${v}" ${x.reply === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : ''}</td>
      <td class="r">${fmt(x.area)}</td><td class="r">${x.occ >= 1 ? `<b class="warn">${fmt(x.occ)}</b>` : '–'}</td><td class="r">${fmt(x.useA)}</td></tr>`).join('') || '<tr><td colspan="12" class="u">구역 안 국공유·공공 지목 필지 없음</td></tr>'}
    </tbody></table></div>
    <button type="button" class="btn ghost sm" id="giCopy">표 복사(엑셀 붙여넣기용)</button>
    <button type="button" class="btn sm" id="giAsk" title="자동 판정이 '확인 필요·가능성 높음·아닐 가능성'인 국공유 필지를 재산관리 부서 조회 요청용 엑셀로 저장">재산관리 부서 조회 요청 목록(엑셀)</button>
  </details>`;
}
// 정비기반시설도(도면) — 이미 계획도가 있는 구역(구역지정·심의·사업시행인가 완료 구역 등)
//  CAD(DXF, 측량 좌표) 또는 GeoJSON을 올리면 레이어별로 종류(도로·공원·녹지 등)를 정해 그대로 계산하고, 자동 제안과 나란히 비교
//  z.infra.plan = { name, at, crs, feats:[{layer, geom}], kinds:{레이어: 종류} } — 작업 저장 파일에 함께 들어감, 서버로 보내지 않음
function drawingAuto(a) {
  // 같은 구역을 '제안값'으로 계산한 결과(비교용)
  const keep = P.infraMode; P.infraMode = 'proposal';
  let pl = null; try { pl = planRaw(a); } catch (er) { pl = null; } finally { P.infraMode = keep; }
  return pl;
}
function drawingSection(a, pl) {
  const z = Z.zones[a.key] || {}, dp = (z.infra || {}).plan, inf = pl.infra;
  const up = `<div class="row" style="display:flex;flex-wrap:wrap;gap:6px;margin:6px 0"><button type="button" id="drwLoad">${dp ? '도면 다시 올리기' : '정비기반시설도 올리기 (DXF·GeoJSON)'}</button><button type="button" id="drwPdf" title="CAD에서 PDF로 내보낸 도면: 지도 왼쪽 '참고 도면 겹쳐 보기'로 올려 두 점으로 맞춘 뒤 누르면 PDF 안 폴리선을 가져옴">겹쳐 맞춘 PDF에서 가져오기</button>${dp ? '<button type="button" id="drwClear">도면 지우기</button>' : ''}</div>
    <input type="file" id="drwFile" accept=".dxf,.geojson,.json" hidden>
    <p class="hint">구역지정·심의·사업시행인가가 끝난 구역처럼 정비기반시설 계획도가 이미 있으면, CAD 도면(측량 좌표가 들어간 DXF, 닫힌 폴리선)을 올려 실제 계획 그대로 획지·세대수·사업성을 계산합니다. 자동 제안과 나란히 비교해 차이를 봅니다. CAD에서 내보낸 PDF(폴리선이 살아 있는 PDF)는 '참고 도면 겹쳐 보기'로 올려 두 점으로 맞춘 뒤 [겹쳐 맞춘 PDF에서 가져오기]를 누르세요 — PDF 레이어 이름이 없으면 색깔별로 묶어 보여 주니 종류를 골라 주세요. 스캔한 PDF·JPG는 선이 그림이라 직접 그려야 합니다.</p>`;
  if (!dp) return up;
  const K = ZoneKit.INFRA_KINDS, kinds = dp.kinds || {};
  const lay = {}; dp.feats.forEach(f => { const o = lay[f.layer] || (lay[f.layer] = { n: 0, A: 0 }); o.n++; try { o.A += turf.area({ type: 'Feature', properties: {}, geometry: f.geom }); } catch (er) { /* 무시 */ } });
  const layRows = Object.entries(lay).sort((x, y) => y[1].A - x[1].A).map(([l, o]) => {
    const k = kinds[l] || ZoneKit.infraKind(l);
    const sw = /^색 (#[0-9a-f]{6})$/i.exec(l);
    return `<tr><td>${sw ? `<span style="display:inline-block;width:12px;height:12px;border:1px solid #888;background:${sw[1]};vertical-align:-2px;margin-right:4px"></span>` : ''}${esc(l)}</td><td class="r">${o.n}</td><td class="r">${fmt(o.A)}</td><td><select data-drwk="${esc(l)}">${K.map(([v, t]) => `<option value="${v}"${v === k ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></td></tr>`;
  }).join('');
  // 자동 제안 vs 도면(실제) — 같은 줄에 두 값을 나란히
  const au = drawingAuto(a), ai = au && au.infra, d = inf && inf.drawing;
  const pc = (v, A) => A ? (v / A * 100).toFixed(1) + '%' : '–';
  const row = (t, av, dv) => { const df = (dv ?? 0) - (av ?? 0); return `<tr><td>${t}</td><td class="r">${av == null ? '–' : fmt(av)}</td><td class="r">${dv == null ? '–' : fmt(dv)}</td><td class="r${Math.abs(df) > 0.5 ? ' warn' : ''}">${dv == null || av == null ? '' : (df >= 0 ? '+' : '') + fmt(df)}</td></tr>`; };
  const A = a.area;
  const cmp = inf && d ? `<h3>자동 제안 ↔ 정비기반시설도 비교</h3>
    <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">자동 제안 ㎡</th><th class="r">도면(실제) ㎡</th><th class="r">차이</th></tr></thead><tbody>
      ${row('도로', ai ? ai.roadArea : null, inf.roadArea)}
      ${row('공원', ai ? ai.parkArea : null, inf.parkArea)}
      ${row('녹지', ai ? ai.green : null, inf.green)}
      ${row('그 밖의 정비기반시설', ai ? ai.other : null, inf.other)}
      ${row('학교용지', ai ? ai.schoolArea : null, inf.schoolArea)}
      ${row('종교용지', ai ? ai.relArea : null, inf.relArea)}
      ${row('공공청사 등', ai ? ai.pubB : null, inf.pubB)}
      ${row('기반시설 등 합계', ai ? ai.total : null, inf.total)}
      <tr><td>기반시설 비율</td><td class="r">${ai ? pc(ai.total, A) : '–'}</td><td class="r">${pc(inf.total, A)}</td><td class="r">${ai ? ((inf.total - ai.total) / A * 100 >= 0 ? '+' : '') + ((inf.total - ai.total) / A * 100).toFixed(1) + '%p' : ''}</td></tr>
      ${row('공동주택 획지', au ? au.site : null, pl.site)}
      ${row('세대수(개략)', au ? au.units : null, pl.units)}
    </tbody></table></div>
    <div class="row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:6px 0"><button type="button" id="drwCase">실제 사례로 저장</button><span class="hint">사례 이름은 'A구역'처럼 익명으로. 사업성 화면 '실제 사례와 비교'에 함께 쌓여 자동 계산의 치우침을 봅니다.</span></div>` : '';
  return `${up}
    <p class="note">올린 도면: <b>${esc(dp.name)}</b> (${esc(dp.at)}) · ${esc(dp.crs || '')} · 닫힌 도형 ${dp.feats.length}개. 구역 밖 부분은 잘라 내고, 종류끼리 겹치면 도로 → 공원 → 녹지 → 그 밖의 시설 → 학교 → 종교 → 공공청사 순으로 셉니다. 레이어 종류가 틀리면 아래에서 고르세요.</p>
    <div class="tscroll"><table class="ledger"><thead><tr><th>레이어</th><th class="r">도형</th><th class="r">면적㎡</th><th>종류</th></tr></thead><tbody>${layRows}</tbody></table></div>
    ${cmp}`;
}
function bindDrawing(a) {
  const z = zoneOf(a.key); z.infra = z.infra || {};
  const f = $id('drwFile'), ld = $id('drwLoad'); if (!f || !ld) return;
  ld.onclick = () => { f.value = ''; f.click(); };
  // 구역에 닿는 도형만(도면 테두리처럼 구역보다 훨씬 큰 것과 아주 작은 것은 뺌), 좌표는 7자리로 줄여 저장
  const useFeats = (name, feats, crs) => {
    const zone = z.geojson, zA = turf.area(zone), r7 = g => JSON.parse(JSON.stringify(g, (k, v) => typeof v === 'number' ? Math.round(v * 1e7) / 1e7 : v));
    const hit = feats.filter(ft => { try { const F = { type: 'Feature', properties: {}, geometry: ft.geom }, A = turf.area(F); return A >= 5 && A <= zA * 3 && turf.booleanIntersects(F, zone); } catch (er) { return false; } }).map(ft => ({ layer: ft.layer, geom: r7(ft.geom) }));
    if (!hit.length) { statusMsg(`${name}: 이 구역(${regName()})에 닿는 도형이 없습니다. 좌표계·맞춘 위치·구역을 확인하세요(읽은 도형 ${feats.length}개, ${crs}).`, true); return; }
    z.infra.plan = { name, at: new Date().toLocaleString('sv-SE').slice(0, 16), crs, feats: hit, kinds: {} };
    saveZ(); INFRA.memo = {}; render();
    statusMsg(`${name}: 구역에 닿는 도형 ${hit.length}개(전체 ${feats.length}개, ${crs})를 정비기반시설도로 넣었습니다. 레이어(색) 종류를 확인하세요.`);
  };
  const pb = $id('drwPdf'); if (pb) pb.onclick = () => {
    const v = typeof RefOverlay !== 'undefined' ? RefOverlay.vectorsLL() : null;
    if (!v) { statusMsg(typeof RefOverlay !== 'undefined' && RefOverlay.img && !RefOverlay.aligned ? '겹친 도면을 먼저 [두 점으로 맞추기]로 맞춰 주세요.' : RefOverlay && RefOverlay.img && !(RefOverlay.vec || []).length ? '겹친 도면에 폴리선이 없습니다(스캔·그림 PDF). 직접 그리거나 CAD에서 DXF로 받아 주세요.' : "지도 왼쪽 '참고 도면 겹쳐 보기'로 CAD에서 내보낸 PDF를 올리고 두 점으로 맞춘 뒤 누르세요.", true); return; }
    useFeats(`PDF 도면(${RefOverlay.vec.length}개 도형)`, v, 'PDF 두 점 맞춤');
  };
  f.onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    statusMsg(`${file.name} 읽는 중…`);
    try {
      let feats = [], crs = '';
      if (/\.dxf$/i.test(file.name)) {
        const c = LM ? LM.getCenter() : null, r = await ZoneKit.readDxfAll(await file.arrayBuffer(), c ? [c.lat, c.lng] : null);
        if (r.error) { statusMsg(r.error, true); return; }
        feats = r.feats.map(x => ({ layer: x.layer, geom: x.geom })); crs = r.crs;
      } else {
        const gj = JSON.parse(await file.text()), fs = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', properties: {}, geometry: gj }];
        fs.forEach(ft => { const g = ft.geometry; if (!g) return; const pr = ft.properties || {}, layer = String(pr.layer || pr.kind || pr['용도'] || pr['시설'] || pr.name || '0');
          (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []).forEach(c => feats.push({ layer, geom: { type: 'Polygon', coordinates: c } })); });
        crs = 'GeoJSON(경위도)';
      }
      useFeats(file.name, feats, crs);
    } catch (er) { statusMsg(`${file.name}을(를) 읽지 못했습니다: ${er.message}`, true); }
  };
  const cl = $id('drwClear'); if (cl) cl.onclick = () => { if (!confirm('올린 정비기반시설도를 지울까요?')) return; delete z.infra.plan; saveZ(); INFRA.memo = {}; render(); };
  document.querySelectorAll('[data-drwk]').forEach(sel => sel.onchange = () => { const dp = z.infra.plan; if (!dp) return; dp.kinds = dp.kinds || {}; dp.kinds[sel.dataset.drwk] = sel.value; saveZ(); INFRA.memo = {}; render(); });
  const cs = $id('drwCase'); if (cs) cs.onclick = () => {
    if (!window.JbsCases) { statusMsg('사례 저장 기능을 불러오지 못했습니다.', true); return; }
    const name = prompt('사례 이름(익명, 예: A구역)', 'A구역'); if (!name) return;
    const stage = prompt('단계(정비계획(구역지정) 고시 / 정비계획 변경 고시 / 사업시행계획인가 / 관리처분계획인가 / 기타)', '사업시행계획인가') || '기타';
    const pl = plan(a), au = drawingAuto(a), inf = pl.infra, ai = au && au.infra, A = a.area;
    const r = JbsCases.save({ name: name.trim(), stage: stage.trim(), memo: `/urban 정비기반시설도(${(z.infra.plan || {}).name || ''})`,
      actual: { siteArea: Math.round(A), infraPct: Math.round(inf.total / A * 1000) / 10, lotArea: Math.round(pl.site) },
      auto: ai ? { siteArea: Math.round(A), infraPct: Math.round(ai.total / A * 1000) / 10, lotArea: Math.round(au.site), units: au.units } : {},
      autoAt: new Date().toLocaleString('sv-SE').slice(0, 16), geojson: z.geojson });
    statusMsg(r ? `사례 '${name}'을(를) 저장했습니다. 세대수·용적률·사업성 실제 값은 사업성 화면 '실제 사례와 비교'에서 채우세요.` : '저장하지 못했습니다(브라우저 저장 공간). 작업 저장으로 파일을 내려받아 두세요.', !r);
  };
}
function infraSection(a, pl) {
  const inf = pl.infra, manual = P.infraMode === 'manual', drawing = P.infraMode === 'drawing';
  const head = `<div class="infra-head"><h3 style="margin:0">정비기반시설 ${drawing ? '(정비기반시설도)' : '제안'}</h3>
    <div class="seg" role="group" aria-label="기반시설 비율"><button type="button" data-im="proposal" aria-pressed="${P.infraMode === 'proposal' || !P.infraMode}">제안값 사용</button><button type="button" data-im="drawing" aria-pressed="${drawing}" title="이미 정비기반시설 계획도가 있는 구역(지정·인가된 구역 등): CAD 도면을 올려 실제 계획 그대로 계산">기반시설도 올리기</button><button type="button" data-im="manual" aria-pressed="${manual}">비율 직접 입력</button></div></div>`;
  if (manual) return head + '<p class="hint">제안값 대신 아래 "정비기반시설 비율"에 넣은 값으로 계산합니다.</p>';
  if (drawing) return head + drawingSection(a, pl);
  if (!inf) return head;
  const lo = INFRA.loading[a.key];
  const rows = [];
  inf.items.forEach(it => rows.push(it.kind === 'manual' ? ['직접 지정한 도로', it.area, '구역계 자르기로 도로(기반시설)로 지정한 조각 — 지도에서 누르면 취소'] : [`${{ entry: '진입도로', entry2: '두 번째 진입도로' }[it.kind] || '주변 도로'} 확폭 · ${esc(it.jibun)}`, it.area, (it.kind === 'entry' ? (inf.entry && inf.entry.mode === 3 ? `제25조③ 진입도로 2개 폭 합 ${inf.entry.W2}m 이상(${fmt(pl.units)}세대)` : `주택건설기준 등에 관한 규정 제25조① — ${fmt(pl.units)}세대 기준 폭 ${inf.W}m 이상`) : it.kind === 'entry2' ? `제25조③ 진입도로 2개 폭 합 ${inf.entry.W2}m 이상` : it.manual ? '직접 고른 계획 폭' : it.dec ? `도시계획도로 ${esc(it.dec)} 결정 — 등급 하한 ${ROADCLS.lower(it.dec)}m까지` : it.oneway ? '일방통행 → 양방향 소로1류 하한 10m' : `경계 도로 최소 ${sideWOf()}m(소로2류 하한)`) + ` → 약 ${it.to}m. 현황 약 ${it.from}m(필지 모양으로 추정)` + (it.extra ? ` · 확보 목표 부족분 채우려 +${fmt(it.extra, 1)}m 더 넓힘` : '')]));
  if (!inf.items.length) rows.push(['도로 확폭', 0, !inf.roadsReady ? (lo ? '경계 도로를 불러오는 중…' : '경계 도로 조회 전') : inf.edge.length ? `경계 도로가 이미 기준 폭 이상(진입도로 ${inf.W}m, 주변 ${inf.sideW}m)` : '구역 경계에 닿은 도로 필지를 찾지 못함 — 진입도로 위치 확인 필요']);
  const szTxt = sz => sz.bad ? `넣은 값이 너무 커서(${sz.mode === 'pct' ? `구역의 ${num(sz.val)}%` : `${fmt(num(sz.val))}㎡`}) 자동값 ${fmt(sz.A)}㎡로 계산` : sz.mode === 'area' ? `직접 지정 ${fmt(num(sz.val))}㎡` : sz.mode === 'pct' ? `구역의 ${num(sz.val)}%로 지정(${fmt(sz.A)}㎡)` : '';
  if (inf.szPark.mode !== 'auto') rows.push(['공원', inf.parkArea, `${szTxt(inf.szPark)}. 법정·제안 기준은 ${fmt(inf.parkLegal)}㎡` + (inf.parkLegal > inf.szPark.A ? ' — <b class="warn">기준보다 작음</b>' : '')]);
  if (inf.parkExist >= 1) rows.push(['기존 공원·녹지', inf.parkExist, `구역 안 기 조성 공원·녹지(지목 공원 또는 이용상황 공원) ${fmt(inf.parkExist)}㎡ — 2030 기본계획(고시 제2026-96호): 제척이 원칙, 부득이 포함하면 법정면적 산정에 넣되 <b>기존 면적 이상</b> 설치. 공원 자동 면적이 이 값보다 작지 않게 잡았습니다${inf.parkArea + (inf.green || 0) < inf.parkExist - 1 ? ' — <b class="warn">지금 공원·녹지가 기존 면적보다 작음</b>' : ''}`]);
  if (inf.szPark.mode === 'auto') rows.push(['공원', inf.parkArea, inf.legal ? `도시공원 및 녹지 등에 관한 법률 시행규칙 별표2 제4호 — 정비계획 5만㎡ 이상: 세대당 2㎡(${fmt(pl.units * 2)}㎡)와 부지 5%(${fmt(a.area * 0.05)}㎡) 중 큰 면적 ${fmt(inf.parkNeed)}㎡` + (inf.parkArea < inf.parkNeed * 0.95 ? ' · <b class="warn">구역 경계에 걸려 모자람 — 위치를 옮기세요</b>' : '') : (P.parkMode === 'always' ? `5만㎡ 미만이라 법정 의무는 없으나 부지 5%로 제안(${fmt(inf.parkNeed)}㎡)` : `구역 ${fmt(a.area)}㎡ < 5만㎡ — 별표2 의무 없음. 2030 인천 정비기본계획 공원·녹지 기준은 고시문 대조 필요`)]);
  if (inf.paired) rows.push(['한 띠로 묶음', 0, `공원·녹지와 종교용지가 맞닿아 구역 경계를 따라 한 띠로 묶였습니다. 둘 중 하나를 끌면 같이 움직이고, 가운데 ⇆로 면적을 나눕니다. <button type="button" class="btn ghost sm" id="unpair">따로 놓기</button>`]);
  else if (((Z.zones[a.key] || {}).infra || {}).noPair) rows.push(['따로 놓음', 0, `공원·녹지와 종교용지를 각자 따로 놓았습니다. <button type="button" class="btn ghost sm" id="repair">맞닿으면 한 띠로 묶기</button>`]);
  if (inf.paired && inf.paired.custom) rows.push(['나눔선 조정', 0, `맞닿은 ${{ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[inf.paired.kinds[0]]} ${fmt(inf.paired.a1)}㎡ · ${{ park: '공원·녹지', rel: '종교용지', school: '학교용지' }[inf.paired.kinds[1]]} ${fmt(inf.paired.a2)}㎡ (합 ${fmt(inf.paired.total)}㎡ 그대로, 위 면적에 반영) <button type="button" class="btn ghost sm" id="resetSplit">처음 나눔으로</button>`]);
  if (inf.absorbed >= 1) rows.push(['자투리 편입', 0, `큰 공동주택 획지와 떨어져 갇힌 1,000㎡ 미만 조각 ${fmt(inf.absorbed)}㎡를 가장 많이 맞닿은 공원·학교·대체부지에 붙였습니다(위 면적에 포함).`]);
  if (inf.szSchool.A > 0) rows.push(['학교용지', inf.schoolArea, `${szTxt(inf.szSchool) || '입력값'} — 교육청 협의로 정함. 정비기반시설이 아니어서 신설(무상귀속) 면적에는 넣지 않음`]);
  if (inf.green) rows.push(['녹지', inf.green, '완충녹지·경관녹지·연결녹지 등(입력값) — 지도에는 그리지 않음']);
  if (inf.other) rows.push(['그 밖의 정비기반시설', inf.other, '공용주차장·공공공지·광장·소방용수시설 등(입력값) — 도정법 제2조제4호·영 제3조']);
  if (inf.pubB) rows.push(['공공청사 등', inf.pubB, '정비기반시설이 아님(입력값). 기부채납·공공기여로 다루며 신설(무상귀속) 면적에는 넣지 않음']);
  if (inf.relAll.length || inf.relManual) {
    const chips = inf.relAll.map(p => `<label class="rel-chip"><input type="checkbox" data-rel="${esc(p.pnu)}" ${inf.rel.includes(p) ? 'checked' : ''}> ${esc(p.jibun)} (${fmt((p.base ?? p.area))}㎡)</label>`).join(' ');
    rows.push([`종교용지(존치·대체) ${inf.rel.length}필지`, inf.relArea, `구역 안 종교시설(교회 등) 부지. 법정 의무는 없으나 실무상 정비계획에서 존치하거나 구역 안 대체부지로 잡아 공동주택 획지에서 뺍니다. 근생 건물의 한 층을 쓰는 교회는 상가 분양·보상 대상이라 넣지 않습니다.<br>${chips || '자동으로 찾은 필지 없음'}${inf.relManual ? ` · <b>${szTxt(inf.szRel)}</b>` : ''}
      <div class="seg" role="group" aria-label="종교용지 위치" style="margin-top:6px"><button type="button" data-relmode="keep" aria-pressed="${!inf.relC}">현 위치 존치</button><button type="button" data-relmode="move" aria-pressed="${!!inf.relC}">대체부지로 옮기기</button></div>
      <span class="u">${inf.relC ? '지도에서 보라색 사각형을 끌어 원하는 자리에 두세요(면적은 종교용지 면적).' : '현재 교회 필지 그대로 둡니다. 보라색을 끌면 대체부지로 바뀝니다.'}</span>`]);
  }
  rows.push([`구역 안 기존 정비기반시설 ${inf.inner.length}필지<br><span class="u">도로·구거 등 국공유</span>`, P.keepInnerRoads ? inf.innerFull : inf.innerArea, (inf.innerOcc >= 1 ? `사용 중 ${fmt(inf.innerArea)}㎡ / 건물 점유 ${fmt(inf.innerOcc)}㎡(필지 ${fmt(inf.innerFull)}㎡). ` : '') + (P.keepInnerRoads
    ? '존치하여 기반시설로 셈(필지 전체)'
    : (inf.innerOcc >= 1 ? '건물 점유 부분은 무상양도 면적에서 뺌. ' : '') + '용도폐지하고 획지에 넣음 — 국가·지자체 소유분은 새로 설치하는 정비기반시설의 설치비용 범위에서 사업시행자에게 무상양도(도정법 제97조②). 존치하려면 아래에서 선택')]);
  return head + `
  ${(() => {
    const ok = inf.short <= 1, tgt = inf.keepArea, nw = inf.newArea, okAll = ok || (inf.money && inf.money.newCost >= inf.money.oldVal - 1);
    return `<div class="target-box ${okAll ? 'ok' : 'ng'}"><div><b>확보 목표(면적, 개략)</b> ${fmt(tgt)}㎡ = ${P.keepInnerRoads ? '기존 도로를 존치해 용도폐지 없음' : `용도폐지되는 설치된 국공유 기반시설 ${inf.inner.length}필지 중 사용 중인 면적`}${inf.innerOcc >= 1 ? ` — <b>건물 점유 ${fmt(inf.innerOcc)}㎡ 뺌</b>(국공유 공공시설 필지 안쪽을 건물이 덮은 부분, 보수적으로 제외)` : ''}</div>
      <div><b>신설 정비기반시설</b> ${fmt(nw)}㎡ → ${ok ? '<b class="good">면적으로도 충족</b>' : `면적으로는 ${fmt(inf.short)}㎡ 적음 <span class="u">(참고 — 무상양도는 아래 금액 기준으로 판단)</span>`}</div>
      ${(() => { const mOk = inf.money && inf.money.newCost >= inf.money.oldVal - 1; return !ok && !mOk ? `<div><b>확보 목표가 ${fmt(inf.short)}㎡ 모자랍니다.</b> ${FILL_NOTE}${fillGuide(inf, inf.short)}</div>` : ''; })()}
      ${moneyBox(inf)}
      <div class="u">용도폐지 대상은 결정되어 <b>설치된</b> 국공유 정비기반시설(제97조③). 위 면적 목표는 개략 확인용입니다.${(inf.facList || []).length ? ` 구역 안 도시계획시설 결정선 ${inf.facList.length}건 ${fmt(inf.facArea)}㎡는 상쇄하지 않고 '추후 할 일'에 남깁니다.` : ''}</div></div>`;
  })()}
  ${entrySection(inf, pl)}
  ${giSection(inf)}
  <p class="hint">지도의 색 구분 <b>기반시설</b>에 위치를 그렸습니다. <b>공원(초록)·학교(파랑)·종교용지(보라)는 지도에서 도형을 끌어 옮기면 됩니다.</b> 아래 버튼을 누른 뒤 지도에서 자리를 눌러도 옮겨집니다.</p>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">면적㎡</th><th>근거·설명</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r[0]}</td><td class="r">${fmt(r[1])}</td><td class="wrap">${r[2]}</td></tr>`).join('')}
  ${(() => { const newA = inf.newArea, oldA = P.keepInnerRoads ? 0 : inf.innerArea;
      return `<tr><td>신설 정비기반시설<br><span class="u">준공 시 국가·지자체에 무상귀속</span></td><td class="r">${fmt(newA)}</td><td class="wrap">도로 확폭·직접 지정한 도로·공원·녹지·그 밖의 정비기반시설(학교·공공청사 제외). 사업시행자가 설치해 국가·지자체에 무상귀속(도정법 제97조②). 구역 안 새 도로는 ✂ 구역계 자르기로 그어 '도로로 지정'하세요.</td></tr>
      <tr><td>용도폐지 기존 기반시설<br><span class="u">무상양도 대상</span></td><td class="r">${fmt(oldA)}</td><td class="wrap">${oldA ? `신설 ${fmt(newA)}㎡ 대비 ${newA ? (oldA / newA * 100).toFixed(0) : '–'}%(면적 기준). 실제 양도 범위는 용도폐지 시설의 평가금액과 신설 시설 설치비용을 비교해 정함` : '없음'}</td></tr>`; })()}
  ${(inf.skipped || []).length ? `<tr><td>획지 붙이기<br><span class="u">적용 안 함</span></td><td class="r">0</td><td class="wrap">${inf.skipped.map(m => `주된 공동주택 획지 ${fmt(m.area)}㎡ 전체를 ${{ park: '공원·녹지', school: '학교용지', rel: '종교용지' }[m.kind]}에 붙인 것 <button type="button" class="btn ghost sm" data-unmerge="${m.idx}">지우기</button>`).join(' · ')} — 실수로 보여 적용하지 않았습니다. 필요하면 획지를 눌러 붙일 면적을 넣어 다시 붙이세요.</td></tr>` : ''}
  ${Object.keys(inf.merged || {}).length ? `<tr><td>획지 붙이기</td><td class="r">${fmt(Object.values(inf.merged).reduce((a2, b2) => a2 + b2, 0))}</td><td class="wrap">${inf.mergeList.map(m => `${{ park: '공원·녹지', school: '학교용지', rel: '종교용지' }[m.kind]}에 ${fmt(m.area)}㎡ <button type="button" class="btn ghost sm" data-unmerge="${m.idx}" aria-label="이 붙이기 되돌리기">✕</button>`).join(' · ')} (위 면적에 포함) <button type="button" class="btn ghost sm" id="undoMerge">모두 되돌리기</button></td></tr>` : ''}
  ${(inf.lots || []).length ? `<tr><td>공동주택 획지 ${inf.lots.length}개<br><span class="u">남는 땅</span></td><td class="r">${fmt(inf.lots.reduce((s2, l) => s2 + l.area, 0))}</td><td class="wrap">${inf.lots.map(l => `획지${l.no} ${fmt(l.area)}㎡${l.small ? '(<b class="warn">작음</b>)' : ''}`).join(' · ')}${inf.lots.some(l => l.small) ? '<br>1,000㎡ 미만 획지는 공동주택 단독 개발이 어려우니, 지도에서 그 획지를 눌러 옆 종교용지·공원·학교에 붙이거나 시설 위치를 옮기세요.' : ''}</td></tr>` : ''}
  <tr class="sum"><td><b>제안 계${inf.relArea ? '<br><span class="u">(기반시설 + 종교용지)</span>' : ''}</b></td><td class="r"><b>${fmt(inf.total)}</b></td><td>구역의 ${(inf.ratio * 100).toFixed(1)}%</td></tr></tbody></table></div>
  <div class="zk-btns" style="margin-top:8px">
    <button type="button" class="btn ghost sm" id="placePark">공원 위치 지도에서 정하기</button>
    ${inf.szSchool.A > 0 ? '<button type="button" class="btn ghost sm" id="placeSchool">학교 위치 지도에서 정하기</button>' : ''}
    <button type="button" class="btn ghost sm" id="refetchRoads">경계 도로 다시 조회</button>
  </div>
  ${FITUI.panel(a.key, inf)}
  <h4 style="margin:12px 0 4px">공원·학교·종교용지 면적 정하기</h4>
  <div class="tscroll"><table class="sz-tbl"><thead><tr><th>시설</th><th>정하는 방식</th><th>값</th><th>가로:세로</th><th title="나눔선을 끌 때 이 면적 아래로는 줄지 않음">최소㎡</th><th class="r">적용 면적㎡</th></tr></thead><tbody>
  ${[['park', '공원·녹지', inf.szPark, `자동: ${inf.legal ? '법정' : P.parkMode === 'always' ? '부지 5%' : '법정 의무만'} ${fmt(inf.parkLegal)}㎡`, inf.parkArea],
     ['school', '학교용지', inf.szSchool, num(P.schoolArea) ? `자동: 입력값 ${fmt(num(P.schoolArea))}㎡` : '자동: 없음(0)', inf.schoolArea],
     ['rel', '종교용지', inf.szRel, `자동: 교회 필지 대지 ${fmt(inf.relLand)}㎡`, inf.relArea]].map(([k, n, sz, autoTxt, cur]) => `<tr>
     <td>${n}</td>
     <td><select data-szmode="${k}" aria-label="${n} 면적 정하는 방식"><option value="auto" ${sz.mode === 'auto' ? 'selected' : ''}>자동</option><option value="area" ${sz.mode === 'area' ? 'selected' : ''}>면적 직접(㎡)</option><option value="pct" ${sz.mode === 'pct' ? 'selected' : ''}>구역 대비 %</option></select></td>
     <td>${sz.mode === 'auto' ? `<span class="u">${autoTxt}</span>` : `<input data-szval="${k}" inputmode="decimal" value="${esc(String(sz.val))}" placeholder="${sz.mode === 'pct' ? '예: 5' : '예: 2000'}" aria-label="${n} ${sz.mode === 'pct' ? '구역 대비 %' : '면적 ㎡'}" style="width:90px"> ${sz.mode === 'pct' ? '%' : '㎡'}${sz.bad ? ' <b class="warn" title="구역 대비 100% 또는 구역의 80%를 넘는 값은 쓰지 않습니다">너무 큼 → 자동값</b>' : ''}`}</td>
     <td><select data-szasp="${k}" aria-label="${n} 가로세로 비율">${[1, 1.5, 2, 3].map(r => `<option value="${r}" ${sz.asp === r ? 'selected' : ''}>1:${r}</option>`).join('')}</select></td>
     <td><input data-szmin="${k}" inputmode="decimal" value="${esc(String(((Z.zones[a.key].infra || {}).sz || {})[k] && Z.zones[a.key].infra.sz[k].min || ''))}" placeholder="${k === 'park' ? '법정 ' + fmt(inf.parkLegal) : '없음'}" aria-label="${n} 최소 면적" style="width:80px"></td>
     <td class="r">${fmt(cur)}</td></tr>`).join('')}
  </tbody></table></div>
  <p class="hint" style="margin-top:4px">최소㎡: 맞닿은 시설 사이 나눔선을 끌 때 이 면적 아래로는 줄지 않습니다(공원은 비우면 법정·제안 기준). 구역 대비 %는 구역 면적 ${fmt(a.area)}㎡ 기준입니다. 가로:세로는 경계선 방향으로 긴 쪽입니다. 들어갈 자리가 없으면 다른 비율로 바꿔 봅니다.${inf.relC ? '' : ' 종교용지는 \'대체부지로 옮기기\'일 때만 비율이 모양에 반영됩니다(존치는 필지 그대로).'}</p>
  <div class="form" style="margin-top:8px">
    ${field('sideRoadW', '경계 도로 최소 폭', P.sideRoadW, 'm · 기본 8m(소로2류 하한). 진입도로는 세대수 기준 자동', 'step=0.5')}
    ${field('greenInfra', '녹지 면적', P.greenInfra, '㎡ · 완충·경관·연결녹지 등(공원과 따로)', 'step=100')}
    ${field('otherInfra', '그 밖의 정비기반시설 면적', P.otherInfra, '㎡ · 공용주차장·공공공지·광장 등', 'step=100')}
    ${field('pubBldg', '공공청사 등 면적', P.pubBldg, '㎡ · 정비기반시설 아님(무상귀속 제외)', 'step=100')}
    ${field('valMult', '감정평가 배율(공시지가 대비)', P.valMult || 1.4, '배 · 무상양도 금액 비교용 가정값', 'step=0.05')}
    ${field('roadWork', '도로 공사비 단가', P.roadWork || 0, '원/㎡ · 0이면 공사비 빼고 비교', 'step=10000')}
    ${field('parkWork', '공원·녹지 조성비 단가', P.parkWork || 0, '원/㎡', 'step=10000')}
    <div class="field"><label for="parkMode">5만㎡ 미만일 때 공원·녹지</label><select id="parkMode"><option value="legal">법정 의무만(없으면 0)</option><option value="always">부지 5% 제안</option></select></div>
  </div>
 <label class="zk-opts"><input type="checkbox" id="autoAbsorb" ${P.autoAbsorb !== false ? 'checked' : ''}> 큰 획지와 떨어져 갇힌 1,000㎡ 미만 조각을 맞닿은 시설에 자동으로 붙이기 — 끄면 그 조각은 주황 획지로 남음(눌러서 면적을 정해 붙일 수 있음)</label>
  <label class="zk-opts"><input type="checkbox" id="keepInner" ${P.keepInnerRoads ? 'checked' : ''}> 구역 안 기존 도로를 존치(기반시설로 셈)</label>
  <p class="note">도로 폭은 연속지적도 필지 모양으로 어림한 값이라 실제 측량 폭과 다를 수 있습니다. 확폭 부분은 구역 안쪽으로만 잡았습니다. 위치·형태는 정비계획 입안 때 교통·공원 담당 부서 협의와 도시계획위원회 심의로 정합니다.</p>`;
}
function bindInfra(a) {
  side.querySelectorAll('[data-im]').forEach(b => b.onclick = () => { P.infraMode = b.dataset.im; saveP(); render(); });
  if (P.infraMode === 'drawing' && a) bindDrawing(a);
  const on = (id, fn) => { const e = document.getElementById(id); if (e) e.onclick = fn; };
  FITUI.bind(side);
  on('placePark', () => { S.placing = 'park'; $id('lmap').classList.add('picking'); toast('지도에서 공원을 둘 자리를 누르세요'); });
  on('placeSchool', () => { S.placing = 'school'; $id('lmap').classList.add('picking'); toast('지도에서 학교용지를 둘 자리를 누르세요'); });
  on('refetchRoads', () => { const z = Z.zones[S.region]; if (z) { delete z.roads; saveZ(); INFRA.memo = {}; INFRA.fetchRoads(S.region); render(); } });
  const pm = document.getElementById('parkMode'); if (pm) { pm.value = P.parkMode; pm.onchange = () => { P.parkMode = pm.value; saveP(); INFRA.memo = {}; render(); }; }
  const zi = () => { const z = Z.zones[S.region]; if (!z) return null; z.infra = z.infra || {}; return z.infra; };
  side.querySelectorAll('[data-unmerge]').forEach(b => b.onclick = () => { const z = Z.zones[S.region]; if (!z || !z.infra || !z.infra.addTo) return; z.infra.addTo.splice(+b.dataset.unmerge, 1); saveZ(); INFRA.memo = {}; render(); toast('붙인 땅 하나를 되돌렸습니다'); });
  on('unpair', () => { const z = Z.zones[S.region]; if (z) { z.infra = z.infra || {}; z.infra.noPair = true; delete z.infra.pairEdge; saveZ(); INFRA.memo = {}; render(); toast('두 시설을 따로 놓았습니다'); } });
  on('repair', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.noPair; saveZ(); INFRA.memo = {}; render(); } });
  on('resetSplit', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.pairSplit; saveZ(); INFRA.memo = {}; render(); toast('나눔선을 처음 자리로 되돌렸습니다'); } });
  on('undoMerge', () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.addTo; saveZ(); INFRA.memo = {}; render(); toast('붙인 획지를 되돌렸습니다'); } });
  side.querySelectorAll('[data-relmode]').forEach(b => b.onclick = () => {
    const inf = zi(); if (!inf) return;
    if (b.dataset.relmode === 'keep') delete inf.relC;
    else if (!inf.relC) { const r = plan(analyze(S.region)).infra; inf.relC = (r && r.relCenter) || INFRA.defaultCenter(Z.zones[S.region].geojson); }
    saveZ(); INFRA.memo = {}; render();
  });
  side.querySelectorAll('[data-rel]').forEach(cb => cb.onchange = () => { const inf = zi(); if (!inf) return; inf.relOff = inf.relOff || {}; if (cb.checked) delete inf.relOff[cb.dataset.rel]; else inf.relOff[cb.dataset.rel] = true; saveZ(); INFRA.memo = {}; render(); });
  const szSet = (k, f) => { const inf = zi(); if (!inf) return; inf.sz = inf.sz || {}; inf.sz[k] = inf.sz[k] || {}; f(inf.sz[k]); saveZ(); INFRA.memo = {}; render(); };
  side.querySelectorAll('[data-szmode]').forEach(el => el.onchange = () => szSet(el.dataset.szmode, o => { o.mode = el.value; o.val = ''; }));
  side.querySelectorAll('[data-szval]').forEach(el => el.onchange = () => szSet(el.dataset.szval, o => { o.val = num(el.value); }));
  side.querySelectorAll('[data-szmin]').forEach(el => el.onchange = () => szSet(el.dataset.szmin, o => { const v = num(el.value); if (v > 0) o.min = v; else delete o.min; }));
  side.querySelectorAll('[data-szasp]').forEach(el => el.onchange = () => szSet(el.dataset.szasp, o => { o.asp = num(el.value); }));
  const aa = document.getElementById('autoAbsorb'); if (aa) aa.onchange = () => { P.autoAbsorb = aa.checked; saveP(); INFRA.memo = {}; render(); };
  side.querySelectorAll('[data-gidec]').forEach(el => el.onchange = () => { const z = Z.zones[S.region]; if (!z) return; z.infra = z.infra || {}; z.infra.giDec = z.infra.giDec || {}; if (el.value) z.infra.giDec[el.dataset.gidec] = el.value; else delete z.infra.giDec[el.dataset.gidec]; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-gifocus]').forEach(el => { el.onmouseenter = () => { const k = el.dataset.gifocus; const put = l => { el.title = (el.textContent + MOVES.text(l)).trim(); }; put(MOVES.get(k)); if (!MOVES.get(k)) MOVES.load(k).then(l => put(l || [])); }; });
  side.querySelectorAll('[data-gifocus]').forEach(el => el.onclick = () => { const p = D.byPnu.get(el.dataset.gifocus); if (p && p.geom && LM) { LM.fitBounds(L.geoJSON(p.geom).getBounds(), { padding: [80, 80], maxZoom: 20 }); const m = L.geoJSON(p.geom, { style: { color: '#c92a2a', weight: 3, dashArray: '6 4', fillOpacity: 0.12 }, interactive: false }).addTo(LM); setTimeout(() => m.remove(), 6000); document.getElementById('lmap').scrollIntoView({ block: 'center' }); } });
  on('giAsk', () => {
    const inf = plan(analyze(S.region)).infra, z = Z.zones[S.region];
    const rows = (inf.giAll || []).filter(x => x.pub && x.grade !== '확실').map((x, i) => ({
      '연번': i + 1, '구역명': Z.title || '', '안': D.regions[S.region].name, '지번': x.p.jibun, '지목': x.p.jimok, '대장면적(㎡)': Math.round((x.p.base ?? x.p.area) * 10) / 10, '편입면적(㎡)': Math.round(x.area * 10) / 10,
      '소유구분': x.p.own || '', '관리기관 구분': x.p.ownInst || '', '토지이용상황': x.p.landUse || '', '도시계획시설 결정': x.facKind || '없음',
      '필지 위 건물': x.noBld ? '없음' : `${x.nLedger + x.nGis}동(대장 없음 ${x.nGis})`, '소유권 변동': `${x.p.chgDate || ''} ${x.p.chgCause || ''}`.trim(), '자동 판정': x.grade, '현재 판단': x.include ? '넣음' : '뺌',
      '조회 요청 사항': '① 행정재산/일반재산 구분 ② 대부(사용허가) 계약 유무·대상 ③ 현재 공공용(도로·공원 등) 사용 여부 ④ 관리 부서', '회신': '',
    }));
    if (!rows.length) { toast('조회할 필지가 없습니다(국공유 필지가 모두 \'확실\'이거나 없음)'); return; }
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [4, 16, 6, 10, 6, 10, 10, 10, 10, 12, 16, 16, 18, 10, 8, 50, 20].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '국공유지 조회요청');
    XLSX.writeFile(wb, `${(Z.title || '정비구역').replace(/[\\/:*?"<>|]+/g, '_')}_국공유지_조회요청.xlsx`);
  });
  on('giCopy', async () => { const inf = plan(analyze(S.region)).infra; const rows = (inf.giAll || []).map(x => [x.p.jibun, x.p.jimok, x.p.own || '', x.p.landUse || '', x.jm ? 'O' : '', x.lu ? 'O' : '', x.fc ? 'O' : '', x.w, x.noBld ? 'O' : '', x.grade, x.include ? '넣음' : '뺌', Math.round(x.area * 10) / 10, Math.round((x.occ || 0) * 10) / 10, Math.round(x.useA * 10) / 10].join('\t')); try { await navigator.clipboard.writeText(['지번\t지목\t소유\t토지이용상황\t공공지목\t이용상황도로등\t도시계획시설\t평균폭(m)\t건물없음\t자동판정\t판단\t편입면적(㎡)\t건물점유(㎡)\t사용중(㎡)', ...rows].join('\n')); toast('표를 복사했습니다. 엑셀에 붙여 넣으세요'); } catch (er) { toast('복사하지 못했습니다'); } });
  side.querySelectorAll('[data-entrymode]').forEach(b => b.onclick = () => { const inf = zi(); if (!inf || b.disabled) return; if (b.dataset.entrymode === 'auto') delete inf.entryMode; else inf.entryMode = b.dataset.entrymode; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-entrypick]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.entryPnu = el.dataset.entrypick; saveZ(); INFRA.memo = {}; render(); });
  on('entryAuto', () => { const inf = zi(); if (!inf) return; delete inf.entryPnu; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-edgeopt]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.edgeOpt = inf.edgeOpt || {}; const o = inf.edgeOpt[el.dataset.pnu] = inf.edgeOpt[el.dataset.pnu] || {}; if (el.checked) o[el.dataset.edgeopt] = true; else delete o[el.dataset.edgeopt]; if (!Object.keys(o).length) delete inf.edgeOpt[el.dataset.pnu]; if (el.dataset.edgeopt === 'oneway' && el.checked && inf.entryPnu === el.dataset.pnu) delete inf.entryPnu; saveZ(); INFRA.memo = {}; render(); });
  side.querySelectorAll('[data-parkto]').forEach(btn => btn.onclick = () => szSet('park', o => { o.mode = 'area'; o.val = num(btn.dataset.parkto); }));
  side.querySelectorAll('[data-trwiden]').forEach(b => b.onclick = () => {
    const t = trafficWidenInfo(); const inf = zi(); if (!t || !inf) return; inf.edgeOpt = inf.edgeOpt || {};
    let n = 0; t.rows.forEach(r => { if (!r.pnu || !(num(r.need) > 0)) return; const o = inf.edgeOpt[r.pnu] = inf.edgeOpt[r.pnu] || {}; delete o.keep; o.pw = num(r.need); n++; });
    saveZ(); INFRA.memo = {}; render(); toast(n ? `교통성 검토 결과로 경계 도로 ${n}곳의 계획 폭을 넓혔습니다` : '적용할 도로를 찾지 못했습니다', 3000);
  });
  side.querySelectorAll('[data-edgesel]').forEach(el => el.onchange = () => {
    const inf = zi(); if (!inf) return; inf.edgeOpt = inf.edgeOpt || {}; const k = el.dataset.edgesel, o = inf.edgeOpt[k] = inf.edgeOpt[k] || {};
    let v = el.value;
    if (v === 'custom') { const t = prompt('계획 폭(m)을 넣으세요', ''); if (t == null) { render(); return; } v = String(num(t)); if (!(num(v) > 0)) { render(); return; } }
    delete o.pw; delete o.keep;
    if (v === 'keep') o.keep = true; else if (v !== 'auto') o.pw = num(v);
    if (!Object.keys(o).length) delete inf.edgeOpt[k];
    saveZ(); INFRA.memo = {}; render();
  });
  side.querySelectorAll('[data-edgefocus]').forEach(el => el.onclick = () => { const z = Z.zones[S.region], r = z && z.roads && z.roads.edge.find(x => x.pnu === el.dataset.edgefocus); if (r && LM) { LM.fitBounds(L.geoJSON(r.geom).getBounds(), { padding: [80, 80], maxZoom: 19 }); const m = L.geoJSON(r.geom, { style: { color: '#1971c2', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(LM); setTimeout(() => m.remove(), 6000); } });
  side.querySelectorAll('[data-gireply]').forEach(el => el.onchange = () => { const inf = zi(); if (!inf) return; inf.giReply = inf.giReply || {}; if (el.value) inf.giReply[el.dataset.gireply] = el.value; else delete inf.giReply[el.dataset.gireply]; saveZ(); INFRA.memo = {}; render(); });
  const ki = document.getElementById('keepInner'); if (ki) ki.onchange = () => { P.keepInnerRoads = ki.checked; saveP(); INFRA.memo = {}; render(); };
}
// 평형 구성 — 평형 목록은 shared/criteria/arch.json '평면'(39·49·59·74·84·101·114㎡형), 비율은 공통 가정값(mixNN)에 저장
function mixSection() {
  const A = JbsFeas.get(), ts = unitTypes(), sum = ts.reduce((s, t) => s + num(A['mix' + t]), 0);
  const pre = Object.keys((ARCHC || {})['평형구성_예시'] || {});
  return `<h3>분양 평형 구성</h3>
  ${pre.length ? `<div class="zk-btns" style="margin-bottom:6px">${pre.map(k => `<button type="button" class="btn ghost sm" data-mixpreset="${esc(k)}">${esc(k)}</button>`).join('')}</div>` : ''}
  <div style="display:flex;flex-wrap:wrap;gap:6px 10px">${ts.map(t => `<label style="display:flex;flex-direction:column;font-size:12px">${t}㎡형 %<input data-feas="mix${t}" type="number" min="0" max="100" step="any" value="${num(A['mix' + t]) || ''}" placeholder="0" style="width:64px" aria-label="${t}㎡형 비율(%)"></label>`).join('')}</div>
  <p class="u" style="margin:2px 0 0">합계 ${fmt(sum)}%${Math.abs(sum - 100) > 0.5 ? ' — 100%가 아니면 합계에 대한 비율로 나눔' : ''}. 0이거나 빈 평형은 짓지 않는 것으로 봅니다. 임대는 위 임대 비율만큼 49㎡형으로 따로 셈.</p>`;
}
// 개략 건축계획 결과 → 공통 구역(JbsSite.applyUrbanPlan) → 교통성·환경성·높이경관 검토서(?urban=키&make=1)
function handoffReady() { const z = Z.zones[S.region]; return !!(D.map && z && z.geojson && z.roads && INFRA.ready(S.region)); }
function handoffPlan(a) {
  const pl = plan(a), z = Z.zones[S.region] || {}, e = pl.infra && pl.infra.entry;
  const role = r => e && e.e1 && r.pnu === e.e1.pnu ? '진입도로' : e && e.mode === 3 && e.e2 && r.pnu === e.e2.pnu ? '두 번째 진입도로' : '주변 도로';
  const roads = ((z.roads && z.roads.edge) || []).map(r => { const p = (e && e.per[r.pnu]) || {}; return { pnu: r.pnu, jibun: r.jibun, w: r.w, pw: p.pw || r.w, role: role(r), dec: r.dec || '', partial: !!p.partial }; });
  const retail = pl.gfa - num(pl.U.resArea);
  return Object.assign({ units: pl.units, byType: pl.byType, far: pl.farUse, bcr: P.bcr, floors: pl.floorsTower, towers: pl.towers, gfa: pl.gfa, roads }, retail > 1 ? { retailGFA: retail } : {});
}
function handoff(a, tool) {
  if (!handoffReady()) { toast('구역계와 주변 도로를 먼저 불러오세요', 2500); return; }
  if (!window.JbsSite) { toast('공통 구역 저장 기능을 불러오지 못했습니다 — 새로고침해 보세요', 2500); return; }
  saveZ();
  if (!JbsSite.applyUrbanPlan(S.region, handoffPlan(a))) { toast('검토서로 넘기지 못했습니다(구역계 저장 확인)', 2500); return; }
  location.href = `../${tool}/?urban=${encodeURIComponent(S.region)}&make=1`;
}
function handoffSection() {
  const ok = handoffReady(), dis = ok ? '' : 'disabled';
  return `<h3>검토서로 넘기기</h3>
  <div class="zk-btns"><button type="button" class="btn" data-handoff="traffic" ${dis}>교통성 검토서로 →</button><button type="button" class="btn" data-handoff="env" ${dis}>환경성 검토서로 →</button><button type="button" class="btn" data-handoff="landscape" ${dis}>높이·경관계획으로 →</button></div>
  <p class="hint">${ok ? '지금 정비계획·개략 건축계획 값(세대수·평형·용적률·층수·도로 계획 폭)이 검토서로 넘어갑니다. 동 배치·일조·3D까지 보려면 /arch(자세한 배치)에서 확정하세요.' : '구역계와 주변 도로를 먼저 불러오세요(지도에서 그린 안, 정비계획 탭에서 주변 도로 확인 후).'}</p>`;
}
function renderArch(a) {
  const pl = plan(a);
  // 출입구가 이 탭의 첫 할 일(정비계획 순서 1) — 맨 위에. 그 아래 개략 규모·평형·배치
  side.innerHTML = `<h2>${regName()} 출입구·개략 배치</h2>
  ${D.map ? gateSection(a, pl) : ''}
  <h3 style="margin-top:18px">개략 건축계획</h3>
  <p style="margin:0 0 8px"><a class="btn" style="display:inline-block;text-decoration:none" data-tool="arch" href="${toolHref('arch')}">자세한 배치·일조·3D와 교통성 검토서로 → (/arch)</a></p>
  <p class="hint">여기 개략 배치는 규모 확인용입니다. 배치 확정과 교통성·환경성·경관 검토서는 /arch에서 이 안(${esc(S.region)}안)을 불러와 이어 합니다.</p>
  ${(() => { const inf = pl.infra; if (P.infraMode === 'manual') return `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">3탭에서 <b>비율 직접 입력(${fmt(P.infraRatio)}%)</b>을 골라 그 비율로 계산 중입니다 — 지도에 그린 공원 모양은 쓰지 않습니다. 그린 모양을 쓰려면 3탭에서 '제안값 사용'을 고르세요. 획지 ${fmt(pl.site)}㎡</p>`;
    if (!inf) return '';
    const park = num(inf.parkArea);
    return `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">3탭에서 정한 정비기반시설 반영: 구역 ${fmt(a.area)}㎡ − 기반시설 ${fmt(a.area * inf.ratio)}㎡(${(inf.ratio * 100).toFixed(1)}%${park ? `, 공원·녹지 ${fmt(park)}㎡` : ''}) = <b>획지 ${fmt(pl.site)}㎡</b></p>`; })()}
  <div class="form">
    ${field('bcr', '건폐율(계획)', P.bcr, '% · 예시 가정')}
    ${field('coreUnits', '주동 1개 층 세대수', P.coreUnits, '세대/층')}
    ${feasField('rentRatio', '% of 세대수 · 임대는 49㎡형(공급 67㎡)')}
  </div>
  ${mixSection()}
  <p class="note">세대수 = 용적률 연면적 × 주거 ${JbsFeas.get().resRatio}% ÷ 세대당 평균 공급면적(표준 평면: ${Object.keys(pl.U.supply).map(t => `${t}㎡형 ${fmt(pl.U.supply[t])}㎡`).join(' · ')} · 임대 49㎡형 ${JbsFeas.supply(49)}㎡, 개략). 평형·임대 비율은 사업성 검토 첫 화면과 같은 값을 씁니다.</p>
  <div class="form">
  </div>
  <h3>개략 규모</h3>
  <div class="kpis">
    ${kpi('총 세대수', fmt(pl.units) + '세대', `연면적 ${fmt(pl.gfa)}㎡ ÷ 세대당 ${pl.perUnit.toFixed(1)}㎡`)}
    ${kpi('주동', pl.towers + '개동', `동당 ${pl.floorsTower}층 · 높이 약 ${(pl.floorsTower * 2.9).toFixed(0)}m${pl.rects && pl.towersCalc !== pl.towers ? ` · 지도 배치 기준(땅 모양 때문에 ${pl.towersCalc}개동 ${pl.floorsCalc}층 대신)` : pl.rects ? ' · 지도 배치와 같음' : ''}`)}
    ${kpi('건축면적 한도', fmt(pl.footMax) + '㎡', `획지 × ${P.bcr}%`)}
    ${kpi('지하 연면적(주차 등)', fmt(pl.basement) + '㎡', `지상 대비 ${P.basementRatio}%`)}
  </div>
  <h3>세대 구성</h3>
  <div class="tscroll"><table><thead><tr><th>구분</th><th class="r">세대</th></tr></thead><tbody>
    ${Object.keys(pl.U.sale).filter(t => pl.U.sale[t] > 0).map(t => `<tr><td>${t}㎡형 분양</td><td class="r">${fmt(pl.U.sale[t])}</td></tr>`).join('')}
    <tr><td>조합원 분양(토지등소유자 추정 ${fmt(a.owners)}명)</td><td class="r">${fmt(pl.members)}</td></tr>
    <tr><td>일반분양</td><td class="r">${fmt(pl.general)}</td></tr>
    <tr><td>임대주택</td><td class="r">${fmt(pl.rental)}</td></tr>
  </tbody></table></div>
  <p class="note">도면의 <b>개략 배치</b>는 주동을 ${S.placedIn === 'lots' ? '정비기반시설(도로·공원·학교·종교용지 등)을 뺀 <b>공동주택 획지</b>' : '구역계'} 안에 격자로 놓아 봅니다(인동간격 높이×0.8 개략, 배치된 주동 ${S.placed ?? '–'}개동${S.placed != null && S.placedNeed && S.placed < S.placedNeed ? ` — 땅 모양 때문에 계산상 ${S.placedNeed}개동(${S.placedFloorsCalc}층)이 다 들어가지 않아 ${S.placed}개동 × ${S.placedFloors}층으로 세대수를 맞췄습니다. 오른쪽 개략 규모도 이 값입니다` : ''}). 일조·높이·학교예정부지·문화재 위치는 /arch 단계에서 다룹니다.</p>
  ${S.archLay && S.archLay.n ? `<p class="note" style="background:#f7f9fb;border:1px solid var(--line);border-radius:6px;padding:8px 10px">지도 개략 배치(실제 평면·정북 일조·인동간격 0.8·기반시설 이격 반영, 판상 ${S.archLay.angle}°): <b>${S.archLay.n}개동 · ${fmt(S.archLay.units)}세대 · 최고 ${S.archLay.maxF}층</b> · 용적률 ${S.archLay.far.toFixed(1)}% · 건폐율 ${S.archLay.bcr.toFixed(1)}%. 위 세대수(개략 계산)와 다를 수 있으며, 형태 비교·확정은 /arch에서 합니다.</p>` : S.archLay && S.archLay.busy ? '<p class="note">지도 개략 배치를 실제 평면으로 계산하는 중입니다… (큰 구역은 1분 안팎)</p>' : S.archLay && S.archLay.fail ? '<p class="note">실제 평면 배치를 시간 안에 끝내지 못해 지도는 간단한 네모 배치로 보여 줍니다. 자세한 배치는 6 건축계획 수립(/arch)에서 하세요.</p>' : ''}
  ${handoffSection()}`;
  bindNum(['bcr', 'coreUnits', 'parkCount']);
  side.querySelectorAll('[data-mixpreset]').forEach(b => b.onclick = () => { const pr = ((ARCHC || {})['평형구성_예시'] || {})[b.dataset.mixpreset] || {}, patch = {}; unitTypes().forEach(t => { patch['mix' + t] = num(pr[t]); }); JbsFeas.set(patch); render(); });
  side.querySelectorAll('[data-handoff]').forEach(b => b.onclick = () => handoff(a, b.dataset.handoff));
  side.querySelectorAll('[data-feas]').forEach(e => e.addEventListener('change', () => { const v = parseFloat(e.value); JbsFeas.set({ [e.dataset.feas]: isNaN(v) ? 0 : v }); render(); }));
  side.querySelectorAll('[data-gate]').forEach(b => b.onclick = () => {
    S.placing = 'gate:' + b.dataset.gate; $id('lmap').classList.add('picking');
    side.querySelectorAll('[data-gate]').forEach(x => { x.classList.remove('on'); x.style.cssText = ''; });
    b.classList.add('on'); b.style.cssText = 'background:#c92a2a;color:#fff;border-color:#c92a2a';
    b.textContent = `지도에서 구역 경계를 누르세요 — ${GATE.KIND[b.dataset.gate]}`;
    toast(`지도에서 ${GATE.KIND[b.dataset.gate]}를 둘 구역 경계를 누르세요(도로에 닿은 경계)`, 4000);
  });
  const gc = document.getElementById('gateClear'); if (gc) gc.onclick = () => { const z = Z.zones[S.region]; if (z && z.infra) { delete z.infra.gates; saveZ(); render(); } };
}
// 단지 출입구 검토(배치 탭) — 위치는 '가정', 교통영향평가·경찰 협의 뒤 확정
function gateSection(a, pl) {
  const ck = GATE.check(a, pl), cls = { ok: 'ok', ng: 'bad', warn: 'warn', info: '' }, lab = { ok: '맞음', ng: '안 맞음', warn: '확인', info: '참고' };
  const zz = Z.zones[a.key] || {}, gl = GATE.list(zz);
  const sumHtml = gl.length ? `<div style="background:#f3faf3;border:1px solid #b7dcb9;border-radius:6px;padding:8px 10px;margin:6px 0">${gl.map(g => { const r = GATE.roadAt(zz, g.pt); return `<div>✔ <b>${GATE.KIND[g.kind]}</b> ${r ? `— ${esc(r.jibun)} 도로(현황 약 ${r.w}m)에 닿음${g.kind === 'main' ? ' → <b>진입도로로 정함</b>' : ''}` : '— <span class="warn">도로에 닿지 않은 경계</span>'}</div>`; }).join('')}</div>` : '<p class="note" style="margin:6px 0">아직 정한 출입구가 없습니다. 아래 [주출입구 찍기]부터 누르세요.</p>';
  return `<h3 id="gateBox">단지 출입구 (가정 — 교통 검토 후 확정)</h3>
  ${sumHtml}
  <p class="hint">주출입구·부출입구·주차장 출입구를 지도에서 구역 경계에 찍으면 기준을 검사합니다. 점을 누르면 지워집니다. <b>주출입구를 찍으면 그 자리에 닿은 경계 도로가 진입도로로 정해져</b> 3탭 진입도로 확폭(주택건설기준 제25조)과 교통성 검토가 그 도로 기준으로 바뀝니다. '법정'은 공동주택(부설주차장)에 바로 적용되는 조항, '참고'는 노외주차장 기준·협의 관행입니다.</p>
  ${ck.gates.some(g => g.kind === 'main') ? '<p style="margin:4px 0"><button type="button" class="btn sm" style="background:var(--ink);color:var(--paper);border-color:var(--ink)" data-stepgo="plan">출입구 정함 → 다음: 3 정비기반시설(도로 확폭·공원)</button></p>' : ''}
  <div class="zk-btns"><button type="button" class="btn ghost sm" data-gate="main">주출입구 찍기</button><button type="button" class="btn ghost sm" data-gate="sub">부출입구 찍기</button><button type="button" class="btn ghost sm" data-gate="park">주차장 출입구 찍기</button>${ck.gates.length ? '<button type="button" class="btn ghost sm" id="gateClear">모두 지우기</button>' : ''}</div>
  <div class="form" style="margin-top:6px">${field('parkCount', '주차대수(계획)', P.parkCount || '', `대 · 0이면 ${legalPark(pl) ? `법정 하한 ${fmt(legalPark(pl).legal)}대` : `세대당 1대(${fmt(pl.units)}대)`}로 가정`)}</div>
  <div class="tscroll"><table class="gi-tbl"><thead><tr><th>항목</th><th>판정</th><th>내용</th><th>근거</th></tr></thead><tbody>
  ${ck.rows.map(r => `<tr><td>${r.item}</td><td><span class="pill ${cls[r.st]}">${lab[r.st]}</span></td><td class="wrap">${r.text}</td><td class="wrap u">${r.law ? '<b>법정</b> ' : '참고 '}${r.basis}</td></tr>`).join('')}
  </tbody></table></div>`;
}
function renderBiz(a) {
  const pl = plan(a), b = biz(a, pl), rp = b.ratio * 100;
  const tone = rp >= 100 ? 'ok' : rp >= 80 ? 'warn' : 'bad';
  const A = b.A, ff = (k, unit, attrs = 'step="any"') => `<div class="field"><label for="feas_${k}">${JbsFeas.LABEL[k]}</label><input id="feas_${k}" data-feas="${k}" type="number" value="${A[k] || ''}" ${attrs}><span class="u">${unit}</span></div>`;
  const priorFields = (D.real && a.priorLand > 0)
    ? `<div class="field"><label>종전 토지 평가</label><span class="u">조서 공시지가 합 ${won(a.priorLand)} × 배율</span></div>${ff('priorMul', '배 (감정평가 추정)', 'step="0.05"')}`
    : `${ff('avgLand', `만원/㎡ — 비우면 예시 ${P.landPrice}만원/㎡`)}${ff('priorMul', '배 (감정평가 추정)', 'step="0.05"')}`;
  side.innerHTML = `<h2>${regName()} 개략 사업성</h2>
  <div class="flow">
    <div class="kpi"><div class="l">추정 비례율</div><div class="big" style="color:var(--${tone})">${rp.toFixed(1)}%</div><div class="f">(총수입 − 총사업비) ÷ 종전자산</div></div>
    <div class="kpi"><div class="l">조합원 평균 분담금 (84㎡형)</div><div class="big">${won(b.contrib)}</div><div class="f">84㎡형 조합원분양가 ${won(b.price84)} − 평균 권리가액 ${won(b.right)}</div></div>
  </div>
  <h3>가정값 <span class="badge a">가정값 — 사업성 검토 첫 화면(★빠른 사업성)과 같은 값을 씁니다</span></h3>
  <div class="form">
    ${priorFields}
    ${ff('generalPrice', '만원/평(공급)')}
    ${ff('memberRatio', `% → 조합원분양가 ${fmt(b.m.memberPrice)}만원/평`)}
    ${ff('buildCost', '만원/㎡ — 2026.9.15. 고시 232.8', 'step="0.1"')}
    ${ff('rentBuildPct', `% → 임대 건축물 ${fmt(b.A.rentPrice)}만원/평 + 부속토지 감정가`)}
    ${ff('conPrice', '만원/평(계획연면적)')}
    ${ff('gfaFactor', '배 — 지하주차장·공용 포함', 'step="0.01"')}
    ${ff('etcPct', '% of 공사비 (설계·감리·이주·금융·보상 등)')}
  </div>
  <h3>수입·지출 집계</h3>
  <div class="tscroll"><table class="ledger"><tbody>
    <tr><td>조합원 분양 ${fmt(b.m.memTotal)}세대 (평형별 공급면적 × 조합원분양가)</td><td class="r">${won(b.incMember)}</td></tr>
    <tr><td>일반 분양 ${fmt(b.m.types.reduce((n, t) => n + b.m.sale[t] - b.m.mem[t], 0))}세대</td><td class="r">${won(b.incGeneral)}</td></tr>
    <tr><td>임대주택 인수 ${fmt(pl.rental)}세대 (건축물 기본형건축비 ${b.A.rentBuildPct}% + 부속토지 감정가)</td><td class="r">${won(b.incRental)}</td></tr>
    <tr class="sum"><td>총수입</td><td class="r">${won(b.income)}</td></tr>
    <tr><td>공사비 (계획연면적 ${fmt(b.planGfa)}㎡ = 지상 ${fmt(pl.gfa)}㎡ × ${b.A.gfaFactor})</td><td class="r">${won(b.cost)}</td></tr>
    <tr><td>기타 사업비</td><td class="r">${won(b.etc)}</td></tr>
    <tr class="sum"><td>총사업비</td><td class="r">${won(b.expense)}</td></tr>
    <tr><td>종전자산 총액 (토지 ${b.useJiga ? '공시지가 합 × ' + b.A.priorMul : fmt(a.landArea) + '㎡ × ' + b.landUnit + '만원/㎡ × ' + b.A.priorMul})</td><td class="r">${won(b.prior)}</td></tr>
    <tr class="sum"><td>개발이익 (총수입 − 총사업비)</td><td class="r">${won(b.income - b.expense)}</td></tr>
  </tbody></table></div>
  <p class="note">조합원 1인당 평균 종전자산 ${won(b.avgPrior)} × 비례율 ${rp.toFixed(1)}% = 평균 권리가액 ${won(b.right)}. 임대는 작은 평형부터, 조합원은 분양 세대 비율대로 나눴습니다. 건물 평가액·상가 수입·국공유지 처리·세입자 손실보상 세부는 넣지 않은 개략 산정입니다(첫 화면 ★빠른 사업성과 같은 계산). 세부 사업성은 사업성 검토 화면의 5~7단계에서 다룹니다.</p>`;
  side.querySelectorAll('[data-feas]').forEach(e => e.addEventListener('change', () => { const v = parseFloat(e.value); JbsFeas.set({ [e.dataset.feas]: isNaN(v) ? 0 : v }); render(); }));
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
  opts() { return { fillHoles: $id('zkFill').checked, bridge: $id('zkBridge').checked, edgeRoad: $id('zkEdge').value, threshold: num($id('zkTh').value) || 0.5 }; },
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
  // 제출 토지조서 폐합 검토: 조서 지번만 그대로 합쳐(자동 채우기 없음) 구역계로 두고, 떨어진 덩어리·빠진 필지·틈을 알려 줌
  async closure() {
    if (!this.ready()) return;
    if (!ZoneKit.items(this.list()).length) { this.say('토지조서 지번을 넣거나 "엑셀·CSV에서 지번 읽기"로 조서 파일을 고르세요.'); return; }
    if (!this.base()) { this.say('기준 동 주소를 넣어 주세요. 예: 인천광역시 미추홀구 용현동'); $id('zkBase').focus(); return; }
    const id = S.region, R = D.regions[id];
    if (R.geojson && !confirm(`${R.name} 구역계를 제출 조서의 필지 경계로 바꿔 검토할까요?`)) return;
    this.working = true;
    try {
      delete this.rough[id];
      const { found, report, count } = await ZoneKit.findByJibuns(this.list(), this.base(), t => this.say(t));
      const r = await ZoneKit.closure(found, t => this.say(t));
      if (!r) { this.say('조서 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'); this.showReport(report); return; }
      this.showReport(report);
      if (this.closeLayer) this.closeLayer.remove();
      setZoneGeom(id, r.merged, 0, `제출 조서 ${count}필지로 구역계`);
      fitZone(id);
      this.closeLayer = ZoneUI.closureLayer(LM, r);
      $id('zkMsg').innerHTML = ZoneKit.closureHtml(r, report);
      statusMsg(`${id}안: 제출 조서 폐합 검토 ${r.ok ? '이상 없음' : '— 확인할 곳이 있습니다(아래 목록·지도 빨강/주황/보라)'}`, !r.ok);
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
  // 파일 → 지번 목록 → 바로 구역 만들기 (읽기 규칙은 js/zonekit.js, 사업성 검토 화면과 같음)
  async readFile(f) {
    this.say(`${f.name} 읽는 중…`);
    let r;
    try { r = await ZoneKit.readJibunFile(f); }
    catch (e) { this.say(`${f.name}을(를) 읽지 못했습니다: ${e.message}`); return; }
    if (!r.list.length) { this.say(`${f.name}${r.sheet ? ` (${r.sheet} 시트)` : ''}에서 지번을 찾지 못했습니다. '지번' 제목이 있는 열이나 지번만 있는 열을 넣어 주세요.`); return; }
    $id('zkList').value = r.list.join('\n');
    const full = ZoneKit.fullBase(r.base, this.base(), '');
    const head = `${f.name}${r.sheet ? ` · ${r.sheet} 시트` : ''} ${r.how}에서 지번 ${r.list.length}개를 읽었습니다${r.skipped ? ` (지번 꼴이 아닌 칸 ${r.skipped}개 제외)` : ''}.`;
    if (!full) {
      if (!this.base() && r.base) $id('zkBase').value = r.base;
      this.say(head + ` 기준 동 주소를 시·구까지 넣고(예: 인천광역시 미추홀구 ${r.base || '용현동'}) 지번으로 구역 만들기를 누르세요. 같은 동 이름이 다른 시에도 있을 수 있어서입니다.`);
      $id('zkBase').focus(); return;
    }
    $id('zkBase').value = full;
    this.say(head + ' 구역계를 만드는 중…');
    await this.fromJibuns();
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
// 사이트 길잡이(shared/sitenav.js) 2단 '정비계획 순서'에 지금 탭 표시(4탭 = 1 주출입구 설정, 3탭 = 2 정비기반시설 지정)
const navMark = () => { try { if (window.JbsNav) JbsNav.mark(S.tab); } catch (e) { /* 무시 */ } };
setTimeout(navMark, 50);
document.querySelectorAll('nav.steps button').forEach(b => b.addEventListener('click', () => setTimeout(navMark, 0)));
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
$id('zkCloseBtn').onclick = () => ZK.closure();
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
$id('geoFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  if (/\.dxf$/i.test(f.name)) {   // CAD 구역도 — js/zonekit.js ZoneKit.readDxf (사업성 검토와 같은 코드)
    statusMsg(`${f.name} 읽는 중…`);
    const c = LM ? LM.getCenter() : null;
    let r; try { r = await ZoneKit.readDxf(await f.arrayBuffer(), c ? [c.lat, c.lng] : null); } catch (er) { statusMsg(`${f.name}을(를) 읽지 못했습니다: ${er.message}`, true); return; }
    if (r.error) { statusMsg(r.error, true); return; }
    importGeoJSONText(JSON.stringify(r.fc));
    statusMsg(ZoneKit.dxfNote(r, f.name));
    return;
  }
  const r = new FileReader(); r.onload = () => importGeoJSONText(String(r.result)); r.readAsText(f);
};
// 참고 도면 겹쳐 보기 — js/overlay.js(사업성 검토와 같은 코드)를 이 화면 지도(LM)에 연결
if (typeof RefOverlay !== 'undefined') {
  RefOverlay.host = {
    map: () => LM,
    ensure: () => { if (S.source !== 'map') setSource('map'); initLeaflet(); },
    picking: () => !!ZK.picking,
    stopPicking: () => { ZK.picking = false; },
    ids: { msg: 'zkRefMsg', also: 'zkMsg', align: 'zkRefAlign', toggle: 'zkRefToggle', remove: 'zkRefRemove', opacity: 'zkRefOpacity' },
  };
  $id('zkRefLoad').onclick = () => RefOverlay.load();
  $id('zkRefAlign').onclick = () => RefOverlay.startAlign();
  $id('zkRefToggle').onclick = () => RefOverlay.toggle();
  $id('zkRefRemove').onclick = () => RefOverlay.remove();
  $id('zkRefOpacity').oninput = e => RefOverlay.setOpacity(+e.target.value);
}
$id('geoOutBtn').onclick = () => {
  const R = D.regions[S.region];
  if (!R.geojson) { toast('내보낼 구역계가 없습니다'); return; }
  const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features: [{ ...R.geojson, properties: { name: (Z.title ? Z.title + ' ' : '') + R.name } }] }, null, 1)], { type: 'application/geo+json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `구역계_${Z.title ? Z.title.replace(/[\\/:*?"<>|\s]+/g, '_') + '_' : ''}${R.name}.geojson`; document.body.append(a); a.click(); a.remove();
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

// 교통·환경 검토서 기준표(숫자는 shared/criteria에서만) — 요건판정 탭의 '관련 평가 대상(개략)'에 씀
const CRIT = {};
['traffic', 'environment'].forEach(k => fetch(`../shared/criteria/${k}.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { CRIT[k] = {}; (j.items || []).forEach(it => { CRIT[k][it.id] = it; }); if (S.tab === 'req' || S.tab === 'arch') render(); } }).catch(() => {}));
// 평형 목록·평형 구성 예시(개략 건축계획 탭) — shared/criteria/arch.json의 '평면'(숫자 키)·'평형구성_예시'. /arch와 같은 표
let ARCHC = null;
fetch('../shared/criteria/arch.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) { ARCHC = j; if (S.tab === 'arch') render(); } }).catch(() => {});
const unitTypes = () => { const ks = ARCHC && ARCHC['평면'] ? Object.keys(ARCHC['평면']).filter(k => /^\d+$/.test(k)) : Object.keys(JbsFeas.mixOf(JbsFeas.get())); return ks.map(Number).sort((x, y) => x - y); };
// 법정 주차 하한(주택) — 숫자는 shared/criteria/traffic.json parking_housing에서만. pl.byType(임대 포함 평형별 세대)로 계산
function legalPark(pl) {
  const it = CRIT.traffic && CRIT.traffic.parking_housing; if (!it || !pl || !pl.byType) return null;
  let u = 0, u60 = 0, a85 = 0, a85u = 0;
  Object.entries(pl.byType).forEach(([t, c]) => { const ex = num(t), k = num(c); u += k; if (ex <= 60) u60 += k; if (ex <= 85) a85 += k * ex; else a85u += k * ex; });
  const ord = it.조례 && +it.조례.세대당_최저 || 0, per60 = Math.max(it.세대당_최저.전용60이하, ord), per = Math.max(it.세대당_최저.일반, ord);
  const minByUnits = Math.ceil(u60 * per60 + Math.max(0, u - u60) * per - 1e-9), byArea = Math.ceil(a85 / it.비율['85이하'] + a85u / it.비율['85초과'] - 1e-9);
  return { legal: Math.max(minByUnits, byArea), minByUnits, byArea, u60, per60, per, basis: it.근거 || '' };
}
fetch('rules/incheon.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) applyJson(j); }).catch(() => {}).finally(async () => {
  loadData();
  const first = D.map && D.keys.find(k => D.regions[k].geojson);
  if (first) { S.region = first; syncRegionChips(); renderSourceBar(); fitZone(first); }
  render();
  // 사업성 검토 '1차 재검토' → ?from=main: 사업성 검토 구역계·조서를 빈 안(없으면 새 안)으로 가져와 정비계획(기반시설) 탭을 엶
  const qs = new URLSearchParams(location.search);
  // ?tab=plan|arch|… 로 그 탭을 바로 열고, ?focus=gate면 단지 출입구 칸으로 내려감(사업성 화면 순서 버튼에서 씀)
  if (qs.get('tab') && qs.get('from') !== 'main') {
    const tb = qs.get('tab'), fc = qs.get('focus');
    history.replaceState(null, '', location.pathname + location.hash);
    setTimeout(() => { const b = document.querySelector(`nav.steps button[data-tab="${tb}"]`); if (b) b.click(); if (fc === 'gate') setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); }, 300);
  }
  if (qs.get('from') === 'main') {
    history.replaceState(null, '', location.pathname + location.hash);
    const pj = loadProject();
    if (!pj || !pj.area || !pj.area.geojson) { alert('사업성 검토 화면(2단계 구역계)에 저장된 구역이 없습니다.\n사업성 검토 화면 2단계에서 구역을 만든 뒤(구역이 지도에 파랗게 보이는 상태) ★빠른 사업성의 ① 버튼을 다시 눌러 주세요.\n지금 보이는 안은 예전 구역입니다.'); return; }
    if (S.source !== 'map') setSource('map');
    const pg = pj.area.geojson;
    // A~E는 '한 사업'의 여러 안 — 지금 구역과 조금도 겹치지 않는 안은 다른 사업이므로 자동 백업 후 비움(묻지 않음)
    if (pg && window.turf) {
      const touch = g => { try { const x = turf.intersect(g, pg); return !!x && turf.area(x) > 1; } catch (e) { return false; } };
      const filled = ZONE_IDS.filter(k => Z.zones[k] && Z.zones[k].geojson);
      const mine = filled.filter(k => touch(Z.zones[k].geojson)), other = filled.filter(k => !mine.includes(k));
      if (other.length) {
        if (window.JbsWork) { try { await JbsWork.backup(`정비계획 다른 사업(${Z.title || other.join('·') + '안'}) 비우기 전 자동 백업`); } catch (e) { /* 백업 실패해도 진행 */ } }
        const keep = mine.map(k => Z.zones[k]); Z.zones = {};
        keep.forEach((z, i) => { Z.zones[ZONE_IDS[i]] = z; });
        Object.keys(HIST).forEach(k => delete HIST[k]);
        Z.count = Math.max(1, keep.length);
        if (!keep.length) Z.title = '';
        saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); S.region = D.keys[0];
        syncRegionChips(); renderSourceBar();
        toast(`다른 사업 구역(${other.length}개 안)은 자동 백업한 뒤 비웠습니다. [작업 저장·불러오기]에서 되돌릴 수 있습니다`);
      }
      const nm = pj.meta && pj.meta.name && pj.meta.name !== '새 정비사업' ? pj.meta.name : '';
      if (nm && !Z.title) { Z.title = nm; saveZ(); syncTitle(); }
    }
    // 같은 사업 안 중 지금 구역과 90% 이상 겹치는 안이 있으면 그 안의 구역계·조서를 지금 것으로 바꿈(기반시설 설정은 유지)
    const same = pg && window.turf ? D.keys.find(k => { const g = D.regions[k].geojson; if (!g) return false; try { const x = turf.intersect(g, pg); return x && turf.area(x) / Math.max(turf.area(g), turf.area(pg)) >= 0.9; } catch (e) { return false; } }) : null;
    let id = same || D.keys.find(k => !D.regions[k].geojson);
    if (!id && D.keys.length < ZONE_IDS.length) { Z.count = D.keys.length + 1; saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); id = D.keys[D.keys.length - 1]; }
    if (!id) {
      const pick = S.region || D.keys[0];
      if (!confirm(`정비계획 안(A~E)이 모두 차 있습니다. 지금 보고 있는 ${pick}안을 사업성 검토 구역으로 바꿀까요?\n바꾸기 전 ${pick}안은 홈페이지에 자동 저장되어 오른쪽 아래 [작업 저장·불러오기]에서 언제든 되돌릴 수 있습니다.`)) return;
      if (window.JbsWork) await JbsWork.backup(pick + '안 바꾸기 전 자동 백업');
      id = pick;
    }
    importProject(id).then(() => { const b = document.querySelector('nav.steps button[data-tab="arch"]'); if (b) b.click(); setTimeout(() => { const g = document.getElementById('gateBox'); if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 400); toast(`${id}안으로 사업성 검토 구역을 가져왔습니다. 먼저 주출입구를 찍어 진입도로를 정한 뒤 3탭에서 도로 확폭·공원을 정하세요`, 6000); });
  }
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

/* ===== 도구 막대 설명 줄(지도 위): 아이콘과 이름을 늘 보여 주고, 버튼에 마우스를 올리면 자세한 설명 ===== */
(() => {
  const box = document.getElementById('toolHelp'), bar = document.getElementById('mapTools');
  if (!box || !bar) return;
  const btns = [...bar.querySelectorAll('button.mt')];
  const build = () => {
    const parts = [];
    bar.querySelectorAll('button.mt, .mt-sep').forEach(el => {
      if (el.classList.contains('mt-sep')) { parts.push('<span class="sep" aria-hidden="true">|</span>'); return; }
      const name = el.getAttribute('aria-label') || '';
      parts.push(`<button type="button" data-for="${el.id}" ${el.disabled ? 'disabled' : ''} class="${el.classList.contains('on') ? 'hot' : ''}"><span class="k" aria-hidden="true">${el.textContent}</span>${esc(name)}</button>`);
    });
    box.innerHTML = parts.join('') + '<span class="tip idle" id="toolTip"></span>';
    show(null);
    box.querySelectorAll('[data-for]').forEach(b => {
      const t = document.getElementById(b.dataset.for);
      b.onclick = () => t.click();
      b.onmouseenter = b.onfocus = () => show(t);
      b.onmouseleave = b.onblur = () => show(null);
    });
  };
  // 설명 칸 높이는 늘 같게(누르는 도중 화면이 밀려 클릭이 빗나가지 않게)
  const show = t => { const tip = document.getElementById('toolTip'); if (!tip) return; tip.textContent = t ? (t.dataset.tip || '') : '버튼이나 이름에 마우스를 올리면 자세한 설명이 여기에 나옵니다'; tip.classList.toggle('idle', !t); };
  btns.forEach(t => { t.addEventListener('mouseenter', () => show(t)); t.addEventListener('focus', () => show(t)); t.addEventListener('mouseleave', () => show(null)); t.addEventListener('blur', () => show(null)); });
  // 버튼 상태(켜짐·꺼짐·이름)가 바뀌면 설명 줄도 다시 그림
  new MutationObserver(build).observe(bar, { subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'aria-label'] });
  build();
  const syncHidden = () => { box.hidden = bar.hidden; };
  new MutationObserver(syncHidden).observe(bar, { attributes: true, attributeFilter: ['hidden'] });
  syncHidden();
})();

syncTitle();
