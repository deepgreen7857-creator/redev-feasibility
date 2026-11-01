'use strict';
// /arch 개략 건축계획 — 구역 경계 성격 지정 → 배치 대안 3개 → 배치도·동지 일조·3D·개요·표준 평면 → 확정하면 다른 도구로 이어짐
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const G = ArchGeom, D = ArchDraw;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const fmt = (v, d = 0) => num(v) === null ? '○○' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: d });
  const TAGS = ['boundary', 'road', 'arterial', 'north', 'park', 'lowrise'];
  const TYPE_HEX = { 59: 0xf3e6c8, 84: 0xd9eadc, 114: 0xdde5f1 };
  let C = null, TC = null, site = null, pr = null, pts = null, tags = [], entries = [], exclude = [];
  let alts = [], cur = 0, map, lyrSite, lyrEdges, lyrEx, lyrBld, mode = 'edge', v3 = null, sunRes = null;

  const msg = (t, bad) => { const m = $('#msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; m.style.background = bad ? 'var(--bad-soft)' : 'var(--accent-soft)'; };
  const crit = id => C.items.find(i => i.id === id);

  /* ---------- 조건 입력 ---------- */
  const FIELDS = { siteArea: 'p_siteArea', infra: 'p_infra', far: 'p_far', maxFloors: 'p_maxFloors', m59: 'p_m59', m84: 'p_m84', m114: 'p_m114', angleMode: 'p_angleMode', angle: 'p_angle', spacing: 'p_spacing', sideGap: 'p_sideGap', roadSb: 'p_roadSb', artSb: 'p_artSb', bndSb: 'p_bndSb', lowCap: 'p_lowCap', lowDist: 'p_lowDist', parkW: 'p_parkW', minFloors: 'p_minFloors', fh: 'p_fh', sf: 'p_sf' };
  function defaults() {
    const A = C.가정; let U = {}; try { U = JSON.parse(localStorage.getItem('jbs-urban-plan') || '{}'); } catch (e) { U = {}; }
    const v = site.v || {};
    return {
      siteArea: v.siteArea || '', infra: U.infraRatio ?? 25, far: v.far || U.farCustom || 250, maxFloors: A.maxFloors,
      m59: U.mix59 ?? 40, m84: U.mix84 ?? 50, m114: U.mix114 ?? 10, angleMode: 'auto', angle: 0,
      spacing: crit('spacing_ratio').값, sideGap: A.sideGap_m, roadSb: A.roadSetback_m, artSb: A.arterialSetback_m, bndSb: A.boundarySetback_m,
      lowCap: 15, lowDist: 30, parkW: A.parkWidth_m ?? 20, minFloors: A.minFloors, fh: A.floorHeight_m, sf: U.supplyFactor ?? A.supplyFactor,
    };
  }
  const P = () => { const o = {}; Object.entries(FIELDS).forEach(([k, id]) => { o[k] = $('#' + id).value; }); return o; };
  function setP(o) { Object.entries(FIELDS).forEach(([k, id]) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') $('#' + id).value = o[k]; }); $('#p_angle').disabled = $('#p_angleMode').value === 'auto'; }
  const filled = o => { const r = {}; Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') r[k] = v; }); return r; };
  function saveState() {
    if (!site) return;
    site.arch = Object.assign(site.arch || {}, { tags, entries, exclude: exclude.map(ex => ex.map(pr.back)), params: P() });
    if (site.id || site.geojson) JbsSite.save(site);
  }

  /* ---------- 지도 ---------- */
  function initMap() {
    map = L.map('map').setView([37.4645, 126.6455], 16);
    const key = (typeof VWORLD_KEY !== 'undefined' && VWORLD_KEY) ? VWORLD_KEY : '';
    if (key && /jbslab\.co\.kr$/.test(location.hostname)) L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/{z}/{y}/{x}.png`, { maxZoom: 21, maxNativeZoom: 19, attribution: '브이월드' }).addTo(map);
    else L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    lyrSite = L.layerGroup().addTo(map); lyrEx = new L.FeatureGroup().addTo(map); lyrBld = L.layerGroup().addTo(map); lyrEdges = L.layerGroup().addTo(map);
    map.addControl(new L.Control.Draw({ edit: { featureGroup: lyrEx }, draw: { polygon: { shapeOptions: { color: '#5d7f5a' } }, rectangle: { shapeOptions: { color: '#5d7f5a' } }, polyline: false, circle: false, circlemarker: false, marker: false } }));
    map.on(L.Draw.Event.CREATED, e => {
      const gj = e.layer.toGeoJSON();
      if (!site.geojson) { site.geojson = gj; site.v = site.v || {}; site.v.siteArea = String(Math.round(turf.area(gj) * 10) / 10); site.name = site.name || '이름 없는 구역'; JbsSite.save(site); load(site); msg('구역계를 그렸습니다. 이어서 경계 성격을 정하세요.'); return; }
      lyrEx.addLayer(e.layer); syncExclude(); msg('건축 불가 영역(기반시설 등)을 추가했습니다.');
    });
    map.on(L.Draw.Event.EDITED, syncExclude); map.on(L.Draw.Event.DELETED, syncExclude);
  }
  function syncExclude() {
    exclude = [];
    lyrEx.eachLayer(l => { const c = l.toGeoJSON().geometry.coordinates[0]; exclude.push(G.openRing(c).map(pr.to)); });
    saveState(); invalidate();
  }
  // 같은 성격이면서 방향이 비슷하게(꺾임 30° 이하) 이어진 변들 — 곡선 경계를 한 덩어리로
  function sideRun(E, i) {
    const n = E.length, ang = e => Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]);
    const turn = (a, b) => { let d = Math.abs(ang(a) - ang(b)); if (d > Math.PI) d = 2 * Math.PI - d; return d; };
    const run = [i];
    for (let k = (i + 1) % n; k !== i && tags[k] === tags[i] && turn(E[(k - 1 + n) % n], E[k]) < Math.PI / 6; k = (k + 1) % n) run.push(k);
    for (let k = (i - 1 + n) % n; k !== i && !run.includes(k) && tags[k] === tags[i] && turn(E[k], E[(k + 1) % n]) < Math.PI / 6; k = (k - 1 + n) % n) run.push(k);
    return run;
  }
  // 출입구는 도로 변에만, 최대 3곳 — 예전에 찍힌 것도 정리
  function cleanEntries() {
    entries = entries.filter(en => ['road', 'arterial'].includes(tags[en.edge])).slice(0, 3);
    entries.forEach((en, k) => { en.label = k === 0 ? '주출입' : `부출입${entries.length > 2 ? k : ''}`; });
  }
  function drawSite() {
    lyrSite.clearLayers(); lyrEdges.clearLayers();
    if (!pts) return;
    const LL = p => pr.back(p).slice().reverse();
    L.polygon(pts.map(LL), { stroke: false, fillColor: '#c8322b', fillOpacity: .06 }).addTo(lyrSite);
    const E = G.edges(pts);
    E.forEach((e, i) => {
      const t = D.TAG[tags[i]] || D.TAG.boundary, off = 2.5;
      // 경계 성격: 구역 바깥으로 2.5m 띄운 가는 색 띠
      L.polyline([[e.a[0] + e.out[0] * off, e.a[1] + e.out[1] * off], [e.b[0] + e.out[0] * off, e.b[1] + e.out[1] * off]].map(LL), { color: t.color, weight: 5, opacity: .9, lineCap: 'butt', interactive: false }).addTo(lyrEdges);
      // 누르기 쉬운 투명한 넓은 선
      const hit = L.polyline([e.a, e.b].map(LL), { color: '#000', weight: 18, opacity: 0 }).addTo(lyrEdges);
      hit.bindTooltip(`${t.name} · ${e.len.toFixed(1)}m — ${mode === 'edge' ? '눌러서 성격 바꾸기' : '눌러서 출입구 찍기'}`, { sticky: true });
      hit.on('click', ev => {
        if (mode === 'edge') {
          const run = sideRun(E, i), nt = TAGS[(TAGS.indexOf(tags[i]) + 1) % TAGS.length];
          run.forEach(k => { tags[k] = nt; });
          msg(`${run.length > 1 ? `이어진 변 ${run.length}개(${run.reduce((a, k) => a + E[k].len, 0).toFixed(0)}m)를` : '이 변을'} '${D.TAG[nt].name}'(으)로 바꿨습니다.`); cleanEntries(); drawSite(); saveState(); invalidate(); return; }
        const p = pr.to([ev.latlng.lng, ev.latlng.lat]), dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1];
        const t2 = Math.max(0.05, Math.min(0.95, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / (dx * dx + dy * dy)));
        const near = entries.findIndex(en => en.edge === i && Math.abs(en.t - t2) * e.len < 15);
        if (near >= 0) { entries.splice(near, 1); }
        else {
          if (!['road', 'arterial'].includes(tags[i])) { msg(`이 변은 '${t.name}'입니다. 차량 출입구는 도로 쪽 변(파랑·보라)에만 찍을 수 있습니다. 도로인데 색이 다르면 [경계 성격 바꾸기]로 먼저 바꾸세요.`, true); return; }
          if (entries.length >= 3) { msg('차량 출입구는 3곳까지 찍을 수 있습니다. 기존 표시를 눌러 지운 뒤 찍으세요.', true); return; }
          entries.push({ edge: i, t: t2 });
        }
        entries.forEach((en, k) => { en.label = k === 0 ? '주출입' : `부출입${entries.length > 2 ? k : ''}`; });
        msg(entries.length ? `차량 출입구 ${entries.length}곳: ${entries.map(en => en.label).join(', ')}` : '차량 출입구를 모두 지웠습니다.');
        drawSite(); saveState(); if (alts.length) renderPlan();
      });
    });
    // 구역계: 적색 쇄선을 맨 위에
    L.polygon(pts.map(LL), { color: '#c8322b', weight: 2.5, dashArray: '12 4 2 4', fill: false, interactive: false }).addTo(lyrEdges);
    entries.forEach(en => { const e = E[en.edge]; if (!e) return; const m = [e.a[0] + (e.b[0] - e.a[0]) * en.t, e.a[1] + (e.b[1] - e.a[1]) * en.t]; L.circleMarker(LL(m), { radius: 7, color: '#1d2a33', fillColor: '#fff', fillOpacity: 1, weight: 2 }).bindTooltip(en.label || '출입', { permanent: true, direction: 'top', offset: [0, -6] }).addTo(lyrEdges); });
    $('#tagLegend').innerHTML = TAGS.map(k => `<span class="tag"><i style="background:${D.TAG[k].color}"></i>${D.TAG[k].name}</span>`).join('') + '<span class="tag"><i style="background:repeating-linear-gradient(90deg,#c8322b 0 7px,transparent 7px 9px,#c8322b 9px 10px,transparent 10px 12px)"></i>구역계</span>';
    renderLegend();
  }
  function drawBuildingsOnMap() {
    lyrBld.clearLayers(); const A = alts[cur]; if (!A) return;
    A.buildings.forEach(b => L.polygon(b.poly.map(p => pr.back(p).slice().reverse()), { color: '#1d2a33', weight: 1, fillColor: '#f2f0ea', fillOpacity: .9 }).bindTooltip(`${b.id}동 ${b.floors}층 · ${b.t}㎡ ${b.n}호`).addTo(lyrBld));
  }

  // 경계 자동 지정: /urban 주변 도로 → 도로(폭 20m 이상 간선), 북쪽을 향한 변 → 정북 인접대지
  function autoTag() {
    const roads = ((site.profile || {}).roadGeoms || []).map(r => {
      const g = r.geom; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : [];
      return { w: r.w, polys: rings.map(rg => G.openRing(rg).map(pr.to)) };
    });
    tags = G.edges(pts).map(e => {
      const m = [(e.a[0] + e.b[0]) / 2 + e.out[0] * 3, (e.a[1] + e.b[1]) / 2 + e.out[1] * 3];
      const hit = roads.find(r => r.polys.some(pl => G.inside(m[0], m[1], pl) || pl.some((q, k) => G.segDist(m, q, pl[(k + 1) % pl.length]) < 4)));
      if (hit) return hit.w >= 20 ? 'arterial' : 'road';
      return e.out[1] > 0.6 ? 'north' : 'boundary';
    });
    cleanEntries(); drawSite(); saveState(); invalidate();
    msg(roads.length ? '/urban 주변 도로 자료로 도로 변을, 방향으로 정북 변을 정했습니다. 다른 점은 경계선을 눌러 고치세요.' : '도로 자료가 없어 방향만으로 정했습니다(북쪽을 향한 변 = 정북 인접대지). 도로 변은 경계선을 눌러 지정하세요.');
  }

  /* ---------- 지도 위 범례(끌어서 옮기기, 접기, 위치 기억) ---------- */
  const LEG_KEY = 'jbs.arch.legend';
  let leg = null;
  function legendItems() {
    const p = P(), n = v => (v === '' || v === undefined ? '○○' : v);
    const sn = crit('sunlight_north').이격;
    return [
      ['boundary', `이격 ${n(p.bndSb)}m`],
      ['road', `이격 ${n(p.roadSb)}m · 차량 출입구를 찍을 수 있음`],
      ['arterial', `소음 이격 ${n(p.artSb)}m · 출입구 가능`],
      ['north', `일조 높이 제한: 높이 10m 이하 ${sn.높이10m이하_m}m, 초과 부분은 높이의 1/2 이상 이격`],
      ['park', `이격 ${n(p.bndSb)}m · 북쪽을 향하면 공원 폭 ${n(p.parkW)}m 너머를 정북 기준선으로`],
      ['lowrise', `경계에서 ${n(p.lowDist)}m 안은 ${n(p.lowCap)}층 이하`],
    ];
  }
  function renderLegend() {
    if (!leg) return;
    const used = new Set(tags || []);
    leg.querySelector('ul').innerHTML = legendItems().map(([k, d]) => `<li class="${used.has(k) ? '' : 'off'}" title="${d}"><i style="background:${D.TAG[k].color}"></i><div>${D.TAG[k].name}<small>${d}</small></div></li>`).join('') +
      `<li><i style="background:repeating-linear-gradient(90deg,#c8322b 0 7px,transparent 7px 9px,#c8322b 9px 10px,transparent 10px 12px)"></i><div>구역계</div></li>` +
      `<li><span class="ent"></span><div>차량 출입구</div></li>`;
  }
  function initLegend() {
    const box = document.getElementById('map');
    leg = document.createElement('div'); leg.className = 'mlegend'; leg.setAttribute('aria-label', '경계 범례');
    leg.innerHTML = '<div class="hd" title="끌어서 옮기기"><span>⠿ 범례</span><button data-lg="full" title="자세히(적용 값·안 쓰는 성격까지)">ⓘ</button><button data-lg="corner" title="다음 모서리로">⤢</button><button data-lg="min" title="접기·펴기">–</button></div><ul></ul>';
    box.appendChild(leg);
    L.DomEvent.disableClickPropagation(leg); L.DomEvent.disableScrollPropagation(leg);
    let st = {}; try { st = JSON.parse(localStorage.getItem(LEG_KEY)) || {}; } catch (e) { st = {}; }
    const save = () => { try { localStorage.setItem(LEG_KEY, JSON.stringify(st)); } catch (e) { /* 무시 */ } };
    const place = () => {
      const bw = box.clientWidth, bh = box.clientHeight, w = leg.offsetWidth, h = leg.offsetHeight;
      const fx = st.fx ?? 1, fy = st.fy ?? 0; // 0~1: 남는 공간 안에서의 위치(기본 오른쪽 위)
      leg.style.left = Math.max(4, (bw - w - 8) * fx + 4) + 'px'; leg.style.top = Math.max(4, (bh - h - 8) * fy + 4) + 'px';
      leg.classList.toggle('min', !!st.min); leg.classList.toggle('full', !!st.full);
    };
    const hd = leg.querySelector('.hd'); let drag = null;
    hd.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      drag = { x: e.clientX, y: e.clientY, l: leg.offsetLeft, t: leg.offsetTop }; hd.setPointerCapture(e.pointerId); map.dragging.disable();
    });
    hd.addEventListener('pointermove', e => {
      if (!drag) return;
      const bw = box.clientWidth, bh = box.clientHeight, w = leg.offsetWidth, h = leg.offsetHeight;
      const l = Math.min(Math.max(4, drag.l + e.clientX - drag.x), bw - w - 4), t = Math.min(Math.max(4, drag.t + e.clientY - drag.y), bh - h - 4);
      leg.style.left = l + 'px'; leg.style.top = t + 'px';
      st.fx = (l - 4) / Math.max(1, bw - w - 8); st.fy = (t - 4) / Math.max(1, bh - h - 8); st.moved = true;
    });
    const end = () => { if (drag) { drag = null; map.dragging.enable(); save(); } };
    hd.addEventListener('pointerup', end); hd.addEventListener('pointercancel', end);
    leg.addEventListener('click', e => {
      const b = e.target.closest('[data-lg]'); if (!b) return;
      if (b.dataset.lg === 'min') st.min = !st.min;
      else if (b.dataset.lg === 'full') { st.full = !st.full; }
      else { const C4 = [[1, 0], [1, 1], [0, 1], [0, 0]], i = C4.findIndex(c => Math.abs((st.fx ?? 1) - c[0]) < .05 && Math.abs((st.fy ?? 0) - c[1]) < .05); [st.fx, st.fy] = C4[(i + 1) % 4]; st.moved = true; }
      b.textContent = b.dataset.lg === 'min' ? (st.min ? '+' : '–') : b.textContent; place(); save();
    });
    if (st.min) leg.querySelector('[data-lg="min"]').textContent = '+';
    renderLegend(); place();
    leg.autoCorner = () => {
      if (st.moved || !pts) return;
      const r = box.getBoundingClientRect(), w = leg.offsetWidth, h = leg.offsetHeight;
      const C4 = [[1, 0], [0, 1], [1, 1], [0, 0]];
      const sc = C4.map(([fx, fy]) => {
        const l = (r.width - w - 8) * fx + 4, t = (r.height - h - 8) * fy + 4; let hit = 0;
        pts.forEach(p => { const q = map.latLngToContainerPoint(pr.back(p).slice().reverse()); if (q.x > l && q.x < l + w && q.y > t && q.y < t + h) hit++; });
        for (let gx = 0; gx < 6; gx++) for (let gy = 0; gy < 6; gy++) { const x = l + w * (gx + .5) / 6, y = t + h * (gy + .5) / 6, ll = map.containerPointToLatLng([x, y]), q = pr.to([ll.lng, ll.lat]); if (G.inside(q[0], q[1], pts)) hit++; }
        return hit;
      });
      const best = sc.indexOf(Math.min(...sc)); [st.fx, st.fy] = C4[best]; place();
    };
    if (window.ResizeObserver) new ResizeObserver(place).observe(box); else window.addEventListener('resize', place);
  }

  /* ---------- 구역 불러오기 ---------- */
  function fillSel() {
    const saved = JbsSite.list(), urb = JbsSite.urbanZones();
    $('#siteSel').innerHTML = '<option value="">구역 불러오기…</option>' +
      (saved.length ? `<optgroup label="저장한 구역">${saved.map(x => `<option value="s:${x.id}"${site && site.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '') +
      (urb.length ? `<optgroup label="/urban 정비계획 검토의 안">${urb.map(x => `<option value="u:${x.key}">${x.key}안 가져오기</option>`).join('')}</optgroup>` : '');
  }
  function ringOf(gj) {
    const g = gj.geometry || gj; if (g.type === 'Polygon') return g.coordinates[0];
    if (g.type === 'MultiPolygon') return g.coordinates.map(c => c[0]).sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
    return null;
  }
  function load(s) {
    site = s; site.v = site.v || {}; alts = []; cur = 0; sunRes = null; $('#out').hidden = true; $('#confirm').disabled = true;
    lyrEx.clearLayers(); lyrBld.clearLayers();
    if (!site.geojson) { pts = null; drawSite(); setP(defaults()); fillSel(); msg('구역이 없습니다. 지도 왼쪽 위 다각형 도구로 구역계를 그리거나 저장한 구역을 불러오세요.'); return; }
    const ring = G.openRing(ringOf(site.geojson)); pr = G.projector(ring); pts = G.ccw(ring.map(pr.to));
    const a = site.arch || {};
    tags = (a.tags && a.tags.length === pts.length) ? a.tags.slice() : null;
    entries = a.entries || []; exclude = (a.exclude || []).map(ex => ex.map(pr.to));
    exclude.forEach(ex => lyrEx.addLayer(L.polygon(ex.map(p => pr.back(p).slice().reverse()), { color: '#5d7f5a' })));
    setP(Object.assign(defaults(), filled(a.params)));
    if (!tags) { tags = pts.map(() => 'boundary'); autoTag(); }
    const nBefore = entries.length; cleanEntries(); if (entries.length !== nBefore) saveState();
    if (!num($('#p_siteArea').value)) $('#p_siteArea').value = Math.round(turf.area(site.geojson) * 10) / 10;
    drawSite(); fillSel();
    try { map.fitBounds(L.polygon(pts.map(p => pr.back(p).slice().reverse())).getBounds(), { padding: [20, 20] }); } catch (e) { /* 무시 */ }
    setTimeout(() => { try { if (leg && leg.autoCorner) leg.autoCorner(); } catch (e) { /* 자동 위치 실패 시 그대로 */ } }, 300);
    try { localStorage.setItem('jbs.sites.current', site.id || ''); } catch (e) { /* 무시 */ }
    carry();
  }
  // 다른 검토에서 넘어온 조건 안내
  function carry() {
    const c = site.constraints || {}, out = [];
    if (c.traffic) out.push(`교통: 진입도로 필요 폭 ${c.traffic.진입도로_필요폭_m ?? '○○'}m, 진입 가능 도로 ${esc((c.traffic.진입_가능_도로 || []).join(', ') || '○○')}${(c.traffic.확폭_검토_도로 || []).length ? ', 확폭 검토 ' + esc(c.traffic.확폭_검토_도로.map(x => x.도로).join(', ')) : ''} → 차량 출입구를 이 도로 쪽에 찍으세요`);
    if (c.env) out.push(`환경: 소음 검토 도로 ${esc((c.env.소음_검토_도로 || []).join(', ') || '없음')} → 해당 변을 '간선도로'로, ${c.env.북측_일조_높이제한 ? '북측 인접 주거지 → 정북 변 지정' : '북측 일조 해당 없음'}`);
    $('#carry').innerHTML = out.length ? '<b>다른 검토에서 넘어온 조건</b><br>' + out.map(x => '· ' + x).join('<br>') : '교통성·환경성 검토서를 먼저 만들면 그 결과(진입 도로, 소음 도로, 정북 일조)가 여기에 안내됩니다.';
  }

  /* ---------- 배치 계산 ---------- */
  function buildInput() {
    const p = P(), A = Object.assign({}, C.가정, { floorHeight_m: +p.fh || C.가정.floorHeight_m, sideGap_m: +p.sideGap, supplyFactor: +p.sf, minFloors: +p.minFloors, maxFloors: +p.maxFloors });
    const sb = tags.map(t => t === 'road' ? +p.roadSb : t === 'arterial' ? +p.artSb : +p.bndSb);
    const siteA = num(p.siteArea) || G.area(pts);
    const exA = exclude.reduce((s, ex) => s + Math.abs(G.area(ex)), 0);
    const lot = exclude.length ? siteA - exA : siteA * (1 - (+p.infra || 0) / 100);
    return {
      site: { pts, tags, setbacks: sb, exclude },
      opt: { units: C.평면, assume: A, mix: { 59: +p.m59 || 0, 84: +p.m84 || 0, 114: +p.m114 || 0 }, spacing: +p.spacing, sun: crit('sunlight_north').이격, lot, far: +p.far, lowriseCap: +p.lowCap || 0, lowriseDist: +p.lowDist || 0, parkWidth: +p.parkW || 0 },
      lot, exA, p,
    };
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  async function run() {
    if (!pts) { msg('구역계가 없습니다.', true); return; }
    const I = buildInput();
    if (!(I.lot > 0)) { msg('획지 면적이 0 이하입니다. 구역면적·기반시설 비율을 확인하세요.', true); return; }
    $('#run').classList.add('busy'); saveState();
    try {
      let angles = [num(I.p.angle) || 0];
      if (I.p.angleMode === 'auto') {
        // 후보: -30~30° 5° 간격 + 긴 변 방향(남향에 가까운 쪽으로 맞춘 각)
        const set = new Set(); for (let a = -30; a <= 30; a += 10) set.add(a);
        G.edges(pts).sort((a, b) => b.len - a.len).slice(0, 3).forEach(e => { let a = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI; while (a > 45) a -= 90; while (a < -45) a += 90; if (Math.abs(a) <= 30) set.add(Math.round(a)); });
        angles = [...set];
      }
      let best = null, k = 0;
      for (const a of angles) {
        msg(`배치안 계산 중… (방향 ${++k}/${angles.length})`); await tick();
        const r = G.alternatives(I.site, Object.assign({}, I.opt, { angle: a }));
        // 점수: 목표 연면적 충족도 우선, 그다음 남향(각도 작을수록), 건폐율 낮을수록
        const top = r.reduce((m, x) => Math.max(m, x.gfa), 0) / (I.lot * I.opt.far / 100);
        const score = Math.min(top, 1) * 100 - Math.abs(a) * 0.08 - Math.min(...r.map(x => x.bcr)) * 0.02;
        if (!best || score > best.score) best = { score, a, r };
      }
      alts = best.r.map(x => Object.assign(x, { angle: best.a }));
      // 기본 선택: 최고 층수가 25층에 가장 가까운 안(재개발 일반 규모)
      cur = alts.reduce((bi, x, i) => Math.abs(x.maxFloors - 25) < Math.abs(alts[bi].maxFloors - 25) ? i : bi, 0);
      if (I.p.angleMode === 'auto') $('#p_angle').value = best.a;
      sunRes = null; v3 = null;
      $('#out').hidden = false; $('#confirm').disabled = false;
      renderAlts(); showView('plan'); drawBuildingsOnMap();
      const A = alts[cur];
      msg(`${alts.length}개 대안을 만들었습니다(주동 방향 ${best.a >= 0 ? '+' : ''}${best.a}°). 획지 ${fmt(I.lot)}㎡ 기준 목표 용적률 ${fmt(I.opt.far)}%${A.far < I.opt.far * 0.97 ? ' — 이 구역 조건으로는 목표에 못 미칩니다(최대 ' + fmt(Math.max(...alts.map(x => x.far)), 1) + '%)' : ''}.`);
      $('#out').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error(e); msg('배치를 만들지 못했습니다: ' + e.message, true); }
    finally { $('#run').classList.remove('busy'); }
  }
  function invalidate() { if (alts.length) { msg('조건이 바뀌었습니다. [배치안 만들기]를 다시 누르세요.'); } }

  /* ---------- 결과 화면 ---------- */
  function renderAlts() {
    $('#alts').innerHTML = alts.map((a, i) => `<button class="alt" data-alt="${i}" aria-pressed="${i === cur}"><b>${esc(a.label)}</b><span>${a.buildings.length}개동 · ${fmt(a.units)}세대 · 최고 ${a.maxFloors}층<br>용적률 ${fmt(a.far, 1)}% · 건폐율 ${fmt(a.bcr, 1)}%</span></button>`).join('');
  }
  let curView = 'plan';
  function showView(v) {
    curView = v;
    $$('.otabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
    ['plan', 'sun', 'm3d', 'sum', 'unit'].forEach(k => { $('#v' + k).hidden = k !== v; });
    ({ plan: renderPlan, sun: renderSun, m3d: render3d, sum: renderSum, unit: renderUnits })[v]();
  }
  const planOpts = extra => Object.assign({ site: pts, tags, setbacks: buildInput().site.setbacks, exclude, entries, alt: alts[cur], title: site.name || '', coreW: C.가정.coreW_m }, extra || {});
  function renderPlan() { $('#planSvg').innerHTML = D.sitePlan(planOpts()); }

  // 동지 일조: 구역 밖 주변 땅(평지·기존 건물 없음 가정)의 일조 시간
  function computeSun() {
    const A = alts[cur], tol = crit('sun_tolerance');
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const box = [Math.min(...xs) - 60, Math.min(...ys) - 30, Math.max(...xs) + 60, Math.max(...ys) + 90];
    let step = 6; while (((box[2] - box[0]) / step) * ((box[3] - box[1]) / step) > 7000) step += 2;
    const P2 = []; for (let x = box[0]; x <= box[2]; x += step) for (let y = box[1]; y <= box[3]; y += step) if (!G.inside(x, y, pts)) P2.push([x, y]);
    const res = G.sunHours(A.buildings, A.H, pr.lat0, P2, tol);
    const cells = P2.map((p, i) => Object.assign({ p }, res[i]));
    const fail = cells.filter(c => !c.ok);
    sunRes = { alt: cur, cells, step, fail: fail.length, failArea: fail.length * step * step, worst: fail.length ? Math.min(...fail.map(c => c.cont)) : null };
  }
  function renderSun() {
    const t = +$('#sunT').value, hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    $('#sunTv').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const A = alts[cur], s = G.sun(pr.lat0, t);
    const sh = A.buildings.map(b => G.shadow(b.poly, A.H(b.floors), s)).filter(Boolean);
    const tol = crit('sun_tolerance');
    $('#sunNote').innerHTML = sunRes && sunRes.alt === cur
      ? `구역 밖 주변 땅 기준, 동지 ${tol.연속_구간[0]}~${tol.연속_구간[1]}시 연속 ${tol.연속_h}시간과 ${tol.합계_구간[0]}~${tol.합계_구간[1]}시 합계 ${tol.합계_h}시간을 <b>모두</b> 못 채우는 곳: <b>${fmt(sunRes.failArea)}㎡</b>(격자 ${sunRes.step}m)${sunRes.fail ? `, 가장 나쁜 곳 연속 ${fmt(sunRes.worst, 1)}시간` : ''}. 평지·기존 건물 없음 가정이며 판례상 수인한도를 참고한 개략 판정입니다.`
      : '[일조 계산]을 누르면 구역 밖 주변 땅의 동지 일조 시간을 계산합니다(수 초 걸릴 수 있음). 지금은 선택한 시각의 그림자만 보입니다.';
    $('#sunSvg').innerHTML = D.sitePlan(planOpts({ shadowAt: sh, sunGrid: sunRes && sunRes.alt === cur ? sunRes : null }));
  }
  function render3d() {
    const A = alts[cur], blds = A.buildings.map(b => ({ poly: b.poly, h: A.H(b.floors), color: TYPE_HEX[b.t] }));
    if (!v3) v3 = Mass3D.create($('#v3d'), { site: pts, buildings: blds, sunHour: +$('#sun3').value, lat: pr.lat0 });
    else v3.setBuildings(blds);
  }
  function parkingRow(A) {
    if (!TC || !window.TrafficCalc) return '';
    const U = C.평면, a85 = (A.byType[59] || 0) * U[59].전용 + (A.byType[84] || 0) * U[84].전용, a85u = (A.byType[114] || 0) * U[114].전용;
    const pk = TrafficCalc.parking(TC, { units: A.units, units60below: A.byType[59] || 0, area85below: a85, area85above: a85u });
    return `<tr><th>법정 주차대수</th><td>${fmt(pk.legal)}대</td><td class="note">${esc(pk.formula)} — ${esc(pk.basis)}</td></tr>`;
  }
  function renderSum() {
    const A = alts[cur], I = buildInput(), U = C.평면;
    const sp = crit('spacing_ratio'), sn = crit('sunlight_north');
    const types = Object.keys(A.byType).filter(t => A.byType[t]);
    $('#vsum').innerHTML = `
      <div class="kv">
        <div><div class="l">세대수</div><div class="v">${fmt(A.units)}</div></div>
        <div><div class="l">주동</div><div class="v">${A.buildings.length}개동</div></div>
        <div><div class="l">최고 층수 / 높이</div><div class="v">${A.maxFloors}층 / ${fmt(A.maxHeight, 1)}m</div></div>
        <div><div class="l">용적률 (목표 ${fmt(I.opt.far)}%)</div><div class="v">${fmt(A.far, 1)}%</div></div>
        <div><div class="l">건폐율</div><div class="v">${fmt(A.bcr, 1)}%</div></div>
        <div><div class="l">주동 방향</div><div class="v">${A.angle >= 0 ? '+' : ''}${A.angle}°</div></div>
      </div>
      <h3>건축 개요</h3>
      <table><tr><th style="width:160px">구역면적</th><td>${fmt(I.p.siteArea, 1)}㎡</td><td class="note"></td></tr>
      <tr><th>획지(건축대지) 면적</th><td>${fmt(I.lot, 1)}㎡</td><td class="note">${exclude.length ? `그린 기반시설 ${fmt(I.exA)}㎡ 제외` : `기반시설 ${I.p.infra}% 가정`}</td></tr>
      <tr><th>건축면적</th><td>${fmt(A.ba, 1)}㎡</td><td class="note">주동 바닥 합계(부대시설 제외)</td></tr>
      <tr><th>지상 연면적</th><td>${fmt(A.gfa)}㎡</td><td class="note">${types.every(t => +U[t].공급 > 0) ? '타입별 공급면적(전용+주거공용) 합계' : `전용 × 환산계수 ${I.p.sf}`}</td></tr>
      ${parkingRow(A)}</table>
      <h3>평형별 세대 구성</h3>
      <table><tr><th>평형</th><th>전용</th><th>공급</th><th>세대수</th><th>비율</th><th>평면 가정(폭×깊이)</th></tr>
      ${types.map(t => `<tr><td>${esc(U[t].이름)}</td><td>${U[t].전용}㎡</td><td>${U[t].공급 ? U[t].공급 + '㎡' : '–'}</td><td>${fmt(A.byType[t])}</td><td>${fmt(A.byType[t] / A.units * 100, 1)}%</td><td>${U[t].폭}m × ${U[t].깊이}m</td></tr>`).join('')}
      <tr><th>합계</th><td></td><td></td><th>${fmt(A.units)}</th><td>100%</td><td></td></tr></table>
      <h3>동별 개요</h3>
      <table><tr><th>동</th><th>평형</th><th>층당 세대</th><th>층수</th><th>세대수</th><th>높이</th><th>층수 상한(일조·경계)</th></tr>
      ${A.buildings.map(b => `<tr><td>${b.id}</td><td>${b.t}㎡</td><td>${b.n}</td><td>${b.floors}</td><td>${b.n * b.floors}</td><td>${fmt(A.H(b.floors), 1)}m</td><td>${b.cap >= +I.p.maxFloors ? '-' : b.cap + '층'}</td></tr>`).join('')}</table>
      <h3>적용 기준</h3>
      <table><tr><th style="width:160px">인동간격</th><td>앞 동 높이 × ${I.p.spacing}${/확인필요/.test(sp.상태) ? ' <span class="chk">※ 기준 확인 필요</span>' : ''}<br><span class="note">${esc(sp.근거)} — ${esc(sp.상태)}</span></td></tr>
      <tr><th>정북 일조</th><td>높이 10m 이하 ${sn.이격.높이10m이하_m}m, 초과 부분 높이의 1/2 이상(정북 인접대지 변)<br><span class="note">${esc(sn.근거)}</span></td></tr>
      <tr><th>공원·녹지 접함</th><td>북쪽을 향한 공원·녹지 변은 공원 폭 ${I.p.parkW}m 너머 반대편 경계를 정북 기준선으로 계산<br><span class="note">${esc(crit('sun_open_space').근거)} — ${esc(crit('sun_open_space').상태)}</span></td></tr>
      <tr><th>경계 이격</th><td>도로 ${I.p.roadSb}m · 간선도로 ${I.p.artSb}m · 대지경계 ${I.p.bndSb}m · 동 측면 ${I.p.sideGap}m <span class="note">(검토 가정값)</span></td></tr>
      <tr><th>층수 배분</th><td>북쪽 줄을 높게, 남쪽 줄을 낮게(남저북고). 저층 주거 인접 변 ${I.p.lowDist}m 안은 ${I.p.lowCap}층 이하</td></tr></table>`;
  }
  function renderUnits() {
    const A = alts[cur], U = C.평면, types = Object.keys(A.byType).filter(t => A.byType[t]);
    const reps = []; A.buildings.forEach(b => { if (!reps.find(r => r.t === b.t && r.n === b.n)) reps.push(b); });
    $('#plans').innerHTML = types.map(t => `<div>${D.unitPlan(t, U[t])}</div>`).join('') + reps.map(b => `<div>${D.floorPlan(b, U, C.가정.coreW_m)}</div>`).join('');
  }

  /* ---------- 확정·내보내기 ---------- */
  function confirmAlt() {
    const A = alts[cur], I = buildInput(), U = C.평면;
    site.arch = Object.assign(site.arch || {}, {
      tags, entries, exclude: exclude.map(ex => ex.map(pr.back)), params: P(), at: new Date().toLocaleString('sv-SE').slice(0, 16),
      chosen: { label: A.label, angle: A.angle, units: A.units, byType: A.byType, far: A.far,
        supply: Object.fromEntries(Object.keys(A.byType).map(t => [t, +U[t].공급 > 0 ? +U[t].공급 : Math.round(U[t].전용 * (+I.p.sf || C.가정.supplyFactor) * 10) / 10])),
        exclusive: Object.fromEntries(Object.keys(A.byType).map(t => [t, U[t].전용])), bcr: A.bcr, gfa: A.gfa, lot: I.lot, maxFloors: A.maxFloors, maxHeight: A.maxHeight,
        buildings: A.buildings.map(b => ({ id: b.id, t: b.t, n: b.n, floors: b.floors, H: A.H(b.floors), poly: b.poly.map(pr.back) })) },
    });
    site.constraints = site.constraints || {};
    site.constraints.arch = { 배치안: A.label, 세대수: A.units, 동수: A.buildings.length, 최고층수: A.maxFloors, 최고높이_m: Math.round(A.maxHeight * 10) / 10, 용적률: Math.round(A.far * 10) / 10, 건폐율: Math.round(A.bcr * 10) / 10,
      일조_미달_면적_제곱미터: sunRes && sunRes.alt === cur ? Math.round(sunRes.failArea) : '일조 계산 전', at: site.arch.at };
    // 다른 검토서가 같은 값을 쓰도록 계획 규모 갱신
    Object.assign(site.v, { units: String(A.units), floors: String(A.maxFloors), far: String(Math.round(A.far * 10) / 10), bcr: String(Math.round(A.bcr * 10) / 10), aptGFA: String(Math.round(A.gfa)),
      units60below: String(A.byType[59] || 0), area85below: String((A.byType[59] || 0) * U[59].전용 + (A.byType[84] || 0) * U[84].전용), area85above: String((A.byType[114] || 0) * U[114].전용) });
    JbsSite.save(site);
    msg(`'${A.label}'을 확정했습니다. 세대수·층수·전용면적 합계가 교통성·환경성 검토와 높이·경관계획에 그대로 들어갑니다. 사업성 화면의 [사업성 가정값]에서 '세대수 기준'을 이 안으로 고르면 평형별 세대수 그대로 비례율이 계산됩니다.`);
    const nx = $('#nextSteps'), sid = encodeURIComponent(site.id || '');
    nx.innerHTML = `<b>다음 단계</b> — 이 배치로 바로 검토서 만들기:
      <a class="btnlink primary" href="../traffic/?site=${sid}&make=1">교통성 검토서 →</a>
      <a class="btnlink" href="../env/?site=${sid}&make=1">환경성 검토서 →</a>
      <a class="btnlink" href="../landscape/?site=${sid}&make=1">높이·경관계획 →</a>`;
    nx.hidden = false; nx.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const svgBlob = svg => new Blob([svg], { type: 'image/svg+xml' });
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 3000); }
  function svgToPng(svg, width = 2400) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(svgBlob(svg));
      img.onload = () => { const r = img.height / img.width, c = document.createElement('canvas'); c.width = width; c.height = Math.round(width * r); const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/png')); };
      img.onerror = rej; img.src = url;
    });
  }
  const fname = s => `${(site.name || '구역').replace(/[\\/:*?"<>|]/g, '')}_${s}`;
  async function exportDoc() {
    const A = alts[cur];
    renderSum(); renderUnits();
    const planPng = await svgToPng(D.sitePlan(planOpts()));
    let shot = ''; if (v3) shot = v3.png();
    const units = await Promise.all(Object.keys(A.byType).filter(t => A.byType[t]).map(t => svgToPng(D.unitPlan(t, C.평면[t]), 900)));
    const sumHtml = $('#vsum').innerHTML.replace(/<div class="kv">[\s\S]*?<\/div>\s*<\/div>\s*<h3>/, '<h3>');
    const html = `<html><head><meta charset="utf-8"><style>body{font-family:'맑은 고딕',sans-serif;font-size:10.5pt}h1{text-align:center;font-size:16pt}h2,h3{font-size:12pt;border-bottom:1.2pt solid #000;margin-top:16pt}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:3pt 5pt;font-size:9.5pt;vertical-align:top}.note{color:#555;font-size:8.5pt}.chk{color:#9a6a10}</style></head><body>
      <h1>${esc(site.name || '')} 개략 건축계획(초안)</h1><p style="text-align:center;color:#555">작성일 ${new Date().toLocaleDateString('ko-KR')} · jbslab /arch 자동 작성 개략안 — 설계도면 아님, 검토자 확인 후 사용</p>
      <h2>1. 개략 배치도 — ${esc(A.label)}</h2><img src="${planPng}" width="640">
      ${shot ? `<h2>2. 매스 투시도(동지 정오 그림자)</h2><img src="${shot}" width="640">` : ''}
      <h2>${shot ? 3 : 2}. 건축 개요 및 세대 구성</h2>${sumHtml}
      <h2>${shot ? 4 : 3}. 표준 단위세대 평면(예시)</h2>${units.map(u => `<img src="${u}" width="300">`).join(' ')}
      <p class="note">표준 평면은 배치 검토용 예시 치수이며 실제 설계가 아닙니다. 인동간격·이격 등 '검토 가정값'은 인천광역시 건축 조례 원문과 대조가 필요합니다.</p></body></html>`;
    download(new Blob(['﻿' + html], { type: 'application/msword' }), fname('개략건축계획_초안.doc'));
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'run') run();
    else if (t.id === 'confirm') confirmAlt();
    else if (t.id === 'autoTag') { if (pts) autoTag(); }
    else if (t.id === 'mEdge' || t.id === 'mEntry') { mode = t.id === 'mEdge' ? 'edge' : 'entry'; $('#mEdge').setAttribute('aria-pressed', mode === 'edge'); $('#mEntry').setAttribute('aria-pressed', mode === 'entry'); $('#modeHint').textContent = mode === 'edge' ? '지금: 경계 성격 바꾸기 — 경계선을 누를 때마다 성격이 바뀝니다(곡선처럼 이어진 짧은 변은 한꺼번에).' : '지금: 차량 출입구 찍기 — 도로 쪽 경계선(파랑·보라)을 누르면 출입구가 찍힙니다. 다 찍었으면 [경계 성격 바꾸기]를 눌러 빠져나오세요.'; if (pts) drawSite(); msg(mode === 'entry' ? '도로 쪽 경계선(파랑·보라)을 누르면 차량 출입구가 찍힙니다(최대 3곳, 표시 근처를 다시 누르면 지움).' : ''); }
    else if (t.dataset.alt !== undefined) { cur = +t.dataset.alt; renderAlts(); drawBuildingsOnMap(); showView(curView); }
    else if (t.dataset.v) showView(t.dataset.v);
    else if (t.id === 'calcSun') { t.classList.add('busy'); msg('동지 일조 계산 중…'); await tick(); await tick(); computeSun(); renderSun(); t.classList.remove('busy'); msg(''); }
    else if (t.dataset.cam && v3) ({ sw: () => v3.bird(-0.75, 0.55), se: () => v3.bird(0.75, 0.55), n: () => v3.bird(Math.PI, 0.5), top: () => v3.bird(0.001, 1.45) })[t.dataset.cam]();
    else if (t.id === 'dl3d' && v3) { const a = document.createElement('a'); a.href = v3.png(); a.download = fname('매스투시도.png'); a.click(); }
    else if (t.id === 'dlSvg') download(svgBlob(D.sitePlan(planOpts())), fname('개략배치도.svg'));
    else if (t.id === 'dlPng') { const u = await svgToPng(D.sitePlan(planOpts())); const a = document.createElement('a'); a.href = u; a.download = fname('개략배치도.png'); a.click(); }
    else if (t.id === 'dlDoc') exportDoc();
  });
  $('#sunT').addEventListener('input', () => { if (alts.length) renderSun(); });
  $('#sun3').addEventListener('input', e => { const v = +e.target.value, h = Math.floor(v); $('#sun3v').textContent = `${String(h).padStart(2, '0')}:${String(Math.round((v - h) * 60)).padStart(2, '0')}`; if (v3) v3.setSun(v, pr.lat0); });
  $('#p_angleMode').addEventListener('change', () => { $('#p_angle').disabled = $('#p_angleMode').value === 'auto'; });
  Object.values(FIELDS).forEach(id => $('#' + id).addEventListener('change', () => { saveState(); invalidate(); renderLegend(); }));
  $('#siteSel').addEventListener('change', e => {
    const x = e.target.value; if (!x) return;
    if (x.startsWith('s:')) load(JbsSite.get(x.slice(2)));
    else { const s = JbsSite.fromUrban(x.slice(2)); if (s) load(s); }
  });

  /* ---------- 시작 ---------- */
  initMap();
  Promise.all(['../shared/criteria/arch.json', '../shared/criteria/traffic.json'].map(u => fetch(u + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null)))
    .then(([c, tc]) => {
      if (!c) { msg('기준표(arch.json)를 읽지 못했습니다. 사이트 주소로 열어 주세요.', true); return; }
      C = c; TC = tc; initLegend();
      const sp = crit('spacing_ratio');
      $('#ruleNote').textContent = `인동간격 기본값 ${sp.값}배는 검토 가정값입니다(법 하한 ${sp.법정하한}배, 인천시 건축 조례 확인 필요). 층고·코어·이격·평면 공급면적도 가정값입니다.`;
      const q = new URLSearchParams(location.search);
      let first = q.get('urban') ? JbsSite.fromUrban(q.get('urban')) : null;
      if (!first && q.get('site')) first = JbsSite.get(q.get('site'));
      if (!first) { let cur2 = ''; try { cur2 = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { cur2 = ''; } first = cur2 ? JbsSite.get(cur2) : null; }
      if (!first) { const u = JbsSite.urbanZones(); first = u.length ? JbsSite.fromUrban(u[0].key) : null; }
      load(first || { name: '', v: {} });
    });
})();
