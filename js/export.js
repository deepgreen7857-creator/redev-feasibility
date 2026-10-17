'use strict';

// 구역계 도면 내보내기: 도면형 PDF(인쇄 → PDF로 저장, 모든 요소가 벡터)와 CAD 도면(DXF)
// 좌표는 국토지리정보원 2010 기준 TM(GRS80)으로 변환해 실제 축척으로 그림

const TM_BELTS = [
  { epsg: 5185, name: '서부원점', lon0: 125 },
  { epsg: 5186, name: '중부원점', lon0: 127 },
  { epsg: 5187, name: '동부원점', lon0: 129 },
  { epsg: 5188, name: '동해원점', lon0: 131 },
];
const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };

const Export = {
  projector(lon) {
    const b = lon < 126 ? TM_BELTS[0] : lon < 128 ? TM_BELTS[1] : lon < 130 ? TM_BELTS[2] : TM_BELTS[3];
    const def = `+proj=tmerc +lat_0=38 +lon_0=${b.lon0} +k=1 +x_0=200000 +y_0=600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
    const p = proj4('EPSG:4326', def);
    return { ...b, fwd: c => p.forward([c[0], c[1]]) };
  },

  // Polygon/MultiPolygon/Feature → 고리(ring) 목록
  rings(g) {
    if (!g) return [];
    if (g.type === 'Feature') return this.rings(g.geometry);
    if (g.type === 'Polygon') return g.coordinates;
    if (g.type === 'MultiPolygon') return g.coordinates.flat();
    return [];
  },

  // 구역과 주변 필지·건물을 브이월드에서 받아 TM 좌표로 변환
  async collect() {
    if (!S.area.geojson) throw new Error('먼저 지도에 구역계를 그려 주세요.');
    if (!window.proj4 || !window.turf) throw new Error('도면 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.');
    const zone = S.area.geojson;
    if (!S.meta.location) {
      const pt = turf.pointOnFeature(zone).geometry.coordinates;
      await Auto.locationFromParcel(pt[1], pt[0]);
    }
    const [minX, minY, maxX, maxY] = turf.bbox(zone);
    const mx = (maxX - minX) * 0.15, my = (maxY - minY) * 0.15;
    const box = `BOX(${[minX - mx, minY - my, maxX + mx, maxY + my].join(',')})`;
    const inZone = f => { try { return turf.booleanPointInPolygon(turf.pointOnFeature(f), zone); } catch (e) { return false; } };

    let parcels = [], bldgs = [];
    if (VWorld.enabled) {
      [parcels, bldgs] = await Promise.all([VWorld.dataAll('LP_PA_CBND_BUBUN', box, 5), VWorld.dataAll('LT_C_BLDGINFO', box, 5)]);
    } else {
      parcels = S.lands.filter(l => l.geom).map(l => ({ type: 'Feature', geometry: l.geom, properties: { jibun: l.jibun + (l.jimok || '') } }));
    }
    const year = new Date().getFullYear();
    const P = this.projector((minX + maxX) / 2);
    const proj = rs => rs.map(r => r.map(c => P.fwd(c)));
    const labelAt = f => { try { return P.fwd(turf.pointOnFeature(f).geometry.coordinates); } catch (e) { return null; } };

    const d = {
      P,
      zone: proj(this.rings(zone)),
      parcels: parcels.map(f => {
        const sp = splitJibun(f.properties && f.properties.jibun);
        return { rings: proj(this.rings(f.geometry)), jibun: sp.no, jimok: sp.jimok, inZone: inZone(f), area: turf.area(f), label: labelAt(f) };
      }),
      buildings: bldgs.map(f => {
        const b = buildingFromFeature(f);
        return { rings: proj(this.rings(f.geometry)), name: b.name, inZone: inZone(f), old: Calc.isOld(S, b, year), noInfo: !b.year, label: labelAt(f), area: turf.area(f) };
      }),
      shift: null,
    };
    // 연속지적도와 건물 자료는 원래 수 미터씩, 그것도 블록마다 다르게 어긋나 있어서
    // 건물을 주변 블록 단위로 지적에 맞춰 옮김 (지적은 그대로)
    if ($('#alignBldg') ? $('#alignBldg').checked : true) {
      const shifts = this.alignShifts(d.parcels, d.buildings);
      const lens = shifts.map(s => Math.hypot(s[0], s[1]));
      if (lens.some(v => v > 0)) {
        d.buildings.forEach((b, i) => {
          const [dx, dy] = shifts[i];
          const mv = c => [c[0] + dx, c[1] + dy];
          b.rings = b.rings.map(r => r.map(mv));
          if (b.label) b.label = mv(b.label);
        });
        d.shift = { avg: lens.reduce((a, v) => a + v, 0) / lens.length, max: Math.max(...lens) };
      }
    }
    return d;
  },

  // 건물마다 [dx, dy](m). 먼저 전체를 한 번 맞추고, 반경 35m 이웃 건물과 함께 블록별로 다시 맞춤.
  // 점수: 건물 표본점이 도로·필지 밖에 떨어지거나 건물의 주된 필지가 아닌 필지에 걸치는 비율
  alignShifts(parcels, buildings) {
    const inRing = (x, y, r) => {
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i], [xj, yj] = r[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    };
    const inRings = (x, y, rs) => rs.reduce((n, r) => n + (inRing(x, y, r) ? 1 : 0), 0) % 2 === 1;
    const bbox = rs => { const xs = rs.flat().map(c => c[0]), ys = rs.flat().map(c => c[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

    // 필지를 0.5m 격자에 미리 칠해 둠 (칸마다 필지 번호, 없으면 -1) → 점 조회가 한 번의 배열 접근
    const ps = parcels.map((p, i) => ({ i, rs: p.rings, road: p.jimok === '도' }));
    if (!ps.length) return buildings.map(() => [0, 0]);
    const RES = 0.5, PAD = 12;
    const pb = bbox(ps.flatMap(p => p.rs));
    const ox = pb[0] - PAD, oy = pb[1] - PAD;
    const GW = Math.ceil((pb[2] - pb[0] + PAD * 2) / RES), GH = Math.ceil((pb[3] - pb[1] + PAD * 2) / RES);
    const grid = new Int32Array(GW * GH).fill(-1);
    ps.forEach(p => {
      // 짝홀 규칙 스캔라인 채우기
      const edges = [];
      p.rs.forEach(r => { for (let k = 0; k < r.length - 1; k++) edges.push([r[k], r[k + 1]]); });
      const ys = p.rs.flat().map(c => c[1]);
      const r0 = Math.max(0, Math.floor((Math.min(...ys) - oy) / RES)), r1 = Math.min(GH - 1, Math.ceil((Math.max(...ys) - oy) / RES));
      for (let row = r0; row <= r1; row++) {
        const y = oy + (row + 0.5) * RES, xs = [];
        for (const [a, b] of edges) if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        xs.sort((m, n) => m - n);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const c0 = Math.max(0, Math.ceil((xs[k] - ox) / RES - 0.5)), c1 = Math.min(GW - 1, Math.floor((xs[k + 1] - ox) / RES - 0.5));
          for (let col = c0; col <= c1; col++) grid[row * GW + col] = p.i;
        }
      }
    });
    const parcelAt = (x, y) => {
      const col = Math.floor((x - ox) / RES), row = Math.floor((y - oy) / RES);
      if (col < 0 || row < 0 || col >= GW || row >= GH) return null;
      const id = grid[row * GW + col];
      return id < 0 ? null : ps[id];
    };

    // 건물마다 내부 표본점과 중심
    const samples = buildings.map(b => {
      const bb = bbox(b.rings), st = Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 5;
      const pts = [];
      for (let x = bb[0] + st / 2; x < bb[2]; x += st) for (let y = bb[1] + st / 2; y < bb[3]; y += st) if (inRings(x, y, b.rings)) pts.push([x, y]);
      return pts;
    });
    const cent = buildings.map(b => { const bb = bbox(b.rings); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2]; });
    const all = buildings.map((_, i) => i).filter(i => samples[i].length);
    if (!all.length) return buildings.map(() => [0, 0]);

    // 건물 하나의 점수
    const one = (i, dx, dy) => {
      const pts = samples[i], cnt = new Map();
      let bad = 0;
      for (const [x, y] of pts) {
        const p = parcelAt(x + dx, y + dy);
        if (!p || p.road) bad++;
        else cnt.set(p.i, (cnt.get(p.i) || 0) + 1);
      }
      let major = 0;
      for (const v of cnt.values()) if (v > major) major = v;
      return (bad + (pts.length - bad - major)) / pts.length;
    };
    const total = (idx, dx, dy) => idx.reduce((s, i) => s + one(i, dx, dy), 0);
    // 넓게 찾고 점점 좁혀 가는 격자 탐색
    const search = (idx, start, stages, penalty) => {
      let best = { dx: start[0], dy: start[1], v: total(idx, start[0], start[1]) + penalty(start[0], start[1]) };
      stages.forEach(([range, step]) => {
        const c = { ...best };
        for (let dx = c.dx - range; dx <= c.dx + range + 1e-9; dx += step)
          for (let dy = c.dy - range; dy <= c.dy + range + 1e-9; dy += step) {
            const v = total(idx, dx, dy) + penalty(dx, dy);
            if (v < best.v) best = { dx, dy, v };
          }
      });
      return best;
    };

    // 1) 전체를 한 번에
    const base = total(all, 0, 0);
    const g = search(all, [0, 0], [[8, 2], [2, 0.5], [0.5, 0.25]], () => 0);
    const G = base - g.v > base * 0.15 ? [g.dx, g.dy] : [0, 0];

    // 2) 블록별: 25m 칸마다 칸 중심 반경 35m 안 건물들과 함께 맞춤.
    //    전체 보정값에서 멀어질수록 약간 손해를 줘서 들쭉날쭉하지 않게
    const CELL = 25, R = 35, cellShift = new Map();
    const cellOf = i => Math.floor(cent[i][0] / CELL) + ',' + Math.floor(cent[i][1] / CELL);
    return buildings.map((_, i) => {
      if (!samples[i].length) return G;
      const key = cellOf(i);
      if (!cellShift.has(key)) {
        const [cx, cy] = key.split(',').map(v => (+v + 0.5) * CELL);
        const nb = all.filter(j => Math.hypot(cent[j][0] - cx, cent[j][1] - cy) <= R);
        const pen = (dx, dy) => 0.02 * nb.length * Math.hypot(dx - G[0], dy - G[1]);
        const b = search(nb, G, [[6, 2], [1, 0.5], [0.25, 0.25]], pen);
        cellShift.set(key, [b.dx, b.dy]);
      }
      return cellShift.get(key);
    });
  },

  shiftText(s) {
    return s ? `블록별 평균 ${fmt(s.avg, 1)}m, 최대 ${fmt(s.max, 1)}m 이동` : '';
  },

  niceScale(need) {
    const steps = [200, 250, 300, 500, 600, 1000, 1200, 1500, 2000, 2500, 3000, 5000, 6000, 10000, 15000, 20000, 25000, 50000];
    return steps.find(s => s >= need) || Math.ceil(need / 10000) * 10000;
  },

  // 도면 한 장(SVG, 단위 mm)
  sheetSVG(d, paper) {
    const [W, H] = PAPERS[paper];
    const u = W / 297;                       // 용지 크기에 비례한 글자·선 배율
    const m = 10 * u, side = 78 * u, gap = 6 * u;
    const fx = m, fy = m, fw = W - m * 2 - side - gap, fh = H - m * 2;

    // 축척: 구역(여유 8%)이 도면 틀에 들어가는 가장 가까운 표준 축척
    const zx = d.zone.flat().map(c => c[0]), zy = d.zone.flat().map(c => c[1]);
    let x0 = Math.min(...zx), x1 = Math.max(...zx), y0 = Math.min(...zy), y1 = Math.max(...zy);
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    const scale = this.niceScale(Math.max((x1 - x0) / (fw / 1000), (y1 - y0) / (fh / 1000)));
    const k = 1000 / scale;                  // 1m가 도면에서 몇 mm인지
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ox = fx + fw / 2, oy = fy + fh / 2;
    const tx = x => +(ox + (x - cx) * k).toFixed(2);
    const ty = y => +(oy - (y - cy) * k).toFixed(2);
    const path = rs => rs.map(r => 'M' + r.map(c => tx(c[0]) + ' ' + ty(c[1])).join('L') + 'Z').join('');
    const fs = 1.7 * u;                      // 지번 글자 크기(mm)

    const out = [];
    const el = s => out.push(s);
    el(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="'Noto Sans KR','Malgun Gothic',sans-serif">`);
    el(`<defs><clipPath id="frame"><rect x="${fx}" y="${fy}" width="${fw}" height="${fh}"/></clipPath></defs>`);
    el(`<rect width="${W}" height="${H}" fill="#fff"/>`);
    el(`<g clip-path="url(#frame)">`);
    // 도로 필지 바탕
    d.parcels.filter(p => p.jimok === '도').forEach(p => el(`<path d="${path(p.rings)}" fill="#efefef" stroke="none"/>`));
    // 건물
    d.buildings.forEach(b => {
      const fill = b.old ? '#f2a48f' : b.noInfo ? '#e2e2e2' : '#c9d3e6';
      el(`<path d="${path(b.rings)}" fill="${fill}" fill-opacity="${b.inZone ? 1 : 0.45}" stroke="#555" stroke-width="${0.08 * u}" fill-rule="evenodd"/>`);
    });
    // 필지 경계
    // 구역 밖 필지선도 건물과 구분되게 충분히 진하게
    d.parcels.forEach(p => el(`<path d="${path(p.rings)}" fill="none" stroke="${p.inZone ? '#222' : '#777'}" stroke-width="${(p.inZone ? 0.18 : 0.14) * u}"/>`));
    // 구역계
    el(`<path d="${path(d.zone)}" fill="none" stroke="#d40000" stroke-width="${0.6 * u}" stroke-linejoin="round"/>`);
    // 지번 (도면에서 너무 작은 필지는 생략)
    d.parcels.forEach(p => {
      if (!p.label || p.area * k * k < 25 * u * u) return;
      el(`<text x="${tx(p.label[0])}" y="${ty(p.label[1])}" font-size="${fs}" text-anchor="middle" dominant-baseline="middle" fill="${p.inZone ? '#111' : '#999'}">${esc(p.jibun)}</text>`);
    });
    el(`</g>`);
    el(`<rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" fill="none" stroke="#000" stroke-width="${0.3 * u}"/>`);

    // 방위표
    const nx = fx + fw - 10 * u, ny = fy + 12 * u;
    el(`<g><path d="M${nx} ${ny - 7 * u}L${nx + 3 * u} ${ny + 3 * u}L${nx} ${ny + 1 * u}L${nx - 3 * u} ${ny + 3 * u}Z" fill="#000"/><text x="${nx}" y="${ny - 8.5 * u}" font-size="${3 * u}" text-anchor="middle" font-weight="700">N</text></g>`);

    // 축척 막대 (도면에서 25~45mm 정도 되는 깔끔한 길이)
    const barM = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find(v => v * k >= 25 * u) || 1000;
    const bx = fx + 6 * u, by = fy + fh - 7 * u, bl = barM * k;
    el(`<g stroke="#000" stroke-width="${0.25 * u}"><rect x="${bx}" y="${by}" width="${bl / 2}" height="${1.4 * u}" fill="#000"/><rect x="${bx + bl / 2}" y="${by}" width="${bl / 2}" height="${1.4 * u}" fill="#fff"/></g>`);
    [0, barM / 2, barM].forEach((v, i) => el(`<text x="${bx + bl * i / 2}" y="${by - 1.2 * u}" font-size="${2.2 * u}" text-anchor="middle">${v}${i === 2 ? 'm' : ''}</text>`));

    // 오른쪽 표제·요약표
    const sx = fx + fw + gap, sw = side;
    let y = fy + 6 * u;
    const line = (t, size = 2.6, weight = 400, color = '#111') => { el(`<text x="${sx}" y="${y}" font-size="${size * u}" font-weight="${weight}" fill="${color}">${esc(t)}</text>`); y += size * u * 1.6; };
    const sv = Calc.survey(S), site = Calc.siteArea(S);
    const zoneArea = turf.area(S.area.geojson);
    line(S.meta.name || '정비사업 구역계', 4.2, 700);
    line(`${TYPES[S.meta.type].label} · 구역계 및 노후도 현황도`, 2.6, 400, '#555');
    y += 2 * u;
    const rows = [
      ['위치', S.meta.location || '–'],
      ['용도지역', [S.meta.zoning, ...(S.meta.zoningList || []).filter(z => z !== S.meta.zoning)].filter(Boolean).join(', ') || '–'],
      ['구역 면적', `${fmt(zoneArea)}㎡ (${fmt(zoneArea / PY)}평)`],
      ['필지', `${fmt(d.parcels.filter(p => p.inZone).length)}필지`],
      ['건축물', `${fmt(d.buildings.filter(b => b.inZone).length)}동`],
      ['노후·불량건축물', `${fmt(d.buildings.filter(b => b.inZone && b.old).length)}동 (${fmtPct(d.buildings.filter(b => b.inZone).length ? d.buildings.filter(b => b.inZone && b.old).length / d.buildings.filter(b => b.inZone).length * 100 : NaN)})`],
      ['노후 기준', `철근콘크리트·철골 ${S.criteria.rcYears}년, 기타 ${S.criteria.otherYears}년 이상`],
      ['축척', `1:${fmt(scale)} (${paper} 출력 기준)`],
      ['좌표계', `GRS80 TM ${d.P.name} (EPSG:${d.P.epsg})`],
    ];
    rows.forEach(([kk, v]) => {
      el(`<text x="${sx}" y="${y}" font-size="${2.3 * u}" fill="#666">${esc(kk)}</text>`);
      // 긴 값은 줄바꿈
      const maxChars = 26;
      const parts = []; let s = String(v);
      while (s.length > maxChars) { parts.push(s.slice(0, maxChars)); s = s.slice(maxChars); }
      parts.push(s);
      parts.forEach((pt, i) => el(`<text x="${sx + 22 * u}" y="${y + i * 3.3 * u}" font-size="${2.3 * u}">${esc(pt)}</text>`));
      y += Math.max(1, parts.length) * 3.3 * u + 1.6 * u;
      el(`<line x1="${sx}" x2="${sx + sw}" y1="${y - 2.4 * u}" y2="${y - 2.4 * u}" stroke="#ddd" stroke-width="${0.15 * u}"/>`);
    });

    // 범례
    y += 3 * u;
    line('범례', 2.8, 700);
    const legend = [
      ['line', '#d40000', 0.6, '구역계'],
      ['line', '#222', 0.18, '필지 경계 (구역 내)'],
      ['line', '#777', 0.14, '필지 경계 (구역 외)'],
      ['box', '#f2a48f', 0, '노후·불량건축물'],
      ['box', '#c9d3e6', 0, '그 밖의 건축물'],
      ['box', '#e2e2e2', 0, '사용승인일 정보 없음'],
      ['box', '#efefef', 0, '도로'],
    ];
    legend.forEach(([t, c, w, label]) => {
      if (t === 'line') el(`<line x1="${sx}" x2="${sx + 8 * u}" y1="${y - 0.8 * u}" y2="${y - 0.8 * u}" stroke="${c}" stroke-width="${w * u}"/>`);
      else el(`<rect x="${sx}" y="${y - 2.4 * u}" width="${8 * u}" height="${3 * u}" fill="${c}" stroke="#555" stroke-width="${0.08 * u}"/>`);
      el(`<text x="${sx + 11 * u}" y="${y}" font-size="${2.3 * u}">${esc(label)}</text>`);
      y += 4.2 * u;
    });

    // 출처·주의
    const today = new Date();
    const notes = [
      `출력일 ${today.getFullYear()}.${today.getMonth() + 1}.${today.getDate()}`,
      '자료: 브이월드(국토교통부) 연속지적도, GIS건물통합정보',
      ...(d.shift ? [`건물 위치를 지적에 맞춰 보정함 (${this.shiftText(d.shift)})`] : []),
      '본 도면은 사업성 검토용 참고도이며 측량 성과가 아닙니다.',
    ];
    let ny2 = fy + fh - notes.length * 3.2 * u;
    notes.forEach(t => { el(`<text x="${sx}" y="${ny2}" font-size="${2 * u}" fill="#666">${esc(t)}</text>`); ny2 += 3.2 * u; });
    el(`</svg>`);
    return { svg: out.join(''), scale };
  },

  async pdf(paper) {
    const msg = $('#exportMsg');
    try {
      msg.textContent = '도면 자료를 불러오는 중…';
      const d = await this.collect();
      const { svg, scale } = this.sheetSVG(d, paper);
      let sheet = $('#printSheet');
      if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.append(sheet); }
      sheet.innerHTML = svg;
      let st = $('#pageStyle');
      if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.append(st); }
      st.textContent = `@page { size: ${paper} landscape; margin: 0; }`;
      document.body.classList.add('print-sheet');
      const done = () => {
        document.body.classList.remove('print-sheet');
        sheet.innerHTML = '';
        st.textContent = '';
        window.removeEventListener('afterprint', done);
      };
      window.addEventListener('afterprint', done);
      msg.textContent = `축척 1:${fmt(scale)} 도면을 만들었습니다.` + (d.shift ? ` 건물 위치를 지적에 맞춰 보정했습니다(${this.shiftText(d.shift)}).` : '')
        + ` 인쇄 창에서 대상을 "PDF로 저장"으로 고르세요. (용지 ${paper} 가로, 여백 없음)`;
      setTimeout(() => window.print(), 150);
    } catch (e) {
      msg.textContent = '도면을 만들지 못했습니다: ' + e.message;
    }
  },

  // AutoCAD R12 형식 DXF (대부분의 CAD에서 열림)
  async dxf() {
    const msg = $('#exportMsg');
    try {
      msg.textContent = '도면 자료를 불러오는 중…';
      const d = await this.collect();
      const L = [];
      const add = (...a) => a.forEach(v => L.push(String(v)));
      // 한글은 \U+XXXX 로 넣어야 코드페이지와 상관없이 CAD에서 보임
      const enc = s => String(s).replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
      const n = v => (+v).toFixed(4);
      const layers = [['ZONE', 1], ['PARCEL', 7], ['PARCEL_OUTSIDE', 8], ['JIBUN', 7], ['BUILDING', 5], ['BUILDING_OLD', 6], ['BUILDING_NAME', 4]];

      add(999, `Zone boundary - EPSG:${d.P.epsg} (GRS80 TM), meters`);
      add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$DWGCODEPAGE', 3, 'ANSI_949', 0, 'ENDSEC');
      add(0, 'SECTION', 2, 'TABLES');
      add(0, 'TABLE', 2, 'LTYPE', 70, 1, 0, 'LTYPE', 2, 'CONTINUOUS', 70, 0, 3, 'Solid line', 72, 65, 73, 0, 40, '0.0', 0, 'ENDTAB');
      add(0, 'TABLE', 2, 'LAYER', 70, layers.length);
      layers.forEach(([name, color]) => add(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS'));
      add(0, 'ENDTAB', 0, 'ENDSEC');
      add(0, 'SECTION', 2, 'ENTITIES');
      const poly = (layer, ring) => {
        add(0, 'POLYLINE', 8, layer, 66, 1, 70, 1, 10, '0.0', 20, '0.0', 30, '0.0');
        ring.slice(0, -1).forEach(c => add(0, 'VERTEX', 8, layer, 10, n(c[0]), 20, n(c[1]), 30, '0.0'));
        add(0, 'SEQEND', 8, layer);
      };
      const text = (layer, p, h, s) => add(0, 'TEXT', 8, layer, 10, n(p[0]), 20, n(p[1]), 30, '0.0', 40, h, 1, enc(s), 72, 1, 73, 2, 11, n(p[0]), 21, n(p[1]), 31, '0.0');

      d.zone.forEach(r => poly('ZONE', r));
      d.parcels.forEach(p => {
        p.rings.forEach(r => poly(p.inZone ? 'PARCEL' : 'PARCEL_OUTSIDE', r));
        if (p.label && p.jibun) text('JIBUN', p.label, '1.0', p.jibun);
      });
      d.buildings.forEach(b => {
        b.rings.forEach(r => poly(b.old ? 'BUILDING_OLD' : 'BUILDING', r));
        if (b.label && b.name) text('BUILDING_NAME', b.label, '0.8', b.name);
      });
      add(0, 'ENDSEC', 0, 'EOF');

      download(`${S.meta.name || '구역계'}_도면_EPSG${d.P.epsg}.dxf`, L.join('\r\n'), 'application/dxf');
      msg.textContent = (d.shift ? `건물 위치를 지적에 맞춰 보정했습니다(${this.shiftText(d.shift)}). ` : '') + `DXF를 저장했습니다. 좌표계 GRS80 TM ${d.P.name}(EPSG:${d.P.epsg}), 단위 m. 레이어: 구역계 ZONE, 필지 PARCEL, 지번 JIBUN, 건물 BUILDING, 노후 건물 BUILDING_OLD.`;
    } catch (e) {
      msg.textContent = 'DXF를 만들지 못했습니다: ' + e.message;
    }
  },
};
