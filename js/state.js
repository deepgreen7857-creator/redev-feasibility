'use strict';

const STORAGE_KEY = 'jbsc.project.v1';

// act: 근거법 구분 — 'urban' 도시정비법(정비구역 지정·기초조사) / 'small' 빈집법(소규모주택정비, 정비구역 지정 없음)
//   서식(조례 시행규칙 별지)과 내려받는 서류가 근거법마다 다름
const TYPES = {
  redevelopment: { label: '재개발', law: '도시 및 주거환경정비법', act: 'urban' },
  reconstruction: { label: '재건축', law: '도시 및 주거환경정비법', act: 'urban' },
  garo: { label: '가로주택정비사업', law: '빈집 및 소규모주택 정비에 관한 특례법', act: 'small' },
};

const SALE_CATS = ['조합원', '일반', '임대', '상가'];
const COST_GROUPS = ['공사비', '용역비', '조사·측량비', '보상비', '관리비', '제세공과금·부담금', '금융비용', '예비비'];
const BASIS = [
  { value: 'fixed', label: '금액 (만원)' },
  { value: 'perGFA', label: '평당 단가 (만원/평) × 계획연면적' },
  { value: 'pctConstruction', label: '공사비 대비 (%)' },
  { value: 'pctRevenue', label: '총수입 대비 (%)' },
  { value: 'pctSubtotal', label: '기타 사업비 합계 대비 (%)' },
];
const SAMPLE_NAME = '○○1구역 주택재개발 (예시)';   // 예시 데이터 사업명 (loadState보다 먼저 선언)
const JIMOK = ['대', '전', '답', '도', '임야', '잡', '공', '구', '기타'];
const BLDG_USES = ['단독주택', '다가구주택', '다세대주택', '연립주택', '아파트', '근린생활시설', '기타'];
const STRUCTURES = ['철근콘크리트', '철골', '조적', '목조', '기타'];
const ZONINGS = ['제1종전용주거지역', '제2종전용주거지역', '제1종일반주거지역', '제2종일반주거지역', '제3종일반주거지역', '준주거지역', '일반상업지역', '준공업지역', '기타'];

// 용도지역별 용적률 (참고용). seoul: 서울특별시 도시계획 조례, max: 국토계획법 시행령 상한
const FAR_BY_ZONING = {
  '제1종전용주거지역': { seoul: 100, max: 100 },
  '제2종전용주거지역': { seoul: 120, max: 150 },
  '제1종일반주거지역': { seoul: 150, max: 200 },
  '제2종일반주거지역': { seoul: 200, max: 250 },
  '제3종일반주거지역': { seoul: 250, max: 300 },
  '준주거지역': { seoul: 400, max: 500 },
  '일반상업지역': { seoul: 800, max: 1300 },
  '준공업지역': { seoul: 400, max: 400 },
};

// 지역별 조례 기준 (재개발 선택 요건은 이 중 하나 이상 충족)
// road: 주택접도율 % 이하, small: 과소필지 비율 % 이상, density: 호수밀도(동/1만㎡) 이상, oldArea: 노후 연면적 % 이상
const REGION_PRESETS = {
  seoul: {
    label: '서울특별시', law: '서울시 도시및주거환경정비조례 제4조·제6조',
    rcYears: 30, otherYears: 20, detachedOther: true, basementRes20: false, smallLot: 90,
    redev: { oldRatio: 60, minArea: 10000, opt: { road: 40, small: 40, density: 60, oldArea: 60 } },
  },
  incheon: {
    label: '인천광역시', law: '인천시 도시및주거환경정비조례(제7686호, 2025.12.31.) 제2조·제3조·제5조',
    rcYears: 30, otherYears: 20, detachedOther: true, basementRes20: true, smallLot: 60,   // 건축조례 제28조① 주거지역 60㎡ (2024.3.28. 개정, 종전 90㎡)
    redev: { oldRatio: 60, minArea: 10000, opt: { road: 50, small: 30, density: 50, oldArea: 50 } },
  },
};

