'use strict';
// /arch 개략 건축계획 — 구역 경계 성격 지정 → 배치 대안 3개 → 배치도·동지 일조·3D·개요·표준 평면 → 확정하면 다른 도구로 이어짐
(function () {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const G = ArchGeom, D = ArchDraw;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const fmt = (v, d = 0) => num(v) === null ? '○○' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: d });
  const TAGS = ['boundary', 'road', 'arterial', 'north', 'park', 'lowrise'];
  const TYPE_HEX = { 39: 0xf6e7e1, 49: 0xf3ead2, 59: 0xf3e6c8, 74: 0xe2ead0, 84: 0xd9eadc, 101: 0xd6e3e8, 114: 0xdde5f1 };
  let C = null, TC = null, site = null, pr = null, pts = null, tags = [], entries = [], exclude = [], exKinds = [], exFrom = '';
  let alts = [], cur = 0, map, lyrSite, lyrEdges, lyrEx, lyrBld, mode = 'edge', v3 = null, sunRes = null, ctx = [];

  const msg = (t, bad) => { const m = $('#msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; m.style.background = bad ? 'var(--bad-soft)' : 'var(--accent-soft)'; };
  const crit = id => C.items.find(i => i.id === id);

  /* ---------- 조건 입력 ---------- */
  const FIELDS = { siteArea: 'p_siteArea', infra: 'p_infra', far: 'p_far', maxFloors: 'p_maxFloors', angleMode: 'p_angleMode', form: 'p_form', angle: 'p_angle', spacing: 'p_spacing', sideGap: 'p_sideGap', roadSb: 'p_roadSb', artSb: 'p_artSb', bndSb: 'p_bndSb', lowCap: 'p_lowCap', lowDist: 'p_lowDist', parkPer: 'p_parkPer', parkW: 'p_parkW', minFloors: 'p_minFloors', fh: 'p_fh', sf: 'p_sf' };
  function defaults() {
    const A = C.가정; let U = {}; try { U = JSON.parse(localStorage.getItem('jbs-urban-plan') || '{}'); } catch (e) { U = {}; }
    const v = site.v || {};
    return {
      siteArea: v.siteArea || '', infra: U.infraRatio ?? 25, far: v.far || U.farCustom || 250, maxFloors: A.maxFloors,
      angleMode: 'auto', angle: 0, form: 'slab',
      spacing: crit('spacing_ratio').값, sideGap: A.sideGap_m, roadSb: A.roadSetback_m, artSb: A.arterialSetback_m, bndSb: A.boundarySetback_m,
      lowCap: 15, lowDist: 30, parkPer: A.parkPerUnitPlan ?? 1.2, parkW: A.parkWidth_m ?? 20, minFloors: A.minFloors, ...defaultMix(), fh: A.floorHeight_m, sf: U.supplyFactor ?? A.supplyFactor,
    };
  }
  const TYPES = () => Object.keys(C.평면).filter(k => /^\d+$/.test(k));
  function initMix() {
    const box = $('#mixBox'); if (!box || box.dataset.ok) return; box.dataset.ok = 1;
    box.innerHTML = TYPES().map(t => `<label>${t}㎡형<input id="p_m${t}" inputmode="decimal" placeholder="0"></label>`).join('') + '<div id="mixSum" class="note" style="grid-column:1/-1"></div>';
    TYPES().forEach(t => { FIELDS['m' + t] = 'p_m' + t; $('#p_m' + t).addEventListener('input', mixSum); $('#p_m' + t).addEventListener('change', () => { saveState(); invalidate(); }); });
    const pre = C.평형구성_예시 || {};
    $('#mixPresets').innerHTML = Object.keys(pre).map(k => `<button type="button" data-mixpre="${esc(k)}">${esc(k)}</button>`).join('');
  }
  function mixSum() {
    const v = TYPES().map(t => +($('#p_m' + t).value || 0)), sum = v.reduce((a, b) => a + b, 0);
    const small = TYPES().filter(t => +t <= 60).reduce((a, t) => a + +($('#p_m' + t).value || 0), 0), u85 = TYPES().filter(t => +t <= 85).reduce((a, t) => a + +($('#p_m' + t).value || 0), 0);
    $('#mixSum').textContent = sum ? `합 ${sum}% (비율로 나눠 씀) · 전용 60㎡ 이하 ${Math.round(small / sum * 100)}% · 85㎡ 이하 ${Math.round(u85 / sum * 100)}%` : '평형 비율을 하나 이상 넣으세요';
  }
  function defaultMix() {
    let U = {}; try { U = JSON.parse(localStorage.getItem('jbs-urban-plan') || '{}'); } catch (e) { U = {}; }
    const o = {}; TYPES().forEach(t => { o['m' + t] = ''; });
    const base = (C.평형구성_예시 || {})['재개발 일반'] || { 59: 40, 84: 50, 114: 10 };
    Object.entries(base).forEach(([t, v]) => { o['m' + t] = v; });
    return o;
  }
  const P = () => { const o = {}; Object.entries(FIELDS).forEach(([k, id]) => { o[k] = $('#' + id).value; }); return o; };
  function setP(o) { Object.entries(FIELDS).forEach(([k, id]) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') $('#' + id).value = o[k]; }); $('#p_angle').disabled = $('#p_angleMode').value === 'auto'; }
  const filled = o => { const r = {}; Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') r[k] = v; }); return r; };
  function saveState() {
    if (!site) return;
    site.arch = Object.assign(site.arch || {}, { tags, entries, exclude: exclude.map(ex => ex.map(pr.back)), exKinds, exFrom, params: P() });
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
    exclude = []; exKinds = [];
    lyrEx.eachLayer(l => { const c = l.toGeoJSON().geometry.coordinates[0]; exclude.push(G.openRing(c).map(pr.to)); exKinds.push(l.options.kind || '직접 그림'); });
    exFrom = 'manual'; saveState(); invalidate();
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
    A.buildings.forEach(b => (b.parts || [b.poly]).forEach(q => L.polygon(q.map(p => pr.back(p).slice().reverse()), { color: '#1d2a33', weight: 1, fillColor: '#f2f0ea', fillOpacity: .9 }).bindTooltip(`${b.id}동 ${b.floors}층 · ${G.FORM_NAME[b.form] || ''} ${b.t}㎡ ${b.n}호`).addTo(lyrBld)));
  }

  // 경계 자동 지정: /urban 주변 도로 → 도로(폭 20m 이상 간선), 북쪽을 향한 변 → 정북 인접대지
  // 교통성·환경성 검토 결과 → 경계 성격·차량 출입구
  //  환경: 소음 검토 도로 → '간선도로'(소음 이격), 북측 일조 해당 없음 → 정북 지정 안 함
  //  교통: 진입 가능 도로(확폭 검토 도로 포함) 쪽 변에 주출입·부출입
  const reviewKey = () => { const c = site.constraints || {}; return JSON.stringify([c.traffic && [c.traffic.진입_가능_도로, c.traffic.확폭_검토_도로], c.env && [c.env.소음_검토_도로, c.env.북측_일조_높이제한]]); };
  function autoTag(opt = {}) {
    const c = site.constraints || {}, envC = c.env, trC = c.traffic;
    const noisy = new Set((envC && envC.소음_검토_도로) || []);
    const entryOK = trC ? [...(trC.진입_가능_도로 || []), ...((trC.확폭_검토_도로 || []).map(x => x.도로))] : [];
    const roads = ((site.profile || {}).roadGeoms || []).map(r => {
      const g = r.geom; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c2 => c2[0]) : [];
      return { name: r.name, w: r.w, polys: rings.map(rg => G.openRing(rg).map(pr.to)) };
    });
    const E = G.edges(pts), edgeRoad = [];
    const noNorth = !!envC && !envC.북측_일조_높이제한;
    tags = E.map((e, i) => {
      const m = [(e.a[0] + e.b[0]) / 2 + e.out[0] * 3, (e.a[1] + e.b[1]) / 2 + e.out[1] * 3];
      const hit = roads.find(r => r.polys.some(pl => G.inside(m[0], m[1], pl) || pl.some((q, k) => G.segDist(m, q, pl[(k + 1) % pl.length]) < 4)));
      if (hit) { edgeRoad[i] = hit.name; return hit.w >= 20 || noisy.has(hit.name) ? 'arterial' : 'road'; }
      return !noNorth && e.out[1] > 0.6 ? 'north' : 'boundary';
    });
    const done = [];
    if (opt.entries || !entries.length) {
      // 진입 가능 도로마다 그 도로에 붙은 가장 긴 변 가운데(최대 2곳). 검토 결과가 없으면 가장 긴 도로 변 하나
      const pickEdge = name => E.map((e, i) => ({ e, i })).filter(x => (name ? edgeRoad[x.i] === name : ['road', 'arterial'].includes(tags[x.i]))).sort((a, b) => b.e.len - a.e.len)[0];
      const ne = [];
      (entryOK.length ? [...new Set(entryOK)] : [null]).forEach(nm => { if (ne.length >= 2) return; const x = pickEdge(nm); if (x && !ne.some(q => q.edge === x.i)) ne.push({ edge: x.i, t: 0.5 }); });
      if (ne.length) { entries = ne; done.push(`차량 출입구 ${ne.length}곳(${entryOK.length ? '교통성 검토의 진입 가능 도로' : '가장 긴 도로 변'})`); }
    }
    site.arch = Object.assign(site.arch || {}, { reviewKey: reviewKey() });
    cleanEntries(); drawSite(); saveState(); invalidate();
    const ar = tags.filter(t => t === 'arterial').length;
    if (envC) done.unshift(`소음 검토 도로 변 ${ar}개를 간선도로(소음 이격)로${noNorth ? ', 북측 일조 해당 없음 → 정북 변 지정 안 함' : ''}`);
    msg((roads.length ? '/urban 주변 도로 자료로 도로 변을, 방향으로 정북 변을 정했습니다.' : '도로 자료가 없어 방향만으로 정했습니다(북쪽을 향한 변 = 정북 인접대지).')
      + (done.length ? ((c.traffic || c.env) ? ' 검토 결과 반영: ' : ' 자동 지정: ') + done.join(', ') + '.' : '') + (c.traffic || c.env ? '' : ' 교통성·환경성 검토를 먼저 하면 그 결과(소음 도로, 진입 도로, 북측 일조)가 자동으로 반영됩니다.')
      + ' 다른 점은 경계선을 눌러 고치세요.');
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
    entries = a.entries || []; exclude = (a.exclude || []).map(ex => ex.map(pr.to)); exKinds = (a.exKinds || []).slice(); exFrom = a.exFrom || '';
    drawExclude();
    { const sp = filled(a.params); const hasMix = TYPES().some(t => sp['m' + t] !== undefined); const d0 = defaults(); if (hasMix) TYPES().forEach(t => { d0['m' + t] = ''; }); setP(Object.assign(d0, sp)); mixSum(); }
    if (!tags) { tags = pts.map(() => 'boundary'); autoTag(); }
    else if ((site.constraints || {}).traffic || (site.constraints || {}).env) { if ((a.reviewKey || '') !== reviewKey()) autoTag({ entries: true }); }
    const nBefore = entries.length; cleanEntries(); if (entries.length !== nBefore) saveState();
    if (!num($('#p_siteArea').value)) $('#p_siteArea').value = Math.round(turf.area(site.geojson) * 10) / 10;
    drawSite(); fillSel();
    try { map.fitBounds(L.polygon(pts.map(p => pr.back(p).slice().reverse())).getBounds(), { padding: [20, 20] }); } catch (e) { /* 무시 */ }
    setTimeout(() => { try { if (leg && leg.autoCorner) leg.autoCorner(); } catch (e) { /* 자동 위치 실패 시 그대로 */ } }, 300);
    try { localStorage.setItem('jbs.sites.current', site.id || ''); } catch (e) { /* 무시 */ }
    // /urban 정비계획의 기반시설(도로 확폭·공원·학교·종교용지)을 건축 불가 영역으로 — 직접 고친 적이 없을 때만 자동
    const inf = site.urbanInfra;
    if (inf && (!exclude.length || (exFrom.startsWith('urban:') && exFrom !== 'urban:' + inf.at))) importInfra(true);
    carry(); renderStage();
    loadContext(false).then(() => { if (ctx.length && !alts.length) msg(`주변 기존 건물 ${fmt(ctx.length)}동을 일조 분석에 반영합니다.`); });
  }
  function drawExclude() {
    lyrEx.clearLayers();
    exclude.forEach((ex, i) => lyrEx.addLayer(L.polygon(ex.map(p => pr.back(p).slice().reverse()), { color: '#5d7f5a', kind: exKinds[i] || '직접 그림' }).bindTooltip(exKinds[i] || '건축 불가 영역')));
  }
  function importInfra(auto) {
    const inf = site && site.urbanInfra;
    if (!inf) { if (!auto) msg('이 구역에는 /urban 정비계획의 기반시설 배치가 없습니다. /urban에서 이 안의 [정비기반시설] 탭을 한 번 열면 저장되고, 그다음 이 버튼을 누르세요. 또는 지도 왼쪽 위 다각형 도구로 직접 그리세요.', true); return; }
    const rings = [], kinds = [];
    const add = (g, k) => { if (!g) return; const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; ps.forEach(pc => { const r = G.openRing(pc[0]).map(pr.to); if (Math.abs(G.area(r)) >= 20) { rings.push(r); kinds.push(k); } }); };
    add(inf.road, '도로(확폭·지정)'); add(inf.park, '공원·녹지'); add(inf.school, '학교용지'); add(inf.rel, inf.relKeep ? '종교용지(존치)' : '종교용지(대체부지)');
    (inf.keepRoads || []).forEach(g => add(g, '존치 도로'));
    exclude = rings; exKinds = kinds; exFrom = 'urban:' + inf.at; drawExclude(); saveState(); invalidate();
    const sum = {}; kinds.forEach((k, i) => { sum[k] = (sum[k] || 0) + Math.abs(G.area(rings[i])); });
    msg(`/urban 정비계획(${inf.at})의 기반시설을 건축 불가 영역으로 넣었습니다: ${Object.entries(sum).map(([k, v]) => `${k} ${fmt(v)}㎡`).join(', ') || '없음'}. 획지는 구역에서 이 면적을 뺀 땅입니다.`);
  }
  // 다른 검토에서 넘어온 조건 안내
  function carry() {
    const c = site.constraints || {}, out = [];
    if (c.traffic) out.push(`교통: 진입도로 필요 폭 ${c.traffic.진입도로_필요폭_m ?? '○○'}m, 진입 가능 도로 ${esc((c.traffic.진입_가능_도로 || []).join(', ') || '○○')}${(c.traffic.확폭_검토_도로 || []).length ? ', 확폭 검토 ' + esc(c.traffic.확폭_검토_도로.map(x => x.도로).join(', ')) : ''} → 차량 출입구`);
    if (c.env) out.push(`환경: 소음 검토 도로 ${esc((c.env.소음_검토_도로 || []).join(', ') || '없음')} → 해당 변 '간선도로', ${c.env.북측_일조_높이제한 ? '북측 인접 주거지 → 정북 변 지정' : '북측 일조 해당 없음'}`);
    $('#carry').innerHTML = out.length ? '<b>다른 검토에서 넘어온 조건</b> (경계 성격·출입구에 자동 반영됨) <button id="applyReview" type="button">다시 반영</button><br>' + out.map(x => '· ' + x).join('<br>') : '교통성·환경성 검토서를 먼저 만들면 그 결과(진입 도로, 소음 도로, 정북 일조)가 여기에 안내됩니다.';
  }

  /* ---------- 배치 계산 ---------- */
  function buildInput() {
    const p = P(), A = Object.assign({}, C.가정, { floorHeight_m: +p.fh || C.가정.floorHeight_m, sideGap_m: +p.sideGap, supplyFactor: +p.sf, minFloors: +p.minFloors, maxFloors: +p.maxFloors });
    const sb = tags.map(t => t === 'road' ? +p.roadSb : t === 'arterial' ? +p.artSb : +p.bndSb);
    const siteA = num(p.siteArea) || G.area(pts);
    const exA = exclude.reduce((s, ex) => { try { const g = turf.intersect(turf.polygon([ex.concat([ex[0]]).map(pr.back)]), site.geojson.geometry ? site.geojson : turf.feature(site.geojson)); return s + (g ? turf.area(g) : 0); } catch (e) { return s + Math.abs(G.area(ex)); } }, 0);
    const lot = exclude.length ? siteA - exA : siteA * (1 - (+p.infra || 0) / 100);
    return {
      site: { pts, tags, setbacks: sb, exclude },
      opt: { units: C.평면, assume: A, mix: Object.fromEntries(TYPES().map(t => [t, +p['m' + t] || 0]).filter(([, x]) => x > 0)), form: p.form === 'compare' ? 'slab' : (p.form || 'slab'), spacing: +p.spacing, sun: crit('sunlight_north').이격, lot, far: +p.far, lowriseCap: +p.lowCap || 0, lowriseDist: +p.lowDist || 0, parkWidth: +p.parkW || 0, exSetback: +p.bndSb || 0 },
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
        G.edges(pts).sort((a, b) => b.len - a.len).slice(0, 3).forEach(e => { let a = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) * 180 / Math.PI; while (a > 45) a -= 90; while (a < -45) a += 90; if (Math.abs(a) <= 45) set.add(Math.round(a)); });
        angles = [...set];
      }
      // 방향별로 대안을 만들어 가장 좋은 방향 고르기. 점수: 목표 연면적 충족도 우선, 그다음 남향(각도 작을수록), 건폐율 낮을수록
      async function searchAngle(form, label) {
        // 방향 고르기는 빠른 추정(기준 층수 2개로만 배치)으로, 대안 3개는 고른 방향에서만 자세히 계산
        const As = I.opt.assume, Fs = [Math.round((As.minFloors + As.maxFloors) / 2), Math.round(As.minFloors + (As.maxFloors - As.minFloors) * 0.8)];
        let b = null, k = 0;
        for (const a of angles) {
          msg(`배치안 계산 중… ${label ? label + ' · ' : ''}방향 ${++k}/${angles.length}`); await tick();
          let top = 0, bcr = 100;
          for (const F of Fs) { try { const r = G.layout(I.site, Object.assign({}, I.opt, { angle: a, form, fixedF: F })); if (r.units) { top = Math.max(top, r.gfa); bcr = Math.min(bcr, r.bcr); } } catch (e) { /* 건너뜀 */ } }
          if (!top) continue;
          const score = Math.min(top / (I.lot * I.opt.far / 100), 1) * 100 - Math.abs(a) * 0.08 - bcr * 0.02;
          if (!b || score > b.score) b = { score, a };
        }
        if (!b) return null;
        msg(`배치안 계산 중… ${label ? label + ' · ' : ''}대안 만들기(방향 ${b.a}°)`); await tick();
        try { b.r = G.alternatives(I.site, Object.assign({}, I.opt, { angle: b.a, form })); } catch (e) { return null; }
        return b.r.length ? b : null;
      }
      const best = await searchAngle(I.opt.form, I.p.form === 'compare' ? '판상형' : '');
      if (!best) throw new Error('어느 방향으로도 동이 들어가지 않습니다');
      alts = best.r.map(x => Object.assign(x, { angle: best.a, form: I.opt.form }));
      if (I.p.form === 'compare') {
        // 형태 비교: 같은 방향에서 형태마다 대안을 만들고, 형태별로 최고 층수 25층에 가장 가까운 안 하나씩
        alts = [];
        for (const fm of ['slab', 'tower', 'mix', 'Y', 'L', 'court']) {
          // 형태마다 방향을 따로 찾음(판상은 남향, 탑상은 구역 긴 변 쪽이 유리한 경우가 많음)
          const bf = fm === 'slab' ? best : await searchAngle(fm, G.FORM_NAME[fm]);
          if (!bf) continue;
          const r = bf.r.filter(x => x.units > 0); if (!r.length) continue;
          const reach = r.filter(x => x.gfa >= x.target * 0.97), pool = reach.length ? reach : r;
          const pick = reach.length ? pool.reduce((m, x) => Math.abs(x.maxFloors - 25) < Math.abs(m.maxFloors - 25) ? x : m, pool[0]) : pool.reduce((m, x) => x.gfa > m.gfa ? x : m, pool[0]);
          alts.push(Object.assign(pick, { angle: bf.a, form: fm, label: `${G.FORM_NAME[fm]} · ${pick.label}` }));
        }
        if (!alts.length) throw new Error('어느 형태도 들어가지 않습니다');
      } else alts.forEach(x => { x.label = `${G.FORM_NAME[I.opt.form] || '판상형'} · ${x.label}`; });
      // 기본 선택: 최고 층수가 25층에 가장 가까운 안(재개발 일반 규모)
      cur = alts.reduce((bi, x, i) => Math.abs(x.maxFloors - 25) < Math.abs(alts[bi].maxFloors - 25) ? i : bi, 0);
      if (I.p.form === 'compare') cur = alts.reduce((bi, x, i) => (x.gfa > alts[bi].gfa * 1.01 || (x.gfa > alts[bi].gfa * 0.99 && x.units > alts[bi].units)) ? i : bi, 0);
      if (I.p.angleMode === 'auto') $('#p_angle').value = alts[cur].angle;
      sunRes = null; v3 = null;
      $('#out').hidden = false; $('#confirm').disabled = false;
      renderAlts(); showView('plan'); drawBuildingsOnMap();
      const A = alts[cur];
      msg(`${alts.length}개 대안을 만들었습니다(${I.p.form === 'compare' ? '형태마다 방향을 따로 찾음, 선택한 안 ' : '주동 방향 '}${alts[cur].angle >= 0 ? '+' : ''}${alts[cur].angle}°). 획지 ${fmt(I.lot)}㎡ 기준 목표 용적률 ${fmt(I.opt.far)}%${A.far < I.opt.far * 0.97 ? ' — 이 구역 조건으로는 목표에 못 미칩니다(최대 ' + fmt(Math.max(...alts.map(x => x.far)), 1) + '%)' : ''}.`);
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
  const planOpts = extra => Object.assign({ site: pts, tags, setbacks: buildInput().site.setbacks, exclude, exKinds, entries, alt: alts[cur], title: site.name || '', coreW: C.가정.coreW_m }, extra || {});
  function renderPlan() { $('#planSvg').innerHTML = D.sitePlan(planOpts()); }

  // 동지 일조: 구역 밖 주변 땅(평지·기존 건물 없음 가정)의 일조 시간
  /* ---------- 주변 기존 건물(브이월드 GIS건물통합정보) ----------
     구역 밖 150m 안의 건물 바닥 모양·지상 층수 → 일조 분석(기존 그림자 포함, 주변 주택 창 기준 판정)과 3D 주변 매스 */
  const RES_USE = /주택|아파트/;
  function ctxFromItems(items) {
    return (items || []).map(it => ({ poly: it.ring.map(pr.to), h: Math.max(3, (+it.floors || 1) * 3), floors: +it.floors || 1, use: it.use || '', name: it.name || '', res: RES_USE.test(it.use || '') }));
  }
  async function loadContext(force) {
    ctx = []; if (!site || !pts) return;
    if (!force && site.context && site.context.items) { ctx = ctxFromItems(site.context.items); return; }
    if (typeof VWorld === 'undefined' || typeof BldgRows === 'undefined' || !(typeof VWORLD_KEY !== 'undefined' && VWORLD_KEY)) return;
    const [x0, y0, x1, y1] = turf.bbox(site.geojson), dLat = 150 / 110540, dLon = 150 / (Math.cos(pr.lat0 * Math.PI / 180) * 111320);
    try {
      const fs = await VWorld.dataAll('LT_C_BLDGINFO', `BOX(${x0 - dLon},${y0 - dLat},${x1 + dLon},${y1 + dLat})`, 5);
      const zone = site.geojson.geometry ? site.geojson : turf.feature(site.geojson), items = [];
      fs.forEach(f => {
        const g = f.geometry; if (!g) return;
        const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : [];
        const row = BldgRows.fromGis(f);
        rings.forEach(r => {
          if (r.length < 4) return;
          const c = turf.centroid(turf.polygon([r])).geometry.coordinates;
          if (turf.booleanPointInPolygon(c, zone)) return; // 구역 안 건물은 철거 대상
          items.push({ ring: G.openRing(r).map(q => [Math.round(q[0] * 1e7) / 1e7, Math.round(q[1] * 1e7) / 1e7]), floors: row.floors || 1, use: row.use, name: row.name });
        });
      });
      site.context = { at: new Date().toLocaleString('sv-SE').slice(0, 16), items }; JbsSite.save(site);
      ctx = ctxFromItems(items);
      if (force) msg(`주변 건물 ${items.length}동을 불러왔습니다(구역 밖 150m, 브이월드 GIS건물통합정보 지상 층수 × 3m).`);
    } catch (e) { if (force) msg('주변 건물을 불러오지 못했습니다: ' + e.message + ' — 일조는 주변을 빈 땅으로 보고 계산합니다.', true); }
  }
  // 주변 주택의 남쪽(해 드는 쪽) 벽면 측정점: 남향 성분이 있는 변을 3m 간격, 벽에서 0.6m 바깥
  function facadePoints(c) {
    const P = G.ccw(c.poly), out = [];
    P.forEach((a, i) => {
      const b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (L < 1) return;
      const nx = dy / L, ny = -dx / L; if (ny > -0.25) return; // 바깥 법선이 남쪽을 향하는 변만
      const n = Math.max(1, Math.round(L / 3));
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push([a[0] + dx * t + nx * 0.6, a[1] + dy * t + ny * 0.6]); }
    });
    return out;
  }
  function computeSun() {
    if (ctx.length) return computeSunCtx();
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
  // 주변 건물이 있을 때: 기존 건물 그림자만 있을 때(전)와 새 동을 더했을 때(후)를 비교 → 새로 수인한도를 못 채우게 되는 곳만 영향으로 셈
  function computeSunCtx() {
    const A = alts[cur], tol = crit('sun_tolerance'), newB = A.buildings;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const box = [Math.min(...xs) - 60, Math.min(...ys) - 30, Math.max(...xs) + 60, Math.max(...ys) + 90];
    let step = 6; while (((box[2] - box[0]) / step) * ((box[3] - box[1]) / step) > 6000) step += 2;
    const P2 = []; for (let x = box[0]; x <= box[2]; x += step) for (let y = box[1]; y <= box[3]; y += step) if (!G.inside(x, y, pts) && !ctx.some(c => G.inside(x, y, c.poly))) P2.push([x, y]);
    // 영향권(구역에서 북쪽 150m 안) 주택만 측정
    const near = ctx.filter(c => c.res && c.poly.some(p => p[0] > box[0] - 20 && p[0] < box[2] + 20 && p[1] > Math.min(...ys) - 10 && p[1] < Math.max(...ys) + 150));
    const fp = near.map(c => facadePoints(c)), FP = fp.flat();
    const bef = G.sunHours(ctx, A.H, pr.lat0, P2.concat(FP), tol), aft = G.sunHours(ctx.concat(newB), A.H, pr.lat0, P2.concat(FP), tol);
    const cells = P2.map((p, i) => Object.assign({ p }, aft[i], { was: bef[i].ok }));
    const fail = cells.filter(c => !c.ok && c.was);
    let k = P2.length; const houses = near.map((c, i) => {
      const r = fp[i].map(() => ({ b: bef[k], a: aft[k++] }));
      const newly = r.filter(x => x.b.ok && !x.a.ok).length, already = r.filter(x => !x.b.ok).length;
      return { c, n: r.length, newly, already, worst: r.length ? Math.min(...r.map(x => x.a.cont)) : null };
    }).filter(h => h.n);
    sunRes = { alt: cur, cells: cells.filter(c => !c.ok && c.was), step, fail: fail.length, failArea: fail.length * step * step, worst: fail.length ? Math.min(...fail.map(c => c.cont)) : null, houses, ctx: true };
  }
  function renderSun() {
    const t = +$('#sunT').value, hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    $('#sunTv').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const A = alts[cur], s = G.sun(pr.lat0, t);
    const sh = A.buildings.flatMap(b => (b.parts || [b.poly]).map(q => G.shadow(q, A.H(b.floors), s))).concat(ctx.map(c => G.shadow(c.poly, c.h, s))).filter(Boolean);
    const tol = crit('sun_tolerance');
    const hit = sunRes && sunRes.ctx ? sunRes.houses.filter(h => h.newly > 0) : [];
    $('#sunNote').innerHTML = sunRes && sunRes.alt === cur && sunRes.ctx
      ? `주변 기존 건물 ${fmt(ctx.length)}동의 그림자를 넣고, 새 동이 생기기 전·후를 비교했습니다(동지 ${tol.연속_구간[0]}~${tol.연속_구간[1]}시 연속 ${tol.연속_h}시간 또는 ${tol.합계_구간[0]}~${tol.합계_구간[1]}시 합계 ${tol.합계_h}시간). `
        + `<b>주변 주택 ${fmt(sunRes.houses.length)}동 중 ${fmt(hit.length)}동</b>이 새 동 때문에 남쪽 벽면 일부가 수인한도를 못 채우게 됩니다${hit.length ? ` (${hit.slice(0, 8).map(h => `${esc(h.c.name || h.c.use)} ${h.c.floors}층: 측정점 ${h.n}곳 중 ${h.newly}곳`).join(', ')}${hit.length > 8 ? ' 외' : ''})` : ''}. `
        + `이미 기존 건물 때문에 미달인 곳은 영향에서 뺐습니다. 빈 땅 기준 새로 미달: ${fmt(sunRes.failArea)}㎡. 층고 3m 가정·평지 기준 개략 판정입니다.`
      : sunRes && sunRes.alt === cur
      ? `구역 밖 주변 땅 기준, 동지 ${tol.연속_구간[0]}~${tol.연속_구간[1]}시 연속 ${tol.연속_h}시간과 ${tol.합계_구간[0]}~${tol.합계_구간[1]}시 합계 ${tol.합계_h}시간을 <b>모두</b> 못 채우는 곳: <b>${fmt(sunRes.failArea)}㎡</b>(격자 ${sunRes.step}m)${sunRes.fail ? `, 가장 나쁜 곳 연속 ${fmt(sunRes.worst, 1)}시간` : ''}. 평지·기존 건물 없음 가정이며 판례상 수인한도를 참고한 개략 판정입니다.`
      : (ctx.length ? `주변 기존 건물 ${fmt(ctx.length)}동을 반영합니다. ` : '주변 건물 정보가 없어 주변을 빈 땅으로 봅니다. ') + '[일조 계산]을 누르면 동지 일조 시간을 계산합니다(수 초 걸릴 수 있음). 지금은 선택한 시각의 그림자만 보입니다.';
    $('#sunSvg').innerHTML = D.sitePlan(planOpts({ shadowAt: sh, sunGrid: sunRes && sunRes.alt === cur ? sunRes : null, context: ctx, hit: new Set(hit.map(h => h.c)) }));
  }
  function render3d() {
    const A = alts[cur], blds = A.buildings.flatMap(b => (b.parts || [b.poly]).map(q => ({ poly: q, h: A.H(b.floors), color: TYPE_HEX[b.t] })));
    const cx = ctx.map(c => ({ poly: c.poly, h: c.h }));
    if (!v3) v3 = Mass3D.create($('#v3d'), { site: pts, buildings: blds, context: cx, sunHour: +$('#sun3').value, lat: pr.lat0 });
    else v3.setBuildings(blds, cx);
  }
  function parkingRow(A) {
    if (!TC || !window.TrafficCalc) return '';
    const g = groups(A.byType);
    const pk = TrafficCalc.parking(TC, { units: A.units, units60below: g.u60, area85below: g.a85, area85above: g.a85u });
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
      ${parkingRow(A)}${(() => { const X = extras(A, I), cf = crit('community_facility'), mo = crit('mgmt_office'), ck = it => /확인필요/.test(it.상태) ? ' <span class="chk">※ 기준 확인 필요</span>' : '';
        return `<tr><th>계획 주차대수</th><td>${fmt(X.plan)}대</td><td class="note">법정 ${fmt(X.legal)}대와 세대당 ${X.per}대 중 큰 값(세대당 ${fmt(X.plan / (A.units || 1), 2)}대)</td></tr>
        <tr><th>지하주차장</th><td>${fmt(X.ugArea)}㎡ · 지하 ${X.ugFloors ?? '○○'}개층</td><td class="note">1대당 ${C.가정.parkAreaPerStall_m2}㎡(차로·램프 포함 가정), 한 층 = 획지 × ${C.가정.ugFootprintRatio} 가정</td></tr>
        <tr><th>주민공동시설</th><td>${fmt(X.comm)}㎡ 이상${ck(cf)}</td><td class="note">${esc(cf.근거)} — 의무 시설: ${X.must.length ? esc(X.must.join(', ')) : '해당 없음(150세대 미만)'}</td></tr>
        <tr><th>관리사무소·경비실</th><td>${fmt(X.mgmt)}㎡ 이상${ck(mo)}</td><td class="note">${esc(mo.근거)}</td></tr>
        <tr><th>총 연면적(추정)</th><td>${fmt(X.totalGfa)}㎡</td><td class="note">지상 연면적 + 지하주차장 + 주민공동시설 + 관리사무소(공사비 산정 참고, 기계·전기실 등 제외)</td></tr>`; })()}</table>
      ${compareHtml()}
      <h3>평형별 세대 구성</h3>
      <table><tr><th>평형</th><th>전용</th><th>공급</th><th>세대수</th><th>비율</th><th>평면 가정(폭×깊이)</th></tr>
      ${types.map(t => `<tr><td>${esc(U[t].이름)}</td><td>${U[t].전용}㎡</td><td>${U[t].공급 ? U[t].공급 + '㎡' : '–'}</td><td>${fmt(A.byType[t])}</td><td>${fmt(A.byType[t] / A.units * 100, 1)}%</td><td>${U[t].폭}m × ${U[t].깊이}m</td></tr>`).join('')}
      <tr><th>합계</th><td></td><td></td><th>${fmt(A.units)}</th><td>100%</td><td></td></tr>
      <tr><td colspan="6" class="note">전용 60㎡ 이하 ${fmt(groups(A.byType).u60)}세대(${fmt(groups(A.byType).u60 / (A.units || 1) * 100, 1)}%) · 85㎡ 이하 ${fmt(Object.entries(A.byType).filter(([t]) => +t <= 85).reduce((a, [, k]) => a + k, 0) / (A.units || 1) * 100, 1)}% — 주택규모별 건설비율(재개발 국민주택규모 비율·임대 비율 등)은 사업 유형별 고시·조례 확인 필요. 가로주택정비사업 등 소규모주택정비사업은 별도 기준.</td></tr></table>
      <h3>동별 개요</h3>
      <table><tr><th>동</th><th>형태</th><th>평형</th><th>층당 세대</th><th>층수</th><th>세대수</th><th>높이</th><th>층수 상한(일조·경계)</th></tr>
      ${A.buildings.map(b => `<tr><td>${b.id}</td><td>${esc(G.FORM_NAME[b.form] || '판상형')}</td><td>${b.t}㎡</td><td>${b.n}</td><td>${b.floors}</td><td>${b.n * b.floors}</td><td>${fmt(A.H(b.floors), 1)}m</td><td>${b.cap >= +I.p.maxFloors ? '-' : b.cap + '층'}</td></tr>`).join('')}</table>
      <h3>적용 기준</h3>
      <table><tr><th style="width:160px">인동간격</th><td>앞 동 높이 × ${I.p.spacing}${/확인필요/.test(sp.상태) ? ' <span class="chk">※ 기준 확인 필요</span>' : ''}<br><span class="note">${esc(sp.근거)} — ${esc(sp.상태)}</span></td></tr>
      <tr><th>정북 일조</th><td>높이 10m 이하 ${sn.이격.높이10m이하_m}m, 초과 부분 높이의 1/2 이상(정북 인접대지 변)<br><span class="note">${esc(sn.근거)}</span></td></tr>
      <tr><th>공원·녹지 접함</th><td>북쪽을 향한 공원·녹지 변은 공원 폭 ${I.p.parkW}m 너머 반대편 경계를 정북 기준선으로 계산<br><span class="note">${esc(crit('sun_open_space').근거)} — ${esc(crit('sun_open_space').상태)}</span></td></tr>
      <tr><th>경계 이격</th><td>도로 ${I.p.roadSb}m · 간선도로 ${I.p.artSb}m · 대지경계 ${I.p.bndSb}m · 동 측면 ${I.p.sideGap}m <span class="note">(검토 가정값)</span></td></tr>
      <tr><th>층수 배분</th><td>북쪽 줄을 높게, 남쪽 줄을 낮게(남저북고). 저층 주거 인접 변 ${I.p.lowDist}m 안은 ${I.p.lowCap}층 이하</td></tr></table>`;
  }
  function renderUnits() {
    const A = alts[cur], U = C.평면, types = Object.keys(A.byType).filter(t => A.byType[t]);
    const reps = []; A.buildings.forEach(b => { if (!reps.find(r => r.t === b.t && r.n === b.n && r.form === b.form)) reps.push(b); });
    $('#plans').innerHTML = types.map(t => `<div>${D.unitPlan(t, U[t])}</div>`).join('') + reps.map(b => `<div>${D.floorPlan(b, U, C.가정.coreW_m)}</div>`).join('');
  }

  // 2차(정밀) 항목: 법정·계획 주차, 지하주차장 규모, 주민공동시설·관리사무소 면적
  function extras(A, I) {
    const As = C.가정, g = groups(A.byType), out = { legal: null };
    if (TC && window.TrafficCalc) { const pk = TrafficCalc.parking(TC, { units: A.units, units60below: g.u60, area85below: g.a85, area85above: g.a85u }); out.legal = pk.legal; out.pk = pk; }
    const per = +I.p.parkPer || As.parkPerUnitPlan || 1.2;
    out.plan = Math.max(out.legal || 0, Math.ceil(A.units * per)); out.per = per;
    out.ugArea = out.plan * (As.parkAreaPerStall_m2 || 33);
    const floorA = I.lot * (As.ugFootprintRatio || 0.8);
    out.ugFloors = floorA > 0 ? Math.ceil(out.ugArea / floorA) : null;
    const cf = crit('community_facility'), u = A.units;
    out.comm = u >= 1000 ? cf.값['1000이상_기본_m2'] + u * cf.값['1000이상_세대당_m2'] : u >= 100 ? u * cf.값['100이상_1000미만_세대당_m2'] : 0;
    out.must = (cf.의무시설 || []).filter(x => u >= x.세대).map(x => x.시설).pop() || [];
    const mo = crit('mgmt_office');
    out.mgmt = u >= 50 ? Math.min(mo.값.상한_m2, mo.값.기본_m2 + Math.max(0, u - 50) * mo.값['50세대초과_세대당_m2']) : 0;
    out.totalGfa = A.gfa + out.ugArea + out.comm + out.mgmt;
    return out;
  }
  // 단계: 교통성·환경성 검토 결과가 있으면 2차(검토 반영), 없으면 1차(초기 사업성용 개략)
  const STAGE_NAME = { 1: '1차 개략 건축계획 (초기 사업성용)', 2: '2차 건축계획 (교통·환경 검토 반영)' };
  const stageNow = () => { const c = site && site.constraints || {}; return (c.traffic || c.env) ? 2 : 1; };
  function renderStage() {
    if (!site) return;
    const st = (site.arch && site.arch.stages) || {}, now = stageNow(), c = site.constraints || {};
    const box = $('#stageBar'); if (!box) return;
    const chip = (k, t) => `<span class="st${k === now ? ' on' : ''}${st[k] ? ' done' : ''}">${t}</span>`;
    box.innerHTML = `${chip(1, '① 1차 개략 배치')}<span>→</span><span class="st${c.traffic && c.env ? ' done' : ''}${now === 2 && !(c.traffic && c.env) ? '' : ''}">② 교통성·환경성 검토</span><span>→</span>${chip(2, '③ 2차 배치(검토 반영)')}<span>→</span><span class="st">④ 높이·경관</span>
      <span class="note" style="flex-basis:100%">지금: <b>${STAGE_NAME[now]}</b>${now === 1 ? ' — 확정하면 초기 사업성에 쓰이고, 이 배치로 교통성·환경성 검토서를 만듭니다.' : ` — ${[c.traffic ? '교통성' : '', c.env ? '환경성' : ''].filter(Boolean).join('·')} 검토 결과(진입 도로·소음 도로·북측 일조)가 경계 조건에 들어가 있습니다.${!(c.traffic && c.env) ? ' 아직 ' + (c.traffic ? '환경성' : '교통성') + ' 검토가 없습니다.' : ''}`}</span>`;
  }
  // 1차·2차 비교표
  function compareHtml() {
    const st = (site.arch && site.arch.stages) || {};
    if (!st[1] || !st[2]) return '';
    const r = (k, f, u = '') => `<tr><td>${k}</td><td>${f(st[1])}${u}</td><td>${f(st[2])}${u}</td><td>${(() => { const a = +String(f(st[1])).replace(/,/g, ''), b = +String(f(st[2])).replace(/,/g, ''); return isFinite(a) && isFinite(b) && a ? `${b - a >= 0 ? '+' : ''}${fmt(b - a, 1)} (${fmt((b - a) / a * 100, 1)}%)` : ''; })()}</td></tr>`;
    return `<h3>1차 · 2차 비교</h3><table class="cmp"><tr><th>항목</th><th>1차 (${esc(st[1].at || '')})</th><th>2차 (${esc(st[2].at || '')})</th><th>증감</th></tr>
      ${r('세대수', x => fmt(x.units))}${r('주동 수', x => fmt(x.buildings.length))}${r('최고 층수', x => x.maxFloors)}${r('용적률 %', x => fmt(x.far, 1))}${r('건폐율 %', x => fmt(x.bcr, 1))}
      ${r('지상 연면적 ㎡', x => fmt(x.gfa))}${r('법정 주차 대', x => fmt((x.ex || {}).legal))}${r('계획 주차 대', x => fmt((x.ex || {}).plan))}${r('지하주차장 연면적 ㎡', x => fmt((x.ex || {}).ugArea))}${r('주민공동시설 ㎡', x => fmt((x.ex || {}).comm))}
      <tr><td>주동 형태</td><td>${esc(G.FORM_NAME[st[1].form] || '판상형')}</td><td>${esc(G.FORM_NAME[st[2].form] || '판상형')}</td><td></td></tr></table>`;
  }
  // 평형별 세대수 → 전용 60㎡ 이하 세대수, 85㎡ 이하/초과 전용면적 합계
  function groups(bt) {
    const U = C.평면; let u60 = 0, a85 = 0, a85u = 0;
    Object.entries(bt || {}).forEach(([t, n]) => { const ex = (U[t] && U[t].전용) || +t; if (ex <= 60) u60 += n; if (ex <= 85) a85 += n * ex; else a85u += n * ex; });
    return { u60, a85, a85u };
  }
  /* ---------- 확정·내보내기 ---------- */
  function confirmAlt() {
    const A = alts[cur], I = buildInput(), U = C.평면;
    site.arch = Object.assign(site.arch || {}, {
      tags, entries, exclude: exclude.map(ex => ex.map(pr.back)), exKinds, exFrom, params: P(), at: new Date().toLocaleString('sv-SE').slice(0, 16),
      chosen: { label: A.label, angle: A.angle, units: A.units, byType: A.byType, far: A.far,
        supply: Object.fromEntries(Object.keys(A.byType).map(t => [t, +U[t].공급 > 0 ? +U[t].공급 : Math.round(U[t].전용 * (+I.p.sf || C.가정.supplyFactor) * 10) / 10])),
        exclusive: Object.fromEntries(Object.keys(A.byType).map(t => [t, U[t].전용])), bcr: A.bcr, gfa: A.gfa, lot: I.lot, maxFloors: A.maxFloors, maxHeight: A.maxHeight,
        form: A.form, buildings: A.buildings.map(b => ({ id: b.id, t: b.t, n: b.n, form: b.form, floors: b.floors, H: A.H(b.floors), poly: b.poly.map(pr.back), parts: (b.parts || [b.poly]).map(q => q.map(pr.back)) })) },
    });
    const stg = stageNow(), X = extras(A, I);
    Object.assign(site.arch.chosen, { stage: stg, stageName: STAGE_NAME[stg], at: site.arch.at, ex: { legal: X.legal, plan: X.plan, ugArea: Math.round(X.ugArea), ugFloors: X.ugFloors, comm: Math.round(X.comm), mgmt: Math.round(X.mgmt), totalGfa: Math.round(X.totalGfa) } });
    site.arch.stages = Object.assign(site.arch.stages || {}, { [stg]: site.arch.chosen });
    site.constraints = site.constraints || {};
    site.constraints.arch = { 단계: STAGE_NAME[stg], 계획_주차대수: X.plan, 지하주차장_연면적_m2: Math.round(X.ugArea), 배치안: A.label, 주동형태: G.FORM_NAME[A.form] || '판상형', 세대수: A.units, 동수: A.buildings.length, 최고층수: A.maxFloors, 최고높이_m: Math.round(A.maxHeight * 10) / 10, 용적률: Math.round(A.far * 10) / 10, 건폐율: Math.round(A.bcr * 10) / 10,
      일조_미달_면적_제곱미터: sunRes && sunRes.alt === cur ? Math.round(sunRes.failArea) : '일조 계산 전', at: site.arch.at };
    // 다른 검토서가 같은 값을 쓰도록 계획 규모 갱신
    Object.assign(site.v, { units: String(A.units), floors: String(A.maxFloors), far: String(Math.round(A.far * 10) / 10), bcr: String(Math.round(A.bcr * 10) / 10), aptGFA: String(Math.round(A.gfa)),
      units60below: String(groups(A.byType).u60), area85below: String(Math.round(groups(A.byType).a85)), area85above: String(Math.round(groups(A.byType).a85u)) });
    JbsSite.save(site);
    msg(`'${A.label}'을 ${STAGE_NAME[stg]}으로 확정했습니다. 세대수·층수·전용면적 합계·계획 주차가 사업성과 검토서에 그대로 들어갑니다.`);
    const nx = $('#nextSteps'), sid = encodeURIComponent(site.id || '');
    nx.innerHTML = stg === 1
      ? `<b>다음 단계</b> — ① 초기 사업성을 보고, ② 이 배치로 교통성·환경성 검토서를 만든 뒤, 다시 이 화면에서 2차 배치를 돌리세요:
      <a class="btnlink primary" href="../?arch=${sid}">초기 사업성 보기 →</a>
      <a class="btnlink" href="../traffic/?site=${sid}&make=1">교통성 검토서 →</a>
      <a class="btnlink" href="../env/?site=${sid}&make=1">환경성 검토서 →</a>`
      : `<b>다음 단계</b> — 검토를 반영한 2차 배치입니다:
      <a class="btnlink primary" href="../?arch=${sid}">사업성 다시 보기 →</a>
      <a class="btnlink" href="../traffic/?site=${sid}&make=1">교통성 검토서 갱신 →</a>
      <a class="btnlink" href="../landscape/?site=${sid}&make=1">높이·경관계획 →</a>${compareHtml()}`;
    renderStage();
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
    else if (t.id === 'applyReview') { if (pts) autoTag({ entries: true }); }
    else if (t.id === 'loadInfra') { if (pts) importInfra(false); }
    else if (t.id === 'loadCtx') { if (pts) { t.classList.add('busy'); await loadContext(true); sunRes = null; v3 = null; if (alts.length) renderSun(); t.classList.remove('busy'); } }
    else if (t.id === 'mEdge' || t.id === 'mEntry') { mode = t.id === 'mEdge' ? 'edge' : 'entry'; $('#mEdge').setAttribute('aria-pressed', mode === 'edge'); $('#mEntry').setAttribute('aria-pressed', mode === 'entry'); $('#modeHint').textContent = mode === 'edge' ? '지금: 경계 성격 바꾸기 — 경계선을 누를 때마다 성격이 바뀝니다(곡선처럼 이어진 짧은 변은 한꺼번에).' : '지금: 차량 출입구 찍기 — 도로 쪽 경계선(파랑·보라)을 누르면 출입구가 찍힙니다. 다 찍었으면 [경계 성격 바꾸기]를 눌러 빠져나오세요.'; if (pts) drawSite(); msg(mode === 'entry' ? '도로 쪽 경계선(파랑·보라)을 누르면 차량 출입구가 찍힙니다(최대 3곳, 표시 근처를 다시 누르면 지움).' : ''); }
    else if (t.dataset.alt !== undefined) { cur = +t.dataset.alt; renderAlts(); drawBuildingsOnMap(); showView(curView); }
    else if (t.dataset.v) showView(t.dataset.v);
    else if (t.id === 'calcSun') { t.classList.add('busy'); msg('동지 일조 계산 중…'); await tick(); await tick(); computeSun(); renderSun(); t.classList.remove('busy'); msg(''); }
    else if (t.dataset.cam && v3) ({ sw: () => v3.bird(-0.75, 0.55), se: () => v3.bird(0.75, 0.55), n: () => v3.bird(Math.PI, 0.5), top: () => v3.bird(0.001, 1.45) })[t.dataset.cam]();
    else if (t.id === 'dl3d' && v3) { const a = document.createElement('a'); a.href = v3.png(); a.download = fname('매스투시도.png'); a.click(); }
    else if (t.id === 'dlSvg') download(svgBlob(D.sitePlan(planOpts())), fname('개략배치도.svg'));
    else if (t.id === 'dlPng') { const u = await svgToPng(D.sitePlan(planOpts())); const a = document.createElement('a'); a.href = u; a.download = fname('개략배치도.png'); a.click(); }
    else if (t.id === 'dlDoc') exportDoc();
    else if (t.dataset.mixpre) { const pre = (C.평형구성_예시 || {})[t.dataset.mixpre] || {}; TYPES().forEach(k => { $('#p_m' + k).value = pre[k] ?? ''; }); mixSum(); saveState(); invalidate(); }
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
      C = c; TC = tc; initMix(); initLegend();
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
