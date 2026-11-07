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
  const TYPES = ['P2', 'P4', 'P6', 'P8', 'P10', 'B3', 'B4', 'B5', 'T4'];

  // 방향 후보(2026-11-05 사용자 '정남향을 고집할거야?'): 정남(0°)·남동/남서 15°·30°와 긴 경계 변 두 개의 방향(±45° 안). 남향에서 멀어질수록 남향 점수·일조는 불리
  function angles(site) {
    const E = G.edges(site.pts).slice().sort((a, b) => b.len - a.len), out = [0, -15, 15, -30, 30];
    E.slice(0, 2).forEach(e => { let th = Math.atan2(e.b[1] - e.a[1], e.b[0] - e.a[0]) / D2R; th = ((th % 180) + 180) % 180; if (th > 90) th -= 180; if (Math.abs(th) <= 45 && out.every(a => Math.abs(a - th) > 3)) out.push(Math.round(th)); });
    return out;
  }
  // 방향 th(도) 좌표계의 1m 격자 누적합(건축 가능 = 대지 안·변별 이격 밖·기반시설 밖)
  // 같은 대지·같은 방향 격자는 한 번만(동 타입·평형 배열마다 다시 만들지 않음)
  const GRIDC = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  function gridAt(site, opt, th) {
    let byTh = GRIDC && GRIDC.get(site); const key = th + '|' + JSON.stringify(site.setbacks || []) + '|' + JSON.stringify((site.exclude || []).concat(site.keep || []).map(e => e.map(p => [Math.round(p[0]), Math.round(p[1])])));   // 개수만 보면 출입구를 옮겨도 예전 격자를 씀
    if (byTh && byTh.has(key)) return byTh.get(key);
    const test = G.buildableTest(site.pts, site.setbacks || []), ex = (site.exclude || []).concat(site.keep || []), r = th * D2R;
    const L = site.pts.map(p => G.rot(p, -r)), xs = L.map(p => p[0]), ys = L.map(p => p[1]);
    const X0 = Math.floor(Math.min(...xs)), Y0 = Math.floor(Math.min(...ys)), W = Math.ceil(Math.max(...xs)) - X0 + 1, H = Math.ceil(Math.max(...ys)) - Y0 + 1;
    const okAt = (x, y) => { const p = G.rot([x, y], r); return test(p[0], p[1]) && !ex.some(e => G.inside(p[0], p[1], e)); };
    // 칸 꼭짓점은 이웃 칸과 같이 쓰므로 한 번씩만 검사
    const V = new Uint8Array((W + 1) * (H + 1)); for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) V[j * (W + 1) + i] = okAt(X0 + i, Y0 + j) ? 1 : 0;
    const S = new Int32Array((W + 1) * (H + 1));
    for (let j = 0; j < H; j++) { let row = 0; for (let i = 0; i < W; i++) {
      const k = j * (W + 1) + i, bad = !V[k] || !V[k + 1] || !V[k + W + 1] || !V[k + W + 2] || !okAt(X0 + i + 0.5, Y0 + j + 0.5); if (bad) row++; S[(j + 1) * (W + 1) + i + 1] = S[j * (W + 1) + i + 1] + row; } }
    const free = (x0, y0, x1, y1) => { const i0 = Math.floor(x0 - X0), j0 = Math.floor(y0 - Y0), i1 = Math.ceil(x1 - X0), j1 = Math.ceil(y1 - Y0); if (i0 < 0 || j0 < 0 || i1 > W || j1 > H) return false; return S[j1 * (W + 1) + i1] - S[j0 * (W + 1) + i1] - S[j1 * (W + 1) + i0] + S[j0 * (W + 1) + i0] === 0; };
    const g2 = { X0, Y0, W, H, free, r, xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) };
    if (GRIDC) { if (!byTh) { byTh = new Map(); GRIDC.set(site, byTh); } byTh.set(key, g2); }
    return g2;
  }
  const bbs = m => m.__bbs || (m.__bbs = m.parts.map(q => [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))]));
  const fits = (Gd, m, x, y) => Gd.free(x, y, x + m.L, y + m.D) || bbs(m).every(b => Gd.free(x + b[0], y + b[1], x + b[2], y + b[3]));

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
      // ㄱ자 날개 방향 맞추기(2026-11-05): 두 동씩 짝지어 왼쪽 동은 날개를 서쪽(거울상), 오른쪽 동은 동쪽으로 → 짝 안쪽은 창 없는 옆벽끼리(가정 옆 간격), 짝과 짝 사이만 날개 창 기준(높이 × 배수)
      const isL = mLow.form === 'L', mLowM = isL ? DL.build(id, seq, { mirror: true }) : null, mHighM = isL ? DL.build(id, seq, { high: true, mirror: true }) : null;
      // 엇갈려 놓기(2026-11-06, 실제 정비계획 대조 — 2세대 판상 39층을 25~30m 간격으로 비껴 놓은 배치): 판상만, 줄마다 반 칸씩 밀어
      //  위아래 줄 동이 좌우로 겹치지 않게(벽면 직각 방향으로 마주 보지 않음 → 법정 동 사이 거리 대상 아님) → 줄 간격은 모서리 근접 기준과 두 줄 건너(같은 칸) 앞뒤 거리로
      for (const stag of (mLow.form === 'slab' && o.stagger !== false ? [false, true] : [false]))
      for (const pair of (isL && mLowM && !stag ? [false, true] : [false]))
      for (const th of o.angles || angles(site)) {
        const Gd = gridAt(site, opt, th), ROWC = new Map();   // 줄 결과 기억(같은 높이·층수 줄은 한 번만)
        // 층수: 줄마다 남쪽 낮게 → 북쪽 높게(Flo → Fhi, 같으면 모두 같은 층수). 줄 간격은 남쪽 줄 층수로(북쪽 줄이 같거나 높음 → 나목: 10m 이상, 남쪽 동 높이 × 배수)
        const FS = []; for (let f = A.minFloors; f <= A.maxFloors; f += f < 15 ? 2 : 3) FS.push(f); if (FS[FS.length - 1] !== A.maxFloors) FS.push(A.maxFloors);
        for (const Flo of FS) for (const Fhi of FS) {
          if (Fhi < Flo) continue;
          const fAt = y => Math.round(Flo + (Fhi - Flo) * Math.max(0, Math.min(1, (y - Gd.ymin) / ((Gd.ymax - Gd.ymin) || 1))));
          const modOf = f => (f >= 16 && mHigh ? mHigh : mLow), gapXOf = f => (side === 'slab' ? A.sideGap_m : Math.max(A.sideGap_m, sp * H(f)));
          const gfaDong = (m, f) => Object.keys(m.mixT).reduce((a, t) => a + m.mixT[t] * f * sup(t), 0);
          let bestY = null;
          const p0 = modOf(Flo).D + Math.max(10, sp * H(Flo));
          const mirOf = f => (f >= 16 && mHighM ? mHighM : mLowM);
          const rowAt = (y, f, m, pX) => { const k = Math.round(y * 2) + '|' + f; let bx = ROWC.get(k); if (bx !== undefined) return bx; bx = null;
            if (!pair) { for (let ox = 0; ox < pX; ox += 2) { const xs = []; for (let x = Gd.xmin + ox; x + m.L <= Gd.xmax; x += pX) if (fits(Gd, m, x, y)) xs.push({ x, m }); if (!bx || xs.length > bx.length) bx = xs; } }
            else { const mm = mirOf(f), gS = A.sideGap_m, gB = Math.max(A.sideGap_m, sp * H(f)), pP = 2 * m.L + gS + gB;
              for (let ox = 0; ox < pP; ox += 2) { const xs = []; let k2 = 0; for (let x = Gd.xmin + ox; x + m.L <= Gd.xmax; k2++) { const mk = k2 % 2 ? m : mm; if (fits(Gd, mk, x, y)) xs.push({ x, m: mk }); x += m.L + (k2 % 2 ? gB : gS); } if (!bx || xs.length > bx.length) bx = xs; } }
            ROWC.set(k, bx); return bx; };
          const CN = (A.corner && A.corner.mode) || 'off';
          // 엇갈림 줄 간격: 옆 틈(반 칸 − 동 길이) dx, 모서리 기준을 만족하는 가장 작은 앞뒤 틈 dy + 두 줄 건너(같은 칸) 법정 앞뒤 거리
          const stagDy = (m, f, dx) => { const big = Math.max(10, 0.5 * H(f)); let dy = 0;
            if (CN === 'min10') dy = Math.sqrt(Math.max(0, 100 - dx * dx));
            else if (CN === 'rec') { const a = Math.sqrt(Math.max(0, 100 - dx * dx)); dy = a < dx - 0.01 ? a : Math.max(dx, Math.sqrt(Math.max(0, big * big - dx * dx))); }
            else if (CN === 'all') dy = Math.sqrt(Math.max(0, big * big - dx * dx));
            return Math.max(dy, (Math.max(10, sp * H(f)) - m.D) / 2, 6); };
          for (let oy = 0; oy < p0; oy += 2) {
            if (!stag) {
              const rows = []; let est = 0;
              for (let y = Gd.ymin + oy; ;) {
                const f = fAt(y), m = modOf(f); if (y + m.D > Gd.ymax) break;
                const pX = m.L + gapXOf(f), bx = rowAt(y, f, m, pX);
                if (bx && bx.length) { rows.push({ y, items: bx, f, m }); est += bx.length * gfaDong(m, f); y += m.D + Math.max(10, sp * H(f)); }
                else y += 2;   // 이 높이엔 안 들어감 → 2m 위로
              }
              if (!bestY || Math.min(est, target) > Math.min(bestY.est, target) + 1) bestY = { oy, rows, est };
            } else {
              const m0 = modOf(Fhi), gX = Math.max(A.sideGap_m, m0.L) + 2, pX = m0.L + gX, dx = pX / 2 - m0.L;
              for (let ox = 0; ox < pX; ox += 8) {
                if (oy % 4) break;   // 엇갈림은 4m 간격만(속도)
                const rows = []; let est = 0, k = 0;
                for (let y = Gd.ymin + oy; ;) {
                  const f = fAt(y), m = modOf(f); if (y + m.D > Gd.ymax) break;
                  const xs = []; for (let x = Gd.xmin + ox + (k % 2) * pX / 2; x + m.L <= Gd.xmax; x += pX) if (fits(Gd, m, x, y)) xs.push({ x, m });
                  if (xs.length) { rows.push({ y, items: xs, f, m }); est += xs.length * gfaDong(m, f); y += m.D + stagDy(m, f, dx); k++; }
                  else y += 2;
                }
                if (!bestY || Math.min(est, target) > Math.min(bestY.est, target) + 1) bestY = { oy, rows, est };
              }
            }
          }
          if (!bestY || !bestY.rows.length) continue;
          // 실제 동 만들기: 높이 상한(정북·채광창)에 걸리는 동만 낮추고, 최저 층수 밑이면 뺌
          const blds = [];
          bestY.rows.forEach((row, ri) => { row.items.forEach(({ x, m }) => { const walls0 = G.wallsOf(m);
            const W = p => G.rot([x + p[0], row.y + p[1]], Gd.r), poly = G.hull(m.parts.flat().map(W)), walls = G.wallsTo(walls0, W, Gd.r);
            const fl = Math.min(row.f, cap({ poly, form: m.form, angle: th, walls }));
            if (fl < A.minFloors) return;
            blds.push({ id: 0, poly, floors: fl, planF: row.f, form: m.form, angle: th, mixT: m.mixT, n: m.n, t: m.t, seq: m.seq, dtype: m.dtype, dname: m.dname, vname: m.vname, notes: m.notes || [], block: 0, row: ri,
              parts: m.parts.map(q => q.map(W)), cores: m.cores.map(q => q.map(W)), units: (m.units || []).map(rs => rs.map(q => q.map(W))), walls });
          }); });
          if (!blds.length) continue;
          // 짝 배치는 날개 창끼리 마주 볼 수 있어(왼쪽 동 날개 동쪽 창 ↔ 오른쪽 동 날개) 벽면별 동 사이 검사를 통과한 것만
          if (pair || stag) { let bad = false; for (let i = 0; i < blds.length && !bad; i++) for (let j = i + 1; j < blds.length && !bad; j++) if (Math.abs(blds[i].row - blds[j].row) <= (stag ? 2 : 1) && K.pairCheck(blds[i], blds[j], opt)) bad = true; if (bad) continue; }
          // 목표 연면적을 넘으면 남쪽 줄·가장자리 동부터 뺌(남측 개방) — 같은 모양·같은 간격은 그대로
          const gfaOf = bs => bs.reduce((a, b) => a + Object.keys(b.mixT).reduce((c, t) => c + b.mixT[t] * b.floors * sup(t), 0), 0);
          let bl = blds.slice();
          if (gfaOf(bl) > target) { const cx = bl.reduce((a, b) => a + b.poly[0][0], 0) / bl.length; bl.sort((a, b) => a.row - b.row || Math.abs(b.poly[0][0] - cx) - Math.abs(a.poly[0][0] - cx)); while (bl.length > 1 && gfaOf(bl) > target) bl.shift(); }
          const v = Math.min(gfaOf(bl), target), spread = Fhi - Flo;
          // 연면적(목표까지) 큰 것 → 같으면 층수 차이 작은 것(더 일정) → 낮은 최고 층수
          if (!best || v > best.val + 1 || (Math.abs(v - best.val) <= 1 && (spread < best.spread || (spread === best.spread && Fhi < best.Fhi))))
            best = { val: v, Flo, Fhi, spread, F: Fhi, th, seq, m: mLow, blds: bl, gapX: pair ? A.sideGap_m : gapXOf(Flo), gapY: Math.max(10, sp * H(Flo)), rows: bestY.rows, Gd, pair, stag };
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
      return { id: 0, poly, floors: fl, planF: f, form: m.form, angle: th, mixT: m.mixT, n: m.n, t: m.t, seq: m.seq, dtype: m.dtype, dname: m.dname, vname: m.vname, notes: m.notes || [], block: 0, row,
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
    // ③ 남은 땅 채우기(2026-11-06, 사용자 판단 '판상 줄 + 가장자리 탑상'): 줄 밖 남은 땅(경계 모서리·북쪽 끝 등)에 탑상 4호·판상 4호를
    //  층수를 낮춰 가며 넣어 봄 — 법정 동 사이 거리·모서리 근접(실무 기준) 모두 pairCheck로 확인
    if (o.fillFree !== false && gfaOf(blds) < target * 0.99 && base.m.dtype !== 'T4') {
      const n0 = blds.length, extra = [];
      ['T4', 'P4'].forEach(id => seqFor(id, opt).slice(0, 2).forEach(seq => { const m = DL.build(id, seq); if (m) extra.push(m); }));
      const Fmax = Math.max(...rowsY.map(R => R.f), A.minFloors), step = 4;
      const bbOf = b => { const xs = b.poly.map(p => p[0]), ys = b.poly.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };
      const BBX = new WeakMap(), nearOf = nb => { const B = bbOf(nb); return blds.filter(o2 => { let Q = BBX.get(o2); if (!Q) BBX.set(o2, Q = bbOf(o2)); return Math.max(Q[0] - B[2], B[0] - Q[2], Q[1] - B[3], B[1] - Q[3]) < 110; }); };   // 외접사각형 틈 110m 안(동 사이 기준 최대 약 85m)
      for (let y = Math.ceil(Gd.ymax); y >= Gd.ymin && gfaOf(blds) < target; y -= step) {
        for (let x = Math.floor(Gd.xmin); x <= Gd.xmax && gfaOf(blds) < target; x += step) {
          let put = null;
          for (const m of extra) {
            if (!fits(Gd, m, x, y)) continue;
            let nr = null;
            for (let f = Fmax; f >= A.minFloors && !put; f -= 4) {
              const nb = mk(m, x, y, f, -1); if (!nb) break;
              if (!nr) { nr = nearOf(nb); const B = bbOf(nb); if (nr.some(o2 => { const Q = BBX.get(o2); return Math.max(Q[0] - B[2], B[0] - Q[2], Q[1] - B[3], B[1] - Q[3]) < 4; })) break; }   // 너무 붙은 자리는 층수와 관계없이 안 됨(측벽 4m)
              if (nr.some(o2 => K.pairCheck(nb, o2, opt))) continue;
              put = nb;
            }
            if (put) break;
          }
          if (put) { put.row = rowsY.length; blds.push(put); x += 10; }
        }
      }
      const d = diag(); if (blds.length > n0) steps.push(Object.assign({ name: '남은 땅 채우기', why: `줄 밖 남은 땅에 탑상·작은 판상 ${blds.length - n0}개 동(층수를 낮춰 가며, 동 사이 거리·모서리 기준 확인)` }, d));
    }
    // ② 평형 맞추기
    const e0 = mixErrOf(blds, opt);
    if (e0 > 0.15) {
      const gfa0 = gfaOf(blds), alts = {};
      const altOf = id => alts[id] || (alts[id] = DL.assignments(id, ts).map(seq => DL.build(id, seq)).filter(Boolean));
      for (let it = 0; it < 3; it++) {
        let changed = false;
        for (let i = 0; i < blds.length; i++) {
          const b = blds[i], R = rowsY[b.row]; if (!R) continue; const [a0, c0] = xr(b), others = blds.filter(o2 => o2 !== b);
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

  /* ---------- 기본형 성적표(2026-11-05 사용자 '배치해 보면서 무언가 알 수 있을 것') ----------
     동 타입마다(보완안이 있으면 보완안 기준): 세대·용적률·목표 대비·평형 비율 차이·일조 부족 동·층수 급변
     막힌 원인: 계획 층수에서 깎인 층수 합을 조문별로(정북 일조 / 채광창 이격), 줄 안 빈 길이(자투리), 옆 벽 창 때문에 넓어진 옆 간격
     잘한 것: 세대수 1위·일조 1위(부족 동 적음)·평형 1위 */
  function scorecard(site, opt, variants) {
    const capSun = G.capper(site, Object.assign({}, opt, { winRatio: 0 })), capAll = G.capper(site, opt), target = opt.lot * opt.far / 100;
    const rows = variants.map(v0 => {
      const v = v0.improved || v0, B = v.buildings;
      let cutSun = 0, cutWin = 0;
      B.forEach(b => { const pf = b.planF || b.floors; if (b.floors >= pf) return; const cs = capSun(b), ca = capAll(b); if (cs < pf) cutSun += Math.min(pf, cs < pf ? pf - Math.max(b.floors, cs) : 0) * b.n; cutWin += Math.max(0, Math.min(pf, cs) - b.floors) * b.n; });
      const st = (v0.improved && v0.improved.steps) || v0.steps || [];
      return { dtype: v0.dtype, name: v0.label.replace('기본 배치 — ', ''), improved: !!v0.improved, steps: st.slice(1).map(x => x.name), angle: v0.angle,
        units: v.units, far: v.far, ofTarget: target ? v.gfa / target : 0, mixErr: v.mixErr, sunFail: v.risks.filter(r => r.id === 'sun_tolerance').length, jumps: v.risks.filter(r => r.id === 'height_jump').length,
        rules: v.rules.length, n: B.length, maxF: v.maxFloors, cutSun, cutWin, empty: st.length ? st[0].empty : null, sideWin: v0.gapX > (opt.assume.sideGap_m || 10) + 0.1, gapX: v0.gapX };
    });
    const best = k => rows.slice().sort(k)[0];
    const win = { units: best((a, b) => b.units - a.units), far: best((a, b) => b.far - a.far || b.units - a.units), sun: best((a, b) => a.sunFail / Math.max(1, a.n) - b.sunFail / Math.max(1, b.n) || b.units - a.units), mix: best((a, b) => a.mixErr - b.mixErr || b.units - a.units) };
    // 이 구역에서 공통으로 막힌 것(모든 타입 평균) — 문장 한 줄씩
    const avg = f => rows.reduce((s, r) => s + f(r), 0) / (rows.length || 1), notes = [];
    if (avg(r => r.ofTarget) < 0.8) notes.push(`어떤 동 타입으로도 목표 용적률의 ${Math.round(Math.max(...rows.map(r => r.ofTarget)) * 100)}%까지만 들어감 — 목표(${opt.far}%) 자체가 이 대지에 무리일 수 있음`);
    if (avg(r => r.cutSun) > avg(r => r.cutWin) && avg(r => r.cutSun) > 0) notes.push('층수를 가장 많이 깎는 것은 정북 일조(시행령 제86조①) — 북쪽 줄 저층·남북 방향 동이 유리할 수 있음');
    else if (avg(r => r.cutWin) > 0) notes.push('층수를 가장 많이 깎는 것은 채광창 이격(시행령 제86조③1호) — 경계 쪽 동 저층 또는 경계에서 더 띄우기');
    const sideLoss = rows.filter(r => r.sideWin);
    if (sideLoss.length) notes.push(`옆 벽에 창이 있는 동(${sideLoss.map(r => r.name).join('·')})은 옆 간격이 높이 × 0.8로 넓어져 세대수 손해(가목, 법제처 21-0403)`);
    const emp = rows.filter(r => r.empty >= 30);
    if (emp.length) notes.push(`줄 안 자투리가 큰 동 타입: ${emp.map(r => `${r.name} ${r.empty}m`).join(', ')} — 길이를 섞는 보완이 효과 큼`);
    return { rows, win, notes, target };
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
      out.push(pack(r.blds, `기본 배치 — ${r.m.dname}${r.pair ? '(날개 마주 놓기)' : ''}${r.stag ? '(엇갈려 놓기)' : ''}`, { improved: im && im.steps.length > 1 ? pack(im.blds, `기본 + 보완 — ${r.m.dname}${r.stag ? '(엇갈려 놓기)' : ''}`, { steps: im.steps }) : null, steps: im ? im.steps.slice(0, 1) : [] }));
    });
    return { variants: out, ms: Date.now() - t0, card: o.card === false ? null : scorecard(site, opt, out) };
  }

  const api = { simple, one, improve, scorecard, angles, seqFor, mixErrOf, TYPES };
  if (NODE) module.exports = api; else g.JbsSimple = api;
})(typeof window !== 'undefined' ? window : globalThis);
