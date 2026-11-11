'use strict';
/* 단지 출입구가 차지하는 땅(건축 불가) — /arch 배치·배치도와 /urban 4탭 개략 배치가 같이 씀 (2026-11-08)
 * 사용자 요구: 정비계획·지구단위계획은 건축한계선을 두고, 거기에 주출입구·차량출입구도 공간을 차지하니 그 자리에는 동이 못 들어서야 함.
 * 출입구마다 경계에서 안쪽으로 직사각형 하나(경계 → 건축한계선 → 그 안쪽 깊이):
 *  - 주출입구: 문주 + 진입광장 + 단지 진입로. 폭·깊이는 실무 가정값(입력으로 바꿈)
 *  - 주차장 출입구: 지하주차장 경사로. 주차장법 시행규칙 제6조제1항제5호(부설주차장은 제11조제1항으로 준용) —
 *    경사로 차로 너비 직선 1차로 3.3m·2차로 6m 이상, 종단경사도 직선 17%·곡선 14% 이하. 길이 = 지하 1층 바닥까지 높이 ÷ 17% + 양 끝 완화구간(가정)
 *    폭 7m = 2차로 6m + 양쪽 벽체·연석(가정)
 *  - 부출입구: 보행·비상 출입(가정)
 * 좌표: 구역을 미터 평면으로 바꾼 좌표(ArchGeom.projector). e = ArchGeom.edges의 한 변 {a, b, out, len}
 */
