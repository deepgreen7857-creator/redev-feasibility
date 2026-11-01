'use strict';
// 구역 현황 자동 채우기 — /traffic, /env, /landscape 공통
//  1) 접도 도로 규모(광로·대로·중로·소로, 도시·군계획시설 규칙 제9조 폭 기준)와 기능 위계(추정)
//  2) 위치(○○동 ○○번지 일원): /urban 편입 필지 중 가장 큰 필지 + 브이월드 연속지적 주소
//  3) 최근접 도시철도역·거리, 반경 500m 버스정류장 수: OpenStreetMap(Overpass) 자료
//  이미 값이 있는 칸은 건드리지 않음(사용자가 고친 값 보호)
(function (g) {
  const CLS = [['광로1류', 70], ['광로2류', 50], ['광로3류', 40], ['대로1류', 35], ['대로2류', 30], ['대로3류', 25], ['중로1류', 20], ['중로2류', 15], ['중로3류', 12], ['소로1류', 10], ['소로2류', 8], ['소로3류', 0]];
  const scaleOf = w => { const c = CLS.find(([, lo]) => +w >= lo - 0.05); return c ? c[0] : '소로3류'; };
  // 규모 → 기능 위계(추정). 실제 기능 분류는 도시계획 결정 내용으로 확인
  const levelOf = sc => /광로|대로/.test(sc) ? '간선도로' : /중로[12]류/.test(sc) ? '보조간선도로' : /중로3류|소로1류/.test(sc) ? '집산도로' : '국지도로';
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;

  function roads(site) {
    const v = site.v, rs = v.roads || [];
    let n = 0;
    rs.forEach(r => {
      const w = num(r.w); if (w === null) return;
      const sc = r.dec || scaleOf(w);
      if (!r.scale || r.scaleAuto) { r.scale = sc; r.scaleAuto = true; }
      if (!r.level) { r.level = levelOf(sc); r.levelAuto = true; n++; }
    });
    return n;
  }

  // /urban 캐시에서 구역 편입 필지 중 가장 큰 것
  function biggestParcel(site) {
    try {
      const key = (site.source || '').replace('urban:', ''); if (!key) return null;
      const Z = JSON.parse(localStorage.getItem('jbs-urban-zones-v1') || '{}'), C = JSON.parse(localStorage.getItem('jbs-urban-cache-v1') || '{}');
      const z = (Z.zones || {})[key]; if (!z || !z.inArea) return null;
      let best = null;
      Object.entries(z.inArea).forEach(([pnu, r]) => { const c = (C.parcels || {})[pnu]; if (!c) return; const a = (+c.ledgerArea || +c.cadArea || 0) * (r || 1); if (!best || a > best.a) best = { pnu, a, jibun: c.jibun, c }; });
      return best;
    } catch (e) { return null; }
  }
  async function location(site) {
    const v = site.v; if (v.loc) return null;
    const b = biggestParcel(site);
    let dong = '';
    if (!v.lat && site.geojson && typeof turf !== 'undefined') { const c = turf.centerOfMass(site.geojson).geometry.coordinates; v.lng = c[0]; v.lat = c[1]; }
    if (typeof VWorld !== 'undefined' && VWorld.enabled && typeof VWorld.dataAll === 'function' && v.lat && v.lng) {
      try {
        const fs = await VWorld.dataAll('LP_PA_CBND_BUBUN', `POINT(${v.lng} ${v.lat})`, 1);
        const addr = fs && fs[0] && fs[0].properties && (fs[0].properties.addr || '');
        const m = String(addr).match(/([가-힣0-9]+(동|가|리))(\s|$)/g);
        if (m) dong = m[m.length - 1].trim();
      } catch (e) { /* 주소 조회 실패 */ }
    }
    if (!b && !dong) return null;
    const no = b && b.jibun ? String(b.jibun).replace(/[가-힣\s]+$/, '') : '';
    v.loc = `${dong ? dong + ' ' : ''}${no ? no + '번지 ' : ''}일원`.trim();
    v.locAuto = true;
    return v.loc;
  }

  // OpenStreetMap Overpass: 역(2.5km 안)과 버스정류장(구역 경계 500m 안)
  async function transit(site) {
    const v = site.v;
    if ((v.station && num(v.stationDist) !== null) && num(v.bus) !== null) return null;
    if (!site.geojson || typeof turf === 'undefined') return null;
    const c = turf.centerOfMass(site.geojson).geometry.coordinates, lat = c[1], lng = c[0];
    const bb = turf.bbox(site.geojson), rad = Math.max(turf.distance([bb[0], bb[1]], [bb[2], bb[3]], { units: 'meters' }) / 2, 100);
    const q = `[out:json][timeout:25];(node(around:2500,${lat},${lng})[railway~"^(station|halt)$"];node(around:${Math.round(rad + 520)},${lat},${lng})[highway=bus_stop];node(around:${Math.round(rad + 520)},${lat},${lng})[public_transport=platform][bus=yes];);out body;`;
    let data = null;
    for (const ep of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
      try { const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }); if (r.ok) { data = await r.json(); break; } } catch (e) { /* 다음 서버 */ }
    }
    if (!data) return { fail: true };
    const line = turf.polygonToLine(site.geojson);
    const lines = line.type === 'FeatureCollection' ? line.features : [line];
    const dist = (lo, la) => { const p = turf.point([lo, la]); if (turf.booleanPointInPolygon(p, site.geojson)) return 0; return Math.min(...lines.map(l => turf.pointToLineDistance(p, l, { units: 'meters' }))); };
    const st = {}, buses = [];
    data.elements.forEach(e => {
      const t = e.tags || {};
      if (t.railway === 'station' || t.railway === 'halt') {
        if (t.usage === 'freight' || t.station === 'freight') return;
        const name = (t['name:ko'] || t.name || '').replace(/역$/, '') ; if (!name) return;
        const d = dist(e.lon, e.lat), lines2 = [t.line, t['subway:line'], t.network, t.operator].filter(Boolean).join(' ');
        if (!st[name] || d < st[name].d) st[name] = { name: name + '역', d, info: lines2 };
      } else {
        const d = dist(e.lon, e.lat); if (d <= 500) buses.push({ id: e.id, name: t.name || '' });
      }
    });
    const list = Object.values(st).sort((a, b) => a.d - b.d);
    const out = { stations: list.slice(0, 3), bus: new Set(buses.map(b => b.id)).size };
    if (!v.station && list[0]) { v.station = list[0].name; v.stationDist = String(Math.round(list[0].d)); v.stationAuto = true; }
    else if (v.station && num(v.stationDist) === null) { const s = list.find(x => x.name.replace(/역$/, '') === v.station.replace(/역$/, '')); if (s) { v.stationDist = String(Math.round(s.d)); v.stationAuto = true; } }
    if (num(v.bus) === null) { v.bus = String(out.bus); v.busAuto = true; }
    v.transitNote = `OpenStreetMap 기준(${new Date().toLocaleDateString('ko-KR')} 조회) · 거리는 구역 경계까지 직선거리` + (list.length > 1 ? ` · 그다음 가까운 역: ${list.slice(1, 3).map(s => `${s.name} ${Math.round(s.d)}m`).join(', ')}` : '');
    return out;
  }

  async function fill(site) {
    if (!site || !site.v) return { changed: false };
    const notes = [];
    const nr = roads(site); if (nr) notes.push(`도로 위계 ${nr}곳(폭 기준 추정)`);
    const loc = await location(site); if (loc) notes.push(`위치 "${loc}"`);
    const tr = await transit(site);
    if (tr && tr.fail) notes.push('대중교통 자료(OpenStreetMap)를 불러오지 못해 역·정류장은 직접 넣어 주세요');
    else if (tr) notes.push(`최근접 역 ${site.v.station || '없음(2.5km 안)'}${site.v.stationDist ? ' ' + site.v.stationDist + 'm' : ''}, 반경 500m 버스정류장 ${site.v.bus}곳`);
    return { changed: notes.length > 0, notes };
  }
  g.AutoSite = { fill, scaleOf, levelOf };
})(window);
