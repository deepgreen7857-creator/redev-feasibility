'use strict';
// jbslab.co.kr/urban — 정비구역 지정·정비계획 검토
// 데이터: 같은 도메인의 사업성 검토(본 화면) 프로젝트(localStorage 'jbsc.project.v1')의 구역계·토지조서·건축물조서를 그대로 읽음.
//         프로젝트가 없거나 '예시 구역 보기'를 고르면 시드 고정 예시 구역으로 동작.
// 기준값: rules/incheon.json (인천 조례 원문 대조본). 읽기 실패 시 아래 FALLBACK 사용.

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
//  세로(가)는 '폭 8m 미만·자동차 통행 가능'이라 4m 미만일 수 있음 → 판정 칸·도면 필지를 눌러 직접 지정 가능
const ROAD_CACHE = 'jbs-urban-road', ACC_OVR = 'jbs-urban-access';
const lsGet = k => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (e) { return {}; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 무시 */ } };
const roadCache = lsGet(ROAD_CACHE), accOvr = lsGet(ACC_OVR);
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
    const nm = p.roadSide || roadCache[p.pnu] || '';
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
function jsonp(url, params, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const cb = '__vwu' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = data => { cleanup(); resolve(data); };
    s.src = url + '?' + new URLSearchParams({ ...params, callback: cb });
    s.onerror = () => { cleanup(); reject(new Error('load')); };
    document.head.append(s);
  });
}
async function vwRoadSide(pnu) {
  const yr = new Date().getFullYear();
  for (const y of [yr, yr - 1]) {
    const d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu, key: VWORLD_KEY.trim(), domain: location.origin, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(y) });
    const f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0];
    if (f) return f.roadSideCodeNm || '';
  }
  return '';
}
const roadTargets = () => D.parcels.filter(p => p.pnu && !p.roadSide && roadCache[p.pnu] === undefined && p.blds.length);
let roadBusy = false;
async function fetchRoads(btn) {
  if (roadBusy) return;
  if (typeof VWORLD_KEY !== 'string' || !VWORLD_KEY.trim()) { toast('브이월드 인증키가 없습니다'); return; }
  if (!/jbslab\.co\.kr$/.test(location.hostname)) toast('브이월드 키는 www.jbslab.co.kr에서만 조회됩니다');
  const list = roadTargets(); if (!list.length) { toast('조회할 필지가 없습니다'); return; }
  roadBusy = true; let done = 0, fail = 0;
  const work = async () => {
    while (list.length) {
      const p = list.shift();
      try { roadCache[p.pnu] = await vwRoadSide(p.pnu); } catch (e) { fail++; }
      done++; if (btn) btn.textContent = `조회 중 ${done}/${done + list.length}`;
      if (done % 20 === 0) lsSet(ROAD_CACHE, roadCache);
    }
  };
  await Promise.all([work(), work(), work(), work()]);
  lsSet(ROAD_CACHE, roadCache);
  roadBusy = false;
  D.parcels.forEach(applyAccess);
  renderSourceBar(loadProject());
  render();
  toast(fail ? `도로접면 조회 완료 · 실패 ${fail}필지(다시 누르면 재시도)` : '도로접면 조회 완료');
}

