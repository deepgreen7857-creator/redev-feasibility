'use strict';

// 대지 자르기 (따로 쓰는 기능): 필지를 골라 크게 확대한 뒤 선을 그어 나누고, 구역에 넣을 조각을 고름.
// 대지는 필지 경계대로가 원칙이므로 일부러 쓸 때만 동작하고, 자른 필지는 "분할 측량 필요"로 표시.
const LotCut = {
  waiting: false, lineHandler: null, f: null, pieces: [], layer: null, panel: null,
  COLORS: ['#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#be123c'],

  start() {
    if (!MapView.map) return;
    if (!S.area.geojson) { $('#jibunMsg').textContent = '먼저 구역계를 만들어 주세요.'; return; }
    if (typeof RoadCut !== 'undefined') RoadCut.stop();
    this.stop();
    if (MapView.picking) MapView.setPicking(false);
    this.waiting = true;
    MapView.map.getContainer().classList.add('picking');
    this.ensurePanel();
    this.panel.innerHTML = `<div class="rc-head"><b>대지 자르기</b> · 자를 필지를 지도에서 누르세요. <span class="muted">필지는 크게 확대되어 보입니다.</span></div>
      <div class="rc-nav"><button type="button" data-a="cancel">취소</button></div>`;
    this.bindNav();
    $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  ensurePanel() {
    if (this.panel) return;
    this.panel = L.DomUtil.create('div', 'roadcut-panel', MapView.map.getContainer());
    L.DomEvent.disableClickPropagation(this.panel);
    L.DomEvent.disableScrollPropagation(this.panel);
    this.layer = L.layerGroup().addTo(MapView.map);
  },

  bindNav() {
    this.panel.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'cancel') this.stop();
        else if (a === 'redraw') this.drawLine();
        else if (a === 'apply') this.apply();
        else if (a === 'other') this.start();
      };
    });
  },

  async onPick(latlng) {
    this.waiting = false;
    MapView.map.getContainer().classList.remove('picking');
    this.panel.innerHTML = '<div class="rc-head">필지를 불러오는 중…</div>';
    let f;
    try { f = await VWorld.parcelAt(latlng.lat, latlng.lng); } catch (e) { f = null; }
    if (!f) { this.panel.innerHTML = '<div class="rc-head">필지를 찾지 못했습니다.</div><div class="rc-nav"><button type="button" data-a="other">다시 고르기</button><button type="button" data-a="cancel">취소</button></div>'; this.bindNav(); return; }
    this.f = f;
    this.sp = splitJibun(f.properties.jibun);
    this.A = turf.area(f);
    const b = L.geoJSON(f).getBounds();
    MapView.map.fitBounds(b, { padding: [70, 70], maxZoom: 21 });
    if (this.A < (num(S.criteria.smallLot) || 90) && MapView.map.getZoom() < 20) MapView.map.setView(b.getCenter(), 20);
    this.drawLine();
  },

  drawLine() {
    this.pieces = [];
    this.layer.clearLayers();
    L.geoJSON(S.area.geojson, { style: { color: '#d9480f', weight: 2, dashArray: '6 5', fill: false }, interactive: false }).addTo(this.layer);
    L.geoJSON(this.f, { style: { color: '#111', weight: 3, dashArray: '8 5', fillOpacity: 0.05 }, interactive: false })
      .bindTooltip(`${this.sp.no} ${this.sp.jimok} · ${fmt(this.A, 1)}㎡`, { permanent: true, direction: 'top', className: 'rc-label' }).addTo(this.layer);
    this.panel.innerHTML = `<div class="rc-head"><b>대지 자르기</b> · ${esc(this.sp.no)} <span class="muted">${esc(this.sp.jimok)} · ${fmt(this.A, 1)}㎡</span></div>
      <p class="rc-note">필지를 <b>완전히 가로지르도록</b> 선을 그으세요. 점을 차례로 누르고 마지막 점을 한 번 더 누르면 끝납니다. 선 끝은 필지 밖으로 조금 나가게 그리면 됩니다.</p>
      <div class="rc-nav"><button type="button" data-a="other">다른 필지</button><button type="button" data-a="cancel">취소</button></div>`;
    this.bindNav();
    if (this.lineHandler) this.lineHandler.disable();
    this.lineHandler = new L.Draw.Polyline(MapView.map, { shapeOptions: { color: '#dc2626', weight: 3 }, showLength: true, metric: true });
    this.lineHandler.enable();
  },

  onLine(layer) {
    if (this.lineHandler) { this.lineHandler.disable(); this.lineHandler = null; }
    let line = layer.toGeoJSON();
    // 선 양 끝을 3m씩 늘려, 경계선 위에서 끝나도 확실히 가로지르게
    const c = line.geometry.coordinates;
    if (c.length >= 2) {
      const ext = (a, b) => turf.destination(turf.point(a), 0.003, turf.bearing(turf.point(b), turf.point(a)), { units: 'kilometers' }).geometry.coordinates;
      c[0] = ext(c[0], c[1]);
      c[c.length - 1] = ext(c[c.length - 1], c[c.length - 2]);
    }
    let rest = null;
    try { rest = turf.difference(this.f, turf.buffer(line, 0.005, { units: 'meters' })); } catch (e) { rest = null; }
    const g = rest && rest.geometry;
    const polys = !g ? [] : (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
    const pieces = polys.map(p => turf.polygon(p)).filter(p => turf.area(p) >= 0.05);
    if (pieces.length < 2) {
      this.panel.querySelector('.rc-note').innerHTML = '<b class="warn">선이 필지를 완전히 가로지르지 않았습니다.</b> 필지 바깥에서 시작해 바깥에서 끝나게 다시 그어 주세요.';
      this.lineHandler = new L.Draw.Polyline(MapView.map, { shapeOptions: { color: '#dc2626', weight: 3 }, showLength: true, metric: true });
      this.lineHandler.enable();
      return;
    }
    // 지금 구역과 더 많이 겹치는 조각을 기본으로 넣음
    const zone = S.area.geojson;
    this.pieces = pieces.map((p, k) => {
      let inZ = 0;
      try { const x = turf.intersect(p, zone); inZ = x ? turf.area(x) / turf.area(p) : 0; } catch (e) { inZ = 0; }
      return { p, area: turf.area(p), on: inZ >= 0.5, color: this.COLORS[k % this.COLORS.length], line };
    });
    this.cutLine = line;
    this.renderPieces();
  },

  renderPieces() {
    this.layer.clearLayers();
    L.geoJSON(S.area.geojson, { style: { color: '#d9480f', weight: 2, dashArray: '6 5', fill: false }, interactive: false }).addTo(this.layer);
    this.pieces.forEach((x, k) => {
      L.geoJSON(x.p, { style: { color: x.color, weight: 2, fillColor: x.color, fillOpacity: x.on ? 0.5 : 0.08, dashArray: x.on ? null : '4 4' } })
        .bindTooltip(`조각 ${k + 1} · ${fmt(x.area, 1)}㎡`, { permanent: true, direction: 'center', className: 'rc-label' })
        .on('click', () => { x.on = !x.on; this.renderPieces(); })
        .addTo(this.layer);
    });
    L.geoJSON(this.cutLine, { style: { color: '#dc2626', weight: 2 }, interactive: false }).addTo(this.layer);
    const inA = this.pieces.filter(x => x.on).reduce((a, x) => a + x.area, 0);
    this.panel.innerHTML = `<div class="rc-head"><b>대지 자르기</b> · ${esc(this.sp.no)} <span class="muted">${esc(this.sp.jimok)} · ${fmt(this.A, 1)}㎡</span>
        <span class="rc-small">대지를 자르면 분할 측량이 필요합니다</span></div>
      <div class="rc-opts">${this.pieces.map((x, k) => `<button type="button" data-p="${k}" class="${x.on ? 'on' : ''}" style="border-color:${x.color}">조각 ${k + 1} ${x.on ? '– 구역에 넣음' : '– 뺌'}<small>${fmt(x.area, 1)}㎡</small></button>`).join('')}</div>
      <p class="rc-note">조각(버튼이나 지도)을 누르면 넣고 빼기가 바뀝니다. 진하게 칠한 조각이 구역에 들어갑니다 – 편입 <b>${fmt(inA, 1)}㎡</b> / 전체 ${fmt(this.A, 1)}㎡</p>
      <div class="rc-nav"><button type="button" data-a="redraw">선 다시 긋기</button><button type="button" data-a="apply" class="primary">적용</button><button type="button" data-a="other">다른 필지</button><button type="button" data-a="cancel">취소</button></div>`;
    this.panel.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => { const x = this.pieces[+b.dataset.p]; x.on = !x.on; this.renderPieces(); }; });
    this.bindNav();
  },

  async apply() {
    const f = this.f, pnu = f.properties.pnu, on = this.pieces.filter(x => x.on);
    let z = S.area.geojson;
    try { z = turf.difference(z, f) || null; }
    catch (e) { try { z = turf.difference(turf.truncate(z, { precision: 7 }), turf.truncate(f, { precision: 7 })) || null; } catch (e2) { /* 그대로 */ } }
    const keep = on.length ? safeUnion(on.map(x => x.p)) : null;
    let merged = [z, keep].filter(Boolean);
    merged = merged.length ? safeUnion(merged) : null;
    if (merged) {
      // 자르면서 생긴 10㎡ 미만 틈은 메우고 5㎡ 미만 부스러기는 뺌
      const g = merged.geometry;
      const fill = p => [p[0], ...p.slice(1).filter(h => turf.area(turf.polygon([h])) >= 10)];
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(fill).filter(p => turf.area(turf.polygon(p)) >= 5);
      merged = polys.length === 1 ? turf.polygon(polys[0]) : turf.multiPolygon(polys);
    }
    MapView.items.clearLayers();
    if (merged) L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => MapView.items.addLayer(l));
    MapView.save();

    // 토지조서: 편입 조각 면적으로, 건축물은 편입 조각 위에 있는 것만
    const had = S.lands.findIndex(l => l.pnu === pnu);
    if (had >= 0) S.lands.splice(had, 1);
    const r1 = x => Math.round(x * 10) / 10;
    const inA = on.reduce((a, x) => a + x.area, 0);
    const ptIn = (bf, poly) => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(bf), poly); } catch (e) { return false; } };
    if (keep) {
      const land = landFromFeature(f, inA);   // 조서 면적 = 대장 면적 × 편입비율 (아래 fillLedger)
      land.partial = true; land.cutBy = '대지 자르기 – 분할 측량 필요'; land.splitNeeded = true; land.geom = keep.geometry;
      S.lands.push(land);
      MapView.fillLedger([land]).then(() => App.update(true));
      if (had < 0) {
        try {
          const bs = (await VWorld.dataPage('LT_C_BLDGINFO', `BOX(${turf.bbox(f).join(',')})`, 1, 50)).features.filter(bf => ptIn(bf, f));
          bs.forEach(bf => S.buildings.push(buildingFromFeature(bf, this.sp.no, pnu)));
        } catch (e) { /* 건축물 없이 */ }
      }
    } else {
      S.buildings = S.buildings.filter(b => !(b.auto && b.pnu === pnu));
    }
    const row = { input: '', result: '경계 정리', jibun: this.sp.no, jimok: this.sp.jimok, area: r1(inA), note: keep ? `대지 자르기 – 일부 편입 (전체 ${fmt(this.A, 1)}㎡), 분할 측량 필요` : '대지 자르기 – 구역에서 뺌' };
    MapView.showReport([row, ...(MapView.lastReport || []).filter(r => r.jibun !== this.sp.no)]);
    MapView.drawParcels();
    sortByJibun();
    $('#jibunMsg').innerHTML = `${esc(this.sp.no)} 필지를 잘라 <b>${fmt(inA, 1)}㎡</b>(전체 ${fmt(this.A, 1)}㎡)를 구역에 넣었습니다. 구역 면적 <b>${fmt(S.area.drawnArea)}㎡</b>. 토지조서에 "분할 측량 필요"로 표시했습니다.`
      + (keep && S.buildings.some(b => b.pnu === pnu) ? ' 이 필지의 건축물은 조서에 그대로 두었으니, 뺀 쪽에 있는 건물은 건축물조서에서 직접 지워 주세요.' : '');
    this.stop();
  },

  stop() {
    this.waiting = false;
    if (this.lineHandler) { this.lineHandler.disable(); this.lineHandler = null; }
    if (MapView.map) MapView.map.getContainer().classList.toggle('picking', !!MapView.picking);
    if (this.layer) { this.layer.remove(); this.layer = null; }
    if (this.panel) { this.panel.remove(); this.panel = null; }
  },
};

