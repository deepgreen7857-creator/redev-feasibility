'use strict';

// 브이월드 API는 브라우저에서 직접 fetch하면 CORS로 막혀서 JSONP(callback)로 호출
function jsonp(url, params, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const cb = '__vw' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = data => { cleanup(); resolve(data); };
    s.src = url + '?' + new URLSearchParams({ ...params, callback: cb });
    s.onerror = () => { cleanup(); reject(new Error('load')); };
    document.head.append(s);
  });
}

const VWorld = {
  get enabled() { return typeof VWORLD_KEY === 'string' && VWORLD_KEY.trim() !== ''; },
  get key() { return VWORLD_KEY.trim(); },
  get domain() { return location.origin; },

  // 주소 검색. category: 'parcel'(지번) | 'road'(도로명), type: 'address' | 'place'
  async search(query, type = 'address', category = 'parcel') {
    const p = {
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326',
      size: 8, page: 1, query, type, format: 'json', errorformat: 'json', key: this.key, domain: this.domain,
    };
    if (type === 'address') p.category = category;
    const d = await jsonp('https://api.vworld.kr/req/search', p);
    const r = d && d.response;
    if (!r || r.status !== 'OK') {
      if (r && r.status === 'ERROR') throw new Error((r.error && r.error.text) || 'VWorld 오류');
      return [];
    }
    return (r.result.items || []).map(it => ({
      lat: +it.point.y, lon: +it.point.x, precise: true,
      label: it.title || (category === 'road' ? it.address.road : it.address.parcel) || it.address.road || it.address.parcel,
      sub: type === 'place' ? (it.address.road || it.address.parcel) : (category === 'road' ? it.address.parcel : it.address.road),
    }));
  },

  // 2D 데이터 API 한 페이지 조회. data: LP_PA_CBND_BUBUN(연속지적도), LT_C_UQ111(용도지역), LT_C_BLDGINFO(GIS건물통합정보)
  async dataPage(data, geomFilter, page = 1, size = 1000, geometry = true) {
    const d = await jsonp('https://api.vworld.kr/req/data', {
      service: 'data', request: 'GetFeature', data, key: this.key, domain: this.domain,
      geomFilter, geometry: String(geometry), attribute: 'true', crs: 'EPSG:4326',
      format: 'json', errorformat: 'json', size, page,
    }, 20000);
    const r = d && d.response;
    if (!r || r.status === 'NOT_FOUND') return { features: [], pages: 0 };
    if (r.status !== 'OK') throw new Error((r.error && r.error.text) || 'VWorld 오류');
    return { features: r.result.featureCollection.features || [], pages: +(r.page && r.page.total) || 1 };
  },

  // 범위 안의 모든 객체 (여러 페이지)
  async dataAll(data, geomFilter, maxPages = 10) {
    const first = await this.dataPage(data, geomFilter, 1);
    let all = first.features;
    for (let p = 2; p <= Math.min(first.pages, maxPages); p++) all = all.concat((await this.dataPage(data, geomFilter, p)).features);
    return all;
  },

  // 한 점을 포함하는 필지(연속지적도) 조회
  async parcelAt(lat, lon) {
    return (await this.dataPage('LP_PA_CBND_BUBUN', `POINT(${lon} ${lat})`, 1, 1)).features[0] || null;
  },

  // 한 점의 용도지역 이름 (예: 제2종일반주거지역)
  async zoningAt(lat, lon) {
    const fs = (await this.dataPage('LT_C_UQ111', `POINT(${lon} ${lat})`, 1, 10, false)).features;
    const f = fs.find(x => x.properties && x.properties.uname);
    return f ? f.properties.uname : '';
  },

  // 범위(bbox) 안에 걸친 용도지역 이름 목록
  async zoningsInBox(b) {
    const fs = (await this.dataPage('LT_C_UQ111', `BOX(${b.join(',')})`, 1, 100, false)).features;
    return [...new Set(fs.map(f => f.properties && f.properties.uname).filter(Boolean))];
  },
};

