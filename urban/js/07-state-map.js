// /urban 정비계획 화면 코드 7/12 — 화면 상태(예시/지도 전환·출처 줄·안 고르기), 실제 지도(Leaflet+브이월드) 초기화·그리기
// 원래 urban.js 한 파일(4,203줄)을 2026-11-08 기능별로 나눔. 불러오는 순서: urban/index.html (01→12). 파일 지도: CLAUDE.md '/urban 파일 지도'
// 모든 파일이 같은 전역 변수(S·Z·D·P 등)를 함께 씀 — 다른 파일 것을 쓸 때는 그 파일보다 뒤에 불러오는지 확인(node tools/check-urban-order.js)
//@@HEADER-END
'use strict';
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
      + (used ? ` <button class="btn ghost sm" id="newSite" title="지금 보고 있는 안의 구역계만 남기고 구역명·다른 안·기반시설·출입구·계획 가정을 모두 초기화합니다(자동 백업)">이 구역계로 새로 검토</button>` : '')
      + ` <button class="btn ghost sm" id="toSample">예시 구역 보기</button>`;
  }
  const on = (id, fn) => { const b = $id(id); if (b) b.onclick = fn; };
  const zt = $id('zoneTitle'); if (zt) zt.onchange = () => { Z.title = zt.value.trim(); saveZ(); syncTitle(); render(); };
  on('toMap', () => setSource('map'));
  on('newSite', async () => {
    const g = Z.zones[S.region] && Z.zones[S.region].geojson; if (!g) return;
    if (!confirm(`${S.region}안 구역계만 남기고 이전 검토(구역명·다른 안·기반시설·출입구·계획 가정)를 모두 초기화할까요?\n초기화 전 내용은 자동 백업됩니다.`)) return;
    const keep = JSON.parse(JSON.stringify(g));
    await resetForNewSite(S.region); S.region = ZONE_IDS[0];
    setZoneGeom(ZONE_IDS[0], keep, 0, null);
  });
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
// (2026-11-08 쪼개기) 여기 있던 parcelFill 한 줄짜리는 08-arch.js의 같은 이름 함수에 늘 덮여 한 번도 쓰이지 않았음 — 지움(동작 그대로)
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
  // 2026-11-08: 지도를 한 번 누른 뒤에만 휠 확대·축소(페이지를 내리다 지도가 축소되던 것), Ctrl+휠은 바로
  LM.scrollWheelZoom.disable(); LM.getContainer().addEventListener('mousedown', () => LM.scrollWheelZoom.enable()); LM.getContainer().addEventListener('mouseleave', () => LM.scrollWheelZoom.disable());
  LM.getContainer().addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); LM.setZoom(LM.getZoom() + (e.deltaY < 0 ? 1 : -1)); } }, { passive: false });
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
  if (S.mode === 'arch' && R && R.geojson) { const a = analyze(S.region); if (a) { const pl = plan(a); drawInfraLite(pl); if (!ARCHLAY.draw(a, pl)) drawTowersMap(R.geojson, pl); GATE.draw(layT, a, pl); } if (R.fetched && !INFRA.ready(S.region)) INFRA.fetchRoads(S.region); }
  if (S.mode === 'infra' && R && R.geojson && R.fetched) {
    if (!INFRA.ready(S.region)) INFRA.fetchRoads(S.region);
    const a = analyze(S.region); if (a) INFRA.draw(layT, a);
  }
  if (S.source === 'map' && R && R.geojson && R.fetched) AUTO.roads(S.region);
  // 출입구(추천 포함)는 출입구 탭이 아니어도 지도에 보임 — 구역계를 정하면 추천 출입구가 바로 눈에 띄게
  if (S.mode !== 'arch' && S.source === 'map' && R && R.geojson && R.fetched && INFRA.ready(S.region)) { const z = Z.zones[S.region]; if (GATE.list(z).length) { const a = analyze(S.region); if (a) GATE.draw(layT, a, null); } }
  drawLegend();
}
// 개략 주동 배치: 구역계를 미터 좌표로 펴서 격자로 놓은 뒤 다시 경위도로