// 판정 기준값 (2026-10 기준 조사). 법령·조례에 따라 달라지므로 화면에서 편집 가능하게 둠.
function defaultCriteria() {
  return {
    region: 'seoul',       // 적용 중인 지역 기준 (주소가 인천이면 자동으로 인천)
    regionManual: false,   // 사용자가 직접 고른 경우 자동 전환하지 않음
    baseDate: '',          // 노후도 판단 기준일 (비우면 오늘). 정비계획 입안 기준일 등
    rcYears: 30,           // 도시정비법 시행령 제2조제3항(20~30년 범위 조례 위임), 서울·인천 조례: 철근콘크리트 등 30년
    otherYears: 20,        // 그 밖의 구조 20년
    detachedOther: true,   // 조례: 단독주택은 구조와 관계없이 20년 (철근콘크리트 30년 항목에서 제외)
    basementRes20: false,  // 인천 조례: 주거용 지하층이 있는 철근콘크리트 공동주택은 30년 항목에서 제외(20년)
    smallLot: 90,          // 과소필지 기준 면적(㎡ 미만). 서울 90㎡, 인천은 건축조례 분할제한면적(주거지역 60㎡, 2024.3.28. 개정)
    ghostIn: false,        // 공부 정보가 하나도 없는 GIS 건물(무허가·부속건물 등 확인 필요)을 노후도 동수에 넣을지 (BldgRows.isGhost)
    redev: { oldRatio: 60, minArea: 10000, opt: { road: 40, small: 40, density: 60, oldArea: 60 } },
    recon: { minYears: 30, minUnits: 300, minArea: 10000 }, // 시행령 별표1 제3호
    garo: { maxArea: 10000, oldRatio: 60, minDetached: 10, minApartment: 20, minMixed: 20 }, // 소규모주택정비법 시행령 제3조(2024.3.19. 2/3→60%)
  };
}

// 지역 기준을 적용 (기준일 등 지역과 무관한 값은 유지)
function applyRegion(c, region) {
  const p = REGION_PRESETS[region];
  if (!p) return;
  c.region = region;
  ['rcYears', 'otherYears', 'detachedOther', 'basementRes20', 'smallLot'].forEach(k => { c[k] = p[k]; });
  c.redev = JSON.parse(JSON.stringify(p.redev));
}

function cost(group, name, basis, value) {
  return { id: uid(), group, name, basis, value };
}

function defaultCosts() {
  return [
    cost('공사비', '신축 공사비 (지상+지하)', 'perGFA', 0),
    cost('공사비', '철거 공사비', 'fixed', 0),
    cost('용역비', '설계비', 'pctConstruction', 0),
    cost('용역비', '감리비', 'pctConstruction', 0),
    cost('용역비', '정비사업전문관리 용역비', 'fixed', 0),
    cost('조사·측량비', '감정평가·측량·지반조사', 'fixed', 0),
    cost('보상비', '현금청산·손실보상·주거이전비', 'fixed', 0),
    cost('관리비', '조합 운영비', 'fixed', 0),
    cost('제세공과금·부담금', '보존등기비·취득세 등', 'pctConstruction', 0),
    cost('제세공과금·부담금', '학교용지·기반시설 부담금', 'fixed', 0),
    cost('금융비용', '사업비 대여금 이자', 'pctConstruction', 0),
    cost('금융비용', '이주비 이자 (조합 부담분)', 'fixed', 0),
    cost('예비비', '예비비', 'pctSubtotal', 0),
  ];
}

function sale(cat, name, units, area, price) {
  return { id: uid(), cat, name, units, area, price };
}

function defaultSales() {
  return [
    sale('조합원', '59㎡', 0, 0, 0),
    sale('조합원', '84㎡', 0, 0, 0),
    sale('일반', '59㎡', 0, 0, 0),
    sale('일반', '84㎡', 0, 0, 0),
    sale('임대', '45㎡', 0, 0, 0),
    sale('상가', '근린생활시설', 0, 0, 0),
  ];
}

