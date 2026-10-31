'use strict';
// 브이월드(VWorld)·jsonp·필지 합치기(safeUnion)·splitJibun·구역계 계산(ZoneKit)은 js/zonekit.js (정비계획 검토 /urban과 같이 씀)

// ---------- 토지조서 면적 ----------
// 공식 기준은 토지대장 면적. 연속지적 면적(cadArea)은 도형·편입비율 계산용 참고값
//  조서 면적(area) = 대장 면적 × 편입비율, 대장 조회 전·실패 시에만 연속지적 면적 × 편입비율 (areaSrc '연속지적')

// 편입 면적(연속지적 도형 기준) → 편입비율. 98% 이상이면 전체 편입으로 봄
function setInArea(land, inArea) {
  const cad = num(land.cadArea);
  const r = cad ? inArea / cad : 1;
  land.inRatio = r >= 0.98 ? 1 : Math.max(0, r);
  applyLandArea(land);
}

function applyLandArea(land) {
  const led = num(land.ledgerArea) > 0;
  if (land.inRatio == null) {   // 편입비율을 모르는 예전 행: 면적은 그대로 둠
    land.areaSrc = led ? '연속지적(편입비율 모름)' : (land.areaSrc || '');
    return;
  }
  const base = led ? num(land.ledgerArea) : num(land.cadArea);
  land.area = Math.round(base * land.inRatio * 10) / 10;
  land.areaSrc = led ? '토지대장' : '연속지적';
  if (land.inRatio < 1) { land.partial = true; land.wholeArea = Math.round(base * 10) / 10; }
}

// 토지대장 결과를 조서 행에 넣음
function applyLandChar(land, c) {
  if (!c || !(c.ledgerArea > 0)) { land.ledgerFail = true; applyLandArea(land); return; }
  land.ledgerFail = false;
  land.ledgerArea = c.ledgerArea; land.ledgerJimok = c.ledgerJimok || ''; land.zoning = c.zoning || ''; land.baseYear = c.baseYear || ''; land.landUse = c.landUse || ''; land.roadSide = c.roadSide || '';
  if (c.jiga) { land.price = c.jiga; land.priceYear = c.baseYear || land.priceYear; }
  applyLandArea(land);
}

// 예시 데이터(sampleState) 행
function sampleRows() {
  return { lands: S.lands.filter(l => l.sample), buildings: S.buildings.filter(b => b.sample) };
}
function clearSampleRows() {
  S.lands = S.lands.filter(l => !l.sample);
  S.buildings = S.buildings.filter(b => !b.sample);
  if (S.meta.name === SAMPLE_NAME) S.meta.name = defaultState().meta.name;
  // 예시의 가상 구역계도 지움 (남겨 두면 실제 필지와 합쳐짐)
  if (S.area.geojson && zoneKey(S.area.geojson) === zoneKey(sampleState().area.geojson)) {
    S.area.geojson = null; S.area.drawnArea = 0; S.area.importedKey = ''; S.area.mode = 'ledger';
    if (MapView.items) MapView.items.clearLayers();   // 지도 위치는 그대로 (필지 선택 중일 수 있음)
  }
}

// GIS건물통합정보 → 건축물조서 한 행
// usability: 건축물대장 주용도코드, strct_cd: 구조코드 (1x 조적, 2x 철근콘크리트, 3x 철골, 4x 철골철근콘크리트, 5x 목구조)
function buildingFromFeature(f, jibun, pnu) {
  // 용도·구조·연도 규칙은 js/zonekit.js BldgRows.fromGis (정비계획 검토 /urban과 같음)
  return { id: uid(), jibun: jibun || '', pnu: pnu || '', auto: true, ...BldgRows.fromGis(f) };
}


// 연속지적도 객체 → 토지조서 한 행. inArea: 구역에 들어간 연속지적 면적(없으면 전체 편입)
//  면적은 우선 연속지적 기준으로 두고, MapView.fillLedger가 토지대장 면적으로 바꿈
function landFromFeature(f, inArea) {
  const p = f.properties || {};
  const sp = splitJibun(p.jibun);
  const jimok = sp.jimok === '임' ? '임야' : sp.jimok;
  const publicJimok = ['도', '구', '천', '제', '공'];
  const land = {
    id: uid(), pnu: p.pnu || '', jibun: sp.no,
    jimok: JIMOK.includes(jimok) ? jimok : (jimok || '기타'),
    area: 0,
    ownerType: publicJimok.includes(jimok) ? '국공유지' : '사유지', owner: '',
    price: num(p.jiga), geom: f.geometry,
    addr: p.addr || '', priceYear: p.gosi_year || '',
  };
  land.cadArea = window.turf ? Math.round(turf.area(f) * 10) / 10 : 0;
  setInArea(land, inArea == null ? land.cadArea : inArea);
  return land;
}


// 구역계 지도 (Leaflet + Leaflet.draw)
// 구역계 선 모양 (주황 외곽선, 옅은 채움)
const ZONE_STYLE = { color: '#d9480f', weight: 3, fillOpacity: 0.08 };