// 경계 정리: 구역 경계에 걸친 도로(중심선까지 / 도로 전체 / 빼기 / 지금 구역선대로)와
// 경계의 작은 필지(넣기 / 빼기)를 하나씩 확대해 보며 고름. 작은 필지는 최대로 확대해 잘못 고르지 않게.
// 대지는 필지 경계 그대로가 원칙이고, "지금 구역선대로"를 고를 때만 잘림(분할 측량 필요 표시).
const RoadCut = {
  ROAD: ['도', '구', '천'],
  LABEL: { center: '중심선까지', whole: '도로 전체', include: '필지 전체 넣기', none: '빼기', line: '지금 구역선대로' },
  items: [], i: 0, layer: null, panel: null,

  feat(g) { return { type: 'Feature', properties: {}, geometry: g }; },

  // 거리 계산용 평면 좌표(m). 구역 중심 기준 등장방형 근사 – 구역 크기(수백 m)에서는 오차가 무시할 만함
  proj(lat0, lon0) {
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110574;
    const map = (c, fn) => (typeof c[0] === 'number' ? fn(c) : c.map(x => map(x, fn)));
    return {
      to: g => ({ type: g.type, coordinates: map(g.coordinates, ([x, y]) => [(x - lon0) * kx, (y - lat0) * ky]) }),
      from: g => ({ type: g.type, coordinates: map(g.coordinates, ([x, y]) => [x / kx + lon0, y / ky + lat0]) }),
    };
  },

  // 경계선 위에 step(m) 간격으로 점을 찍음 (box 안만)
  sample(g, step, box, out) {
    const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
    for (const r of rings) {
      for (let k = 0; k < r.length - 1; k++) {
        const [x1, y1] = r[k], [x2, y2] = r[k + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / step));
        for (let t = 0; t < n; t++) {
          const x = x1 + (x2 - x1) * t / n, y = y1 + (y2 - y1) * t / n;
          if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) out.push([x, y]);
        }
      }
    }
  },

  treeUnion(fs) {
    fs = fs.filter(Boolean);
    while (fs.length > 1) {
      const nx = [];
      for (let k = 0; k < fs.length; k += 2) {
        if (k + 1 >= fs.length) { nx.push(fs[k]); continue; }
        let u = null;
        try { u = turf.union(fs[k], fs[k + 1]); }
        catch (e) { try { u = turf.union(turf.truncate(fs[k], { precision: 3 }), turf.truncate(fs[k + 1], { precision: 3 })); } catch (e2) { u = fs[k]; } }
        nx.push(u);
      }
      fs = nx;
    }
    return fs[0] || null;
  },

  // 도로 중심선까지: 도로 안의 점 중 구역 쪽 대지 경계에 더 가까운 부분 (보로노이로 계산)
  centerPiece(it) {
    const P = this.P;
    const road = P.to(it.f.geometry);
    const [x0, y0, x1, y1] = turf.bbox(road), m = 25, box = [x0 - m, y0 - m, x1 + m, y1 + m];
    const near = r => r.mb[0] <= box[2] && r.mb[2] >= box[0] && r.mb[1] <= box[3] && r.mb[3] >= box[1];
    const A = [], B = [];
    this.core.filter(near).forEach(r => this.sample(r.m, 1.2, box, A));
    this.out.filter(near).forEach(r => this.sample(r.m, 1.2, box, B));
    if (!B.length) return { geom: it.f.geometry, note: '건너편에 대지가 없어 도로 전체를 넣었습니다' };
    if (!A.length) return { geom: null, note: '구역 쪽 대지를 찾지 못했습니다' };
    // 같은 점이 겹치면 보로노이가 깨지므로 0.1m 단위로 정리 (양쪽에 다 있으면 버림)
    const key = p => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)}`;
    const ka = new Map(), kb = new Map();
    A.forEach(p => ka.set(key(p), p));
    B.forEach(p => kb.set(key(p), p));
    const pts = [];
    ka.forEach((p, k) => { if (!kb.has(k)) pts.push(turf.point(p, { a: 1 })); });
    kb.forEach((p, k) => { if (!ka.has(k)) pts.push(turf.point(p, { a: 0 })); });
    const vor = turf.voronoi(turf.featureCollection(pts), { bbox: box });
    const roadF = this.feat(road), pieces = [];
    vor.features.forEach((c, k) => {
      if (!c || !pts[k].properties.a) return;
      try { const x = turf.intersect(c, roadF); if (x) pieces.push(x); } catch (e) { /* 건너뜀 */ }
    });
    const u = this.treeUnion(pieces);
    if (!u) return { geom: null, note: '' };
    // 0.5㎡ 미만 부스러기 조각은 뺌
    const g = u.geometry, polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    const keep = polys.filter(p => turf.area(turf.polygon(p)) >= 0.5);
    if (!keep.length) return { geom: null, note: '' };
    return { geom: P.from(keep.length === 1 ? { type: 'Polygon', coordinates: keep[0] } : { type: 'MultiPolygon', coordinates: keep }) };
  },

  options(it) {
    const o = {};
    let line = null;
    try { const x = turf.intersect(it.f, this.zone0); line = x ? x.geometry : null; } catch (e) { line = null; }
    if (it.kind === 'road') {
      let c;
      try { c = this.centerPiece(it); } catch (e) { console.warn(e); c = { geom: null, note: '중심선을 계산하지 못했습니다 – 다른 방식을 고르세요' }; }
      o.center = c;
      o.whole = { geom: it.f.geometry };
      o.none = { geom: null };
      o.line = { geom: line };
    } else {
      o.include = { geom: it.f.geometry };
      o.none = { geom: null };
      o.line = { geom: line, note: '대지를 자르는 것이라 분할 측량이 필요합니다' };
    }
    Object.values(o).forEach(v => { v.area = v.geom ? turf.area(this.feat(v.geom)) : 0; });
    return o;
  },

  async start() {
    const msg = $('#jibunMsg');
    const zone = S.area.geojson;
    if (!zone) { msg.textContent = '먼저 구역계를 만들어 주세요.'; return; }
    if (!VWorld.enabled) { msg.textContent = '브이월드 인증키가 있어야 합니다.'; return; }
    this.stop();
    msg.textContent = '경계 주변 필지를 불러오는 중…';
    const [x0, y0, x1, y1] = turf.bbox(zone), e = 40 / 88000, n = 40 / 111000;
    let fs;
    try { fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - e},${y0 - n},${x1 + e},${y1 + n})`, 30); }
    catch (err) { msg.textContent = '필지를 불러오지 못했습니다: ' + err.message; return; }
    const c = turf.centroid(zone).geometry.coordinates;
    this.P = this.proj(c[1], c[0]);
    this.zone0 = zone;
    const recs = [];
    for (let k = 0; k < fs.length; k++) {
      if (k % 150 === 149) { msg.textContent = `경계 필지를 찾는 중… ${k + 1}/${fs.length}`; await new Promise(r => setTimeout(r)); }
      const f = fs[k], A = turf.area(f);
      if (!A) continue;
      let ratio;
      try { const x = turf.intersect(f, zone); ratio = x ? turf.area(x) / A : 0; } catch (err) { ratio = 0; }
      const sp = splitJibun(f.properties.jibun);
      const m = this.P.to(f.geometry);
      recs.push({ f, A, ratio, sp, road: this.ROAD.includes(sp.jimok), bb: turf.bbox(f), m, mb: turf.bbox(m) });
    }
    this.core = recs.filter(r => !r.road && r.ratio >= 0.5);
    this.out = recs.filter(r => !r.road && r.ratio < 0.5);
    const D = 2 / 111000;
    const near = (a, b) => a.bb[0] - D <= b.bb[2] && b.bb[0] - D <= a.bb[2] && a.bb[1] - D <= b.bb[3] && b.bb[1] - D <= a.bb[3];
    const touches = (r, list) => {
      let buf = null;
      return list.some(o => {
        if (o === r || !near(r, o)) return false;
        buf = buf || turf.buffer(r.f, 0.7, { units: 'meters' });
        try { return turf.booleanIntersects(buf, o.f); } catch (err) { return false; }
      });
    };
    const lot = num(S.criteria.smallLot) || 90;
    const items = [];
    for (const r of recs) {
      if (r.road) {
        if (!touches(r, this.core)) continue;               // 구역 대지에 닿는 도로만
        if (r.ratio >= 0.98 && !touches(r, this.out)) continue;   // 구역 안쪽 도로는 그대로
        items.push({ ...r, kind: 'road', choice: 'center', small: r.A < lot });
      } else if (r.A < lot && r.ratio > 0.02 && r.ratio < 0.98) {
        items.push({ ...r, kind: 'small', choice: r.ratio >= 0.5 ? 'include' : 'none', small: true });
      }
    }
    if (!items.length) { msg.textContent = '정리할 경계 도로나 작은 필지가 없습니다.'; return; }
    // 구역 둘레를 따라 돌도록 중심 기준 각도순
    items.forEach(it => { const p = turf.pointOnFeature(it.f).geometry.coordinates; it.ang = Math.atan2(p[1] - c[1], p[0] - c[0]); });
    items.sort((a, b) => b.ang - a.ang);
    this.items = items;
    const roads = items.filter(x => x.kind === 'road').length;
    msg.innerHTML = `경계 도로 <b>${roads}필지</b>, 경계의 작은 필지 <b>${items.length - roads}필지</b>를 차례로 보여 드립니다. 지도 아래 판에서 고르세요.`;
    if (MapView.map.getContainer().classList.contains('map-full') === false) $('#map').scrollIntoView({ behavior: 'smooth', block: 'center' });
    this.layer = L.layerGroup().addTo(MapView.map);
    this.panel = L.DomUtil.create('div', 'roadcut-panel', MapView.map.getContainer());
    L.DomEvent.disableClickPropagation(this.panel);
    L.DomEvent.disableScrollPropagation(this.panel);
    this.show(0);
  },

  async show(i) {
    this.i = Math.max(0, Math.min(this.items.length - 1, i));
    const it = this.items[this.i];
    it.seen = true;
    if (!it.opts) {
      this.panel.innerHTML = '<div class="rc-head">계산 중…</div>';
      await new Promise(r => setTimeout(r, 20));
      it.opts = this.options(it);
      if (it.choice === 'center' && !it.opts.center.geom && it.opts.center.note) it.choice = 'line';
    }
    this.zoom(it);
    this.draw(it);
    this.render(it);
  },

  // 도로는 구역 쪽 부분이 보이게, 작은 필지는 최대로 확대
  zoom(it) {
    const map = MapView.map;
    let focus = it.f;
    if (it.kind === 'road' && it.A > 300) {
      try { const x = turf.intersect(it.f, turf.buffer(this.zone0, 12, { units: 'meters' })); if (x) focus = x; } catch (e) { /* 도로 전체 */ }
    }
    const b = L.geoJSON(focus).getBounds();
    map.fitBounds(b, { padding: [60, 60], maxZoom: 21 });
    if (it.small && map.getZoom() < 20) map.setView(b.getCenter(), 20);
  },

  draw(it, previewKey) {
    this.layer.clearLayers();
    L.geoJSON(this.zone0, { style: { color: '#d9480f', weight: 2, dashArray: '6 5', fill: false }, interactive: false }).addTo(this.layer);
    this.items.forEach(x => {
      if (x !== it) L.geoJSON(x.f, { style: { color: '#888', weight: 1, dashArray: '3 3', fill: false }, interactive: false }).addTo(this.layer);
    });
    const v = it.opts[previewKey || it.choice];
    if (v.geom) L.geoJSON(v.geom, { style: { color: '#1d4ed8', weight: 2, fillColor: '#3b82f6', fillOpacity: 0.45 }, interactive: false }).addTo(this.layer);
    L.geoJSON(it.f, { style: { color: '#111', weight: 3, dashArray: '8 5', fill: false }, interactive: false })
      .bindTooltip(`${it.sp.no} ${it.sp.jimok} · ${fmt(it.A, 1)}㎡`, { permanent: true, direction: 'center', className: 'rc-label' })
      .addTo(this.layer);
  },

  render(it) {
    const n = this.items.length, kindName = it.kind === 'road' ? '도로' : '작은 필지';
    const v = it.opts[it.choice];
    const sameKind = this.items.slice(this.i + 1).filter(x => x.kind === it.kind && !x.seen).length;
    this.panel.innerHTML = `
      <div class="rc-head"><b>경계 정리 ${this.i + 1}/${n}</b> · ${esc(it.sp.no)} <span class="muted">${esc(it.sp.jimok)} · ${fmt(it.A, 1)}㎡ · 지금 구역 안 ${Math.round(it.ratio * 100)}%</span>
        ${it.small ? '<span class="rc-small">작은 필지 – 크게 확대했습니다. 경계를 꼭 확인하세요</span>' : ''}</div>
      <div class="rc-opts">${Object.entries(it.opts).map(([k, o]) => `
        <button type="button" data-k="${k}" class="${it.choice === k ? 'on' : ''}">${this.LABEL[k]}<small>${o.geom ? fmt(o.area, 1) + '㎡ 편입' : '편입 안 함'}</small></button>`).join('')}</div>
      ${v.note ? `<p class="rc-note">${esc(v.note)}</p>` : ''}
      <p class="rc-note muted">파란 면이 구역에 들어가는 부분입니다. 버튼에 마우스를 올리면 미리 보입니다.</p>
      <div class="rc-nav">
        <button type="button" data-a="prev" ${this.i ? '' : 'disabled'}>◀ 이전</button>
        <button type="button" data-a="next" ${this.i < n - 1 ? '' : 'disabled'}>다음 ▶</button>
        ${sameKind ? `<button type="button" data-a="all">남은 ${kindName} ${sameKind}개도 "${this.LABEL[it.choice]}"</button>` : ''}
        <button type="button" data-a="apply" class="primary">적용하고 끝내기</button>
        <button type="button" data-a="cancel">취소</button>
      </div>`;
    this.panel.querySelectorAll('[data-k]').forEach(b => {
      b.onclick = () => { it.choice = b.dataset.k; this.draw(it); this.render(it); };
      b.onmouseenter = () => this.draw(it, b.dataset.k);
      b.onmouseleave = () => this.draw(it);
    });
    this.panel.querySelectorAll('[data-a]').forEach(b => {
      b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'prev') this.show(this.i - 1);
        else if (a === 'next') this.show(this.i + 1);
        else if (a === 'all') {
          this.items.slice(this.i + 1).forEach(x => { if (x.kind === it.kind && !x.seen) { x.choice = it.choice; x.bulk = true; } });
          this.render(it);
          this.panel.querySelector('.rc-nav').insertAdjacentHTML('beforebegin', '<p class="rc-note">남은 필지에 같은 방식을 정했습니다. 적용하면 한꺼번에 계산합니다.</p>');
        } else if (a === 'apply') this.apply();
        else this.stop();
      };
    });
  },

  stop() {
    if (this.layer) { this.layer.remove(); this.layer = null; }
    if (this.panel) { this.panel.remove(); this.panel = null; }
  },

  async apply() {
    const msg = $('#jibunMsg');
    const items = this.items;
    for (let k = 0; k < items.length; k++) {
      if (items[k].opts) continue;
      this.panel.innerHTML = `<div class="rc-head">계산 중… ${k + 1}/${items.length}</div>`;
      await new Promise(r => setTimeout(r, 10));
      items[k].opts = this.options(items[k]);
    }
    this.panel.innerHTML = '<div class="rc-head">구역계를 다시 그리는 중…</div>';
    await new Promise(r => setTimeout(r, 10));

    // 구역 = 지금 구역 − 정리한 필지 + 고른 부분
    let z = this.zone0;
    for (const it of items) {
      try { z = turf.difference(z, it.f) || z; }
      catch (e) { try { z = turf.difference(turf.truncate(z, { precision: 7 }), turf.truncate(it.f, { precision: 7 })) || z; } catch (e2) { /* 그대로 */ } }
    }
    const pieces = items.map(it => it.opts[it.choice].geom).filter(Boolean).map(g => this.feat(g));
    let merged = safeUnion([z, ...pieces]);
    // 틈(10㎡ 미만 구멍)은 메우고, 떨어진 5㎡ 미만 부스러기는 뺌
    const g = merged.geometry;
    const fill = p => [p[0], ...p.slice(1).filter(h => turf.area(turf.polygon([h])) >= 10)];
    let polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(fill).filter(p => turf.area(turf.polygon(p)) >= 5);
    merged = polys.length === 1 ? turf.polygon(polys[0]) : turf.multiPolygon(polys);

    MapView.items.clearLayers();
    L.geoJSON(merged, { style: { color: '#d9480f', weight: 3 } }).eachLayer(l => MapView.items.addLayer(l));
    MapView.save();

    // 토지조서: 일부 편입은 편입 면적으로, 뺀 필지는 조서에서 빼고, 새로 넣은 작은 필지는 건축물도
    const r1 = x => Math.round(x * 10) / 10;
    const rows = [];
    const newLands = [];
    for (const it of items) {
      const pnu = it.f.properties.pnu, v = it.opts[it.choice];
      const had = S.lands.findIndex(l => l.pnu === pnu);
      if (had >= 0) S.lands.splice(had, 1);
      const label = this.LABEL[it.choice];
      if (!v.geom || v.area < 0.5) {
        S.buildings = S.buildings.filter(b => !(b.auto && b.pnu === pnu));
        rows.push({ input: '', result: '경계 정리', jibun: it.sp.no, jimok: it.sp.jimok, area: 0, note: `${label} – 구역에서 뺌 (전체 ${fmt(it.A, 1)}㎡)` });
        continue;
      }
      const land = landFromFeature(it.f, v.area);   // 98% 미만이면 일부 편입 (편입비율)
      if (land.inRatio < 1) { land.cutBy = label; land.geom = v.geom; }
      S.lands.push(land);
      newLands.push(land);
      if (had < 0 && it.kind === 'small') {
        try {
          const bs = (await VWorld.dataPage('LT_C_BLDGINFO', `BOX(${turf.bbox(it.f).join(',')})`, 1, 50)).features
            .filter(bf => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(bf), it.f); } catch (e) { return false; } });
          bs.forEach(bf => S.buildings.push(buildingFromFeature(bf, it.sp.no, pnu)));
        } catch (e) { /* 건축물 없이 */ }
      }
      rows.push({ input: '', result: '경계 정리', jibun: it.sp.no, jimok: it.sp.jimok, area: r1(v.area), note: `${label}${land.partial ? ` – 일부 편입 (전체 ${fmt(it.A, 1)}㎡)` : ''}${it.kind === 'small' && land.partial ? ' – 분할 측량 필요' : ''}` });
    }
    this.stop();
    MapView.fillLedger(newLands).then(() => App.update(true));   // 토지대장 면적으로
    MapView.map.fitBounds(MapView.items.getBounds(), { padding: [30, 30] });
    MapView.drawParcels();
    sortByJibun();
    const before = turf.area(this.zone0), after = turf.area(merged);
    const prev = (MapView.lastReport || []).filter(r => !rows.some(x => x.jibun === r.jibun));
    MapView.showReport([...rows, ...prev]);
    const partial = rows.filter(r => /일부 편입/.test(r.note)).length;
    msg.innerHTML = `경계 정리 ${rows.length}필지를 반영했습니다. 구역 면적 ${fmt(before)}㎡ → <b>${fmt(after)}㎡</b> (${after >= before ? '+' : ''}${fmt(after - before)}㎡)`
      + (partial ? `, 일부 편입 ${partial}필지` : '') + '. 대조표의 "경계 정리" 행을 확인하세요.';
  },
};