/* ===== 건축물 판정 ===== */
function kindOf(use) {
  if (['아파트', '연립주택', '다세대주택'].includes(use)) return '공동';
  if (['단독주택', '다가구주택'].includes(use)) return '단독';
  return '비주거';
}
function obsoleteRule(b) {
  if (b.lic === '기존무허가') return { old: true, why: '기존무허가(1989.1.24. 이전)' };
  if (!b.year) return { old: false, why: '사용승인 연도 없음 — 대장 확인 필요', unknown: true };
  let yrs, why;
  if (b.kind === '공동') {
    if (b.rc && !b.semi) { yrs = RULES.obsolete.rcApt; why = 'RC 공동주택 ' + yrs + '년'; }
    else { yrs = RULES.obsolete.otherApt; why = b.semi ? '주거용 지하층 공동주택 ' + yrs + '년' : '비RC 공동주택 ' + yrs + '년'; }
    if (b.rc && !b.semi && b.basement > 0) why += ' (지하층 있음: 주거용이면 ' + RULES.obsolete.otherApt + '년)';
  } else if (b.rc && b.kind !== '단독') { yrs = RULES.obsolete.rcNonApt; why = 'RC 건축물 ' + yrs + '년'; }
  else { yrs = RULES.obsolete.other; why = b.kind === '단독' && b.rc ? 'RC 단독주택 ' + yrs + '년(30년 제외)' : '비RC ' + yrs + '년'; }
  const age = YEAR - b.year;
  return { old: age >= yrs, why: why + ' · 경과 ' + age + '년' };
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

/* ===== 데이터: 사업성 검토 프로젝트(실제 구역) ===== */
function loadProject() {
  try { const raw = localStorage.getItem(PROJECT_KEY); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function projectUsable(p) {
  return p && p.area && p.area.geojson && Array.isArray(p.lands) && p.lands.some(l => l.geom && !l.sample);
}
function outerRings(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map(c => c[0]);
  return [];
}
function buildReal(p) {
  const zoneG = p.area.geojson.geometry || p.area.geojson;
  const zRings = outerRings(zoneG);
  const all = zRings.flat();
  const lon0 = all.reduce((s, c) => s + c[0], 0) / all.length, lat0 = all.reduce((s, c) => s + c[1], 0) / all.length;
  const kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  const proj = c => [(c[0] - lon0) * kx, -(c[1] - lat0) * ky];
  const lands = p.lands.filter(l => l.geom && !l.sample);
  let pr = lands.map(l => outerRings(l.geom).map(r => r.map(proj)));
  let zr = zRings.map(r => r.map(proj));
  const pts = [...zr.flat(), ...pr.flat(2)];
  const minX = Math.min(...pts.map(q => q[0])) - 10, minY = Math.min(...pts.map(q => q[1])) - 10;
  const shift = r => r.map(([x, y]) => [x - minX, y - minY]);
  zr = zr.map(shift); pr = pr.map(rs => rs.map(shift));
  const W = Math.max(...pts.map(q => q[0])) - minX + 10, H = Math.max(...pts.map(q => q[1])) - minY + 10;
  const parcels = lands.map((l, i) => {
    const rings = pr[i];
    const big = rings.slice().sort((a, b) => polyArea(b) - polyArea(a))[0] || [[0, 0]];
    const [cx, cy] = centroid(big);
    return {
      id: i, rings, area: Number(l.area) || polyArea(big), cx, cy, zone: l.zoning || p.meta?.zoning || '', jibun: (l.addr ? '' : '') + l.jibun, jimok: l.jimok,
      price: Number(l.price) || 0, owner: l.owner || '', public: l.ownerType === '국공유지', pnu: l.pnu || '', roadSide: l.roadSide || '',
      access: null, accessStr: '도로 폭 정보 없음', blds: [],
    };
  });
  const byPnu = new Map(parcels.filter(q => q.pnu).map(q => [q.pnu, q])), byJibun = new Map(parcels.map(q => [String(q.jibun), q]));
  const buildings = [], orphans = [];
  (p.buildings || []).filter(b => !b.sample).forEach((b, i) => {
    const kind = kindOf(b.use);
    const floors = Number(b.floors) || 1, units = Number(b.units) || 0;
    const nb = {
      id: i, use: b.use, kind, struct: b.structureName || b.structure || '', rc: ['철근콘크리트', '철골'].includes(b.structure),
      year: Number(b.year) || 0, semi: false, basement: Number(b.basement) || 0, unitsMax: kind === '공동' ? Math.max(1, Math.ceil(units / floors)) : 0, units,
      floors, converted: false, foot: Number(b.archArea) || (Number(b.floorArea) || 0) / floors, floor: Number(b.floorArea) || 0, lic: '허가', name: b.name || '',
    };
    const par = (b.pnu && byPnu.get(b.pnu)) || byJibun.get(String(b.jibun));
    if (par) { nb.pid = par.id; par.blds.push(nb); } else { nb.pid = null; orphans.push(nb); }
    buildings.push(nb);
  });
  return {
    real: true, title: p.meta?.name || '사업성 검토 구역', W, H, roads: [], parcels, buildings, orphans,
    zoneArea: Number(p.area.drawnArea) || zr.reduce((s, r) => s + polyArea(r), 0),
    priorMult: Number(p.prior?.multiplier) || 1.4,
    regions: {
      A: { name: '프로젝트 구역계', pts: zr.slice().sort((a, b) => polyArea(b) - polyArea(a))[0], rings: zr, project: true },
      B: { name: 'B안', pts: null },
      C: { name: '직접 그린 안', pts: null },
    },
  };
}

/* ===== 분석·판정 ===== */
let D = null;
function regionParcels(key) {
  const reg = D.regions[key];
  if (reg.project) return D.parcels;   // 프로젝트 구역계: 토지조서 전부(이미 편입 필지)
  return D.parcels.filter(p => inside(p.cx, p.cy, reg.pts));
}
function analyze(key) {
  const reg = D.regions[key]; if (!reg || !reg.pts) return null;
  const area = reg.project ? (reg.rings.reduce((s, r) => s + polyArea(r), 0)) : polyArea(reg.pts);
  const ps = regionParcels(key);
  let bs = ps.flatMap(p => p.blds);
  if (reg.project) bs = bs.concat(D.orphans);
  bs = bs.filter(b => b.lic !== '신발생무허가');
  bs.forEach(b => { if (b.old === undefined) Object.assign(b, obsoleteRule(b)); });
  const N = bs.length, oldN = bs.filter(b => b.old).length, unknownN = bs.filter(b => b.unknown).length;
  const fa = bs.reduce((s, b) => s + b.floor, 0), oldFa = bs.filter(b => b.old).reduce((s, b) => s + b.floor, 0);
  const smallN = ps.filter(p => p.area < smallLimit(p.zone)).length;
  let accN = 0, accU = 0;
  bs.forEach(b => { const a = b.pid != null ? D.parcels[b.pid].access : null; if (a === true) accN++; else if (a == null) accU++; });
  const du = bs.reduce((s, b) => s + densityUnits(b), 0);
  const landArea = ps.reduce((s, p) => s + p.area, 0);
  const zoneArea = {}; ps.forEach(p => { const z = p.zone || '미확인'; zoneArea[z] = (zoneArea[z] || 0) + p.area; });
  let owners = 0;
  const names = new Set();
  ps.forEach(p => {
    const apt = p.blds.filter(b => b.kind === '공동' && !b.converted);
    if (apt.length) owners += apt.reduce((s, b) => s + Math.max(1, b.units), 0);
    else if (!p.public) { if (p.owner) { if (!names.has(p.owner)) { names.add(p.owner); owners++; } } else owners++; }
  });
  const priorLand = ps.reduce((s, p) => s + p.area * p.price, 0);
  return {
    key, area, ps, bs, N, oldN, unknownN, fa, oldFa, smallN, accN, accU, du, landArea, zoneArea, owners: Math.max(owners, 1), priorLand,
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
function judge(a, type) {
  const out = [];
  const st = (ok) => ok == null ? 'unk' : ok ? 'ok' : 'bad';
  if (type === 'redev') {
    const r = RULES.redevelopment;
    out.push({ req: true, t: '구역 면적 ' + fmt(r.minArea) + '㎡ 이상', basis: '정비조례 제5조①2', v: fmt(a.area) + '㎡', st: st(a.area >= r.minArea), s: a.area >= r.minArea ? '' : `${fmt(r.minArea - a.area)}㎡ 부족` });
    const need = Math.ceil(r.obsoleteCount * a.N - a.oldN), okO = a.oldRatio >= r.obsoleteCount;
    out.push({ req: true, t: '노후·불량건축물 수 ' + r.obsoleteCount * 100 + '% 이상', basis: '정비조례 제5조①2, 영 별표1 제2호', v: pct(a.oldRatio) + ` (${a.oldN}/${a.N}동)`, st: st(okO), s: (okO ? `기준보다 ${Math.floor(a.oldN - r.obsoleteCount * a.N)}동 여유` : `기준 대비 ${need}동 부족`) + (a.unknownN ? ` · 연도 미확인 ${a.unknownN}동` : '') });
    const opts = [
      { t: '주택접도율 ' + r.road * 100 + '% 이하', ...accJudge(a, r.road), basis: '제5조①2가, 제2조7호' },
      { t: '과소필지 ' + r.small * 100 + '% 이상', v: pct(a.smallRatio) + ` (${a.smallN}/${a.ps.length}필지)`, st: st(a.smallRatio >= r.small), s: a.smallRatio >= r.small ? '충족' : `${((r.small - a.smallRatio) * 100).toFixed(1)}%p 모자람`, basis: '제5조①2나, 제2조5호(분할제한면적 미만)' },
      { t: '호수밀도 ' + r.density + ' 이상', v: a.density.toFixed(1) + '동/ha', st: st(a.density >= r.density), s: a.density >= r.density ? '충족' : `${(r.density - a.density).toFixed(1)}동/ha 모자람`, basis: '제5조①2다, 제2조6호' },
      { t: '노후 연면적 ' + r.obsoleteFloor * 100 + '% 이상', v: pct(a.oldFaRatio), st: st(a.oldFaRatio >= r.obsoleteFloor), s: a.oldFaRatio >= r.obsoleteFloor ? '충족' : `${((r.obsoleteFloor - a.oldFaRatio) * 100).toFixed(1)}%p 모자람`, basis: '제5조①2라' },
    ];
    out.push({ group: true, t: '다음 중 하나 이상', items: opts, st: opts.some(o => o.st === 'ok') ? 'ok' : opts.some(o => o.st === 'unk') ? 'unk' : 'bad' });
  } else {
    const r = RULES.improvement;
    const okO = a.oldRatio >= r.obsoleteCount;
    out.push({ req: true, t: '노후·불량건축물 수 ' + r.obsoleteCount * 100 + '% 이상', basis: '정비조례 제5조①1', v: pct(a.oldRatio), st: st(okO), s: okO ? '충족' : `기준 대비 ${Math.ceil(r.obsoleteCount * a.N - a.oldN)}동 부족` });
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
  constCost: 700, basementRatio: 55, etcRatio: 20, priorMode: 'jiga', priorMult: 1.4,
};
try { const s = localStorage.getItem('jbs-urban-plan'); if (s) Object.assign(P, JSON.parse(s)); } catch (e) { /* 무시 */ }
const saveP = () => { try { localStorage.setItem('jbs-urban-plan', JSON.stringify(P)); } catch (e) { /* 무시 */ } };

function plan(a) {
  const site = a.area * (1 - P.infraRatio / 100);
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
    site, far, farUse, gfa, avgEx, perUnit, units, footMax, towerFoot, floorsTower, towers, rental, members, general, basement,
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

/* ===== 화면 상태 ===== */
const S = { tab: 'zone', region: 'A', mode: 'old', drawing: false, draft: [], source: 'auto', placed: null };
const NS = 'http://www.w3.org/2000/svg';
const svg = document.getElementById('map');
function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); (parent || svg).appendChild(e); return e; }
const ringStr = r => r.map(p => p.map(v => v.toFixed(2)).join(',')).join(' ');
function cKey() { return 'jbs-urban-C-' + (D.real ? 'real' : 'sample'); }

function loadData() {
  const proj = loadProject();
  const useReal = S.source === 'real' || (S.source === 'auto' && projectUsable(proj));
  D = useReal && projectUsable(proj) ? buildReal(proj) : buildSample();
  try { const s = localStorage.getItem(cKey()); if (s) D.regions.C.pts = JSON.parse(s); } catch (e) { /* 무시 */ }
  D.parcels.forEach(applyAccess);
  const pad = Math.max(D.W, D.H) * 0.015;
  svg.setAttribute('viewBox', `${-pad} ${-pad} ${D.W + pad * 2} ${D.H + pad * 2}`);
  if (!D.regions[S.region] || !D.regions[S.region].pts && S.region !== 'C') S.region = 'A';
  renderSourceBar(proj);
}
function renderSourceBar(proj) {
  const bar = document.getElementById('source');
  const has = projectUsable(proj);
  document.getElementById('demoTag').textContent = D.real ? '실제 구역 · 사업성 검토 프로젝트에서 불러옴' : '예시 구역 데이터 · 실제 지번 아님';
  document.getElementById('demoTag').className = D.real ? 'demo real' : 'demo';
  bar.innerHTML = D.real
    ? `<b>${esc(D.title)}</b> · 토지조서 ${D.parcels.length}필지 · 건축물조서 ${D.buildings.length}동 <button class="btn sm" id="roadBtn">${roadTargets().length ? `도로접면 조회 (${roadTargets().length}필지)` : '도로접면 다시 조회'}</button> <button class="btn ghost sm" id="toSample">예시 구역 보기</button> <a class="btn ghost sm" href="../">구역계 고치기(사업성 검토)</a>`
    : has ? `예시 구역을 보는 중입니다. <button class="btn ghost sm" id="toReal">내 프로젝트 구역 불러오기 (${esc(proj.meta?.name || '')})</button>`
      : `사업성 검토 화면에서 구역계를 그리고 토지·건축물 조서를 불러오면 여기서 그 구역으로 판정합니다. <a class="btn ghost sm" href="../">사업성 검토로 가기</a>`;
  const rb = document.getElementById('roadBtn');
  if (rb) rb.onclick = () => {
    if (!roadTargets().length) { D.parcels.forEach(p => { if (p.pnu && !p.roadSide) delete roadCache[p.pnu]; }); }
    fetchRoads(rb);
  };
  const ts = document.getElementById('toSample'), tr = document.getElementById('toReal');
  if (ts) ts.onclick = () => { S.source = 'sample'; S.region = 'A'; loadData(); syncRegionChips(); render(); };
  if (tr) tr.onclick = () => { S.source = 'real'; S.region = 'A'; loadData(); syncRegionChips(); render(); };
  syncRegionChips();
}
function syncRegionChips() {
  document.querySelectorAll('[data-region]').forEach(x => {
    const k = x.dataset.region, reg = D.regions[k];
    x.hidden = k === 'B' && !reg.pts;
    x.textContent = reg.name;
    x.setAttribute('aria-pressed', k === S.region);
  });
}

function parcelFill(p) {
  const old = p.blds.some(b => (b.old === undefined ? obsoleteRule(b).old : b.old));
  if (S.mode === 'old' || S.mode === 'arch') return !p.blds.length ? 'var(--nobuild)' : old ? 'var(--old)' : 'var(--new)';
  if (S.mode === 'small') return p.area < smallLimit(p.zone) ? 'var(--small)' : 'var(--new)';
  if (S.mode === 'access') return p.access == null ? 'var(--nobuild)' : !p.blds.length ? 'var(--nobuild)' : p.access ? 'var(--new)' : 'var(--old)';
  if (S.mode === 'zone') return /2종/.test(p.zone) ? 'var(--accent-soft)' : /3종/.test(p.zone) ? 'var(--warn-soft)' : 'var(--nobuild)';
}
function drawMap() {
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
  for (const k of ['A', 'B', 'C']) {
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
    access: [['var(--new)', '접도 충족'], ['var(--old)', '미충족(폭4m·4m 미만)'], ['var(--nobuild)', D.real ? '미확인·건축물 없음' : '건축물 없음'], [null, '필지를 누르면 충족 → 미충족 → 자동 순으로 지정']],
    zone: [['var(--accent-soft)', '제2종일반주거'], ['var(--warn-soft)', '제3종일반주거'], ['var(--nobuild)', '기타·미확인']],
    arch: [['var(--accent)', '개략 주동 배치'], ['var(--old)', '노후·불량(현황)']],
  }[S.mode];
  L.innerHTML = m.map(([c, t]) => c ? `<span><i style="background:${c}"></i>${t}</span>` : `<span>${t}</span>`).join('') + `<span><svg width="26" height="8" style="vertical-align:0"><line x1="0" y1="4" x2="26" y2="4" stroke="var(--redline)" stroke-width="2" stroke-dasharray="7 2 1.2 2"/></svg> 구역계</span>`;
}
function svgPoint(evt) { const pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY; const q = pt.matrixTransform(svg.getScreenCTM().inverse()); return [Math.round(Math.max(0, Math.min(D.W, q.x)) * 10) / 10, Math.round(Math.max(0, Math.min(D.H, q.y)) * 10) / 10]; }
svg.addEventListener('click', e => { if (!S.drawing) return; S.draft.push(svgPoint(e)); document.getElementById('finishBtn').disabled = S.draft.length < 3; drawMap(); });

/* ===== 우측 패널 ===== */
const side = document.getElementById('side');
function render() {
  drawMap();
  if (S.tab === 'rules') { renderRules(); return; }
  const a = analyze(S.region);
  if (!a) { side.innerHTML = `<h2>직접 그린 안</h2><p>아직 그린 구역계가 없습니다. 도면 위 <b>구역계 그리기</b>를 눌러 꼭짓점을 찍어 보세요.</p>`; return; }
  ({ zone: renderZone, req: renderReq, plan: renderPlan, arch: renderArch, biz: renderBiz })[S.tab](a);
}
const kpi = (l, v, f) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="f">${f || ''}</div></div>`;
const regName = () => esc(D.regions[S.region].name);
function renderZone(a) {
  const rows = a.bs.slice().sort((x, y) => (x.year || 9999) - (y.year || 9999)).map(b => {
    const p = b.pid != null ? D.parcels[b.pid] : null;
    return `<tr><td>${esc(p ? p.jibun : '(필지 연결 안 됨)')}</td><td>${esc(b.use)}</td><td>${esc(b.struct)}</td><td class="r">${b.year || '–'}</td><td class="r">${fmt(b.floor)}</td><td>${b.unknown ? '<span class="pill warn">확인</span>' : b.old ? '<span class="pill bad">노후</span>' : '<span class="pill ok">비노후</span>'}</td><td>${esc(b.why)}</td><td>${p ? `<button class="acc ${p.access === true ? 'ok' : p.access === false ? 'bad' : ''} ${p.manual ? 'man' : ''}" data-pid="${p.id}" title="${esc(p.accSrc)} · 누르면 충족 → 미충족 → 자동">${p.access == null ? '미확인' : p.access ? '충족' : '미충족'}${p.manual ? ' · 지정' : ''}</button>` : '–'}</td><td>${b.lic}</td></tr>`;
  }).join('');
  side.innerHTML = `<h2>${regName()} 현황분석 ${D.real ? '<span class="badge v">토지·건축물 조서</span>' : '<span class="badge a">예시 데이터</span>'}</h2>
  <div class="kpis">
    ${kpi('구역 면적', fmt(a.area) + '㎡', D.real ? '구역계 도형 면적' : '구역계 폴리곤 면적(도로 포함)')}
    ${kpi('편입 필지', a.ps.length + '필지', `조서 면적 합 ${fmt(a.landArea)}㎡`)}
    ${kpi('건축물', a.N + '동', `연면적 ${fmt(a.fa)}㎡`)}
    ${kpi('노후도(동수)', pct(a.oldRatio), `${a.oldN} / ${a.N}동${a.unknownN ? ` · 연도 없음 ${a.unknownN}` : ''}`)}
    ${kpi('노후도(연면적)', pct(a.oldFaRatio), `${fmt(a.oldFa)} / ${fmt(a.fa)}㎡`)}
    ${kpi('과소필지', pct(a.smallRatio), `분할제한면적 미만 ${a.smallN} / ${a.ps.length}필지`)}
    ${kpi('주택접도율', accText(a), `폭4m·4m 이상 접도 ${a.accN} / ${a.N}동${a.accU ? ` · 미확인 ${a.accU}동` : ''}`)}
    ${kpi('호수밀도', a.density.toFixed(1) + '동/ha', `${a.du}동 ÷ ${(a.area / 10000).toFixed(2)}ha`)}
    ${kpi('토지등소유자(추정)', fmt(a.owners) + '명', D.real ? '소유자명 기준, 공동주택은 세대별, 국공유지 제외' : '1필지 1인, 다세대는 호수별')}
  </div>
  <h3>건축물 현황 (준공 오래된 순)</h3>
  <div class="tscroll"><table><thead><tr><th>지번</th><th>용도</th><th>구조</th><th class="r">사용승인</th><th class="r">연면적㎡</th><th>판정</th><th>근거</th><th>접도</th><th>허가</th></tr></thead><tbody>${rows || '<tr><td colspan="9">건축물이 없습니다.</td></tr>'}</tbody></table></div>
  <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="copyTbl">표 복사(엑셀 붙여넣기용)</button></div>
  <p class="note">접도는 ${D.real ? "토지특성 <b>도로접면</b>으로 추정합니다. 광대로·중로·소로·세로(가)는 폭 4m 이상 도로에 접한 것으로, 세로(불)·맹지는 미충족으로 봅니다. 세로(가)는 '폭 8m 미만·자동차 통행 가능' 도로라 4m가 안 될 수 있으니, 현장과 다르면 접도 칸이나 도면(색 구분 '접도')의 필지를 눌러 직접 지정하세요." : '예시 구역의 도로 폭으로 판정합니다. 접도 칸을 눌러 직접 지정해 볼 수 있습니다.'}</p>
  <p class="note">노후·불량 판정은 인천 정비조례 제3조②를 사용승인 연도에 적용한 값입니다.${D.real ? ' 공동주택의 지하층이 주거용인지는 대장만으로 알 수 없어 RC 30년으로 보고, 지하층이 있으면 근거에 표시합니다. 호수밀도의 "세대수가 가장 많은 층"은 세대수 ÷ 지상층수로 어림합니다.' : ''}</p>`;
  side.querySelectorAll('button.acc').forEach(bt => bt.onclick = () => cycleAccess(+bt.dataset.pid));
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
  const keys = ['A', 'B', 'C'].filter(k => D.regions[k].pts);
  const cmp = keys.map(k => { const x = analyze(k), jj = judge(x, P.type); return `<tr class="${k === S.region ? 'hl' : ''}"><td>${esc(D.regions[k].name)}</td><td class="r">${fmt(x.area)}</td><td class="r">${pct(x.oldRatio)}</td><td class="r">${pct(x.oldFaRatio)}</td><td class="r">${pct(x.smallRatio)}</td><td class="r">${accText(x)}</td><td class="r">${x.density.toFixed(1)}</td><td>${jj.pass === true ? '<span class="pill ok">입안 가능</span>' : jj.pass === false ? '<span class="pill bad">요건 미달</span>' : '<span class="pill warn">확인 필요</span>'}</td></tr>`; }).join('');
  const vtxt = j.pass === true ? '인천 정비조례 제5조 요건을 충족합니다' : j.pass === false ? '요건을 충족하지 못합니다 — 아래 미충족 항목을 보세요' : '확인이 필요한 항목이 있어 판정을 끝내지 못했습니다';
  side.innerHTML = `<h2>${regName()} 입안대상지역 요건판정</h2>
  <div class="field" style="max-width:260px;margin-bottom:10px"><label for="ptype">사업 유형</label><select id="ptype"><option value="redev">재개발사업</option><option value="improve">주거환경개선사업</option></select></div>
  <div class="verdict ${j.pass === true ? 'ok' : j.pass === false ? 'bad' : 'warn'}">${vtxt}</div>
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
  side.innerHTML = `<h2>${regName()} 정비계획 (토지이용·밀도)</h2>
  <div class="form">
    <div class="field"><label for="zone">용도지역(계획)</label><select id="zone"><option>제2종일반주거지역</option><option>제3종일반주거지역</option></select><span class="u">현황: ${Object.entries(a.zoneArea).map(([z, v]) => esc(z.replace('일반주거지역', '')) + ' ' + fmt(v) + '㎡').join(', ')}</span></div>
    ${field('infraRatio', '정비기반시설 비율(도로·공원·학교 등)', P.infraRatio, '구역 면적 대비 %, 예시 가정', 'min=0 max=60 step=1')}
    <div class="field"><label for="farMode">적용 용적률</label><select id="farMode"><option value="base">기준용적률 ${far.base}%</option><option value="allowed">허용용적률 ${far.allowed}%</option><option value="max">상한용적률 ${far.max}%</option><option value="custom">직접 입력</option></select><span class="u">2030 기본계획 · ${pressBadge}</span></div>
    ${P.farMode === 'custom' ? field('farCustom', '계획 용적률', P.farCustom, `% (상한 ${far.max}% 이내로 제한)`) : ''}
  </div>
  <h3>토지이용계획표 (개략)</h3>
  <div class="tscroll"><table class="ledger"><thead><tr><th>구분</th><th class="r">면적㎡</th><th class="r">비율</th></tr></thead><tbody>
    <tr><td>정비구역</td><td class="r">${fmt(a.area)}</td><td class="r">100.0%</td></tr>
    <tr><td>공동주택 획지(대지)</td><td class="r">${fmt(pl.site)}</td><td class="r">${(100 - P.infraRatio).toFixed(1)}%</td></tr>
    <tr><td>정비기반시설 계(도로·공원·녹지·학교 등)</td><td class="r">${fmt(a.area * P.infraRatio / 100)}</td><td class="r">${P.infraRatio.toFixed(1)}%</td></tr>
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
  bindNum(['infraRatio', 'farCustom']);
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

/* ===== 이벤트 ===== */
function syncMode() { document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x.dataset.mode === S.mode)); }
document.querySelectorAll('nav.steps button').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab;
  document.querySelectorAll('nav.steps button').forEach(x => x.setAttribute('aria-selected', x === b));
  if (S.tab === 'arch' && S.mode !== 'arch') { S.mode = 'arch'; syncMode(); }
  render();
});
document.querySelectorAll('[data-region]').forEach(b => b.onclick = () => { S.region = b.dataset.region; syncRegionChips(); render(); });
document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { S.mode = b.dataset.mode; syncMode(); render(); });
const drawBtn = document.getElementById('drawBtn'), finBtn = document.getElementById('finishBtn'), canBtn = document.getElementById('cancelBtn');
function endDraw() { S.drawing = false; S.draft = []; drawBtn.hidden = false; finBtn.hidden = true; canBtn.hidden = true; }
drawBtn.onclick = () => { S.drawing = true; S.draft = []; drawBtn.hidden = true; finBtn.hidden = false; finBtn.disabled = true; canBtn.hidden = false; drawMap(); toast('도면을 눌러 꼭짓점을 찍으세요'); };
canBtn.onclick = () => { endDraw(); drawMap(); };
finBtn.onclick = () => {
  if (S.draft.length < 3) return;
  D.regions.C.pts = S.draft.slice();
  try { localStorage.setItem(cKey(), JSON.stringify(D.regions.C.pts)); } catch (e) { /* 무시 */ }
  endDraw(); S.region = 'C'; syncRegionChips(); render(); toast('직접 그린 안으로 판정했습니다');
};
// 다른 탭(사업성 검토)에서 프로젝트가 바뀌면 다시 읽음
window.addEventListener('storage', e => { if (e.key === PROJECT_KEY && S.source !== 'sample') { loadData(); render(); } });

fetch('rules/incheon.json', { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).then(j => { if (j) applyJson(j); }).catch(() => {}).finally(() => { loadData(); render(); });
