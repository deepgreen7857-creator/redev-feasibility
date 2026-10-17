'use strict';

// 구역계 지도 (Leaflet + Leaflet.draw, 배경지도는 OpenStreetMap)
const MapView = {
  map: null,
  items: null,

  init() {
    if (this.map) { setTimeout(() => this.map.invalidateSize(), 50); return; }
    if (!window.L || !L.Control.Draw) {
      $('#map').innerHTML = '<p class="map-error">지도 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.</p>';
      return;
    }
    const a = S.area;
    this.map = L.map('map').setView(a.center, a.zoom);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

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

  async search(q) {
    const out = $('#searchResults');
    if (!q.trim()) return;
    out.innerHTML = '<li class="muted">검색 중…</li>';
    try {
      const url = 'https://nominatim.openstreetmap.org/search?format=json&countrycodes=kr&limit=6&q=' + encodeURIComponent(q);
      const res = await fetch(url, { headers: { 'Accept-Language': 'ko' } });
      const list = await res.json();
      if (!list.length) { out.innerHTML = '<li class="muted">검색 결과가 없습니다. 동 이름이나 도로명으로 다시 검색해 보세요.</li>'; return; }
      out.innerHTML = '';
      list.forEach(r => {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.textContent = r.display_name;
        b.onclick = () => { this.map.setView([+r.lat, +r.lon], 17); out.innerHTML = ''; };
        li.append(b);
        out.append(li);
      });
    } catch (e) {
      out.innerHTML = '<li class="muted">검색에 실패했습니다. 잠시 후 다시 시도해 주세요.</li>';
    }
  },

  exportGeoJSON() {
    if (!S.area.geojson) { alert('먼저 지도에 구역계를 그려 주세요.'); return; }
    download((S.meta.name || '구역계') + '.geojson', JSON.stringify(S.area.geojson, null, 2), 'application/geo+json');
  },
};