function defaultState() {
  return {
    version: 4,
    // zoningManual/locationManual: 사용자가 직접 고친 값이면 자동 입력으로 덮어쓰지 않음
    meta: { name: '새 정비사업', type: 'redevelopment', location: '', zoning: '', memo: '', zoningList: [], zoningManual: false, locationManual: false },
    // importedKey: 조서(필지·건축물)를 마지막으로 불러온 구역의 지문(zoneKey), importedAt: 그 시각
    //  지금 구역의 지문과 다르면 3단계에 들어갈 때 다시 불러옴
    // siteGeo: 마지막으로 있던 구역(구역을 지워도 남김) — 새 구역이 이것과 겹치지 않으면 다른 사업으로 보고 설정을 처음으로(resetSiteSettings)
    area: { geojson: null, drawnArea: 0, manualArea: 0, mode: 'ledger', center: [37.5665, 126.978], zoom: 16, importedKey: '', importedAt: '', showParcels: false, siteGeo: null },
    // mode: 'ledger' 토지대장 면적 합계(조서 편입면적, 조서가 없으면 그린 면적) | 'drawn' 연속지적 도형 면적(참고) | 'manual' 직접 입력
    // 연면적 = (구역면적 − 정비기반시설) × 용적률 × 연면적 배율
    // infraMode: 'auto' 토지조서 지목(도로·공원 등) 합계 | 'ratio' 구역면적의 infraRatio% | 'area' infraArea㎡ 직접 입력 | 'urban' /urban 정비계획 계획값(비율로 적용)
    plan: { far: 250, gfaFactor: 1.45, gfaManual: 0, infraMode: 'auto', infraRatio: 20, infraArea: 0 },
    lands: [],
    buildings: [],
    criteria: defaultCriteria(),
    checks: { safety: false, garoBlock: false },
    sales: defaultSales(),
    costs: defaultCosts(),
    prior: { mode: 'estimate', manual: 0, multiplier: 1.4 },
    members: [],
    exposUnits: [],   // 건축물대장 전유부 호별 목록 (엑셀 조서 시트용)
    sens: { range: 20, step: 10 },
    assume: null,     // 사업성 가정값 대화창에 마지막으로 넣은 값
    quick: null,      // 빠른 사업성 화면 입력값(처음 열 때 기본값으로 채움)
  };
}

// 위치가 바뀌면(다른 사업) 구역에 딸린 설정을 모두 기본값으로(2026-11-13, 작업기준서 오류기록 1번 — 학익장미로 구역을 바꿨는데 유원아파트 때 고른 준주거가 남아 있었음)
//  남기는 것: 사업명(공통 사업명 원본이 따로 있음), 새 구역계, 지도 위치·확대, 민감도 표 폭.
//  사업성 공통 가정값(jbs-feas-assume-v1 — 분양가·공사비·평형 비율 등 사람마다의 기본값)은 '새 작업'과 같이 건드리지 않음
function resetSiteSettings(s) {
  const d = defaultState();
  const keep = { name: s.meta.name, area: s.area, sens: s.sens };
  Object.keys(d).forEach(k => { if (k !== 'version') s[k] = d[k]; });
  s.meta.name = keep.name; s.sens = keep.sens;
  s.area = Object.assign(d.area, { geojson: keep.area.geojson, drawnArea: keep.area.drawnArea, center: keep.area.center, zoom: keep.area.zoom, siteGeo: keep.area.siteGeo, showParcels: keep.area.showParcels });
  return s;
}

// 저장된 데이터에 빠진 키가 있으면 기본값으로 채움 (버전이 바뀌어도 열리도록)
function mergeDefaults(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = {};
    const v = val && typeof val === 'object' ? val : {};
    for (const k of Object.keys(def)) out[k] = def[k] === null ? (v[k] ?? null) : mergeDefaults(def[k], v[k]);
    return out;
  }
  return val === undefined ? def : val;
}

