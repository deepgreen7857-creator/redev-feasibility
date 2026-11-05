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
  const TYPES = ['P4', 'P6', 'P8', 'P10', 'B3', 'B4', 'B5', 'T4'];

  // 방향 후보(2026-11-05 사용자 '정남향을 고집할거야?'): 정남(0°)·남동/남서 15°·30°와 긴 경계 변 두 개의 방향(±45° 안). 남향에서 멀어질수록 남향 점수·일조는 불리
  function angles(site) {
    const E = G.edges(site.pts).slice().sort((a, b) => b.len - a.len), out = [0, -15, 15, -30, 30];
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
            best = { val: v, Flo, Fhi, spread, F: Fhi, th, seq, m: mLow, blds: bl, gapX: gapXOf(Flo), gapY: Math.max(10, sp * H(Flo)), rows: bestY.rows, Gd };
        }
      }
      if (best) per.push(Object.assign(best, { e: mixErrOf(best.blds, opt) }));
    }
    if (!per.length) return null;
    const top = Math.max(...per.map(x => x.val)), best = per.filter(x => x.val >= top * 0.9).sort((a, b) => a.e - b.e || b.val - a.val)[0];
    best.blds.sort((a, b) => a.row - b.row || a.poly[0][0] - b.poly[0][0]).forEach((b, i) => { b.id = 101 + i; });
    return best;
  }

  /* ---------- 진단 → 보완(2026-11-05 사용자 결정: '기본형부터 무조건 돌리고, 무엇이 모자란지 보고 섞는 것을 넣자') ----------
     진단: 줄 안 빈 길이(동 + 옆 간격을 빼고 남은 건축 가능 길이), 평형 비율 차이, 목표 연면적 대비 부족
     보완(진단에 걸린 것만, 순서대로 — 단계마다 전후 숫자를 남김)
       ① 줄 끝 채우기: 빈 길이에 같은 계열의 짧은 동(판상은 호수가 적은 판상, ㄱ자는 판상 2호)을 같은 줄 앞선에 맞춰 넣음. 깊이 ≤ 그 줄 동 깊이(뒷줄 간격 그대로)
       ② 평형 맞추기: 평형 비율이 어긋나면 같은 동 타입 안에서 다른 평형 배열로 바꿔 끼움(옆 간격·대지·동 사이 거리 다시 확인, 연면적은 95% 이상 유지) */
  function improve(site, opt, base, o) {
    o = o || {};
    const A = opt.assume, sp = opt.spacing, H = f => f * A.floorHeight_m + A.groundExtra_m, sup = t => { const u = opt.units[t]; return +u.공급 > 0 ? +u.공급 : u.전용 * A.supplyFactor; };
    const target = opt.lot * opt.far / 100, cap = G.capper(site, opt), Gd = base.Gd, th = base.th;
    const gfaOf = bs => bs.reduce((a, b) => a + Object.keys(b.mixT).reduce((c, t) => c + b.mixT[t] * b.floors * sup(t), 0), 0);
    const ts = Object.keys(opt.mix).filter(t => opt.mix[t] > 0);
    const loc = p => G.rot(p, -Gd.r);
    const xr = b => { const xs = b.parts.flat().map(p => loc(p)[0]); return [Math.min(...xs), Math.max(...xs)]; };
    const sideGap = (a, b, f) => (a.form === 'slab' && b.form === 'slab' ? A.sideGap_m : Math.max(A.sideGap_m, sp * H(f)));
    const mk = (m, x, y, f, row) => { const W = p => G.rot([x + p[0], y + p[1]], Gd.r), poly = G.hull(m.parts.flat().map(W)), walls = G.wallsTo(G.wallsOf(m), W, Gd.r);
      const fl = Math.min(f, cap({ poly, form: m.form, angle: th, walls })); if (fl < A.minFloors) return null;
      return { id: 0, poly, floors: fl, form: m.form, angle: th, mixT: m.mixT, n: m.n, t: m.t, seq: m.seq, dtype: m.dtype, dname: m.dname, vname: m.vname, notes: m.notes || [], block: 0, row,
        parts: m.parts.map(q => q.map(W)), cores: m.cores.map(q => q.map(W)), units: (m.units || []).map(rs => rs.map(q => q.map(W))), walls }; };
    let blds = base.blds.slice();
    const rowsY = base.rows.map((r, i) => ({ i, y: r.y, f: r.f, D: r.m.D, form: r.m.form }));
    // 진단
    const diag = () => {
      let empty = 0;
      rowsY.forEach(R => {
        const ivs = blds.filter(b => b.row === R.i).map(b => { const [a, c] = xr(b); return [a - base.gapX, c + base.gapX]; });
        for (let x = Math.floor(Gd.xmin); x < Gd.xmax; x++) if (Gd.free(x, R.y, x + 1, R.y + R.D) && !ivs.some(([a, c]) => x + 1 > a && x < c)) empty++;
      });
      const g = gfaOf(blds);
      return { empty, mixErr: mixErrOf(blds, opt), gfa: g, far: g / opt.lot * 100, short: Math.max(0, target - g), units: blds.reduce((a, b) => a + b.n * b.floors, 0), n: blds.length };
    };
    const steps = [Object.assign({ name: '기본형', why: '' }, diag())];
    // ① 줄 끝 채우기
    const fillerIds = base.m.form === 'slab' ? ['P2', 'P4', 'P6', 'P8', 'P10'].filter(id => { const T = (opt.dongTypes.타입 || []).find(x => x.id === id); return T && T.호수 < base.m.n; }) : base.m.form === 'L' ? ['P2', 'P4'] : [];
    if (fillerIds.length && steps[0].empty >= 15 && steps[0].short > 0) {
      const fillers = [];
      fillerIds.forEach(id => seqFor(id, opt).forEach(seq => { const m = DL.build(id, seq); if (m) fillers.push(m); }));
      fillers.sort((a, b) => b.L - a.L);
      rowsY.forEach(R => {
        let x = Math.floor(Gd.xmin);
        while (x < Gd.xmax) {
          let put = null;
          for (const m of fillers) {
            if (m.D > R.D + 0.01 || x + m.L > Gd.xmax || !fits(Gd, m, x, R.y)) continue;
            const row = blds.filter(b => b.row === R.i);
            if (row.some(b => { const [a, c] = xr(b), g = sideGap(m, b, Math.max(R.f, b.floors)); return x < c + g && x + m.L > a - g; })) continue;
            const nb = mk(m, x, R.y, R.f, R.i); if (!nb) continue;
            if (blds.some(o2 => K.pairCheck(nb, o2, opt))) continue;
            put = { nb, L: m.L }; break;
          }
          if (put) { blds.push(put.nb); x += Math.ceil(put.L) + 1; if (gfaOf(blds) >= target) break; } else x += 1;
        }
      });
      const d = diag(); if (d.n > steps[steps.length - 1].n) steps.push(Object.assign({ name: '줄 끝 채우기', why: `줄 안 빈 길이 ${steps[0].empty}m → 같은 계열 짧은 동(${fillerIds.join('·')})으로 채움` }, d));
    }
    // ② 평형 맞추기
    const e0 = mixErrOf(blds, opt);
    if (e0 > 0.15) {
      const gfa0 = gfaOf(blds), alts = {};
      const altOf = id => alts[id] || (alts[id] = DL.assignments(id, ts).map(seq => DL.build(id, seq)).filter(Boolean));
      for (let it = 0; it < 3; it++) {
        let changed = false;
        for (let i = 0; i < blds.length; i++) {
          const b = blds[i], R = rowsY[b.row], [a0, c0] = xr(b), others = blds.filter(o2 => o2 !== b);
          let room = Infinity; others.filter(o2 => o2.row === b.row).forEach(o2 => { const [a, c] = xr(o2); if (a >= c0) room = Math.min(room, a - c0 - sideGap(b, o2, Math.max(b.floors, o2.floors))); });
          const cur = mixErrOf(blds, opt);
          let bestSwap = null;
          for (const m of altOf(b.dtype)) {
            if (m.seq.join() === b.seq.join() || m.D > R.D + 0.01 || m.L > (c0 - a0) + Math.max(0, room) + 0.01) continue;
            const x = a0 - (m.parts.flat().reduce((mn, p) => Math.min(mn, p[0]), Infinity));
            if (!fits(Gd, m, x, R.y)) continue;
            const nb = mk(m, x, R.y, R.f, b.row); if (!nb) continue;
            const trial = others.concat([nb]), e = mixErrOf(trial, opt);
            if (e < cur - 0.01 && gfaOf(trial) >= gfa0 * 0.95 && !others.some(o2 => K.pairCheck(nb, o2, opt)) && (!bestSwap || e < bestSwap.e)) bestSwap = { nb, e };
          }
          if (bestSwap) { blds[i] = bestSwap.nb; changed = true; }
        }
        if (!changed) break;
      }
      const d = diag(); if (d.mixErr < e0 - 0.01) steps.push(Object.assign({ name: '평형 맞추기', why: `평형 비율 차이 ${e0.toFixed(2)} → 같은 모양 안에서 평형 배열을 바꿔 끼움` }, d));
    }
    // 목표를 넘으면 남쪽 줄 가장자리부터 뺌
    if (gfaOf(blds) > target) { const cx = blds.reduce((a, b) => a + b.poly[0][0], 0) / blds.length; blds.sort((a, b) => a.row - b.row || Math.abs(b.poly[0][0] - cx) - Math.abs(a.poly[0][0] - cx)); while (blds.length > 1 && gfaOf(blds) > target) blds.shift(); }
    blds.sort((a, b) => a.row - b.row || a.poly[0][0] - b.poly[0][0]).forEach((b, i) => { b.id = 101 + i; });
    return { blds, steps };
  }

  function simple(site, opt, o) {
    o = o || {};
    const t0 = Date.now(), types = o.types || TYPES;
    DL.init({ units: opt.units, lib: opt.lib, types: opt.dongTypes });
    const out = [];
    types.forEach(id => {
      const r = one(site, opt, id, o); if (!r) return;
      const pack = (blds, label, extra) => { const v = K.verify(site, blds, opt), byType = {};
        blds.forEach(b => Object.keys(b.mixT).forEach(t => { byType[t] = (byType[t] || 0) + b.mixT[t] * b.floors; }));
        return Object.assign({ key: id, label, mixErr: mixErrOf(blds, opt), dtype: id, seq: r.seq, angle: r.th, F: r.F, Flo: r.Flo, Fhi: r.Fhi, gapX: r.gapX, gapY: r.gapY, buildings: blds,
          far: v.far, bcr: v.bcr, gfa: v.gfa, units: v.units, rules: v.rules, risks: v.risks, prefs: v.prefs, byType, maxFloors: Math.max(...blds.map(b => b.floors)) }, extra || {}); };
      const im = o.improve === false ? null : improve(site, opt, r, o);
      out.push(pack(r.blds, `기본 배치 — ${r.m.dname}`, { improved: im && im.steps.length > 1 ? pack(im.blds, `기본 + 보완 — ${r.m.dname}`, { steps: im.steps }) : null, steps: im ? im.steps.slice(0, 1) : [] }));
    });
    return { variants: out, ms: Date.now() - t0 };
  }

  const api = { simple, one, improve, angles, seqFor, mixErrOf, TYPES };
  if (NODE) module.exports = api; else g.JbsSimple = api;
})(typeof window !== 'undefined' ? window : globalThis);
