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

    this.map.on(L.Draw.Event.CREATED, e => { this.items.clearLayers(); this.items.addLayer(e.layer); this.save(); });
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
      this.drawParcels();
      App.update(true);
    } catch (e) {
      msg.textContent = '필지 조회에 실패했습니다: ' + e.message + ' (인증키와 등록한 서비스 URL을 확인하세요)';
    }
  },

  // 선택한 필지들을 합쳐 구역계로
  parcelsToArea() {
    const polys = S.lands.filter(l => l.geom).map(l => ({ type: 'Feature', properties: {}, geometry: l.geom }));
    if (!polys.length) { alert('먼저 "필지 선택"을 켜고 지도에서 필지를 눌러 추가하세요.'); return; }
    if (S.area.geojson && !confirm('지금 그려진 구역계를 선택한 필지 경계로 바꿀까요?')) return;
    let merged = polys[0];
    try {
      for (let i = 1; i < polys.length; i++) merged = turf.union(merged, polys[i]) || merged;
    } catch (e) {
      alert('필지 경계를 합치는 중 오류가 났습니다. 필지가 서로 붙어 있는지 확인해 주세요.');
      return;
    }
    this.items.clearLayers();
    L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => this.items.addLayer(l));
    this.map.fitBounds(this.items.getBounds(), { padding: [30, 30] });
    S.area.mode = 'drawn';
    this.save();
  },

  // 지번 목록 → 필지를 찾아 합쳐서 구역계를 그리고, 조서까지 불러옴
  // base: "인천광역시 남동구 간석동" 처럼 지번 앞에 붙일 동 주소
  async zoneFromJibuns(items, base) {
    const msg = $('#jibunMsg');
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 지번으로 필지를 찾을 수 있습니다.'; return; }
    items = [...new Set(items.map(s => String(s).trim()).filter(s => /\d/.test(s)))];
    if (!items.length) { msg.textContent = '지번이 없습니다. 한 줄에 하나씩 넣어 주세요. 예: 387, 388-1, 산12'; return; }
    if (S.area.geojson && !confirm('지금 그려진 구역계를 지번 목록의 필지로 바꿀까요?')) return;

    const found = new Map(), fails = [];
    // 동·리 이름이 들어 있으면 그대로, 숫자만 있으면 기준 동을 앞에 붙임
    const query = it => (/[가-힣]+(동|리|가)\s*(산\s*)?\d/.test(it) || /[가-힣]+(시|군|구)\s/.test(it) ? it : `${base} ${it}`.trim());
    const norm = s => String(s).replace(/번지/g, '').replace(/.*[가-힣](동|리|가)\s*/, '').replace(/\s/g, '');
    let done = 0;
    const work = async it => {
      try {
        const list = await VWorld.search(query(it), 'address', 'parcel');
        const f = list.length ? await VWorld.parcelAt(list[0].lat, list[0].lon) : null;
        const no = f ? splitJibun(f.properties.jibun).no : '';
        if (!f || no !== norm(it)) fails.push(it + (f ? ` (→ ${no})` : ''));
        if (f) found.set(f.properties.pnu, f);
      } catch (e) { fails.push(it); }
      done++;
      msg.textContent = `필지를 찾는 중… ${done}/${items.length}`;
    };
    // 브이월드에 무리가 가지 않게 4개씩 동시에
    const queue = items.slice();
    await Promise.all([1, 2, 3, 4].map(async () => { while (queue.length) await work(queue.shift()); }));

    const feats = [...found.values()];
    if (!feats.length) { msg.textContent = '필지를 하나도 찾지 못했습니다. 기준 동 주소를 확인해 주세요.'; return; }
    let merged = feats[0];
    try { for (let i = 1; i < feats.length; i++) merged = turf.union(merged, feats[i]) || merged; }
    catch (e) { msg.textContent = '필지 경계를 합치는 중 오류가 났습니다.'; return; }
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
    const parts = g.type === 'MultiPolygon' ? g.coordinates.length : 1;
    msg.innerHTML = `지번 ${items.length}개 중 <b>${feats.length}필지</b>로 구역계를 그리고 조서를 불러왔습니다.`
      + (parts > 1 ? ` 구역이 ${parts}덩어리로 떨어져 있습니다.` : '')
      + (fails.length ? `<br><b class="warn">확인 필요 ${fails.length}건:</b> ${fails.map(esc).join(', ')}` : '');
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