// 예전 기본값으로 저장된 기준을 현행 기준으로 바꿈
function migrate(s) {
  // v4: 인천 과소필지 기준 90㎡ → 60㎡ (인천 건축조례 제28조① 2024.3.28. 개정)
  if ((s.version || 1) < 4) {
    if (s.criteria && s.criteria.region === 'incheon' && num(s.criteria.smallLot) === 90) s.criteria.smallLot = 60;
  }
  if ((s.version || 1) < 2) {
    if (s.criteria.garo.oldRatio === 66.7) s.criteria.garo.oldRatio = 60;
    s.version = 2;
  }
  // v3: 구역 면적 기본을 토지대장 합계로 (예전 기본값 '지도에서 그린 면적'·'토지조서 합계'는 ledger로)
  if (s.version < 3) {
    if (s.area.mode === 'drawn' || s.area.mode === 'lands') s.area.mode = 'ledger';
    s.version = 3;
  }
  if (s.version < 4) s.version = 4;
  if (s.area.mode === 'lands') s.area.mode = 'ledger';
  if (!s.area.siteGeo && s.area.geojson) s.area.siteGeo = s.area.geojson;   // 위치 변경 기준(2026-11-13)
  // 예전 지도 필지: 면적이 연속지적 도형 면적이었음 → 참고값으로 옮기고 '토지대장 면적 다시 조회' 대상으로
  s.lands.forEach(l => {
    if (!l.pnu || !l.geom || l.cadArea != null || l.ledgerArea != null) return;
    if (l.partial) { l.cadArea = num(l.wholeArea) || null; l.inRatio = l.cadArea ? Math.min(1, num(l.area) / l.cadArea) : null; if (l.cadArea == null) l.cadArea = num(l.area); }
    else { l.cadArea = num(l.area); l.inRatio = 1; }
    l.areaSrc = '연속지적';
  });
  // 표시가 없던 예전 예시 데이터
  if (s.meta.name === SAMPLE_NAME) {
    s.lands.forEach(l => { if (!l.pnu) l.sample = true; });
    s.buildings.forEach(b => { if (!b.auto) b.sample = true; });
  }
  // 예전 파일: 기반시설 값이 없거나 이상하면 기본값 (mergeDefaults가 빈 키는 채움)
  if (!['auto', 'ratio', 'area', 'urban'].includes(s.plan.infraMode)) s.plan.infraMode = 'auto';
  if (!(num(s.plan.infraRatio) >= 0)) s.plan.infraRatio = 20;
  if (!(num(s.plan.infraArea) >= 0)) s.plan.infraArea = 0;
  return s;
}

// 구역 지문이 없던 예전 파일: 들어 있는 조서를 지금 구역 기준으로 보고, 3단계 자동 불러오기가 끼어들지 않게 함
function adoptZoneKey(raw, s) {
  const had = raw && raw.area && typeof raw.area.importedKey === 'string';
  if (!had && s.area.geojson) s.area.importedKey = zoneKey(s.area.geojson);
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { const v = JSON.parse(raw); return adoptZoneKey(v, migrate(mergeDefaults(defaultState(), v))); }
  } catch (e) { /* 저장소를 쓸 수 없으면 새로 시작 */ }
  return defaultState();
}

// 같은 브라우저의 다른 창(탭)이 작업을 바꾸면, 이 창의 옛 내용으로 덮어쓰지 않게 저장을 멈추고 새로 불러오게 함
let __otherTabChanged = false;
function saveState() {
  if (__otherTabChanged) return;
  const body = JSON.stringify(S);
  try { localStorage.setItem(STORAGE_KEY, body); if (typeof window !== 'undefined' && window.JbsProject) { window.JbsProject.offer(S.meta && S.meta.name, 'main'); if (S.area && S.area.geojson && window.JbsProject.offerZone && !/예시/.test(S.meta.memo || '')) window.JbsProject.offerZone(S.area.geojson, 'main'); } }
  catch (e) {
    // 저장 공간이 차면 다시 받을 수 있는 캐시(정비계획 조회 캐시)를 비우고 한 번 더 — 예전엔 조용히 실패해 구역이 저장되지 않았음
    try { localStorage.removeItem('jbs-urban-cache-v1'); localStorage.setItem(STORAGE_KEY, body); }
    catch (e2) { try { window.dispatchEvent(new Event('jbs-storage-full')); } catch (e3) { /* 무시 */ } alert('브라우저 저장 공간이 꽉 차서 작업이 저장되지 않았습니다. 오른쪽 아래 [작업 저장·불러오기]에서 홈페이지에 저장하거나 파일로 내려받은 뒤 오래된 작업을 정리하세요.'); }
  }
}
if (typeof window !== 'undefined') window.addEventListener('storage', e => {
  if (e.key !== STORAGE_KEY || e.newValue === null) return;
  __otherTabChanged = true;
  if (document.hidden) { location.reload(); return; }
  if (document.getElementById('otherTabBar')) return;
  const bar = document.createElement('div'); bar.id = 'otherTabBar';
  bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#c8322b;color:#fff;padding:10px 16px;font:14px "Noto Sans KR",sans-serif;text-align:center';
  bar.innerHTML = '다른 창에서 이 작업이 바뀌었습니다. 이 창은 예전 내용이라 저장을 멈췄습니다. <button style="margin-left:8px;padding:4px 10px" onclick="location.reload()">최신 내용으로 다시 열기</button>';
  document.body.appendChild(bar);
});
document.addEventListener && document.addEventListener('visibilitychange', () => { if (__otherTabChanged && !document.hidden && !document.getElementById('otherTabBar')) location.reload(); });

