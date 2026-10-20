'use strict';

const STORAGE_KEY = 'jbsc.project.v1';

const TYPES = {
  redevelopment: { label: '재개발', law: '도시 및 주거환경정비법' },
  reconstruction: { label: '재건축', law: '도시 및 주거환경정비법' },
  garo: { label: '가로주택정비사업', law: '빈집 및 소규모주택 정비에 관한 특례법' },
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
    rcYears: 30, otherYears: 20, detachedOther: true, basementRes20: true, smallLot: 90,
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
    smallLot: 90,          // 과소필지 기준 면적(㎡ 미만). 서울 90㎡, 인천은 건축조례 분할제한면적(주거지역 90㎡)
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
    version: 2,
    // zoningManual/locationManual: 사용자가 직접 고친 값이면 자동 입력으로 덮어쓰지 않음
    meta: { name: '새 정비사업', type: 'redevelopment', location: '', zoning: '', memo: '', zoningList: [], zoningManual: false, locationManual: false },
    // importedKey: 조서(필지·건축물)를 마지막으로 불러온 구역의 지문(zoneKey), importedAt: 그 시각
    //  지금 구역의 지문과 다르면 3단계에 들어갈 때 다시 불러옴
    area: { geojson: null, drawnArea: 0, manualArea: 0, mode: 'drawn', center: [37.5665, 126.978], zoom: 16, importedKey: '', importedAt: '' },
    // 연면적 = (구역면적 − 정비기반시설) × 용적률 × 연면적 배율
    // infraMode: 'auto' 토지조서 지목(도로·공원 등) 합계 | 'ratio' 구역면적의 infraRatio% | 'area' infraArea㎡ 직접 입력
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
  };
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
  if ((s.version || 1) < 2) {
    if (s.criteria.garo.oldRatio === 66.7) s.criteria.garo.oldRatio = 60;
    s.version = 2;
  }
  // 예전 파일: 기반시설 값이 없거나 이상하면 기본값 (mergeDefaults가 빈 키는 채움)
  if (!['auto', 'ratio', 'area'].includes(s.plan.infraMode)) s.plan.infraMode = 'auto';
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

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ }
}

let S = loadState();

// ---------- 예시 데이터 (가상의 재개발 구역) ----------
function sampleState() {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];

  const s = defaultState();
  s.meta = { ...s.meta, name: '○○1구역 주택재개발 (예시)', type: 'redevelopment', location: '서울특별시 ○○구 ○○동 일대 (가상)', zoning: '제2종일반주거지역', memo: '예시 데이터입니다. 실제 사업지와 무관합니다.', zoningManual: true, locationManual: true };

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
