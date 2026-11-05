'use strict';
// 배치 검사 부품(심화 배치·업로드 도면 검토 공용) — 화면 코드 없음(node 시험 가능)
//  판단 기준 세 갈래를 결과 꼴부터 나눔(컨셉 문서 6장):
//   규칙(rule)  법령·조례. 판정 통과/위반. 위반이면 그 안은 탈락(점수 없음)
//   경험(risk)  심의·협의·민원에서 문제 되기 쉬운 것. 등급 권고/주의/고위험 + 원인·영향·확인 자료·대안
//   선호(pref)  좋은 단지계획 기준. 0~1 점수만(유전 알고리즘 적합도에는 이것만 들어감)
//  계산 3단계: quick(빠른 검사: 경계·충돌·동 간격·높이 상한·용적률) → evaluate(선호 점수) → verify(정밀: quick + 수인한도 일조 등 경험)
//  입력 동(blds): { id, poly(월드 좌표 m, 볼록), floors, form('slab'|'L'|'tower'|'Y'|'court'), angle(도, 동 정면 남향 기준 회전), units?(세대), gfa?, mixT?, notes?, inner? }
//  입력 대지(site): arch-geom layout과 같은 꼴 { pts, tags, setbacks, exclude? }
//  opt: arch-geom layout opt와 같은 꼴(assume·sun·spacing·winRatio·edgeW·lot·far·…) + crit(arch.json items, 근거 문구용)
(function (g) {
  const G = (typeof module !== 'undefined' && module.exports) ? require('./arch-geom.js') : g.ArchGeom;
  const D2R = Math.PI / 180;
  const itemOf = (opt, id) => ((opt.crit || []).find(i => i.id === id)) || {};

  /* ---------- 도형 도구 ---------- */
  const bboxIn = (poly, th) => { const q = poly.map(p => G.rot(p, -th)); const xs = q.map(p => p[0]), ys = q.map(p => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; };
  // 볼록 다각형 겹침(분리축 정리). 1cm 넘게 파고들면 겹침
  function overlapConvex(a, b) {
    const axes = [a, b].flatMap(P => P.map((p, i) => { const q = P[(i + 1) % P.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; }));
    for (const n of axes) {
      const pa = a.map(p => p[0] * n[0] + p[1] * n[1]), pb = b.map(p => p[0] * n[0] + p[1] * n[1]);
      if (Math.max(...pa) <= Math.min(...pb) + 0.01 || Math.max(...pb) <= Math.min(...pa) + 0.01) return false;
    }
    return true;
  }
  const H = (opt, f) => f * opt.assume.floorHeight_m + opt.assume.groundExtra_m;
  const supOf = (opt, t) => { const u = (opt.units || {})[t]; return u ? (+u.공급 > 0 ? +u.공급 : u.전용 * opt.assume.supplyFactor) : 0; };
  // 동 연면적(지상): gfa가 있으면 그 값, 없으면 평형 구성(mixT 층당 세대) × 층수 × 공급면적, 그것도 없으면 t·n
  function gfaOf(b, opt) {
    if (b.gfa > 0) return b.gfa;
    const mix = b.mixT || (b.t ? { [b.t]: b.n || 0 } : null); if (!mix) return 0;
    return Object.keys(mix).reduce((s, t) => s + mix[t] * b.floors * supOf(opt, t), 0);
  }
  const unitsOf = b => (b.units > 0 ? b.units : (b.mixT ? Object.values(b.mixT).reduce((a, c) => a + c, 0) : (b.n || 0)) * b.floors);

  // 객체에 계산값을 숨겨 둠(JSON·저장에 안 실림)
  //  도형(poly·parts)이 바뀌면 다시 계산
  const memo = (o, k, f) => { const c = o[k], src = o.parts || o.poly; if (c && c.src === src) return c.v; const v = f(); try { Object.defineProperty(o, k, { value: { src, v }, configurable: true, writable: true, enumerable: false }); } catch (e) { /* 얼린 객체 */ } return v; };
  const ringsOf = b => (b.parts && b.parts.length ? b.parts : [b.poly]);
  // 동 바깥 벽면(월드): b.walls가 있으면 그대로, 없으면 세대·조각으로 만듦(업로드 도면 등 — 판상은 동 각도를 세대 폭 방향으로 봄)
  const wallsW = b => (b.walls && b.walls.length ? b.walls : memo(b, '__walls', () => G.wallsOf({ form: b.form, parts: ringsOf(b), units: null, uw0: b.form === 'slab' ? (b.angle || 0) : null })));
  // 상대 동 둘레 표본점(1.5m 간격 + 꼭짓점)
  // 조각마다 외접사각형 + 표본점(1.5m 간격, 필요할 때만 만듦)
  const ringSamp = q => q.flatMap((p, i) => { const r = q[(i + 1) % q.length], k = Math.max(1, Math.ceil(Math.hypot(r[0] - p[0], r[1] - p[1]) / 1.5)); return Array.from({ length: k }, (_, t) => [p[0] + (r[0] - p[0]) * t / k, p[1] + (r[1] - p[1]) * t / k]); });
  const ringsS = b => memo(b, '__rs', () => ringsOf(b).map(q => ({ q, bb: [Math.min(...q.map(a => a[0])), Math.min(...q.map(a => a[1])), Math.max(...q.map(a => a[0])), Math.max(...q.map(a => a[1]))], pts: null })));
  const sampOf = b => ringsS(b).flatMap(r => r.pts || (r.pts = ringSamp(r.q)));
  const bbW = b => memo(b, '__bb', () => { const p = ringsOf(b).flat(); return [Math.min(...p.map(a => a[0])), Math.min(...p.map(a => a[1])), Math.max(...p.map(a => a[0])), Math.max(...p.map(a => a[1]))]; });
  // 벽면 w(동 X)가 '마주 보는' 상대 동 Y까지 직각 방향 거리: 벽 길이 범위 안(벽 앞 띠)에 든 Y 부분 중 가장 가까운 것. 띠 밖(비껴 놓임)이면 null
  function wallHit(w, Y) {
    const tx = w.b[0] - w.a[0], ty = w.b[1] - w.a[1], L = Math.hypot(tx, ty), t = [tx / L, ty / L];
    // 빠른 거르기: 상대 동 외접사각형 네 모서리가 벽 앞 띠에 전혀 안 걸리면 건너뜀
    { const B = bbW(Y); let s0 = Infinity, s1 = -Infinity, n1 = -Infinity;
      [[B[0], B[1]], [B[2], B[1]], [B[2], B[3]], [B[0], B[3]]].forEach(p => { const vx = p[0] - w.a[0], vy = p[1] - w.a[1], ss = vx * t[0] + vy * t[1], nn = vx * w.n[0] + vy * w.n[1]; if (ss < s0) s0 = ss; if (ss > s1) s1 = ss; if (nn > n1) n1 = nn; });
      if (n1 <= 0.01 || s1 < 0.05 || s0 > L - 0.05) return null; }
    let d = Infinity, hp = null;
    for (const R of ringsS(Y)) {
      const B = R.bb; let s0 = Infinity, s1 = -Infinity, n0 = Infinity, n1 = -Infinity;
      for (const c of [[B[0], B[1]], [B[2], B[1]], [B[2], B[3]], [B[0], B[3]]]) { const vx = c[0] - w.a[0], vy = c[1] - w.a[1], ss = vx * t[0] + vy * t[1], nn = vx * w.n[0] + vy * w.n[1]; if (ss < s0) s0 = ss; if (ss > s1) s1 = ss; if (nn < n0) n0 = nn; if (nn > n1) n1 = nn; }
      if (n1 <= 0.01 || s1 < 0.05 || s0 > L - 0.05 || n0 >= d) continue;   // 이 조각은 벽 앞 띠 밖이거나 이미 찾은 것보다 멂
      for (const p of R.pts || (R.pts = ringSamp(R.q))) {
        const vx = p[0] - w.a[0], vy = p[1] - w.a[1], s2 = vx * t[0] + vy * t[1]; if (s2 < 0.05 || s2 > L - 0.05) continue;
        const dn = vx * w.n[0] + vy * w.n[1]; if (dn > 0.01 && dn < d) { d = dn; hp = p; }
      }
    }
    return hp ? { d, p: hp, foot: [hp[0] - w.n[0] * d, hp[1] - w.n[1] * d] } : null;
  }
  const wallDist = (w, Y) => { const h = wallHit(w, Y); return h ? h.d : null; };
  // 벽면 하나가 요구하는 거리(건축법 시행령 제86조③2호). sp = 배수(인천 건축조례 제32조⑤ 정비사업 0.8)
  //  창 없는 옆벽(측벽) → 마목 4m(상대가 창 벽이면 그쪽 벽에서 가목으로 따로 걸림)
  //  남북으로 마주 보는 채광창 벽 → 북쪽 동이 같거나 높으면 나목(10m 이상, 낮은 동 높이 × 배수), 아니면 가목(높은 동 높이 × 배수)
  //  동·서를 향한 채광창 벽(ㄱ자·T자 날개, 탑상·Y형 옆 벽) → 가목
  function needOf(X, Y, w, opt, sp) {
    if (!w.win) return { need: 4, law: 4, kind: 'side', 근거: '건축법 시행령 제86조③2호마목(측벽과 측벽 4m 이상)' };
    if (Math.abs(w.n[1]) > 0.7) {
      const [S, N] = w.n[1] > 0 ? [X, Y] : [Y, X], hS = H(opt, S.floors), hN = H(opt, N.floors);
      if (hN >= hS) return { need: Math.max(10, sp * hS), law: Math.max(10, 0.5 * hS), kind: 'ns', S, N, 근거: `건축법 시행령 제86조③2호나목(높은 동 주된 개구부가 낮은 동을 향함: 10m 이상, 낮은 동 높이 × ${sp}배 — 인천 건축조례 제32조⑤·⑥)` };
      return { need: sp * Math.max(hS, hN), law: 0.5 * Math.max(hS, hN), kind: 'ns', S, N, 근거: `같은 조 ③2호가목(채광창 벽면에서 두 동 중 높은 동 높이 × ${sp}배 — 법제처 해석 21-0403, 인천 건축조례 제32조⑤·⑥)` };
    }
    const h = Math.max(H(opt, X.floors), H(opt, Y.floors));
    return { need: sp * h, law: 0.5 * h, kind: 'ew', 근거: `같은 조 ③2호가목(동·서를 향한 채광창 벽면 — ㄱ자·T자 날개, 탑상·Y형 옆 벽 — 두 동 중 높은 동 높이 × ${sp}배, 법제처 해석 21-0403, 인천 건축조례 제32조⑤·⑥)` };
  }
  // 두 동의 마주 보는 벽면 목록: [{ X, Y, w, d(실제), need, law, kind, 근거 }]
  function facings(a, b, opt, sp) {
    const out = [];
    [[a, b], [b, a]].forEach(([X, Y]) => wallsW(X).forEach(w => { const h = wallHit(w, Y); if (h) out.push(Object.assign({ X, Y, w, d: h.d, p0: h.foot, p1: h.p }, needOf(X, Y, w, opt, sp))); }));
    return out;
  }
  /* 동 모서리 근접(2026-11-06 사용자 결정 — 실무 가정, 법정 아님). opt.corner || opt.assume.corner = { mode: off·min10·rec·all, min_m, ratio, cone_deg }
     법정 동 사이 거리(벽면 직각 방향)에 안 걸리는 비껴 놓인 동도 막음:
       min10 모든 동 사이 최소 min_m · rec  min_m + 채광창 벽 직각선 좌우 cone 안에 상대 동이 보이면 높은 동 높이 × ratio · all 모서리 전부 ratio
     결과 { d, need, p, q, view(보이는 위치인지) } 또는 null(문제 없음) */
  const cornerOf = opt => { const c = opt.corner || (opt.assume && opt.assume.corner); return c && c.mode && c.mode !== 'off' ? Object.assign({ min_m: 10, ratio: 0.5, cone_deg: 45 }, c) : null; };
  //  법정 검사가 다루는 쌍(벽면 직각 방향으로 마주 봄 — 측벽끼리 마목 4m 포함)은 법정 기준으로만 봄(사용자 판단 2026-11-06: 103–104 측벽 4.7m는 통과)
  function cornerCheck(a, b, opt, fs) {
    const CN = cornerOf(opt); if (!CN) return null;
    if ((fs || facings(a, b, opt, opt.spacing)).length) return null;
    const hMax = H(opt, Math.max(a.floors, b.floors)), big = Math.max(CN.min_m, CN.ratio * hMax), np = nearPair(a, b);
    if (CN.mode === 'min10') return np.d < CN.min_m - 0.05 ? { d: np.d, need: CN.min_m, p: np.p, q: np.q, view: false } : null;
    if (CN.mode === 'all') return np.d < big - 0.05 ? { d: np.d, need: big, p: np.p, q: np.q, view: true } : null;
    // rec: 채광창 벽 끝에서 비스듬히(직각선 좌우 cone 안) 보이는 상대 동 점 중 가장 가까운 것
    const tn = Math.tan(CN.cone_deg * Math.PI / 180); let v = null;
    [[a, b], [b, a]].forEach(([X, Y]) => wallsW(X).forEach(w => { if (!w.win) return;
      const tx = w.b[0] - w.a[0], ty = w.b[1] - w.a[1], L = Math.hypot(tx, ty), t = [tx / L, ty / L];
      sampOf(Y).forEach(p => { const vx = p[0] - w.a[0], vy = p[1] - w.a[1], s2 = vx * t[0] + vy * t[1], dn = vx * w.n[0] + vy * w.n[1]; if (dn <= 0.01) return;
        const off = s2 < 0 ? -s2 : s2 > L ? s2 - L : 0; if (off <= 0 || off > dn * tn) return;   // 바로 앞(법정 검사 몫)이거나 시야 밖
        const d = Math.hypot(off, dn); if (d < big - 0.05 && (!v || d < v.d)) { const e = s2 < 0 ? w.a : w.b; v = { d, need: big, p: e, q: p, view: true }; } }); }));
    if (v) return v;
    return np.d < CN.min_m - 0.05 ? { d: np.d, need: CN.min_m, p: np.p, q: np.q, view: false } : null;
  }
  const collide = (a, b) => { const A = ringsOf(a), B = ringsOf(b); return A.some(p => B.some(q => overlapConvex(p, q))); };

  // 두 동 사이 검사(2026-11-05 벽면별로 바꿈): 겹침 → 벽면마다 마주 보는 상대 동까지 직각 방향 거리. 문제 없으면 null
  //  예전(외접사각형으로 앞뒤·옆만 나눔)은 ㄱ자 날개를 측벽 4m로 봐 35층 동 사이가 4m까지 붙는 일이 있었음
  function pairCheck(a, b, opt) {
    const sp = opt.spacing, sb = itemOf(opt, 'spacing_ratio');
    const A = bbW(a), B = bbW(b), gapBB = Math.hypot(Math.max(0, B[0] - A[2], A[0] - B[2]), Math.max(0, B[1] - A[3], A[1] - B[3]));
    const CN = cornerOf(opt), hM = H(opt, Math.max(a.floors, b.floors));
    if (gapBB > Math.max(10, sp * hM, CN ? Math.max(CN.min_m, CN.ratio * hM) : 0) + 0.1) return null;
    if (gapBB < 0.02 && collide(a, b)) return { id: 'collide', 항목: '동 겹침', 동: [a.id, b.id], 판정: '위반', 값: '두 동이 겹침', 근거: '' };
    let worst = null; const fs = facings(a, b, opt, sp);
    fs.forEach(f => { if (f.d < f.need - 0.05 && (!worst || f.d / f.need < worst.d / worst.need)) worst = f; });
    if (!worst) {
      const c = cornerCheck(a, b, opt, fs); if (!c) return null;
      return { id: 'corner', 항목: c.view ? '동 모서리 근접(비스듬히 마주 봄 — 실무 기준)' : '동 최소 거리(실무 기준)', 동: [a.id, b.id], 판정: '위반', 기준: `${c.need.toFixed(1)}m 이상`, 값: `${c.d.toFixed(1)}m`, d: c.d, need: c.need, p: c.p, q: c.q,
        대안: '동을 옮기거나 돌려 간격 확보, 또는 높은 동 층수 낮추기',
        근거: (c.view ? `채광창 벽 직각선 좌우 ${cornerOf(opt).cone_deg}° 안에서 보임 → 높은 동 높이 × ${cornerOf(opt).ratio}(최소 ${cornerOf(opt).min_m}m)` : `모든 동 사이 최소 ${cornerOf(opt).min_m}m`) + ' — 실무 기준(가정값, 법정 아님: 시행령 제86조③2호는 직각 방향으로 마주 보는 부분만. 서울 건축조례 최소 이격 10m·0.5배 차용)' };
    }
    const f = worst, ids = f.kind === 'ns' ? [f.S.id, f.N.id] : [f.X.id, f.Y.id];
    return { id: f.kind === 'ns' ? 'spacing' : 'side', 항목: f.kind === 'ns' ? '동 사이 거리(앞뒤)' : f.kind === 'ew' ? '동 사이 거리(옆 — 채광창 벽)' : '동 사이 거리(옆 — 측벽)', 동: ids, 판정: '위반',
      기준: `${f.need.toFixed(1)}m 이상`, 값: `${f.d.toFixed(1)}m`,
      대안: f.kind === 'side' ? '두 동 간격 4m 이상으로' : '① 간격 넓히기 또는 높은 동 층수 낮추기 ② 같은 호 단서: 대지의 모든 세대가 동지 9~15시 연속 2시간 이상 일조 확보를 일조 분석으로 입증 ③ 마주보는 벽의 창을 아예 없애 측벽으로(0.5㎡ 미만 창도 창 — 법제처 21-0590) ④ 마주보는 부분만 단차로 낮춤',
      근거: f.근거 + (f.kind === 'side' ? '' : `, 법정 하한 ${f.law.toFixed(1)}m`) + (sb.상태 || f.kind === 'side' ? '' : ' ※ 기준 확인 필요') };
  }
  // 두 동 둘레 사이 가장 가까운 거리(조각 기준)
  function minDist(a, b) {
    let d = Infinity; const A = ringsOf(a), B = ringsOf(b);
    const ed = (P, Q) => P.forEach(p => Q.forEach(q => q.forEach((x, i) => { d = Math.min(d, G.segDist(p, x, q[(i + 1) % q.length])); })));
    ed(A.flat().map(p => p), B); ed(B.flat(), A);
    return d;
  }

  /* ---------- 1단계: 빠른 검사(규칙) ---------- */
  function quick(site, blds, opt) {
    const rules = [], add = r => rules.push(Object.assign({ 갈래: '규칙' }, r));
    const winI = itemOf(opt, 'window_setback'), sunI = itemOf(opt, 'sunlight_north');
    // ① 대지 안·경계 이격(가정 이격 포함) — 경계에서 띄울 거리 중 법정 부분은 아래 높이 상한에서 따로 봄
    const test = G.buildableTest(site.pts, site.setbacks || []), ex = site.exclude || [];
    blds.forEach(b => {
      // 조각(parts)이 있으면 조각 꼭짓점·변 중점으로(Y·T·ㄱ자처럼 오목한 동은 바깥 둘레선이 빈 땅을 지나감)
      const rings = b.parts && b.parts.length ? b.parts : [b.poly];
      //  5cm 허용(엔진이 1m 격자로 어림해 이격선을 몇 cm 넘는 경우): 조각 가운데 쪽으로 5cm 당긴 점으로 봄
      const pts = rings.flatMap(R => { const c = R.reduce((a, p) => [a[0] + p[0] / R.length, a[1] + p[1] / R.length], [0, 0]), pull = p => { const dx = c[0] - p[0], dy = c[1] - p[1], L = Math.hypot(dx, dy) || 1; return [p[0] + dx / L * 0.05, p[1] + dy / L * 0.05]; };
        return R.flatMap((p, i) => { const q = R[(i + 1) % R.length]; return [pull(p), pull([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2])]; }); });
      const outN = pts.filter(p => !test(p[0], p[1])).length, inEx = pts.filter(p => ex.some(e => G.inside(p[0], p[1], e))).length;
      if (outN) add({ id: 'boundary', 항목: '대지 경계·이격', 동: [b.id], 판정: '위반', 값: `꼭짓점·변 중점 ${outN}곳이 대지 밖 또는 경계 이격 안`, 근거: '대지 경계(입력한 변별 이격 포함)' });
      if (inEx) add({ id: 'infra', 항목: '기반시설 침범', 동: [b.id], 판정: '위반', 값: `${inEx}곳이 공원·도로 등 건축 불가 영역 안`, 근거: '정비기반시설 계획(건축 불가 영역)' });
    });
    // ② 동끼리 겹침, ③ 동 사이 거리(시행령 제86조③2호) — pairCheck
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) { const r = pairCheck(blds[i], blds[j], opt); if (r) add(r); }
    // ④ 높이 상한: 정북 일조(시행령 제86조①)·채광창 벽면(제86조③1호·⑥) — 정북만 켠 것과 모두 켠 것을 따로 재서 어느 조문인지 가림
    // 최고 층수 가정값(assume.maxFloors)은 법정 높이 제한이 아니므로 여기서는 풀어 둠(2026-11-06 — 올린 배치도 39층이 '정북 일조 위반'으로 잘못 나오던 것)
    const optNoMax = Object.assign({}, opt, { assume: Object.assign({}, opt.assume, { maxFloors: 999 }) });
    const capAll = G.capper(site, optNoMax), capSun = G.capper(site, Object.assign({}, optNoMax, { winRatio: 0 }));
    blds.forEach(b => {
      const cs = capSun(b), ca = capAll(b);
      if (b.floors > cs) add({ id: 'sun_north', 항목: '정북 일조 높이', 동: [b.id], 판정: '위반', 기준: `${cs}층 이하`, 값: `${b.floors}층`, 근거: (sunI.근거 || '건축법 시행령 제86조①') + (opt.southBase ? ' — 정남 기준(제86조④) 적용' : '') });
      else if (b.floors > ca) add({ id: 'window', 항목: '채광창 벽면 이격 높이', 동: [b.id], 판정: '위반', 기준: `${ca}층 이하`, 값: `${b.floors}층`, 근거: winI.근거 || '건축법 시행령 제86조③1호·⑥' });
    });
    // ⑤ 용적률·건폐율(획지 기준)
    const lot = +opt.lot || 0, gfa = blds.reduce((s, b) => s + gfaOf(b, opt), 0), ba = blds.reduce((s, b) => s + Math.abs(G.area(b.poly)), 0);
    const far = lot ? gfa / lot * 100 : 0, bcr = lot ? ba / lot * 100 : 0;
    if (opt.far > 0 && far > opt.far + 0.05) add({ id: 'far', 항목: '용적률', 동: [], 판정: '위반', 기준: `${opt.far}% 이하`, 값: `${far.toFixed(1)}%`, 근거: '정비계획 용적률' });
    if (opt.bcrMax > 0 && bcr > opt.bcrMax + 0.05) add({ id: 'bcr', 항목: '건폐율', 동: [], 판정: '위반', 기준: `${opt.bcrMax}% 이하`, 값: `${bcr.toFixed(1)}%`, 근거: '용도지역 건폐율(도시계획 조례)' });
    return { rules, pass: rules.length === 0, far, bcr, gfa, ba, units: blds.reduce((s, b) => s + unitsOf(b), 0) };
  }

  /* ---------- 2단계: 선호 점수 ---------- */
  //  weights 기본: 용적률 채움 0.4, 평형 비율 0.2, 높이 정돈 0.2, 남향 0.1, 동 간격 여유 0.1(가정값 sideGap 이상)
  function evaluate(site, blds, opt, q) {
    q = q || quick(site, blds, opt);
    const W = Object.assign({ far: 0.4, mix: 0.2, height: 0.2, south: 0.1, side: 0.1 }, opt.weights || {});
    const prefs = [];
    prefs.push({ id: 'far', 항목: '목표 용적률 채움', 점수: opt.far > 0 ? Math.min(1, q.far / opt.far) : 0 });
    // 평형 비율(세대 기준): 목표와의 차이 합의 절반을 1에서 뺌
    if (opt.mix) {
      const want = opt.mix, ws = Object.values(want).reduce((a, b) => a + b, 0) || 1, got = {}; let tot = 0;
      blds.forEach(b => { const m = b.mixT || (b.t ? { [b.t]: b.n } : {}); Object.keys(m).forEach(t => { got[t] = (got[t] || 0) + m[t] * b.floors; tot += m[t] * b.floors; }); });
      const err = [...new Set(Object.keys(want).concat(Object.keys(got)))].reduce((e, t) => e + Math.abs((got[t] || 0) / (tot || 1) - (want[t] || 0) / ws), 0);
      prefs.push({ id: 'mix', 항목: '평형 비율', 점수: Math.max(0, 1 - err / 2) });
    }
    // 높이 정돈: 60m 안 이웃 동끼리 층수 차이 평균(10개층 차이면 0점)
    const near = []; for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) { const a = blds[i].poly, b = blds[j].poly; const d = Math.min(...a.map(p => Math.min(...b.map(r => Math.hypot(p[0] - r[0], p[1] - r[1]))))); if (d < 60) near.push(Math.abs(blds[i].floors - blds[j].floors)); }
    prefs.push({ id: 'height', 항목: '높이 정돈(이웃 동 층수 차이)', 점수: near.length ? Math.max(0, 1 - near.reduce((a, b) => a + b, 0) / near.length / 10) : 1 });
    // 남향: 정면이 남쪽 ±45° 안인 세대 비율(판상·ㄱ형만 향이 정해짐, 탑상·Y는 0.5로 봄)
    const us = blds.map(b => unitsOf(b)), ut = us.reduce((a, b) => a + b, 0) || 1;
    prefs.push({ id: 'south', 항목: '남향 세대', 점수: blds.reduce((s, b, i) => s + us[i] * (['slab', 'L'].includes(b.form) ? (Math.abs(((b.angle || 0) + 540) % 360 - 180) <= 45 ? 1 : 0) : 0.5), 0) / ut });
    // 옆 동 간격 여유(가정값 sideGap_m, 법정 4m와 별개 — 사생활·화재 확산·통풍)
    const sg = +opt.assume.sideGap_m || 10; let sideN = 0, sideOk = 0;
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) { const th = (blds[i].angle || 0) * D2R, A = bboxIn(blds[i].poly, th), B = bboxIn(blds[j].poly, th); if (Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0) > 0.5 && Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0) <= 0.5) { const gap = Math.max(B.x0 - A.x1, A.x0 - B.x1); if (gap < 60) { sideN++; if (gap >= sg) sideOk++; } } }
    prefs.push({ id: 'side', 항목: `옆 동 간격 ${sg}m 이상(가정)`, 점수: sideN ? sideOk / sideN : 1 });
    const score = prefs.reduce((s, p) => s + (W[p.id] || 0) * p.점수, 0) / (prefs.reduce((s, p) => s + (W[p.id] || 0), 0) || 1);
    return { prefs: prefs.map(p => Object.assign({ 갈래: '선호' }, p)), score, weights: W };
  }

  /* ---------- 3단계: 정밀 검증(규칙 + 경험) ---------- */
  //  경험 항목 등급: 권고 < 주의 < 고위험. 원인·영향·확인 자료·대안 한 줄씩
  function verify(site, blds, opt) {
    const q = quick(site, blds, opt), risks = [], add = r => risks.push(Object.assign({ 갈래: '경험' }, r));
    const tolI = itemOf(opt, 'sun_tolerance'), tol = tolI.연속_h ? tolI : { 연속_h: 2, 연속_구간: [9, 15], 합계_h: 4, 합계_구간: [8, 16] };
    const lat = +opt.lat || 37.46, byId = {}; blds.forEach(b => { byId[b.id] = b; });
    // ① 일조 수인한도(판례 기준, 법정 아님): 동 정면 가운데 1층 앞(벽에서 1m) 지점의 동지 일조
    blds.forEach(b => {
      const th = (b.angle || 0) * D2R, bb = bboxIn(b.poly, th);
      const front = G.rot([(bb.x0 + bb.x1) / 2, bb.y0 - 1], th);
      const others = blds.filter(o => o !== b);
      const r = G.sunHours(others, f => H(opt, f), lat, [front], tol)[0];
      if (r.ok) return;
      // 그늘 원인: 동을 하나씩 빼 보고 일조(연속 + 합계)가 가장 많이 늘어나는 동. 빼면 기준을 채우는지(fix)도 봄
      const cand = others.filter(o => o.poly[0][1] < front[1] + 5).map(o => {
        const r2 = G.sunHours(others.filter(x => x !== o), f => H(opt, f), lat, [front], tol)[0];
        const c = o.poly.reduce((s, p) => [s[0] + p[0] / o.poly.length, s[1] + p[1] / o.poly.length], [0, 0]);
        return { o, gain: (r2.cont - r.cont) + (r2.total - r.total) / 2, fix: r2.ok, d: Math.hypot(c[0] - front[0], c[1] - front[1]) };
      }).filter(x => x.gain > 0.05).sort((x, y) => y.gain - x.gain)[0];
      add({ id: 'sun_tolerance', 항목: `${b.id}동 저층 동지 일조 부족`, 등급: r.cont < 1 && r.total < 2 ? '고위험' : '주의', 동: [b.id].concat(cand ? [cand.o.id] : []),
        원인: cand ? `${cand.o.id}동(${cand.o.floors}층, 약 ${cand.d.toFixed(0)}m) 그림자가 가장 큼${cand.fix ? '' : ' — 그 동만 고쳐서는 부족, 여러 동 그림자가 겹침'}` : '여러 동 그림자가 겹침',
        영향: `정면 1층 기준 연속 ${r.cont}시간·합계 ${r.total}시간(기준 연속 ${tol.연속_h}시간 또는 합계 ${tol.합계_h}시간) — 저층 세대 일조 민원·손해배상 가능성`,
        확인자료: '동지 일조 시뮬레이션(/arch 일조 분석)', 대안: cand ? `${cand.o.id}동 층수를 낮추거나 ${b.id}동과의 간격을 넓힘` : '동 배치 간격 조정',
        근거: (tolI.근거 || '대법원 판례(일조방해 수인한도) — 법정 기준 아님') });
    });
    // ② 동 모듈이 남긴 메모(평면 조정 필요 등)
    blds.forEach(b => (b.notes || []).forEach(n => add({ id: 'module_note', 항목: `${b.id}동 ${n.split('(')[0]}`, 등급: '권고', 동: [b.id], 원인: n, 영향: '세대 평면이 실제 사례 대표 평면과 다름 — 분양성·설계 단계 변경 가능', 확인자료: '단위세대 평면 사례(arch.json 평면_라이브러리)', 대안: '동 타입 또는 평형 바꾸기', 근거: '경험(가정)' })));
    // ③ 경관: 고층 긴 판상(80m 넘고 15층 이상) — 통경축·스카이라인 지적
    blds.forEach(b => { if (['slab', 'L'].includes(b.form)) { const th = (b.angle || 0) * D2R, bb = bboxIn(b.poly, th), L = bb.x1 - bb.x0; if (L > 80 && b.floors >= 15) add({ id: 'long_slab', 항목: `${b.id}동 고층 긴 판상(${L.toFixed(0)}m·${b.floors}층)`, 등급: '주의', 동: [b.id], 원인: '판상 동 길이가 길고 층수가 높음', 영향: '경관 심의에서 통경축·조망 차폐 지적 가능', 확인자료: '/landscape 통경축 개방률', 대안: '호수 줄이기(동 나누기) 또는 꺾인 판상·탑상으로', 근거: '경험(가정)' }); } });
    // ④ 높이 차이: 40m 안 이웃 동 층수 차이 12개층 이상
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
      const a = blds[i], b = blds[j], d = Math.min(...a.poly.map(p => Math.min(...b.poly.map(r => Math.hypot(p[0] - r[0], p[1] - r[1])))));
      if (d < 40 && Math.abs(a.floors - b.floors) >= 12) add({ id: 'height_jump', 항목: `${a.id}·${b.id}동 층수 차이 ${Math.abs(a.floors - b.floors)}개층`, 등급: '권고', 동: [a.id, b.id], 원인: `거리 ${d.toFixed(0)}m에 ${a.floors}층·${b.floors}층`, 영향: '스카이라인이 들쭉날쭉 — 경관 심의 지적 가능', 확인자료: '/landscape 입면', 대안: '층수를 단계적으로(남저북고·경계부 저층)', 근거: '경험(가정)' });
    }
    // ⑤ 동 사이 실무 권고(2026-11-05 사용자 결정 '가안': 법정 거리는 규칙(탈락), 실무 권고는 경험 항목으로 표시만)
    //  가정값: 비껴 놓인 동도 둘레 사이 nearGap_m(10m) 이상, 남북으로 마주 보는 채광창 벽은 남쪽 동(그림자 드리우는 동) 높이 × nsRatio(1.0) 이상
    const PR = Object.assign({ nearGap_m: 10, nsRatio: 1.0 }, opt.practical || {}), bad = new Set(q.rules.filter(r => r.동 && r.동.length === 2).map(r => r.동.slice().sort().join('-')));
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
      const a = blds[i], b = blds[j], key = [a.id, b.id].sort().join('-'); if (bad.has(key)) continue;
      const A = bbW(a), B = bbW(b); if (Math.hypot(Math.max(0, B[0] - A[2], A[0] - B[2]), Math.max(0, B[1] - A[3], A[1] - B[3])) > Math.max(PR.nearGap_m, PR.nsRatio * H(opt, Math.max(a.floors, b.floors)))) continue;
      const pn = f => Math.max(10, PR.nsRatio * H(opt, f.S.floors));   // 그림자를 드리우는 남쪽 동 높이 기준
      const ns = facings(a, b, opt, PR.nsRatio).filter(f => f.kind === 'ns' && f.w.win && f.d < pn(f) - 0.05).sort((x, y) => x.d - y.d)[0];
      if (ns) { const hh = pn(ns); add({ id: 'spacing_practical', 항목: `${ns.S.id}·${ns.N.id}동 앞뒤 거리 ${ns.d.toFixed(1)}m(남쪽 동 높이 × ${PR.nsRatio} = ${hh.toFixed(1)}m 미만)`, 등급: '권고', 동: [ns.S.id, ns.N.id],
        원인: `법정 거리는 채웠으나 ${ns.S.floors}층·${ns.N.floors}층 동이 가깝게 마주 봄`, 영향: '저층 세대 일조·사생활(시선 간섭) 민원, 분양성 저하 가능', 확인자료: '동지 일조 시뮬레이션·입면', 대안: '앞뒤 동 간격 넓히기 또는 남쪽 동 층수 낮추기', 근거: '실무 권고(가정값) — 법정 기준 아님' }); }
      const md = minDist(a, b);
      if (md < PR.nearGap_m) add({ id: 'near', 항목: `${a.id}·${b.id}동 근접 ${md.toFixed(1)}m(${PR.nearGap_m}m 미만)`, 등급: '주의', 동: [a.id, b.id],
        원인: '벽면이 마주 보지 않아(비껴 놓임·모서리끼리) 법정 동 사이 거리는 걸리지 않지만 가까움', 영향: '모서리 세대 시선 간섭·화재 확산·통풍, 심의 지적 가능', 확인자료: '배치도 동 사이 치수', 대안: '동을 옮기거나 돌려 간격 확보', 근거: '실무 권고(가정값) — 법정 기준 아님' });
    }
    const ev = evaluate(site, blds, opt, q);
    return Object.assign({}, q, { risks, prefs: ev.prefs, score: ev.score });
  }

  /* ---------- 동 사이 거리 단서(2026-11-05): 건축법 시행령 제86조③2호 단서 — "그 대지의 모든 세대가 동지를 기준으로 9시에서 15시 사이에
     2시간 이상을 계속하여 일조를 확보할 수 있는 거리 이상으로 할 수 있다" → 동 사이 거리가 모자라도 이걸 입증하면 가능
     개략 확인: 동마다 남쪽을 향한 채광창 벽 앞 1m·1층 높이(가장 불리한 자리)를 6m 간격으로 재서 연속 2시간 이상인지. 정밀 일조 분석(층별·세대별)으로 입증해야 함 */
  function proviso(site, blds, opt) {
    const tol = { 연속_h: 2, 연속_구간: [9, 15], 합계_h: 99, 합계_구간: [8, 16] }, lat = +opt.lat || 37.46, Hf = f => H(opt, f);
    const per = [];
    blds.forEach(b => {
      const pts = [];
      wallsW(b).filter(w => w.win && w.n[1] < -0.3).forEach(w => { const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), k = Math.max(1, Math.round(L / 6));
        for (let i = 0; i < k; i++) { const t = (i + 0.5) / k; pts.push([w.a[0] + (w.b[0] - w.a[0]) * t + w.n[0], w.a[1] + (w.b[1] - w.a[1]) * t + w.n[1]]); } });
      if (!pts.length) return;
      const r = G.sunHours(blds.filter(o => o !== b), Hf, lat, pts, tol), bad = r.filter(x => !x.ok).length;
      per.push({ id: b.id, n: pts.length, bad, minCont: Math.min(...r.map(x => x.cont)) });
    });
    const bad = per.filter(x => x.bad);
    return { ok: !bad.length, per, bad, 근거: '건축법 시행령 제86조③2호 단서(동지 9~15시 연속 2시간 이상)', 메모: '1층 남쪽 창 앞 지점 기준 개략 — 정밀 일조 분석(세대별)으로 입증 필요' };
  }

  /* ---------- 치수선(2026-11-05, 사용자 요구 '인동거리·일조권·통경축은 치수선을 그대로 표시하면 바로 보일 것') ----------
     배치도에 그릴 치수선 목록: { kind, a, b(월드 좌표 양 끝), d(실제 m), need(기준 m), 판정('통과'|'위반'|'권고'|'참고'), 동, 글(짧은 이름표), 근거 }
       spacing  동 사이(인동): 두 동마다 마주 보는 벽 중 기준 대비 가장 빠듯한 곳 하나(벽면 직각 방향)
       sun      정북 일조: 동마다 정북 인접대지 경계까지 정북 방향으로 가장 가까운 곳(도로·공원이 있으면 반폭 더한 값으로 판정)
       window   채광창 이격: 동마다 채광창 벽면 직각 방향 경계까지 가장 빠듯한 곳(여유 30% 안쪽만)
       corridor 통경축: 구획(block)이 다른 이웃 동 사이 가장 좁은 틈(opt.corridor_m 가정 폭과 비교, 법정 아님)
     기본은 빠듯한 곳(실제가 기준의 1.5배 이내)·위반·권고만 — 다 그리면 치수선이 겹쳐 안 보임. opt.dimAll = 전체 */
  function dims(site, blds, opt) {
    const out = [], A = opt.assume, sp = opt.spacing, PR = Object.assign({ nsRatio: 1.0 }, opt.practical || {});
    const E = G.edges(site.pts), gapOf = i => { const ew = +((opt.edgeW || [])[i]) || 0, tg = site.tags[i]; return (ew > 0 ? ew : tg === 'park' ? (+opt.parkWidth || 0) : 0) / 2; };
    const m1 = v => v.toFixed(1);
    // ① 동 사이
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
      const a = blds[i], b = blds[j], A2 = bbW(a), B2 = bbW(b);
      if (Math.hypot(Math.max(0, B2[0] - A2[2], A2[0] - B2[2]), Math.max(0, B2[1] - A2[3], A2[1] - B2[3])) > Math.max(10, sp * H(opt, Math.max(a.floors, b.floors))) * 1.3) continue;
      { const c = cornerCheck(a, b, opt), CN = cornerOf(opt), np = CN ? null : nearPair(a, b);
        if (c) out.push({ kind: 'corner', a: c.p, b: c.q, d: c.d, need: c.need, 판정: '위반', 동: [a.id, b.id], 글: `${m1(c.d)}m / 기준 ${m1(c.need)}m`, 근거: '실무 기준(가정값, 법정 아님)' });
        else if (np && np.d < 10) out.push({ kind: 'corner', a: np.p, b: np.q, d: np.d, need: 10, 판정: '권고', 동: [a.id, b.id], 글: `${m1(np.d)}m / 권고 10m`, 근거: '실무 권고(가정값, 법정 아님)' }); }
      const f = facings(a, b, opt, sp).sort((x, y) => x.d / x.need - y.d / y.need)[0]; if (!f) continue;
      const bad = f.d < f.need - 0.05, pn = f.kind === 'ns' ? Math.max(10, PR.nsRatio * H(opt, f.S.floors)) : 0, adv = !bad && f.kind === 'ns' && f.w.win && f.d < pn - 0.05;
      out.push({ kind: 'spacing', a: f.p0, b: f.p1, d: f.d, need: f.need, 판정: bad ? '위반' : adv ? '권고' : '통과', 동: [f.X.id, f.Y.id],
        글: `${m1(f.d)}m / 기준 ${m1(f.need)}m` + (adv ? ` (권고 ${m1(pn)}m)` : ''), 근거: f.근거 });
    }
    blds.forEach(b => {
      const h = H(opt, b.floors), pts = ringsOf(b).flat();
      // ② 정북 일조(시행령 제86조①): 10m 이하 부분 1.5m, 넘는 부분 높이의 1/2
      if (!opt.southBase) {
        let best = null;
        E.forEach((e, i) => {
          const tg = site.tags[i]; if (!(tg === 'north' || (tg === 'park' && e.out[1] > 0.5))) return;
          const x0 = Math.min(e.a[0], e.b[0]), x1 = Math.max(e.a[0], e.b[0]); if (x1 - x0 < 1e-6) return;
          pts.forEach(p => { if (p[0] < x0 || p[0] > x1) return; const y = e.a[1] + (e.b[1] - e.a[1]) * (p[0] - e.a[0]) / (e.b[0] - e.a[0]), d = y - p[1]; if (d >= 0 && (!best || d + gapOf(i) < best.d + best.g)) best = { d, g: gapOf(i), p, q: [p[0], y] }; });
        });
        if (best) {
          const s2 = opt.sun || {}, need = h <= 10 ? (+s2.높이10m이하_m || 1.5) : h * (+s2.높이10m초과_높이비 || 0.5), dd = best.d + best.g;
          out.push({ kind: 'sun', a: best.p, b: best.q, d: dd, need, 판정: dd < need - 0.05 ? '위반' : '통과', 동: [b.id], 글: `정북 ${m1(best.d)}m${best.g ? ` + 도로 반폭 ${m1(best.g)}m` : ''} / 기준 ${m1(need)}m`, 근거: '건축법 시행령 제86조①' });
        }
      }
      // ③ 채광창 이격(시행령 제86조③1호·⑥): 높이 ≤ 배수 × (거리 + 도로·공원 반폭)
      if (opt.winRatio) {
        let best = null;
        wallsW(b).forEach(w => { if (!w.win) return; E.forEach((e, i) => {
          if (w.n[0] * e.out[0] + w.n[1] * e.out[1] <= 0.3) return;
          const dd = G.dirDist([w.a, w.b], e.a, e.b, w.n); if (dd === null) return;
          const need = h / opt.winRatio - gapOf(i); if (!best || dd / Math.max(need, 0.1) < best.r) {
            const m = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]; best = { r: dd / Math.max(need, 0.1), d: dd, need, g: gapOf(i), a: m, b: [m[0] + w.n[0] * dd, m[1] + w.n[1] * dd] }; }
        }); });
        if (best && best.r < 1.3) out.push({ kind: 'window', a: best.a, b: best.b, d: best.d, need: Math.max(0, best.need), 판정: best.d < best.need - 0.05 ? '위반' : '통과', 동: [b.id], 글: `창 ${m1(best.d)}m${best.g ? ` + 반폭 ${m1(best.g)}m` : ''} / 기준 ${m1(Math.max(0, best.need + best.g))}m`, 근거: '건축법 시행령 제86조③1호·⑥' });
      }
    });
    // ④ 통경축(가정 폭, 법정 아님): 구획이 다른 이웃 동 사이 가장 좁은 틈
    const cw = +opt.corridor_m || 0;
    if (cw > 0) {
      const seen = {};
      for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
        const a = blds[i], b = blds[j]; if (a.block == null || b.block == null || a.block === b.block) continue;
        const k = [a.block, b.block].sort().join('-'), np = nearPair(a, b); if (!seen[k] || np.d < seen[k].d) seen[k] = Object.assign(np, { ids: [a.id, b.id] });
      }
      Object.values(seen).forEach(np => { if (np.d < cw * 3) out.push({ kind: 'corridor', a: np.p, b: np.q, d: np.d, need: cw, 판정: np.d < cw - 0.05 ? '권고' : '참고', 동: np.ids, 글: `통경 ${m1(np.d)}m / 가정 ${m1(cw)}m`, 근거: '통경축 폭(가정값) — 경관 심의 확인' }); });
    }
    // 기본은 빠듯한 곳만(실제 ≤ 기준 × 1.5) + 위반·권고·통경축. opt.dimAll이면 전부
    return opt.dimAll ? out : out.filter(d => d.kind === 'corridor' || d.판정 !== '통과' || d.d <= Math.max(d.need, 1) * 1.5);
  }
  // 두 동 사이 가장 가까운 두 점
  function nearPair(a, b) {
    let best = { d: Infinity };
    const f = (P, Q, sw) => P.flat().forEach(p => Q.forEach(q => q.forEach((x, i) => { const y = q[(i + 1) % q.length], dx = y[0] - x[0], dy = y[1] - x[1], t = Math.max(0, Math.min(1, ((p[0] - x[0]) * dx + (p[1] - x[1]) * dy) / (dx * dx + dy * dy || 1))), c = [x[0] + dx * t, x[1] + dy * t], d = Math.hypot(p[0] - c[0], p[1] - c[1]); if (d < best.d) best = sw ? { d, p: c, q: p } : { d, p, q: c }; })));
    f(ringsOf(a), ringsOf(b), false); f(ringsOf(b), ringsOf(a), true); return best;
  }

  const api = { quick, evaluate, verify, pairCheck, cornerCheck, facings, minDist, dims, nearPair, proviso, gfaOf, unitsOf, overlapConvex, bboxIn };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.JbsCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
