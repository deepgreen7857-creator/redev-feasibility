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
  const GZ = window.GateZones;   // 출입구 자리(shared/gate-zones.js)
  let C = null, TC = null, site = null, pr = null, pts = null, tags = [], entries = [], exclude = [], exKinds = [], exFrom = '', lowEdges = [];
  let alts = [], cur = 0, map, lyrSite, lyrEdges, lyrEx, lyrBld, mode = 'edge', v3 = null, sunRes = null, ctx = [];

  const msg = (t, bad) => { const m = $('#msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; m.style.background = bad ? 'var(--bad-soft)' : 'var(--accent-soft)'; };
  const crit = id => C.items.find(i => i.id === id);

  /* ---------- 조건 입력 ---------- */
  const FIELDS = { siteArea: 'p_siteArea', infra: 'p_infra', far: 'p_far', maxFloors: 'p_maxFloors', angleMode: 'p_angleMode', form: 'p_form', angle: 'p_angle', spacing: 'p_spacing', sideGap: 'p_sideGap', roadSb: 'p_roadSb', artSb: 'p_artSb', bndSb: 'p_bndSb', lowCap: 'p_lowCap', lowDist: 'p_lowDist', parkPer: 'p_parkPer', parkW: 'p_parkW', sunBase: 'p_sunBase', corner: 'p_corner', axisN: 'p_axisN', axisW: 'p_axisW', axisB: 'p_axisB', minFloors: 'p_minFloors', fh: 'p_fh', sf: 'p_sf', gMainW: 'p_gMainW', gMainD: 'p_gMainD', gRampW: 'p_gRampW', gRampH: 'p_gRampH', gSubW: 'p_gSubW' };
  function defaults() {
    const A = C.가정; let U = {}; try { U = JSON.parse(localStorage.getItem('jbs-urban-plan') || '{}'); } catch (e) { U = {}; }
    const v = site.v || {};
    return {
      siteArea: v.siteArea || '', infra: U.infraRatio ?? 25, far: v.far || U.farCustom || 250, maxFloors: (+v.floors > 0 ? +v.floors : A.maxFloors),
      angleMode: 'auto', angle: 0, form: 'rec',
      spacing: crit('spacing_ratio').값, sideGap: A.sideGap_m, roadSb: A.roadSetback_m, artSb: A.arterialSetback_m, bndSb: A.boundarySetback_m,
      lowCap: 15, lowDist: 30, parkPer: A.parkPerUnitPlan ?? 1.2, parkW: A.parkWidth_m ?? 20, sunBase: 'north', corner: (A.corner && A.corner.mode) || 'min10', axisN: 0, axisW: 20, axisB: 0, minFloors: A.minFloors, ...defaultMix(), fh: A.floorHeight_m, sf: U.supplyFactor ?? A.supplyFactor,
      gMainW: GZ.DEF.mainW, gMainD: GZ.DEF.mainD, gRampW: GZ.DEF.rampW, gRampH: GZ.DEF.rampH, gSubW: GZ.DEF.subW,
    };
  }
  const TYPES = () => Object.keys(C.평면).filter(k => /^\d+$/.test(k));
  function initMix() {
    const box = $('#mixBox'); if (!box || box.dataset.ok) return; box.dataset.ok = 1;
    box.innerHTML = TYPES().map(t => `<label>${t}㎡형<input id="p_m${t}" inputmode="decimal" placeholder="0"></label>`).join('') + '<div id="mixSum" class="note" style="grid-column:1/-1"></div>';
    TYPES().forEach(t => { FIELDS['m' + t] = 'p_m' + t; $('#p_m' + t).addEventListener('input', mixSum); $('#p_m' + t).addEventListener('change', () => { saveState(); invalidate(); }); });
    renderPresets();
  }
  // 재건축: 사업성 화면이 받은 건축물대장 전유부(기존 세대 전용면적)로 평형 비율을 만듦 — 기존 세대마다 '그 면적 이상인 가장 작은 평형'(5% 여유)으로 셈
  //  사업성 화면 구역이 이 구역과 절반 이상 겹칠 때만(다른 사업의 대장을 쓰지 않게)
  function existingMix() {
    let pj = null; try { pj = JSON.parse(localStorage.getItem('jbsc.project.v1') || 'null'); } catch (e) { pj = null; }
    const st = pj && (pj.state || pj); if (!st || !Array.isArray(st.exposUnits) || !st.exposUnits.length || !st.area || !st.area.geojson || !site || !site.geojson) return null;
    try { const a = st.area.geojson, b = site.geojson, x = turf.intersect(a.type === 'Feature' ? a : turf.feature(a), b.type === 'Feature' ? b : turf.feature(b)); if (!x || turf.area(x) < 0.5 * Math.min(turf.area(a), turf.area(b))) return null; } catch (e) { return null; }
    const types = TYPES().map(Number).sort((a, b) => a - b), cnt = {}; let n = 0;
    st.exposUnits.filter(u => +u.area > 15 && !/상가|근린|업무|판매|창고|주차|기계/.test(String(u.purpose || ''))).forEach(u => {
      const t = types.find(t2 => t2 >= +u.area * 0.95) || types[types.length - 1]; cnt[t] = (cnt[t] || 0) + 1; n++;
    });
    if (n < 5) return null;
    const out = {}; Object.entries(cnt).forEach(([t, c]) => { out[t] = Math.round(c / n * 100); });
    return { mix: out, n, recon: st.meta && st.meta.type === 'reconstruction' };
  }
  function renderPresets() {
    const pre = C.평형구성_예시 || {}, ex = existingMix();
    $('#mixPresets').innerHTML = (ex ? `<button type="button" data-mixex="1" title="사업성 화면에서 받은 건축물대장 전유부 기존 세대 ${fmt(ex.n)}호의 전용면적으로 만든 비율(세대마다 그 면적 이상인 가장 작은 평형)">재건축 — 기존 세대 평형(${fmt(ex.n)}호)</button>` : '')
      + Object.keys(pre).map(k => `<button type="button" data-mixpre="${esc(k)}">${esc(k)}</button>`).join('');
  }
  function mixSum() {
    const v = TYPES().map(t => +($('#p_m' + t).value || 0)), sum = v.reduce((a, b) => a + b, 0);
    const small = TYPES().filter(t => +t <= 60).reduce((a, t) => a + +($('#p_m' + t).value || 0), 0), u85 = TYPES().filter(t => +t <= 85).reduce((a, t) => a + +($('#p_m' + t).value || 0), 0);
    $('#mixSum').textContent = sum ? `합 ${sum}% (비율로 나눠 씀) · 전용 60㎡ 이하 ${Math.round(small / sum * 100)}% · 85㎡ 이하 ${Math.round(u85 / sum * 100)}%` : '평형 비율을 하나 이상 넣으세요';
  }
  function defaultMix() {
    let U = {}; try { U = JSON.parse(localStorage.getItem('jbs-urban-plan') || '{}'); } catch (e) { U = {}; }
    const o = {}; TYPES().forEach(t => { o['m' + t] = ''; });
    // 사업성 화면·/urban 4탭과 같은 공통 평형 비율(jbs-feas-assume-v1의 mixNN)이 있으면 그것을, 없으면 '재개발 일반'
    let F = {}; try { F = JSON.parse(localStorage.getItem('jbs-feas-assume-v1') || '{}'); } catch (e) { F = {}; }
    const fm = {}; Object.keys(F).forEach(k => { const m = /^mix(\d+)$/.exec(k); if (m && +F[k] > 0 && TYPES().includes(m[1])) fm[m[1]] = +F[k]; });
    if (Object.keys(fm).length && fm[84] == null && F.mix59 != null && TYPES().includes('84')) fm[84] = Math.max(0, 100 - (+F.mix59 || 0) - (+F.mix114 || 0));
    const base = Object.keys(fm).length ? fm : (C.평형구성_예시 || {})['재개발 일반'] || { 59: 40, 84: 50, 114: 10 };
    Object.entries(base).forEach(([t, v]) => { o['m' + t] = v; });
    return o;
  }
  const P = () => { const o = {}; Object.entries(FIELDS).forEach(([k, id]) => { o[k] = $('#' + id).value; }); return o; };
  function setP(o) { Object.entries(FIELDS).forEach(([k, id]) => { if (o[k] !== undefined && o[k] !== null && o[k] !== '') $('#' + id).value = o[k]; }); $('#p_angle').disabled = $('#p_angleMode').value === 'auto'; }
  const filled = o => { const r = {}; Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') r[k] = v; }); return r; };
  function saveState() {
    if (!site) return;
    site.arch = Object.assign(site.arch || {}, { tags, entries, exclude: exclude.map(ex => ex.map(pr.back)), exKinds, exFrom, lowEdges, params: P() });
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
  //  종류(2026-11-08): main 주출입구(문주·진입광장) / park 주차장 출입구(지하 경사로) / sub 부출입구(보행) — 종류마다 차지하는 땅이 달라 배치에서 비움(shared/gate-zones.js)
  function cleanEntries() {
    entries = entries.filter(en => ['road', 'arterial'].includes(tags[en.edge])).slice(0, 4);
    entries.forEach((en, k) => { if (!GZ.NAME[en.kind]) en.kind = k === 0 ? 'main' : 'sub'; });   // 예전 저장값(종류 없음): 첫째 주출입구, 나머지 부출입구
    let hasMain = false; entries.forEach(en => { if (en.kind === 'main') { if (hasMain) en.kind = 'sub'; hasMain = true; } });   // 주출입구는 하나만
    const tot = {}, cnt = {}; entries.forEach(en => { tot[en.kind] = (tot[en.kind] || 0) + 1; });
    entries.forEach(en => { cnt[en.kind] = (cnt[en.kind] || 0) + 1; en.label = GZ.NAME[en.kind] + (tot[en.kind] > 1 ? cnt[en.kind] : ''); });
  }
  const gateParams = () => { const p = P(); return { mainW: p.gMainW, mainD: p.gMainD, rampW: p.gRampW, rampH: p.gRampH, subW: p.gSubW }; };
  const edgeSetbacks = () => { const p = P(); return tags.map(t => t === 'road' ? +p.roadSb : t === 'arterial' ? +p.artSb : +p.bndSb); };
  // 출입구가 차지하는 땅(건축 불가) — 건축한계선(경계 이격) 안쪽까지 이어짐
  const gateZones = sb => (pts && tags && tags.length === pts.length ? GZ.build(G.edges(pts), entries, sb || edgeSetbacks(), gateParams()) : []);
  const GCOL = { main: '#c92a2a', park: '#1971c2', sub: '#e67700' };
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
        // 이미 찍힌 자리를 다시 누르면 종류가 바뀜: 주출입구 → 주차장 출입구 → 부출입구 → 지움
        if (near >= 0) { const en = entries[near], nx = { main: 'park', park: 'sub' }[en.kind]; if (nx) en.kind = nx; else entries.splice(near, 1); }
        else {
          if (!['road', 'arterial'].includes(tags[i])) { msg(`이 변은 '${t.name}'입니다. 출입구는 도로 쪽 변(파랑·보라)에만 찍을 수 있습니다. 도로인데 색이 다르면 [경계 성격 바꾸기]로 먼저 바꾸세요.`, true); return; }
          if (entries.length >= 4) { msg('출입구는 4곳까지 찍을 수 있습니다. 기존 표시를 눌러(종류가 바뀌다 마지막에 지워짐) 지운 뒤 찍으세요.', true); return; }
          const has = k => entries.some(en => en.kind === k);
          entries.push({ edge: i, t: t2, kind: !has('main') ? 'main' : !has('park') ? 'park' : 'sub' });
        }
        cleanEntries();
        msg(entries.length ? `출입구 ${entries.length}곳: ${entries.map(en => en.label).join(', ')} — 찍힌 자리를 다시 누르면 주출입구 → 주차장 출입구 → 부출입구 → 지움 순으로 바뀝니다. 각 출입구 자리(문주·진입광장, 지하 경사로)에는 동을 놓지 않습니다.` : '출입구를 모두 지웠습니다.');
        drawSite(); saveState(); invalidate();
      });
    });
    // 구역계: 적색 쇄선을 맨 위에
    L.polygon(pts.map(LL), { color: '#c8322b', weight: 2.5, dashArray: '12 4 2 4', fill: false, interactive: false }).addTo(lyrEdges);
    // 출입구 자리(건축 불가): 주출입구 = 문주·진입광장, 주차장 출입구 = 지하 경사로, 부출입구 = 보행 출입
    gateZones().forEach(z => {
      const c = GCOL[z.kind];
      L.polygon(z.poly.map(LL), { color: c, weight: 1.5, dashArray: '5 3', fillColor: c, fillOpacity: .16, interactive: false }).addTo(lyrEdges);
      if (z.kind === 'main') [-1, 1].forEach(sg => L.circleMarker(LL(z.q(sg * (z.w / 2 - 1), z.sb)), { radius: 3, color: c, fillColor: c, fillOpacity: 1, weight: 1, interactive: false }).addTo(lyrEdges));
      const en = z, m = z.q(0, 0);
      L.circleMarker(LL(m), { radius: 7, color: c, fillColor: '#fff', fillOpacity: 1, weight: 3 }).bindTooltip(`${en.label}${z.kind === 'park' ? ` · 경사로 ${z.rampL.toFixed(0)}m` : z.kind === 'main' ? ' · 문주' : ''}`, { permanent: true, direction: 'top', offset: [0, -6] }).addTo(lyrEdges);
    });
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
  const reviewKey = () => { const c = site.constraints || {}; return JSON.stringify([c.traffic && [c.traffic.진입_가능_도로, c.traffic.확폭_검토_도로], c.env && [c.env.소음_검토_도로, c.env.북측_일조_높이제한], c.landscape && [c.landscape.통경축_방위, c.landscape.통경축_개방률_퍼센트, c.landscape.경계부_층수_점감_대상동, c.landscape.층수_점감_검토]]); };
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
      (entryOK.length ? [...new Set(entryOK)] : [null]).forEach(nm => { if (ne.length >= 2) return; const x = pickEdge(nm); if (x && !ne.some(q => q.edge === x.i)) ne.push({ edge: x.i, t: 0.5, kind: ne.length ? 'park' : 'main' }); });
      // 진입 도로가 하나뿐이면 같은 변에 주출입구와 주차장 출입구를 떨어뜨려 둠(변이 60m 이상일 때 — 보행·차량 동선 분리)
      if (ne.length === 1 && E[ne[0].edge].len >= 60) { ne[0].t = 0.35; ne.push({ edge: ne[0].edge, t: 0.75, kind: 'park' }); }
      if (ne.length) { entries = ne; done.push(`출입구 ${ne.length}곳(${ne.map(q => GZ.NAME[q.kind]).join('·')}, ${entryOK.length ? '교통성 검토의 진입 가능 도로' : '가장 긴 도로 변'})`); }
    }
    const lsDone = applyLandscape(E, edgeRoad); if (lsDone.length) done.push(...lsDone);
    site.arch = Object.assign(site.arch || {}, { reviewKey: reviewKey() });
    cleanEntries(); drawSite(); drawExclude(); saveState(); invalidate();
    const ar = tags.filter(t => t === 'arterial').length;
    if (envC) done.unshift(`소음 검토 도로 변 ${ar}개를 간선도로(소음 이격)로${noNorth ? ', 북측 일조 해당 없음 → 정북 변 지정 안 함' : ''}`);
    msg((roads.length ? '/urban 주변 도로 자료로 도로 변을, 방향으로 정북 변을 정했습니다.' : '도로 자료가 없어 방향만으로 정했습니다(북쪽을 향한 변 = 정북 인접대지).')
      + (done.length ? ((c.traffic || c.env || c.landscape) ? ' 검토 결과 반영: ' : ' 자동 지정: ') + done.join(', ') + '.' : '') + (c.traffic || c.env || c.landscape ? '' : ' 교통성·환경성·경관 검토를 먼저 하면 그 결과(진입 도로, 소음 도로, 북측 일조, 통경축, 경계부 층수 점감)가 자동으로 반영됩니다.')
      + ' 다른 점은 경계선을 눌러 고치세요.');
  }

  /* ---------- 경관 검토 결과 → 건축계획(2026-11-07, 사용자 목표 '교통·환경·경관 검토 결과를 건축계획에 반영') ----------
     ① 경계부 층수 점감: 주변 평균 대비 배율 이상 동이 경계 30m 안에 있었으면 → 그 쪽 경계 변(lowEdges)에 '경계에서 ○m 안 ○층 이하'
        변 고르기: 주변 기존 건물(브이월드) 중 5층 이하 주택이 바깥 40m 안에 있는 도로 아닌 변 → 없으면 지난 확정안에서 걸린 동에 30m 안으로 가까운 변
        층수 상한 = max(7, 올림(주변 평균 × 배율)) — 경관 검토 '변화 큼' 기준(내부 검토 기준 2배)을 넘지 않게. 정북·도로 등 변 성격은 그대로 둠
     ② 통경축: 지난 확정안 개방률이 30% 미만이면 통경축 방향 띠(폭 p.axisW, 개수 = 30%에 닿는 수, 최대 3)를 건축 불가로 — 띠는 획지 면적에서 빼지 않음(단지 안 열린 공간) */
  function applyLandscape(E, edgeRoad) {
    const cl = (site.constraints || {}).landscape, out = []; if (!cl) return out;
    const p = P(), set = (k, v) => { const el = $('#' + FIELDS[k]); if (el) el.value = v; };
    const flagged = cl.경계부_층수_점감_대상동 || [];
    if (cl.층수_점감_검토 || flagged.length) {
      let pick = [];
      E.forEach((e, i) => { if (edgeRoad[i]) return; const lowNear = ctx.some(b => b.res && b.floors <= 5 && b.poly.some(q => { const d = G.segDist(q, e.a, e.b), s = (q[0] - e.a[0]) * e.out[0] + (q[1] - e.a[1]) * e.out[1]; return s > 0 && d < 40; })); if (lowNear) pick.push(i); });
      let how = '주변 5층 이하 주택이 맞닿은 경계';
      const ch = site.arch && site.arch.chosen;
      if (!pick.length && ch && flagged.length) {
        const fb = ch.buildings.filter(b => flagged.includes(b.id)).map(b => b.poly.map(pr.to));
        E.forEach((e, i) => { if (fb.some(q => q.some(v => G.segDist(v, e.a, e.b) < 30))) pick.push(i); });
        how = '지난 확정안에서 걸린 동(' + flagged.join('·') + '동) 쪽 경계';
      }
      if (pick.length) {
        lowEdges = pick;
        const ar = +cl.주변_평균층수 || 0, ratio = +cl.점감_배율 || 2;
        if (ar > 0) set('lowCap', Math.max(7, Math.ceil(ar * ratio)));
        set('lowDist', 30);
        out.push(`경관(층수 점감): ${how} ${pick.length}개 변 → 경계에서 30m 안 ${$('#p_lowCap').value}층 이하${ar > 0 ? `(주변 평균 ${ar}층 × ${ratio}배)` : ''}`);
      }
    } else lowEdges = [];
    if (cl.통경축_방위 != null && cl.통경축_방위 !== '') {
      set('axisB', +cl.통경축_방위 || 0);
      const op = cl.통경축_개방률_퍼센트;
      if (op != null && op < 30) {
        const b = (+cl.통경축_방위 || 0) * D2R_, perp = [Math.cos(b), -Math.sin(b)], sv = pts.map(q => q[0] * perp[0] + q[1] * perp[1]), W = Math.max(...sv) - Math.min(...sv);
        const w = Math.max(15, +p.axisW || 20), n = Math.min(3, Math.max(1, Math.ceil(0.3 * W / w)));
        set('axisN', n); set('axisW', w);
        out.push(`경관(통경축): 지난 확정안 개방률 ${op}% → ${BEAR_NAME[+cl.통경축_방위 || 0] || '통경축'} 방향 폭 ${w}m 띠 ${n}개를 비움(최대 3개 — 30%에 못 미치면 개수·폭을 늘리거나 동 형태를 탑상으로)`);
      }
    }
    return out;
  }
  const D2R_ = Math.PI / 180, BEAR_NAME = { 0: '남북', 90: '동서', 45: '북동–남서', 135: '북서–남동' };
  // 통경축 띠(건축 불가, 획지에서 빼지 않음): 통경축 방향과 나란한 띠를 구역 폭에 고르게 n개. 엔진이 건축 불가 둘레에 대지경계 이격을 더 띄우므로 띠 폭은 그만큼 줄여 실제 틈이 axisW가 되게
  function axisStrips(p) {
    p = p || P(); const n = Math.min(3, +p.axisN || 0); if (!pts || !(n > 0)) return [];
    const b = (+p.axisB || 0) * D2R_, d = [Math.sin(b), Math.cos(b)], perp = [Math.cos(b), -Math.sin(b)];
    const sv = pts.map(q => q[0] * perp[0] + q[1] * perp[1]), tv = pts.map(q => q[0] * d[0] + q[1] * d[1]);
    const s0 = Math.min(...sv), s1 = Math.max(...sv), t0 = Math.min(...tv) - 5, t1 = Math.max(...tv) + 5;
    const w = Math.max(2, (Math.max(15, +p.axisW || 20)) - 2 * (+p.bndSb || 0));
    const at = (s, t) => [perp[0] * s + d[0] * t, perp[1] * s + d[1] * t];
    return Array.from({ length: n }, (_, k) => { const c = s0 + (s1 - s0) * (k + 1) / (n + 1); return [at(c - w / 2, t0), at(c + w / 2, t0), at(c + w / 2, t1), at(c - w / 2, t1)]; });
  }

  /* ---------- 지도 위 범례(끌어서 옮기기, 접기, 위치 기억) ---------- */
  const LEG_KEY = 'jbs.arch.legend';
  let leg = null;
  function legendItems() {
    const p = P(), n = v => (v === '' || v === undefined ? '○○' : v);
    const sn = crit('sunlight_north').이격;
    return [
      ['boundary', `이격 ${n(p.bndSb)}m`],
      ['road', `건축한계선 ${n(p.roadSb)}m · 출입구를 찍을 수 있음`],
      ['arterial', `건축한계선(소음 이격) ${n(p.artSb)}m · 출입구 가능`],
      ['north', `일조 높이 제한: 높이 10m 이하 ${sn.높이10m이하_m}m, 초과 부분은 높이의 1/2 이상 이격`],
      ['park', `이격 ${n(p.bndSb)}m · 공원 폭 ${n(p.parkW)}m의 중심선(절반)을 인접 대지경계선으로(공동주택)`],
      ['lowrise', `경계에서 ${n(p.lowDist)}m 안은 ${n(p.lowCap)}층 이하`],
    ];
  }
  function renderLegend() {
    if (!leg) return;
    const used = new Set(tags || []);
    leg.querySelector('ul').innerHTML = legendItems().map(([k, d]) => `<li class="${used.has(k) ? '' : 'off'}" title="${d}"><i style="background:${D.TAG[k].color}"></i><div>${D.TAG[k].name}<small>${d}</small></div></li>`).join('') +
      `<li><i style="background:repeating-linear-gradient(90deg,#c8322b 0 7px,transparent 7px 9px,#c8322b 9px 10px,transparent 10px 12px)"></i><div>구역계</div></li>` +
      Object.entries(GZ.NAME).map(([k, nm]) => { const z = GZ.size(k, gateParams()); return `<li class="${entries.some(en => en.kind === k) ? '' : 'off'}"><i style="background:${GCOL[k]}"></i><div>${nm}<small>${k === 'main' ? `문주·진입광장 폭 ${z.w}m · 건축한계선 안쪽 ${z.d}m 동 배치 안 함` : k === 'park' ? `지하 경사로 폭 ${z.w}m · 길이 약 ${z.d.toFixed(0)}m(직선 17%) 동 배치 안 함` : `보행 출입 폭 ${z.w}m`}</small></div></li>`; }).join('');
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
    const saved = JbsSite.list(), urb = JbsSite.urbanZones(), pz = JbsSite.projectZone && JbsSite.projectZone();
    $('#siteSel').innerHTML = '<option value="">구역 불러오기…</option>' +
      (pz ? `<optgroup label="사업성 검토(첫 화면)에 그린 구역계"><option value="p:">${esc((pz.meta && pz.meta.name !== '새 정비사업' && pz.meta.name) || '사업성 검토 구역')} 가져오기</option></optgroup>` : '') +
      (saved.length ? `<optgroup label="저장한 구역">${saved.map(x => `<option value="s:${x.id}"${site && site.id === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>` : '') +
      (urb.length ? `<optgroup label="/urban 정비계획 검토의 안">${urb.map(x => `<option value="u:${x.key}">${x.key}안 가져오기</option>`).join('')}</optgroup>` : '');
  }
  function ringOf(gj) {
    const g = gj.geometry || gj; if (g.type === 'Polygon') return g.coordinates[0];
    if (g.type === 'MultiPolygon') return g.coordinates.map(c => c[0]).sort((a, b) => turf.area(turf.polygon([b])) - turf.area(turf.polygon([a])))[0];
    return null;
  }
  function load(s) {
    site = s; site.v = site.v || {}; alts = []; cur = 0; if ($('#feasCard')) $('#feasCard').innerHTML = ''; sunRes = null; $('#out').hidden = true; $('#confirm').disabled = true;
    lyrEx.clearLayers(); lyrBld.clearLayers();
    if (!site.geojson) { pts = null; drawSite(); setP(defaults()); fillSel(); msg('구역이 없습니다. 지도 왼쪽 위 다각형 도구로 구역계를 그리거나 저장한 구역을 불러오세요.'); return; }
    const ring = G.openRing(ringOf(site.geojson)); pr = G.projector(ring); pts = G.ccw(ring.map(pr.to));
    const a = site.arch || {};
    tags = (a.tags && a.tags.length === pts.length) ? a.tags.slice() : null;
    entries = a.entries || []; exclude = (a.exclude || []).map(ex => ex.map(pr.to)); exKinds = (a.exKinds || []).slice(); exFrom = a.exFrom || ''; lowEdges = (a.lowEdges || []).filter(i => i < pts.length);
    // /urban 4탭에서 찍은 단지 출입구(z.infra.gates)가 있고 여기서 아직 출입구를 안 정했으면 그대로 가져옴 — 주차장 출입구 우선, 없으면 주·부출입구
    if (!entries.length && Array.isArray(site.urbanGates) && site.urbanGates.length) {
      const gs = site.urbanGates.filter(g => g.kind === 'main').concat(site.urbanGates.filter(g => g.kind === 'park'), site.urbanGates.filter(g => g.kind === 'sub'));
      const E = G.edges(pts);
      gs.forEach(g => { if (!g.pt || entries.length >= 4) return; const q = pr.to([g.pt[1], g.pt[0]]);
        let best = null; E.forEach((e, i) => { const d = G.segDist(q, e.a, e.b); if (!best || d < best.d) { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L2 = dx * dx + dy * dy || 1; best = { d, edge: i, t: Math.max(0.02, Math.min(0.98, ((q[0] - e.a[0]) * dx + (q[1] - e.a[1]) * dy) / L2)) }; } });
        if (best && best.d < 30 && !entries.some(en => en.edge === best.edge && Math.abs(en.t - best.t) < 0.1)) entries.push({ edge: best.edge, t: best.t, kind: g.kind, from: 'urban' }); });
      if (entries.length) setTimeout(() => msg(`/urban 정비계획에서 찍은 단지 출입구 ${entries.length}곳(${entries.map(en => GZ.NAME[en.kind] || '출입구').join('·')})을 가져왔습니다(도로에 닿은 변만 남김). 출입구 자리에는 동을 놓지 않습니다. 옮기려면 [출입구 찍기].`), 600);
    }
    drawExclude();
    { const sp = filled(a.params); const hasMix = TYPES().some(t => sp['m' + t] !== undefined); const d0 = defaults(); if (hasMix) TYPES().forEach(t => { d0['m' + t] = ''; }); setP(Object.assign(d0, sp)); mixSum(); }
    if (!tags) { tags = pts.map(() => 'boundary'); autoTag(); }
    else if ((site.constraints || {}).traffic || (site.constraints || {}).env || (site.constraints || {}).landscape) { if ((a.reviewKey || '') !== reviewKey()) autoTag({ entries: true }); }
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
    exclude.forEach((ex, i) => { const k = exKinds[i] || '직접 그림', park = /공원|녹지/.test(k), road = /도로/.test(k);
      lyrEx.addLayer(L.polygon(ex.map(p => pr.back(p).slice().reverse()), { color: park ? '#2f7d4a' : road ? '#6b7280' : '#5d7f5a', weight: 2, fillColor: park ? '#6fbf7e' : road ? '#b9bec4' : '#9fb59b', fillOpacity: 0.55, kind: k }).bindTooltip(`${k} ${fmt(Math.abs(G.area(ex)))}㎡ — 건축 불가`, { sticky: true })); });
    axisStrips().forEach(q => lyrEx.addLayer(L.polygon(q.map(pt => pr.back(pt).slice().reverse()), { color: '#2b6cb0', weight: 1.5, dashArray: '6 4', fillColor: '#90cdf4', fillOpacity: 0.25, kind: '통경축', interactive: false })));
    exInfo();
  }
  // 오른쪽 계획 조건에 '건축 불가(기반시설)'를 한 줄로, 기반시설 비율 칸은 제외 영역이 있으면 잠금
  function exInfo() {
    const el = $('#exInfo'), inp = $('#p_infra'); if (!el) return;
    if (!exclude.length) { el.innerHTML = ''; if (inp) inp.disabled = false; return; }
    const sum = {}; exclude.forEach((ex, i) => { const k = exKinds[i] || '직접 그림'; sum[k] = (sum[k] || 0) + Math.abs(G.area(ex)); });
    const tot = Object.values(sum).reduce((a, b) => a + b, 0), siteA = num(P().siteArea) || (pts ? Math.abs(G.area(pts)) : 0); // 배치 계산과 같은 기준(구역 면적 칸에 값이 있으면 그 값)
    el.innerHTML = `<b>건축 불가(정비기반시설) 반영됨</b>${exFrom.startsWith('urban:') ? ' — /urban 정비계획에서' : ''}: ${Object.entries(sum).map(([k, v]) => `${esc(k)} ${fmt(v)}㎡`).join(' · ')} · 합 ${fmt(tot)}㎡${siteA ? ` → 획지 약 ${fmt(siteA - tot)}㎡` : ''}. 지도의 초록(공원)·회색(도로) 부분에는 동을 놓지 않습니다.`;
    if (inp) inp.disabled = true;
  }
  function importInfra(auto) {
    const inf = site && site.urbanInfra;
    if (!inf) { if (!auto) msg('이 구역에는 /urban 정비계획의 기반시설 배치가 없습니다. /urban에서 이 안의 [정비기반시설] 탭을 한 번 열면 저장되고, 그다음 이 버튼을 누르세요. 또는 지도 왼쪽 위 다각형 도구로 직접 그리세요.', true); return; }
    const rings = [], kinds = [];
    const add = (g, k) => { if (!g) return; const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; ps.forEach(pc => { const r = G.openRing(pc[0]).map(pr.to); if (Math.abs(G.area(r)) >= 20) { rings.push(r); kinds.push(k); } }); };
    add(inf.road, inf.fromDrawing ? '도로(정비기반시설도)' : '도로(확폭·지정)'); add(inf.park, '공원·녹지'); add(inf.green, '녹지'); add(inf.other, '그 밖의 정비기반시설'); add(inf.pub, '공공청사 등'); add(inf.school, '학교용지'); add(inf.rel, inf.relKeep ? '종교용지(존치)' : '종교용지(대체부지)');
    (inf.keepRoads || []).forEach(g => add(g, '존치 도로'));
    exclude = rings; exKinds = kinds; exFrom = 'urban:' + inf.at; drawExclude(); saveState(); invalidate();
    const sum = {}; kinds.forEach((k, i) => { sum[k] = (sum[k] || 0) + Math.abs(G.area(rings[i])); });
    msg(`/urban 정비계획(${inf.at}${inf.fromDrawing ? ', 정비기반시설도 ' + inf.fromDrawing : ''})의 기반시설을 건축 불가 영역으로 넣었습니다: ${Object.entries(sum).map(([k, v]) => `${k} ${fmt(v)}㎡`).join(', ') || '없음'}. 획지는 구역에서 이 면적을 뺀 땅입니다.`);
  }
  // 다른 검토에서 넘어온 조건 안내
  function carry() {
    const c = site.constraints || {}, out = [];
    if (c.traffic) out.push(`교통: 진입도로 필요 폭 ${c.traffic.진입도로_필요폭_m ?? '○○'}m, 진입 가능 도로 ${esc((c.traffic.진입_가능_도로 || []).join(', ') || '○○')}${(c.traffic.확폭_검토_도로 || []).length ? ', 확폭 검토 ' + esc(c.traffic.확폭_검토_도로.map(x => x.도로).join(', ')) : ''} → 차량 출입구`);
    if (c.env) out.push(`환경: 소음 검토 도로 ${esc((c.env.소음_검토_도로 || []).join(', ') || '없음')} → 해당 변 '간선도로', ${c.env.북측_일조_높이제한 ? '북측 인접 주거지 → 정북 변 지정' : '북측 일조 해당 없음'}`);
    if (c.traffic && (c.traffic.확폭_검토_도로 || []).length) out.push(`교통: 진입도로 확폭은 획지를 줄이므로 /urban 3탭(정비기반시설)에서 도로 폭을 정한 뒤 [정비계획 기반시설 가져오기]로 받기${c.traffic.법정_주차대수 ? ` · 법정 주차 ${fmt(c.traffic.법정_주차대수)}대(개요의 계획 주차와 비교)` : ''}`);
    if (c.env && c.env.국가유산_검토) out.push(`환경: ${esc(c.env.국가유산_검토)} — 자동 반영 안 됨, 그 방향 경계 변을 '저층 주거 인접'으로 지정해 층수 상한을 거세요`);
    if (c.landscape) { const cl = c.landscape; out.push(`경관: ${cl.통경축_개방률_퍼센트 != null ? `지난 확정안 통경축 개방률 ${cl.통경축_개방률_퍼센트}%${cl.통경축_개방률_퍼센트 < 30 ? ' → 통경축 띠 비움' : ' (30% 이상, 띠 없음)'}` : '통경축 개방률 미계산(건축계획 확정 뒤 경관 검토를 다시 만들면 계산)'}${(cl.경계부_층수_점감_대상동 || []).length || cl.층수_점감_검토 ? ` · 경계부 층수 점감 → 점감 변 ${lowEdges.length}개, 경계 30m 안 ${esc($('#p_lowCap').value)}층 이하` : ''}`); }
    $('#carry').innerHTML = out.length ? '<b>다른 검토에서 넘어온 조건</b> (경계 성격·출입구·층수 상한·통경축에 자동 반영됨) <button id="applyReview" type="button">다시 반영</button><br>' + out.map(x => '· ' + x).join('<br>') : '교통성·환경성 검토서를 먼저 만들면 그 결과(진입 도로, 소음 도로, 정북 일조)가, 건축계획 확정 뒤 경관 검토를 만들면 통경축·경계부 층수 점감이 여기에 반영됩니다.';
  }

  // 채광창 이격 배수(시행령 제86조③1호): 근린상업·준주거는 4, 그 밖은 2
  function winRatio() {
    const w = crit('window_setback'); if (!w) return 0;
    const z = String(((site && site.profile) || {}).zoning || '') + ' ' + String(((site && site.v) || {}).zoning || '');
    return /근린상업|준주거/.test(z) ? (w.값.근린상업_준주거_배수 || 4) : (w.값.배수 || 2);
  }
  // 경계 변마다 붙은 도로 폭(계획 폭 우선) — 채광창 이격을 도로 건너편 경계선까지 잴 때 씀
  function edgeWidths() {
    if (!pts) return [];
    const prof = (site && site.profile) || {}, pw = {}; (prof.roads || []).forEach(r => { pw[r.name] = +(r.pw || r.w) || 0; });
    const roads = (prof.roadGeoms || []).map(r => { const g = r.geom; const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.type === 'MultiPolygon' ? g.coordinates.map(c2 => c2[0]) : []; return { name: r.name, w: pw[r.name] || +r.w || 0, polys: rings.map(rg => G.openRing(rg).map(pr.to)) }; });
    return G.edges(pts).map(e => {
      const m = [(e.a[0] + e.b[0]) / 2 + e.out[0] * 3, (e.a[1] + e.b[1]) / 2 + e.out[1] * 3];
      const hit = roads.find(r => r.polys.some(pl => G.inside(m[0], m[1], pl) || pl.some((q, k) => G.segDist(m, q, pl[(k + 1) % pl.length]) < 4)));
      return hit ? hit.w : 0;
    });
  }
  /* ---------- 배치 계산 ---------- */
  function buildInput() {
    const p = P(), A = Object.assign({}, C.가정, { floorHeight_m: +p.fh || C.가정.floorHeight_m, sideGap_m: +p.sideGap, supplyFactor: +p.sf, minFloors: +p.minFloors, maxFloors: +p.maxFloors, corner: Object.assign({}, C.가정.corner || {}, { mode: p.corner || 'min10' }) });
    const sb = tags.map(t => t === 'road' ? +p.roadSb : t === 'arterial' ? +p.artSb : +p.bndSb);
    const siteA = num(p.siteArea) || G.area(pts);
    const exA = exclude.reduce((s, ex) => { try { const g = turf.intersect(turf.polygon([ex.concat([ex[0]]).map(pr.back)]), site.geojson.geometry ? site.geojson : turf.feature(site.geojson)); return s + (g ? turf.area(g) : 0); } catch (e) { return s + Math.abs(G.area(ex)); } }, 0);
    const lot = exclude.length ? siteA - exA : siteA * (1 - (+p.infra || 0) / 100);
    // 정북 일조(건축법 제61조①)는 전용·일반주거지역만 — 구역이 준주거·상업·공업지역뿐이면 '정북 인접대지' 변도 대지경계로 봄(2026-11-06, 용현동 유원아파트 시험에서 확인)
    const zz = String(((site && site.profile) || {}).zoning || '') + ' ' + String(((site && site.v) || {}).zoning || '');
    const noSun = /준주거|상업|공업/.test(zz) && !/전용주거|일반주거|제[123]종/.test(zz);
    return {
      site: { pts, tags: noSun ? tags.map(t => (t === 'north' ? 'boundary' : t)) : tags, setbacks: sb, exclude: exclude.concat(axisStrips(p)), keep: gateZones(sb).map(z => GZ.keepPoly(z)), noSun },
      opt: { units: C.평면, lib: C.평면_라이브러리, winRatio: winRatio(), edgeW: edgeWidths(), assume: A, mix: Object.fromEntries(TYPES().map(t => [t, +p['m' + t] || 0]).filter(([, x]) => x > 0)), form: p.form === 'rec' ? recForm().form : p.form === 'compare' ? 'slab' : (p.form || 'slab'), spacing: +p.spacing, sun: crit('sunlight_north').이격, lot, far: +p.far, lowriseCap: +p.lowCap || 0, lowriseDist: +p.lowDist || 0, lowEdges: lowEdges.slice(), parkWidth: +p.parkW || 0, southBase: p.sunBase === 'south', exSetback: +p.bndSb || 0 },
      lot, exA, p,
    };
  }
  const tick = () => new Promise(r => setTimeout(r, 0));
  // 미리보기 배치(옛 '추천형'→'최근 일반형' — 배치를 모르는 주민이 감을 잡는 용도, 우리가 추천·최적안이라는 오해를 피함): 요즘 단지는 판상형만으로 짓는 곳이 드물어 판상+탑상 혼합을 기본으로, 좁은 땅은 탑상형 — 배치는 한 번만(시간 그대로)
  function recForm() {
    if (!pts || pts.length < 3) return { form: 'mix', why: '' };
    const bb = pts.reduce((m, q) => [Math.min(m[0], q[0]), Math.min(m[1], q[1]), Math.max(m[2], q[0]), Math.max(m[3], q[1])], [1e9, 1e9, -1e9, -1e9]);
    const ha = G.area(pts) / 1e4, minD = Math.min(bb[2] - bb[0], bb[3] - bb[1]);
    if (ha < 1.0 || minD < 70) return { form: 'tower', why: `미리보기 배치: 구역이 ${ha.toFixed(1)}ha${minD < 70 ? `, 짧은 변 ${Math.round(minD)}m로 좁아` : '로 작아'} 탑상형으로 그렸습니다. 이 배치는 구역 모양만으로 빠르게 그려 본 미리보기입니다. 정비계획 검토의 단계별 검토(출입구 → 정비기반시설 → 교통성 → 환경성 → 경관성 → 건축계획)를 차례로 거치고, 그 결과를 다시 배치에 반영하는 과정을 되풀이할수록 최적안에 가까워집니다` };
    return { form: 'mix', why: `미리보기 배치: 최근 단지에서 흔한 판상+탑상 혼합으로 그렸습니다. 이 배치는 구역 모양만으로 빠르게 그려 본 미리보기입니다. 정비계획 검토의 단계별 검토(출입구 → 정비기반시설 → 교통성 → 환경성 → 경관성 → 건축계획)를 차례로 거치고, 그 결과를 다시 배치에 반영하는 과정을 되풀이할수록 최적안에 가까워집니다` };
  }
  // 점검용: 콘솔에서 현재 대안 보기(window.__jbsArch.alts)
  try { window.__jbsArch = { get alts() { return alts; }, get cur() { return cur; } }; } catch (e) { /* 무시 */ }
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
        const As = I.opt.assume, Fs = [Math.round(As.minFloors + (As.maxFloors - As.minFloors) * 0.6)];
        let b = null, k = 0;
        for (const a of angles) {
          msg(`배치안 계산 중… ${label ? label + ' · ' : ''}방향 ${++k}/${angles.length}`); await tick();
          let top = 0, bcr = 100;
          for (const F of Fs) { try { const r = G.layout(I.site, Object.assign({}, I.opt, { angle: a, form, fixedF: F, quick: true })); if (r.units) { top = Math.max(top, r.gfa); bcr = Math.min(bcr, r.bcr); } } catch (e) { /* 건너뜀 */ } }
          if (!top) continue;
          const score = Math.min(top / (I.lot * I.opt.far / 100), 1) * 100 - Math.abs(a) * 0.08 - bcr * 0.02;
          if (!b || score > b.score) b = { score, a };
        }
        if (!b) return null;
        msg(`배치안 계산 중… ${label ? label + ' · ' : ''}대안 만들기(방향 ${b.a}°)`); await tick();
        try { b.r = G.alternatives(I.site, Object.assign({}, I.opt, { angle: b.a, form })); } catch (e) { return null; }
        return b.r.length ? b : null;
      }
      if (I.p.form === 'basic') { await runBasic(I); return; }
      if (I.p.form === 'deep') { await runDeep(I); return; }
      const best = await searchAngle(I.opt.form, I.p.form === 'compare' ? '판상형' : '');
      if (!best) throw new Error('어느 방향으로도 동이 들어가지 않습니다');
      alts = best.r.map(x => Object.assign(x, { angle: best.a, form: I.opt.form }));
      if ($('#basicCard')) $('#basicCard').hidden = true;
      const recWhy = I.p.form === 'rec' ? recForm().why : '';
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
      } else alts.forEach(x => { x.label = `${I.p.form === 'rec' ? '미리보기 · ' : ''}${G.FORM_NAME[I.opt.form] || '판상형'} · ${x.label}`; });
      // 기본 선택: 최고 층수가 25층에 가장 가까운 안(재개발 일반 규모) — 추천형은 첫 안
      cur = alts.reduce((bi, x, i) => Math.abs(x.maxFloors - 25) < Math.abs(alts[bi].maxFloors - 25) ? i : bi, 0);
      if (I.p.form === 'compare') { const pref = ['slab', 'mix', 'tower', 'L', 'Y', 'court'], ok = alts.map((x, i) => [x, i]).filter(([x]) => x.gfa >= x.target * 0.97).sort((a, b) => pref.indexOf(a[0].form) - pref.indexOf(b[0].form)); if (ok.length) cur = ok[0][1]; else cur = alts.reduce((bi, x, i) => x.gfa > alts[bi].gfa ? i : bi, 0); }
      if (false) cur = alts.reduce((bi, x, i) => (x.gfa > alts[bi].gfa * 1.01 || (x.gfa > alts[bi].gfa * 0.99 && x.units > alts[bi].units)) ? i : bi, 0);
      if (I.p.angleMode === 'auto') $('#p_angle').value = alts[cur].angle;
      sunRes = null; v3 = null;
      $('#out').hidden = false; $('#confirm').disabled = false;
      renderAlts(); showView('plan'); drawBuildingsOnMap();
      const A = alts[cur];
      msg(`${recWhy ? recWhy + '. ' : ''}${alts.length}개 대안을 만들었습니다(${I.p.form === 'compare' ? '형태마다 방향을 따로 찾음, 선택한 안 ' : '주동 방향 '}${alts[cur].angle >= 0 ? '+' : ''}${alts[cur].angle}°). 획지 ${fmt(I.lot)}㎡ 기준 목표 용적률 ${fmt(I.opt.far)}%${A.far < I.opt.far * 0.97 ? ' — 이 구역 조건으로는 목표에 못 미칩니다(최대 ' + fmt(Math.max(...alts.map(x => x.far)), 1) + '%)' : ''}.`);
      $('#out').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { console.error(e); msg('배치를 만들지 못했습니다: ' + e.message, true); }
    finally { $('#run').classList.remove('busy'); }
  }
  /* ---------- 기본형 8가지(2026-11-05 사용자 결정 '기본형부터 무조건 돌리고 무엇이 모자란지 보고 보완') ----------
     shared/simple-plan.js(JbsSimple)를 arch/simple-worker.js로 돌려 동 타입마다 같은 모양·같은 간격 배치 → 진단 → 보완(줄 끝 채우기·평형 맞추기) + 성적표
     결과 동은 지금 대안과 같은 꼴로 바꿔 배치도·일조·3D·개요·확정이 그대로 동작 */
  let SW = null; const SWCB = {};
  function simpleWorker() {
    if (SW) return SW;
    SW = new Worker('simple-worker.js?v=a4cb93ec');
    SW.onmessage = e => { const f = SWCB[e.data.id]; delete SWCB[e.data.id]; if (f) f(e.data); };
    SW.onerror = ev => { Object.values(SWCB).forEach(f => f({ r: null, err: ev.message || '계산 오류' })); Object.keys(SWCB).forEach(k => delete SWCB[k]); SW = null; };
    return SW;
  }
  function toAlt(v, I, card) {
    const As = I.opt.assume, H = f => f * As.floorHeight_m + As.groundExtra_m, th = (v.angle || 0) * Math.PI / 180;
    const blds = v.buildings.map(b => {
      const loc = b.parts.flat().map(p => G.rot(p, -th)), xs = loc.map(p => p[0]), ys = loc.map(p => p[1]);
      const main = Object.keys(b.mixT).sort((x, y) => b.mixT[y] - b.mixT[x] || +y - +x)[0];
      const cxy = G.rot([(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], th);
      return Object.assign({}, b, { t: main, n: b.n, L: Math.max(...xs) - Math.min(...xs), D: Math.max(...ys) - Math.min(...ys), center: cxy, cap: b.planF || b.floors, divs: [], vname: b.vname || '' });
    });
    const st = v.steps || [], name = v.label.replace('기본 배치 — ', '').replace('기본 + 보완 — ', '');
    return { label: `기본형 · ${name}${st.length > 1 ? ' + 보완' : ''}`, buildings: blds, units: v.units, far: v.far, bcr: v.bcr, gfa: v.gfa, byType: v.byType, maxFloors: v.maxFloors,
      maxHeight: H(v.maxFloors), H, angle: v.angle, form: blds[0] ? (blds[0].form === 'L' ? 'L' : blds[0].form) : 'slab', target: I.lot * I.opt.far / 100, basic: { dtype: v.dtype, steps: st, card, rules: v.rules, risks: v.risks } };
  }
  function cardHtml(card) {
    if (!card) return '';
    const r = card.rows.slice().sort((a, b) => b.units - a.units), w = card.win;
    return `<details open class="card"><summary><b>기본형 성적표</b> — 같은 모양 동을 일정하게 놓아 본 결과(보완 후). 세대수 1위 ${esc(w.units.name)} · 용적률 1위 ${esc((w.far || w.units).name)} · 일조 1위 ${esc(w.sun.name)} · 평형 1위 ${esc(w.mix.name)}</summary>
      <table class="tbl"><tr><th>동 타입</th><th>세대</th><th>용적률</th><th>방향</th><th>평형 비율 차이</th><th>일조 부족 동</th><th>정북 일조로 깎인 세대·층</th><th>채광창으로 깎인</th><th>기본형 자투리</th><th>보완</th></tr>
      ${r.map(x => `<tr><td>${esc(x.name)}</td><td>${fmt(x.units)}</td><td>${fmt(x.far, 0)}%</td><td>${x.angle}°</td><td>${x.mixErr.toFixed(2)}</td><td>${x.sunFail}/${x.n}</td><td>${x.cutSun}</td><td>${x.cutWin}</td><td>${x.empty == null ? '-' : x.empty + 'm'}</td><td>${esc(x.steps.join(' + ') || '-')}</td></tr>`).join('')}</table>
      <ul>${card.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
      <p class="note">평형 비율 차이: 목표 비율과 세대 비율 차이의 합(0이면 목표와 같음). 깎인 세대·층: 계획 층수에서 높이 제한으로 줄어든 층수 × 층당 세대. 자투리: 보완 전 줄 안에서 비어 남은 건축 가능 길이.</p></details>`;
  }
  async function runBasic(I) {
    msg('기본형 8가지 계산 중… (같은 모양 동을 방향·층수·줄 위치를 바꿔 가며 놓고, 모자란 것을 보완합니다 — 구역에 따라 10~30초)');
    const id = Date.now() + Math.random();
    const res = await new Promise(ok => { SWCB[id] = ok; simpleWorker().postMessage({ id, site: I.site, opt: Object.assign({}, I.opt, { crit: C.items }) }); });
    if (!res.r || !res.r.variants.length) throw new Error(res.err || '어느 동 타입도 들어가지 않습니다');
    const card = res.r.card;
    alts = res.r.variants.map(v => toAlt(v.improved || v, I, card));
    cur = alts.reduce((bi, x, i) => x.units > alts[bi].units ? i : bi, 0);
    sunRes = null; v3 = null;
    $('#out').hidden = false; $('#confirm').disabled = false;
    $('#basicCard').innerHTML = cardHtml(card); $('#basicCard').hidden = false;
    renderAlts(); showView('plan'); drawBuildingsOnMap();
    msg(`기본형 ${alts.length}가지를 만들었습니다(${(res.r.ms / 1000).toFixed(0)}초). 세대수가 가장 많은 ${alts[cur].label}을 골라 두었습니다. 아래 성적표에서 무엇이 막혔는지 보고, 다른 동 타입을 눌러 비교하세요.`);
    $('#out').scrollIntoView({ behavior: 'smooth' });
  }
  /* ---------- 안별 사업성(2026-11-05): 배치 결과 세대·평형·연면적 → 공통 사업성 계산(shared/feas.js JbsFeas.money, 첫 화면·/urban과 같은 가정값)
     보수(일반분양가 −10%·공사비 +10%) · 기본 · 낙관(분양가 +10%·공사비 −5%) 세 가지 비례율. 종전자산은 사업성 화면 [1차 재검토로 넘기기] 값(site.quick.prior), 없으면 직접 입력(억원) */
  const SCEN = [{ k: '보수', gp: 0.9, cp: 1.1 }, { k: '기본', gp: 1, cp: 1 }, { k: '낙관', gp: 1.1, cp: 0.95 }];
  function priorOf() { const m = num((site && site.v && site.v.priorEok) || 0) * 10000; return m > 0 ? { v: m, src: '직접 입력' } : (site && site.quick && site.quick.prior > 0 ? { v: site.quick.prior, src: `사업성 화면 1회차(${site.quick.at || ''})` } : null); }
  function feasOf(A, sc) {
    if (!window.JbsFeas) return null;
    const F = JbsFeas.get(), Fs = Object.assign({}, F, { generalPrice: F.generalPrice * sc.gp, conPrice: F.conPrice * sc.cp }), pv = priorOf();
    const total = Object.values(A.byType || {}).reduce((a, b) => a + b, 0), rental = Math.round(total * F.rentRatio / 100);
    const members = num(site && site.quick && site.quick.members) || Math.round(total * 0.5);
    return JbsFeas.money({ byType: A.byType, rental, members, farArea: A.gfa, resArea: A.gfa, prior: pv ? pv.v : 0 }, Fs);
  }
  function renderFeas() {
    const box = $('#feasCard'); if (!box) return;
    if (!alts.length || !window.JbsFeas) { box.innerHTML = ''; return; }
    const pv = priorOf(), eok = x => fmt(x / 10000, 0);
    const rows = alts.map((A, i) => { const r = SCEN.map(sc => feasOf(A, sc)); return { A, i, r }; });
    if (!$('#feasBody')) box.innerHTML = `<details class="card" open><summary><b>안별 사업성(개략)</b> — 배치 결과 세대·평형·연면적으로 계산. <span id="feasPriorNote"></span></summary>
      <p><label>종전자산(억원, 직접 입력) <input id="feasPrior" inputmode="decimal" style="width:8em" value="${esc(site && site.v && site.v.priorEok || '')}"></label> <span class="note">비우면 사업성 화면에서 넘긴 값</span></p><div id="feasBody"></div></details>`;
    $('#feasPriorNote').textContent = `종전자산 ${pv ? `${eok(pv.v)}억원(${pv.src})` : '없음 — 아래 칸에 넣으면 비례율이 나옵니다'}`;
    $('#feasBody').innerHTML = `<table class="tbl"><tr><th>안</th><th>세대</th><th>지상 연면적</th><th>총수입(기본)</th><th>총사업비(기본)</th>${SCEN.map(s => `<th>비례율 ${s.k}</th>`).join('')}</tr>
      ${rows.map(({ A, i, r }) => `<tr${i === cur ? ' style="font-weight:600"' : ''}><td>${esc(A.label)}</td><td>${fmt(A.units)}</td><td>${fmt(A.gfa)}㎡</td><td>${r[1] ? eok(r[1].rev) + '억' : '-'}</td><td>${r[1] ? eok(r[1].cost) + '억' : '-'}</td>${r.map(x => `<td>${x && isFinite(x.ratio) ? fmt(x.ratio, 1) + '%' : (x ? '이익 ' + eok(x.profit) + '억' : '-')}</td>`).join('')}</tr>`).join('')}</table>
      <p class="note">보수 = 일반분양가 −10%·공사비 +10%, 낙관 = 분양가 +10%·공사비 −5%(가정). 분양가·공사비·임대 비율 등은 사업성 화면 공통 가정값. 인허가 및 심의 과정에서 변동될 수 있습니다.</p>`;
  }
  document.addEventListener('change', e => { if (e.target && e.target.id === 'feasPrior') { site.v = site.v || {}; site.v.priorEok = e.target.value; try { saveState(); } catch (er) { /* 무시 */ } setTimeout(renderFeas, 0); } });
  /* ---------- 심화 배치(2026-11-05): arch/plan-worker.js(JbsPlan) — 기본형·지금 엔진 후보까지 모아 세대수·일조·균형 세 가지 안 */
  let PW = null; const PWCB = {};
  async function runDeep(I) {
    msg('심화 배치 계산 중… 골격·구획·방향·높이·동 형태를 바꿔 가며 반복 탐색합니다(기본형 후보 포함, 탐색 90초 + 기본형 계산 — 보통 2~3분). 이 창을 닫지 마세요.');
    if (!PW) { PW = new Worker('plan-worker.js?v=93363d1b'); PW.onmessage = e => { const f = PWCB[e.data.id]; delete PWCB[e.data.id]; if (f) f(e.data); }; PW.onerror = ev => { Object.values(PWCB).forEach(f => f({ r: null, err: ev.message || '계산 오류' })); Object.keys(PWCB).forEach(k => delete PWCB[k]); PW = null; }; }
    const id = Date.now() + Math.random();
    const res = await new Promise(ok => { PWCB[id] = ok; PW.postMessage({ id, site: I.site, opt: Object.assign({}, I.opt, { crit: C.items, lat: pr ? pr.lat0 : 37.46 }) }); });
    if (!res.r || !res.r.variants.length) throw new Error(res.err || '심화 배치 안을 만들지 못했습니다');
    alts = res.r.variants.map(v => { const a = toAlt(Object.assign({}, v, { label: v.label, steps: [] }), I, null); a.label = `심화 · ${v.label} (${v.skeleton})`; return a; });
    cur = 0; sunRes = null; v3 = null;
    $('#out').hidden = false; $('#confirm').disabled = false; if ($('#basicCard')) $('#basicCard').hidden = true;
    renderAlts(); showView('plan'); drawBuildingsOnMap();
    msg(`심화 배치 ${alts.length}가지 안(구도 ${res.r.decodes}회 계산, ${Math.round(res.r.ms / 1000)}초). 세대수·일조·균형 우선 순서입니다.`);
    $('#out').scrollIntoView({ behavior: 'smooth' });
  }
  /* ---------- 배치도 올려서 검토(2026-11-05): shared/plan-import.js(JbsImport) — ① DXF 읽기(ZoneKit.dxfPolys + JbsImport.dxfTexts, 측량 좌표 → 경위도 → 대지 좌표) ② 동 알아보기 표(사람이 확인·수정) ③ [이 배치로 검사] → 대안 하나로 배치도·치수선·위험요소·사업성 */
  let IMP = null;
  async function importDxf(file) {
    const out = $('#impOut'); out.innerHTML = '읽는 중…';
    try {
      if (!pts || !pr) throw new Error('먼저 구역계를 불러오세요(배치도를 대지에 맞추는 기준)');
      const buf = await file.arrayBuffer(); let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { text = new TextDecoder('euc-kr').decode(buf); }
      if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error('바이너리 DXF는 읽지 못합니다. CAD에서 ASCII DXF로 다시 저장해 주세요');
      const ins = JbsImport.dxfInserts(text);   // 블록(INSERT)으로 넣은 동도 펼쳐서 읽음
      const polys = ZoneKit.dxfPolys(text).concat(ins.polys), texts = JbsImport.dxfTexts(text).concat(ins.texts);
      if (!polys.length) throw new Error('닫힌 폴리선이 없습니다');
      // 좌표계: 경위도면 그대로, 아니면 한국 측량 좌표 후보 중 대지 가운데에 가장 가까운 것
      const c0 = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]), cLL = pr.back(c0);
      const p0 = polys.map(q => q.pts[0]).sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))[0]; let fn = null, crs = '';
      if (Math.abs(p0[0]) <= 180 && Math.abs(p0[1]) <= 90) { fn = q => q; crs = '경위도'; }
      else {
        await ZoneKit.loadProj4(); let bd = Infinity;
        ZoneKit.DXF_CRS.forEach(([name, def]) => { try { const ll = proj4(def, 'WGS84', p0), d = Math.hypot(ll[0] - cLL[0], (ll[1] - cLL[1]) * 1.25); if (d < bd) { bd = d; fn = q => proj4(def, 'WGS84', q); crs = name; } } catch (e) { /* 건너뜀 */ } });
        if (!fn || bd > 0.05) throw new Error('도면 좌표가 이 구역 근처 측량 좌표가 아닙니다(도면 자체 좌표이거나 다른 곳). 측량 좌표가 들어간 DXF가 필요합니다');
      }
      const toM = q => pr.to(fn(q));
      const P2 = polys.map(p => ({ layer: p.layer, pts: p.pts.map(toM) })), T2 = texts.map(t => { const m = toM([t.x, t.y]); return Object.assign({}, t, { x: m[0], y: m[1] }); });
      const I = buildInput(), rows = JbsImport.recognize(P2, T2, I.site, I.opt);
      const t0 = Object.keys(I.opt.mix).sort((a, b) => I.opt.mix[b] - I.opt.mix[a])[0] || '84'; rows.forEach(r => { r.t = t0; });
      IMP = { rows, crs, file: file.name };
      renderImp();
    } catch (e) { console.warn(e); out.innerHTML = `<p class="msg err">${esc(e.message)}</p>`; }
  }
  function renderImp() {
    const out = $('#impOut'); if (!IMP) { out.innerHTML = ''; return; }
    const ts = TYPES();
    out.innerHTML = `<p>${esc(IMP.file)} — 좌표계 ${esc(IMP.crs)}, 동으로 보이는 도형 ${IMP.rows.length}개. 믿음 정도가 '낮음'이면 층수·층당 세대를 꼭 고치세요.</p>
      <table class="tbl"><tr><th>사용</th><th>동</th><th>레이어</th><th>바닥 ㎡</th><th>형태</th><th>층수</th><th>층당 세대</th><th>주 평형</th><th>믿음</th><th>도형 안 글자</th></tr>
      ${IMP.rows.map((r, i) => `<tr><td><input type="checkbox" data-imp="${i}" data-k="use" ${r.use ? 'checked' : ''}></td><td><input type="number" data-imp="${i}" data-k="id" value="${r.id}" style="width:5em"></td><td>${esc(r.layer)}</td><td>${fmt(r.area)}</td>
        <td><select data-imp="${i}" data-k="form"><option value="slab"${r.form === 'slab' ? ' selected' : ''}>판상(긴 변 창)</option><option value="free"${r.form !== 'slab' ? ' selected' : ''}>그 밖(모든 벽 창)</option></select></td>
        <td><input type="number" data-imp="${i}" data-k="floors" value="${r.floors}"> <span class="note">${esc(r.floorsFrom)}</span></td><td><input type="number" data-imp="${i}" data-k="perFloor" value="${r.perFloor}"></td>
        <td><select data-imp="${i}" data-k="t">${ts.map(t => `<option value="${t}"${String(r.t) === t ? ' selected' : ''}>${t}㎡</option>`).join('')}</select></td><td>${esc(r.conf)}</td><td class="note">${esc(r.texts.join(' · ').slice(0, 40))}</td></tr>`).join('')}</table>
      <div class="bar" style="margin-top:8px"><button class="primary" id="impRun">이 배치로 검사</button></div>`;
  }
  document.addEventListener('change', e => {
    const el = e.target; if (!el) return;
    if (el.id === 'impFile' && el.files && el.files[0]) importDxf(el.files[0]);
    if (el.dataset && el.dataset.imp !== undefined && IMP) { const r = IMP.rows[+el.dataset.imp], k = el.dataset.k; r[k] = k === 'use' ? el.checked : (k === 'form' || k === 't') ? el.value : +el.value; }
  });
  document.addEventListener('click', e => { if (e.target && e.target.id === 'impRun') runImported(); });
  // 사례 보정(2026-11-06): 실제 정비계획 대조로 맞춘 동 간격 — arch.json 가정.practice_calib
  document.addEventListener('click', e => {
    if (!e.target || e.target.id !== 'calibBtn') return; const P = C.가정.practice_calib; if (!P) return;
    const set = (id, v) => { const el = $('#' + id); if (el) { el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); } };
    set('p_spacing', P.spacing); set('p_sideGap', P.sideGap_m); set('p_corner', P.corner);
    msg(`사례 보정 값으로 바꿨습니다: 앞뒤 ${P.spacing}배 · 옆 ${P.sideGap_m}m · 모서리 최소 10m. ${P.주의}`);
  });
  function runImported() {
    if (!IMP) return;
    const I = buildInput(), As = I.opt.assume, H = f => f * As.floorHeight_m + As.groundExtra_m, sup = t => (+C.평면[t].공급 > 0 ? +C.평면[t].공급 : C.평면[t].전용 * As.supplyFactor);
    const blds = JbsImport.toBuildings(IMP.rows, I.opt).map(b => { const th = (b.angle || 0) * Math.PI / 180, loc = b.poly.map(p => G.rot(p, -th)), xs = loc.map(p => p[0]), ys = loc.map(p => p[1]);
      return Object.assign(b, { L: Math.max(...xs) - Math.min(...xs), D: Math.max(...ys) - Math.min(...ys), center: b.poly.reduce((a, p) => [a[0] + p[0] / b.poly.length, a[1] + p[1] / b.poly.length], [0, 0]), cap: b.floors, divs: [], cores: [], units: [], vname: '올린 배치도' }); });
    if (!blds.length) { msg('사용할 동이 없습니다.', true); return; }
    const byType = {}; blds.forEach(b => { byType[b.t] = (byType[b.t] || 0) + b.n * b.floors; });
    const gfa = blds.reduce((s, b) => s + b.n * b.floors * sup(b.t), 0), ba = blds.reduce((s, b) => s + Math.abs(G.area(b.poly)), 0), mf = Math.max(...blds.map(b => b.floors));
    alts = [{ label: `올린 배치도 · ${IMP.file}`, buildings: blds, units: blds.reduce((s, b) => s + b.n * b.floors, 0), gfa, far: gfa / I.lot * 100, bcr: ba / I.lot * 100, byType, maxFloors: mf, maxHeight: H(mf), H, angle: blds[0].angle || 0, form: 'slab', target: I.lot * I.opt.far / 100, imported: true }];
    cur = 0; sunRes = null; v3 = null;
    $('#out').hidden = false; $('#confirm').disabled = false; if ($('#basicCard')) $('#basicCard').hidden = true;
    renderAlts(); showView('plan'); drawBuildingsOnMap();
    msg(`올린 배치도 ${blds.length}개동을 같은 기준으로 검사했습니다. 배치도 아래 '위험요소 검토'와 치수선에서 법정 거리·일조를 확인하세요(세대·연면적은 표에 넣은 층당 세대 기준).`);
    $('#out').scrollIntoView({ behavior: 'smooth' });
  }
  // 일조 시뮬레이터(2026-11-06, 사용자 '어떻게 되는지 시뮬레이션이 되나? 그래야 내가 스케치를 해주지') — 지금 대안을 브라우저 안에서만 넘김(저장소·서버로 안 감)
  function openSunSim() {
    if (!alts.length) { msg('먼저 배치안을 만드세요.', true); return; }
    const I = buildInput(), A = alts[cur], As = I.opt.assume;
    const plain = b => ({ id: b.id, dname: b.dname || b.vname || '', form: b.form, floors: b.floors, n: b.n, t: b.t, mixT: b.mixT || { [b.t]: b.n }, poly: b.poly, parts: b.parts || [b.poly], cores: b.cores || [], units: b.units || [], walls: b.walls || [], angle: b.angle || 0 });
    const data = { name: (site && site.name) || '', lat: pr ? pr.lat0 : 37.46, lon: pr ? pr.lon0 : 126.65, lot: I.lot, site: { pts: I.site.pts, setbacks: I.site.setbacks }, exclude: (I.site.exclude || []).map(q => q.pts || q).filter(q => Array.isArray(q) && q.length > 2),
      assume: { floorHeight_m: As.floorHeight_m, groundExtra_m: As.groundExtra_m, supplyFactor: As.supplyFactor }, units: C.평면,
      supply: Object.fromEntries(Object.keys(C.평면).filter(t => C.평면[t] && C.평면[t].전용).map(t => [t, +C.평면[t].공급 > 0 ? +C.평면[t].공급 : C.평면[t].전용 * As.supplyFactor])), start: A.buildings.map(plain) };
    try { localStorage.setItem('jbs-sunsim-cache', JSON.stringify(data)); } catch (e) { msg('브라우저 저장 공간이 모자라 시뮬레이터로 넘기지 못했습니다.', true); return; }
    window.open('sunsim.html', '_blank');
  }
  // 동 목록(월드 좌표) → 대안 하나(시뮬레이터 받기·일조 연계 다듬기 공용). mixT 없는 동은 t·n으로
  function altFromBuildings(list, label, vname) {
    const I = buildInput(), As = I.opt.assume, H = f => f * As.floorHeight_m + As.groundExtra_m, sup = t => (C.평면[t] ? (+C.평면[t].공급 > 0 ? +C.평면[t].공급 : C.평면[t].전용 * As.supplyFactor) : (+t || 84) * As.supplyFactor);
    const blds = list.map((b, i) => { const mt = b.mixT || (b.t ? { [b.t]: b.n || 1 } : {}), t = Object.keys(mt).sort((x, y) => mt[y] - mt[x])[0] || '84', th = (b.angle || 0) * Math.PI / 180, loc = b.poly.map(p => G.rot(p, -th)), xs = loc.map(p => p[0]), ys = loc.map(p => p[1]);
      return Object.assign({}, b, { id: i + 1, t, mixT: mt, L: Math.max(...xs) - Math.min(...xs), D: Math.max(...ys) - Math.min(...ys), center: b.poly.reduce((a, p) => [a[0] + p[0] / b.poly.length, a[1] + p[1] / b.poly.length], [0, 0]), cap: b.floors, divs: [], vname: b.vname || b.dname || vname }); });
    // 계단식(날개별 층수) 동은 세대 조각 층수 합 ÷ (조각 수 × 최고 층수) 비율로 줄임(JbsCheck stepK와 같음)
    const kOf = b => (Array.isArray(b.unitFl) && b.unitFl.length && b.floors > 0 ? b.unitFl.reduce((a, f) => a + f, 0) / (b.unitFl.length * b.floors) : 1);
    const byType = {}; blds.forEach(b => Object.keys(b.mixT).forEach(t => { byType[t] = (byType[t] || 0) + Math.round(b.mixT[t] * b.floors * kOf(b)); }));
    const gfa = blds.reduce((s, b) => s + Object.keys(b.mixT).reduce((c, t) => c + b.mixT[t] * b.floors * sup(t), 0) * kOf(b), 0), ba = blds.reduce((s, b) => s + Math.abs(G.area(b.poly)), 0), mf = Math.max(...blds.map(b => b.floors));
    blds.forEach(b => { if (b.wingFloors) b.vname = `${b.vname || b.dname || ''} · 날개 ${b.wingFloors.join('/')}층`; });
    return { label, buildings: blds, units: blds.reduce((s, b) => s + Math.round((b.n || 0) * b.floors * kOf(b)), 0), gfa, far: gfa / I.lot * 100, bcr: ba / I.lot * 100, byType, maxFloors: mf, maxHeight: H(mf), H, angle: 0, form: 'mix', target: I.lot * I.opt.far / 100, imported: true };
  }
  /* 일조 연계 다듬기(2026-11-07, 사용자 목록 2): 지금 대안에서 출발 → shared/sun-refine.js(워커 arch/refine-worker.js, 시간 예산 90초)
     결과는 대안 하나를 더함. 세대수는 '순세대'(동지 2시간 미달 세대를 뺀 값 — 저층 3개 층 안 미달은 필로티·커뮤니티로 비움, 그보다 많은 줄은 못 씀) */
  let RW = null, RWCB = {}, RWPROG = {};
  async function runRefine() {
    const A = alts[cur], btn = $('#refineBtn'); if (!A || !btn) return;
    const { I, opt } = riskOpt(), id = Date.now();
    if (!RW) { RW = new Worker('refine-worker.js?v=87d5bfeb'); RW.onmessage = e => { const d = e.data; if (d.prog) { const f = RWPROG[d.id]; if (f) f(d.prog); return; } const f = RWCB[d.id]; delete RWCB[d.id]; delete RWPROG[d.id]; if (f) f(d); }; RW.onerror = ev => { Object.values(RWCB).forEach(f => f({ r: null, err: ev.message || '계산 오류' })); RWCB = {}; RWPROG = {}; RW = null; }; }
    btn.disabled = true; btn.textContent = '다듬는 중…';
    const blds = JSON.parse(JSON.stringify(A.buildings.map(b => { const o = {}; ['id', 'poly', 'parts', 'cores', 'units', 'divs', 'walls', 'center', 'angle', 'floors', 'form', 'n', 't', 'mixT', 'inner', 'vname', 'dname', 'notes', 'wingUnits', 'partWing', 'unitWing', 'wingFloors', 'partFl', 'unitFl'].forEach(k => { if (b[k] !== undefined && typeof b[k] !== 'function') o[k] = b[k]; }); return o; })));
    const res = await new Promise(ok => { RWCB[id] = ok; RWPROG[id] = s => { btn.textContent = `다듬는 중… 순 ${fmt(s.net)}세대 · ${s.n}개동 · ${Math.round(s.ms / 1000)}초`; }; RW.postMessage({ id, site: I.site, blds, opt: Object.assign({}, opt, { lat: pr ? pr.lat0 : 37.46 }), budget: 90000 }); });
    btn.disabled = false; btn.textContent = '일조 연계 다듬기';
    if (!res.r) { msg('일조 연계 다듬기를 하지 못했습니다: ' + (res.err || ''), true); return; }
    const r = res.r, B = r.best, S0 = r.start;
    const alt = altFromBuildings(r.blds, `일조 다듬기 순 ${fmt(B.net)}세대`, '일조 연계 다듬기');
    const k = B.gross ? B.net / B.gross : 1; alt.grossUnits = alt.units; alt.units = B.net; alt.gfa *= k; alt.far *= k; Object.keys(alt.byType).forEach(t => { alt.byType[t] = Math.round(alt.byType[t] * k); });
    alt.refine = { start: S0, best: B, steps: r.steps.length, tries: r.tries, ms: r.ms, from: A.label };
    alts.push(alt); cur = alts.length - 1; sunRes = null; v3 = null; renderAlts(); showView('plan'); drawBuildingsOnMap();
    msg(`일조 연계 다듬기: '${A.label}'에서 출발 — 순 ${fmt(S0.net)} → ${fmt(B.net)}세대(세대 ${fmt(B.gross)} 중 저층 비움 ${fmt(B.low)} · 못 쓰는 줄 ${fmt(B.dead)}), ${r.blds.length}개동, ${fmt(r.tries)}번 시도 ${Math.round(r.ms / 1000)}초${B.legal ? '' : ' · 규칙 위반 남음: ' + B.bad.join(', ')}. 동 사이 본문 거리는 단서(모든 세대 동지 2시간)로 갈음한 배치입니다.`);
  }
  document.addEventListener('click', e => { if (e.target && e.target.id === 'refineBtn') runRefine(); });
  // 정비계획 결정조서(안)(2026-11-07): 확정안이 있는 이 구역으로 /decision
  document.addEventListener('click', e => { if (!e.target || e.target.id !== 'toDecision') return; if (site && site.id) { if (!(site.arch && site.arch.chosen) && !confirm('아직 [이 안으로 확정]을 하지 않았습니다. 확정 전이면 결정조서의 건축·분담금 칸이 비어 나옵니다. 그래도 열까요?')) return; location.href = '/decision/?site=' + encodeURIComponent(site.id); } else location.href = '/decision/'; });
  // 판넬·팸플릿(2026-11-07, 사용자 목록 8·9): 확정안이 있는 이 구역으로 /panel
  document.addEventListener('click', e => { if (!e.target || e.target.id !== 'toPanel') return; if (site && site.id) { if (!(site.arch && site.arch.chosen) && !confirm('아직 [이 안으로 확정]을 하지 않았습니다. 확정 전이면 판넬에 배치도·건축 개요가 비어 나옵니다. 그래도 열까요?')) return; location.href = '/panel/?site=' + encodeURIComponent(site.id); } else location.href = '/panel/'; });
  function takeSunSim() {
    let r = null; try { r = JSON.parse(localStorage.getItem('jbs-sunsim-back-cache') || 'null'); } catch (e) { r = null; }
    if (!r || !r.buildings || !r.buildings.length) { msg('시뮬레이터에서 [이 배치를 건축계획 화면으로]를 먼저 누르세요.', true); return; }
    alts = [altFromBuildings(r.buildings, '일조 시뮬레이터에서 받은 배치', '시뮬레이터')];
    cur = 0; sunRes = null; v3 = null;
    $('#out').hidden = false; $('#confirm').disabled = false; if ($('#basicCard')) $('#basicCard').hidden = true;
    renderAlts(); showView('plan'); drawBuildingsOnMap();
    msg(`시뮬레이터 배치 ${blds.length}개동을 받았습니다. 위험요소 검토·사업성·[이 안으로 확정]을 그대로 쓸 수 있습니다.`);
  }
  document.addEventListener('click', e => { const id = e.target && e.target.id; if (id === 'sunSimBtn') openSunSim(); else if (id === 'sunSimBack') takeSunSim(); });
  function invalidate() { if (alts.length) { msg('조건이 바뀌었습니다. [배치안 만들기]를 다시 누르세요.'); } }

  /* ---------- 결과 화면 ---------- */
  function renderAlts() {
    setTimeout(renderFeas, 0);
    $('#alts').innerHTML = alts.map((a, i) => `<button class="alt" data-alt="${i}" aria-pressed="${i === cur}"><b>${esc(a.label)}</b><span>${a.buildings.length}개동 · ${fmt(a.units)}세대 · 최고 ${a.maxFloors}층<br>용적률 ${fmt(a.far, 1)}% · 건폐율 ${fmt(a.bcr, 1)}%</span></button>`).join('');
  }
  let curView = 'plan';
  function showView(v) {
    curView = v;
    $$('.otabs [role=tab]').forEach(b => b.setAttribute('aria-selected', b.dataset.v === v));
    ['plan', 'sun', 'm3d', 'bird', 'sum', 'unit'].forEach(k => { $('#v' + k).hidden = k !== v; });
    ({ plan: renderPlan, sun: renderSun, m3d: render3d, bird: renderBird, sum: renderSum, unit: renderUnits })[v]();
  }
  // 치수선(인동·정북 일조·채광창 이격 — 2026-11-05 사용자 요구 '치수선을 그대로 표시하면 바로 보임'): 검사 부품 JbsCheck.dims
  function planDims() {
    const on = $('#dimShow'); if (!on || !on.checked || !window.JbsCheck || !alts[cur]) return null;
    try { const I = buildInput(); return JbsCheck.dims(I.site, alts[cur].buildings, Object.assign({}, I.opt, { crit: C.items, dimAll: !!($('#dimAll') || {}).checked })); } catch (e) { console.warn('치수선', e); return null; }
  }
  const planOpts = extra => Object.assign({ site: pts, tags, setbacks: buildInput().site.setbacks, exclude, exKinds, entries, gates: gateZones(), roadSb: +P().roadSb, artSb: +P().artSb, alt: alts[cur], title: site.name || '', coreW: C.가정.coreW_m, dims: planDims() }, extra || {});
  document.addEventListener('change', e => { if (e.target && (e.target.id === 'dimShow' || e.target.id === 'dimAll') && alts.length) renderPlan(); });
  function renderPlan() { $('#planSvg').innerHTML = D.sitePlan(planOpts()); renderRisk(); }
  function riskOpt() { const I = buildInput(), legalSp = +((crit('spacing_ratio') || {}).값) || I.opt.spacing; return { I, opt: Object.assign({}, I.opt, { crit: C.items, lat: pr ? pr.lat0 : 37.46, spacing: Math.max(legalSp, I.opt.spacing) }) }; }
  // 일조 정밀 검산(2026-11-07): 엔진(10분·그림자 다각형)과 다른 방법(따로 계산한 태양 위치·1분·창에서 해 쪽 광선)으로 같은 창을 다시 판정 — shared/sun-verify.js
  async function runSunVerify() {
    const A = alts[cur], btn = $('#sunVerifyBtn'), out = $('#sunVerifyOut'); if (!A || !A.__risk || !window.JbsSunVerify || !btn) return;
    btn.disabled = true; btn.textContent = '검산 중…';
    try {
      const { I, opt } = riskOpt();
      if (!A.__risk.pv) A.__risk.pv = JbsCheck.unitSun(I.site, A.buildings, opt);
      const vo = { fh: I.opt.assume.floorHeight_m, groundExtra: I.opt.assume.groundExtra_m, lat: pr ? pr.lat0 : 37.46, lon: pr ? pr.lon0 : 126.65, onProgress: (i, n) => { btn.textContent = `검산 중… ${i}/${n}`; } };
      const r = await JbsSunVerify.check(A.buildings, A.__risk.pv, vo), rk = await JbsSunVerify.check(A.buildings, A.__risk.pv, Object.assign({}, vo, { basis: 'kst', onProgress: null }));
      A.__risk.sv = JbsSunVerify.html(r, rk, esc); A.__risk.svr = { sun: r.sun, kstLost: rk.lost.ray }; renderRisk();
    } catch (e) { console.warn('정밀 검산', e); if (out) out.textContent = '정밀 검산을 하지 못했습니다: ' + e.message; btn.disabled = false; btn.textContent = '정밀 검산(1분 간격 광선)'; }
  }
  document.addEventListener('click', e => { if (e.target && e.target.id === 'sunVerifyBtn') runSunVerify(); });
  // 위험요소 카드(2026-11-05): 검사 부품 JbsCheck.verify — 규칙 위반(대안 포함)·동 사이 거리 단서(동지 2시간)·경험 항목(원인·영향·확인 자료·대안)
  function renderRisk() {
    const box = $('#riskCard'); if (!box) return;
    const A = alts[cur]; if (!A || !window.JbsCheck) { box.innerHTML = ''; return; }
    if (!A.__risk) {
      try {
        // 검사는 늘 법정 배수(인천 조례 0.8)로 — 배치 배수를 낮춰(단서 전제) 돌렸으면 동 사이 위반 + 단서(동지 2시간) 개략 확인이 같이 뜸(2026-11-06)
        const { I, opt } = riskOpt(), v = JbsCheck.verify(I.site, A.buildings, opt);
        const sp = v.rules.filter(r => ['spacing', 'side'].includes(r.id));
        Object.defineProperty(A, '__risk', { value: { v, pv: sp.length ? JbsCheck.unitSun(I.site, A.buildings, opt) : null }, enumerable: false, configurable: true });
      } catch (e) { console.warn('위험요소', e); box.innerHTML = ''; return; }
    }
    const { v, pv } = A.__risk, G1 = { 고위험: 0, 주의: 1, 권고: 2 }, risks = v.risks.slice().sort((a, b) => (G1[a.등급] ?? 3) - (G1[b.등급] ?? 3));
    const rule = r => `<li class="bad"><b>${esc(r.항목)}</b> ${r.동 && r.동.length ? `(${r.동.join('·')}동)` : ''} — ${esc(r.값 || '')}${r.기준 ? ` / 기준 ${esc(r.기준)}` : ''}<br><span class="note">${esc(r.근거 || '')}</span>${r.대안 ? `<br>대안: ${esc(r.대안)}` : ''}</li>`;
    const risk = r => `<li class="${r.등급 === '고위험' ? 'bad' : r.등급 === '주의' ? 'warn' : ''}"><b>[${esc(r.등급)}] ${esc(r.항목)}</b><br>원인: ${esc(r.원인 || '')}<br>영향: ${esc(r.영향 || '')}${r.확인자료 ? `<br>확인 자료: ${esc(r.확인자료)}` : ''}${r.대안 ? `<br>대안: ${esc(r.대안)}` : ''}<br><span class="note">${esc(r.근거 || '')}</span></li>`;
    // 동 사이 거리 본문(가·나·마목) 미달은 '위반'이 아니라 같은 호 단서(동지 2시간 일조) 경로 — 2026-11-06 사용자 지적 '법정이 아닌 거 아냐?'
    const spR = v.rules.filter(r => ['spacing', 'side'].includes(r.id)), hard = v.rules.filter(r => !['spacing', 'side'].includes(r.id));
    box.innerHTML = `<details open class="card"><summary><b>위험요소 검토</b> — 법정 위반 ${hard.length}건${spR.length ? ` · 동 사이 본문 거리 미달 ${spR.length}곳(단서 적용 대상)` : ''} · 경험 항목 ${risks.length}건(고위험 ${risks.filter(r => r.등급 === '고위험').length} · 주의 ${risks.filter(r => r.등급 === '주의').length} · 권고 ${risks.filter(r => r.등급 === '권고').length})</summary>
      ${hard.length ? `<h4>법정 기준 위반(이대로는 안 됨)</h4><ul>${hard.map(rule).join('')}</ul>` : `<p>법정 기준(대지 경계·${spR.length ? '' : '동 사이 거리·'}정북 일조·채광창 이격·용적률·건폐율) 위반 없음</p>`}
      ${spR.length ? `<h4>동 사이 거리 — 본문 거리 미달, 단서로 허용 가능</h4><p class="note">시행령 제86조③2호는 본문(가목 높이 × 조례 배수 등)과 단서(그 대지의 모든 세대가 동지 9~15시 연속 2시간 이상 일조를 확보하는 거리 이상)가 함께 있는 조문입니다. 본문 거리에 못 미쳐도 세대별 일조분석으로 단서를 입증하면 적법 — 실제 고층 정비계획 대부분이 이 방식입니다.</p><ul>${spR.map(rule).join('')}</ul>` : ''}
      ${pv ? `<h4>세대별 일조 — 단서 충족 여부(${esc(pv.근거)})</h4><p>${pv.ok ? `모든 세대(${fmt(pv.total)}세대)가 동지 연속 2시간 이상 — 단서 적용 검토 가능` : `${fmt(pv.total)}세대 중 <b>${fmt(pv.lost)}세대</b>가 2시간 미달 → 이대로면 단서 불충족. 미달 세대를 필로티·비주거로 비우면 순 ${fmt(A.units - pv.lost)}세대, 아니면 동 간격·엇갈림·옆 틈을 넓혀 다시 배치. 동별: ${Object.entries(pv.per).filter(([, q]) => q.lost).map(([k, q]) => `${esc(k)}동 ${q.lost}/${q.total}`).join(', ')}`}. <span class="note">${esc(pv.메모)}</span></p>` : ''}
      <p><button id="refineBtn" title="지금 대안에서 출발해 동을 옮기고 돌리고 층수를 바꾸고 빼고 끼워 넣고, V자 꼭짓점형(2+2·4+2·4+4호)·일자 2·4·6호 동으로 바꿔 끼우며, 규칙(대지 경계 채광창 이격·정북·용적률 등)은 지키고 동지 2시간 미달 세대를 뺀 순세대가 늘어나는 쪽으로 다듬습니다(최대 90초)">일조 연계 다듬기</button> <span class="note">동 사이 본문 거리 대신 단서(모든 세대 동지 9~15시 연속 2시간)로 가는 배치를 찾습니다. 결과는 대안 하나로 더해집니다${A.refine ? ` · 이 대안: '${esc(A.refine.from)}'에서 순 ${fmt(A.refine.start.net)} → ${fmt(A.refine.best.net)}세대(저층 비움 ${fmt(A.refine.best.low)} · 못 쓰는 줄 ${fmt(A.refine.best.dead)})` : ''}.</span></p>
      ${window.JbsSunVerify ? (A.__risk.sv ? `<div id="sunVerifyOut">${A.__risk.sv}</div>` : `<p><button id="sunVerifyBtn" title="엔진과 다른 방법(따로 계산한 동지 태양 위치·1분 간격·창에서 해 쪽 광선)으로 세대별 일조를 다시 판정해 엔진 결과와 대조">정밀 검산(1분 간격 광선)</button> <span id="sunVerifyOut" class="note">세대별 일조 판정을 상용 일조분석 도구와 같은 광선 방식으로 다시 봐서 엔진 판정과 대조합니다${pv ? '' : '(세대별 일조도 함께 계산)'}.</span></p>`) : ''}
      ${risks.length ? `<h4>심의·민원 위험(경험 — 탈락 아님)</h4><ul>${risks.map(risk).join('')}</ul>` : ''}
      ${window.JbsOpinion ? `<details class="opinion"><summary><b>담당자 검토 의견(문안)</b> — 보완 요구·검토 의견에 붙여 쓰기</summary><textarea id="riskOpinion" rows="8" style="width:100%;font-size:13px" readonly>${esc(JbsOpinion.text(v, pv, A.__risk.svr, { landscape: (site.constraints || {}).landscape }))}</textarea><p><button id="riskOpCopy">문안 복사</button> <span class="note">위 검사 결과(동 이름·숫자·근거)로 만든 초안입니다. 붙여 쓴 뒤 구역 사정에 맞게 고치세요.</span></p></details>` : ''}
      <p class="note">규칙은 법령·조례 숫자, 경험 항목은 심의·협의에서 지적되기 쉬운 것(가정값 포함). 인허가 및 심의 과정에서 변동될 수 있습니다.</p></details>`;
  }
  // 검토 의견 문안 복사(2026-11-07)
  document.addEventListener('click', async e => {
    if (!e.target || e.target.id !== 'riskOpCopy') return; const ta = $('#riskOpinion'); if (!ta) return;
    try { await navigator.clipboard.writeText(ta.value); } catch (er) { ta.removeAttribute('readonly'); ta.select(); try { document.execCommand('copy'); } catch (e2) { /* 무시 */ } ta.setAttribute('readonly', ''); }
    e.target.textContent = '복사했습니다'; setTimeout(() => { e.target.textContent = '문안 복사'; }, 1500);
  });

  // 동지 일조: 구역 밖 주변 땅(평지·기존 건물 없음 가정)의 일조 시간
  /* ---------- 주변 기존 건물(브이월드 GIS건물통합정보) ----------
     구역 밖 150m 안의 건물 바닥 모양·지상 층수 → 일조 분석(기존 그림자 포함, 주변 주택 창 기준 판정)과 3D 주변 매스 */
  const RES_USE = /주택|아파트/;
  function ctxFromItems(items) {
    return (items || []).map(it => ({ poly: it.ring.map(pr.to), h: Math.max(3, (+it.floors || 1) * 3), floors: +it.floors || 1, use: it.use || '', name: it.name || '', res: RES_USE.test(it.use || '') }));
  }
  async function loadContext(force) {
    ctx = []; if (!site || !pts) return;
    // 주변 건물은 이번 창에서만 기억(저장 공간 절약) — 구역마다 한 번 브이월드에서 받음
    const memo = (window.__jbsCtx = window.__jbsCtx || {});
    if (!force && memo[site.id]) { ctx = ctxFromItems(memo[site.id]); return; }
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
      memo[site.id] = items;
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
  // 배치도·그림자에 그릴 주변 건물: 구역 둘레 150m 안
  function ctxNear() {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), b = [Math.min(...xs) - 150, Math.min(...ys) - 150, Math.max(...xs) + 150, Math.max(...ys) + 150];
    return ctx.filter(c => c.poly.some(p => p[0] > b[0] && p[0] < b[2] && p[1] > b[1] && p[1] < b[3]));
  }
  function computeSunCtx() {
    const A = alts[cur], tol = crit('sun_tolerance'), newB = A.buildings;
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const box = [Math.min(...xs) - 60, Math.min(...ys) - 30, Math.max(...xs) + 60, Math.max(...ys) + 90];
    let step = 6; while (((box[2] - box[0]) / step) * ((box[3] - box[1]) / step) > 6000) step += 2;
    // 그림자를 드리울 수 있는 주변 건물(측정 범위 + 남쪽 120m·양옆 80m)만 계산에 넣음
    const ctxIn = ctx.filter(c => c.poly.some(p => p[0] > box[0] - 80 && p[0] < box[2] + 80 && p[1] > box[1] - 120 && p[1] < box[3]));
    const near = ctxIn.filter(c => c.res && c.poly.some(p => p[0] > box[0] && p[0] < box[2] && p[1] > Math.min(...ys) - 10 && p[1] < box[3]));
    const P2 = []; for (let x = box[0]; x <= box[2]; x += step) for (let y = box[1]; y <= box[3]; y += step) if (!G.inside(x, y, pts) && !ctxIn.some(c => G.inside(x, y, c.poly))) P2.push([x, y]);
    // 영향권(구역에서 북쪽 150m 안) 주택만 측정
    const fp = near.map(c => facadePoints(c)), FP = fp.flat();
    const bef = G.sunHours(ctxIn, A.H, pr.lat0, P2.concat(FP), tol), aft = G.sunHours(ctxIn.concat(newB), A.H, pr.lat0, P2.concat(FP), tol);
    const cells = P2.map((p, i) => Object.assign({ p }, aft[i], { was: bef[i].ok }));
    const fail = cells.filter(c => !c.ok && c.was);
    let k = P2.length; const houses = near.map((c, i) => {
      const r = fp[i].map(() => ({ b: bef[k], a: aft[k++] }));
      const newly = r.filter(x => x.b.ok && !x.a.ok).length, already = r.filter(x => !x.b.ok).length;
      return { c, n: r.length, newly, already, worst: r.length ? Math.min(...r.map(x => x.a.cont)) : null };
    }).filter(h => h.n);
    sunRes = { alt: cur, nCtx: ctxIn.length, cells: cells.filter(c => !c.ok && c.was), step, fail: fail.length, failArea: fail.length * step * step, worst: fail.length ? Math.min(...fail.map(c => c.cont)) : null, houses, ctx: true };
  }
  function renderSun() {
    const t = +$('#sunT').value, hh = Math.floor(t), mm = Math.round((t - hh) * 60);
    $('#sunTv').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const A = alts[cur], s = G.sun(pr.lat0, t);
    const sh = A.buildings.flatMap(b => (b.parts || [b.poly]).map(q => G.shadow(q, A.H(b.floors), s))).concat(ctxNear().map(c => G.shadow(c.poly, c.h, s))).filter(Boolean);
    const tol = crit('sun_tolerance');
    const hit = sunRes && sunRes.ctx ? sunRes.houses.filter(h => h.newly > 0) : [];
    $('#sunNote').innerHTML = sunRes && sunRes.alt === cur && sunRes.ctx
      ? `주변 기존 건물 ${fmt(sunRes.nCtx)}동(그림자가 닿는 범위)의 그림자를 넣고, 새 동이 생기기 전·후를 비교했습니다(동지 ${tol.연속_구간[0]}~${tol.연속_구간[1]}시 연속 ${tol.연속_h}시간 또는 ${tol.합계_구간[0]}~${tol.합계_구간[1]}시 합계 ${tol.합계_h}시간). `
        + `<b>주변 주택 ${fmt(sunRes.houses.length)}동 중 ${fmt(hit.length)}동</b>이 새 동 때문에 남쪽 벽면 일부가 수인한도를 못 채우게 됩니다${hit.length ? ` (${hit.slice(0, 8).map(h => `${esc(h.c.name || h.c.use)} ${h.c.floors}층: 측정점 ${h.n}곳 중 ${h.newly}곳`).join(', ')}${hit.length > 8 ? ' 외' : ''})` : ''}. `
        + `이미 기존 건물 때문에 미달인 곳은 영향에서 뺐습니다. 빈 땅 기준 새로 미달: ${fmt(sunRes.failArea)}㎡. 층고 3m 가정·평지 기준 개략 판정입니다.`
      : sunRes && sunRes.alt === cur
      ? `구역 밖 주변 땅 기준, 동지 ${tol.연속_구간[0]}~${tol.연속_구간[1]}시 연속 ${tol.연속_h}시간과 ${tol.합계_구간[0]}~${tol.합계_구간[1]}시 합계 ${tol.합계_h}시간을 <b>모두</b> 못 채우는 곳: <b>${fmt(sunRes.failArea)}㎡</b>(격자 ${sunRes.step}m)${sunRes.fail ? `, 가장 나쁜 곳 연속 ${fmt(sunRes.worst, 1)}시간` : ''}. 평지·기존 건물 없음 가정이며 판례상 수인한도를 참고한 개략 판정입니다.`
      : (ctx.length ? `주변 기존 건물 ${fmt(ctx.length)}동을 반영합니다. ` : '주변 건물 정보가 없어 주변을 빈 땅으로 봅니다. ') + '[일조 계산]을 누르면 동지 일조 시간을 계산합니다(수 초 걸릴 수 있음). 지금은 선택한 시각의 그림자만 보입니다.';
    $('#sunSvg').innerHTML = D.sitePlan(planOpts({ dims: null, shadowAt: sh, sunGrid: sunRes && sunRes.alt === cur ? sunRes : null, context: ctxNear(), hit: new Set(hit.map(h => h.c)) }));
  }
  function render3d() {
    const A = alts[cur], blds = A.buildings.flatMap(b => (b.parts || [b.poly]).map(q => ({ poly: q, h: A.H(b.floors), color: TYPE_HEX[b.t] })));
    const cx = ctxNear().map(c => ({ poly: c.poly, h: c.h }));
    if (!v3) v3 = Mass3D.create($('#v3d'), { site: pts, buildings: blds, context: cx, sunHour: +$('#sun3').value, lat: pr.lat0 });
    else v3.setBuildings(blds, cx);
  }
  /* ---------- 조감도·투시도(shared/bird3d.js, 2026-11-07) ----------
     지금 대안의 동(세대 조각을 합친 바깥선)·층수 + 주변 건물(ctx) + 도로 필지·항공사진(브이월드, 구역마다 한 번 받아 창 안에서만 기억) */
  const BIRD = { st: { view: 'bird', look: 'day', mode: 'model', labels: false }, memo: {} };
  async function birdAerial(z, half) {
    const lon0 = pr.lon0, lat0 = pr.lat0, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
    const lon2x = lon => (lon + 180) / 360 * 2 ** z, lat2y = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z;
    const x2lon = x => x / 2 ** z * 360 - 180, y2lat = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** z))) * 180 / Math.PI;
    const xa = Math.floor(lon2x(lon0 - half / kx)), xb = Math.floor(lon2x(lon0 + half / kx)), ya = Math.floor(lat2y(lat0 + half / ky)), yb = Math.floor(lat2y(lat0 - half / ky));
    const c = document.createElement('canvas'); c.width = (xb - xa + 1) * 256; c.height = (yb - ya + 1) * 256; const g2 = c.getContext('2d');
    const jobs = [];
    for (let x = xa; x <= xb; x++) for (let y = ya; y <= yb; y++) jobs.push(new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => { g2.drawImage(im, (x - xa) * 256, (y - ya) * 256); res(); }; im.onerror = res; setTimeout(res, 12000); im.src = `https://api.vworld.kr/req/wmts/1.0.0/${VWORLD_KEY}/Satellite/${z}/${y}/${x}.jpeg`; }));
    await Promise.all(jobs);
    return { img: c, x0: (x2lon(xa) - lon0) * kx, x1: (x2lon(xb + 1) - lon0) * kx, y1: (y2lat(ya) - lat0) * ky, y0: (y2lat(yb + 1) - lat0) * ky };
  }
  async function birdRoads() {
    // 구역 둘레 250m 안 도로 필지(지목 '도') — 경계 가로(보도·차선)와 아스팔트에 씀
    const [x0, y0, x1, y1] = turf.bbox(site.geojson), dLat = 250 / 110540, dLon = 250 / (Math.cos(pr.lat0 * Math.PI / 180) * 111320);
    const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `BOX(${x0 - dLon},${y0 - dLat},${x1 + dLon},${y1 + dLat})`, 20);
    const out = [];
    fs.filter(f => /도$/.test((f.properties || {}).jibun || '')).forEach(f => { const g = f.geometry; (g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map(c => c[0])).forEach(r => out.push(G.openRing(r).map(pr.to))); });
    return out;
  }
  async function birdPrep() {
    const key = site.id || 'site', m = BIRD.memo[key] || (BIRD.memo[key] = {});
    const jobs = [];
    if (!m.roads && typeof VWorld !== 'undefined') jobs.push(birdRoads().then(r => { m.roads = r; }).catch(() => { m.roads = []; }));
    if (!m.near && typeof VWORLD_KEY !== 'undefined') jobs.push(birdAerial(18, 520).then(a => { m.near = a; }).catch(() => {}), birdAerial(16, 2600).then(a => { m.far = a; }).catch(() => {}));
    if (!ctx.length) jobs.push(loadContext(false));
    // 하나라도 늦으면 기다리지 않고 있는 것만으로 그림(25초)
    const cap = j => Promise.race([j.catch(() => {}), new Promise(r => setTimeout(r, 25000))]);
    if (jobs.length) { $('#birdNote').textContent = '항공사진·도로·주변 건물을 불러오는 중입니다…'; await Promise.all(jobs.map(cap)); }
    return m;
  }
  async function renderBird() {
    if (!alts.length || !window.JbsBird) return;
    const A = alts[cur], m = await birdPrep();
    const blds = [], labels = [];
    A.buildings.forEach(b => {
      const parts = (b.parts && b.parts.length ? b.parts : [b.poly]).filter(q => q && q.length > 2).map(q => G.ccw(q));
      const big = parts.reduce((bi, q, i) => Math.abs(G.area(q)) > Math.abs(G.area(parts[bi])) ? i : bi, 0);
      parts.forEach((r, i) => blds.push({ ring: r, floors: b.floors, top: i === big, grp: parts }));
      const c = b.center || parts[0].reduce((a, p) => [a[0] + p[0] / parts[0].length, a[1] + p[1] / parts[0].length], [0, 0]);
      labels.push({ label: `${b.id || ''}동 ${b.floors}F`, c, top: b.floors });
    });
    const parks = exclude.filter((ex, i) => /공원|녹지/.test(exKinds[i] || ''));
    const data = { site: pts, blds, labels, parks, gates: gateZones(), ctx: ctx.map(c => ({ poly: c.poly, floors: c.floors })), roads: m.roads || [], aerial: m.near, aerialFar: m.far };
    const st = BIRD.st, el = $('#vbirdCanvas');
    $$('#birdBar [data-bk]').forEach(b => { const on = b.dataset.bk === 'labels' ? st.labels : st[b.dataset.bk] === b.dataset.bv; b.setAttribute('aria-pressed', on); b.classList.toggle('on', on); });
    const t0 = Date.now();
    const W0 = el.clientWidth >= 320 ? el.clientWidth : 1200, H0 = el.clientHeight >= 200 ? el.clientHeight : 620; // 창이 접혀 폭이 0에 가까우면 기본 크기로
    BIRD.last = JbsBird.render(el, data, { view: st.view, look: st.look, mode: st.mode, labels: st.labels, rot: st.rot || 0, w: W0, h: H0, pr: 1 });
    BIRD.data = data;
    $('#birdNote').innerHTML = `${esc(A.label)} · ${A.buildings.length}개동 ${fmt(A.units)}세대 · 최고 ${A.maxFloors}층 — 바닥 브이월드 항공사진, 주변 건물 ${fmt(ctx.length)}동. 그리는 데 ${((Date.now() - t0) / 1000).toFixed(1)}초. 이해를 돕기 위한 이미지이며 정비계획 수립 과정에서 변경될 수 있습니다. <a href="#guideNote" onclick="document.getElementById('guideNote').open=true">무엇이 반영됐는지 보기</a>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('#birdBar button'); if (!b) return;
    if (b.id === 'birdToPanel') {   // 2026-11-07: 판넬로 바로 보내기(/panel이 IndexedDB에서 읽음)
      if (!BIRD.data || !window.JbsPanelImg || !site || !site.id) { msg('조감도를 먼저 그리고, 구역이 저장되어 있어야 합니다.', true); return; } const el = $('#vbirdCanvas');
      const r = JbsBird.render(el, BIRD.data, Object.assign({}, BIRD.st, { w: el.clientWidth || 1200, h: el.clientHeight || 620, pr: 2 }));
      fetch(r.png()).then(x => x.blob()).then(bl => JbsPanelImg.put(site.id, bl, { view: BIRD.st.view })).then(() => { renderBird(); msg('조감도를 판넬로 보냈습니다. 새 창의 판넬·팸플릿 화면에 들어가 있습니다.'); window.open('/panel/?site=' + encodeURIComponent(site.id), '_blank'); }).catch(er => msg('판넬로 보내지 못했습니다: ' + er.message, true));
      return;
    }
    if (b.id === 'birdPng') {
      // 화면에 보이는 그대로 내려받기(다시 그리지 않음)
      if (!BIRD.last || !BIRD.last.png) return;
      const a = document.createElement('a'); a.download = `${site.name || '조감도'}_${({ wide: '광역조감도', semi: '반조감도', bird: '조감도', persp: '투시도' })[BIRD.st.view]}${BIRD.st.look === 'dusk' ? '_해질녘' : ''}${BIRD.st.rot ? '_' + BIRD.st.rot + '도' : ''}.png`; a.href = BIRD.last.png(); a.click();
      return;
    }
    if (b.dataset.rot !== undefined) { const d = +b.dataset.rot; BIRD.st.rot = d === 0 ? 0 : (((BIRD.st.rot || 0) + d) % 360 + 360) % 360; renderBird(); return; }
    if (b.dataset.bk === 'labels') BIRD.st.labels = !BIRD.st.labels; else BIRD.st[b.dataset.bk] = b.dataset.bv;
    renderBird();
  });
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
        <tr><th>관리사무소·휴게시설</th><td>${fmt(X.mgmt)}㎡ 이상${ck(mo)}</td><td class="note">${esc(mo.근거)}</td></tr>
        <tr><th>총 연면적(추정)</th><td>${fmt(X.totalGfa)}㎡</td><td class="note">지상 연면적 + 지하주차장 + 주민공동시설 + 관리사무소(공사비 산정 참고, 기계·전기실 등 제외)</td></tr>`; })()}</table>
      ${compareHtml()}
      <h3>평형별 세대 구성</h3>
      <table><tr><th>평형</th><th>전용</th><th>공급</th><th>세대수</th><th>비율</th><th>평면 가정(폭×깊이)</th></tr>
      ${types.map(t => `<tr><td>${esc(U[t].이름)}</td><td>${U[t].전용}㎡</td><td>${U[t].공급 ? U[t].공급 + '㎡' : '–'}</td><td>${fmt(A.byType[t])}</td><td>${fmt(A.byType[t] / A.units * 100, 1)}%</td><td>${U[t].폭}m × ${U[t].깊이}m ${U[t].대표사례 ? `<span class="note">실제 사례${(() => { const c = ((C.평면_라이브러리 || {}).사례 || []).find(x => x.id === U[t].대표사례); return c ? ' · ' + esc(c.단지) + ' ' + esc(c.타입) : ''; })()}</span>` : '<span class="chk">가정(사례 없음)</span>'}</td></tr>`).join('')}
      <tr><th>합계</th><td></td><td></td><th>${fmt(A.units)}</th><td>100%</td><td></td></tr>
      <tr><td colspan="6" class="note">전용 60㎡ 이하 ${fmt(groups(A.byType).u60)}세대(${fmt(groups(A.byType).u60 / (A.units || 1) * 100, 1)}%) · 85㎡ 이하 ${fmt(Object.entries(A.byType).filter(([t]) => +t <= 85).reduce((a, [, k]) => a + k, 0) / (A.units || 1) * 100, 1)}% — 주택규모별 건설비율(재개발 국민주택규모 비율·임대 비율 등)은 사업 유형별 고시·조례 확인 필요. 가로주택정비사업 등 소규모주택정비사업은 별도 기준.</td></tr></table>
      <h3>동별 개요</h3>
      <table><tr><th>동</th><th>형태</th><th>평형</th><th>층당 세대</th><th>층수</th><th>세대수</th><th>높이</th><th>층수 상한(일조·경계)</th></tr>
      ${A.buildings.map(b => `<tr><td>${b.id}</td><td>${esc(G.FORM_NAME[b.form] || '판상형')}</td><td>${b.t}㎡${b.vname ? `<br><span class="note">${esc(b.vname)} 평면</span>` : ''}</td><td>${b.n}</td><td>${b.floors}</td><td>${b.n * b.floors}</td><td>${fmt(A.H(b.floors), 1)}m</td><td>${b.cap >= +I.p.maxFloors ? '-' : b.cap + '층'}</td></tr>`).join('')}</table>
      ${(() => { // 사용한 평면 출처
        const lib = (C.평면_라이브러리 || {}).사례 || [], seen = [];
        A.buildings.forEach(b => { const k = (b.v || 'rep-' + b.t) + '|' + b.form; if (!seen.find(x => x.k === k)) seen.push({ k, b, c: lib.find(x => x.id === b.v) || null, n: 0 }); seen.find(x => x.k === k).n++; });
        return `<h3>사용한 평면(어디 평면인지)</h3><table><tr><th>평형</th><th>형태</th><th>평면</th><th>폭 × 깊이</th><th>동 수</th><th>출처</th></tr>${seen.map(({ b, c, n }) => `<tr><td>${b.t}㎡</td><td>${esc(G.FORM_NAME[b.form] || '')}</td><td>${c ? esc(c.단지) + ' ' + esc(c.타입 || '') + (c.베이 ? ` (${c.베이}베이)` : '') : '<span class="chk">가정 평면(사례 없음)</span>'}</td><td>${c ? `${c.폭}m × ${c.깊이}m` : '–'}</td><td>${n}</td><td class="note">${c ? esc(c.출처종류 || c.출처 || '') + (c.신뢰도 ? ' · 신뢰도 ' + esc(c.신뢰도) : '') : ''}</td></tr>`).join('')}</table>`;
      })()}
      <h3>적용 기준</h3>
      <table><tr><th style="width:160px">인동간격</th><td>앞 동 높이 × ${I.p.spacing}${/확인필요/.test(sp.상태) ? ' <span class="chk">※ 기준 확인 필요</span>' : ''}<br><span class="note">${esc(sp.근거)} — ${esc(sp.상태)}</span></td></tr>
      ${(() => { const w = crit('window_setback'); return w ? `<tr><th>채광창 이격</th><td>채광창 벽면에서 인접 대지경계선까지 높이의 1/${winRatio()} 이상(도로·공원이 사이에 있으면 그 중심선까지 — 공동주택, 판상형 앞·뒤 벽면 · 탑상형 모든 벽면)<br><span class="note">${esc(w.근거)} — ${esc(w.상태)}</span></td></tr>` : ''; })()}
      ${I.site && I.site.noSun ? `<tr><th>정북 일조</th><td>적용 안 함 — 건축법 제61조①은 전용·일반주거지역만(이 구역 용도지역: 준주거·상업·공업)</td></tr>` : ''}<tr${I.site && I.site.noSun ? ' style="display:none"' : ''}><th>${I.p.sunBase === 'south' ? '정남 기준 일조' : '정북 일조'}</th><td>높이 10m 이하 ${sn.이격.높이10m이하_m}m, 초과 부분 높이의 1/2 이상(${I.p.sunBase === 'south' ? '남쪽을 향한 경계 변 — 구청장 등 고시가 있어야 적용' : '정북 인접대지 변'})<br><span class="note">${esc(sn.근거)}${I.p.sunBase === 'south' && crit('south_base') ? ' · ' + esc(crit('south_base').근거) : ''}</span></td></tr>
      <tr><th>도로·공원 사이</th><td>경계에 닿은 도로(실제 폭)·공원(폭 ${I.p.parkW}m)의 중심선을 인접 대지경계선으로 봄(공동주택) — 채광창·일조 모두<br><span class="note">${esc(crit('sun_open_space').근거)} — ${esc(crit('sun_open_space').상태)}</span></td></tr>
      ${(() => { const r = crit('window_relief'); return r ? `<tr><th>정비사업 완화</th><td>${Object.entries(r.값).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join('<br>')}<br><span class="note">${esc(r.근거)} — ${esc(r.상태)}</span></td></tr>` : ''; })()}
      <tr><th>건축한계선·경계 이격</th><td>도로변 건축한계선 ${I.p.roadSb}m · 간선도로변 ${I.p.artSb}m · 대지경계 이격 ${I.p.bndSb}m · 동 측면 ${I.p.sideGap}m <span class="note">(검토 가정값 — 정비계획·지구단위계획 결정도의 건축한계선이 있으면 그 값으로)</span></td></tr>
      ${(() => { const zs = gateZones(); return zs.length ? `<tr><th>출입구 자리(건축 불가)</th><td>${zs.map(z => `${esc(z.name)} 폭 ${fmt(z.w, 1)}m × 건축한계선 안쪽 ${fmt(z.d, 1)}m${z.kind === 'park' ? `(지하 1층 바닥까지 ${gateParams().rampH}m ÷ 17% + 완화구간)` : z.kind === 'main' ? '(문주·진입광장)' : ''}`).join('<br>')}<br><span class="note">${esc(GZ.BASIS.park)}. 문주 유효 높이 5m 이상(소방차 통행, 건축법 시행령 제41조·소방청 가이드라인 참고)</span></td></tr>` : ''; })()}
      <tr><th>동 모서리 근접</th><td>${({ off: '안 봄', min10: '모든 동 사이 최소 10m', rec: '최소 10m + 채광창 벽 직각선 좌우 45° 안에서 보이면 높은 동 높이 × 0.5', all: '모서리끼리 모두 높은 동 높이 × 0.5(최소 10m)' })[I.p.corner || 'min10']} <span class="note">(실무 기준·가정값 — 법정 아님. 시행령 제86조③2호는 직각 방향으로 마주 보는 부분만 적용, 서울 건축조례 최소 이격 10m·0.5배 차용)</span></td></tr>
      <tr><th>층수 배분</th><td>북쪽 줄을 높게, 남쪽 줄을 낮게(남저북고). 저층 주거 인접 변 ${I.p.lowDist}m 안은 ${I.p.lowCap}층 이하</td></tr></table>`;
  }
  function renderUnits() {
    const A = alts[cur], U = C.평면, types = Object.keys(A.byType).filter(t => A.byType[t]);
    const reps = []; A.buildings.forEach(b => { if (!reps.find(r => r.t === b.t && r.n === b.n && r.form === b.form && (r.v || '') === (b.v || ''))) reps.push(b); });
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
  const stageNow = () => { const c = site && site.constraints || {}; return (c.traffic || c.env || c.landscape) ? 2 : 1; };
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
        form: A.form, buildings: A.buildings.map(b => ({ id: b.id, t: b.t, n: b.n, v: b.v || '', form: b.form, floors: b.floors, H: A.H(b.floors), poly: b.poly.map(pr.back), parts: (b.parts || [b.poly]).map(q => q.map(pr.back)) })) },
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
    else if (t.id === 'mEdge' || t.id === 'mEntry') { mode = t.id === 'mEdge' ? 'edge' : 'entry'; $('#mEdge').setAttribute('aria-pressed', mode === 'edge'); $('#mEntry').setAttribute('aria-pressed', mode === 'entry'); $('#modeHint').textContent = mode === 'edge' ? '지금: 경계 성격 바꾸기 — 경계선을 누를 때마다 성격이 바뀝니다(곡선처럼 이어진 짧은 변은 한꺼번에).' : '지금: 출입구 찍기 — 도로 쪽 경계선(파랑·보라)을 누르면 주출입구 → 주차장 출입구 → 부출입구 순으로 찍히고, 찍힌 자리를 다시 누르면 종류가 바뀝니다(마지막엔 지움). 다 찍었으면 [경계 성격 바꾸기]를 눌러 빠져나오세요.'; if (pts) drawSite(); msg(mode === 'entry' ? '도로 쪽 경계선(파랑·보라)을 누르면 출입구가 찍힙니다(최대 4곳). 출입구 자리(문주·진입광장, 지하 경사로)에는 동을 놓지 않습니다.' : ''); }
    else if (t.dataset.alt !== undefined) { cur = +t.dataset.alt; renderAlts(); drawBuildingsOnMap(); showView(curView); }
    else if (t.dataset.v) showView(t.dataset.v);
    else if (t.id === 'calcSun') { t.classList.add('busy'); msg('동지 일조 계산 중…'); await tick(); await tick(); computeSun(); renderSun(); t.classList.remove('busy'); msg(''); }
    else if (t.dataset.cam && v3) ({ sw: () => v3.bird(-0.75, 0.55), se: () => v3.bird(0.75, 0.55), n: () => v3.bird(Math.PI, 0.5), top: () => v3.bird(0.001, 1.45) })[t.dataset.cam]();
    else if (t.id === 'dl3d' && v3) { const a = document.createElement('a'); a.href = v3.png(); a.download = fname('매스투시도.png'); a.click(); }
    else if (t.id === 'dlSvg') download(svgBlob(D.sitePlan(planOpts())), fname('개략배치도.svg'));
    else if (t.id === 'dlPng') { const u = await svgToPng(D.sitePlan(planOpts())); const a = document.createElement('a'); a.href = u; a.download = fname('개략배치도.png'); a.click(); }
    else if (t.id === 'dlDoc') exportDoc();
    else if (t.dataset.mixex) { const ex = existingMix(); if (ex) { TYPES().forEach(k => { $('#p_m' + k).value = ex.mix[k] ?? ''; }); mixSum(); saveState(); invalidate(); msg(`기존 세대 ${fmt(ex.n)}호의 전용면적으로 평형 비율을 넣었습니다: ${Object.entries(ex.mix).map(([k, v]) => `${k}㎡형 ${v}%`).join(' · ')}. 일반분양 몫을 늘리려면 비율을 고치세요.`); } }
    else if (t.dataset.mixpre) { const pre = (C.평형구성_예시 || {})[t.dataset.mixpre] || {}; TYPES().forEach(k => { $('#p_m' + k).value = pre[k] ?? ''; }); mixSum(); saveState(); invalidate(); }
  });
  $('#sunT').addEventListener('input', () => { if (alts.length) renderSun(); });
  $('#sun3').addEventListener('input', e => { const v = +e.target.value, h = Math.floor(v); $('#sun3v').textContent = `${String(h).padStart(2, '0')}:${String(Math.round((v - h) * 60)).padStart(2, '0')}`; if (v3) v3.setSun(v, pr.lat0); });
  $('#p_angleMode').addEventListener('change', () => { $('#p_angle').disabled = $('#p_angleMode').value === 'auto'; });
  Object.values(FIELDS).forEach(id => $('#' + id).addEventListener('change', () => { saveState(); invalidate(); renderLegend(); if (/^p_axis|^p_bndSb/.test(id) && lyrEx && pts) drawExclude(); if (/^p_g|Sb$/.test(id) && pts) drawSite(); }));
  $('#siteSel').addEventListener('change', e => {
    const x = e.target.value; if (!x) return;
    if (x.startsWith('s:')) load(JbsSite.get(x.slice(2)));
    else if (x === 'p:') { const s = JbsSite.fromProject(); if (s) load(s); }
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
      let first = q.get('project') ? JbsSite.fromProject() : q.get('urban') ? JbsSite.fromUrban(q.get('urban')) : null;
      if (!first && q.get('site')) first = JbsSite.get(q.get('site'));
      if (!first) { let cur2 = ''; try { cur2 = localStorage.getItem('jbs.sites.current') || ''; } catch (e) { cur2 = ''; } first = cur2 ? JbsSite.get(cur2) : null; }
      if (!first) { const u = JbsSite.urbanZones(); first = u.length ? JbsSite.fromUrban(u[0].key) : null; }
      load(first || { name: '', v: {} });
      // ?go=bird: 사업성 검토 화면의 [조감도 보기]로 왔으면 배치안을 바로 만들고 조감도 탭을 엶
      if (q.get('go') === 'bird' && first && pts) setTimeout(async () => {
        // 첫 화면 재건축 구역: 처음 한 번은 기존 세대(전유부) 평형 비율로 배치
        const a0 = (site.arch || {}).params || {};
        if (site.source === 'project' && site.plan && site.plan.type === 'recon' && !TYPES().some(t => a0['m' + t])) { const ex = existingMix(); if (ex) { TYPES().forEach(k => { $('#p_m' + k).value = ex.mix[k] ?? ''; }); mixSum(); } }
        msg('배치안을 만든 뒤 조감도를 그립니다(큰 구역은 1~2분)…'); await run(); if (alts.length) showView('bird');
      }, 300);
    });
})();