// GIS건물통합정보 → 건축물조서 한 행
// usability: 건축물대장 주용도코드, strct_cd: 구조코드 (1x 조적, 2x 철근콘크리트, 3x 철골, 4x 철골철근콘크리트, 5x 목구조)
function buildingFromFeature(f, jibun, pnu) {
  const p = f.properties || {};
  const code = String(p.usability || '');
  const floors = num(p.grnd_flr);
  const floorArea = Math.round(num(p.totalarea) * 10) / 10;
  let use = '기타', guessed = false;
  if (code === '01003') use = '다가구주택';
  else if (code.startsWith('01')) use = '단독주택';
  else if (code === '02001') use = '아파트';
  else if (code === '02002') use = '연립주택';
  else if (code === '02003') use = '다세대주택';
  else if (code.startsWith('02')) {
    // 공동주택 세부 용도가 없으면 층수·면적으로 추정 (5층 이상 아파트, 660㎡ 초과 연립, 이하 다세대)
    use = floors >= 5 ? '아파트' : floorArea > 660 ? '연립주택' : '다세대주택';
    guessed = true;
  } else if (code.startsWith('03') || code.startsWith('04')) use = '근린생활시설';
  const s = String(p.strct_cd || '').charAt(0);
  const structure = s === '1' ? '조적' : s === '2' || s === '4' ? '철근콘크리트' : s === '3' ? '철골' : s === '5' ? '목조' : '기타';
  const year = num(String(p.useapr_day || '').slice(0, 4));
  const isApt = ['아파트', '연립주택', '다세대주택'].includes(use);
  return {
    id: uid(), jibun: jibun || '', use, structure, year, floorArea,
    units: isApt ? 0 : (use === '단독주택' || use === '다가구주택' ? 1 : 0),
    name: p.bld_nm || '', floors, pnu: pnu || '', auto: true, needUnits: isApt, guessed,
    aprDate: /^\d{8}$/.test(String(p.useapr_day || '')) ? `${String(p.useapr_day).slice(0, 4)}-${String(p.useapr_day).slice(4, 6)}-${String(p.useapr_day).slice(6, 8)}` : '',
    basement: num(p.ugrnd_flr),
    noInfo: !year && !floorArea && !code,
  };
}

// 필지 여러 개를 하나로 합침. 연속지적도는 이웃 필지 경계 좌표가 미세하게 어긋나 있어
// 그냥 합치면 계산이 실패하는 경우가 있음 → 좌표 정리(1cm) → 살짝 부풀려 합치기 → 그래도 안 되면 따로 둠
function safeUnion2(a, b) {
  try { const u = turf.union(a, b); if (u) return u; } catch (e) { /* 아래에서 다시 시도 */ }
  try { const u = turf.union(turf.truncate(a, { precision: 7 }), turf.truncate(b, { precision: 7 })); if (u) return u; } catch (e) { /* 다음 */ }
  try {
    const grow = f => turf.buffer(turf.truncate(f, { precision: 7 }), 0.02, { units: 'meters' });
    const u = turf.union(grow(a), grow(b)); if (u) return u;
  } catch (e) { /* 다음 */ }
  // 마지막: 합치지 않고 두 도형을 한 묶음(MultiPolygon)으로
  const polys = f => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates);
  return turf.multiPolygon([...polys(a), ...polys(b)]);
}
// 반씩 나눠 합치면 빠르고, 한 번의 실패가 전체로 번지지 않음
function safeUnion(fs) {
  fs = fs.filter(Boolean);
  if (!fs.length) return null;
  while (fs.length > 1) {
    const next = [];
    for (let i = 0; i < fs.length; i += 2) next.push(i + 1 < fs.length ? safeUnion2(fs[i], fs[i + 1]) : fs[i]);
    fs = next;
  }
  return fs[0];
}

// 연속지적도 객체 → 토지조서 한 행
function landFromFeature(f) {
  const p = f.properties || {};
  const sp = splitJibun(p.jibun);
  const jimok = sp.jimok === '임' ? '임야' : sp.jimok;
  const publicJimok = ['도', '구', '천', '제', '공'];
  return {
    id: uid(), pnu: p.pnu || '', jibun: sp.no,
    jimok: JIMOK.includes(jimok) ? jimok : (jimok || '기타'),
    area: window.turf ? Math.round(turf.area(f) * 10) / 10 : 0,
    ownerType: publicJimok.includes(jimok) ? '국공유지' : '사유지', owner: '',
    price: num(p.jiga), geom: f.geometry,
    addr: p.addr || '', priceYear: p.gosi_year || '',
  };
}

