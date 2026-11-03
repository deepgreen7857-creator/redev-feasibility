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

  // 다각형 poly 각 부분에서 정북(+y)으로 올라가 선분 ab를 만나는 최소 거리. 만나는 곳이 없으면 null
  // 정남 기준(건축법 제61조③): 건물 각 점에서 정남 방향으로 잰 경계까지 거리 — 정북 거리를 위아래 뒤집어 잼
  function southDist(poly, a, b) { const f = p => [p[0], -p[1]]; return northDist(poly.map(f), f(a), f(b)); }
  // 임의 방향 dir(단위벡터)으로 잰 거리: 건물 각 점에서 dir 방향으로 나아가 변 a-b에 닿는 가장 짧은 거리. 그 방향 연장선에 변이 없으면 null
  //  채광창 이격(시행령 제86조③1호)은 '채광창이 있는 벽면에서 직각 방향'으로 잼 → 벽면 앞에 있지 않은 경계는 제한하지 않음
  function dirDist(poly, a, b, dir) {
    const f = p => [p[0] * dir[1] - p[1] * dir[0], p[0] * dir[0] + p[1] * dir[1]];   // dir이 +y가 되게 돌림
    return northDist(poly.map(f), f(a), f(b));
  }
  function northDist(poly, a, b) {
    const pts = []; poly.forEach((p, i) => { const q = poly[(i + 1) % poly.length]; for (let k = 0; k < 6; k++) pts.push([p[0] + (q[0] - p[0]) * k / 6, p[1] + (q[1] - p[1]) * k / 6]); });
    let best = null;
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    pts.forEach(p => {
      if (p[0] < x0 - 1e-9 || p[0] > x1 + 1e-9 || Math.abs(b[0] - a[0]) < 1e-9) return;
      const y = a[1] + (b[1] - a[1]) * (p[0] - a[0]) / (b[0] - a[0]), dy = y - p[1];
      if (dy >= -1e-6 && (best === null || dy < best)) best = Math.max(0, dy);
    });
    return best;
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
  /* ---------- 주동 형태 모듈 ----------
     지역 좌표: x = 줄 방향(0~L), y = 북쪽(0~D). parts = 볼록 다각형 목록(그림자·3D·건축면적용),
     cores = 코어(계단·승강기) 사각형, divs = 세대 경계선. 형태: slab 판상 / tower 탑상 / Y Y형 / L ㄱ형 / court ㅁ형(중정형) */
  const FORM_NAME = { slab: '판상형', tower: '탑상형', Y: 'Y형', L: 'ㄱ형', court: 'ㅁ형(중정형)', mix: '판상+탑상 혼합' };
  const R4 = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const sq = (cx, cy, a) => R4(cx - a / 2, cy - a / 2, cx + a / 2, cy + a / 2);
  // 평면 라이브러리(criteria/arch.json '평면_라이브러리') — layout이 opt.lib로 넣음
  let LIB = {};
  const num0 = (v, d) => (isFinite(+v) && v !== '' && v !== null ? +v : d);
  // 단위세대 조각: 전면(y=0)이 채광면. 판상은 첫 베이 들임 + 후면 돌출(다용도실·실외기실), 탑상은 들임만
  function unitRects(u, kind) {
    const W = u.폭, Dp = u.깊이, bays = u.베이 || 3, bw = W / bays;
    const P = (LIB[kind === 'tower' ? '탑상_세대' : '판상_세대']) || {};
    const ri = num0(P.전면들임_m, 0.9), out = [];
    if (bays >= 3 && ri > 0) { out.push(R4(0, ri, bw, Dp), R4(bw, 0, W, Dp)); } else out.push(R4(0, 0, W, Dp));
    if (kind !== 'tower') { const bd = num0(P.후면돌출_깊이_m, 1.3), bf = num0(P.후면돌출_폭비, 0.32); if (bd > 0 && bf > 0) out.push(R4(W * (1 - bf) - 0.4, Dp, W - 0.4, Dp + bd)); }
    return out;
  }
  const mirrorX = (rs, x0) => rs.map(q => q.map(([x, y]) => [2 * x0 - x, y]).reverse());
  const shiftR = (rs, dx, dy) => rs.map(q => q.map(([x, y]) => [x + dx, y + dy]));
  // 판상형(계단식): [세대 | 코어 | 세대(거울)] 2호 조합을 n/2번 이음. 코어는 전면에서 들여 앉힘
  function slab(U, c, t, n) {
    const u = U[t], w = u.폭, d = u.깊이, PC = LIB.판상_코어 || {}, cw = num0(PC.폭_m, c), cf = num0(PC.전면들임_m, 1.5);
    const bd = num0((LIB.판상_세대 || {}).후면돌출_깊이_m, 1.3), D = d + bd, L = n * w + (n / 2) * cw;
    const parts = [], cores = [], units = [];
    for (let k = 0; k < n / 2; k++) {
      const x0 = k * (2 * w + cw);
      const left = shiftR(mirrorX(unitRects(u, 'slab'), w / 2), x0, 0);           // 왼쪽 세대: 들임이 바깥(코어 반대)쪽
      const right = shiftR(unitRects(u, 'slab'), x0 + w + cw, 0);
      const core = R4(x0 + w, cf, x0 + w + cw, D);
      units.push(left, right); cores.push(core); parts.push(...left, ...right, core);
    }
    return { form: 'slab', t, n, L, D, parts, cores, divs: [], units };
  }
  // 탑상형: 바람개비형 4호 — 가운데 코어, 세대 4개가 코어 네 변에 한쪽으로 치우쳐 붙어 도는 모양(세대마다 2면 개방)
  function tower(U, c, t) {
    const u = U[t], w = u.폭, d = u.깊이, s = num0((LIB.탑상_코어 || {}).한변_m, Math.max(c + 3, 8));
    const base = unitRects(u, 'tower').map(q => q.map(([x, y]) => [-s / 2 + x, s / 2 + d - y]));   // 위쪽 세대(전면이 북쪽 바깥)
    const rotq = (q, k) => q.map(([x, y]) => { let p = [x, y]; for (let i = 0; i < k; i++) p = [p[1], -p[0]]; return p; });
    const units = [0, 1, 2, 3].map(k => base.map(q => rotq(q, k)));
    const core = [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]];
    const all = units.flat().concat([core]).flat(), mx = Math.min(...all.map(p => p[0])), my = Math.min(...all.map(p => p[1]));
    const sh = q => q.map(([x, y]) => [x - mx, y - my]);
    const L = Math.max(...all.map(p => p[0])) - mx, D = Math.max(...all.map(p => p[1])) - my;
    const U2 = units.map(rs => rs.map(sh));
    return { form: 'tower', t, n: 4, L, D, parts: U2.flat().concat([sh(core)]), cores: [sh(core)], divs: [], units: U2 };
  }
  // Y형: 육각 코어 + 세 날개(남·북동·북서), 날개마다 1세대(대형) 또는 2세대(소형, 날개 길이 2배)
  function yForm(U, c, t) {
    const w = U[t].폭, d = U[t].깊이, per = U[t].전용 <= 60 ? 2 : 1, len = d * per;
    const a = Math.max(c * 0.8, w / 2 / 1.6), Rh = a / Math.cos(Math.PI / 6);
    const hex = [0, 1, 2, 3, 4, 5].map(i => [Rh * Math.cos(i * Math.PI / 3), Rh * Math.sin(i * Math.PI / 3)]);
    const dirs = [-90, 30, 150].map(x => x * D2R), parts = [hex], divs = [];
    dirs.forEach(th => {
      const u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]], P = (s, q) => [u[0] * s + v[0] * q, u[1] * s + v[1] * q];
      parts.push([P(a, -w / 2), P(a + len, -w / 2), P(a + len, w / 2), P(a, w / 2)]);
      divs.push([P(a, -w / 2), P(a, w / 2)]); if (per === 2) divs.push([P(a + d, -w / 2), P(a + d, w / 2)]);
    });
    const all = parts.flat(), mx = Math.min(...all.map(p => p[0])), my = Math.min(...all.map(p => p[1]));
    const sh = p => [p[0] - mx, p[1] - my], L = Math.max(...all.map(p => p[0])) - mx, D = Math.max(...all.map(p => p[1])) - my;
    return { form: 'Y', t, n: 3 * per, L, D, parts: parts.map(q => q.map(sh)), cores: [hex.map(p => [p[0] * 0.75 - mx, p[1] * 0.75 - my])], divs: divs.map(q => q.map(sh)) };
  }
  // ㄱ형: 남향 판상(a세대) + 한쪽 끝에서 북쪽으로 꺾인 날개(b세대). mirror면 서쪽 끝에서 꺾임
  function lForm(U, c, t, a, b, mirror) {
    // 남향 판상(라이브러리 세대·코어) + 동쪽 끝에서 북쪽으로 꺾인 날개(b세대, 세대 사이 코어)
    const u = U[t], w = u.폭, d = u.깊이, base = slab(U, c, t, a), L1 = base.L, y0 = base.D, L2 = b * w + Math.ceil(b / 2) * c;
    const wingU = [[R4(L1 - d, y0, L1, y0 + w)], [R4(L1 - d, y0 + w + c, L1, y0 + L2)]].slice(0, b === 1 ? 1 : 2);
    const wingC = R4(L1 - d * 0.62, y0 + w, L1, y0 + w + c);
    let parts = base.parts.concat(wingU.flat(), [wingC]), cores = base.cores.concat([wingC]), units = base.units.concat(wingU);
    if (mirror) { const f = q => q.map(([x, y]) => [L1 - x, y]); parts = parts.map(f); cores = cores.map(f); units = units.map(rs => rs.map(f)); }
    return { form: 'L', t, n: a + b, a, b, L: L1, D: y0 + L2, parts, cores, divs: [], units };
  }
  // ㅁ형(중정형): 한 변 k세대 폭의 정방형 둘레 동, 가운데 중정
  //  k = 한 변 세대 수(6·4), k = 0이면 가장 작은 중정(동 깊이 2배·18m 이상)으로 둘레를 정함
  function court(U, c, t, k) {
    const w = U[t].폭, d = U[t].깊이, S = k ? k * w + (k / 2) * c : 2 * d + Math.max(2 * d, 18);
    if (S - 2 * d < Math.max(2 * d, 18) - 1e-6) return null; // 중정이 너무 좁으면 쓰지 않음
    const n = Math.floor(4 * (S - d) / (w + c / 2) / 2) * 2;
    const parts = [R4(0, 0, S, d), R4(0, S - d, S, S), R4(0, d, d, S - d), R4(S - d, d, S, S - d)];
    const cores = [R4(d * 0.55, d * 0.55, d, d), R4(S - d, d * 0.55, S - d * 0.55, d), R4(S - d, S - d, S - d * 0.55, S - d * 0.55), R4(d * 0.55, S - d, d, S - d * 0.55)];
    const divs = [], m = Math.max(1, Math.round((S - 2 * d) / (w + c / 2)));
    for (let i = 1; i < m; i++) { const z = d + (S - 2 * d) * i / m; divs.push([[z, 0], [z, d]], [[z, S - d], [z, S]], [[0, z], [d, z]], [[S - d, z], [S, z]]); }
    if (n < 4) return null;
    return { form: 'court', t, n, L: S, D: S, parts, cores, divs, inner: S - 2 * d };
  }
  // 형태별 후보 모듈(큰 것 → 작은 것 순). 혼합은 forms 배열 순서대로 시도
  // 탑상·Y형은 탑상 세대 치수(평면[t].탑상 — 실제 사례 값)가 있으면 그 폭·깊이로 그림(없으면 판상 치수)
  const towerU = (U, t) => { const tw = U[t] && U[t].탑상; return tw && +tw.폭 > 0 && +tw.깊이 > 0 ? Object.assign({}, U, { [t]: Object.assign({}, U[t], { 폭: +tw.폭, 깊이: +tw.깊이, 베이: +tw.베이 || U[t].베이 }) }) : U; };
  function modulesFor(U, c, t, form) {
    if (form === 'tower') return [tower(towerU(U, t), c, t)];
    if (form === 'Y') return [yForm(towerU(U, t), c, t)];
    // ㄱ형: 판상 4호·2호 + 꺾인 날개 2호·1호(작은 것까지 있어야 큰 평형도 좁은 자리에 들어감)
    if (form === 'L') return [lForm(U, c, t, 4, 2, false), lForm(U, c, t, 4, 1, false), lForm(U, c, t, 2, 2, false), lForm(U, c, t, 2, 1, false)];
    if (form === 'court') { const out = []; [6, 4, 0].forEach(k => { const m = court(U, c, t, k); if (m && !out.some(o => Math.abs(o.L - m.L) < 1)) out.push(m); }); return out; }
    return [slab(U, c, t, 4), slab(U, c, t, 6), slab(U, c, t, 2)];
  }

  function layout(site, opt) {
    const U = opt.units, A = opt.assume, mix = opt.mix; // mix: {59:비율,...}
    LIB = opt.lib || {};
    const types = Object.keys(mix).filter(t => mix[t] > 0 && U[t]);
    if (!types.length) throw new Error('평형 비율이 모두 0입니다');
    const th = (opt.angle || 0) * D2R;
    const R = site.pts.map(p => rot(p, -th)); // 회전 좌표계
    const testRaw = buildableTest(site.pts, site.setbacks);
    const exclude = site.exclude || [];
    // 기반시설(건축 불가 영역): 안쪽 금지 + 경계에서 exSetback(m) 띄움
    const exS = opt.exSetback || 0, exE = exclude.map(ex => ex.map((a, i) => [a, ex[(i + 1) % ex.length]]));
    const test = (x, y) => { const p = rot([x, y], th); if (!testRaw(p[0], p[1]) || insideAny(p[0], p[1], exclude)) return false; return !exS || exE.every(es => es.every(([a, b]) => segDist(p, a, b) >= exS)); };
    const xs = R.map(p => p[0]), ys = R.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs), ymin = Math.min(...ys), ymax = Math.max(...ys);
    const H = f => f * A.floorHeight_m + A.groundExtra_m;
    const want = {}; const sumMix = types.reduce((s, t) => s + mix[t], 0); types.forEach(t => { want[t] = mix[t] / sumMix; });
    // opt.form: slab 판상 / tower 탑상 / Y / L ㄱ형 / court ㅁ형 / mix 판상+탑상 혼합(긴 구간은 판상, 남는 짧은 구간은 탑상)
    const form = FORM_NAME[opt.form] ? opt.form : 'slab';
    const MODS = {}; types.forEach(t => { MODS[t] = form === 'mix' ? modulesFor(U, A.coreW_m, t, 'slab').slice(0, 2).concat(modulesFor(U, A.coreW_m, t, 'tower')) : modulesFor(U, A.coreW_m, t, form); });
    const Dmax = Math.max(...types.flatMap(t => MODS[t].map(m => m.D)));

    // 한 줄 채우기: 형태 그룹 fm(같은 형태의 모듈들)으로 [y0, y0+D] 띠를 채움. cols는 복사본에 반영
    function fillRow(y0, cols0) {
      const D = Dmax;
      if (y0 + D > ymax) return null;
      const cols = Object.assign({}, cols0), out = [];
      stripRanges(test, xmin, xmax, y0, y0 + D).forEach(([s, e]) => {
        let x = s; const items = [];
        while (true) {
          // 부족한 평형부터, 큰 모듈 → 작은 모듈 순으로 들어가는 것 고르기
          const tot = Object.values(cols).reduce((a, b) => a + b, 0) || 1;
          const order = types.slice().sort((a, b) => (cols[a] / tot - want[a]) - (cols[b] / tot - want[b]));
          let pick = null;
          for (const t of order) { for (const m of MODS[t]) { if (x + m.L <= e + 1e-6) { pick = m; break; } } if (pick) break; }
          if (!pick) break;
          items.push({ x, m: pick }); cols[pick.t] += pick.n; x += pick.L + A.sideGap_m;
        }
        if (!items.length) return;
        const last = items[items.length - 1], shift = (e - s - (last.x + last.m.L - s)) / 2; // 가운데 맞춤
        items.forEach(it => {
          let m = it.m; const rx = it.x + shift;
          if (m.form === 'L' && rx + m.L / 2 < (s + e) / 2) m = lForm(U, A.coreW_m, m.t, m.a, m.b, true); // 왼쪽 반은 거울상(날개가 바깥쪽)
          out.push({ m, rx });
        });
      });
      return out.length ? { D, items: out, cols, units: out.reduce((a, it) => a + it.m.n, 0) } : null;
    }
    function place(rowFloors) {
      const blds = []; let cols = {}; types.forEach(t => { cols[t] = 0; });
      let y0 = ymin, row = 0;
      while (y0 < ymax) {
        const f = rowFloors(row);
        const best = fillRow(y0, cols);
        if (!best) { y0 += 1; continue; } // 이 높이엔 들어갈 곳이 없음 → 1m 위로
        best.items.forEach(it => blds.push({ row, t: it.m.t, n: it.m.n, form: it.m.form, mod: it.m, floors: f, L: it.m.L, D: it.m.D, rx: it.rx, ry: y0 }));
        cols = best.cols;
        // 다음 줄: 이 줄 동들의 실제 북쪽 끝 + 인동간격
        y0 = y0 + Math.max(...best.items.map(it => it.m.D)) + opt.spacing * H(f); row++;
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
      return toWorld(blds);
    }
    // 회전 되돌린 꼭짓점·형태 도형
    function toWorld(blds) {
      blds.forEach((b, i) => {
        b.id = 101 + i;
        const W = p => rot([b.rx + p[0], b.ry + p[1]], th), m = b.mod;
        b.parts = m.parts.map(q => q.map(W)); b.cores = m.cores.map(q => q.map(W)); b.divs = m.divs.map(q => q.map(W)); b.units = (m.units || []).map(rs => rs.map(q => q.map(W)));
        b.poly = hull(b.parts.flat()); b.angle = opt.angle || 0; b.center = W([b.L / 2, b.D / 2]);
        b.inner = m.inner || 0; b.ba = m.parts.reduce((s2, q) => s2 + Math.abs(area(q)), 0); b.local = { L: m.L, D: m.D, parts: m.parts, cores: m.cores, divs: m.divs, units: m.units || [] }; delete b.mod;
      });
      return blds;
    }

    /* ---------- 자유 배치: 1m 격자로 건축 가능 여부를 미리 계산(누적합), 남쪽부터 동마다 들어갈 자리를 찾음 ----------
       들쭉날쭉하거나 비스듬한 구역에서 줄 배치보다 훨씬 많이 들어감. 인동간격: 남북으로 겹치는 동끼리 남쪽 동 높이 × 배수,
       옆으로 나란한 동끼리 측면 간격 */
    const GX0 = Math.floor(xmin), GY0 = Math.floor(ymin), GW = Math.ceil(xmax) - GX0 + 1, GH = Math.ceil(ymax) - GY0 + 1;
    let SUM = null;
    function grid() {
      if (SUM) return SUM;
      SUM = new Int32Array((GW + 1) * (GH + 1));
      for (let j = 0; j < GH; j++) { let row = 0; for (let i = 0; i < GW; i++) { if (!test(GX0 + i + 0.5, GY0 + j + 0.5)) row++; SUM[(j + 1) * (GW + 1) + i + 1] = SUM[j * (GW + 1) + i + 1] + row; } }
      return SUM;
    }
    // 회전 좌표계 사각형 [x0,x1]×[y0,y1]에 건축 불가 칸이 하나도 없으면 true
    function free(x0, y0, x1, y1) {
      const S = grid(), i0 = Math.floor(x0 - GX0), j0 = Math.floor(y0 - GY0), i1 = Math.ceil(x1 - GX0), j1 = Math.ceil(y1 - GY0);
      if (i0 < 0 || j0 < 0 || i1 > GW || j1 > GH) return false;
      return S[j1 * (GW + 1) + i1] - S[j0 * (GW + 1) + i1] - S[j1 * (GW + 1) + i0] + S[j0 * (GW + 1) + i0] === 0;
    }
    function fits(m, x, y) {
      if (!m._bb) m._bb = m.parts.map(q => { const xs = q.map(p => p[0]), ys = q.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; });
      for (const b of m._bb) if (!free(x + b[0], y + b[1], x + b[2], y + b[3])) return false;
      return true;
    }
    // 인동간격·측면 간격 검사. 통과하면 null, 막히면 다음에 시도할 x(막은 동의 오른쪽 끝 너머)
    //  남북으로 겹치는 두 동 사이는 '남쪽 동' 높이 × 배수(각 동의 실제 층수 fl·o.floors 기준)
    function blocker(m, x, y, placed, fl) {
      const gNew = opt.spacing * H(fl), gS = A.sideGap_m;
      for (const o of placed) {
        const gO = opt.spacing * H(o.floors), gMax = Math.max(gNew, gO);
        if (o.ry + o.D + gMax <= y) continue; // 충분히 남쪽(이미 지나간 줄)
        const xo = Math.min(x + m.L, o.rx + o.L) - Math.max(x, o.rx), yo = Math.min(y + m.D, o.ry + o.D) - Math.max(y, o.ry);
        if (xo > 0) { // 남북으로 겹침
          if (y >= o.ry ? y - (o.ry + o.D) < gO : o.ry - (y + m.D) < gNew) return o.rx + o.L;
        } else if (yo > -gMax * 0.3) { // 옆으로 나란함: 측면 간격
          if (Math.max(o.rx - (x + m.L), x - (o.rx + o.L)) < gS) return o.rx + o.L + gS;
        }
      }
      return null;
    }
    // 그 자리에 놓았을 때 채광창·정북 일조 등으로 정해지는 최고 층수(놓기 전에 미리 봄)
    function capAt(m, x, y) {
      const poly = hull(m.parts.flat().map(p => rot([x + p[0], y + p[1]], th)));
      return capFloors({ poly, form: m.form, inner: m.inner || 0 });
    }
    function pack(F) {
      const blds = [], cols = {}; types.forEach(t => { cols[t] = 0; });
      const st = opt.quick ? 3 : GW * GH > 25000 ? 2 : 1; // 큰 구역은 2m 간격(방향 고르기용 빠른 추정은 3m)
      const ordOf = () => { const tot = Object.values(cols).reduce((a, b) => a + b, 0) || 1; return types.slice().sort((a, b) => (cols[a] / tot - want[a]) - (cols[b] / tot - want[b])); };
      let order = ordOf();
      // 세 번 훑음
      //  0차: 기준 층수(F)까지 올릴 수 있는 자리에만, 평형 비율이 목표보다 MIX_TOL 넘게 많아지는 모듈은 빼고(큰 평형 자리를 남김)
      //  1차: 기준 층수까지 올릴 수 있는 남은 자리를 아무 평형으로나
      //  2차: 채광창·정북 일조로 낮아지는 남은 자리에 낮은 동(그 자리 최고 층수, 최저 층수 이상) — 낮은 동은 인동간격도 낮은 높이로
      // 예전에는 높이 제한을 보지 않고 놓은 뒤 깎아서, 경계 가까이 낮아진 동이 높은 동 기준 간격을 차지해 땅이 많이 버려졌음
      const MIX_TOL = 0.06, over = m => { const tot = Object.values(cols).reduce((a, b) => a + b, 0) + m.n; return tot > 12 && (cols[m.t] + m.n) / tot > want[m.t] + MIX_TOL; };
      const flip = (m, x) => (m.form === 'L' && x + m.L / 2 < (xmin + xmax) / 2 ? lForm(U, A.coreW_m, m.t, m.a, m.b, true) : m);
      for (let pass = types.length > 1 ? 0 : 1; pass < 3; pass++) {
        if (pass === 2 && F <= A.minFloors) break;
        for (let y = GY0; y <= ymax; y += st) {
          for (let x = GX0; x <= xmax; x += st) {
            let pick = null, pf = 0, jump = Infinity;
            for (const t of order) {
              for (const m0 of MODS[t]) {
                if (pass === 0 && over(m0)) break;
                if (!fits(m0, x, y)) continue;
                const m = flip(m0, x), c = capAt(m, x, y), fl = Math.min(F, c);
                if (pass < 2 ? c < F : fl < A.minFloors) continue;
                const bx = blocker(m, x, y, blds, fl);
                if (bx === null) { pick = m; pf = fl; break; }
                jump = Math.min(jump, bx);
              }
              if (pick) break;
            }
            if (!pick) { if (isFinite(jump) && jump - st > x) x = Math.ceil(jump) - st; continue; }
            const m = pick;
            blds.push({ row: 0, t: m.t, n: m.n, form: m.form, mod: m, floors: pf, L: m.L, D: m.D, rx: x, ry: y });
            cols[m.t] += m.n; order = ordOf(); x = Math.ceil(x + m.L + A.sideGap_m) - st;
          }
        }
      }
      // 줄 번호: 남쪽부터 y가 비슷한 것끼리(동 깊이 안쪽 차이)
      blds.sort((a, b) => a.ry - b.ry); let r = 0, y0 = blds.length ? blds[0].ry : 0;
      blds.forEach(b => { if (b.ry - y0 > b.D) { r++; y0 = b.ry; } b.row = r; });
      return toWorld(blds);
    }
    // 줄 배치와 자유 배치 중 연면적이 큰 쪽
    function placeBest(F) {
      if (opt.quick) return finish(pack(F));
      const a = finish(place(() => F)), b = finish(pack(F));
      return gfaOf(b) > gfaOf(a) * 1.001 ? b : a;
    }

    // 정북 일조·경계부 저층 상한 → 동별 최고 층수
    const E = edges(site.pts);
    function capFloors(b) {
      let cap = A.maxFloors;
      E.forEach((e, i) => {
        const tag = site.tags[i];
        const d = Math.min(...b.poly.map(p => segDist(p, e.a, e.b)));
        // 사이에 도로·공원 등이 있으면 공동주택은 그 중심선을 인접 대지경계선으로 봄(시행령 제86조⑥) → 폭의 절반을 더함
        const ew = num0((opt.edgeW || [])[i], 0), gap = (ew > 0 ? ew : tag === 'park' ? num0(opt.parkWidth, 0) : 0) / 2;
        const sunCap = dd => { const s = opt.sun; const Hmax = dd < s.높이10m이하_m ? 0 : Math.max(10, dd / s.높이10m초과_높이비); return Math.floor((Hmax - A.groundExtra_m) / A.floorHeight_m); };
        if (opt.southBase) {
          // 정남 기준(건축법 제61조③, 고시 필요): 남쪽을 향한 변에 정북과 같은 거리 적용, 정북 변은 적용 안 함
          if (e.out[1] < -0.5) { const ds = southDist(b.poly, e.a, e.b); if (ds !== null) cap = Math.min(cap, sunCap(ds + gap)); }
        } else if (tag === 'north' || (tag === 'park' && e.out[1] > 0.5)) {
          // 정북 일조(건축법 시행령 제86조①): 건축물 각 부분에서 '정북 방향'으로 잰 인접대지경계선까지 거리.
          // 경계가 비스듬하면 수직 거리보다 길어짐. 정북 방향 연장선에 이 변이 없으면 이 변은 제한하지 않음
          const dn = northDist(b.poly, e.a, e.b);
          if (dn !== null) cap = Math.min(cap, sunCap(dn + gap));
        }
        if (tag === 'lowrise' && opt.lowriseCap && d < opt.lowriseDist) cap = Math.min(cap, opt.lowriseCap);
        // 채광창 벽면 → 인접 대지경계선(건축법 시행령 제86조③1호): 높이 ≤ 거리 × 배수. 도로·공원 등이 사이에 있으면 중심선까지(같은 조 ⑥, 공동주택)
        //  판상·ㄱ형은 앞·뒤 벽면(동 깊이 방향)을 향한 변만, 탑상·Y·ㅁ형은 모든 변. 도로 폭은 변의 성격 표시와 관계없이 실제로 닿은 도로 폭
        if (opt.winRatio) {
          // 벽면 방향: 판상·ㄱ형은 앞·뒤(동 깊이 방향 ±), 탑상·Y·ㅁ형은 네 방향. 경계 변이 바깥쪽(e.out)을 향하는 방향만 봄
          const yax = rot([0, 1], th), xax = rot([1, 0], th);
          const dirs = (['slab', 'L'].includes(b.form) ? [yax] : [yax, xax]).flatMap(v => [v, [-v[0], -v[1]]]).filter(v => v[0] * e.out[0] + v[1] * e.out[1] > 0.3);
          dirs.forEach(v => {
            const dd = dirDist(b.poly, e.a, e.b, v); if (dd === null) return;
            const Hw = opt.winRatio * (dd + gap);
            cap = Math.min(cap, Math.floor((Hw - A.groundExtra_m) / A.floorHeight_m));
          });
        }
      });
      // ㅁ형: 중정을 사이에 두고 마주 보는 동 사이도 인동간격(높이 × 배수) 이상 → 중정 폭으로 층수 상한
      if (b.form === 'court' && b.inner > 0 && opt.spacing > 0) cap = Math.min(cap, Math.floor((b.inner / opt.spacing - A.groundExtra_m) / A.floorHeight_m));
      return Math.max(0, cap);
    }
    // 세대당 지상 연면적: 평면 라이브러리의 공급면적(전용+주거공용). 없으면 전용 × 환산계수
    const supOf = t => (+U[t].공급 > 0 ? +U[t].공급 : U[t].전용 * A.supplyFactor);
    const gfaOf = blds => blds.reduce((s, b) => s + b.n * b.floors * supOf(b.t), 0);
    const finish = blds => { blds.forEach(b => { b.cap = capFloors(b); b.floors = Math.min(b.floors, b.cap); }); return blds.filter(b => b.floors >= A.minFloors); };

    // 균일 층수 F를 낮은 쪽부터 올려 목표 용적률 이하 최대 찾기 → 북쪽 줄부터 한 층씩 올려 목표에 맞춤(남저북고)
    const target = opt.lot * opt.far / 100;
    let best = null;
    if (opt.fixedF) {
      // 기준 층수 고정: 넘치면 남쪽 줄·가장자리 동부터 빼서(남측 개방) 목표에 맞춤
      let b0 = placeBest(opt.fixedF);
      if (gfaOf(b0) > target) {
        const cx = b0.reduce((s, b) => s + b.rx, 0) / b0.length;
        const order = b0.slice().sort((a, b) => a.ry - b.ry || Math.abs(b.rx - cx) - Math.abs(a.rx - cx));
        for (const b of order) { if (gfaOf(b0) <= target) break; b0 = b0.filter(x => x !== b); }
      }
      best = { F: opt.fixedF, bl: b0, gfa: gfaOf(b0) };
    } else {
      // 기준 층수를 올리면 인동간격이 커져 줄 수가 줄어듦 → 목표 이하에서 연면적이 가장 큰 층수(같으면 낮은 층수)
      for (let F = A.minFloors; F <= A.maxFloors; F++) {
        const bl = placeBest(F), gfa = gfaOf(bl);
        if (gfa > target * 1.0001) break;
        if (!best || gfa > best.gfa * 1.005) best = { F, bl, gfa };
      }
      if (!best) { const bl = placeBest(A.minFloors); best = { F: A.minFloors, bl, gfa: gfaOf(bl) }; }
    }
    let bl = best.bl;
    // 북쪽 줄을 올리되 기준 층수보다 너무 튀지 않게(기준 + 40%, 최소 3개층까지)
    const maxRise = best.F + Math.max(3, Math.round(best.F * 0.4));
    if (bl.length) {
      const byN = bl.slice().sort((a, b) => b.ry - a.ry); // 북쪽 동부터
      let changed = true;
      while (changed) {
        changed = false;
        for (const b of byN) {
          if (b.floors + 1 > b.cap || b.floors + 1 > maxRise) continue;
          if (gfaOf(bl) + b.n * supOf(b.t) > target) continue;
          // 이 동 북쪽에 남북으로 겹치는 동이 있으면 그 사이가 높아진 높이 × 배수 이상일 때만
          const north = bl.filter(o => o !== b && o.ry > b.ry && Math.min(b.rx + b.L, o.rx + o.L) - Math.max(b.rx, o.rx) > 0);
          if (north.length && Math.min(...north.map(o => o.ry)) - (b.ry + b.D) < opt.spacing * H(b.floors + 1)) continue;
          b.floors++; changed = true;
        }
      }
    }
    bl.sort((a, b) => a.row - b.row || a.rx - b.rx).forEach((b, i) => { b.id = 101 + i; });
    // 집계
    const lotA = opt.lot, ba = bl.reduce((s, b) => s + (b.ba || b.L * b.D), 0), gfa = gfaOf(bl);
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
    // 기준 층수: 범위가 넓으면 2층 간격(계산 시간 절반, 결과 차이 작음)
    const span = A.maxFloors - A.minFloors, stepF = span > 24 ? 3 : span > 12 ? 2 : 1, all = [];
    for (let F = A.minFloors; F <= A.maxFloors; F += stepF) {
      try { const r = layout(site, Object.assign({}, opt, { fixedF: F })); if (r.units) all.push(r); if (r.units && r.gfa >= r.target * 0.97) cands.push(r); } catch (e) { /* 건너뜀 */ }
    }
    if (!cands.length) {
      // 목표를 못 채우는 구역: 기준 층수별 결과 중 연면적이 큰 안(층수가 서로 다른 것) 최대 3개
      if (!all.length) { const r = layout(site, opt); return [Object.assign(r, { label: '최대 배치(목표 미달)' })]; }
      all.sort((x, y) => y.gfa - x.gfa);
      const out = []; all.forEach(r => { if (out.length < 3 && out.every(o => Math.abs(o.maxFloors - r.maxFloors) >= 4)) out.push(r); });
      return out.sort((x, y) => x.maxFloors - y.maxFloors).map((r, i) => Object.assign(r, { label: (i === 0 && out.length > 1 ? '다동형' : i === out.length - 1 && out.length > 1 ? '소동형' : '최대 배치') + '(목표 미달)' }));
    }
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
    // 시각별 그림자 + 외접사각형(점이 사각형 밖이면 다각형 검사를 건너뜀 — 주변 건물이 수천 동이어도 빠르게)
    const shadowsAt = times.map(t => { const s = sun(latDeg, t); return blds.flatMap(b => (b.parts || [b.poly]).map(q => shadow(q, b.h != null ? b.h : H(b.floors), s))).filter(Boolean).map(sh => { const xs = sh.map(p => p[0]), ys = sh.map(p => p[1]); return { sh, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; }); });
    return pts.map(p => {
      let total = 0, run = 0, best = 0;
      times.forEach((t, k) => {
        const lit = !shadowsAt[k].some(o => p[0] >= o.x0 && p[0] <= o.x1 && p[1] >= o.y0 && p[1] <= o.y1 && inside(p[0], p[1], o.sh));
        if (lit && t >= tol.합계_구간[0] && t < tol.합계_구간[1]) total += 1 / 6;
        if (t >= tol.연속_구간[0] && t < tol.연속_구간[1]) { if (lit) { run += 1 / 6; best = Math.max(best, run); } else run = 0; }
      });
      return { total: Math.round(total * 10) / 10, cont: Math.round(best * 10) / 10, ok: best >= tol.연속_h - 1e-6 || total >= tol.합계_h - 1e-6 };
    });
  }

  const api = { FORM_NAME, modulesFor, projector, rot, area, ccw, openRing, inside, segDist, dirDist, edges, clipHalf, buildableTest, stripRanges, layout, alternatives, sun, shadow, hull, sunHours };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.ArchGeom = api;
})(typeof window !== 'undefined' ? window : globalThis);