(function (g) {
  const DEF = { mainW: 15, mainD: 20, subW: 6, subD: 6, rampW: 7, rampH: 3.6, rampSlope: 0.17, rampEase: 6 };
  const NAME = { main: '주출입구', sub: '부출입구', park: '주차장 출입구' };
  const BASIS = {
    main: '문주·진입광장·단지 진입로 폭·깊이는 실무 가정값(교통영향평가·건축심의에서 확정)',
    sub: '보행·비상 출입 폭은 실무 가정값',
    park: '주차장법 시행규칙 제6조제1항제5호(제11조제1항 준용) — 경사로 2차로 6m 이상, 직선 종단경사 17% 이하. 완화구간·벽체 폭은 가정값',
  };
  const num = (v, d) => (v === '' || v === undefined || v === null || isNaN(+v) ? d : +v);
  function params(P) { const o = {}; Object.keys(DEF).forEach(k => { o[k] = num((P || {})[k], DEF[k]); }); return o; }
  const rampLen = P => { P = params(P); return P.rampH / Math.max(0.05, P.rampSlope) + P.rampEase; };
  function size(kind, P) {
    P = params(P);
    if (kind === 'main') return { w: P.mainW, d: P.mainD };
    if (kind === 'park') return { w: P.rampW, d: rampLen(P) };
    return { w: P.subW, d: P.subD };
  }
  // 한 출입구의 땅. m = 경계 위 점, sb = 그 변의 건축한계선(경계 이격) 거리
  function zone(kind, m, e, sb, P) {
    const k = NAME[kind] ? kind : 'sub', { w, d } = size(k, P), h = w / 2, s = Math.max(0, +sb || 0), D = s + d;
    const u = [(e.b[0] - e.a[0]) / (e.len || 1), (e.b[1] - e.a[1]) / (e.len || 1)], n = [-e.out[0], -e.out[1]];
    // 변 양 끝을 넘지 않게 가운데를 당김(변이 폭보다 짧으면 변 가운데)
    let tm = (m[0] - e.a[0]) * u[0] + (m[1] - e.a[1]) * u[1];
    tm = e.len > w ? Math.min(e.len - h, Math.max(h, tm)) : e.len / 2;
    const c = [e.a[0] + u[0] * tm, e.a[1] + u[1] * tm];
    const q = (a, t) => [c[0] + u[0] * a + n[0] * t, c[1] + u[1] * a + n[1] * t];
    return { kind: k, name: NAME[k], c, u, n, w, d, sb: s, D, poly: [q(-h, 0), q(h, 0), q(h, D), q(-h, D)], q, basis: BASIS[k], rampL: k === 'park' ? d : 0 };
  }
  // 점 q에서 가장 가까운 변(경계에 다시 붙이기) → { edge, t, d }
  function nearestEdge(E, q) {
    let best = null;
    E.forEach((e, i) => {
      const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((q[0] - e.a[0]) * dx + (q[1] - e.a[1]) * dy) / L2));
      const d = Math.hypot(q[0] - (e.a[0] + dx * t), q[1] - (e.a[1] + dy * t));
      if (!best || d < best.d) best = { edge: i, t, d };
    });
    return best;
  }
  // 여러 출입구 → 땅 목록. list = [{kind, edge, t}], setbacks = 변별 건축한계선 거리
  function build(E, list, setbacks, P) {
    return (list || []).map(en => {
      const e = E[en.edge]; if (!e) return null;
      const m = [e.a[0] + (e.b[0] - e.a[0]) * en.t, e.a[1] + (e.b[1] - e.a[1]) * en.t];
      return Object.assign(zone(en.kind, m, e, (setbacks || [])[en.edge] || 0, P), { edge: en.edge, t: en.t, label: en.label || NAME[en.kind] || '출입구' });
    }).filter(Boolean);
  }
  // 배치 엔진에 넘길 땅: 엔진이 1m 격자로 어림해 동이 1m 안쪽으로 걸칠 수 있어 옆·안쪽 끝을 m(기본 1m)씩 넓힘 — 그림·면적은 z.poly 그대로
  const keepPoly = (z, m = 1) => { const h = z.w / 2 + m; return [z.q(-h, -m), z.q(h, -m), z.q(h, z.D + m), z.q(-h, z.D + m)]; };
  // ── 단지 안 비상차로(2026-11-10): 주출입구 진입광장 끝에서 구역 안쪽(중심 쪽)으로 곧게 이어지는 차로 — 소방차·이사차·택배차 동선
  //  폭 7m(보도 1.5m 포함) — 주택건설기준 등에 관한 규정 제26조(주택단지 안의 도로). 지상 차 없는 단지라도 비상차로는 필요
  //  길이: 진입광장 끝 → 구역 중심을 지나는 지점까지(중심이 옆으로 비껴 있으면 그 투영점까지), 경계 5m 앞에서 멈춤. 10m 미만이면 없음
  const ROAD = { w: 6, basis: '비상차로 폭 6m(소방차 통행, 실무 가정) — 단지 안 일반 도로는 주택건설기준 등에 관한 규정 제26조 폭 7m 이상(보도 1.5m 포함)' };
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const sDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
  const band = (a, b, w) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L * w / 2, (b[0] - a[0]) / L * w / 2]; return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]; };
  // 다각형 안쪽 띄우기(반시계 방향 꼭짓점 기준, 볼록·완만한 오목형에 맞음) — 뒤집힌 변은 지워 가며 다시 계산. 실패하면 null
  const area = P => P.reduce((m, p, i) => { const q = P[(i + 1) % P.length]; return m + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
  function inset(pts, d) {
    let P = area(pts) < 0 ? pts.slice().reverse() : pts.slice();
    for (let it = 0; it < 12 && P.length >= 3; it++) {
      const L = P.map((a, i) => { const b = P[(i + 1) % P.length], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len], n = [-u[1], u[0]]; return { p: [a[0] + n[0] * d, a[1] + n[1] * d], u, a, b }; });
      const V = L.map((l1, i) => { const l0 = L[(i - 1 + L.length) % L.length], den = l0.u[0] * l1.u[1] - l0.u[1] * l1.u[0];
        if (Math.abs(den) < 1e-9) return l1.p; const t = ((l1.p[0] - l0.p[0]) * l1.u[1] - (l1.p[1] - l0.p[1]) * l1.u[0]) / den; return [l0.p[0] + l0.u[0] * t, l0.p[1] + l0.u[1] * t]; });
      const flip = L.findIndex((l, i) => { const a = V[i], b = V[(i + 1) % V.length]; return (b[0] - a[0]) * l.u[0] + (b[1] - a[1]) * l.u[1] <= 0.5; });
      if (flip < 0) return area(V) > 0 && V.every(v => inPoly(v[0], v[1], pts)) ? V : null;
      P = P.filter((_, i) => i !== flip);   // 뒤집힌(사라질) 변을 빼고 다시
    }
    return null;
  }
  // 단지 안 비상차로 — 순환형(기본): 경계에서 dRing 안쪽을 한 바퀴 도는 차로 + 주출입구 진입광장에서 그 차로까지 잇는 연결로.
  //  dRing 기본 35m = 경계 이격·동 깊이(약 20m)·외벽~차로(소방차 전용구역 6~15m)를 둔 바깥 줄 한 겹(가정). 안쪽 땅이 좁아 순환이 안 되면 28m로 한 번 더, 그래도 안 되면 곧은형
  //  곧은형: 진입광장 끝 → 구역 중심 쪽으로 곧게. 돌려주는 값: { kind:'loop'|'line', w, len, segs:[[a,b]] 가운데선, polys(그림), keepPolys(배치 엔진, +2m), poly·keep(첫 조각, 예전 호환) }
  function spine(pts, zs, w, opt) {
    const o = Object.assign({ type: 'loop', dRing: 35 }, opt || {});
    const m = (zs || []).find(z => z.kind === 'main'); if (!m || !pts || pts.length < 3 || o.type === 'none') return null;
    const W = +w > 0 ? +w : ROAD.w, st = m.q(0, m.D), n = m.n;
    const pack = (kind, segs) => { const polys = segs.map(([a, b]) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], e = kind === 'loop' ? W / 2 : 0; return band([a[0] - u[0] * e, a[1] - u[1] * e], [b[0] + u[0] * e, b[1] + u[1] * e], W); });
      const keepPolys = segs.map(([a, b]) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], e = W / 2 + 1; return band([a[0] - u[0] * e, a[1] - u[1] * e], [b[0] + u[0] * e, b[1] + u[1] * e], W + 2); });
      const len = segs.reduce((t, [a, b]) => t + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
      return { kind, w: W, len, segs, polys, keepPolys, poly: polys[0], keep: keepPolys[0], a: segs[0][0], b: segs[0][1], basis: ROAD.basis }; };
    if (o.type === 'loop') for (const d of [o.dRing, o.dRing * 0.8]) {
      const R = inset(pts, d); if (!R || area(R) < 3000) continue;
      const inner = inset(R, 25); if (!inner || area(inner) < 400) continue;   // 차로 안쪽에도 동 한 줄은 들어가야 순환형 의미가 있음
      // 진입광장 끝에서 가장 가까운 차로 가운데선 위의 점
      let best = null; R.forEach((a, i) => { const b = R[(i + 1) % R.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((st[0] - a[0]) * dx + (st[1] - a[1]) * dy) / L2)), q = [a[0] + dx * t, a[1] + dy * t], dd = Math.hypot(q[0] - st[0], q[1] - st[1]); if (!best || dd < best.d) best = { q, d: dd }; });
      const segs = R.map((a, i) => [a, R[(i + 1) % R.length]]);
      if (best && best.d > 1) segs.unshift([st, best.q]);
      return pack('loop', segs);
    }
    const c = pts.reduce((q, p) => [q[0] + p[0] / pts.length, q[1] + p[1] / pts.length], [0, 0]);
    const want = (c[0] - st[0]) * n[0] + (c[1] - st[1]) * n[1];
    const E = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
    let L = 0; for (let t = 1; t <= Math.max(0, want) + 0.5; t += 1) { const p = [st[0] + n[0] * t, st[1] + n[1] * t]; if (!inPoly(p[0], p[1], pts) || E.some(([a, b]) => sDist(p, a, b) < 5)) break; L = t; }
    if (L < 10) return null;
    return pack('line', [[st, [st[0] + n[0] * L, st[1] + n[1] * L]]]);
  }
  // ── 소방자동차 전용구역(2026-11-10): 동마다 전면 또는 후면에 1개소 이상 — 소방기본법 시행령 제7조의13(대상 제7조의12: 100세대 이상 아파트)
  //  크기 6×15m·외벽에서 6~15m는 실무 가정값(별표 2의5 그림·지침 기준, 바꿀 수 있음). 배치가 끝난 뒤 동마다 들어갈 자리를 찾아 그림·검토서에 씀
  //  blds[i] = { id, poly | parts }, block = 패드가 들어가면 안 되는 땅(공원 등), 패드는 다른 동·구역 밖과 겹치면 안 됨
  //  o.roads = 비상차로 가운데선 [[a,b]]·o.roadW — 있으면 차로에 붙은 자리를 먼저 고름(onRoad)
  function firePads(pts, blds, block, o) {
    const P = Object.assign({ w: 6, l: 15, d0: 6, d1: 15, roads: [], roadW: 7 }, o || {}), nearRoad = q => (P.roads || []).some(([a, b]) => sDist(q, a, b) <= P.roadW / 2 + P.w / 2 + 1), parts = b => (b.parts && b.parts.length ? b.parts : [b.poly]).filter(Boolean);
    const all = (blds || []).map(b => parts(b)), bad = q => !inPoly(q[0], q[1], pts) || (block || []).some(B => inPoly(q[0], q[1], B)) || all.some(ps => ps.some(R => inPoly(q[0], q[1], R)));
    return (blds || []).map((b, bi) => {
      let best = null;
      parts(b).forEach(R => {
        const cx = R.reduce((m, p) => m + p[0] / R.length, 0), cy = R.reduce((m, p) => m + p[1] / R.length, 0);
        R.forEach((a, i) => {
          const bb = R[(i + 1) % R.length], L = Math.hypot(bb[0] - a[0], bb[1] - a[1]); if (L < 8) return;
          const u = [(bb[0] - a[0]) / L, (bb[1] - a[1]) / L]; let n = [-u[1], u[0]];
          if (((a[0] + bb[0]) / 2 - cx) * n[0] + ((a[1] + bb[1]) / 2 - cy) * n[1] < 0) n = [-n[0], -n[1]];   // 바깥쪽
          for (let d = P.d0; d <= P.d1 - P.w + 1e-6; d += 1.5) for (const f of [0.5, 0.25, 0.75, 0]) {
            const s0 = f * Math.max(0, L - P.l), q = (x, y) => [a[0] + u[0] * (s0 + x) + n[0] * (d + y), a[1] + u[1] * (s0 + x) + n[1] * (d + y)];
            const pad = [q(0, 0), q(P.l, 0), q(P.l, P.w), q(0, P.w)], probe = [...pad, q(P.l / 2, P.w / 2), q(P.l / 2, 0), q(P.l / 2, P.w), q(0, P.w / 2), q(P.l, P.w / 2)];
            if (probe.some(bad)) continue;
            if (P.reach && !P.reach(q(P.l / 2, P.w / 2))) continue;   // 주출입구에서 차로로 못 닿는 자리는 안 됨
            if (all.some(ps => ps.some(Rr => Rr.some(p => inPoly(p[0], p[1], pad))))) continue;
            const on = nearRoad(q(P.l / 2, P.w / 2));
            if (!best || (on && !best.on) || (on === best.on && d < best.d)) best = { d, pad, on };
            if (on || !(P.roads || []).length) return;   // 차로에 붙은 자리를 찾았거나 차로가 없으면 이 변은 끝
          }
        });
      });
      return { id: b.id, ok: !!best, d: best ? best.d : null, pad: best ? best.pad : null, onRoad: !!(best && best.on) };
    });
  }
  // ── 단지 안 비상차로 잇기(2026-11-11): 동 배치가 끝난 뒤 빈 땅(동 사이 인동간격)으로 주출입구 → 동마다 소방차 전용구역 → 주출입구를 한 바퀴 잇는 순환형 길을 찾음
  //  땅을 미리 떼지 않음(실제 단지도 비상차로는 동 사이 빈 땅을 지나감 — 미리 떼면 세대수가 30% 넘게 줄어 실제와 다름). 못 닿는 동은 '연결 안 됨'으로 알림
  //  2m 격자, 차로 가운데가 동 외벽에서 반폭+1m(격자 대각선 여유)·구역 경계에서 반폭 이상, block(공원 등)은 지나지 않음. 돌려주는 값 { kind:'route', w, len, segs, polys, path:[[x,y]...], miss:[동 id] }
  function roadGrid(pts, blds, P) {
    const g = P.g, cl = P.w / 2 + 1, parts = (blds || []).flatMap(b => (b.parts && b.parts.length ? b.parts : [b.poly]).filter(Boolean));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / g) + 1, ny = Math.ceil((Math.max(...ys) - y0) / g) + 1;
    const E = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]), PE = parts.map(R => R.map((p, i) => [p, R[(i + 1) % R.length]]));
    const free = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * g, y = y0 + j * g;
      if (!inPoly(x, y, pts) || E.some(([a, b]) => sDist([x, y], a, b) < P.w / 2)) continue;
      if ((P.block || []).some(B => inPoly(x, y, B))) continue;
      if (parts.some((R, k) => inPoly(x, y, R) || PE[k].some(([a, b]) => sDist([x, y], a, b) < cl))) continue;
      free[j * nx + i] = 1;
    }
    return { g, nx, ny, x0, y0, free };
  }
  // 주출입구에서 차로로 닿을 수 있는 칸 → 점 q 가까이(8m 안)에 닿는 칸이 있는가(소방차 자리 고를 때 씀)
  function reach(pts, blds, zs, o) {
    const P = Object.assign({ w: ROAD.w, g: 2, block: [] }, o || {}), m = (zs || []).find(z => z.kind === 'main');
    if (!m || !pts || pts.length < 3) return null;
    const { g, nx, ny, x0, y0, free } = roadGrid(pts, blds || [], P), seen = new Uint8Array(nx * ny);
    const [si, sj] = [Math.round((m.q(0, m.D)[0] - x0) / g), Math.round((m.q(0, m.D)[1] - y0) / g)];
    let st = null; for (let r = 0; r <= 12 && !st; r++) for (let dj = -r; dj <= r && !st; dj++) for (let di = -r; di <= r; di++) { const i = si + di, j = sj + dj; if (i >= 0 && j >= 0 && i < nx && j < ny && free[j * nx + i]) { st = j * nx + i; break; } }
    if (st === null) return () => false;
    const q = [st]; seen[st] = 1;
    while (q.length) { const k = q.pop(), ci = k % nx, cj = k / nx | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const kk = j * nx + i; if (free[kk] && !seen[kk]) { seen[kk] = 1; q.push(kk); } } }
    return p => { const ci = Math.round((p[0] - x0) / g), cj = Math.round((p[1] - y0) / g); for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < nx && j < ny && seen[j * nx + i]) return true; } return false; };
  }
  function routeRoad(pts, blds, zs, o) {
    const P = Object.assign({ w: ROAD.w, g: 2, pads: [], block: [] }, o || {}), m = (zs || []).find(z => z.kind === 'main');
    if (!m || !pts || pts.length < 3 || !(blds || []).length) return null;
    const { g, nx, ny, x0, y0, free } = roadGrid(pts, blds, P);
    const cell = q => [Math.round((q[0] - x0) / g), Math.round((q[1] - y0) / g)], pt = (i, j) => [x0 + i * g, y0 + j * g];
    const snap = q => { const [ci, cj] = cell(q); let best = null; for (let r = 0; r <= 12 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny || !free[j * nx + i]) continue; const d = di * di + dj * dj; if (!best || d < best.d) best = { i, j, d }; } return best ? [best.i, best.j] : null; };
    // A*(8방향) — 같은 칸 다시 쓰면 비용 낮춤(이미 놓인 차로를 따라가게 → 갈래를 줄임)
    const used = new Uint8Array(nx * ny);
    const astar = (s0, t0) => {
      const N = nx * ny, gS = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), open = [[0, s0[1] * nx + s0[0]]], T = t0[1] * nx + t0[0];
      gS[open[0][1]] = 0; const h = k => Math.hypot(k % nx - t0[0], (k / nx | 0) - t0[1]);
      while (open.length) {
        let bi = 0; for (let k = 1; k < open.length; k++) if (open[k][0] < open[bi][0]) bi = k;
        const [, cur] = open.splice(bi, 1)[0]; if (cur === T) break;
        const ci = cur % nx, cj = cur / nx | 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= nx || j >= ny) continue; const k = j * nx + i; if (!free[k]) continue;
          const c = gS[cur] + Math.hypot(di, dj) * (used[k] ? 0.4 : 1); if (c < gS[k]) { gS[k] = c; from[k] = cur; open.push([c + h(k) * 0.4, k]); } }
        if (open.length > 60000) break;
      }
      if (from[T] < 0 && s0[1] * nx + s0[0] !== T) return null;
      const out = []; for (let k = T; k >= 0; k = from[k]) { out.push(k); if (k === s0[1] * nx + s0[0]) break; } return out.reverse();
    };
    const S0 = snap(m.q(0, m.D)); if (!S0) return null;
    const c = pts.reduce((q, p) => [q[0] + p[0] / pts.length, q[1] + p[1] / pts.length], [0, 0]), ang = q => Math.atan2(q[1] - c[1], q[0] - c[0]);
    const a0 = ang(pt(S0[0], S0[1]));
    const tg = (P.pads || []).filter(f => f && f.ok && f.pad).map(f => ({ id: f.id, q: f.pad.reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]) }))
      .map(t => Object.assign(t, { a: ((ang(t.q) - a0) + 4 * Math.PI) % (2 * Math.PI) })).sort((x, y) => x.a - y.a);
    const path = [], miss = []; let cur = S0;
    tg.concat([{ id: null, q: pt(S0[0], S0[1]) }]).forEach(t => {
      const T = snap(t.q); const r = T && astar(cur, T);
      if (!r) { if (t.id) miss.push(t.id); return; }
      r.forEach(k => { used[k] = 1; }); path.push(...r.map(k => pt(k % nx, k / nx | 0))); cur = T;
    });
    // 성기게(같은 방향 점 빼기) → 조각
    const simp = []; path.forEach((p, i) => { const a = simp[simp.length - 2], b = simp[simp.length - 1]; if (a && b && Math.abs((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0])) < 1e-6) simp[simp.length - 1] = p; else if (!b || b[0] !== p[0] || b[1] !== p[1]) simp.push(p); });
    const seen = new Set(), segs = [];
    for (let i = 1; i < simp.length; i++) { const a = simp[i - 1], b = simp[i], k = [a, b].map(q => q.join(',')).sort().join('|'); if (seen.has(k) || Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5) continue; seen.add(k); segs.push([a, b]); }
    if (!segs.length) return miss.length ? { kind: 'route', w: P.w, len: 0, segs: [], polys: [], path: [], miss, basis: ROAD.basis } : null;
    const polys = segs.map(([a, b]) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], e = P.w / 2; return band([a[0] - u[0] * e, a[1] - u[1] * e], [b[0] + u[0] * e, b[1] + u[1] * e], P.w); });
    return { kind: 'route', w: P.w, len: segs.reduce((t, [a, b]) => t + Math.hypot(b[0] - a[0], b[1] - a[1]), 0), segs, polys, path: simp, miss, basis: ROAD.basis };
  }
  const FIRE = { basis: '소방기본법 시행령 제7조의12(100세대 이상 아파트)·제7조의13(각 동 전면 또는 후면 1개소 이상, 한 곳에서 여러 동 소방활동이 되면 생략 가능)', size: '6×15m·외벽에서 6~15m(가정값)' };
  const api = { DEF, NAME, BASIS, params, rampLen, size, zone, nearestEdge, build, keepPoly, ROAD, spine, firePads, FIRE, inset, routeRoad, reach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.GateZones = api;
})(typeof self !== 'undefined' ? self : this);