// 연속지적도 jibun 값은 "233-42대", "산12-3임" 형태
function splitJibun(s) {
  const m = String(s || '').trim().match(/^(산?\s*[\d-]+)\s*(\D*)$/);
  return m ? { no: m[1].replace(/\s/g, ''), jimok: m[2] || '' } : { no: String(s || ''), jimok: '' };
}

// 구역계 지도 (Leaflet + Leaflet.draw)
const MapView = {
  map: null,
  items: null,
  parcels: null,
  picking: false,

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

    this.parcels = L.featureGroup().addTo(this.map);
    this.items = new L.FeatureGroup().addTo(this.map);
    // showArea는 leaflet.draw 1.0.4 + Leaflet 1.9 조합에서 오류가 나서 끔. 면적은 turf로 계산.
    this.map.addControl(new L.Control.Draw({
      position: 'topleft',
      draw: {
        polygon: { allowIntersection: false, showArea: false, shapeOptions: { color: '#d9480f', weight: 3 } },
        rectangle: { showArea: false, shapeOptions: { color: '#d9480f', weight: 3 } },
        polyline: false, circle: false, marker: false, circlemarker: false,
      },
      edit: { featureGroup: this.items },
    }));

    this.map.on(L.Draw.Event.CREATED, e => { if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; } this.items.clearLayers(); this.items.addLayer(e.layer); this.save(); });
    this.map.on(L.Draw.Event.EDITED, () => this.save());
    this.map.on(L.Draw.Event.DELETED, () => this.save());
    // 그리기 중에는 필지 선택이 끼어들지 않도록
    this.map.on(L.Draw.Event.DRAWSTART, () => { this.drawing = true; });
    this.map.on(L.Draw.Event.DRAWSTOP, () => { this.drawing = false; });
    this.map.on('click', e => { if (this.picking && !this.drawing) this.pick(e.latlng); });
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
      L.geoJSON(S.area.geojson, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
      this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    } else {
      this.map.setView(S.area.center, S.area.zoom);
    }
    this.drawParcels();
  },

  // 토지조서에 들어간 필지 중 경계가 있는 것을 지도에 표시
  drawParcels() {
    if (!this.parcels) return;
    this.parcels.clearLayers();
    S.lands.filter(l => l.geom).forEach(l => {
      L.geoJSON(l.geom, { style: { color: '#2563eb', weight: 2, fillOpacity: 0.18 } })
        .bindTooltip(`${l.jibun} ${l.jimok} · ${fmt(num(l.area), 1)}㎡`)
        .addTo(this.parcels);
    });
  },

  save() {
    const layers = this.items.getLayers();
    if (!layers.length) {
      S.area.geojson = null;
      S.area.drawnArea = 0;
    } else {
      const gj = layers[0].toGeoJSON();
      S.area.geojson = gj;
      S.area.drawnArea = window.turf ? turf.area(gj) : 0;
      if (S.area.mode !== 'manual') S.area.mode = 'drawn';
      // 구역이 정해지면 그 안의 용도지역을 자동으로 채움
      if (VWorld.enabled && window.turf) {
        const pt = turf.pointOnFeature(gj).geometry.coordinates;
        Auto.zoning(pt[1], pt[0], turf.bbox(gj));
        Auto.locationFromParcel(pt[1], pt[0], true);
      }
    }
    App.update(true);
  },

  // 구역계 안의 필지·건축물을 한꺼번에 토지조서·건축물조서로 불러오기
  async importArea() {
    const msg = $('#pickMsg');
    if (!S.area.geojson) { alert('먼저 지도에 구역계를 그려 주세요.'); return; }
    const autoLands = S.lands.filter(l => l.pnu).length;
    const autoBldgs = S.buildings.filter(b => b.auto).length;
    if ((autoLands || autoBldgs) && !confirm(`이미 지도에서 불러온 필지 ${autoLands}개, 건축물 ${autoBldgs}동이 있습니다. 구역계 기준으로 다시 불러올까요?\n(직접 입력한 행은 그대로 둡니다)`)) return;
    const zone = S.area.geojson;
    const box = `BOX(${turf.bbox(zone).join(',')})`;
    const inZone = f => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), zone); } catch (e) { return false; } };
    try {
      msg.textContent = '구역 안 필지를 불러오는 중…';
      const parcels = (await VWorld.dataAll('LP_PA_CBND_BUBUN', box)).filter(inZone);
      msg.textContent = `필지 ${parcels.length}개 확인. 건축물을 불러오는 중…`;
      const bldgs = (await VWorld.dataAll('LT_C_BLDGINFO', box)).filter(inZone);

      // 지도로 불러온 기존 행은 교체, 직접 입력한 행은 유지
      S.lands = S.lands.filter(l => !l.pnu);
      S.buildings = S.buildings.filter(b => !b.auto);
      parcels.forEach(f => S.lands.push(landFromFeature(f)));
      bldgs.forEach(f => {
        const owner = parcels.find(pf => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), pf); } catch (e) { return false; } });
        const pp = owner ? owner.properties : {};
        S.buildings.push(buildingFromFeature(f, splitJibun(pp.jibun).no, pp.pnu));
      });
      S.area.mode = S.area.mode === 'manual' ? 'manual' : 'drawn';
      const need = S.buildings.filter(b => b.needUnits).length;
      const noInfo = S.buildings.filter(b => b.noInfo).length;
      msg.textContent = `필지 ${parcels.length}개, 건축물 ${bldgs.length}동을 불러왔습니다.`
        + (need ? ` 공동주택 ${need}동은 세대수를 확인해 입력하세요.` : '')
        + (noInfo ? ` ${noInfo}동은 용도·사용승인일 정보가 없어 건축물대장 확인이 필요합니다.` : '');
      this.drawParcels();
      App.update(true);
    } catch (e) {
      msg.textContent = '불러오기에 실패했습니다: ' + e.message;
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
    msg.textContent = '필지 정보를 불러오는 중…';
    try {
      const f = await VWorld.parcelAt(latlng.lat, latlng.lng);
      if (!f) { msg.textContent = '이 위치에서 필지를 찾지 못했습니다.'; return; }
      const p = f.properties || {};
      const idx = S.lands.findIndex(l => l.pnu && l.pnu === p.pnu);
      const no = splitJibun(p.jibun).no;
      if (idx >= 0) {
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
        msg.textContent = `${p.addr || no} 추가 · ${fmt(land.area, 1)}㎡ · 공시지가 ${p.jiga ? fmt(num(p.jiga)) + '원/㎡' : '정보 없음'} · 건축물 ${added}동`;
        if (!S.meta.zoning || S.meta.zoningAuto) Auto.zoning(latlng.lat, latlng.lng);
      }
      // 구역계에도 넣고 빼기
      if (!$('#pickZone') || $('#pickZone').checked) this.toggleZoneParcel(f, idx < 0);
      this.drawParcels();
      App.update(true);
    } catch (e) {
      msg.textContent = '필지 조회에 실패했습니다: ' + e.message + ' (인증키와 등록한 서비스 URL을 확인하세요)';
    }
  },

  // 필지 하나를 구역계에 더하거나(add=true) 뺌
  toggleZoneParcel(f, add) {
    const zone = S.area.geojson;
    let next = null;
    if (add) next = zone ? safeUnion([zone, f]) : f;
    else if (zone) {
      try { next = turf.difference(zone, f); }
      catch (e) { try { next = turf.difference(turf.truncate(zone, { precision: 7 }), turf.truncate(f, { precision: 7 })); } catch (e2) { next = zone; } }
    }
    this.items.clearLayers();
    if (next) L.geoJSON(next, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
    if (S.area.mode !== 'manual') S.area.mode = 'drawn';
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
    if (this.roughLayer) { this.roughLayer.remove(); this.roughLayer = null; }
    this.items.clearLayers();
    L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    S.area.mode = 'drawn';
    this.save();
    $('#jibunMsg').textContent = `구역계 파일을 불러왔습니다 (${fmt(turf.area(merged))}㎡). 필지 경계에 맞추려면 "그린 구역을 필지에 맞추기"를 누르세요.`;
  },

  // 선택한 필지들을 합쳐 구역계로
  parcelsToArea() {
    const polys = S.lands.filter(l => l.geom).map(l => ({ type: 'Feature', properties: {}, geometry: l.geom }));
    if (!polys.length) { alert('먼저 "필지 선택"을 켜고 지도에서 필지를 눌러 추가하세요.'); return; }
    if (S.area.geojson && !confirm('지금 그려진 구역계를 선택한 필지 경계로 바꿀까요?')) return;
    const merged = safeUnion(polys);
    this.items.clearLayers();
    L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    S.area.mode = 'drawn';
    this.save();
  },

  // 지번 목록 → 필지를 찾아 합쳐서 구역계를 그리고, 조서까지 불러옴
  // base: "인천광역시 남동구 간석동" 처럼 지번 앞에 붙일 동 주소
  // opts.fillHoles: 구역 안에 둘러싸인 필지(도로 등) 자동 포함, opts.bridge: 떨어진 덩어리 사이 도로 잇기
  async zoneFromJibuns(items, base, opts = { fillHoles: true, bridge: true }) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 지번으로 필지를 찾을 수 있습니다.'; return; }
    items = [...new Set(items.map(s => String(s).trim()).filter(s => /\d/.test(s)))];
    if (!items.length) { msg.textContent = '지번이 없습니다. 한 줄에 하나씩 넣어 주세요. 예: 387, 388-1, 산12'; return; }
    if (S.area.geojson && !confirm('지금 그려진 구역계를 지번 목록의 필지로 바꿀까요?')) return;

    const report = [];            // 대조표 행
    const found = new Map();      // pnu → 필지
    // 동·리 이름이 들어 있으면 그대로, 숫자만 있으면 기준 동을 앞에 붙임
    const query = it => (/[가-힣]+(동|리|가)\s*(산\s*)?\d/.test(it) || /[가-힣]+(시|군|구)\s/.test(it) ? it : `${base} ${it}`.trim());
    const norm = s => String(s).replace(/번지/g, '').replace(/.*[가-힣](동|리|가)\s*/, '').replace(/\s/g, '');
    const area1 = f => Math.round(turf.area(f) * 10) / 10;
    let done = 0;
    const work = async it => {
      try {
        const list = await VWorld.search(query(it), 'address', 'parcel');
        const f = list.length ? await VWorld.parcelAt(list[0].lat, list[0].lon) : null;
        const sp = f ? splitJibun(f.properties.jibun) : null;
        if (!f) report.push({ input: it, result: '실패', jibun: '', jimok: '', area: '', note: '검색 결과 없음 – 지번·기준 동(법정동) 확인' });
        else if (sp.no !== norm(it)) report.push({ input: it, result: '확인 필요', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: `다른 지번(${sp.no})으로 검색됨 – 분할·합병·표기 확인, 구역에 넣지 않음` });
        else {
          if (!found.has(f.properties.pnu)) report.push({ input: it, result: '포함', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: '' });
          else report.push({ input: it, result: '중복', jibun: sp.no, jimok: sp.jimok, area: '', note: '같은 필지가 이미 있음' });
          found.set(f.properties.pnu, f);
        }
      } catch (e) {
        report.push({ input: it, result: '실패', jibun: '', jimok: '', area: '', note: '조회 오류: ' + e.message });
      }
      done++;
      msg.textContent = `필지를 찾는 중… ${done}/${items.length}`;
    };
    // 브이월드에 무리가 가지 않게 4개씩 동시에
    const queue = items.slice();
    await Promise.all([1, 2, 3, 4].map(async () => { while (queue.length) await work(queue.shift()); }));

    await this.buildZone(found, report, opts, `지번 ${items.length}개 → `);
  },

  // 고시문의 위치 지번들 + 목표 면적 → 지번들을 감싼 범위를 넓혀 가며 면적이 맞는 구역을 추정
  async estimateFromAnchors(items, base, target, opts) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 합니다.'; return; }
    items = [...new Set(items.map(s => String(s).trim()).filter(s => /\d/.test(s)))];
    if (!items.length || !(target > 0)) { msg.textContent = '위치 지번(한 줄에 하나)과 목표 면적(㎡)을 넣어 주세요.'; return; }
    const query = it => (/[가-힣]+(동|리|가)\s*(산\s*)?\d/.test(it) ? it : `${base} ${it}`.trim());
    const pts = [], miss = [];
    for (const it of items) {
      msg.textContent = `위치 지번을 찾는 중… ${pts.length + miss.length + 1}/${items.length}`;
      try {
        const l = await VWorld.search(query(it), 'address', 'parcel');
        if (l.length) pts.push(turf.point([l[0].lon, l[0].lat])); else miss.push(it);
      } catch (e) { miss.push(it); }
    }
    if (!pts.length) { msg.textContent = '위치 지번을 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'; return; }
    const core = pts.length >= 3 ? turf.convex(turf.featureCollection(pts)) : turf.buffer(turf.featureCollection(pts).features[0], 30, { units: 'meters' });
    msg.textContent = '주변 필지를 불러오는 중…';
    const reach = Math.sqrt(target) * 0.8;
    const big = turf.buffer(core, reach, { units: 'meters' });
    const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${turf.bbox(big).join(',')})`, 20);
    const snapped = d => {
      const rough = d > 0 ? turf.buffer(core, d, { units: 'meters' }) : core;
      let sum = 0;
      for (const f of fs) {
        const A = turf.area(f);
        if (!A) continue;
        try { const x = turf.intersect(f, rough); if (x && turf.area(x) / A >= (opts.threshold || 0.5)) sum += A; } catch (e) { /* 건너뜀 */ }
      }
      return { rough, sum };
    };
    // 넓히는 거리를 이분 탐색해 목표 면적에 맞춤
    let lo = 0, hi = reach, best = null;
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      msg.textContent = `목표 면적에 맞추는 중… (${k + 1}/9)`;
      await new Promise(r => setTimeout(r));
      const r = snapped(mid);
      if (!best || Math.abs(r.sum - target) < Math.abs(best.sum - target)) best = { ...r, d: mid };
      if (r.sum < target) lo = mid; else hi = mid;
    }
    S.area.geojson = best.rough;
    this.items.clearLayers();
    L.geoJSON(best.rough).eachLayer(l => this.items.addLayer(l));
    await this.snapToParcels(opts);
    const diff = (S.area.drawnArea / target - 1) * 100;
    msg.insertAdjacentHTML('afterbegin', `<b>추정 구역</b>: 위치 지번 ${pts.length}개를 감싼 범위를 ${fmt(best.d)}m 넓혀 목표 면적 ${fmt(target, 1)}㎡에 맞췄습니다 (차이 ${diff >= 0 ? '+' : ''}${fmt(diff, 1)}%). 경계는 추정이니 필지 선택으로 넣고 빼며 다듬으세요.`
      + (miss.length ? ` 못 찾은 지번: ${miss.map(esc).join(', ')}.` : '') + '<br>');
  },

  // 대략 그린 구역 → 필지 경계에 맞춘 구역계
  // 필지 면적의 threshold(기본 50%) 이상이 그린 범위 안이면 포함. 걸친 필지는 대조표에 '경계 필지'로
  async snapToParcels(opts) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 필지에 맞출 수 있습니다.'; return; }
    if (!S.area.geojson) { msg.textContent = '먼저 지도 왼쪽 다각형 도구로 구역을 대략 그려 주세요.'; return; }
    const rough = JSON.parse(JSON.stringify(S.area.geojson));
    const TH = opts.threshold || 0.5;
    msg.textContent = '그린 범위의 필지를 불러오는 중…';
    const [x0, y0, x1, y1] = turf.bbox(rough);
    let fs;
    try { fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0},${y0},${x1},${y1})`, 20); }
    catch (e) { msg.textContent = '필지를 불러오지 못했습니다: ' + e.message; return; }

    const found = new Map(), report = [], boundary = new Map();
    const area1 = f => Math.round(turf.area(f) * 10) / 10;
    let i = 0;
    for (const f of fs) {
      if (++i % 200 === 0) { msg.textContent = `필지 포함 여부 계산 중… ${i}/${fs.length}`; await new Promise(r => setTimeout(r)); }
      const A = turf.area(f);
      if (!A) continue;
      let ratio;
      try { const x = turf.intersect(f, rough); ratio = x ? turf.area(x) / A : 0; }
      catch (e) { try { ratio = turf.booleanPointInPolygon(turf.pointOnFeature(f), rough) ? 1 : 0; } catch (e2) { ratio = 0; } }
      if (ratio < 0.02) continue;
      const sp = splitJibun(f.properties.jibun), pct = Math.round(ratio * 100);
      if (ratio >= 0.98) {
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '포함', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: '' });
      } else if (ratio >= TH) {
        found.set(f.properties.pnu, f);
        boundary.set(f.properties.pnu, pct);
        report.push({ input: '', result: '경계 필지', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: `그린 범위 안 ${pct}% – 포함함` });
      } else {
        report.push({ input: '', result: '경계 제외', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: `그린 범위 안 ${pct}% – 제외함 (필요하면 필지 선택으로 추가)` });
      }
    }
    // 대략 그린 선은 점선으로 남겨 비교할 수 있게
    if (this.roughLayer) this.roughLayer.remove();
    this.roughLayer = L.geoJSON(rough, { style: { color: '#555', weight: 2, dashArray: '6 6', fill: false }, interactive: false }).addTo(this.map);
    await this.buildZone(found, report, { ...opts, boundary }, `그린 범위에 걸친 필지 ${report.length}개 → `);
  },

  // 고른 필지들로 구역계를 만들고(블록 사이 도로 잇기·갇힌 필지 포함) 조서·대조표까지
  // found: pnu → 필지, report: 대조표 행, intro: 결과 문구 앞부분
  async buildZone(found, report, opts, intro) {
    const msg = $('#jibunMsg');
    const area1 = f => Math.round(turf.area(f) * 10) / 10;
    let feats = [...found.values()];
    if (!feats.length) { msg.textContent = '구역에 넣을 필지가 없습니다.'; this.showReport(report); return; }

    const unionAll = fs => safeUnion(fs);
    const polysOf = g => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
    let merged;
    try { merged = unionAll(feats); } catch (e) { msg.textContent = '필지 경계를 합치는 중 오류가 났습니다.'; return; }

    // 주변 필지 (도로·둘러싸인 필지를 찾기 위해)
    let around = [];
    const enclosed = new Set();
    if (opts.fillHoles || opts.bridge) {
      msg.textContent = '주변 도로·필지를 확인하는 중…';
      const [x0, y0, x1, y1] = turf.bbox(merged), e = 30 / 88000, n = 30 / 111000;
      around = (await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`)).filter(f => !found.has(f.properties.pnu));
    }
    const ptIn = (f, poly) => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), poly); } catch (e) { return false; } };

    // 1) 떨어진 덩어리 사이를 도로·구거·하천 필지로 잇기 (구역 외곽선 안쪽 부분만)
    let partial = [];
    if (opts.bridge && merged.geometry.type === 'MultiPolygon' && merged.geometry.coordinates.length > 1) {
      const hull = turf.convex(merged);
      const parts = merged.geometry.coordinates.map(c => turf.buffer(turf.polygon(c), 1.5, { units: 'meters' }));
      const roads = around.filter(f => !found.has(f.properties.pnu) && ['도', '구', '천'].includes(splitJibun(f.properties.jibun).jimok));
      roads.forEach(f => {
        const touching = parts.filter(p => { try { return turf.booleanIntersects(p, f); } catch (e) { return false; } }).length;
        if (touching < 2) return;
        let piece = null;
        try { piece = turf.intersect(f, hull); } catch (e) { piece = null; }
        if (!piece || turf.area(piece) < 1) return;
        const sp = splitJibun(f.properties.jibun);
        const whole = area1(f), part = area1(piece);
        const isPart = part < whole * 0.98;
        partial.push({ f, piece, isPart, part });
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '도로 잇기', jibun: sp.no, jimok: sp.jimok, area: part, note: `떨어진 블록 사이 도로${isPart ? ` – 일부 편입 (전체 ${fmt(whole, 1)}㎡)` : ''}` });
      });
      if (partial.length) merged = unionAll([merged, ...partial.map(p => p.piece)]);
    }

    // 2) 구역 안에 둘러싸인 필지(구멍) 자동 포함 – 도로를 이은 뒤에 갇히는 필지도 잡도록 나중에 (10㎡ 미만 틈은 그냥 메움)
    if (opts.fillHoles) {
      const holes = polysOf(merged.geometry).flatMap(p => p.slice(1)).map(h => turf.polygon([h])).filter(h => turf.area(h) >= 10);
      const inHole = around.filter(f => !found.has(f.properties.pnu) && holes.some(h => ptIn(f, h)));
      inHole.forEach(f => {
        const sp = splitJibun(f.properties.jibun);
        found.set(f.properties.pnu, f);
        report.push({ input: '', result: '갇힌 필지', jibun: sp.no, jimok: sp.jimok, area: area1(f), note: '목록에 없지만 구역 안에 갇혀 자동 포함' });
        enclosed.add(f.properties.pnu);
      });
      if (inHole.length) merged = unionAll([merged, ...inHole]);
    }

    // 본 구역과 떨어진 100㎡ 미만 자투리 조각은 뺌
    if (merged.geometry.type === 'MultiPolygon') {
      const ps = merged.geometry.coordinates.map(c => ({ c, a: turf.area(turf.polygon(c)) }));
      const keep = ps.filter(p => p.a >= 100), drop = ps.filter(p => p.a < 100);
      if (keep.length && drop.length) {
        drop.forEach(p => report.push({ input: '', result: '경계 제외', jibun: '', jimok: '', area: Math.round(p.a * 10) / 10, note: '본 구역과 떨어진 자투리 조각이라 뺌' }));
        merged = keep.length === 1 ? turf.polygon(keep[0].c) : turf.multiPolygon(keep.map(p => p.c));
      }
    }

    // 붙어 있는 필지 사이에 생기는 아주 작은 틈(10㎡ 미만 구멍)은 메움
    const g = merged.geometry;
    const fill = poly => [poly[0], ...poly.slice(1).filter(h => turf.area(turf.polygon([h])) >= 10)];
    if (g.type === 'Polygon') g.coordinates = fill(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates = g.coordinates.map(fill);

    this.items.clearLayers();
    L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    S.area.mode = 'drawn';
    this.save();
    // 조서: 구역 안 필지·건축물 불러오기 (확인 창 없이)
    S.lands = S.lands.filter(l => !l.pnu);
    S.buildings = S.buildings.filter(b => !b.auto);
    await this.importArea();
    // 일부만 편입된 도로는 편입 면적으로 조서에 넣음
    partial.filter(p => p.isPart).forEach(p => {
      const land = landFromFeature(p.f);
      land.area = Math.round(p.part * 10) / 10;
      land.partial = true;
      land.geom = p.piece.geometry;   // 지도에는 편입된 부분만
      const i = S.lands.findIndex(l => l.pnu === land.pnu);
      if (i >= 0) S.lands[i] = land; else S.lands.push(land);
    });
    S.lands.forEach(l => {
      if (enclosed.has(l.pnu)) l.enclosed = true;
      if (opts.boundary && opts.boundary.has(l.pnu)) l.boundary = opts.boundary.get(l.pnu);
    });
    App.update(true);

    const parts = g.type === 'MultiPolygon' ? g.coordinates.length : 1;
    const cnt = r => report.filter(x => x.result === r).length;
    msg.innerHTML = `${intro}포함 <b>${cnt('포함')}필지</b>`
      + (cnt('경계 필지') ? `, 경계 필지 <b>${cnt('경계 필지')}필지</b>` : '') + (cnt('경계 제외') ? `, 경계에서 제외 ${cnt('경계 제외')}필지` : '') + (cnt('갇힌 필지') ? `, 갇힌 필지 <b>${cnt('갇힌 필지')}필지</b>` : '') + (cnt('도로 잇기') ? `, 블록 사이 도로 <b>${cnt('도로 잇기')}필지</b>` : '')
      + `로 구역계를 그리고 조서를 불러왔습니다.`
      + (parts > 1 ? ` <b class="warn">구역이 아직 ${parts}덩어리로 떨어져 있습니다.</b>` : '')
      + (cnt('실패') + cnt('확인 필요') ? `<br><b class="warn">확인 필요 ${cnt('실패') + cnt('확인 필요')}건</b> – 아래 대조표를 보세요.` : '');
    this.showReport(report);
  },

  // 입력 지번 대조표
  showReport(report) {
    this.lastReport = report;
    const order = { '실패': 0, '확인 필요': 1, '경계 필지': 2, '경계 제외': 3, '갇힌 필지': 4, '도로 잇기': 5, '포함': 6, '중복': 7 };
    const rows = report.slice().sort((a, b) => order[a.result] - order[b.result]);
    const cls = r => (r === '포함' ? 'good' : ['갇힌 필지', '도로 잇기', '경계 필지'].includes(r) ? 'auto' : r === '중복' ? '' : 'warn');
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
