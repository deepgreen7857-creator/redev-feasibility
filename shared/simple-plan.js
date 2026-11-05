'use strict';
// 기본 배치(JbsSimple, 2026-11-05 사용자 결정 '심화 전에 기본부터: 같은 모양 동을 일정하게 배치'):
//  동 타입 하나(판상 4·6·8·10호, ㄱ자 3호, 탑상 4호 …)를 바둑판처럼 같은 간격으로 놓음
//   줄 간격(남북) = 동 깊이 + 법정 동 사이 거리(같은 층수 → 나목: 10m 이상, 높이 × 배수)
//   옆 간격(동서) = 판상끼리 가정 옆 간격(sideGap_m, 법정 마목 4m 이상), ㄱ자·탑상처럼 옆 벽에 창이 있으면 높이 × 배수(가목, 법제처 21-0403)
//   줄마다 좌우 시작 위치만 맞춤(줄은 나란히) → 층수 F(전 동 같게, 높이 상한에 걸리는 동만 낮춤)·줄 시작 높이·방향을 바꿔 가며 가장 많이 들어가는 안
//  평형 배열은 동 타입마다 조합 규칙을 지키는 배열 하나를 모든 동에 똑같이 씀(평형 비율이 가장 가까운 것)
//  결과 동은 site-plan(심화)과 같은 꼴 → arch-check(규칙·경험)·치수선·배치도를 그대로 씀
(function (g) {
  const NODE = typeof module !== 'undefined' && module.exports;
  const G = NODE ? require('./arch-geom.js') : g.ArchGeom, K = NODE ? require('./arch-check.js') : g.JbsCheck, DL = NODE ? require('./dong-lib.js') : g.JbsDong;
  const D2R = Math.PI / 180;
  const TYPES = ['P4', 'P6', 'P8', 'P10', 'B3', 'T4'];

  // 방향 후보: 정남(0°)과 가장 긴 경계 변 방향(±45° 안)
  function angles(site) {
    const E = G.edges(site.pts).slice().sort((a, b) => b.len - a.len), out = [0];
    E.slice(0, 2).forEach(e => { let th = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) / D2R; th = ((th % 180) + 180) % 180; if (th > 90) th -= 180; if (Math.abs(th) <= 45 && out.every(a => Math.abs(a - th) > 3)) out.push(Math.round(th)); });
    return out;
  }
  // 방향 th(도) 좌표계의 1m 격자 누적합(건축 가능 = 대지 안·변별 이격 밖·기반시설 밖)
  function gridAt(site, opt, th) {
    const test = G.buildableTest(site.pts, site.setbacks || []), ex = site.exclude || [], r = th * D2R;
    const L = site.pts.map(p => G.rot(p, -r)), xs = L.map(p => p[0]), ys = L.map(p => p[1]);
    const X0 = Math.floor(Math.min(...xs)), Y0 = Math.floor(Math.min(...ys)), W = Math.ceil(Math.max(...xs)) - X0 + 1, H = Math.ceil(Math.max(...ys)) - Y0 + 1;
    const S = new Int32Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j++) { let row = 0; for (let i = 0; i < W; i++) { const bad = [[0.5, 0.5], [0, 0], [1, 0], [1, 1], [0, 1]].some(([a, b]) => { const p = G.rot([X0 + i + a, Y0 + j + b], r); return !test(p[0], p[1]) || ex.some(e => G.inside(p[0], p[1], e)); }); if (bad) row++; S[(j + 1) * (W + 1) + i + 1] = S[j * (W + 1) + i + 1] + row; } }
    const free = (x0, y0, x1, y1) => { const i0 = Math.floor(x0 - X0), j0 = Math.floor(y0 - Y0), i1 = Math.ceil(x1 - X0), j1 = Math.ceil(y1 - Y0); if (i0 < 0 || j0 < 0 || i1 > W || j1 > H) return false; return S[j1 * (W + 1) + i1] - S[j0 * (W + 1) + i1] - S[j1 * (W + 1) + i0] + S[j0 * (W + 1) + i0] === 0; };
    return { X0, Y0, W, H, free, r, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
  }
  const bbs = m => m.__bbs || (m.__bbs = m.parts.map(q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))]));
  const fits = (Gd, m, x, y) => bbs(m).every(b => Gd.free(x + b[0], y + b[1], x + b[2], y + b[3]));

  // 평형 비율이 목표에 가장 가까운 배열(같은 차이면 큰 평형 먼저)
  function seqFor(id, opt) {
    const ts = Object.keys(opt.mix).filter(t => opt.mix[t] > 0), ws = ts.reduce((s, t) => s + opt.mix[t], 0) || 1;
    const err = a => { const c = {}; a.forEach(t => { c[t] = (c[t] || 0) + 1; }); return ts.reduce((e, t) => e + Math.abs((c[t] || 0) / a.length - opt.mix[t] / ws), 0) + Object.keys(c).filter(t => !ts.includes(t)).length; };
    return DL.assignments(id, ts).map(a => ({ a, e: err(a) })).sort((x, y) => x.e - y.e || y.a.reduce((s, t) => s + +t, 0) - x.a.reduce((s, t) => s + +t, 0)).slice(0, 3).map(x => x.a);
  }

  // 평형 비율 차이(세대 기준, 0~2)
  function mixErrOf(blds, opt) {
    const ts = Object.keys(opt.mix).filter(t => opt.mix[t] > 0), ws = ts.reduce((s, t) => s + opt.mix[t], 0) || 1, c = {}; let tot = 0;
    blds.forEach(b => Object.keys(b.mixT).forEach(t => { c[t] = (c[t] || 0) + b.mixT[t] * b.floors; tot += b.mixT[t] * b.floors; }));
    return [...new Set(ts.concat(Object.keys(c)))].reduce((e, t) => e + Math.abs((c[t] || 0) / (tot || 1) - (opt.mix[t] || 0) / ws), 0);
  }
  // 동 타입 하나로 기본 배치
  function one(site, opt, id, o) {
    const A = opt.assume, sp = opt.spacing, H = f => f * A.floorHeight_m + A.groundExtra_m, sup = t => { const u = opt.units[t]; return +u.공급 > 0 ? +u.공급 : u.전용 * A.supplyFactor; };
    const target = opt.lot * opt.far / 100, cap = G.capper(site, opt);
    // 평형 배열마다 따로 가장 좋은 배치를 찾은 뒤, 연면적이 최고의 90% 이상인 것 중 평형 비율이 가장 맞는 배열(2026-11-05: 연면적만 보면 114형만 넣은 배열을 고름)
    const per = [];
    const seqs = seqFor(id, opt);
    for (const seq of seqs) {
      let best = null;
      const mLow = DL.build(id, seq), mHigh = DL.build(id, seq, { high: true }); if (!mLow) continue;
      const side = mLow.form === 'slab' ? 'slab' : 'win';
      for (const th of o.angles || angles(site)) {
        const Gd = gridAt(site, opt, th);
        // 층수: 줄마다 남쪽 낮게 → 북쪽 높게(Flo → Fhi, 같으면 모두 같은 층수). 줄 간격은 남쪽 줄 층수로(북쪽 줄이 같거나 높음 → 나목: 10m 이상, 남쪽 동 높이 × 배수)
        const FS = []; for (let f = A.minFloors; f <= A.maxFloors; f += f < 15 ? 2 : 3) FS.push(f); if (FS[FS.length - 1] !== A.maxFloors) FS.push(A.maxFloors);
        for (const Flo of FS) for (const Fhi of FS) {
          if (Fhi < Flo) continue;
          const fAt = y => Math.round(Flo + (Fhi - Flo) * Math.max(0, Math.min(1, (y - Gd.ymin) / ((Gd.ymax - Gd.ymin) || 1))));
          const modOf = f => (f >= 16 && mHigh ? mHigh : mLow), gapXOf = f => (side === 'slab' ? A.sideGap_m : Math.max(A.sideGap_m, sp * H(f)));
          const gfaDong = (m, f) => Object.keys(m.mixT).reduce((a, t) => a + m.mixT[t] * f * sup(t), 0);
          let bestY = null;
          const p0 = modOf(Flo).D + Math.max(10, sp * H(Flo));
          for (let oy = 0; oy < p0; oy += 2) {
            const rows = []; let est = 0;
            for (let y = Gd.ymin + oy; ;) {
              const f = fAt(y), m = modOf(f); if (y + m.D > Gd.ymax) break;
              const pX = m.L + gapXOf(f); let bx = null;
              for (let ox = 0; ox < pX; ox += 2) { const xs = []; for (let x = Gd.xmin + ox; x + m.L <= Gd.xmax; x += pX) if (fits(Gd, m, x, y)) xs.push(x); if (!bx || xs.length > bx.length) bx = xs; }
              if (bx && bx.length) { rows.push({ y, xs: bx, f, m }); est += bx.length * gfaDong(m, f); y += m.D + Math.max(10, sp * H(f)); }
              else y += 2;   // 이 높이엔 안 들어감 → 2m 위로
            }
            if (!bestY || Math.min(est, target) > Math.min(bestY.est, target) + 1) bestY = { oy, rows, est };
          }
          if (!bestY || !bestY.rows.length) continue;
          // 실제 동 만들기: 높이 상한(정북·채광창)에 걸리는 동만 낮추고, 최저 층수 밑이면 뺌
          const blds = [];
          bestY.rows.forEach((row, ri) => { const m = row.m, walls0 = G.wallsOf(m); row.xs.forEach(x => {
            const W = p => G.rot([x + p[0], row.y + p[1]], Gd.r), poly = G.hull(m.parts.flat().map(W)), walls = G.wallsTo(walls0, W, Gd.r);
            const fl = Math.min(row.f, cap({ poly, form: m.form, angle: th, walls }));
            if (fl < A.minFloors) return;
            blds.push({ id: 0, poly, floors: fl, form: m.form, angle: th, mixT: m.mixT, n: m.n, t: m.t, seq: m.seq, dtype: m.dtype, dname: m.dname, vname: m.vname, notes: m.notes || [], block: 0, row: ri,
              parts: m.parts.map(q => q.map(W)), cores: m.cores.map(q => q.map(W)), units: (m.units || []).map(rs => rs.map(q => q.map(W))), walls });
          }); });
          if (!blds.length) continue;
          // 목표 연면적을 넘으면 남쪽 줄·가장자리 동부터 뺌(남측 개방) — 같은 모양·같은 간격은 그대로
          const gfaOf = bs => bs.reduce((a, b) => a + Object.keys(b.mixT).reduce((c, t) => c + b.mixT[t] * b.floors * sup(t), 0), 0);
          let bl = blds.slice();
          if (gfaOf(bl) > target) { const cx = bl.reduce((a, b) => a + b.poly[0][0], 0) / bl.length; bl.sort((a, b) => a.row - b.row || Math.abs(b.poly[0][0] - cx) - Math.abs(a.poly[0][0] - cx)); while (bl.length > 1 && gfaOf(bl) > target) bl.shift(); }
          const v = Math.min(gfaOf(bl), target), spread = Fhi - Flo;
          // 연면적(목표까지) 큰 것 → 같으면 층수 차이 작은 것(더 일정) → 낮은 최고 층수
          if (!best || v > best.val + 1 || (Math.abs(v - best.val) <= 1 && (spread < best.spread || (spread === best.spread && Fhi < best.Fhi))))
            best = { val: v, Flo, Fhi, spread, F: Fhi, th, seq, m: mLow, blds: bl, gapX: gapXOf(Flo), gapY: Math.max(10, sp * H(Flo)) };
        }
      }
      if (best) per.push(Object.assign(best, { e: mixErrOf(best.blds, opt) }));
    }
    if (!per.length) return null;
    const top = Math.max(...per.map(x => x.val)), best = per.filter(x => x.val >= top * 0.9).sort((a, b) => a.e - b.e || b.val - a.val)[0];
    best.blds.sort((a, b) => a.row - b.row || a.poly[0][0] - b.poly[0][0]).forEach((b, i) => { b.id = 101 + i; });
    return best;
  }

  function simple(site, opt, o) {
    o = o || {};
    const t0 = Date.now(), types = o.types || TYPES;
    DL.init({ units: opt.units, lib: opt.lib, types: opt.dongTypes });
    const out = [];
    types.forEach(id => {
      const r = one(site, opt, id, o); if (!r) return;
      const v = K.verify(site, r.blds, opt), byType = {};
      r.blds.forEach(b => Object.keys(b.mixT).forEach(t => { byType[t] = (byType[t] || 0) + b.mixT[t] * b.floors; }));
      out.push({ key: id, label: `기본 배치 — ${r.m.dname}`, mixErr: r.e, dtype: id, seq: r.seq, angle: r.th, F: r.F, Flo: r.Flo, Fhi: r.Fhi, gapX: r.gapX, gapY: r.gapY, buildings: r.blds,
        far: v.far, bcr: v.bcr, gfa: v.gfa, units: v.units, rules: v.rules, risks: v.risks, prefs: v.prefs, byType, maxFloors: Math.max(...r.blds.map(b => b.floors)) });
    });
    return { variants: out, ms: Date.now() - t0 };
  }

  const api = { simple, one, angles, seqFor, TYPES };
  if (NODE) module.exports = api; else g.JbsSimple = api;
})(typeof window !== 'undefined' ? window : globalThis);
