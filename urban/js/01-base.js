// /urban 정비계획 화면 코드 1/12 — 기준값(RULES·incheon.json 적용), 공통 도우미, 주택접도율(도로접면), 공공 데이터 조회(브이월드·건축물대장)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
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
    // 준주거(순수 공동주택) — 2030 기본계획 변경 고시 제2026-96호 원문 대조값(2026-11-06 계획 용도지역에 추가, 용현동 유원아파트 시험)
    if (bz['준주거지역_순수공동주택']) RULES.far['준주거지역'] = bz['준주거지역_순수공동주택'];
    if (bz['역세권_준주거지역_순수공동주택']) RULES.far['준주거지역(역세권)'] = bz['역세권_준주거지역_순수공동주택'];
    if (bz['준공업지역_공동주택']) RULES.far['준공업지역'] = bz['준공업지역_공동주택'];   // 사례값 300%(인천 첫 준공업 재건축) — 단계 미확인
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

