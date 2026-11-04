/* ===== 기반시설 배치 방식 (PlaceFit) — 2026-11-01 =====
 정사각형 블록(INFRA.block)이 들어갈 자리가 없으면 멀리 밀려나던 문제를 고치려고, 배치 방식을 고를 수 있게 함
  - wrap  (감싸기)  : 기준 시설에서 고른 방향 쪽 빈 땅을 구역 모양대로 먼저 채우고, 모자라면 옆으로 감싸 이어 붙임
  - clean (곧게)    : 기준 시설 변 폭 그대로 곧은 띠. 그 방향이 막히면 채울 만큼 채우고 옆으로 곧게 꺾음(ㄱ자)
  - sketch(스케치)  : 마우스로 대충 그은 모양 / 올린 손그림 → 구역 안 빈 땅으로 자르고 필요 면적에 맞게 고르게 키우거나 줄임
  - makeSheet / readSheet : 손그림용 스케치 용지(회색 지도) 만들기, 올린 그림에서 색 선으로 그린 모양 읽기
 turf 6.5 기준(intersect·difference 두 인수). safeUnion은 js/zonekit.js 공통 함수.
 시험: node urban/test-placefit.js */
(function (root) {
  const T = root.turf || (typeof require !== 'undefined' ? require('@turf/turf') : null);
  const U = list => {
    const ok = list.filter(Boolean);
    if (!ok.length) return null;
    if (ok.length === 1) return ok[0];
    if (typeof root.safeUnion === 'function') return root.safeUnion(ok);
    return ok.reduce((a, b) => { try { return T.union(a, b) || a; } catch (er) { return a; } });
  };
  const D = (a, b) => { if (!a) return null; if (!b) return a; try { return T.difference(a, b); } catch (er) { return a; } };
  const I = (a, b) => { if (!a || !b) return null; try { return T.intersect(a, b); } catch (er) { return null; } };
  const A = f => { try { return f ? T.area(f) : 0; } catch (er) { return 0; } };
  const F = g => (g && g.type === 'Feature') ? g : (g ? { type: 'Feature', properties: {}, geometry: g.geometry || g } : null);
  const NAME = { N: '북쪽', S: '남쪽', E: '동쪽', W: '서쪽' };
  const fmt = n => Math.round(n).toLocaleString();
  const m2d = lat => [1 / (111320 * Math.cos(lat * Math.PI / 180)), 1 / 110540];

  // 기준 시설에 맞닿은(1m 이내) 조각만
  function touching(g, anchor) {
    if (!g) return null;
    const tb = T.buffer(anchor, 1, { units: 'meters' });
    const parts = T.flatten(g).features.filter(p => { try { return T.booleanIntersects(p, tb); } catch (er) { return false; } });
    return parts.length ? U(parts) : null;
  }
  // 기준 시설의 그 방향 쪽 3/4 지점부터 바깥 전체(기울어진 부지도 맞닿은 변이 잡히게)
  function halfPlane(anchor, dir) {
    const [x0, y0, x1, y1] = T.bbox(anchor), big = 0.05;
    const cy = dir === 'N' ? y0 + (y1 - y0) * 0.75 : y0 + (y1 - y0) * 0.25;
    const cx = dir === 'E' ? x0 + (x1 - x0) * 0.75 : x0 + (x1 - x0) * 0.25;
    return T.bboxPolygon({ N: [x0 - big, cy, x1 + big, y1 + big], S: [x0 - big, y0 - big, x1 + big, cy], E: [cx, y0 - big, x1 + big, y1 + big], W: [x0 - big, y0 - big, cx, y1 + big] }[dir]);
  }
  // 반경을 이분 탐색해 필요 면적에 맞춤
  function solveGrow(anchor, region, target) {
    const grow = d => touching(I(T.buffer(anchor, d, { units: 'meters', steps: 16 }), region), anchor);
    const maxD = Math.sqrt(A(region)) * 3 + 50, full = grow(maxD), cap = A(full);
    if (cap < target * 0.995) return { g: full, a: cap, short: target - cap };
    let lo = 0, hi = maxD, best = full;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, g = grow(mid), a = A(g);
      if (a >= target) { hi = mid; best = g; } else lo = mid;
      if (Math.abs(a - target) < target * 0.002) { best = g; break; }
    }
    return { g: best, a: A(best), short: 0 };
  }

  function wrap({ zone, anchor, occupied = [], dir = 'N', target }) {
    zone = F(zone); anchor = F(anchor);
    const free = D(zone, U([anchor, ...occupied.map(F)]));
    if (!free || !(target > 0)) return { geom: null, area: 0, ok: false, msg: '구역 안에 남은 빈 땅이 없습니다' };
    const side = I(free, halfPlane(anchor, dir));
    const s1 = side ? solveGrow(anchor, side, target) : { g: null, a: 0, short: target };
    if (s1.short === 0) return { geom: s1.g, area: s1.a, ok: true, msg: `${NAME[dir]}에 ${fmt(s1.a)}㎡ 배치(감싸기)` };
    const rest = D(free, s1.g), a2 = U([anchor, s1.g]);
    const s2 = rest ? solveGrow(a2, rest, target - s1.a) : { g: null, a: 0, short: target - s1.a };
    const g = U([s1.g, s2.g]), a = A(g);
    if (s2.short === 0) return { geom: g, area: a, ok: true, msg: `${NAME[dir]} 여유 ${fmt(s1.a)}㎡ — 모자란 ${fmt(target - s1.a)}㎡는 옆으로 감싸 이어 붙였습니다` };
    return { geom: g, area: a, ok: false, msg: `빈 땅이 ${fmt(target - a)}㎡ 부족합니다 — 다른 시설을 옮기거나 면적을 줄이세요` };
  }

  function strip(anchor, dir, len, widen) {
    const [x0, y0, x1, y1] = T.bbox(anchor), [mx, my] = m2d((y0 + y1) / 2);
    const wx = widen * mx, wy = widen * my, lx = len * mx, ly = len * my, ix = 2 * mx, iy = 2 * my; // 변에서 2m 겹쳐 시작(겹친 곳은 잘림)
    return T.bboxPolygon({ N: [x0 - wx, y1 - iy, x1 + wx, y1 + ly], S: [x0 - wx, y0 - ly, x1 + wx, y0 + iy], E: [x1 - ix, y0 - wy, x1 + lx, y1 + wy], W: [x0 - lx, y0 - wy, x0 + ix, y1 + wy] }[dir]);
  }
  function clean({ zone, anchor, occupied = [], dir = 'N', target, _noTurn = false }) {
    zone = F(zone); anchor = F(anchor);
    const free = D(zone, U([anchor, ...occupied.map(F)]));
    if (!free || !(target > 0)) return { geom: null, area: 0, ok: false, msg: '구역 안에 남은 빈 땅이 없습니다' };
    const maxL = Math.sqrt(A(zone)) * 3, piece = (L, w) => touching(I(strip(anchor, dir, L, w), free), anchor);
    for (let w = 0; w <= maxL; w += 10) {
      if (A(piece(maxL, w)) < target * 0.995) continue;
      let lo = 0, hi = maxL, best = null;
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2, g = piece(mid, w), a = A(g);
        if (a >= target) { hi = mid; best = g; } else lo = mid;
        if (best && Math.abs(a - target) < target * 0.002) break;
      }
      return { geom: best, area: A(best), ok: true, step: w ? 2 : 1,
        msg: w ? `${NAME[dir]} 띠가 좁아 양옆으로 ${w}m씩 넓혀 ${fmt(A(best))}㎡ 배치(곧게)` : `${NAME[dir]}으로 곧게 ${fmt(A(best))}㎡ 배치` };
    }
    if (!_noTurn) {
      const first = piece(maxL, 0), got = A(first);
      if (got > 0) {
        const a2 = U([anchor, first]); let best = null;
        for (const sd of (dir === 'N' || dir === 'S') ? ['W', 'E'] : ['N', 'S']) {
          const r = clean({ zone, anchor: a2, occupied, dir: sd, target: target - got, _noTurn: true });
          if (r.geom && (!best || r.step < best.r.step)) best = { sd, r };
        }
        if (best) {
          const g = U([first, best.r.geom]);
          return { geom: g, area: A(g), ok: true, msg: `${NAME[dir]}으로 ${fmt(got)}㎡까지 곧게 채우고, 모자란 ${fmt(target - got)}㎡는 ${NAME[best.sd]}으로 곧게 꺾어 붙였습니다(ㄱ자)` };
        }
      }
    }
    return { geom: null, area: 0, ok: false, step: 9, msg: `${NAME[dir]}으로는 곧은 띠로 넣을 수 없습니다 — 감싸기나 스케치를 쓰세요` };
  }

  function sketch({ zone, occupied = [], sketch: sk, target, keepSize = false }) {
    zone = F(zone);
    const free = D(zone, U(occupied.map(F)));
    if (!free || !sk) return { geom: null, area: 0, ok: false, msg: '구역 안에 남은 빈 땅이 없습니다' };
    let shape = F(sk);
    // 열린 선(양 끝이 그은 길이의 25% 넘게 떨어짐)은 '나누는 선'
    if (shape.geometry.type === 'LineString') {
      const c = shape.geometry.coordinates, len = T.length(shape, { units: 'meters' }), gap = c.length > 1 ? T.distance(T.point(c[0]), T.point(c[c.length - 1]), { units: 'meters' }) : 0;
      if (c.length >= 2 && len > 0 && gap > len * 0.25) return cutBy({ free, line: shape, target, keepSize });
    }
    if (shape.geometry.type === 'LineString') { const c = shape.geometry.coordinates; if (c.length < 3) return { geom: null, area: 0, ok: false, msg: '그린 선이 너무 짧습니다' }; shape = T.polygon([[...c, c[0]]]); }
    // 손으로 그어 선이 꼬였을 때만 살짝 부풀려 바로잡음(반듯하게 찍은 모양은 그대로 — 부풀리면 모서리가 둥글어짐)
    let kinked = false; try { kinked = T.kinks(shape).features.length > 0; } catch (er) { kinked = true; }
    // 꼬인 손그림(8자·여러 고리)은 고리마다 나눠 합침 — 안 되면 바깥 테두리(볼록 껍질)
    if (kinked) { try { shape = U(T.unkinkPolygon(shape).features) || T.convex(shape); } catch (er) { try { shape = T.convex(shape); } catch (er2) { /* 그대로 */ } } }
    const base = I(shape, free);
    if (!base) return { geom: null, area: 0, ok: false, msg: '그린 모양이 구역(노란색) 안 빈 땅과 겹치지 않습니다 — 구역 안에 다시 그려 주세요' };
    const a0 = A(base);
    if (keepSize || !(target > 0)) return { geom: base, area: a0, ok: true, msg: `그린 모양대로 ${fmt(a0)}㎡` };
    // 크기 맞추기: 그린 모양을 가운데 기준으로 같은 비율로 키우거나 줄임(반듯하게 그린 변·각이 그대로 남음 — 예전 buffer는 모서리가 둥글어졌음)
    const c0 = T.centroid(shape);
    const at = k => I(Math.abs(k - 1) < 1e-4 ? shape : T.transformScale(shape, k, { origin: c0 }), free);
    let lo, hi;
    if (a0 > target) { lo = 0.02; hi = 1; } else { lo = 1; hi = Math.max(2, Math.sqrt(A(zone) / Math.max(A(shape), 1)) * 3); }
    if (A(at(hi)) < target * 0.995) { const g = at(hi); return { geom: g, area: A(g), ok: false, msg: `빈 땅이 ${fmt(target - A(g))}㎡ 부족합니다` }; }
    let best = at(hi);
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2, g = at(mid), a = A(g);
      if (a >= target) { hi = mid; best = g; } else lo = mid;
      if (Math.abs(a - target) < target * 0.002) { best = g; break; }
    }
    return { geom: best, area: A(best), ok: true, msg: `그린 모양 ${fmt(a0)}㎡ → 필요 면적에 맞춰 ${A(best) >= a0 ? '키움' : '줄임'}(${fmt(A(best))}㎡)` };
  }

  // ── 손그림: 스케치 용지 SVG(회색·흰색만) ──
  function makeSheet({ zone, features = [], widthPx = 1400, padRatio = 0.08 }) {
    zone = F(zone);
    let [x0, y0, x1, y1] = T.bbox(zone);
    const kx = Math.cos((y0 + y1) / 2 * Math.PI / 180), w = (x1 - x0) * kx, h = y1 - y0, pad = Math.max(w, h) * padRatio;
    x0 -= pad / kx; x1 += pad / kx; y0 -= pad; y1 += pad;
    const H = Math.round(widthPx * (y1 - y0) / ((x1 - x0) * kx)), meta = { bbox: [x0, y0, x1, y1], width: widthPx, height: H };
    const px = ([lo, la]) => [((lo - x0) / (x1 - x0)) * widthPx, ((y1 - la) / (y1 - y0)) * H];
    const d = f => T.flatten(F(f)).features.map(p => p.geometry.coordinates.map(r => 'M' + r.map(c => px(c).map(v => v.toFixed(1)).join(',')).join('L') + 'Z').join('')).join('');
    const esc = s => String(s).replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
    const fs = features.filter(f => f && f.geom).map(f => {
      let t = ''; try { const [cx, cy] = px(T.centroid(F(f.geom)).geometry.coordinates); t = f.name ? `<text x="${cx.toFixed(0)}" y="${cy.toFixed(0)}" font-size="20" fill="#555" text-anchor="middle" font-family="sans-serif">${esc(f.name)}</text>` : ''; } catch (er) { t = ''; }
      return `<path d="${d(f.geom)}" fill="#e2e2e2" stroke="#888" stroke-width="2"/>${t}`;
    }).join('');
    const m = 34, cm = (x, y, sx, sy) => `<path d="M${x},${y + sy * m}L${x},${y}L${x + sx * m},${y}" stroke="#000" stroke-width="5" fill="none"/>`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${H}" viewBox="0 0 ${widthPx} ${H}"><desc>JBSLAB-SKETCH ${JSON.stringify(meta)}</desc>` +
      `<rect width="100%" height="100%" fill="#fff"/><path d="${d(zone)}" fill="#fafafa" stroke="#333" stroke-width="3" stroke-dasharray="12 7"/>${fs}` +
      cm(4, 4, 1, 1) + cm(widthPx - 4, 4, -1, 1) + cm(4, H - 4, 1, -1) + cm(widthPx - 4, H - 4, -1, -1) +
      `<text x="${widthPx / 2}" y="30" font-size="18" fill="#777" text-anchor="middle" font-family="sans-serif">색 펜(빨강·파랑 등)으로 원하는 자리를 닫힌 모양으로 그려 주세요</text></svg>`;
    return { svg, meta };
  }

  // 잉크 점들이 한 방향으로 길쭉하면(주축 길이 ÷ 폭 ≥ 7) 그 가운데 선을 꺾은선으로 돌려줌
  function strokeLine(ink, W, H, meta) {
    let n = 0, mx = 0, my = 0;
    const step = Math.max(1, Math.round(Math.sqrt(W * H) / 700));
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (ink[y * W + x]) { n++; mx += x; my += y; }
    if (n < 20) return null;
    mx /= n; my /= n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (ink[y * W + x]) { const dx = x - mx, dy = y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy, l1 = tr / 2 + Math.sqrt(Math.max(0, tr * tr / 4 - det)), l2 = Math.max(1e-6, tr - l1);
    if (Math.sqrt(l1 / l2) < 7) return null;
    const ang = Math.atan2(l1 - sxx, sxy || 1e-9), ux = Math.cos(ang), uy = Math.sin(ang);
    // 주축 방향 구간마다 수직 방향 평균 → 가운데 선
    const bins = new Map(); let tMin = Infinity, tMax = -Infinity;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (ink[y * W + x]) { const t = (x - mx) * ux + (y - my) * uy; tMin = Math.min(tMin, t); tMax = Math.max(tMax, t); }
    const nb = 30, bw = (tMax - tMin) / nb || 1;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (ink[y * W + x]) {
      const t = (x - mx) * ux + (y - my) * uy, v = -(x - mx) * uy + (y - my) * ux, k = Math.min(nb - 1, Math.floor((t - tMin) / bw));
      const b = bins.get(k) || { t: 0, v: 0, c: 0 }; b.t += t; b.v += v; b.c++; bins.set(k, b);
    }
    const [x0, y0, x1, y1] = meta.bbox, toLL = (x, y) => [x0 + (x / W) * (x1 - x0), y1 - (y / H) * (y1 - y0)];
    const pts = [...bins.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => { const t = b.t / b.c, v = b.v / b.c; return toLL(mx + t * ux - v * uy, my + t * uy + v * ux); });
    if (pts.length < 2) return null;
    return { shapes: [], lines: [T.lineString(pts)], msg: '구역을 가르는 선 1개를 읽었습니다 — 선 바깥쪽(작은 쪽)을 시설로 씁니다' };
  }

  // 나누는 선: 선 양 끝을 구역 밖까지 늘려 빈 땅을 둘로 가르고, 작은 쪽을 시설로. 필요 면적이 있으면 선을 평행으로 옮겨 맞춤
  function cutBy({ free, line, target, keepSize }) {
    const c = line.geometry.coordinates, ext = 2000;   // m
    const far = (a, b) => T.destination(T.point(b), ext / 1000, T.bearing(T.point(a), T.point(b))).geometry.coordinates;
    const full = T.lineString([far(c[1], c[0]), ...c, far(c[c.length - 2], c[c.length - 1])]);
    const s0 = c[0], s1 = c[c.length - 1], dirB = T.bearing(T.point(s0), T.point(s1));
    const side = (pt, off) => { const a = T.destination(T.point(s0), off / 1000, dirB + 90).geometry.coordinates, b = T.destination(T.point(s1), off / 1000, dirB + 90).geometry.coordinates; return Math.sign((b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0])); };
    const pieces = off => {
      const ln = Math.abs(off) < 1e-6 ? full : T.transformTranslate(full, off, dirB + 90, { units: 'meters' });
      let parts; try { parts = T.flatten(D(free, T.buffer(ln, 0.05, { units: 'meters' }))).features; } catch (er) { return null; }
      const g = { 1: [], '-1': [] };
      parts.forEach(p => { const k = String(side(T.pointOnFeature(p).geometry.coordinates, off) || 1); g[k].push(p); });
      return g;
    };
    const g0 = pieces(0); if (!g0) return { geom: null, area: 0, ok: false, msg: '선으로 구역을 가르지 못했습니다' };
    const aOf = l => l.reduce((a, p) => a + A(p), 0);
    if (!g0[1].length || !g0['-1'].length) return { geom: null, area: 0, ok: false, msg: '그린 선이 구역을 끝에서 끝까지 가르지 않습니다 — 구역 경계를 넘어가게 그어 주세요' };
    const key = aOf(g0[1]) <= aOf(g0['-1']) ? '1' : '-1';   // 작은 쪽 = 시설
    const areaAt = off => { const g = pieces(off); return g ? aOf(g[key]) : 0; };
    const geomAt = off => { const g = pieces(off); return g && g[key].length ? U(g[key]) : null; };
    const a0 = areaAt(0);
    if (keepSize || !(target > 0)) { const g = geomAt(0); return { geom: g, area: A(g), ok: !!g, msg: `선 바깥쪽 ${fmt(A(g))}㎡(선대로)` }; }
    // 선을 평행으로 옮길 거리 이분 탐색: 한쪽 끝(구역 지름만큼)은 시설이 0, 반대쪽 끝은 빈 땅 전체
    const Rm = Math.max(50, Math.sqrt(A(free)) * 3);
    let big = -Rm, small = Rm;
    if (areaAt(big) < areaAt(small)) { big = Rm; small = -Rm; }
    if (areaAt(big) < target * 0.995) { const g = geomAt(big); return { geom: g, area: A(g), ok: false, msg: `빈 땅이 ${fmt(target - A(g))}㎡ 부족합니다` }; }
    for (let i = 0; i < 50; i++) { const mid = (big + small) / 2; if (areaAt(mid) >= target) big = mid; else small = mid; if (Math.abs(big - small) < 0.05) break; }
    const lo = big;
    const g = geomAt(lo);
    return { geom: g, area: A(g), ok: true, msg: `그은 선 바깥쪽 ${fmt(a0)}㎡ → 선을 ${Math.abs(lo) < 0.5 ? '거의 그대로' : `${A(g) > a0 ? '안' : '바깥'}쪽으로 ${Math.abs(lo).toFixed(1)}m 평행 이동해`} 필요 면적에 맞춤(${fmt(A(g))}㎡)` };
  }

  // ── 손그림 읽기: img = { width, height, data(RGBA) } (브라우저는 canvas.getImageData) ──
  function readSheet(img, meta, { minAreaM2 = 50 } = {}) {
    const { width: W, height: H, data } = img, N = W * H;
    if (Math.abs(W / H - meta.width / meta.height) > 0.03 * (meta.width / meta.height)) return { shapes: [], msg: '내려받은 스케치 용지와 가로세로 비율이 다릅니다 — 용지를 자르거나 돌리지 말고 그대로 그려 올려 주세요' };
    const ink = new Uint8Array(N); let inkN = 0;
    for (let i = 0; i < N; i++) {
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3], mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (a > 100 && mx - mn > 60 && mx > 80) { ink[i] = 1; inkN++; }
    }
    if (!inkN) return { shapes: [], msg: '색으로 그린 선을 찾지 못했습니다 — 검정·회색이 아닌 색 펜으로 그려 주세요' };
    // 선 끊김 메우기: 굵기를 키워 가며 안쪽이 생길 때까지(덜 닫힌 그림도 닫힘), 나중에 그만큼 다시 깎음
    let R = Math.max(2, Math.round(W * 0.004)), thick, out;
    for (;;) {
      thick = new Uint8Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x])
        for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
          const X = x + dx, Y = y + dy;
          if (X >= 0 && Y >= 0 && X < W && Y < H && dx * dx + dy * dy <= R * R) thick[Y * W + X] = 1;
        }
      out = new Uint8Array(N); const st = [];
      for (let x = 0; x < W; x++) st.push(x, (H - 1) * W + x);
      for (let y = 0; y < H; y++) st.push(y * W, y * W + W - 1);
      while (st.length) {
        const p = st.pop(); if (out[p] || thick[p]) continue; out[p] = 1;
        const x = p % W, y = (p / W) | 0;
        if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (y > 0) st.push(p - W); if (y < H - 1) st.push(p + W);
      }
      let inner = 0, th = 0;
      for (let i = 0; i < N; i++) { if (!out[i] && !thick[i]) inner++; if (thick[i]) th++; }
      if (inner > th * 0.5 || R > W * 0.06) break;
      // 처음 굵기에서 안쪽이 안 생기고 잉크가 길쭉한 한 줄이면: 구역을 가르는 '나누는 선'으로 읽음(그 선 바깥쪽 끝을 시설로)
      if (R === Math.max(2, Math.round(W * 0.004))) { const ln = strokeLine(ink, W, H, meta); if (ln) return ln; }
      R = Math.round(R * 1.6);
    }
    const [x0, y0, x1, y1] = meta.bbox, toLL = (x, y) => [x0 + (x / W) * (x1 - x0), y1 - (y / H) * (y1 - y0)];
    const mPerPx = T.distance([x0, y0], [x1, y0]) * 1000 / W;
    const lab = new Int32Array(N), shapes = [];
    for (let i = 0; i < N; i++) {
      if (out[i] || lab[i]) continue;
      const id = shapes.length + 1, q = [i], rows = new Map(); lab[i] = id;
      while (q.length) {
        const p = q.pop(), x = p % W, y = (p / W) | 0;
        if (!rows.has(y)) rows.set(y, []); rows.get(y).push(x);
        for (const n of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
          if (n >= 0 && !out[n] && !lab[n]) { lab[n] = id; q.push(n); }
      }
      const step = Math.max(1, Math.round(H / 300)), rects = [];
      for (const [y, xs] of rows) {
        if (y % step) continue;
        xs.sort((a, b) => a - b);
        let s = xs[0], prev = xs[0];
        for (let k = 1; k <= xs.length; k++) {
          if (k === xs.length || xs[k] !== prev + 1) { const a = toLL(s, y), b = toLL(prev + 1, y + step); rects.push(T.bboxPolygon([a[0], b[1], b[0], a[1]])); s = xs[k]; }
          prev = xs[k];
        }
      }
      if (!rects.length) { shapes.push(null); continue; }
      let u = U(rects);
      try { const sh = T.buffer(u, -R * mPerPx * 0.8, { units: 'meters', steps: 4 }); if (sh && A(sh) > 0) u = sh; } catch (er) { /* 그대로 */ }
      try { u = T.simplify(u, { tolerance: (x1 - x0) / 400, highQuality: true }); } catch (er) { /* 그대로 */ }
      shapes.push(A(u) >= minAreaM2 ? u : null);
    }
    const ok = shapes.filter(Boolean).sort((a, b) => A(b) - A(a));
    return { shapes: ok, msg: ok.length ? `그린 모양 ${ok.length}개를 읽었습니다` : '닫힌 모양을 찾지 못했습니다' };
  }

  // 정비계획 계산에서 부르는 입구: opt = z.infra.fit[kind] = { mode, dir, anchor, sketch, keepSize }
  function run(opt, { zone, anchorGeom, occupied, target }) {
    if (!opt || !opt.mode || opt.mode === 'auto') return null;
    if (opt.mode === 'sketch' || opt.mode === 'upload') return opt.sketch ? sketch({ zone, occupied: occupied.concat(anchorGeom ? [anchorGeom] : []), sketch: opt.sketch, target, keepSize: !!opt.keepSize }) : null;
    if (!anchorGeom) return { geom: null, area: 0, ok: false, msg: '기준 시설이 지도에 없습니다 — 기준 시설을 다시 고르세요' };
    return (opt.mode === 'clean' ? clean : wrap)({ zone, anchor: anchorGeom, occupied, dir: opt.dir || 'N', target });
  }

  const api = { wrap, clean, sketch, makeSheet, readSheet, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PlaceFit = api;
})(typeof window !== 'undefined' ? window : globalThis);
