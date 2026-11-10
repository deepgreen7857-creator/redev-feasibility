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
  const ar = q => { let a = 0; for (let i = 0, j = q.length - 1; i < q.length; j = i++) a += q[j][0] * q[i][1] - q[i][0] * q[j][1]; return a / 2; };
  // 한 세대(사각형 조각들)의 바깥 선 — turf가 있으면 합쳐서, 없으면 조각 그대로
  function unitOutline(rs) {
    if (typeof turf !== 'undefined' && rs.length > 1) {
      try { let u = turf.polygon([rs[0].concat([rs[0][0]])]); for (let k = 1; k < rs.length; k++) u = turf.union(u, turf.polygon([rs[k].concat([rs[k][0]])])) || u; const g = u.geometry; return (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map(c => c[0].slice(0, -1)); } catch (e) { /* 조각 그대로 */ }
    }
    return rs;
  }
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
<defs><pattern id="fireHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff3bf"/><line x1="0" y1="0" x2="0" y2="6" stroke="#e8a400" stroke-width="2.5"/></pattern><pattern id="hatch" width="${4 * u}" height="${4 * u}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${4 * u}" stroke="#7d9a7a" stroke-width="${0.6 * u}"/></pattern>
<marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1d2a33"/></marker></defs>
<rect width="100%" height="100%" fill="#fbfbf8"/>`;
    // 일조 격자
    if (o.sunGrid) o.sunGrid.cells.forEach(c => {
      if (c.ok) return;
      s += `<rect x="${X(c.p[0] - o.sunGrid.step / 2)}" y="${Y(c.p[1] + o.sunGrid.step / 2)}" width="${o.sunGrid.step}" height="${o.sunGrid.step}" fill="#d9483b" opacity="${Math.min(0.55, 0.2 + (2 - c.cont) * 0.15).toFixed(2)}"/>`;
    });
    // 그림자
    (o.shadowAt || []).forEach(sh => { s += poly(sh, `fill="#3b4a58" opacity=".18"`); });
    (o.context || []).forEach(c => { const hit = o.hit && o.hit.has(c); s += poly(c.poly, `fill="${hit ? '#f3c9c4' : c.res ? '#dcdcd6' : '#e8e8e4'}" stroke="${hit ? '#c8322b' : '#9a9a92'}" stroke-width="${(hit ? 1.2 : 0.5) * u}"`); });
    // 구역(대지) 바탕
    s += poly(pts, `fill="#eef2e9" stroke="none"`);
    // 제외 영역(기반시설·공원)
    const EXC = k => /공원|녹지/.test(k) ? '#cfe3c6' : /종교/.test(k) ? '#e9dcef' : /학교/.test(k) ? '#f3e3c3' : /도로/.test(k) ? '#e4e4e0' : 'none';
    (o.exclude || []).forEach((ex, i) => { const k = (o.exKinds || [])[i] || ''; if (EXC(k) !== 'none') s += poly(ex, `fill="${EXC(k)}" stroke="none"`); s += poly(ex, `fill="url(#hatch)" stroke="#7d9a7a" stroke-width="${0.8 * u}"`); });
    (o.exclude || []).forEach((ex, i) => { const k = (o.exKinds || [])[i]; if (!k || /도로/.test(k) || Math.abs(ar(ex)) < 300) return; const c = ex.reduce((a, p) => [a[0] + p[0] / ex.length, a[1] + p[1] / ex.length], [0, 0]); s += `<text x="${X(c[0])}" y="${Y(c[1])}" font-size="${7 * u}" text-anchor="middle" font-weight="600" fill="#3d5a3a" paint-order="stroke" stroke="#fbfbf8" stroke-width="${2 * u}">${esc(k)}</text>`; });
    // 이격선(변별 안쪽 평행선)
    const E = ArchGeom.edges(pts), cen = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
    E.forEach((e, i) => {
      const d = o.setbacks[i] || 0; if (d <= 0) return;
      const n = [-e.out[0], -e.out[1]], a = [e.a[0] + n[0] * d, e.a[1] + n[1] * d], b = [e.b[0] + n[0] * d, e.b[1] + n[1] * d];
      // 양끝을 조금 줄여 이웃 변과 겹치지 않게
      const k = Math.min(d, e.len * 0.25) / e.len, dx = b[0] - a[0], dy = b[1] - a[1];
      // 도로·간선도로 변의 이격선 = 건축한계선(정비계획·지구단위계획 표기처럼 붉은 파선 + 치수)
      const lim = ['road', 'arterial'].includes((o.tags || [])[i]);
      // /urban 건축선·출입 계획 값이 있으면 그 거리에 건축한계선, 배치 이격(소음 등)이 더 크면 회색 파선을 따로(2026-11-08)
      const be = o.bl && o.bl.edges ? o.bl.edges[i] : null, dl = lim && be ? be.sb : d;
      const ln = (dd, col, w, dash, label) => {
        const a2 = [e.a[0] + n[0] * dd, e.a[1] + n[1] * dd], b2 = [e.b[0] + n[0] * dd, e.b[1] + n[1] * dd], kk = Math.min(dd, e.len * 0.25) / e.len, ddx = b2[0] - a2[0], ddy = b2[1] - a2[1];
        let r = `<line x1="${X(a2[0] + ddx * kk)}" y1="${Y(a2[1] + ddy * kk)}" x2="${X(b2[0] - ddx * kk)}" y2="${Y(b2[1] - ddy * kk)}" stroke="${col}" stroke-width="${w * u}" stroke-dasharray="${dash}"/>`;
        if (label && e.len >= 40) {
          const t0 = label.t, mx = a2[0] + ddx * t0, my = a2[1] + ddy * t0;
          let ang = Math.atan2(-(ddy), ddx) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
          r += `<text x="${X(mx + n[0] * 2.2 * u)}" y="${Y(my + n[1] * 2.2 * u)}" transform="rotate(${ang.toFixed(1)} ${X(mx + n[0] * 2.2 * u)} ${Y(my + n[1] * 2.2 * u)})" font-size="${5 * u}" text-anchor="middle" fill="${col}" font-weight="600">${label.txt}</text>`;
        }
        return r;
      };
      if (lim && be && dl > 0) s += poly([e.a, e.b, [e.b[0] + n[0] * dl, e.b[1] + n[1] * dl], [e.a[0] + n[0] * dl, e.a[1] + n[1] * dl]], `fill="${be.front === 'walk' ? '#e9d8bf' : '#d3ebd3'}" stroke="none"`);   // 전면공지(보도형·조경형)
      if (lim && dl > 0) s += ln(dl, '#c2255c', 1.1, `${6 * u} ${2.5 * u}`, { t: 0.25, txt: `건축한계선 ${fmt(dl, 1)}m` });
      if (!lim) s += ln(d, '#9aa39d', 0.7, `${3 * u} ${2 * u}`, null);
      else if (d > dl + 0.5) s += ln(d, '#868e96', 0.7, `${3 * u} ${2 * u}`, { t: 0.7, txt: `소음 이격 ${fmt(d, 1)}m` });
    });
    // 공공보행통로·공개공지(건축 불가)
    ((o.bl && o.bl.keep) || []).forEach(k => {
      s += poly(k.poly, k.kind === 'walk' ? `fill="#d0ebff" stroke="#1c7ed6" stroke-width="${0.6 * u}" stroke-dasharray="${2 * u} ${1.5 * u}"` : `fill="#ffdeeb" stroke="#d6336c" stroke-width="${0.6 * u}"`);
      const c = k.poly.reduce((m, p) => [m[0] + p[0] / k.poly.length, m[1] + p[1] / k.poly.length], [0, 0]);
      s += `<text x="${X(c[0])}" y="${Y(c[1])}" font-size="${5.5 * u}" text-anchor="middle" fill="${k.kind === 'walk' ? '#1864ab' : '#a61e4d'}" font-weight="700">${k.kind === 'walk' ? `공공보행통로(폭 ${fmt(k.w, 1)}m)` : '공개공지'}</text>`;
    });
    // 단지 안 비상차로(2026-11-10) — 회색 차로 + 가운데 점선, 보도 1.5m 한쪽
    if (o.spine) { const r = o.spine; s += poly(r.poly, `fill="#dee2e6" stroke="#868e96" stroke-width="${0.5 * u}"`);
      s += `<line x1="${X(r.a[0])}" y1="${Y(r.a[1])}" x2="${X(r.b[0])}" y2="${Y(r.b[1])}" stroke="#fff" stroke-width="${0.6 * u}" stroke-dasharray="${3 * u} ${2 * u}"/>`;
      const m = [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]; let ang = Math.atan2(-(r.b[1] - r.a[1]), r.b[0] - r.a[0]) * 180 / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      s += `<text x="${X(m[0])}" y="${Y(m[1])}" transform="rotate(${ang.toFixed(1)} ${X(m[0])} ${Y(m[1])})" font-size="${4.5 * u}" text-anchor="middle" dy="${-1.5 * u}" fill="#495057" font-weight="600">비상차로 ${fmt(r.w, 1)}m</text>`; }
    // 소방자동차 전용구역 — 노란 빗금 사각형(자리 없는 동은 동 위에 붉은 '소방' 표시)
    (o.fire || []).forEach(f => {
      if (f.ok) { s += poly(f.pad, `fill="url(#fireHatch)" stroke="#e8a400" stroke-width="${0.6 * u}"`); return; }
      const b = ((o.alt && o.alt.buildings) || []).find(x => x.id === f.id), R = b && (b.poly || (b.parts || [])[0]); if (!R) return;
      const c = R.reduce((m, p) => [m[0] + p[0] / R.length, m[1] + p[1] / R.length], [0, 0]);
      s += `<text x="${X(c[0])}" y="${Y(c[1])}" dy="${8 * u}" font-size="${4.5 * u}" text-anchor="middle" fill="#c92a2a" font-weight="700">소방차 자리 없음</text>`;
    });
    // 출입구 자리(건축 불가) — 주출입구: 문주(기둥 둘 + 지붕 점선)·진입광장 / 주차장 출입구: 지하 경사로(오르내림 화살표) / 부출입구: 보행 출입
    const GC = { main: '#c92a2a', park: '#1971c2', sub: '#e67700' };
    (o.gates || []).forEach(z => {
      const c = GC[z.kind] || '#555', q = z.q, h = z.w / 2;
      if (z.kind === 'main') {
        s += poly([q(-h, z.sb), q(h, z.sb), q(h, z.D), q(-h, z.D)], `fill="#f4e7d8" stroke="${c}" stroke-width="${0.6 * u}" stroke-dasharray="${2 * u} ${1.5 * u}"`);
        // 진입로(가운데 차로 6m)
        s += poly([q(-3, 0), q(3, 0), q(3, z.D), q(-3, z.D)], `fill="#e3d6c4" stroke="none"`);
        // 문주: 건축한계선 위 기둥 둘(1.2m 각) + 지붕(폭 전체, 깊이 3m 점선)
        const pil = sg => { const x = sg * (h - 1); return [q(x - 0.6, z.sb), q(x + 0.6, z.sb), q(x + 0.6, z.sb + 1.2), q(x - 0.6, z.sb + 1.2)]; };
        s += poly(pil(-1), `fill="${c}"`) + poly(pil(1), `fill="${c}"`);
        s += poly([q(-h, z.sb - 0.9), q(h, z.sb - 0.9), q(h, z.sb + 2.1), q(-h, z.sb + 2.1)], `fill="none" stroke="${c}" stroke-width="${0.6 * u}" stroke-dasharray="${1.5 * u} ${1 * u}"`);
      } else if (z.kind === 'park') {
        const R = [q(-h, z.sb), q(h, z.sb), q(h, z.D), q(-h, z.D)];
        s += poly(R, `fill="#dfe7ef" stroke="${c}" stroke-width="${0.7 * u}"`);
        // 경사 표시(가로줄) + 가운데 선 + 들어감·나옴 화살표
        for (let t = z.sb + 2; t < z.D - 0.5; t += 2) { const l = q(-h + 0.5, t), r2 = q(h - 0.5, t); s += `<line x1="${X(l[0])}" y1="${Y(l[1])}" x2="${X(r2[0])}" y2="${Y(r2[1])}" stroke="${c}" stroke-width="${0.25 * u}" opacity=".6"/>`; }
        { const a2 = q(0, z.sb), b2 = q(0, z.D); s += `<line x1="${X(a2[0])}" y1="${Y(a2[1])}" x2="${X(b2[0])}" y2="${Y(b2[1])}" stroke="${c}" stroke-width="${0.4 * u}" stroke-dasharray="${2 * u} ${1.5 * u}"/>`; }
        [[-h / 2, z.sb + 1, z.D - 2], [h / 2, z.D - 2, z.sb + 1]].forEach(([x, t1, t2]) => { const f = q(x, t1), tt = q(x, t2); s += `<line x1="${X(f[0])}" y1="${Y(f[1])}" x2="${X(tt[0])}" y2="${Y(tt[1])}" stroke="${c}" stroke-width="${0.9 * u}" marker-end="url(#arr)"/>`; });
      } else {
        s += poly([q(-h, 0), q(h, 0), q(h, z.D), q(-h, z.D)], `fill="#fbecd9" stroke="${c}" stroke-width="${0.6 * u}" stroke-dasharray="${2 * u} ${1.5 * u}"`);
      }
      // 이름표(도로 쪽 바깥)
      const lb = q(0, -9 * u), txt = z.kind === 'main' ? '주출입구(문주)' : z.kind === 'park' ? `주차장 출입구 · 경사로 ${fmt(z.rampL, 0)}m` : '부출입구(보행)';
      const fs = 6 * u, w = [...txt].reduce((a, ch) => a + (/[가-힣]/.test(ch) ? 1 : 0.62), 0) * fs + 4 * u;   // 한글은 글자 폭이 넓음
      s += `<rect x="${(+X(lb[0]) - w / 2).toFixed(2)}" y="${(+Y(lb[1]) - fs).toFixed(2)}" width="${w.toFixed(2)}" height="${(fs * 1.45).toFixed(2)}" rx="${fs * 0.3}" fill="${c}"/><text x="${X(lb[0])}" y="${(+Y(lb[1]) + fs * 0.12).toFixed(2)}" font-size="${fs}" text-anchor="middle" font-weight="700" fill="#fff">${esc(txt)}</text>`;
      const from = q(0, -4 * u), to = q(0, 0.5);
      s += `<line x1="${X(from[0])}" y1="${Y(from[1])}" x2="${X(to[0])}" y2="${Y(to[1])}" stroke="${c}" stroke-width="${1.2 * u}" marker-end="url(#arr)"/>`;
    });
    // 변 성격 색 띠(바깥쪽)
    E.forEach((e, i) => {
      const t = TAG[o.tags[i]] || TAG.boundary, off = 2.2 * u;
      s += `<line x1="${X(e.a[0] + e.out[0] * off)}" y1="${Y(e.a[1] + e.out[1] * off)}" x2="${X(e.b[0] + e.out[0] * off)}" y2="${Y(e.b[1] + e.out[1] * off)}" stroke="${t.color}" stroke-width="${2.4 * u}" stroke-linecap="round" opacity=".85"/>`;
    });
    // 차량출입 불허구간(/urban 건축선·출입 계획) — 변 성격 띠 바깥에 굵은 검은 선 + 짧은 눈금(지구단위계획 표기 흉내)
    E.forEach((e, i) => { const be = o.bl && o.bl.edges ? o.bl.edges[i] : null; (be ? be.noCar : []).forEach(([t0, t1]) => {
      const off = 5 * u, at = t => [e.a[0] + (e.b[0] - e.a[0]) * t + e.out[0] * off, e.a[1] + (e.b[1] - e.a[1]) * t + e.out[1] * off], p0 = at(t0), p1 = at(t1);
      s += `<line x1="${X(p0[0])}" y1="${Y(p0[1])}" x2="${X(p1[0])}" y2="${Y(p1[1])}" stroke="#212529" stroke-width="${2.6 * u}"/>`;
      const step = Math.max(0.02, 6 * u / (e.len || 1)); for (let t = t0; t <= t1 + 1e-9; t += step) { const q = at(t), r = [q[0] + e.out[0] * 2.5 * u, q[1] + e.out[1] * 2.5 * u]; s += `<line x1="${X(q[0])}" y1="${Y(q[1])}" x2="${X(r[0])}" y2="${Y(r[1])}" stroke="#212529" stroke-width="${0.8 * u}"/>`; }
    }); });
    // 구역계(적색 일점쇄선)
    s += poly(pts, `fill="none" stroke="#c8322b" stroke-width="${1.6 * u}" stroke-dasharray="${9 * u} ${3 * u} ${2 * u} ${3 * u}"`);
    // 주동
    const A = o.alt;
    (A ? A.buildings : []).forEach(b => {
      // 형태 공통: 바깥선만 보이게(굵은 선을 먼저 그리고 같은 도형을 선 없이 덮음) → 코어·세대 경계
      const parts = b.parts || [b.poly], fill = TYPE_FILL[b.t] || '#eee';
      parts.forEach(q => { s += poly(q, `fill="${fill}" stroke="#1d2a33" stroke-width="${1.8 * u}" stroke-linejoin="round"`); });
      parts.forEach(q => { s += poly(q, `fill="${fill}" stroke="none"`); });
      (b.units || []).forEach(rs => unitOutline(rs).forEach(q => { s += poly(q, `fill="none" stroke="#1d2a33" stroke-width="${0.4 * u}" opacity=".75"`); }));
      (b.divs || []).forEach(l => { s += `<line x1="${X(l[0][0])}" y1="${Y(l[0][1])}" x2="${X(l[1][0])}" y2="${Y(l[1][1])}" stroke="#1d2a33" stroke-width="${0.35 * u}" opacity=".7"/>`; });
      (b.cores || []).forEach(q => { s += poly(q, `fill="#ffffff" stroke="#1d2a33" stroke-width="${0.5 * u}" opacity=".95"`); });
      const cxy = b.center || [b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length, b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length];
      const cx = cxy[0], cy = cxy[1];
      let ang = -(b.angle || 0); if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      const fs = Math.max(5 * u, Math.min(Math.min(b.D, b.L) * 0.22, 8.5 * u));
      s += `<g transform="translate(${X(cx)},${Y(cy)}) rotate(${ang.toFixed(1)})"><text text-anchor="middle" y="${-fs * 0.15}" font-size="${fs}" font-weight="700" fill="#1d2a33">${b.id}동</text><text text-anchor="middle" y="${fs * 0.95}" font-size="${fs * 0.72}" fill="#33424b">${b.floors}F · ${b.t}㎡×${b.n}</text></g>`.replace('<text', `<rect x="${-fs * 2.3}" y="${-fs * 1.05}" width="${fs * 4.6}" height="${fs * 2.35}" rx="${fs * 0.3}" fill="#fff" opacity=".72"/><text`);
    });
    // 치수선: 실제 / 기준(초록 통과 · 빨강 위반 · 주황 권고 · 회색 참고). 이름표는 겹치지 않게 아래로 밀어 놓음
    if (o.dims && o.dims.length) {
      const DC = { 통과: '#1a7f37', 위반: '#d00', 권고: '#e07000', 참고: '#777' }, TAGN = { spacing: '인동', sun: '일조', window: '채광', corridor: '통경', corner: '모서리', privacy: '시선' }, boxes = [];
      o.dims.forEach(d => {
        const c = DC[d.판정] || '#777', a = d.a, b = d.b, dx = b[0] - a[0], dy = b[1] - a[1], Ln = Math.hypot(dx, dy) || 1, ux = dx / Ln, uy = dy / Ln, px = -uy, py = ux, t = 2.6 * u;
        s += `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="${c}" stroke-width="${0.9 * u}"${d.kind === 'corridor' || d.kind === 'corner' || d.kind === 'privacy' ? ` stroke-dasharray="${3 * u} ${2 * u}"` : ''}/>`;
        [a, b].forEach((q, k) => { const sg = k ? -1 : 1; s += `<polygon points="${P(q)} ${P([q[0] + sg * ux * 4 * u + px * 1.6 * u, q[1] + sg * uy * 4 * u + py * 1.6 * u])} ${P([q[0] + sg * ux * 4 * u - px * 1.6 * u, q[1] + sg * uy * 4 * u - py * 1.6 * u])}" fill="${c}"/><line x1="${X(q[0] - px * t)}" y1="${Y(q[1] - py * t)}" x2="${X(q[0] + px * t)}" y2="${Y(q[1] + py * t)}" stroke="${c}" stroke-width="${0.7 * u}"/>`; });
        const txt = `${TAGN[d.kind] || ''} ${d.글}`, fs = 5.2 * u, w = txt.length * fs * 0.56 + 3 * u;
        let mx = +X((a[0] + b[0]) / 2), my = +Y((a[1] + b[1]) / 2), g = 0;
        while (boxes.some(r => Math.abs(r[0] - mx) < (r[2] + w) / 2 && Math.abs(r[1] - my) < fs * 1.5) && g++ < 10) my += fs * 1.5;
        boxes.push([mx, my, w]);
        s += `<g><title>${esc(d.근거 || '')}</title><rect x="${(mx - w / 2).toFixed(2)}" y="${(my - fs * 0.9).toFixed(2)}" width="${w.toFixed(2)}" height="${(fs * 1.3).toFixed(2)}" rx="${fs * 0.25}" fill="#fff" stroke="${c}" stroke-width="${0.4 * u}" opacity=".93"/><text x="${mx.toFixed(2)}" y="${(my + fs * 0.1).toFixed(2)}" font-size="${fs}" text-anchor="middle" font-weight="700" fill="${c}">${esc(txt)}</text></g>`;
      });
    }
    // 출입구
    (o.gates && o.gates.length ? [] : (o.entries || [])).forEach(en => {
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
    {
      let gx = sx, gy = ly - 11 * u; const it = (sw, nm) => { s += sw(gx, gy) + `<text x="${gx + 15 * u}" y="${gy + 2.3 * u}" font-size="${6.5 * u}">${nm}</text>`; gx += 20 * u + nm.length * 6.6 * u; };
      if ((o.tags || []).some(t => t === 'road' || t === 'arterial')) it((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 12 * u}" y2="${y}" stroke="#c2255c" stroke-width="${1.1 * u}" stroke-dasharray="${4 * u} ${2 * u}"/>`, '건축한계선');
      if (((o.bl && o.bl.edges) || []).some(b => b && b.noCar.length)) it((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 12 * u}" y2="${y}" stroke="#212529" stroke-width="${2.4 * u}"/>`, '차량출입 불허구간');
      if (o.spine) it((x, y) => `<rect x="${x}" y="${y - 3 * u}" width="${12 * u}" height="${6 * u}" fill="#dee2e6" stroke="#868e96" stroke-width="${0.5 * u}"/>`, '단지 안 비상차로');
      if ((o.fire || []).some(f => f.ok)) it((x, y) => `<rect x="${x}" y="${y - 3 * u}" width="${12 * u}" height="${6 * u}" fill="url(#fireHatch)" stroke="#e8a400" stroke-width="${0.6 * u}"/>`, '소방차 전용구역');
      if (((o.bl && o.bl.keep) || []).some(k => k.kind === 'walk')) it((x, y) => `<rect x="${x}" y="${y - 3 * u}" width="${12 * u}" height="${6 * u}" fill="#d0ebff" stroke="#1c7ed6" stroke-width="${0.6 * u}"/>`, '공공보행통로');
      if (((o.bl && o.bl.keep) || []).some(k => k.kind === 'open')) it((x, y) => `<rect x="${x}" y="${y - 3 * u}" width="${12 * u}" height="${6 * u}" fill="#ffdeeb" stroke="#d6336c" stroke-width="${0.6 * u}"/>`, '공개공지');
      [...new Set((o.gates || []).map(z => z.kind))].forEach(k => it((x, y) => `<rect x="${x}" y="${y - 3 * u}" width="${12 * u}" height="${6 * u}" fill="${{ main: '#f4e7d8', park: '#dfe7ef', sub: '#fbecd9' }[k]}" stroke="${GC[k]}" stroke-width="${0.6 * u}"/>`, { main: '주출입구(문주·진입광장, 건축 불가)', park: '지하주차장 경사로(건축 불가)', sub: '부출입구' }[k]));
    }
    if (o.sunGrid) s += `<rect x="${lx + 50 * u}" y="${ly - 3 * u}" width="${6 * u}" height="${6 * u}" fill="#d9483b" opacity=".5"/><text x="${lx + 59 * u}" y="${ly + 2.3 * u}" font-size="${6.5 * u}">동지 일조 수인한도 ${o.context && o.context.length ? '새로 ' : ''}미달(판례 기준 참고)${o.context && o.context.length ? ' · 붉은 테 건물: 영향 받는 주변 주택' : ''}</text>`;
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
  const FN = { slab: '판상형', tower: '탑상형', Y: 'Y형', L: 'ㄱ형', court: 'ㅁ형(중정형)' };
  function floorPlan(b, U, coreW) {
    if (b.local && b.form) {
      const lc = b.local, S = Math.min(7, 420 / Math.max(lc.L, lc.D)), pad = 16, W = lc.L * S + pad * 2, H = lc.D * S + pad * 2 + 14;
      const P = p => `${(p[0] * S).toFixed(1)},${((lc.D - p[1]) * S).toFixed(1)}`;
      let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif"><rect width="100%" height="100%" fill="#fbfbf8"/><g transform="translate(${pad},${pad + 8})" font-size="9" fill="#1d2a33">`;
      lc.parts.forEach(q => { s += `<polygon points="${q.map(P).join(' ')}" fill="${TYPE_FILL[b.t] || '#eee'}" stroke="#1d2a33" stroke-width="2"/>`; });
      lc.parts.forEach(q => { s += `<polygon points="${q.map(P).join(' ')}" fill="${TYPE_FILL[b.t] || '#eee'}"/>`; });
      (lc.units || []).forEach(rs => { unitOutline(rs).forEach(q => { s += `<polygon points="${q.map(P).join(' ')}" fill="none" stroke="#1d2a33" stroke-width="1"/>`; }); const all = rs.flat(), cx = all.reduce((a, p) => a + p[0], 0) / all.length, cy = all.reduce((a, p) => a + p[1], 0) / all.length; s += `<text x="${(cx * S).toFixed(1)}" y="${((lc.D - cy) * S + 3).toFixed(1)}" text-anchor="middle" font-size="8.5">${b.t}㎡</text>`; });
      lc.divs.forEach(l => { s += `<line x1="${P(l[0]).split(',')[0]}" y1="${P(l[0]).split(',')[1]}" x2="${P(l[1]).split(',')[0]}" y2="${P(l[1]).split(',')[1]}" stroke="#1d2a33" stroke-width=".8"/>`; });
      lc.cores.forEach(q => { const c = q.reduce((a, p) => [a[0] + p[0] / q.length, a[1] + p[1] / q.length], [0, 0]); s += `<polygon points="${q.map(P).join(' ')}" fill="#fff" stroke="#1d2a33"/><text x="${(c[0] * S).toFixed(1)}" y="${((lc.D - c[1]) * S + 3).toFixed(1)}" text-anchor="middle" font-size="7.5">코어</text>`; });
      s += `<text x="0" y="-6" font-size="10" font-weight="700">${FN[b.form] || ''} ${b.t}㎡ ${b.n}호 조합(평면 라이브러리${b.vname ? ' · ' + esc(b.vname) + ' 평면' : ''}) · ${lc.L.toFixed(1)}m × ${lc.D.toFixed(1)}m · 위 북 / 아래 남</text>`;
      return s + '</g></svg>';
    }
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
