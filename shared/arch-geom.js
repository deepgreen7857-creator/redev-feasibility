'use strict';
// 개략 배치 계산 엔진 — /arch(배치)와 /landscape(높이·경관)가 같이 씀. 화면 코드 없음(node 테스트 가능)
// 좌표: 구역 중심 기준 미터(x 동쪽, y 북쪽). 배치는 정면(남향) 기준 회전각 θ만큼 돌린 좌표계에서 줄(열) 단위로 놓음
(function (g) {
  const D2R = Math.PI / 180;

  /* ---------- 좌표 변환 ---------- */
  function projector(ring) {
    const lat0 = ring.reduce((s, c) => s + c[1], 0) / ring.length, lon0 = ring.reduce((s, c) => s + c[0], 0) / ring.length;
    const kx = Math.cos(lat0 * D2R) * 111320, ky = 110540;
    return {
      lat0, lon0,
      to: c => [(c[0] - lon0) * kx, (c[1] - lat0) * ky],
      back: p => [lon0 + p[0] / kx, lat0 + p[1] / ky],
    };
  }
  const rot = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const area = pts => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]; return a / 2; };
  const ccw = pts => (area(pts) < 0 ? pts.slice().reverse() : pts.slice());
  const openRing = r => (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) ? r.slice(0, -1) : r.slice();
  const inside = (x, y, pts) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; };
  const insideAny = (x, y, polys) => polys.some(p => inside(x, y, p));
  function segDist(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  }
  // 경계 변 목록과 바깥 방향(북쪽 판단용)
  function edges(pts) {
    const P = ccw(pts);
    return P.map((a, i) => { const b = P[(i + 1) % P.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return { i, a, b, len: L, out: [dy / L, -dx / L] }; });
  }

  /* ---------- 건축 가능 영역: 변별 이격을 반평면으로 잘라냄 ---------- */
  // 다각형 클리핑(Sutherland–Hodgman): 각 변을 안쪽으로 d만큼 민 선의 안쪽만 남김.
  // 오목한 구역은 반평면 교집합이 지나치게 깎일 수 있어, 변 근처(띠)만 빼는 방식으로 처리
  function clipHalf(poly, a, n, d) { // n: 안쪽 방향 단위벡터, 기준점 a + n*d 에서 n쪽 유지
    const keep = p => (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] >= d;
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], kp = keep(p), kq = keep(q);
      if (kp) out.push(p);
      if (kp !== kq) {
        const fp = (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] - d, fq = (q[0] - a[0]) * n[0] + (q[1] - a[1]) * n[1] - d, t = fp / (fp - fq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    return out;
  }
  // 띠 제외 판정: 점이 변 i에서 d_i 안쪽이면 건축 불가
  function buildableTest(pts, setbacks) {
    const E = edges(pts);
    return (x, y) => inside(x, y, pts) && E.every((e, i) => segDist([x, y], e.a, e.b) >= (setbacks[i] || 0) - 1e-6);
  }

  /* ---------- 줄 단위 배치 ---------- */
  // 회전 좌표계에서 [y0, y1] 띠 전체가 들어가는 x 구간들 (가로선 표본 + 경계 검사)
  function stripRanges(test, xmin, xmax, y0, y1, step = 1) {
    const ys = [y0, y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.5, y0 + (y1 - y0) * 0.75, y1];
    const out = []; let s = null;
    for (let x = xmin; x <= xmax; x += step) {
      const ok = ys.every(y => test(x, y));
      if (ok && s === null) s = x;
      if ((!ok || x + step > xmax) && s !== null) { const e = ok ? x : x - step; if (e - s > 1) out.push([s, e]); s = null; }
    }
    return out;
  }
  // 판상 동 모듈: 평면 t, 층당 세대 n(2·4·6) → 길이·깊이
  const slab = (U, coreW, t, n) => ({ t, n, L: n * U[t].폭 + (n / 2) * coreW, D: U[t].깊이 });

  function layout(site, opt) {
    const U = opt.units, A = opt.assume, mix = opt.mix; // mix: {59:비율,...}
    const types = Object.keys(mix).filter(t => mix[t] > 0 && U[t]);
    if (!types.length) throw new Error('평형 비율이 모두 0입니다');
    const th = (opt.angle || 0) * D2R;
    const R = site.pts.map(p => rot(p, -th)); // 회전 좌표계
    const testRaw = buildableTest(site.pts, site.setbacks);
    const exclude = site.exclude || [];
    const test = (x, y) => { const p = rot([x, y], th); return testRaw(p[0], p[1]) && !insideAny(p[0], p[1], exclude); };
    const xs = R.map(p => p[0]), ys = R.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const H = f => f * A.floorHeight_m + A.groundExtra_m;
    const want = {}; const sumMix = types.reduce((s, t) => s + mix[t], 0); types.forEach(t => { want[t] = mix[t] / sumMix; });

    function place(rowFloors) {
      const blds = []; const cols = {}; types.forEach(t => { cols[t] = 0; });
      let y = ymin, row = 0, prevH = 0;
      while (y < ymax) {
        const f = rowFloors(row), Dmax = Math.max(...types.map(t => U[t].깊이));
        const y0 = row === 0 ? y : y + opt.spacing * prevH;
        if (y0 + Dmax > ymax) break;
        const ranges = stripRanges(test, xmin, xmax, y0, y0 + Dmax);
        let any = false;
        ranges.forEach(([s, e]) => {
          let x = s; const items = [];
          while (true) {
            // 부족한 평형부터, 4호 → 6호 → 2호 순으로 들어가는 모듈 고르기
            const tot = Object.values(cols).reduce((a, b) => a + b, 0) || 1;
            const order = types.slice().sort((a, b) => (cols[a] / tot - want[a]) - (cols[b] / tot - want[b]));
            let pick = null;
            for (const t of order) { for (const n of [4, 6, 2]) { const m = slab(U, A.coreW_m, t, n); if (x + m.L <= e + 1e-6) { pick = m; break; } } if (pick) break; }
            if (!pick) break;
            items.push(Object.assign({ x }, pick)); cols[pick.t] += pick.n; x += pick.L + A.sideGap_m;
          }
          if (!items.length) return;
          const used = items[items.length - 1].x + items[items.length - 1].L - s, shift = (e - s - used) / 2; // 가운데 맞춤
          items.forEach(it => { blds.push({ row, t: it.t, n: it.n, floors: f, L: it.L, D: it.D, rx: it.x + shift, ry: y0 }); any = true; });
        });
        if (!any) { y = y0 + 1; if (row === 0) { y = y0 + 1; continue; } }
        else { prevH = H(f); y = y0 + Dmax; row++; }
        if (!any && row > 0) { /* 빈 띠: 한 칸 위로 */ }
      }
      // 남는 북쪽 여유를 줄 사이·남쪽 마당에 고르게 나눔(남측 개방). 동 꼭짓점·변 중점이 여전히 건축 가능 영역인지 확인하며 최대 이동량을 찾음
      const nRows = row;
      if (nRows > 0 && opt.spread !== false) {
        const lastBack = Math.max(...blds.map(b => b.ry + b.D));
        const ok = dlt => blds.every(b => {
          const dy = dlt * (b.row + 1) / nRows, y0 = b.ry + dy, y1 = y0 + b.D, xm = b.rx + b.L / 2;
          return [[b.rx, y0], [b.rx + b.L, y0], [b.rx + b.L, y1], [b.rx, y1], [xm, y0], [xm, y1], [b.rx, (y0 + y1) / 2], [b.rx + b.L, (y0 + y1) / 2]].every(q => test(q[0], q[1]));
        });
        let lo = 0, hi = Math.max(0, ymax - lastBack);
        for (let k = 0; k < 14 && hi - lo > 0.3; k++) { const mid = (lo + hi) / 2; if (ok(mid)) lo = mid; else hi = mid; }
        if (lo > 0) blds.forEach(b => { b.ry += lo * (b.row + 1) / nRows; });
      }
      // 회전 되돌린 꼭짓점
      blds.forEach((b, i) => {
        b.id = 101 + i;
        b.poly = [[b.rx, b.ry], [b.rx + b.L, b.ry], [b.rx + b.L, b.ry + b.D], [b.rx, b.ry + b.D]].map(p => rot(p, th));
      });
      return blds;
    }

    // 정북 일조·경계부 저층 상한 → 동별 최고 층수
    const E = edges(site.pts);
    function capFloors(b) {
      let cap = A.maxFloors;
      E.forEach((e, i) => {
        const tag = site.tags[i];
        const d = Math.min(...b.poly.map(p => segDist(p, e.a, e.b)));
        if (tag === 'north' || (tag === 'park' && e.out[1] > 0.5)) {
          const s = opt.sun, dd = tag === 'park' ? d + (opt.parkWidth || 0) : d; let Hmax;
          if (dd < s.높이10m이하_m) Hmax = 0; else Hmax = Math.max(10, dd / s.높이10m초과_높이비);
          cap = Math.min(cap, Math.floor((Hmax - A.groundExtra_m) / A.floorHeight_m));
        }
        if (tag === 'lowrise' && opt.lowriseCap && d < opt.lowriseDist) cap = Math.min(cap, opt.lowriseCap);
      });
      return Math.max(0, cap);
    }
    const gfaOf = blds => blds.reduce((s, b) => s + b.n * b.floors * U[b.t].전용 * A.supplyFactor, 0);
    const finish = blds => { blds.forEach(b => { b.cap = capFloors(b); b.floors = Math.min(b.floors, b.cap); }); return blds.filter(b => b.floors >= A.minFloors); };

    // 균일 층수 F를 낮은 쪽부터 올려 목표 용적률 이하 최대 찾기 → 북쪽 줄부터 한 층씩 올려 목표에 맞춤(남저북고)
    const target = opt.lot * opt.far / 100;
    let best = null;
    if (opt.fixedF) {
      // 기준 층수 고정: 넘치면 남쪽 줄·가장자리 동부터 빼서(남측 개방) 목표에 맞춤
      let b0 = finish(place(() => opt.fixedF));
      if (gfaOf(b0) > target) {
        const cx = b0.reduce((s, b) => s + b.rx, 0) / b0.length;
        const order = b0.slice().sort((a, b) => a.row - b.row || Math.abs(b.rx - cx) - Math.abs(a.rx - cx));
        for (const b of order) { if (gfaOf(b0) <= target) break; b0 = b0.filter(x => x !== b); }
      }
      best = { F: opt.fixedF, bl: b0, gfa: gfaOf(b0) };
    } else {
      for (let F = A.minFloors; F <= A.maxFloors; F++) {
        const bl = finish(place(() => F)), gfa = gfaOf(bl);
        if (gfa <= target * 1.0001) best = { F, bl, gfa }; else break;
      }
      if (!best) { const bl = finish(place(() => A.minFloors)); best = { F: A.minFloors, bl, gfa: gfaOf(bl) }; }
    }
    let bl = best.bl;
    // 북쪽 줄을 올리되 기준 층수보다 너무 튀지 않게(기준 + 40%, 최소 3개층까지)
    const maxRise = best.F + Math.max(3, Math.round(best.F * 0.4));
    if (bl.length) {
      const rows = [...new Set(bl.map(b => b.row))].sort((a, b) => b - a); // 북쪽 줄부터
      let changed = true;
      while (changed) {
        changed = false;
        for (const r of rows) {
          // 마지막 줄은 뒤에 동이 없어 인동간격에 영향 없음. 그 앞줄은 뒷줄과 간격이 충분할 때만 올림
          const rowB = bl.filter(b => b.row === r);
          const next = bl.filter(b => b.row === r + 1);
          for (const b of rowB) {
            if (b.floors + 1 > b.cap || b.floors + 1 > maxRise) continue;
            const add = b.n * U[b.t].전용 * A.supplyFactor;
            if (gfaOf(bl) + add > target) continue;
            if (next.length) {
              const gap = Math.min(...next.map(nb => nb.ry)) - (b.ry + b.D);
              if (gap < opt.spacing * H(b.floors + 1)) continue;
            }
            b.floors++; changed = true;
          }
        }
      }
    }
    bl.sort((a, b) => a.row - b.row || a.rx - b.rx).forEach((b, i) => { b.id = 101 + i; });
    // 집계
    const lotA = opt.lot, ba = bl.reduce((s, b) => s + b.L * b.D, 0), gfa = gfaOf(bl);
    const byType = {}; types.forEach(t => { byType[t] = 0; }); bl.forEach(b => { byType[b.t] += b.n * b.floors; });
    const units = Object.values(byType).reduce((a, b) => a + b, 0);
    const maxF = bl.length ? Math.max(...bl.map(b => b.floors)) : 0;
    return {
      buildings: bl, units, byType, gfa, ba, far: lotA ? gfa / lotA * 100 : 0, bcr: lotA ? ba / lotA * 100 : 0,
      maxFloors: maxF, maxHeight: maxF ? H(maxF) : 0, H,
      rows: bl.length ? new Set(bl.map(b => b.row)).size : 0, baseF: best.F, target,
    };
  }

  // 대안: 저층 다동형 / 중층형 / 고층 소동형. 목표 연면적의 97% 이상 채우는 기준 층수 중에서 고름
  function alternatives(site, opt) {
    const A = opt.assume, cands = [];
    for (let F = A.minFloors; F <= A.maxFloors; F++) {
      try { const r = layout(site, Object.assign({}, opt, { fixedF: F })); if (r.units && r.gfa >= r.target * 0.97) cands.push(r); } catch (e) { /* 건너뜀 */ }
    }
    if (!cands.length) { const r = layout(site, opt); return [Object.assign(r, { label: '최대 배치(목표 미달)' })]; }
    const lo = cands[0], hi = cands[cands.length - 1], mid = cands[Math.floor((cands.length - 1) / 2)];
    const out = [Object.assign(lo, { label: '다동형(층수 낮게)' })];
    if (mid !== lo && mid !== hi) out.push(Object.assign(mid, { label: '중간형' }));
    if (hi !== lo) out.push(Object.assign(hi, { label: '소동형(층수 높게)' }));
    return out;
  }

  /* ---------- 태양 위치·그림자 ---------- */
  // 동지(적위 -23.44°), 진태양시 기준. 방위각: 남=0, 서쪽 +
  function sun(latDeg, hour, decl = -23.44) {
    const φ = latDeg * D2R, δ = decl * D2R, ω = (hour - 12) * 15 * D2R;
    const sa = Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(ω), alt = Math.asin(sa);
    const az = Math.atan2(Math.sin(ω), Math.cos(ω) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ));
    return { alt, az };
  }
  // 직육면체(바닥 사각형 poly, 높이 h)의 그림자 = 바닥과 옮긴 바닥의 볼록껍질
  function hull(P) {
    const pts = P.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (pts.length < 3) return pts;
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of pts.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  }
  function shadow(poly, h, s) {
    if (s.alt <= 0) return null;
    const len = h / Math.tan(s.alt);
    // 그림자는 해 반대쪽: 해가 남(az=0)이면 북쪽(+y)으로
    const dx = len * Math.sin(s.az), dy = len * Math.cos(s.az);
    return hull(poly.concat(poly.map(p => [p[0] + dx, p[1] + dy])));
  }
  // 격자 점별 동지 일조 시간(합계 08~16, 최대 연속 09~15), 10분 간격
  function sunHours(blds, H, latDeg, pts, tol) {
    const times = []; for (let t = 8; t <= 16 + 1e-9; t += 1 / 6) times.push(t);
    const shadowsAt = times.map(t => { const s = sun(latDeg, t); return blds.map(b => shadow(b.poly, H(b.floors), s)).filter(Boolean); });
    return pts.map(p => {
      let total = 0, run = 0, best = 0;
      times.forEach((t, k) => {
        const lit = !shadowsAt[k].some(sh => inside(p[0], p[1], sh));
        if (lit && t >= tol.합계_구간[0] && t < tol.합계_구간[1]) total += 1 / 6;
        if (t >= tol.연속_구간[0] && t < tol.연속_구간[1]) { if (lit) { run += 1 / 6; best = Math.max(best, run); } else run = 0; }
      });
      return { total: Math.round(total * 10) / 10, cont: Math.round(best * 10) / 10, ok: best >= tol.연속_h - 1e-6 || total >= tol.합계_h - 1e-6 };
    });
  }

  const api = { projector, rot, area, ccw, openRing, inside, segDist, edges, clipHalf, buildableTest, stripRanges, layout, alternatives, sun, shadow, hull, sunHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.ArchGeom = api;
})(typeof window !== 'undefined' ? window : globalThis);
