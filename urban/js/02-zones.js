// /urban 정비계획 화면 코드 2/12 — 지도 구역계(A~E안) 저장·공부 캐시, 지도 모드 데이터, 건축물 노후 판정, 예시 구역 데이터
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
/* ===== 지도 구역계(안)와 공부 캐시 ===== */
// Z: 안(A~E)별 구역계(GeoJSON)와 편입 필지·편입비율. CACHE: 필지(pnu)별 공부, 건축물 행
const ZONE_KEY = 'jbs-urban-zones-v1', CACHE_KEY = 'jbs-urban-cache-v1', UI_KEY = 'jbs-urban-ui';
const ZONE_IDS = ['A', 'B', 'C', 'D', 'E'];
// lastGeo: 마지막으로 있던 구역(안을 모두 지워도 남김) — 지운 뒤 다른 곳을 그려도 다른 사업으로 알아보게(2026-11-13, 작업기준서 오류기록 1번)
const Z = (() => { const z = lsGet(ZONE_KEY); return { title: z.title || '', center: z.center || [37.4553, 126.6577], zoom: z.zoom || 16, count: z.count || 3, zones: z.zones || {}, lastGeo: z.lastGeo || (Object.values(z.zones || {}).find(x => x && x.geojson) || {}).geojson || null }; })();
const CACHE = (() => { const c = lsGet(CACHE_KEY); return { parcels: c.parcels || {}, blds: c.blds || {} }; })();
const saveZ = () => { const r = lsSet(ZONE_KEY, Z); if (window.JbsProject) window.JbsProject.offer(Z.title, 'urban'); return r; };   // 사업명 원본(shared/project.js)에 알림
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
// 사업성 검토에서 가져온 조서에 공동주택 세대수·사용승인 연도가 비어 있으면 건축물대장 표제부로 한 번 채움(창마다 안별 한 번)
//  예전엔 가져오기에서 대장 조회를 안 해 아파트 단지 소유자가 '동 수'로 셈해졌음(2026-11-07 유원 11명)
const AUTO_LG = new Set();
async function autoLedger(id) {
  const z = Z.zones[id]; if (!z || !z.inArea || !LG.ok || busy || AUTO_LG.has(id)) return;
  const ks = Object.keys(z.inArea).filter(ledgerNeeded); if (!ks.length) return;
  AUTO_LG.add(id); busy = true;
  try { const f = await fillLedger(ks, (t, st, d, n) => { statusMsg(`${id}안: ${t}`); if (st) jobSet(id, st, d, n); }); saveCache(); statusMsg(f ? `${id}안: 건축물대장 조회 ${f}필지 실패(건축물대장 버튼으로 재시도)` : `${id}안: 건축물대장으로 세대수·사용승인 연도를 채웠습니다.`); }
  finally { busy = false; jobEnd(); if (S.source === 'map') { D = buildMap(); D.parcels.forEach(applyAccess); render(); } }
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
  const g = p.area.geojson;
  if (isNewSite(id, g.type === 'Feature' ? g.geometry : g)) { await resetForNewSite(id); id = ZONE_IDS[0]; }
  const z = zoneOf(id);
  histOf(id).undo.push({ gj: z.geojson ? JSON.parse(JSON.stringify(z.geojson)) : null, label: '사업성 검토 구역 가져오기' }); histOf(id).redo = [];
  z.geojson = g.type === 'Feature' ? { type: 'Feature', properties: {}, geometry: g.geometry } : { type: 'Feature', properties: {}, geometry: g };
  z.inArea = {}; z.fetchedAt = ''; Z.lastGeo = z.geojson;
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
  // 사업성 검토의 사업명·1회차 가정(용도지역·용적률 단계·기반시설 비율)을 이어받음 — 두 화면 세대수가 달라지지 않게(2026-11-07 학익장미: 사업성 708세대인데 /urban 1,078세대)
  const m = p.meta || {}, q = p.quick || {};
  if (m.title && !Z.title) Z.title = m.title;
  // 사업성 검토 용도지역 이름 → /urban 이름
  const qz = ({ '준주거지역_순수공동주택': '준주거지역', '역세권_준주거지역_순수공동주택': '준주거지역(역세권)', '준공업지역_공동주택': '준공업지역' })[q.zone] || q.zone;
  if (qz && RULES.far[qz]) { z.planZone = qz; P.zone = qz; }
  if (q.farStep) { P.farMode = q.farStep === 'custom' ? 'custom' : q.farStep; if (q.farStep === 'custom' && q.farCustom) P.farCustom = num(q.farCustom); }
  const ir = { avg: 25, cons: 30, custom: num(q.infraPct) }[q.infraLevel];
  if (ir > 0) P.infraRatio = ir;
  // 사업성 화면에서 '의무 없어도 공원 넣기'를 골랐으면 같은 비율로(2026-11-13 작업기준서 오류기록 4번)
  if (q.park === 'add') { P.parkMode = 'always'; if (num(q.parkPct) > 0) P.parkPct = num(q.parkPct); } else if (q.park === 'legal') P.parkMode = 'legal';
  saveP(); syncTitle();
  saveZ(); saveCache();
  if (window.JbsProject && JbsProject.offerZone) JbsProject.offerZone(z.geojson, 'urban');   // 구역 원본에 알림(2026-11-10)
  S.region = id; D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); fitZone(id); render();
  if (!lands.length) { fetchZone(id); return; }
  statusMsg(`${id}안: 사업성 검토 구역계와 조서(필지 ${lands.length}개)를 가져왔습니다.`);
  const miss = Object.keys(z.inArea).filter(k => !CACHE.parcels[k].roadSide);
  if (miss.length && VW.ok && !busy) {
    busy = true;
    try { await fillLandChar(miss, t => statusMsg(`${id}안: ${t}`)); saveCache(); statusMsg(`${id}안: 사업성 검토 조서를 가져오고 도로접면을 조회했습니다.`); }
    finally { busy = false; D = buildMap(); D.parcels.forEach(applyAccess); render(); }
  }
  autoLedger(id);
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
// 위치가 바뀌면(새 구역계가 지금까지 그린 어느 안과도 겹치지 않으면) 다른 사업으로 보고 기존 검토를 초기화(2026-11-06)
//  자동 백업 → 겹치지 않는 안·구역명·기반시설·출입구·계획 가정(P)·계획 용도지역 모두 비우고, 새 구역계만 남김
function isNewSite(id, geom) {
  if (!window.turf || !geom) return false;
  const g = { type: 'Feature', properties: {}, geometry: geom };
  const olds = Object.keys(Z.zones).map(k => Z.zones[k] && Z.zones[k].geojson).filter(Boolean);
  if (!olds.length && Z.lastGeo) olds.push(Z.lastGeo);   // 안을 다 지웠어도 마지막 구역과 비교
  if (!olds.length) return false;
  return !olds.some(o => { try { const x = turf.intersect(o, g); return !!x && turf.area(x) > 1; } catch (e) { return true; } });
}
function resetPlanState() {
  Object.keys(P).forEach(k => delete P[k]); Object.assign(P, JSON.parse(JSON.stringify(P_DEFAULT))); P.v54road = true; saveP();
  ['jbs-urban-infra-v1', 'jbs-urban-out'].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } });
}
async function resetForNewSite(id) {
  const label = Z.title || Object.keys(Z.zones).filter(k => Z.zones[k] && Z.zones[k].geojson).join('·') + '안';
  if (window.JbsWork) { try { await JbsWork.backup(`정비계획 위치 변경 — 이전 사업(${label}) 초기화 전 자동 백업`); } catch (e) { /* 백업 실패해도 진행 */ } }
  Object.keys(Z.zones).forEach(k => delete Z.zones[k]);
  Object.keys(HIST).forEach(k => delete HIST[k]);
  Z.title = ''; Z.count = 1;
  resetPlanState();
  saveZ(); syncTitle();
  toast(`위치가 바뀌어 이전 사업(${label}) 검토를 초기화했습니다. 자동 백업은 [작업 저장·불러오기]에 있습니다`);
}
// label: 실행 취소에 남길 작업 이름(null이면 이력에 안 남김 — 되돌리기 자체)
async function setZoneGeom(id, gj, delay = 0, label = '구역계 변경') {
  if (gj && label !== null && isNewSite(id, gj.type === 'Feature' ? gj.geometry : gj)) {
    await resetForNewSite(id); id = ZONE_IDS[0]; S.region = id; label = null;
  }
  const z = zoneOf(id);
  if (label !== null) {
    const h = histOf(id);
    h.undo.push({ gj: z.geojson ? JSON.parse(JSON.stringify(z.geojson)) : null, label });
    if (h.undo.length > 50) h.undo.shift();
    h.redo = [];
  }
  if (!gj) { if (z.geojson) Z.lastGeo = z.geojson; delete Z.zones[id]; saveZ(); D = buildMap(); D.parcels.forEach(applyAccess); syncRegionChips(); renderSourceBar(); render(); syncUndo(); return; }
  const geom = gj.type === 'Feature' ? gj.geometry : gj;
  z.geojson = { type: 'Feature', properties: {}, geometry: geom };
  z.inArea = {}; z.fetchedAt = ''; z.from = 'map'; delete z.roads;
  Z.lastGeo = z.geojson;
  saveZ();
  if (window.JbsProject && JbsProject.offerZone) JbsProject.offerZone(z.geojson, 'urban');   // 구역 원본에 알림(2026-11-10)
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


// 구역 원본 맞추기(2026-11-10, shared/project.js): 열 때 원본이 A~E 중 하나와 같으면 그 안을 고르고, 없으면 지금 안을 원본으로 바꿈(되돌리기 띠)
async function adoptProjectZone() {
  if (!window.JbsProject || !JbsProject.zone) return;
  const mz = JbsProject.zone(); if (!mz) return;
  const hit = ZONE_IDS.find(k => Z.zones[k] && Z.zones[k].geojson && JbsProject.zoneHash(Z.zones[k].geojson) === mz.h);
  if (hit) { JbsProject.seenZone('urban', mz.g); if (S.region !== hit) { S.region = hit; syncRegionChips(); renderSourceBar(); fitZone(hit); render(); } return; }
  if (S.source !== 'map') setSource('map');
  const id = S.region && ZONE_IDS.includes(S.region) ? S.region : ZONE_IDS[0];
  const prev = Z.zones[id] && Z.zones[id].geojson ? JSON.parse(JSON.stringify(Z.zones[id].geojson)) : null;
  JbsProject.seenZone('urban', mz.g);
  // 원본이 사업성 화면 구역이면 그 조서까지 가져옴(필지를 다시 받지 않음), 아니면 구역계만 바꾸고 공부를 새로 조회
  const pj = loadProject(), fromMain = pj && pj.area && pj.area.geojson && JbsProject.zoneHash(pj.area.geojson) === mz.h;
  if (fromMain) await importProject(id); else await setZoneGeom(id, { type: 'Feature', properties: {}, geometry: mz.g }, 0, '다른 화면 구역 가져오기');
  JbsProject.noteAdopted(`${JbsProject.fromName(mz.from)} 화면에서 ${mz.at}에 바꾼 구역계로 ${id}안을 맞췄습니다.`, prev ? () => setZoneGeom(id, prev, 0, '되돌리기') : null);
}
