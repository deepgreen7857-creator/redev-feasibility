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

  // 한 점을 포함하는 필지(연속지적도) 조회
  async parcelAt(lat, lon) {
    const d = await jsonp('https://api.vworld.kr/req/data', {
      service: 'data', request: 'GetFeature', data: 'LP_PA_CBND_BUBUN', key: this.key, domain: this.domain,
      geomFilter: `POINT(${lon} ${lat})`, geometry: 'true', attribute: 'true', crs: 'EPSG:4326',
      format: 'json', errorformat: 'json', size: 1, page: 1,
    });
    const r = d && d.response;
    if (!r || r.status !== 'OK') {
      if (r && r.status === 'ERROR') throw new Error((r.error && r.error.text) || 'VWorld 오류');
      return null;
    }
    return r.result.featureCollection.features[0] || null;
  },
};

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
    this.map = L.map('map', { maxZoom: 19 }).setView(a.center, a.zoom);

    const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors',
    });
    if (VWorld.enabled) {
      const k = VWorld.key;
      const attr = '&copy; <a href="https://www.vworld.kr">VWorld</a>';
      const base = L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Base/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 19, attribution: attr });
      const sat = L.layerGroup([
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Satellite/{z}/{y}/{x}.jpeg`, { minZoom: 6, maxZoom: 19, attribution: attr }),
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${k}/Hybrid/{z}/{y}/{x}.png`, { minZoom: 6, maxZoom: 19 }),
      ]);
      const cadastral = L.tileLayer.wms('https://api.vworld.kr/req/wms', {
        // 기본 스타일은 주황 경계선 + 지번 표시. _line 스타일은 연노랑이라 배경지도 위에서 안 보임.
        layers: 'lp_pa_cbnd_bubun',
        styles: 'lp_pa_cbnd_bubun',
        format: 'image/png', transparent: true, version: '1.3.0',
        // WMS는 domain 값을 함께 보내면 INCORRECT_KEY로 거절됨. 브라우저가 보내는 Referer로 확인함.
        minZoom: 16, maxZoom: 19, key: k,
      });
      base.addTo(this.map);
      cadastral.addTo(this.map);
      L.control.layers(
        { '브이월드 지도': base, '위성사진': sat, 'OpenStreetMap': osm },
        { '지적도 (16레벨 이상 확대 시)': cadastral },
        { collapsed: false, position: 'topright' },
      ).addTo(this.map);
    } else {
      osm.addTo(this.map);
    }

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
    }
    App.update(true);
  },

  setPicking(on) {
    this.picking = on;
    if (this.map) this.map.getContainer().classList.toggle('picking', on);
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
      const sp = splitJibun(p.jibun);
      const no = sp.no;
      const jimok = sp.jimok === '임' ? '임야' : sp.jimok;
      if (idx >= 0) {
        S.lands.splice(idx, 1);
        msg.textContent = `${no} 필지를 토지조서에서 뺐습니다.`;
      } else {
        const area = window.turf ? Math.round(turf.area(f) * 10) / 10 : 0;
        const publicJimok = ['도', '구', '천', '제', '공'];
        S.lands.push({
          id: uid(), pnu: p.pnu || '', jibun: no,
          jimok: JIMOK.includes(jimok) ? jimok : (jimok || '기타'),
          area, ownerType: publicJimok.includes(jimok) ? '국공유지' : '사유지', owner: '',
          price: num(p.jiga), geom: f.geometry,
        });
        msg.textContent = `${p.addr || no} 추가 · ${fmt(area, 1)}㎡ · 공시지가 ${p.jiga ? fmt(num(p.jiga)) + '원/㎡' : '정보 없음'}`;
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

    // 첫 번째 결과로 바로 이동
    this.goTo(list[0]);
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
