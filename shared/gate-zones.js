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
  const ROAD = { w: 7, basis: '주택건설기준 등에 관한 규정 제26조 — 단지 안 도로 폭 7m 이상(보도 1.5m 포함)' };
  const inPoly = (x, y, P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  const sDist = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
  const band = (a, b, w) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, n = [-(b[1] - a[1]) / L * w / 2, (b[0] - a[0]) / L * w / 2]; return [[a[0] + n[0], a[1] + n[1]], [b[0] + n[0], b[1] + n[1]], [b[0] - n[0], b[1] - n[1]], [a[0] - n[0], a[1] - n[1]]]; };
  function spine(pts, zs, w) {
    const m = (zs || []).find(z => z.kind === 'main'); if (!m || !pts || pts.length < 3) return null;
    const W = +w > 0 ? +w : ROAD.w, st = m.q(0, m.D), n = m.n;
    const c = pts.reduce((o, p) => [o[0] + p[0] / pts.length, o[1] + p[1] / pts.length], [0, 0]);
    const want = (c[0] - st[0]) * n[0] + (c[1] - st[1]) * n[1];
    const E = pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
    let L = 0; for (let t = 1; t <= Math.max(0, want) + 0.5; t += 1) { const p = [st[0] + n[0] * t, st[1] + n[1] * t]; if (!inPoly(p[0], p[1], pts) || E.some(([a, b]) => sDist(p, a, b) < 5)) break; L = t; }
    if (L < 10) return null;
    const en = [st[0] + n[0] * L, st[1] + n[1] * L];
    return { kind: 'road', a: st, b: en, len: L, w: W, poly: band(st, en, W), keep: band(st, en, W + 2), basis: ROAD.basis };   // keep: 배치 엔진 1m 격자 여유
  }
  // ── 소방자동차 전용구역(2026-11-10): 동마다 전면 또는 후면에 1개소 이상 — 소방기본법 시행령 제7조의13(대상 제7조의12: 100세대 이상 아파트)
  //  크기 6×15m·외벽에서 6~15m는 실무 가정값(별표 2의5 그림·지침 기준, 바꿀 수 있음). 배치가 끝난 뒤 동마다 들어갈 자리를 찾아 그림·검토서에 씀
  //  blds[i] = { id, poly | parts }, block = 패드가 들어가면 안 되는 땅(공원 등), 패드는 다른 동·구역 밖과 겹치면 안 됨
  function firePads(pts, blds, block, o) {
    const P = Object.assign({ w: 6, l: 15, d0: 6, d1: 15 }, o || {}), parts = b => (b.parts && b.parts.length ? b.parts : [b.poly]).filter(Boolean);
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
            if (all.some(ps => ps.some(Rr => Rr.some(p => inPoly(p[0], p[1], pad))))) continue;
            if (!best || d < best.d) best = { d, pad };
            return;
          }
        });
      });
      return { id: b.id, ok: !!best, d: best ? best.d : null, pad: best ? best.pad : null };
    });
  }
  const FIRE = { basis: '소방기본법 시행령 제7조의12(100세대 이상 아파트)·제7조의13(각 동 전면 또는 후면 1개소 이상, 한 곳에서 여러 동 소방활동이 되면 생략 가능)', size: '6×15m·외벽에서 6~15m(가정값)' };
  const api = { DEF, NAME, BASIS, params, rampLen, size, zone, nearestEdge, build, keepPoly, ROAD, spine, firePads, FIRE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.GateZones = api;
})(typeof self !== 'undefined' ? self : this);