const MapView = {
  map: null,
  items: null,
  parcels: null,
  picking: false,
  hist: new ZoneUI.History(),

  // ---- 실행 취소 / 다시 실행 (ZoneUI.History — 정비계획 검토와 같은 코드) ----
  //  구역계·토지조서·건축물조서를 한꺼번에 기억함
  snapshot() {
    return JSON.stringify({ g: S.area.geojson, d: S.area.drawnArea, k: S.area.importedKey, l: S.lands, b: S.buildings });
  },
  remember(label) { this.hist.push(this.snapshot(), label); this.syncUndo(); },
  restore(snap) {
    const o = JSON.parse(snap);
    S.area.geojson = o.g; S.area.drawnArea = o.d || 0; S.area.importedKey = o.k || ''; S.lands = o.l || []; S.buildings = o.b || [];
    if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; }
    if (this.items) { this.items.clearLayers(); if (o.g) L.geoJSON(o.g, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l)); }
    this.drawParcels();
    App.update(true);
  },
  undo() {
    if (!this.hist.canUndo()) return;
    const it = this.hist.undo(this.snapshot());
    this.restore(it.snap); this.syncUndo();
    $('#pickMsg').textContent = `실행 취소: ${it.label}`;
  },
  redo() {
    if (!this.hist.canRedo()) return;
    const it = this.hist.redo(this.snapshot());
    this.restore(it.snap); this.syncUndo();
    $('#pickMsg').textContent = `다시 실행: ${it.label}`;
  },
  syncUndo() {
    const u = $('#mapUndoBtn'), r = $('#mapRedoBtn');
    if (u) { u.disabled = !this.hist.canUndo(); u.title = this.hist.canUndo() ? `실행 취소: ${this.hist.peekUndo().label} (Ctrl+Z)` : '되돌릴 작업 없음'; }
    if (r) { r.disabled = !this.hist.canRedo(); r.title = this.hist.canRedo() ? `다시 실행: ${this.hist.peekRedo().label} (Ctrl+Y)` : '다시 할 작업 없음'; }
  },

  init() {
    if (this.map) { setTimeout(() => this.map.invalidateSize(), 50); return; }
    if (!window.L || !L.Control.Draw) {
      $('#map').innerHTML = '<p class="map-error">지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</p>';
      return;
    }
    const a = S.area;
    this.map = L.map('map', { maxZoom: 21 }).setView(a.center, a.zoom);

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    });
    if (VWorld.enabled) {
      const k = VWorld.key;
      const attr = '&copy; <a href="https://www.vworld.kr">VWorld</a>';
      const base = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Base/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19, attribution: attr });
      const sat = L.layerGroup([
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Satellite/{z}/{y}/{x}.jpeg`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19, attribution: attr }),
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Hybrid/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 21, maxNativeZoom: 19 }),
      ]);
      const cadastral = L.tileLayer.wms('https://api.vworld.kr/req/wms', {
        // 기본 스타일은 주황 경계선 + 지번 표시. _line 스타일은 연노랑이라 배경지도 위에서 안 보임.
        layers: 'lp_pa_cbnd_bubun',
        styles: 'lp_pa_cbnd_bubun',
        format: 'image/png', transparent: true, version: '1.3.0',
        // WMS는 domain 값을 함께 보내면 INCORRECT_KEY로 거절됨. 브라우저가 보내는 Referer로 확인함.
        minZoom: 16, maxZoom: 21, key: k,
      });
      base.addTo(this.map);
      cadastral.addTo(this.map);
      L.control.layers(
        { '브이월드 지도': base, '위성사진': sat, 'OpenStreetMap': osm },
        { '지적도 (16레벨 이상 확대 시)': cadastral },
        // 휴대폰에서는 접어 둬야 지도를 가리지 않음
        { collapsed: window.innerWidth < 700, position: 'topright' },
      ).addTo(this.map);
    } else {
      osm.addTo(this.map);
    }

    // 전체 화면 버튼 (작은 필지를 고르기 쉽게)
    const FullBtn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const b = L.DomUtil.create('a', 'leaflet-bar map-full-btn');
        b.href = '#'; b.title = '지도 크게 보기 (Esc로 닫기)'; b.textContent = '⛶';
        L.DomEvent.on(b, 'click', e => { L.DomEvent.stop(e); this.toggleFull(); });
        return b;
      },
    });
    this.map.addControl(new FullBtn());
    // 전체 화면에서도 홈으로 갈 수 있게 (평소엔 상단 홈 버튼이 보여서 숨김)
    const HomeBtn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const b = L.DomUtil.create('a', 'leaflet-bar map-home-btn');
        b.href = '#'; b.title = '처음 화면으로 (입력 내용이 초기화됩니다)'; b.textContent = '⌂ 홈';
        L.DomEvent.on(b, 'click', e => { L.DomEvent.stop(e); App.home(); });
        return b;
      },
    });
    this.map.addControl(new HomeBtn());
    if (VWorld.enabled) {
      const PickBtn = L.Control.extend({
        options: { position: 'topright' },
        onAdd: () => {
          const b = L.DomUtil.create('a', 'leaflet-bar map-pick-btn');
          b.href = '#'; b.id = 'mapPickBtn';
          L.DomEvent.on(b, 'click', e => { L.DomEvent.stop(e); this.setPicking(!this.picking); });
          return b;
        },
      });
      this.map.addControl(new PickBtn());
      // 전체 화면에서도 결과가 보이게 지도 안 알림
      const Msg = L.Control.extend({ options: { position: 'bottomleft' }, onAdd: () => L.DomUtil.create('div', 'map-msg') });
      this.map.addControl(new Msg());
      const mm = $('#map .map-msg'), src = $('#pickMsg');
      new MutationObserver(() => { mm.textContent = src.textContent; mm.hidden = !src.textContent; }).observe(src, { childList: true, characterData: true, subtree: true });
      mm.hidden = true;
      $('#mapPickBtn').textContent = '필지 선택';
    }
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#map').classList.contains('map-full')) this.toggleFull(); });
    // 실행 취소 / 다시 실행 (지도 왼쪽 위 + Ctrl+Z / Ctrl+Y)
    const UndoBtn = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: () => {
        const d = L.DomUtil.create('div', 'zk-undo');
        d.innerHTML = '<button type="button" id="mapUndoBtn" aria-label="실행 취소">↶ 취소</button><button type="button" id="mapRedoBtn" aria-label="다시 실행">↷</button>';
        L.DomEvent.disableClickPropagation(d);
        d.querySelector('#mapUndoBtn').onclick = () => this.undo();
        d.querySelector('#mapRedoBtn').onclick = () => this.redo();
        return d;
      },
    });
    this.map.addControl(new UndoBtn());
    this.syncUndo();
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|TEXTAREA|SELECT/.test((e.target || {}).tagName || '') || !$('#map').offsetParent) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); }
    });

    // 층 순서: 선택만 된 필지(390) < 구역계(overlayPane 400) < 합쳐진 필지 마우스 영역(410, 평소 투명)
    //  필지를 다시 그려도 필지선이 구역계를 가리지 않음 (구역계는 leaflet.draw 편집 때문에 기본 overlayPane에 둠)
    this.map.createPane('parcelPane').style.zIndex = 390;
    this.map.createPane('parcelHitPane').style.zIndex = 410;
    this.parcels = L.featureGroup().addTo(this.map);
    this.items = new L.FeatureGroup().addTo(this.map);
    // showArea는 leaflet.draw 1.0.4 + Leaflet 1.9 조합에서 오류가 나서 끔. 면적은 turf로 계산.
    this.map.addControl(new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: false, shapeOptions: ZONE_STYLE },
        rectangle: { showArea: false, shapeOptions: ZONE_STYLE },
        polyline: false, circle: false, marker: false, circlemarker: false,
      },
      edit: { featureGroup: this.items },
    }));

    this.map.on(L.Draw.Event.CREATED, e => {
      if (typeof LotCut !== 'undefined' && LotCut.lineHandler) { LotCut.onLine(e.layer); return; }   // 대지 자르기 선
      this.remember('구역계 그리기');
      if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; } this.items.clearLayers(); this.items.addLayer(e.layer); this.save();
    });
    this.map.on(L.Draw.Event.EDITED, () => { this.remember('꼭짓점 고치기'); this.save(); });
    this.map.on(L.Draw.Event.DELETED, () => { this.remember('구역계 지우기'); this.save(); });
    // 그리기 중에는 필지 선택이 끼어들지 않도록
    this.map.on(L.Draw.Event.DRAWSTART, () => { this.drawing = true; });
    this.map.on(L.Draw.Event.DRAWSTOP, () => { this.drawing = false; });
    this.map.on('click', e => {
      if (typeof RefOverlay !== 'undefined' && RefOverlay.step) { RefOverlay.onClick(e); return; }   // 도면 맞추기 중
      if (typeof LotCut !== 'undefined' && LotCut.waiting) { LotCut.onPick(e.latlng); return; }     // 자를 필지 고르기
      if (this.picking && !this.drawing) this.pick(e.latlng);
    });
    this.map.on('moveend', () => {
      const c = this.map.getCenter();
      S.area.center = [c.lat, c.lng];
      S.area.zoom = this.map.getZoom();
      App.persist();
    });
    this.load();
    setTimeout(() => this.map.invalidateSize(), 50);
  },

  load() {
    if (!this.map) return;
    this.items.clearLayers();
    if (S.area.geojson) {
      L.geoJSON(S.area.geojson, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l));
      this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    } else {
      this.map.setView(S.area.center, S.area.zoom);
    }
    this.drawParcels();
  },

  // 토지조서에 들어간 필지 중 경계가 있는 것을 지도에 표시
  // 필지가 구역계와 50% 이상 겹치면 '구역에 합쳐짐'(inZone), 아니면 '선택만 됨'. 구역이 바뀐 필지만 다시 계산
  updateInZone() {
    const zone = S.area.geojson, key = zone ? zoneKey(zone) : '';
    S.lands.forEach(l => {
      if (!l.geom) { delete l.inZone; delete l.inZoneKey; return; }
      if (l.inZoneKey === key && typeof l.inZone === 'boolean') return;
      let r = 0;
      if (zone && window.turf) {
        const f = { type: 'Feature', properties: {}, geometry: l.geom };
        try { const x = turf.intersect(f, zone); r = x ? turf.area(x) / turf.area(f) : 0; }
        catch (e) { try { r = turf.booleanPointInPolygon(turf.pointOnFeature(f), zone) ? 1 : 0; } catch (e2) { r = 0; } }
      }
      l.inZone = r >= 0.5;
      l.inZoneKey = key;
    });
  },

  // 구역계 모양: 주황 외곽선 하나 (필지 사이 중간선 없음)
  styleZone(weight = 3) {
    if (this.items) this.items.eachLayer(l => l.setStyle && l.setStyle({ ...ZONE_STYLE, weight }));
  },

  // 합친 직후 구역계 외곽선을 0.6초 굵게 깜빡임
  flashZone() {
    [7, 3, 7, 3].forEach((w, i) => setTimeout(() => this.styleZone(w), i * 150));
  },

  // 토지조서 필지 그리기
  //  선택만 됨: 파란 테두리·채움 / 구역에 합쳐짐: 선 없음(필지 경계 보기를 켜면 희미한 점선), 마우스를 올리면 그 필지만 점선 강조
  drawParcels() {
    this.updateInZone();
    if (!this.parcels) return;
    this.parcels.clearLayers();
    const faint = { color: '#2563eb', weight: 1, dashArray: '3 3', opacity: 0.4, fill: true, fillOpacity: 0 };
    const hidden = { color: '#2563eb', weight: 1, opacity: 0, fill: true, fillOpacity: 0 };
    const hover = { color: '#1d4ed8', weight: 2.5, dashArray: '5 4', opacity: 0.95, fill: true, fillOpacity: 0.12 };
    S.lands.filter(l => l.geom).forEach(l => {
      const tip = `${esc(l.jibun)} ${esc(l.ledgerJimok || l.jimok)} · ${num(l.ledgerArea) > 0 ? `대장 ${fmt(l.ledgerArea, 1)}㎡` : `${fmt(num(l.area), 1)}㎡`}`;
      if (!l.inZone) {
        L.geoJSON(l.geom, { pane: 'parcelPane', style: { color: '#2563eb', weight: 2, fillOpacity: 0.18 } }).bindTooltip(tip).addTo(this.parcels);
        return;
      }
      const base = S.area.showParcels ? faint : hidden;
      const g = L.geoJSON(l.geom, { pane: 'parcelHitPane', style: base }).bindTooltip(tip, { sticky: true });
      g.on('mouseover', () => g.setStyle(hover));
      g.on('mouseout', () => g.setStyle(base));
      g.addTo(this.parcels);
    });
  },

  // 조서 필지 하나를 지도에서 크게 보여 줌 (2단계 면적 차이 링크)
  focusLand(l) {
    if (!this.map || !l.geom) return;
    const g = L.geoJSON(l.geom);
    this.map.fitBounds(g.getBounds(), { padding: [80, 80], maxZoom: 20 });
    if (this.focusMark) this.focusMark.remove();
    this.focusMark = L.geoJSON(l.geom, { style: { color: '#dc2626', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(this.map);
    setTimeout(() => { if (this.focusMark) { this.focusMark.remove(); this.focusMark = null; } }, 6000);
    $('#pickMsg').textContent = `${l.jibun} ${l.ledgerJimok || l.jimok} · 대장 ${fmt(num(l.ledgerArea), 1)}㎡ (연속지적 ${fmt(num(l.cadArea), 1)}㎡)`;
  },

  save() {
    this.styleZone();
    const layers = this.items.getLayers();
    if (!layers.length) {
      S.area.geojson = null;
      S.area.drawnArea = 0;
    } else {
      const gj = layers[0].toGeoJSON();
      S.area.geojson = gj;
      S.area.drawnArea = window.turf ? turf.area(gj) : 0;
      // 구역이 정해지면 그 안의 용도지역을 자동으로 채움
      if (VWorld.enabled && window.turf) {
        const pt = turf.pointOnFeature(gj).geometry.coordinates;
        Auto.zoning(pt[1], pt[0], turf.bbox(gj));
        Auto.locationFromParcel(pt[1], pt[0], true);
      }
    }
    App.update(true);
  },

  // 토지대장 면적 조회 (4필지씩 동시). say(text): 진행 표시. 끝나면 조회 못 한 필지 수
  async fillLedger(lands, say = () => {}) {
    lands = lands.filter(l => l.pnu);
    if (!lands.length || !VWorld.enabled) return 0;
    this.ledgerBusy = true;
    let done = 0, fail = 0;
    const queue = lands.slice();
    say(`토지대장 면적 조회 중 0/${lands.length}`, 0, lands.length);
    try {
      await Promise.all([1, 2, 3, 4].map(async () => {
        while (queue.length) {
          const l = queue.shift();
          let c = null;
          try { c = await VWorld.landChar(l.pnu); } catch (e) { c = null; }
          applyLandChar(l, c);
          if (l.ledgerFail) fail++;
          ++done; say(`토지대장 면적 조회 중 ${done}/${lands.length}`, done, lands.length);
        }
      }));
    } finally { this.ledgerBusy = false; }
    return fail;
  },

  // 예시 데이터가 남아 있으면 지울지 한 번 물어봄 (필지 선택·구역 불러오기·지번 구역 만들기 시작 전)
  askClearSample() {
    const r = sampleRows();
    if (this.sampleAsked || (!r.lands.length && !r.buildings.length)) return;
    this.sampleAsked = true;
    if (confirm(`예시 데이터(가상 필지 ${r.lands.length}개${r.buildings.length ? `·건축물 ${r.buildings.length}동` : ''})가 남아 있습니다. 지우고 시작할까요?`)) clearSampleRows();
  },

  // 구역계 안의 필지·건축물을 한꺼번에 토지조서·건축물조서로 불러오기
  //  opts.silent: 이미 불러온 행이 있어도 확인 창을 띄우지 않음 (3단계 자동 불러오기·buildZone처럼 앞에서 이미 물은 경우)
  //  opts.msg: 진행 메시지를 쓸 요소 (기본은 2단계 #pickMsg). Leaflet 지도 없이도 돎 (turf·브이월드만 씀)
  //  성공하면 true
  async importArea(opts = {}) {
    const msg = opts.msg || $('#pickMsg') || {};
    if (!S.area.geojson) { alert('먼저 지도에 구역계를 그려 주세요.'); return false; }
    if (this.importing) return false;
    this.askClearSample();
    // 진행 문구는 2단계(#pickMsg)와 3단계 상단에 같이
    const outs = [...new Set([msg, $('#pickMsg'), $('#surveySyncMsg')].filter(Boolean))];
    const say = t => outs.forEach(o => { o.textContent = t; });
    // 단계·진행률 안내 (ZoneUI.progressHtml — 정비계획 검토와 같은 모양)
    const prog = (step, label, done, total, after) => { const h = ZoneUI.progressHtml({ step, steps: 3, label, done, total, after }); outs.forEach(o => { o.innerHTML = h; }); };
    const autoLands = S.lands.filter(l => l.pnu).length;
    const autoBldgs = S.buildings.filter(b => b.auto).length;
    if (!opts.silent && (autoLands || autoBldgs) && !confirm(`이미 지도에서 불러온 필지 ${autoLands}개, 건축물 ${autoBldgs}동이 있습니다. 구역계 기준으로 다시 불러올까요?\n(직접 입력한 행은 그대로 둡니다)`)) return false;
    const zone = S.area.geojson;
    if (!opts.silent) this.remember('필지·건축물 다시 불러오기');
    this.importing = true;
    const box = `BOX(${turf.bbox(zone).join(',')})`;
    const inZone = f => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), zone); } catch (e) { return false; } };
    try {
      prog(1, '구역 안 필지(연속지적) 불러오기', 0, 0, '구역에 10% 이상 걸친 필지를 고릅니다');
      // 구역에 든 필지: 겹친 연속지적 면적이 10% 이상이거나 필지 안 한 점이 구역 안
      //  (한 점만 보면 구역선과 경계가 조금 어긋난 필지를 놓침 – 예: 간석동 387-2, 327.1㎡ 중 326.3㎡ 겹침)
      const inArea = new Map();
      const parcels = (await VWorld.dataAll('LP_PA_CBND_BUBUN', box)).filter(f => {
        let inA = 0;
        try { const x = turf.intersect(f, zone); inA = x ? turf.area(x) : 0; } catch (e) { inA = inZone(f) ? turf.area(f) : 0; }
        const ok = inA >= 1 && (inA / turf.area(f) >= 0.1 || inZone(f));
        if (ok) inArea.set(f, inA);
        return ok;
      });
      prog(2, '건축물(GIS건물통합정보) 불러오기', 0, 0, `필지 ${parcels.length}개 확인 · 다음은 토지대장 면적 조회`);
      const onParcel = (bf, pf) => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(bf), pf); } catch (e) { return false; } };
      const bldgs = (await VWorld.dataAll('LT_C_BLDGINFO', box)).filter(bf => inZone(bf) || parcels.some(pf => inArea.get(pf) / turf.area(pf) >= 0.98 && onParcel(bf, pf)));

      // 지도로 불러온 기존 행은 교체, 직접 입력한 행은 유지
      S.lands = S.lands.filter(l => !l.pnu);
      S.buildings = S.buildings.filter(b => !b.auto);
      // 편입비율 = 구역과 겹친 연속지적 면적 / 연속지적 면적
      const added = parcels.map(f => {
        const land = landFromFeature(f, inArea.get(f));
        S.lands.push(land);
        return land;
      });
      bldgs.forEach(f => {
        const owner = parcels.find(pf => onParcel(f, pf));
        const pp = owner ? owner.properties : {};
        S.buildings.push(buildingFromFeature(f, splitJibun(pp.jibun).no, pp.pnu));
      });
      App.update(true);   // 대장 조회 동안 표를 먼저 보여 줌
      const fail = await this.fillLedger(added, (t, d, n) => prog(3, '토지대장 면적 조회', d, n, '끝나면 조서 면적이 토지대장 기준으로 바뀝니다'));
      const need = S.buildings.filter(b => b.needUnits).length;
      const noInfo = S.buildings.filter(b => b.noInfo).length;
      const tot = added.reduce((a, l) => a + num(l.area), 0);
      say(`필지 ${parcels.length}개(조서 면적 ${fmt(tot, 1)}㎡, 토지대장 기준${fail ? ` – ${fail}필지는 대장 조회 실패로 연속지적 면적` : ''}), 건축물 ${bldgs.length}동을 불러왔습니다.`
        + (need ? ` 공동주택 ${need}동은 세대수를 확인해 입력하세요.` : '')
        + (noInfo ? ` ${noInfo}동은 용도·사용승인일 정보가 없어 건축물대장 확인이 필요합니다.` : ''));
      S.area.importedKey = zoneKey(zone);
      S.area.importedAt = new Date().toLocaleString('sv-SE').slice(0, 16);
      this.drawParcels();
      App.update(true);
      return true;
    } catch (e) {
      say('불러오기에 실패했습니다: ' + e.message);
      return false;
    } finally {
      this.importing = false;
    }
  },

  toggleFull() {
    const el = $('#map');
    const on = el.classList.toggle('map-full');
    document.body.classList.toggle('map-full-open', on);
    setTimeout(() => this.map.invalidateSize(), 50);
  },

  setPicking(on) {
    this.picking = on;
    if (this.map) this.map.getContainer().classList.toggle('picking', on);
    const pb = $('#mapPickBtn');
    if (pb) { pb.textContent = on ? '필지 선택 중 (끄기)' : '필지 선택'; pb.classList.toggle('on', on); }
    App.update(true);
  },

  // 필지 클릭: 토지조서에 없으면 추가, 있으면 제거
  async pick(latlng) {
    const msg = $('#pickMsg');
    this.askClearSample();
    msg.textContent = '필지 정보를 불러오는 중…';
    try {
      const f = await VWorld.parcelAt(latlng.lat, latlng.lng);
      if (!f) { msg.textContent = '이 위치에서 필지를 찾지 못했습니다.'; return; }
      const p = f.properties || {};
      const idx = S.lands.findIndex(l => l.pnu && l.pnu === p.pnu);
      const no = splitJibun(p.jibun).no;
      // 작은 필지는 덜 확대된 화면에서 옆 필지를 잘못 누르기 쉬우므로, 먼저 크게 확대해 보여주고 다시 누르게 함
      const fa = turf.area(f);
      if (fa < (num(S.criteria.smallLot) || 60) && this.map.getZoom() < 19) {
        this.map.fitBounds(L.geoJSON(f).getBounds(), { padding: [80, 80], maxZoom: 21 });
        if (this.map.getZoom() < 20) this.map.setView(L.geoJSON(f).getBounds().getCenter(), 20);
        if (this.smallMark) this.smallMark.remove();
        this.smallMark = L.geoJSON(f, { style: { color: '#dc2626', weight: 3, dashArray: '6 4', fillOpacity: 0.15 }, interactive: false }).addTo(this.map);
        setTimeout(() => { if (this.smallMark) { this.smallMark.remove(); this.smallMark = null; } }, 6000);
        msg.innerHTML = `<b class="warn">작은 필지(${esc(no)}, ${fmt(fa, 1)}㎡)라 크게 확대했습니다.</b> 빨간 점선이 맞는 필지면 다시 눌러 주세요.`;
        return;
      }
      const zoneOn = !$('#pickZone') || $('#pickZone').checked;
      // 넣을지 뺄지 지도 위 작은 창에서 고름 (ZoneUI.choose — 정비계획 검토와 같은 창)
      let r = 0;
      if (S.area.geojson) { try { const x = turf.intersect(f, S.area.geojson); r = x ? turf.area(x) / fa : 0; } catch (e) { r = 0; } }
      const inZone = zoneOn && r >= 0.5, isIn = idx >= 0 || inZone;
      const straddle = zoneOn && S.area.geojson && fa * r > 1 && fa * (1 - r) > 1;   // 경계에 걸침(면적으로 판단)
      const jm0 = splitJibun(p.jibun).jimok;
      msg.textContent = `${no} 필지: 넣을지 뺄지 지도에서 고르세요.`;
      const act = await ZoneUI.choose(this.map, latlng, f, {
        title: `${no} ${jm0} · ${fmt(fa, 1)}㎡`,
        sub: straddle ? `경계에 걸침 · 구역 안 ${fmt(fa * r, 1)}㎡ / 밖 ${fmt(fa * (1 - r), 1)}㎡${idx >= 0 ? ' · 조서에 있음' : ''}` : idx >= 0 ? '조서·구역에 들어 있습니다' : inZone ? `구역 안(${fmt(r * 100)}% 겹침)이지만 조서에는 없습니다` : r > 0 ? `구역에 ${fmt(r * 100)}% 걸쳐 있습니다` : '구역 밖 필지입니다',
        canIn: idx < 0 || straddle, canOut: isIn || straddle,
        inLabel: zoneOn ? '구역·조서에 넣기' : '조서에 넣기', outLabel: zoneOn ? '구역·조서에서 빼기' : '조서에서 빼기',
      });
      if (!act) { msg.textContent = `${no} 필지: 그대로 두었습니다.`; return; }
      this.remember(`${no} ${act === 'in' ? '넣기' : '빼기'}`);
      if (act === 'out' && idx < 0) {
        this.toggleZoneParcel(f, false);
        msg.textContent = `${no} 필지를 구역계에서 뺐습니다.`;
        this.save();
        return;
      }
      if (act === 'in' && idx >= 0) {
        msg.textContent = `${no} 필지 전체를 구역계에 넣었습니다.`;
      } else if (act === 'out') {
        S.lands.splice(idx, 1);
        S.buildings = S.buildings.filter(b => !(b.auto && b.pnu === p.pnu));
        msg.textContent = `${no} 필지와 그 위 건축물을 조서에서 뺐습니다.`;
      } else {
        const land = landFromFeature(f);
        S.lands.push(land);
        // 그 필지 위 건축물도 함께
        let added = 0;
        try {
          const bs = (await VWorld.dataPage('LT_C_BLDGINFO', `BOX(${turf.bbox(f).join(',')})`, 1, 100)).features
            .filter(bf => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(bf), f); } catch (e) { return false; } });
          bs.forEach(bf => S.buildings.push(buildingFromFeature(bf, no, p.pnu)));
          added = bs.length;
        } catch (e) { /* 건축물 조회 실패해도 필지는 추가 */ }
        msg.textContent = `${no} ${land.jimok} · 토지대장 면적 조회 중…`;
        await this.fillLedger([land]);
        const jm = land.ledgerJimok || land.jimok;
        msg.textContent = (land.ledgerFail
          ? `${no} ${jm} · 연속지적 ${fmt(land.cadArea, 1)}㎡ (토지대장 조회 실패 – 대장 면적 확인 필요)`
          : `${no} ${jm} · 대장 ${fmt(land.ledgerArea, 1)}㎡ (연속지적 ${fmt(land.cadArea, 1)}㎡)`)
          + ` · 공시지가 ${land.price ? fmt(num(land.price)) + '원/㎡' : '정보 없음'} · 건축물 ${added}동 추가`;
        if (!S.meta.zoning || S.meta.zoningAuto) Auto.zoning(latlng.lat, latlng.lng);
      }
      // 구역계에도 넣고 빼기
      if (zoneOn) {
        // 조서와 구역이 함께 바뀌므로, 원래 맞아 있었으면(또는 구역이 없었으면) 계속 맞는 것으로 봄
        const inSync = !S.area.geojson || S.area.importedKey === zoneKey(S.area.geojson);
        this.toggleZoneParcel(f, act === 'in');
        if (inSync) S.area.importedKey = zoneKey(S.area.geojson);
      }
      this.drawParcels();
      App.update(true);
    } catch (e) {
      msg.textContent = '필지 조회에 실패했습니다: ' + e.message + ' (인증키와 등록한 서비스 URL을 확인하세요)';
    }
  },

  // 필지 하나를 구역계에 더하거나(add=true) 뺌
  toggleZoneParcel(f, add) {
    const next = ZoneKit.toggle(S.area.geojson, f, add);
    this.items.clearLayers();
    if (next) L.geoJSON(next, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l));
    const layers = this.items.getLayers();
    S.area.geojson = layers.length ? layers[0].toGeoJSON() : null;
    S.area.drawnArea = S.area.geojson ? turf.area(S.area.geojson) : 0;
  },

  // GeoJSON 파일(구역계)을 불러와 구역계로
  async importGeoJSON() {
    const text = await pickTextFile('.geojson,.json,application/geo+json,application/json');
    if (!text) return;
    let gj;
    try { gj = JSON.parse(text); } catch (e) { alert('GeoJSON 파일을 읽을 수 없습니다.'); return; }
    const polys = [];
    const take = g => {
      if (!g) return;
      if (g.type === 'FeatureCollection') g.features.forEach(take);
      else if (g.type === 'Feature') take(g.geometry);
      else if (g.type === 'Polygon' || g.type === 'MultiPolygon') polys.push({ type: 'Feature', properties: {}, geometry: g });
    };
    take(gj);
    if (!polys.length) { alert('파일에 면(Polygon) 도형이 없습니다.'); return; }
    if (S.area.geojson && !confirm('지금 구역계를 파일의 경계로 바꿀까요?')) return;
    const merged = safeUnion(polys);
    this.remember('GeoJSON 불러오기');
    if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; }
    this.items.clearLayers();
    L.geoJSON(merged, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    this.save();
    $('#jibunMsg').textContent = `구역계 파일을 불러왔습니다 (${fmt(turf.area(merged))}㎡). 필지 경계에 맞추려면 "그린 구역을 필지에 맞추기"를 누르세요.`;
    this.checkFit('불러온 구역계');
  },

  // 구역계가 현재 지적 경계와 얼마나 맞는지 확인하고, 많이 어긋나면 먼저 알림
  // (옛 고시 도면을 옮긴 선 등은 필지를 가로지르므로, 사이트 지적도가 틀린 것으로 오해하지 않게)
  async checkFit(what = '구역계') {
    const r = await ZoneKit.fit(S.area.geojson);
    if (!r) return;
    const d = $('#fitDialog');
    $('#fitText').innerHTML = `${what}는 지금 지적도(국토교통부 브이월드 연속지적도)의 필지 경계와 <b>맞지 않습니다</b>.<br>`
      + `필지를 가로지르는 곳 <b>${fmt(r.cut)}필지</b>(도로·구거 제외), 어긋난 면적 약 <b>${fmt(r.dev)}㎡ (구역의 ${fmt(r.pct, 1)}%)</b>.`
      + (r.cutList.length ? `<br><small>예: ${r.cutList.map(esc).join(', ')}${r.cut > r.cutList.length ? ' 등' : ''}</small>` : '');
    if (!d.open) d.showModal();
  },

  // 선택한 필지들을 합쳐 구역계로
  // 선택만 된 필지(파란 필지)를 지금 구역계에 합침 → 필지 사이 중간선 없이 주황 외곽선 하나로
  parcelsToArea() {
    this.updateInZone();
    const sel = S.lands.filter(l => l.geom && !l.inZone);
    if (!sel.length) { alert('구역계에 합칠 선택 필지가 없습니다. "필지 선택"을 켜고 지도에서 필지를 눌러 추가하세요.'); return; }
    const polys = sel.map(l => ({ type: 'Feature', properties: {}, geometry: l.geom }));
    const inSync = !S.area.geojson || S.area.importedKey === zoneKey(S.area.geojson);
    this.remember('선택 필지 합치기');
    const merged = fillSmallHoles(safeUnion(S.area.geojson ? [S.area.geojson, ...polys] : polys));
    if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; }
    this.items.clearLayers();
    L.geoJSON(merged, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    this.save();   // 구역 저장 → 다시 그리면 합친 필지의 파란 선이 사라짐
    if (inSync) { S.area.importedKey = zoneKey(S.area.geojson); App.update(true); }   // 조서는 이미 이 필지들을 담고 있음
    this.flashZone();
    const names = sel.map(l => l.jibun);
    const tot = sel.reduce((a, l) => a + (num(l.ledgerArea) > 0 ? num(l.ledgerArea) : num(l.area)), 0);
    $('#pickMsg').textContent = `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` 외 ${names.length - 5}필지` : ''} → 구역계로 합침 (${names.length}필지 · 대장 합계 ${fmt(tot, 1)}㎡)`;
  },

  // 지번 목록 → 필지를 찾아 합쳐서 구역계를 그리고, 조서까지 불러옴
  // base: "인천광역시 남동구 간석동" 처럼 지번 앞에 붙일 동 주소
  // opts.fillHoles: 구역 안에 둘러싸인 필지(도로 등) 자동 포함, opts.bridge: 떨어진 덩어리 사이 도로 잇기
  async zoneFromJibuns(items, base, opts = { fillHoles: true, bridge: true }) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 지번으로 필지를 찾을 수 있습니다.'; return; }
    if (!ZoneKit.items(items).length) { msg.textContent = '지번이 없습니다. 한 줄에 하나씩 넣어 주세요. 예: 387, 388-1, 산12'; return; }
    if (S.area.geojson && !confirm('지금 그려진 구역계를 지번 목록의 필지로 바꿀까요?')) return;
    this.askClearSample();
    this.remember('지번 목록으로 구역계');
    const { found, report, count } = await ZoneKit.findByJibuns(items, base, t => { msg.textContent = t; });
    await this.buildZone(found, report, opts, `지번 ${count}개 → `);
  },

  // 제출 토지조서 폐합 검토 (ZoneKit.closure — 정비계획 검토와 같은 코드)
  //  조서 지번만 그대로 합쳐(갇힌 필지·도로 자동 채우기 없음) 구역계·조서로 두고, 떨어진 덩어리·빠진 필지·틈을 알려 줌
  async closureCheck(items, base) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 합니다.'; return; }
    if (!ZoneKit.items(items).length) { msg.textContent = '토지조서 지번을 넣거나 "엑셀·CSV에서 지번 읽기"로 조서 파일을 고르세요.'; return; }
    if (S.area.geojson && !confirm('지금 구역계를 제출 조서의 필지 경계로 바꿔 검토할까요?')) return;
    this.askClearSample();
    this.remember('제출 조서 폐합 검토');
    const { found, report } = await ZoneKit.findByJibuns(items, base, t => { msg.textContent = t; });
    let r = null;
    try { r = await ZoneKit.closure(found, t => { msg.textContent = t; }); } catch (e) { msg.textContent = '폐합 검토 중 오류: ' + e.message; return; }
    if (!r) { msg.textContent = '조서 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'; this.showReport(report); return; }
    await this.buildZone(new Map(found), report.slice(), { fillHoles: false, bridge: false, edgeRoad: 'none' }, '제출 조서 → ');
    this.showReport(report);
    if (this.closeLayer) this.closeLayer.remove();
    this.closeLayer = ZoneUI.closureLayer(this.map, r);
    msg.innerHTML = ZoneKit.closureHtml(r, report);
  },

  // 고시문의 위치 지번들 + 목표 면적 → 지번들을 감싼 범위를 넓혀 가며 면적이 맞는 구역을 추정
  async estimateFromAnchors(items, base, target, opts) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 합니다.'; return; }
    if (!ZoneKit.items(items).length || !(target > 0)) { msg.textContent = '위치 지번(한 줄에 하나)과 목표 면적(㎡)을 넣어 주세요.'; return; }
    this.askClearSample();
    this.remember('위치 지번+면적으로 구역 추정');
    this._noHist = true;
    const r = await ZoneKit.roughFromAnchors(items, base, target, opts.threshold || 0.5, t => { msg.textContent = t; });
    if (!r.rough) { this._noHist = false; msg.textContent = '위치 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'; return; }
    S.area.geojson = r.rough;
    this.items.clearLayers();
    L.geoJSON(r.rough).eachLayer(l => this.items.addLayer(l));
    try { await this.snapToParcels(opts); } finally { this._noHist = false; }
    const diff = (S.area.drawnArea / target - 1) * 100;
    msg.insertAdjacentHTML('afterbegin', `<b>추정 구역</b>: 위치 지번 ${r.pts.length}개를 감싼 범위를 ${fmt(r.d)}m 넓혀 목표 면적 ${fmt(target, 1)}㎡에 맞췄습니다 (차이 ${diff >= 0 ? '+' : ''}${fmt(diff, 1)}%). 경계는 추정이니 필지 선택으로 넣고 빼며 다듬으세요.`
      + (r.miss.length ? ` 못 찾은 지번: ${r.miss.map(esc).join(', ')}.` : '') + '<br>');
  },

  // 대략 그린 구역 → 필지 경계에 맞춘 구역계
  // 필지 면적의 threshold(기본 50%) 이상이 그린 범위 안이면 포함. 걸친 필지는 대조표에 '경계 필지'로
  async snapToParcels(opts) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 필지에 맞출 수 있습니다.'; return; }
    if (!S.area.geojson) { msg.textContent = '먼저 지도 왼쪽 다각형 도구로 구역을 대략 그려 주세요.'; return; }
    this.askClearSample();
    if (!this._noHist) this.remember('그린 구역을 필지에 맞추기');
    const rough = JSON.parse(JSON.stringify(S.area.geojson));
    let r;
    try { r = await ZoneKit.snapPick(rough, opts.threshold || 0.5, t => { msg.textContent = t; }); }
    catch (e) { msg.textContent = '필지를 불러오지 못했습니다: ' + e.message; return; }
    // 대략 그린 선은 점선으로 남겨 비교할 수 있게
    if (this.roughLayer) this.roughLayer.remove();
    this.roughLayer = L.geoJSON(rough, { style: { color: '#555', weight: 2, dashArray: '6 6', fill: false }, interactive: false }).addTo(this.map);
    await this.buildZone(r.found, r.report, { ...opts, boundary: r.boundary }, `그린 범위에 걸친 필지 ${r.report.length}개 → `);
  },

  // 고른 필지들로 구역계를 만들고(블록 사이 도로 잇기·갇힌 필지 포함) 조서·대조표까지
  // found: pnu → 필지, report: 대조표 행, intro: 결과 문구 앞부분
  async buildZone(found, report, opts, intro) {
    const msg = $('#jibunMsg');
    if (!found.size) { msg.textContent = '구역에 넣을 필지가 없습니다.'; this.showReport(report); return; }
    let res;
    try { res = await ZoneKit.assemble(found, report, opts, t => { msg.textContent = t; }); }
    catch (e) { msg.textContent = '필지 경계를 합치는 중 오류가 났습니다.'; return; }
    const { merged, partial, enclosed } = res;

    this.items.clearLayers();
    L.geoJSON(merged, { style: ZONE_STYLE }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    this.save();
    // 조서: 구역 안 필지·건축물 불러오기 (확인 창 없이)
    S.lands = S.lands.filter(l => !l.pnu);
    S.buildings = S.buildings.filter(b => !b.auto);
    await this.importArea({ silent: true });   // 성공하면 importedKey도 이 구역으로 맞춰짐
    // 일부만 편입된 도로는 편입비율로 조서에 넣음 (조서 면적 = 대장 면적 × 편입비율)
    const partLands = partial.filter(p => p.isPart).map(p => {
      const land = landFromFeature(p.f, p.part);
      land.geom = p.piece.geometry;   // 지도에는 편입된 부분만
      const i = S.lands.findIndex(l => l.pnu === land.pnu);
      if (i >= 0) S.lands[i] = land; else S.lands.push(land);
      return land;
    });
    await this.fillLedger(partLands, t => { msg.textContent = t; });
    S.lands.forEach(l => {
      if (enclosed.has(l.pnu)) l.enclosed = true;
      if (opts.boundary && opts.boundary.has(l.pnu)) l.boundary = opts.boundary.get(l.pnu);
    });
    App.update(true);
    msg.innerHTML = ZoneKit.summary(report, merged, intro).replace('로 구역계를 그렸습니다.', '로 구역계를 그리고 조서를 불러왔습니다.').replace('필지 대조표를 보세요', '아래 대조표를 보세요');
    this.showReport(report);
  },

  // 입력 지번 대조표
  showReport(report) {
    this.lastReport = report;
    const rows = ZoneKit.reportRows(report);
    const cls = r => ZoneKit.reportClass(r);
    $('#jibunReport').innerHTML = `
      <div class="report-head"><b>필지 대조표</b> <button class="btn small" id="btnReportXlsx">엑셀 저장</button></div>
      <div class="table-wrap"><table class="grid"><thead><tr><th>입력</th><th>결과</th><th>필지</th><th>지목</th><th class="num">면적(㎡)</th><th>비고</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${esc(r.input || '–')}</td><td class="${cls(r.result)}">${esc(r.result)}</td><td>${esc(r.jibun)}</td><td>${esc(r.jimok)}</td><td class="num">${r.area === '' ? '' : fmt(r.area, 1)}</td><td>${esc(r.note)}</td></tr>`).join('')}
      </tbody></table></div>`;
    $('#btnReportXlsx').onclick = () => {
      const ws = XLSX.utils.json_to_sheet(rows.map(r => ({ '입력 지번': r.input, '결과': r.result, '필지': r.jibun, '지목': r.jimok, '면적(㎡)': r.area, '비고': r.note })));
      ws['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 50 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '필지대조표');
      XLSX.writeFile(wb, `${S.meta.name || '정비사업'}_필지대조표.xlsx`);
    };
  },

  // 검색 결과 위치로 이동하고 표시. r: { lat, lon, label, precise }
  goTo(r) {
    this.map.setView([r.lat, r.lon], r.precise ? 18 : 16);
    if (this.marker) this.marker.remove();
    this.marker = L.circleMarker([r.lat, r.lon], { radius: 8, color: '#2563eb', weight: 3, fillOpacity: 0.3 })
      .addTo(this.map)
      .bindTooltip(r.label, { direction: 'top' });
  },

  async searchVWorld(q) {
    // 도로명(…로/…길 + 번호)이면 도로명 주소, 아니면 지번 주소 → 그래도 없으면 장소명
    const isRoad = /(로|길)\s*\d/.test(q);
    let list = await VWorld.search(q, 'address', isRoad ? 'road' : 'parcel');
    if (!list.length) list = await VWorld.search(q, 'address', isRoad ? 'parcel' : 'road');
    if (!list.length) list = await VWorld.search(q, 'place');
    return list;
  },

  async searchOSM(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=kr&limit=6&q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: { 'Accept-Language': 'ko' } });
    return (await res.json()).map(r => ({
      lat: +r.lat, lon: +r.lon,
      precise: !!(r.address && r.address.house_number),
      label: r.display_name.split(',').slice(0, 3).join(','),
      sub: r.display_name,
    }));
  },

  async search(q) {
    const out = $('#searchResults');
    q = q.trim();
    if (!q) return;
    if (!this.map) this.init();
    out.innerHTML = '<li class="muted">검색 중…</li>';
    let list = [], usedOSM = false;
    try {
      if (VWorld.enabled) {
        try { list = await this.searchVWorld(q); } catch (e) { console.warn('VWorld 검색 실패', e); }
      }
      if (!list.length) { list = await this.searchOSM(q); usedOSM = true; }
    } catch (e) {
      out.innerHTML = '<li class="muted">검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</li>';
      return;
    }
    if (!list.length) { out.innerHTML = '<li class="muted">검색 결과가 없습니다. "○○구 ○○동 123-4"처럼 지번 주소나 도로명 주소로 다시 검색해 보세요.</li>'; return; }

    // 첫 번째 결과로 바로 이동하고, 위치·용도지역을 개요에 자동 기록
    this.goTo(list[0]);
    Auto.location(list[0]);
    out.innerHTML = '';
    // 번지까지 쳤는데 정확한 위치를 찾지 못한 경우 알림
    const askedNumber = /\d+(-\d+)?\s*(번지)?\s*$/.test(q);
    if (usedOSM && askedNumber && !list[0].precise) {
      out.insertAdjacentHTML('beforeend', `<li class="muted warn-note">입력한 번지를 지도에서 찾지 못해 <b>${esc(list[0].label.split(',')[0])}</b> 일대로 이동했습니다. 지도를 확대해 직접 위치를 찾아 주세요.</li>`);
    }
    // 첫 결과와 거의 같은 위치(같은 건물의 상호 등)는 빼고 보여줌
    const first = L.latLng(list[0].lat, list[0].lon);
    const others = list.slice(1).filter(r => first.distanceTo([r.lat, r.lon]) > 100);
    if (others.length) {
      out.insertAdjacentHTML('beforeend', '<li class="muted">다른 검색 결과:</li>');
      others.forEach(r => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.textContent = r.sub ? `${r.label} (${r.sub})` : r.label;
        b.onclick = () => this.goTo(r);
        li.append(b);
        out.append(li);
      });
    }
  },

  exportGeoJSON() {
    if (!S.area.geojson) { alert('먼저 지도에 구역계를 그려 주세요.'); return; }
    download((S.meta.name || '구역계') + '.geojson', JSON.stringify(S.area.geojson, null, 2), 'application/geo+json');
  },
};