let S = loadState();

// ---------- 예시 데이터 (가상의 재개발 구역) ----------
function sampleState() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const s = defaultState();
  s.meta = { ...s.meta, name: SAMPLE_NAME, type: 'redevelopment', location: '서울특별시 ○○구 ○○동 일대 (가상)', zoning: '제2종일반주거지역', memo: '예시 데이터입니다. 실제 사업지와 무관합니다.', zoningManual: true, locationManual: true };

  // 약 2만㎡ 크기의 가상 구역계
  const c = [37.5893, 127.0305];
  s.area.center = c;
  s.area.zoom = 17;
  s.area.mode = 'drawn';
  s.area.geojson = {
    type: 'Feature', properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [c[1] - 0.00080, c[0] - 0.00062], [c[1] + 0.00078, c[0] - 0.00068], [c[1] + 0.00088, c[0] + 0.00030],
        [c[1] + 0.00020, c[0] + 0.00070], [c[1] - 0.00085, c[0] + 0.00058], [c[1] - 0.00080, c[0] - 0.00062],
      ]],
    },
  };
  s.area.drawnArea = window.turf ? turf.area(s.area.geojson) : 19800;
  s.area.importedKey = zoneKey(s.area.geojson);   // 예시 조서는 이 구역 기준 (3단계 자동 불러오기 안 함)

  for (let i = 0; i < 64; i++) {
    const bon = 100 + i;
    const jimok = i % 11 === 0 ? '도' : '대';
    const area = jimok === '도' ? 120 + Math.round(rnd() * 200) : 60 + Math.round(rnd() * 420);
    s.lands.push({
      id: uid(), jibun: `${bon}`, jimok, area,
      ownerType: jimok === '도' ? '국공유지' : '사유지',
      owner: jimok === '도' ? '○○구' : `소유자${i + 1}`,
      price: Math.round((5200000 + rnd() * 2600000) / 10000) * 10000,
      sample: true,
    });
  }

  const uses = ['단독주택', '단독주택', '단독주택', '다가구주택', '다세대주택', '근린생활시설'];
  for (let i = 0; i < 58; i++) {
    const use = pick(uses);
    const structure = use === '다세대주택' ? '철근콘크리트' : pick(['조적', '조적', '철근콘크리트', '목조']);
    const year = use === '다세대주택' ? 1990 + Math.floor(rnd() * 30) : 1968 + Math.floor(rnd() * 45);
    s.buildings.push({
      id: uid(), jibun: `${100 + Math.floor(rnd() * 64)}`, use, structure, year,
      floorArea: Math.round(80 + rnd() * (use === '다세대주택' ? 600 : 260)),
      units: use === '다세대주택' ? 6 + Math.floor(rnd() * 10) : use === '다가구주택' ? 1 : use === '근린생활시설' ? 0 : 1,
      sample: true,
    });
  }

  s.plan = { ...s.plan, far: 250, gfaFactor: 1.45, gfaManual: 0 };
  s.sales = [
    sale('조합원', '59㎡', 80, 82, 3200),
    sale('조합원', '84㎡', 150, 112, 3200),
    sale('일반', '59㎡', 60, 82, 4200),
    sale('일반', '84㎡', 90, 112, 4200),
    sale('임대', '45㎡', 70, 62, 1000),
    sale('상가', '근린생활시설', 1, 2500, 3500),
  ];
  const v = { 0: 750, 1: 300000, 2: 3, 3: 2.5, 4: 250000, 5: 100000, 6: 3000000, 7: 400000, 8: 2, 9: 200000, 10: 5, 11: 1500000, 12: 3 };
  s.costs = defaultCosts().map((it, i) => ({ ...it, value: v[i] }));
  s.prior = { mode: 'estimate', manual: 0, multiplier: 1.6 };
  s.members = [
    { id: uid(), name: '조합원 A', prior: 45000, want: '59㎡' },
    { id: uid(), name: '조합원 B', prior: 68000, want: '84㎡' },
    { id: uid(), name: '조합원 C', prior: 92000, want: '84㎡' },
    { id: uid(), name: '조합원 D', prior: 31000, want: '59㎡' },
    { id: uid(), name: '조합원 E', prior: 120000, want: '84㎡' },
  ];
  return s;
}
