'use strict';
// 심화 배치 엔진(JbsPlan) — 컨셉 문서 4·5장: 골격 → 구획 → 높이 계획 → 동 놓기(중심부터 큰 동) → 다듬기 → 반복 탐색 → 성격이 다른 여러 안
//  바깥(반복 탐색)은 '구도'만 바꿈: 골격 유형·구획 수·구획 경계·구획별 방향·높이 장(층수 분포)·동 형태 선호
//  안쪽(decode)은 정해진 순서로 채움: 구획 중심에 가까운 자리부터, 큰 동 → 작은 동(같은 형태 작은 호수·평형 → 다른 형태) 순으로 대 보고 처음 맞는 것을 놓음
//  동은 shared/dong-lib.js(동 타입 라이브러리), 검사는 shared/arch-check.js(규칙·경험·선호)와 arch-geom capper(높이 상한)를 그대로 씀
//  좌표: 월드 미터(x 동쪽, y 북쪽). 입력 site·opt는 arch-geom layout과 같은 꼴 + opt.mix {평형: 비율}
(function (g) {
  const NODE = typeof module !== 'undefined' && module.exports;
  const G = NODE ? require('./arch-geom.js') : g.ArchGeom, K = NODE ? require('./arch-check.js') : g.JbsCheck, DL = NODE ? require('./dong-lib.js') : g.JbsDong;
  const D2R = Math.PI / 180;

  /* ---------- 난수(같은 씨앗이면 같은 결과) ---------- */
  function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const pick = (r, a) => a[Math.floor(r() * a.length)];

  /* ---------- 대지 준비: 1m 격자로 건축 가능 칸 ---------- */
  function prep(site, opt) {
    const test = G.buildableTest(site.pts, site.setbacks || []), ex = site.exclude || [];
    const xs = site.pts.map(p => p[0]), ys = site.pts.map(p => p[1]);
    const X0 = Math.floor(Math.min(...xs)), Y0 = Math.floor(Math.min(...ys)), W = Math.ceil(Math.max(...xs)) - X0 + 1, Hh = Math.ceil(Math.max(...ys)) - Y0 + 1;
    const free = new Uint8Array(W * Hh); let n = 0, cx = 0, cy = 0;
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) { const x = X0 + i + 0.5, y = Y0 + j + 0.5; if (test(x, y) && !ex.some(e => G.inside(x, y, e))) { free[j * W + i] = 1; n++; cx += x; cy += y; } }
    cx /= n || 1; cy /= n || 1;
    // 주축(넓게 퍼진 방향) — 구획을 이 축에 직각으로 자름
    let sxx = 0, syy = 0, sxy = 0;
    for (let j = 0; j < Hh; j++) for (let i = 0; i < W; i++) if (free[j * W + i]) { const dx = X0 + i + 0.5 - cx, dy = Y0 + j + 0.5 - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { test, X0, Y0, W, H: Hh, free, area: n, cx, cy, phi, E: G.edges(site.pts), ymin: Math.min(...ys), ymax: Math.max(...ys) };
  }
  const cellAt = (P, x, y) => { const i = Math.floor(x - P.X0), j = Math.floor(y - P.Y0); return i < 0 || j < 0 || i >= P.W || j >= P.H ? -1 : j * P.W + i; };

  /* ---------- 골격: 비워 둘 땅(광장·통경축·남측 개방·순환 동선)과 구획 ---------- */
  //  center 중앙 광장형 · south 남측 개방 병렬형 · ring 외곽 순환형 · split 두 구획 분리형(넓은 통경축)
  const SKELS = { center: '중앙 광장형', south: '남측 개방 병렬형', ring: '외곽 순환형', split: '두 구획 분리형' };
  function skeleton(P, site, gn) {
    const ax = [Math.cos(P.phi), Math.sin(P.phi)], proj = (x, y) => (x - P.cx) * ax[0] + (y - P.cy) * ax[1];
    let smin = Infinity, smax = -Infinity;
    for (let j = 0; j < P.H; j++) for (let i = 0; i < P.W; i++) if (P.free[j * P.W + i]) { const s = proj(P.X0 + i + 0.5, P.Y0 + j + 0.5); if (s < smin) smin = s; if (s > smax) smax = s; }
    const k = gn.skel === 'split' ? 2 : gn.k, cuts = gn.cuts.slice(0, k - 1).map(c => smin + (smax - smin) * c).sort((a, b) => a - b);
    const corridor = gn.skel === 'split' ? 20 : 12;   // 통경축 폭(가정값)
    const r = Math.sqrt(P.area * 0.07 / Math.PI);       // 중앙 광장 반지름: 대지 7%(가정값)
    const southE = P.E.filter(e => e.out[1] < -0.5), sb = site.setbacks || [];
    const reserved = (x, y) => {
      const s = proj(x, y);
      if (cuts.some(c => Math.abs(s - c) < corridor / 2)) return 'axis';
      if (gn.skel === 'center' && Math.hypot(x - P.cx, y - P.cy) < r) return 'plaza';
      if (gn.skel === 'south' && southE.some(e => G.segDist([x, y], e.a, e.b) < (sb[e.i] || 0) + 18)) return 'south';
      if (gn.skel === 'ring' && P.E.some(e => G.segDist([x, y], e.a, e.b) < (sb[e.i] || 0) + 8)) return 'ring';
      return null;
    };
    const blockOf = (x, y) => { const s = proj(x, y); let b = 0; cuts.forEach(c => { if (s > c) b++; }); return b; };
    return { reserved, blockOf, k, cuts, corridor, plazaR: gn.skel === 'center' ? r : 0, ax };
  }
  // 구획 방향: south 정남 / edge 가장 가까운 경계 변 방향(±45° 안) / 기울임 ±15°
  function blockAngle(P, cen, mode) {
    if (mode === 'south') return 0;
    if (mode === 'tiltL') return 15;
    if (mode === 'tiltR') return -15;
    const e = P.E.slice().sort((a, b) => G.segDist(cen, a.a, a.b) - G.segDist(cen, b.a, b.b))[0];
    let th = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) / D2R; th = ((th % 180) + 180) % 180; if (th > 90) th -= 180;
    return Math.abs(th) <= 45 ? Math.round(th) : 0;
  }

  /* ---------- 높이 장: 자리별 계획 층수 ---------- */
  //  southLow 남저북고 · centerHigh 중앙 고층·가장자리 저층 · mixed 둘을 섞음 · flat 고르게
  function heightField(P, site, gn, A) {
    const Fmin = Math.max(A.minFloors, gn.Fmin), Fmax = Math.max(Fmin, gn.Fmax), dmax = Math.hypot(P.W, P.H) / 2;
    const low = P.E.filter((e, i) => ['boundary', 'lowrise'].includes(site.tags[i]));
    return (x, y) => {
      const t = Math.max(0, Math.min(1, (y - P.ymin) / (P.ymax - P.ymin || 1))), d = Math.min(1, Math.hypot(x - P.cx, y - P.cy) / dmax);
      const sh = gn.hshape === 'southLow' ? t : gn.hshape === 'centerHigh' ? 1 - d : gn.hshape === 'mixed' ? (t + 1 - d) / 2 : 1;
      let f = Fmin + (Fmax - Fmin) * sh;
      if (gn.edgeLow && low.some(e => G.segDist([x, y], e.a, e.b) < 25)) f = Math.min(f, Fmin + 5);   // 경계부 저층(가정)
      return Math.round(f);
    };
  }

  /* ---------- 동 후보(동 타입 라이브러리) ---------- */
  const FAM = id => (id === 'YF' || /^Y/.test(id) ? 'Y' : /^TJ/.test(id) ? 'T' : id === 'T4' ? 'tower' : /^B/.test(id) ? 'bent' : 'slab');
  function pool(opt) {
    const ts = Object.keys(opt.mix).filter(t => opt.mix[t] > 0);
    DL.init({ units: opt.units, lib: opt.lib, types: opt.dongTypes });
    const out = [];
    DL.catalog(ts).forEach(m => { out.push(m); if (m.form === 'L') { const mm = DL.build(m.dtype, m.seq, { mirror: true }); if (mm) out.push(mm); } });
    // 자유형 Y자는 날개 조합마다 표준·펼침·한쪽펼침만(후보가 너무 많아짐)
    const seen = new Set();
    DL.yShapes(ts).forEach(m => { const k = m.wings.join() + m.angleName + m.seq.join(); if (['표준', '펼침', '한쪽펼침'].includes(m.angleName) && m.n <= 7 && !seen.has(k)) { seen.add(k); out.push(m); } });
    out.forEach((m, i) => {
      m.key = i; m.fam = FAM(m.dtype);
      const pts = m.parts.flat(); m.hullL = G.hull(pts); m.cxL = m.L / 2; m.cyL = m.D / 2;
      m.area = m.parts.reduce((s, q) => s + Math.abs(G.area(q)), 0);
      // 칸 검사용 표본점: 조각마다 2m 간격 + 꼭짓점
      m.samples = []; m.parts.forEach(q => { const xs = q.map(p => p[0]), ys = q.map(p => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        for (let x = x0 + 0.3; x <= x1; x += 2) for (let y = y0 + 0.3; y <= y1; y += 2) if (G.inside(x, y, q)) m.samples.push([x, y]); q.forEach(p => m.samples.push(p)); });
      m.mixN = m.mixT;
    });
    return out;
  }
  // 자리 pos에 동을 놓음: anchor 'center' = 동 가운데, 'south' = 동 남쪽 변 가운데(줄 순서)
  const place = (m, pos, th, anchor) => { const c = Math.cos(th), s = Math.sin(th), oy = anchor === 'south' ? 0 : m.cyL; return p => { const x = p[0] - m.cxL, y = p[1] - oy; return [pos[0] + x * c - y * s, pos[1] + x * s + y * c]; }; };

  /* ---------- 안쪽 채우기(decode) ---------- */
  function decode(site, opt, P, M, gn) {
    const A = opt.assume, SK = skeleton(P, site, gn), HF = heightField(P, site, gn, A), cap = G.capper(site, opt);
    const occ = new Uint8Array(P.W * P.H), halo = new Uint8Array(P.W * P.H), placed = [];
    // 비워 둘 땅(1)·구획 번호를 칸마다 한 번만 계산(동을 대 볼 때마다 경계선 거리를 다시 재지 않음)
    const RES = new Uint8Array(P.W * P.H), BLK = new Uint8Array(P.W * P.H);
    for (let j = 0; j < P.H; j++) for (let i = 0; i < P.W; i++) { const k = j * P.W + i; if (!P.free[k]) continue; const x = P.X0 + i + 0.5, y = P.Y0 + j + 0.5; RES[k] = SK.reserved(x, y) ? 1 : 0; BLK[k] = SK.blockOf(x, y); }
    const ts = Object.keys(opt.mix).filter(t => opt.mix[t] > 0), wsum = ts.reduce((s, t) => s + opt.mix[t], 0), got = {}; ts.forEach(t => { got[t] = 0; });
    // 구획별 자리 목록(4m 간격, 비워 둘 땅 제외) — 구획 중심에 가까운 순
    const blocks = [];
    for (let b = 0; b < SK.k; b++) blocks.push({ b, cells: [], cx: 0, cy: 0 });
    for (let j = 0; j < P.H; j += 4) for (let i = 0; i < P.W; i += 4) {
      if (!P.free[j * P.W + i]) continue; const x = P.X0 + i + 0.5, y = P.Y0 + j + 0.5;
      const k0 = j * P.W + i; if (RES[k0]) continue; const B = blocks[BLK[k0]]; B.cells.push([x, y]); B.cx += x; B.cy += y;
    }
    // 놓는 순서: center = 구획 중심에 가까운 자리부터 / rows = 남쪽 줄부터(구획 방향 기준 4m 띠), 한 줄 안에서는 가운데부터
    blocks.forEach(B => {
      const n = B.cells.length || 1; B.cx /= n; B.cy /= n; B.angle = blockAngle(P, [B.cx, B.cy], gn.dir[B.b % gn.dir.length]);
      const th = B.angle * D2R, loc = p => G.rot([p[0] - B.cx, p[1] - B.cy], -th);
      if (gn.order === 'center') B.cells.sort((p, q) => Math.hypot(p[0] - B.cx, p[1] - B.cy) - Math.hypot(q[0] - B.cx, q[1] - B.cy));
      else B.cells.sort((p, q) => { const a = loc(p), b = loc(q); return Math.floor(a[1] / 4) - Math.floor(b[1] / 4) || Math.abs(a[0]) - Math.abs(b[0]); });
    });
    blocks.sort((a, b) => b.cells.length - a.cells.length);
    const famW = gn.fam;
    let tried = 0, orderAt = -1, ORDER = [];
    blocks.forEach(B => {
      const th = B.angle * D2R;
      B.cells.forEach(pos => {
        const ci = cellAt(P, pos[0], pos[1]); if (ci < 0 || occ[ci] || halo[ci]) return;
        const f0 = HF(pos[0], pos[1]);
        // 큰 동 → 작은 동. 형태 선호(유전자) × 면적 × 모자라는 평형을 채우는 정도
        if (orderAt !== placed.length) { orderAt = placed.length; const tot = ts.reduce((s, t) => s + got[t], 0) || 1, need = t => Math.max(0, opt.mix[t] / wsum - got[t] / tot);
          ORDER = M.filter(m => famW[m.fam] > 0.05).map(m => ({ m, s: m.area * famW[m.fam] * (1 + 3 * Object.keys(m.mixT).reduce((a, t) => a + need(t) * m.mixT[t] / m.n, 0)) })).sort((a, b) => b.s - a.s); }
        //  다듬기: 큰 동이 안 들어가면 점수 순서대로 작은 동(같은 형태 작은 호수·평형 → 다른 형태)까지 내려감.
        //  같은 크기 묶음(형태·길이·깊이 3m 단위)이 자리에서 한 번 안 맞으면 그 묶음은 건너뜀
        const failSize = new Set();
        for (const { m } of ORDER) {
          const sz = m.fam + '|' + Math.round(m.L / 3) + '|' + Math.round(m.D / 3) + '|' + (m.wings || '') + (m.angles || '') + (m.mir ? 'm' : '');
          if (failSize.has(sz)) continue;
          tried++;
          const T = place(m, pos, th, gn.order === 'center' ? 'center' : 'south');
          let ok = true;
          for (const p of m.samples) { const q = T(p), k = cellAt(P, q[0], q[1]); if (k < 0 || !P.free[k] || occ[k] || RES[k] || BLK[k] !== B.b) { ok = false; break; } }
          if (!ok) { failSize.add(sz); continue; }
          const poly = m.hullL.map(T), form = m.form === 'T' ? 'tower' : m.form;
          const floors = Math.min(f0, cap({ poly, form, angle: B.angle, inner: m.inner || 0 }));
          if (floors < A.minFloors) continue;
          const b = { id: 101 + placed.length, poly, floors, form, angle: B.angle, mixT: m.mixT, n: m.n, t: m.t, notes: m.notes || [], mod: m, T, block: B.b, parts: m.parts.map(q => q.map(T)) };
          if (placed.some(o => Math.hypot(o.poly[0][0] - poly[0][0], o.poly[0][1] - poly[0][1]) < 150 && K.pairCheck(b, o, opt))) continue;
          placed.push(b); Object.keys(m.mixT).forEach(t => { got[t] += m.mixT[t] * floors; });
          // 앞뒤 최소 간격 띠: 북쪽은 이 동 높이 × 배수(누가 오든 가목·나목 최소), 남쪽은 min(10m, 높이 × 배수). 띠 안의 자리는 바로 건너뜀
          { const hb = floors * A.floorHeight_m + A.groundExtra_m, nH = opt.spacing * hb, sH = Math.min(10, opt.spacing * hb), bb = K.bboxIn(poly, th), c = Math.cos(th), sn = Math.sin(th);
            for (let ly = bb.y0 - sH; ly <= bb.y1 + nH; ly += 1) { if (ly >= bb.y0 && ly <= bb.y1) continue; for (let lx = bb.x0; lx <= bb.x1; lx += 1) { const k = cellAt(P, lx * c - ly * sn, lx * sn + ly * c); if (k >= 0 && !occ[k]) halo[k] = 1; } } }
          // 차지한 칸 표시(동 바닥 + 1m)
          const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
          for (let y = Math.floor(Math.min(...ys)) - 1; y <= Math.max(...ys) + 1; y++) for (let x = Math.floor(Math.min(...xs)) - 1; x <= Math.max(...xs) + 1; x++) { const k = cellAt(P, x + 0.5, y + 0.5); if (k >= 0 && G.inside(x + 0.5, y + 0.5, poly)) occ[k] = 1; }
          break;
        }
      });
    });
    // 목표 용적률에 모자라면 북쪽 동부터 한 층씩 올림(높이 상한·이웃 동 간격을 다시 확인, 높이 장의 1.3배까지 — 남저북고 유지)
    const target0 = opt.lot * opt.far / 100, gfaNow = () => placed.reduce((a, b) => a + K.gfaOf({ mixT: b.mixT, floors: b.floors }, opt), 0);
    let changed = true, guard = 0;
    while (changed && gfaNow() < target0 && guard++ < 60) {
      changed = false;
      for (const b of placed.slice().sort((p, q) => Math.max(...q.poly.map(v => v[1])) - Math.max(...p.poly.map(v => v[1])))) {
        if (gfaNow() >= target0) break;
        const lim = Math.min(A.maxFloors, cap({ poly: b.poly, form: b.form, angle: b.angle, inner: b.mod.inner || 0 }), Math.round(HF(...b.poly[0]) * 1.3) + 1);
        if (b.floors + 1 > lim) continue;
        b.floors++;
        if (placed.some(o => o !== b && K.pairCheck(b, o, opt))) { b.floors--; continue; }
        changed = true;
      }
    }
    // 목표 용적률을 넘으면 층수를 같은 비율로 깎음(높이 장 모양은 유지, 깎으면 간격·일조는 더 여유로워짐)
    const gfaAt = s => placed.reduce((a, b) => a + K.gfaOf({ mixT: b.mixT, floors: Math.max(A.minFloors, Math.floor(b.f0 * s)) }, opt), 0);
    placed.forEach(b => { b.f0 = b.floors; });
    const target = opt.lot * opt.far / 100;
    if (gfaAt(1) > target) { let lo = 0, hi = 1; for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (gfaAt(mid) <= target) lo = mid; else hi = mid; } placed.forEach(b => { b.floors = Math.max(A.minFloors, Math.floor(b.f0 * lo)); }); }
    // 결과 동(월드 좌표 조각·코어·세대)
    const blds = placed.map(b => { const m = b.mod, T = b.T; return { id: b.id, poly: b.poly, floors: b.floors, form: b.form, angle: b.angle, mixT: m.mixT, n: m.n, t: m.t, seq: m.seq, dtype: m.dtype, dname: m.dname, vname: m.vname, notes: b.notes, block: b.block,
      parts: m.parts.map(q => q.map(T)), cores: m.cores.map(q => q.map(T)), units: (m.units || []).map(rs => rs.map(q => q.map(T))) }; });
    return { blds, SK, blocks: blocks.map(B => ({ b: B.b, angle: B.angle, cx: B.cx, cy: B.cy })), tried };
  }

  /* ---------- 점수 ---------- */
  //  일조: 동 정면 1층 앞 지점의 동지 일조(수인한도) 통과 비율 — 경험 항목이지만 '일조 우선안'을 고르려고 점수에도 씀
  function sunPass(blds, opt) {
    if (!blds.length) return 1;
    const tolI = (opt.crit || []).find(i => i.id === 'sun_tolerance') || { 연속_h: 2, 연속_구간: [9, 15], 합계_h: 4, 합계_구간: [8, 16] };
    const H = f => f * opt.assume.floorHeight_m + opt.assume.groundExtra_m;
    let ok = 0;
    blds.forEach(b => { const th = (b.angle || 0) * D2R, bb = K.bboxIn(b.poly, th), front = G.rot([(bb.x0 + bb.x1) / 2, bb.y0 - 1], th); if (G.sunHours(blds.filter(o => o !== b), H, +opt.lat || 37.46, [front], tolI)[0].ok) ok++; });
    return ok / blds.length;
  }
  const WEIGHTS = {
    units: { label: '세대수 우선안', far: 0.75, mix: 0.1, height: 0.05, sun: 0.1, jump: 0.01 },
    sun: { label: '일조 우선안', far: 0.35, mix: 0.1, height: 0.15, sun: 0.4, jump: 0.03 },
    balance: { label: '균형안', far: 0.45, mix: 0.15, height: 0.15, sun: 0.25, jump: 0.04 },
  };
  function score(site, opt, R, w) {
    const q = K.quick(site, R.blds, opt);
    if (!q.pass || !R.blds.length) return { fit: -1, q };
    const ev = K.evaluate(site, R.blds, opt, q), p = {}; ev.prefs.forEach(x => { p[x.id] = x.점수; });
    if (R.sun === undefined) R.sun = sunPass(R.blds, opt);
    // 층수 급변(40m 안 이웃 동 12개층 이상 차이) 쌍 수만큼 깎음 — 경관 심의 지적 위험(경험)
    if (R.jumps === undefined) { let j = 0; const B = R.blds; for (let a = 0; a < B.length; a++) for (let b = a + 1; b < B.length; b++) { if (Math.abs(B[a].floors - B[b].floors) < 12) continue; const d = Math.min(...B[a].poly.map(p2 => Math.min(...B[b].poly.map(r2 => Math.hypot(p2[0] - r2[0], p2[1] - r2[1]))))); if (d < 40) j++; } R.jumps = j; }
    const fit = w.far * p.far + w.mix * (p.mix || 0) + w.height * p.height + w.sun * R.sun - (w.jump || 0.03) * R.jumps;
    return { fit, q, prefs: p, sun: R.sun, jumps: R.jumps };
  }

  /* ---------- 바깥 반복 탐색 ---------- */
  function randGene(r, A) {
    const fam = { slab: r(), bent: r() * 0.8, tower: r() * 0.7, T: r() * 0.6, Y: r() * 0.6 }; fam[pick(r, Object.keys(fam))] += 0.6;
    const Fmax = A.minFloors + 5 + Math.floor(r() * (A.maxFloors - A.minFloors - 4));
    return { skel: pick(r, Object.keys(SKELS)), k: 1 + Math.floor(r() * 3), cuts: [0.3 + r() * 0.4, 0.55 + r() * 0.3].sort(), dir: [0, 1, 2].map(() => pick(r, ['south', 'edge', 'edge', 'tiltL', 'tiltR'])),
      order: r() < 0.75 ? 'rows' : 'center', hshape: pick(r, ['southLow', 'centerHigh', 'mixed', 'flat']), Fmax, Fmin: Math.max(A.minFloors, Fmax - 8 - Math.floor(r() * 12)), edgeLow: r() < 0.5, fam };
  }
  function mutate(r, gn, A) {
    const c = JSON.parse(JSON.stringify(gn)), w = Math.floor(r() * 8);
    if (w === 7) { c.order = c.order === 'center' ? 'rows' : 'center'; return c; }
    if (w === 0) c.skel = pick(r, Object.keys(SKELS));
    else if (w === 1) { c.k = 1 + Math.floor(r() * 3); c.cuts = c.cuts.map(x => Math.min(0.9, Math.max(0.1, x + (r() - 0.5) * 0.2))).sort(); }
    else if (w === 2) c.dir[Math.floor(r() * 3)] = pick(r, ['south', 'edge', 'tiltL', 'tiltR']);
    else if (w === 3) c.hshape = pick(r, ['southLow', 'centerHigh', 'mixed', 'flat']);
    else if (w === 4) { c.Fmax = Math.max(A.minFloors + 3, Math.min(A.maxFloors, c.Fmax + Math.round((r() - 0.5) * 10))); c.Fmin = Math.max(A.minFloors, Math.min(c.Fmax, c.Fmin + Math.round((r() - 0.5) * 8))); }
    else if (w === 5) c.edgeLow = !c.edgeLow;
    else { const f = pick(r, Object.keys(c.fam)); c.fam[f] = Math.max(0, Math.min(1.6, c.fam[f] + (r() - 0.5) * 0.8)); }
    return c;
  }
  // plan: 세 가지 무게로 각각 반복 탐색(같은 구도는 한 번만 계산해 같이 씀) → 세대수 우선안·일조 우선안·균형안
  //  o.pop 무리 크기, o.gens 세대 수(반복 100회 안팎: pop 12 + gens 7 × 자식 8 ≈ 70회 × 세 무게, 겹치는 구도는 다시 안 셈)
  function plan(site, opt, o) {
    o = Object.assign({ seed: 7, pop: 16, gens: 10, kids: 10, elite: 4 }, o || {});
    const t0 = Date.now(), P = prep(site, opt), M = pool(opt), A = opt.assume, cache = new Map(), r = rng(o.seed);
    const run = gn => { const k = JSON.stringify(gn); if (!cache.has(k)) cache.set(k, decode(site, opt, P, M, gn)); return cache.get(k); };
    const out = {};
    Object.keys(WEIGHTS).forEach(wk => {
      const w = WEIGHTS[wk];
      // 첫 탐색(세대수)은 무작위로 시작, 다음 탐색은 지금까지 계산한 구도 중 이 무게로 좋은 것 + 무작위로 시작(세대수 많은 안 근처에서 일조·균형이 좋은 안을 찾음)
      let popl = [];
      if (cache.size) {
        const prev = [...cache.entries()].filter(([, R]) => R.blds.length).map(([k, R]) => ({ gn: JSON.parse(k), f: score(site, opt, R, w).fit })).sort((a, b) => b.f - a.f).slice(0, Math.ceil(o.pop / 2));
        popl = prev.map(x => x.gn);
      }
      while (popl.length < o.pop) popl.push(randGene(r, A));
      let scored = popl.map(gn => { const R = run(gn); return { gn, R, s: score(site, opt, R, w) }; });
      for (let gi = 0; gi < o.gens; gi++) {
        scored.sort((a, b) => b.s.fit - a.s.fit); const el = scored.slice(0, o.elite);
        const kids = []; for (let i = 0; i < o.kids; i++) { const pa = pick(r, el).gn, pb = pick(r, el).gn, ch = mutate(r, r() < 0.5 ? pa : Object.assign({}, pa, { hshape: pb.hshape, Fmax: pb.Fmax, Fmin: pb.Fmin }), A); kids.push(ch); }
        scored = el.concat(kids.map(gn => { const R = run(gn); return { gn, R, s: score(site, opt, R, w) }; }));
      }
    });
    // 세 탐색에서 계산한 구도를 모두 모아 무게별로 고름. 일조·균형안은 용적률 최고 안의 85% 이상인 것만(세대가 반토막 난 안은 쓸모없음)
    const all = [...cache.entries()].map(([k, R]) => ({ gn: JSON.parse(k), R })).filter(x => x.R.blds.length);
    all.forEach(x => { x.q = K.quick(site, x.R.blds, opt); x.far = x.q.far; });
    const okAll = all.filter(x => x.q.pass), maxFar = Math.max(0, ...okAll.map(x => x.far));
    const used = new Set(), sig = R => R.blds.map(b => b.dtype + b.floors + Math.round(b.poly[0][0]) + Math.round(b.poly[0][1])).sort().join('|');
    Object.keys(WEIGHTS).forEach(wk => {
      const w = WEIGHTS[wk];
      for (const th of wk === 'units' ? [0] : [0.85, 0.75, 0.6, 0]) {
        let best = null;
        okAll.filter(x => x.far >= maxFar * th && !used.has(sig(x.R))).forEach(x => { const sc = score(site, opt, x.R, w); if (!best || sc.fit > best.s.fit) best = { gn: x.gn, R: x.R, s: sc }; });
        if (best) { out[wk] = best; used.add(sig(best.R)); break; }
      }
    });
    // 결과 정리 + 정밀 검증(경험 항목: 원인·영향·대안)
    const variants = Object.keys(out).filter(wk => out[wk]).map(wk => {
      const { gn, R, s } = out[wk], v = K.verify(site, R.blds, opt);
      return { key: wk, label: WEIGHTS[wk].label, genome: gn, skeleton: SKELS[gn.skel], buildings: R.blds, blocks: R.blocks, skel: R.SK,
        far: v.far, bcr: v.bcr, gfa: v.gfa, units: v.units, rules: v.rules, risks: v.risks, prefs: v.prefs, sunPass: s.sun, fit: s.fit,
        byType: (() => { const o2 = {}; R.blds.forEach(b => Object.keys(b.mixT).forEach(t => { o2[t] = (o2[t] || 0) + b.mixT[t] * b.floors; })); return o2; })(),
        maxFloors: R.blds.length ? Math.max(...R.blds.map(b => b.floors)) : 0 };
    });
    return { variants, decodes: cache.size, ms: Date.now() - t0, pool: M.length };
  }

  const api = { plan, decode, prep, pool, skeleton, heightField, SKELS, WEIGHTS, rng };
  if (NODE) module.exports = api; else g.JbsPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
