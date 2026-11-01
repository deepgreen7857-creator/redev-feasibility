'use strict';
// /arch 도면 그리기(SVG): 배치도, 표준 단위세대 평면, 주동 기준층 구성
(function (g) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPE_FILL = { 39: '#f6e7e1', 49: '#f3ead2', 59: '#efe2c4', 74: '#e2ead0', 84: '#d6e6d9', 101: '#d6e3e8', 114: '#d9e1ee' };
  const TAG = {
    boundary: { name: '대지경계', color: '#8a949b' },
    road: { name: '도로 접함', color: '#2f6fa3' },
    arterial: { name: '간선도로(소음)', color: '#7a4fb0' },
    north: { name: '정북 인접대지(일조)', color: '#d0752a' },
    park: { name: '공원·녹지 접함', color: '#6aa84f' },
    lowrise: { name: '저층 주거 인접(층수 점감)', color: '#0f8a8a' },
  };
  const fmt = (v, d = 0) => (v === null || v === undefined || isNaN(v)) ? '○○' : (+v).toLocaleString('ko-KR', { maximumFractionDigits: d });

  // 배치도. o: {site, tags, setbacks, exclude, entries, alt, title, shadowAt:{polys}, sunGrid:{cells, step}, H}
  function sitePlan(o) {
    const pts = o.site, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = Math.max(30, (x1 - x0 + y1 - y0) * 0.08);
    if (o.sunGrid) { x0 -= 60; x1 += 60; y0 -= 30; y1 += 90; }
    x0 -= pad; x1 += pad; y1 += pad; y0 -= pad * 1.35; // 아래쪽에 범례·표제
    const W = x1 - x0, Hh = y1 - y0, u = Math.max(W, Hh) / 900; // 글자·선 단위
    const X = x => (x - x0).toFixed(2), Y = y => (y1 - y).toFixed(2), P = p => `${X(p[0])},${Y(p[1])}`;
    const poly = (ps, attrs) => `<polygon points="${ps.map(P).join(' ')}" ${attrs}/>`;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(1)} ${Hh.toFixed(1)}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif" class="siteplan">
<defs><pattern id="hatch" width="${4 * u}" height="${4 * u}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${4 * u}" stroke="#7d9a7a" stroke-width="${0.6 * u}"/></pattern>
<marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d2a33"/></marker></defs>
<rect width="100%" height="100%" fill="#fbfbf8"/>`;
    // 일조 격자
    if (o.sunGrid) o.sunGrid.cells.forEach(c => {
      if (c.ok) return;
      s += `<rect x="${X(c.p[0] - o.sunGrid.step / 2)}" y="${Y(c.p[1] + o.sunGrid.step / 2)}" width="${o.sunGrid.step}" height="${o.sunGrid.step}" fill="#d9483b" opacity="${Math.min(0.55, 0.2 + (2 - c.cont) * 0.15).toFixed(2)}"/>`;
    });
    // 그림자
    (o.shadowAt || []).forEach(sh => { s += poly(sh, `fill="#3b4a58" opacity=".18"`); });
    // 구역(대지) 바탕
    s += poly(pts, `fill="#eef2e9" stroke="none"`);
    // 제외 영역(기반시설·공원)
    (o.exclude || []).forEach(ex => { s += poly(ex, `fill="url(#hatch)" stroke="#7d9a7a" stroke-width="${0.8 * u}"`); });
    // 이격선(변별 안쪽 평행선)
    const E = ArchGeom.edges(pts), cen = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
    E.forEach((e, i) => {
      const d = o.setbacks[i] || 0; if (d <= 0) return;
      const n = [-e.out[0], -e.out[1]], a = [e.a[0] + n[0] * d, e.a[1] + n[1] * d], b = [e.b[0] + n[0] * d, e.b[1] + n[1] * d];
      // 양끝을 조금 줄여 이웃 변과 겹치지 않게
      const k = Math.min(d, e.len * 0.25) / e.len, dx = b[0] - a[0], dy = b[1] - a[1];
      s += `<line x1="${X(a[0] + dx * k)}" y1="${Y(a[1] + dy * k)}" x2="${X(b[0] - dx * k)}" y2="${Y(b[1] - dy * k)}" stroke="#9aa39d" stroke-width="${0.7 * u}" stroke-dasharray="${3 * u} ${2 * u}"/>`;
    });
    // 변 성격 색 띠(바깥쪽)
    E.forEach((e, i) => {
      const t = TAG[o.tags[i]] || TAG.boundary, off = 2.2 * u;
      s += `<line x1="${X(e.a[0] + e.out[0] * off)}" y1="${Y(e.a[1] + e.out[1] * off)}" x2="${X(e.b[0] + e.out[0] * off)}" y2="${Y(e.b[1] + e.out[1] * off)}" stroke="${t.color}" stroke-width="${2.4 * u}" stroke-linecap="round" opacity=".85"/>`;
    });
    // 구역계(적색 일점쇄선)
    s += poly(pts, `fill="none" stroke="#c8322b" stroke-width="${1.6 * u}" stroke-dasharray="${9 * u} ${3 * u} ${2 * u} ${3 * u}"`);
    // 주동
    const A = o.alt;
    (A ? A.buildings : []).forEach(b => {
      s += poly(b.poly, `fill="${TYPE_FILL[b.t] || '#eee'}" stroke="#1d2a33" stroke-width="${0.9 * u}"`);
      // 코어 표시
      const p0 = b.poly[0], p1 = b.poly[1], p3 = b.poly[3], ux = [(p1[0] - p0[0]) / b.L, (p1[1] - p0[1]) / b.L], uy = [(p3[0] - p0[0]) / b.D, (p3[1] - p0[1]) / b.D];
      const unitW = (b.L - (b.n / 2) * o.coreW) / b.n;
      for (let k = 0; k < b.n / 2; k++) {
        const at = k * (2 * unitW + o.coreW) + unitW, c = [p0[0] + ux[0] * at + uy[0] * b.D * 0.66, p0[1] + ux[1] * at + uy[1] * b.D * 0.66];
        const q = [c, [c[0] + ux[0] * o.coreW, c[1] + ux[1] * o.coreW], [c[0] + ux[0] * o.coreW + uy[0] * b.D * 0.34, c[1] + ux[1] * o.coreW + uy[1] * b.D * 0.34], [c[0] + uy[0] * b.D * 0.34, c[1] + uy[1] * b.D * 0.34]];
        s += poly(q, `fill="#ffffff" stroke="#1d2a33" stroke-width="${0.5 * u}" opacity=".9"`);
      }
      const cx = b.poly.reduce((a, p) => a + p[0], 0) / 4 - uy[0] * b.D * 0.14, cy = b.poly.reduce((a, p) => a + p[1], 0) / 4 - uy[1] * b.D * 0.14;
      let ang = -Math.atan2(p1[1] - p0[1], p1[0] - p0[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const fs = Math.max(5 * u, Math.min(b.D * 0.26, 8.5 * u));
      s += `<g transform="translate(${X(cx)},${Y(cy)}) rotate(${ang.toFixed(1)})"><text text-anchor="middle" y="${-fs * 0.15}" font-size="${fs}" font-weight="700" fill="#1d2a33">${b.id}동</text><text text-anchor="middle" y="${fs * 0.95}" font-size="${fs * 0.72}" fill="#33424b">${b.floors}F · ${b.t}㎡×${b.n}</text></g>`;
    });
    // 출입구
    (o.entries || []).forEach(en => {
      const e = E[en.edge]; if (!e) return;
      const m = [e.a[0] + (e.b[0] - e.a[0]) * en.t, e.a[1] + (e.b[1] - e.a[1]) * en.t], L = 16 * u;
      const from = [m[0] + e.out[0] * L, m[1] + e.out[1] * L], to = [m[0] - e.out[0] * 2 * u, m[1] - e.out[1] * 2 * u];
      s += `<line x1="${X(from[0])}" y1="${Y(from[1])}" x2="${X(to[0])}" y2="${Y(to[1])}" stroke="#1d2a33" stroke-width="${1.6 * u}" marker-end="url(#arr)"/>`;
      s += `<text x="${X(from[0] + e.out[0] * 5 * u)}" y="${Y(from[1] + e.out[1] * 5 * u)}" font-size="${7 * u}" text-anchor="middle" font-weight="600" fill="#1d2a33">${esc(en.label || '차량 출입')}</text>`;
    });
    // 방위표·축척
    const nx = W - 26 * u, ny = 30 * u;
    s += `<g transform="translate(${nx},${ny})"><circle r="${11 * u}" fill="#fff" stroke="#1d2a33" stroke-width="${0.8 * u}"/><path d="M0,${-9 * u} L${4 * u},${5 * u} L0,${2 * u} L${-4 * u},${5 * u} z" fill="#1d2a33"/><text y="${-13 * u}" text-anchor="middle" font-size="${8 * u}" font-weight="700">N</text></g>`;
    const nice = [10, 20, 25, 50, 100, 200].find(v => v > W / 9) || 200, sx = 14 * u, sy = Hh - 14 * u;
    s += `<g font-size="${6.5 * u}" fill="#1d2a33"><rect x="${sx}" y="${sy - 3 * u}" width="${nice / 2}" height="${3 * u}" fill="#1d2a33"/><rect x="${sx + nice / 2}" y="${sy - 3 * u}" width="${nice / 2}" height="${3 * u}" fill="#fff" stroke="#1d2a33" stroke-width="${0.5 * u}"/>
      <text x="${sx}" y="${sy - 5 * u}">0</text><text x="${sx + nice}" y="${sy - 5 * u}" text-anchor="middle">${nice}m</text></g>`;
    // 범례
    let lx = sx, ly = Hh - 30 * u;
    const used = [...new Set(o.tags)];
    used.forEach(t => { const c = TAG[t] || TAG.boundary; s += `<line x1="${lx}" y1="${ly}" x2="${lx + 12 * u}" y2="${ly}" stroke="${c.color}" stroke-width="${2.4 * u}"/><text x="${lx + 15 * u}" y="${ly + 2.3 * u}" font-size="${6.5 * u}">${c.name}</text>`; lx += 18 * u + c.name.length * 6.6 * u; });
    s += `<line x1="${lx}" y1="${ly}" x2="${lx + 14 * u}" y2="${ly}" stroke="#c8322b" stroke-width="${1.4 * u}" stroke-dasharray="${5 * u} ${2 * u} ${1 * u} ${2 * u}"/><text x="${lx + 17 * u}" y="${ly + 2.3 * u}" font-size="${6.5 * u}">구역계</text>`;
    if (o.sunGrid) s += `<rect x="${lx + 50 * u}" y="${ly - 3 * u}" width="${6 * u}" height="${6 * u}" fill="#d9483b" opacity=".5"/><text x="${lx + 59 * u}" y="${ly + 2.3 * u}" font-size="${6.5 * u}">동지 일조 수인한도 미달(판례 기준 참고)</text>`;
    // 표제
    if (A) {
      const tw = 190 * u, th = 46 * u, tx = W - tw - 10 * u, ty = Hh - th - 8 * u;
      s += `<g transform="translate(${tx},${ty})" font-size="${6.4 * u}" fill="#1d2a33"><rect width="${tw}" height="${th}" fill="#fff" stroke="#1d2a33" stroke-width="${0.8 * u}"/>
        <text x="${6 * u}" y="${11 * u}" font-size="${8.5 * u}" font-weight="700">${esc(o.title || '')} 개략 배치도 — ${esc(A.label || '')}</text>
        <text x="${6 * u}" y="${22 * u}">세대수 ${fmt(A.units)}세대 · ${A.buildings.length}개동 · 최고 ${A.maxFloors}층(약 ${fmt(A.maxHeight, 1)}m)</text>
        <text x="${6 * u}" y="${32 * u}">건폐율 ${fmt(A.bcr, 1)}% · 용적률 ${fmt(A.far, 1)}% · 지상 연면적 ${fmt(A.gfa)}㎡</text>
        <text x="${6 * u}" y="${41 * u}" fill="#6a767d">jbslab /arch 자동 작성 개략안 — 설계도면 아님</text></g>`;
    }
    return s + '</svg>';
  }

  // 표준 단위세대 평면(개략). t: arch.json 평면 항목
  function unitPlan(key, t) {
    const S = 22, w = t.폭 * S, d = t.깊이 * S, pad = 26, bal = 1.4 * S;
    const W = w + pad * 2, H = d + pad * 2 + 18;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif" class="unitplan"><rect width="100%" height="100%" fill="#fbfbf8"/><g transform="translate(${pad},${pad})" font-size="10" fill="#1d2a33">`;
    const room = (x, y, ww, hh, name, fill = '#fff') => { s += `<rect x="${x}" y="${y}" width="${ww}" height="${hh}" fill="${fill}" stroke="#1d2a33" stroke-width="1.2"/><text x="${x + ww / 2}" y="${y + hh / 2 + 3.5}" text-anchor="middle">${name}</text>`; };
    const front = d * 0.56, rear = d - front - bal;
    // 남쪽(아래) 발코니
    room(0, d - bal, w, bal, '발코니(확장 가능)', '#f1f4ee');
    const bays = t.베이, bw = w / bays, names = bays === 2 ? (t.방 >= 2 ? ['거실', '안방'] : ['거실·주방', '침실']) : bays === 3 ? ['침실2', '거실', '안방'] : ['침실2', '거실', '안방', '침실3'];
    for (let i = 0; i < bays; i++) room(i * bw, d - bal - front, bw, front, names[i], names[i] === '거실' ? '#fffaf0' : '#fff');
    // 북쪽(위): 주방·욕실·현관·드레스
    const li = Math.max(0, names.findIndex(n => /거실/.test(n)));
    room(li * bw, 0, bw, rear, '주방·식당', '#fffaf0');
    room(0, 0, li * bw * 0.55, rear, '욕실', '#eef4f7');
    room(li * bw * 0.55, 0, li * bw * 0.45, rear, '현관', '#f5f3ee');
    const rx = (li + 1) * bw, rw = w - rx;
    if (bays === 2) { if (t.방 >= 2) { room(rx, 0, rw * 0.55, rear, '침실2'); room(rx + rw * 0.55, 0, rw * 0.45, rear, '드레스'); } else room(rx, 0, rw, rear, '수납·드레스'); }
    else if (bays === 3) { room(rx, 0, rw * 0.5, rear, '드레스'); room(rx + rw * 0.5, 0, rw * 0.5, rear, '욕실', '#eef4f7'); }
    else if (t.방 >= 4) { room(rx, 0, rw * 0.35, rear, '욕실', '#eef4f7'); room(rx + rw * 0.35, 0, rw * 0.3, rear, '드레스'); room(rx + rw * 0.65, 0, rw * 0.35, rear, '침실4'); }
    else { room(rx, 0, rw * 0.4, rear, '드레스'); room(rx + rw * 0.4, 0, rw * 0.3, rear, '욕실', '#eef4f7'); room(rx + rw * 0.7, 0, rw * 0.3, rear, '팬트리'); }
    // 치수선
    s += `<line x1="0" y1="${d + 10}" x2="${w}" y2="${d + 10}" stroke="#1d2a33" stroke-width=".8"/><text x="${w / 2}" y="${d + 22}" text-anchor="middle" font-size="9.5">${t.폭.toFixed(1)}m</text>`;
    s += `<line x1="${w + 10}" y1="0" x2="${w + 10}" y2="${d}" stroke="#1d2a33" stroke-width=".8"/><text transform="translate(${w + 20},${d / 2}) rotate(90)" text-anchor="middle" font-size="9.5">${t.깊이.toFixed(1)}m</text>`;
    s += `<text x="0" y="-9" font-size="11.5" font-weight="700">${esc(t.이름)} · 전용 ${t.전용}㎡ · ${bays}베이</text><text x="${w}" y="-9" font-size="9" text-anchor="end" fill="#6a767d">남 ↓</text>`;
    return s + '</g></svg>';
  }

  // 주동 기준층 구성: [세대][코어][세대] × (n/2)
  function floorPlan(b, U, coreW) {
    const t = U[b.t], S = 7, unitW = t.폭 * S, cw = coreW * S, D = t.깊이 * S, n = b.n, pad = 16;
    const L = n * unitW + (n / 2) * cw, W = L + pad * 2, H = D + pad * 2 + 14;
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif"><rect width="100%" height="100%" fill="#fbfbf8"/><g transform="translate(${pad},${pad + 8})" font-size="9" fill="#1d2a33">`;
    let x = 0;
    for (let k = 0; k < n / 2; k++) {
      s += `<rect x="${x}" y="0" width="${unitW}" height="${D}" fill="${TYPE_FILL[b.t]}" stroke="#1d2a33"/><text x="${x + unitW / 2}" y="${D / 2 + 3}" text-anchor="middle">${b.t}㎡</text>`; x += unitW;
      s += `<rect x="${x}" y="0" width="${cw}" height="${D * 0.6}" fill="#fff" stroke="#1d2a33"/><text x="${x + cw / 2}" y="${D * 0.33}" text-anchor="middle" font-size="7.5">코어</text>`; x += cw;
      s += `<rect x="${x}" y="0" width="${unitW}" height="${D}" fill="${TYPE_FILL[b.t]}" stroke="#1d2a33"/><text x="${x + unitW / 2}" y="${D / 2 + 3}" text-anchor="middle">${b.t}㎡</text>`; x += unitW;
    }
    s += `<text x="0" y="-6" font-size="10" font-weight="700">판상형 ${n}호 조합 (${(n / 2)}개 코어, 2호 1코어) · 길이 ${(L / S).toFixed(1)}m · 위 북 / 아래 남</text>`;
    return s + '</g></svg>';
  }

  g.ArchDraw = { sitePlan, unitPlan, floorPlan, TAG, TYPE_FILL };
})(window);
