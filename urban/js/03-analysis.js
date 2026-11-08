// /urban 정비계획 화면 코드 3/12 — 분석·요건 판정(면적·노후·접도·과소필지·호수밀도), 계획 가정(용도지역·용적률·세대수)
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
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
  // 아파트 단지: 같은 필지에 사용승인 연도를 아는 공동주택(주동)이 있으면, 연도 없는 건물(부속동·GIS 건물)은 그 단지 연도로 추정
  const aptYear = {}; bs.forEach(b => { if (b.kind === '공동' && b.year && b.pid != null) aptYear[b.pid] = Math.max(aptYear[b.pid] || 0, b.year); });
  let estN = 0;
  bs.forEach(b => { if (b.unknown && b.pid != null && aptYear[b.pid] && b.lic !== '기존무허가') { const y = aptYear[b.pid]; Object.assign(b, obsoleteRule(Object.assign({}, b, { year: y, ghost: false, kind: b.kind === '공동' ? '공동' : b.kind })), { estYear: y, unknown: false }); b.why = (b.why || '') + ` — 연도 없음: 같은 단지 주동 사용승인 ${y}년으로 추정`; estN++; } });
  const N = bs.length, oldN = bs.filter(b => b.old).length, unknownN = bs.filter(b => b.unknown).length;
  const fa = bs.reduce((s, b) => s + b.floor, 0), oldFa = bs.filter(b => b.old).reduce((s, b) => s + b.floor, 0);
  const smallN = ps.filter(p => (p.base ?? p.area) < smallLimit(p.zone)).length;
  let accN = 0, accU = 0;
  bs.forEach(b => { const a = b.pid != null ? D.parcels[b.pid].access : null; if (a === true) accN++; else if (a == null) accU++; });
  const du = bs.reduce((s, b) => s + densityUnits(b), 0);
  const landArea = ps.reduce((s, p) => s + landA(p), 0);
  // 토지특성의 용도지역1이 그 필지의 주된 용도지역 — '준공업지역, 일반공업지역'처럼 걸친 필지는 면적을 용도지역1에 넣고 걸친 용도지역은 따로 표시(2026-11-07 학익장미: 경계에 몇 ㎡ 걸친 일반공업에 필지 전체 면적이 붙던 문제)
  const zoneArea = {}, zoneTouch = {}; ps.forEach(p => { const zs = String(p.zone || '').split(/\s*,\s*/).filter(Boolean); const z = zs[0] || '미확인'; zoneArea[z] = (zoneArea[z] || 0) + landA(p); zs.slice(1).forEach(t => { zoneTouch[t] = (zoneTouch[t] || 0) + 1; }); });
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
    key, area, ps, bs, N, oldN, unknownN, ghostN: ghosts.length, fa, oldFa, smallN, accN, accU, du, landArea, zoneArea, zoneTouch, owners: Math.max(owners, 1), priorLand, needUnits, bsOf, estN,
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
const P_DEFAULT = JSON.parse(JSON.stringify(P));   // 위치가 바뀌면(다른 사업) 이 값으로 되돌림
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
// 계획 용도지역은 안(구역)마다 따로 — Z.zones[안].planZone(사용자가 고른 값). 없으면 현황 용도지역으로 기본값을 정함
//  (2026-11-06: 예전엔 P.zone 하나를 모든 구역이 같이 써서, 유원아파트 시험 때 고른 준주거가 학익장미 구역에도 남았음)
function defaultPlanZone(a) {
  const za = Object.entries((a && a.zoneArea) || {}).filter(([k]) => k !== '미확인').sort((x, y) => y[1] - x[1]);
  if (za.length && RULES.far['준주거지역'] && za.every(([k]) => /준주거/.test(k))) return '준주거지역';
  if (za.length && RULES.far['준공업지역'] && /준공업/.test(za[0][0])) return '준공업지역';   // 준공업 재건축(인천 첫 사례 300%)
  const top = za.length ? za[0][0] : '';
  if (/제2종일반주거/.test(top) && RULES.far['제2종일반주거지역']) return '제2종일반주거지역';
  return '제3종일반주거지역';   // 제3종·제1종·공업·기타 현황은 제3종 가정(공업지역은 용도지역 변경 전제 — 화면에 경고)
}
function planZoneStore(a) { return a && a.key && Z.zones[a.key] ? Z.zones[a.key] : null; }
function industrialNote(a) {
  const ks = Object.keys((a && a.zoneArea) || {}).filter(k => /공업/.test(k)); if (!ks.length) return '';
  if (/준공업/.test(P.zone)) return `<span class="u warn" style="display:block;margin-top:2px">준공업지역 300%는 인천 첫 준공업 재건축 구역이 인센티브·공공시설 제공으로 도달한 상한용적률(사례값)입니다 — 준공업의 기준·허용용적률은 확인 중이라 지금은 세 단계 모두 300%로 들어가 있습니다.</span>`;
  return `<span class="u warn" style="display:block;margin-top:2px">현황에 ${ks.map(esc).join('·')}이 있습니다 — 계획 용도지역(${esc(P.zone.replace('일반주거지역', ''))})은 용도지역 변경(정비계획 결정 시 주거지역 지정)을 전제로 한 가정입니다. 준공업 그대로 계획하면 '준공업지역'을 고르세요.</span>`;
}
function syncPlanZone(a) {
  if (!a || !a.key) return;
  const st = planZoneStore(a), byKey = P.zoneBy || {};
  const pick = st ? st.planZone : byKey[a.key];
  const want = pick && RULES.far[pick] ? pick : defaultPlanZone(a);
  if (P.zone !== want) { P.zone = want; saveP(); }
}
function setPlanZone(a, v) {
  const st = planZoneStore(a);
  if (st) { st.planZone = v; saveZ(); } else { P.zoneBy = Object.assign({}, P.zoneBy, { [a.key]: v }); }
  P.zone = v; saveP();
}
function plan(a) {
  syncPlanZone(a);
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

