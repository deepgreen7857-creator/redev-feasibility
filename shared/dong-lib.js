'use strict';
// 동 타입 라이브러리(심화 배치용) — 단위세대 조합 + 코어로 동을 만든다. 화면 코드 없음(node 시험 가능)
//  기준: shared/criteria/dong-types.json(동 타입·코어·변형 규칙), shared/criteria/arch.json '평면'·'평면_라이브러리'(치수)
//  만든 동(모듈)은 arch-geom.js 모듈과 같은 꼴: { form, t, n, L, D, parts, cores, divs, units } + 섞인 평형 정보(seq, mixT)
//  지역 좌표: x = 동 길이 방향(0~L), y = 북쪽(0~D), 전면(y=0)이 채광면
(function (g) {
  const R4 = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const num0 = (v, d) => (isFinite(+v) && v !== '' && v !== null ? +v : d);
  const D2R = Math.PI / 180;
  let U = {}, LIB = {}, DT = { 타입: [], 평형_순서: [] }, RANGE = null;

  function init(o) { U = o.units || {}; LIB = o.lib || {}; DT = o.types || DT; RANGE = null; return api; }

  /* ---------- 평형별 실제 평면 범위 ---------- */
  const keys = () => Object.keys(U).filter(k => isFinite(+k)).map(Number).sort((a, b) => a - b);
  const nearKey = e => { const ks = keys(); return ks.reduce((b, k) => (Math.abs(k - e) < Math.abs(b - e) ? k : b), ks[0]); };
  const pct = (a, p) => { const v = a.slice().sort((x, y) => x - y); if (!v.length) return NaN; const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return v[lo] + (v[hi] - v[lo]) * (i - lo); };
  // 쓸 수 있는 사례: 폭·깊이 있음, 형식 맞음, 특수형·복층·신뢰도 낮음 제외, 발코니가 빠진 듯한 얕은 평면 제외(판상 55㎡ 이상 8.3m 미만)
  function casesOf(t, kind) {
    const tw = kind === 'tower', ex = +((U[t] || {}).전용) || +t;
    return (LIB.사례 || []).filter(c => +c.폭 > 0 && +c.깊이 > 0 && nearKey(+c.전용) === +t && Math.abs(+c.전용 - ex) <= 6 && !c.특수형 && c.신뢰도 !== '낮음'
      && (tw ? c.형식 === '탑상' : c.형식 !== '탑상' && c.형식 !== '복층') && +c.깊이 >= (tw ? 8.5 : ex >= 55 ? 8.3 : 7.5) && +c.폭 >= 4);
  }
  // 평형·형식별 폭·깊이 범위(하위 10%~상위 10%). 사례가 3건 미만이면 대표 평면 ±5%를 범위로(상태 '가정')
  function ranges() {
    if (RANGE) return RANGE;
    RANGE = {};
    keys().forEach(t => {
      RANGE[t] = {};
      ['slab', 'tower'].forEach(kind => {
        const cs = casesOf(t, kind), rep = repOf(t, kind);
        if (cs.length >= 3) {
          const W = cs.map(c => +c.폭), Dd = cs.map(c => +c.깊이);
          RANGE[t][kind] = { n: cs.length, 폭: [pct(W, 0.1), pct(W, 0.9)], 깊이: [pct(Dd, 0.1), pct(Dd, 0.9)], 베이: [...new Set(cs.map(c => +c.베이 || 0).filter(Boolean))].sort(), 상태: '사례' };
        } else if (rep) {
          RANGE[t][kind] = { n: cs.length, 폭: [rep.폭 * 0.95, rep.폭 * 1.05], 깊이: [rep.깊이 * 0.95, rep.깊이 * 1.05], 베이: [rep.베이], 상태: '가정' };
        }
      });
    });
    return RANGE;
  }
  // 대표 평면(arch.json '평면'). 탑상은 '탑상' 치수, 없으면 판상 치수
  function repOf(t, kind) {
    const u = U[t]; if (!u) return null;
    if (kind === 'tower' && u.탑상 && +u.탑상.폭 > 0) return { t: String(t), 폭: +u.탑상.폭, 깊이: +u.탑상.깊이, 베이: +u.탑상.베이 || 2, id: u.탑상.대표사례 || 'rep-tower', rep: true };
    if (kind === 'tower') {
      // 탑상 대표 치수가 없는 평형: 실제 탑상 사례 중 폭·깊이 중간값에 가장 가까운 평면(판상 치수로 탑상을 그리면 모양이 틀어짐)
      const cs = casesOf(t, 'tower');
      if (cs.length) {
        const mw = pct(cs.map(c => +c.폭), 0.5), md = pct(cs.map(c => +c.깊이), 0.5);
        const c = cs.reduce((m, x) => (Math.hypot(+x.폭 - mw, +x.깊이 - md) < Math.hypot(+m.폭 - mw, +m.깊이 - md) ? x : m), cs[0]);
        return { t: String(t), 폭: +c.폭, 깊이: +c.깊이, 베이: +c.베이 || 2, id: c.id, rep: true };
      }
    }
    return { t: String(t), 폭: +u.폭, 깊이: +u.깊이, 베이: +u.베이 || 3, id: u.대표사례 || 'rep', rep: true };
  }
  const caseOf = id => (LIB.사례 || []).find(c => c.id === id) || null;
  const nameOf = id => { const c = caseOf(id); return c && c.단지 ? c.단지.replace(/\(.*\)/, '').trim() + ' ' + (c.타입 || '') : '가정 평면'; };
  // 한 세대 평면 고르기: maxW(이 폭 이하)가 있으면 ① 대표 ② 범위 안 실제 사례 중 폭이 가장 넓은 것 ③ 범위 안 조정 평면(면적 같게 폭 줄이고 깊이 늘림)
  //  조정 평면은 adjusted:true — 위험요소 '평면 조정 필요'
  function unitFor(t, kind, maxW) {
    const rep = repOf(t, kind); if (!rep) return null;
    const out = o => Object.assign({ t: String(t), kind }, o, { vname: o.adjusted ? nameOf(o.id) + ' 조정' : nameOf(o.id) });
    if (!(maxW > 0) || rep.폭 <= maxW + 1e-6) return out(rep);
    const R = (ranges()[t] || {})[kind];
    const fit = casesOf(t, kind).filter(c => +c.폭 <= maxW + 1e-6 && (!R || +c.폭 >= R.폭[0] - 1e-6)).sort((a, b) => +b.폭 - +a.폭)[0];
    if (fit) return out({ 폭: +fit.폭, 깊이: +fit.깊이, 베이: +fit.베이 || rep.베이, id: fit.id });
    if (R && maxW >= R.폭[0] - 1e-6) { const d = rep.폭 * rep.깊이 / maxW; if (d <= R.깊이[1] + 1e-6) return out({ 폭: maxW, 깊이: d, 베이: rep.베이, id: rep.id, adjusted: true }); }
    return null;
  }

  /* ---------- 세대·동 도형 ---------- */
  // 단위세대 조각(arch-geom unitRects와 같은 규칙): 판상은 첫 베이 들임 + 후면 돌출, 탑상은 들임만
  function unitRects(u, kind) {
    const W = u.폭, Dp = u.깊이, bays = u.베이 || 3, bw = W / bays;
    const P = (LIB[kind === 'tower' ? '탑상_세대' : '판상_세대']) || {};
    const ri = num0(P.전면들임_m, 0.9), out = [];
    if (bays >= 3 && ri > 0) out.push(R4(0, ri, bw, Dp), R4(bw, 0, W, Dp)); else out.push(R4(0, 0, W, Dp));
    if (kind !== 'tower') { const bd = num0(P.후면돌출_깊이_m, 1.3), bf = num0(P.후면돌출_폭비, 0.32); if (bd > 0 && bf > 0) out.push(R4(W * (1 - bf) - 0.4, Dp, W - 0.4, Dp + bd)); }
    return out;
  }
  const mirrorX = (rs, x0) => rs.map(q => q.map(([x, y]) => [2 * x0 - x, y]).reverse());
  const shiftR = (rs, dx, dy) => rs.map(q => q.map(([x, y]) => [x + dx, y + dy]));
  const coreW = high => { const PC = LIB.판상_코어 || {}; return high ? num0(PC.고층_폭_m, num0(PC.폭_m, 5.4)) : num0(PC.폭_m, 5.4); };
  const backD = () => num0((LIB.판상_세대 || {}).후면돌출_깊이_m, 1.3);
  const bbox = rs => { const p = rs.flat(); return [Math.min(...p.map(a => a[0])), Math.min(...p.map(a => a[1])), Math.max(...p.map(a => a[0])), Math.max(...p.map(a => a[1]))]; };

  // 판상 일자: [세대 | 코어 | 세대] 묶음을 이음. us 길이는 짝수. 서로 다른 평형이 한 코어를 같이 써도 됨(전면 줄 맞춤)
  function slabMix(us, high) {
    const cw = coreW(high), cf = num0((LIB.판상_코어 || {}).전면들임_m, 1.5), bd = backD();
    const D = Math.max(...us.map(u => u.깊이)) + bd, parts = [], cores = [], units = [];
    let x = 0;
    for (let k = 0; k < us.length; k += 2) {
      const a = us[k], b = us[k + 1];
      const left = shiftR(mirrorX(unitRects(a, 'slab'), a.폭 / 2), x, 0);
      const core = R4(x + a.폭, cf, x + a.폭 + cw, D);
      const right = shiftR(unitRects(b, 'slab'), x + a.폭 + cw, 0);
      units.push(left, right); cores.push(core); parts.push(...left, core, ...right);
      x += a.폭 + cw + b.폭;
    }
    return { form: 'slab', L: x, D, parts, cores, divs: [], units, uw: units.map(() => 0) };
  }
  // 꺾인 판상(ㄱ자): 남쪽 날개 [끝 세대 | 코어 | 모서리 세대] + 모서리 위로 북쪽 날개(세대를 90° 돌려 동쪽 채광). B3 = 날개 1세대(코어 1), B4 = 날개 2세대 + 날개 코어(코어 2)
  //  mirror면 서쪽에서 꺾임
  function bentMix(us, high, mirror) {
    const cw = coreW(high), base = slabMix(us.slice(0, 2), high), y0 = base.D, L1 = base.L;
    const wing = us.slice(2), dw = Math.max(...wing.map(u => u.깊이)) + backD();
    let parts = base.parts.slice(), cores = base.cores.slice(), units = base.units.slice(), uw = base.uw.slice(), y = y0;
    wing.forEach((u, i) => {
      if (i === 1) { const c = R4(L1 - dw * 0.62, y, L1, y + cw); cores.push(c); parts.push(c); y += cw; }
      const r = [R4(L1 - dw, y, L1 - dw + u.깊이, y + u.폭)].concat(backD() > 0 ? [R4(L1 - dw + u.깊이, y + u.폭 * 0.3, L1, y + u.폭 * 0.7)] : []);
      units.push(r); uw.push(90); parts.push(...r); y += u.폭;   // 날개 세대: 폭 방향 남북 → 창은 동·서
    });
    if (mirror) { const f = q => q.map(([x, yy]) => [L1 - x, yy]).reverse(); parts = parts.map(f); cores = cores.map(f); units = units.map(rs => rs.map(f)); }
    return { form: 'L', L: L1, D: Math.max(y, y0), parts, cores, divs: [], units, uw, mir: !!mirror };
  }
  // T자: 앞동(남향 판상 bar세대) 가운데에서 북쪽으로 꼬리(stem세대). 꼬리 세대는 90° 돌려 동·서 채광
  //  앞동 2호면 그 코어 뒤에서(코어 하나가 3세대), 앞동 4호면 가운데(두 세대 뒷벽)에서 뻗음. 꼬리 2세대면 세대 사이에 꼬리 코어(2호 1코어를 세운 꼴)
  function tMix(us, bar, high) {
    const cw = coreW(high), base = slabMix(us.slice(0, bar), high), stem = us.slice(bar);
    const dw = Math.max(...stem.map(u => u.깊이)) + backD();
    let parts = base.parts.slice(), cores = base.cores.slice(), units = base.units.slice(), uw = base.uw.slice(), y = base.D;
    const xc = bar === 2 ? (us[0].폭 + cw / 2) : base.L / 2;
    stem.forEach((u, i) => {
      if (i === 1) { const c = R4(xc - dw * 0.31, y, xc + dw * 0.31, y + cw); cores.push(c); parts.push(c); y += cw; }
      const x0 = xc - dw / 2, r = [R4(x0, y, x0 + u.깊이, y + u.폭)].concat(backD() > 0 ? [R4(x0 + u.깊이, y + u.폭 * 0.3, x0 + dw, y + u.폭 * 0.7)] : []);
      units.push(r); uw.push(90); parts.push(...r); y += u.폭;
    });
    return { form: 'T', L: base.L, D: y, parts, cores, divs: [], units, uw };
  }
  // 탑상: 코어 네 변에 세대가 한쪽으로 치우쳐 붙어 도는 바람개비형. 세대마다 평형이 달라도 됨
  function towerMix(us) {
    const s = num0((LIB.탑상_코어 || {}).한변_m, 7.9);
    const rotq = (q, k) => q.map(([x, y]) => { let p = [x, y]; for (let i = 0; i < k; i++) p = [p[1], -p[0]]; return p; });
    const units = us.map((u, k) => unitRects(u, 'tower').map(q => q.map(([x, y]) => [-s / 2 + x, s / 2 + u.깊이 - y])).map(q => rotq(q, k)));
    const core = R4(-s / 2, -s / 2, s / 2, s / 2), [mx, my, Mx, My] = bbox(units.flat().concat([core]));
    const sh = q => q.map(([x, y]) => [x - mx, y - my]);
    const U2 = units.map(rs => rs.map(sh));
    return { form: 'tower', L: Mx - mx, D: My - my, parts: U2.flat().concat([sh(core)]), cores: [sh(core)], divs: [], units: U2 };
  }
  // Y자: 육각 코어 + 세 날개(남·북동·북서). wings = 날개별 세대 수(꼬리 길이) — 세대를 코어에서 바깥으로 이어 붙임(날개 길이 = 세대 깊이 합)
  //  날개 폭은 그 날개 세대 중 가장 넓은 세대 폭. us는 날개 순서대로(날개 안에서는 코어 쪽 → 끝)
  //  angles = 날개 방향(도, 동쪽 0°·반시계). 기본 남 -90°·북동 30°·북서 150°(120° 간격). 날개마다 각도를 달리해 펼치거나 오므림
  function yMix(us, wings, angles) {
    wings = wings && wings.length === 3 ? wings : [1, 1, 1];
    angles = angles && angles.length === 3 ? angles : [-90, 30, 150];
    const cw = coreW(false), wmax = Math.max(...us.map(u => u.폭)), a = Math.max(cw * 0.8, wmax / 2 / 1.6), Rh = a / Math.cos(Math.PI / 6);
    const hex = [0, 1, 2, 3, 4, 5].map(i => [Rh * Math.cos(i * Math.PI / 3), Rh * Math.sin(i * Math.PI / 3)]);
    const parts = [hex], units = [], divs = [];
    let k = 0;
    angles.forEach((deg, i) => {
      const th = deg * D2R, u = [Math.cos(th), Math.sin(th)], v = [-u[1], u[0]], P = (s2, q) => [u[0] * s2 + v[0] * q, u[1] * s2 + v[1] * q];
      let s0 = a;
      for (let j = 0; j < wings[i]; j++, k++) {
        const w = us[k].폭, len = us[k].깊이, r = [[P(s0, -w / 2), P(s0 + len, -w / 2), P(s0 + len, w / 2), P(s0, w / 2)]];
        units.push(r); parts.push(...r); if (j) divs.push([P(s0, -w / 2), P(s0, w / 2)]); s0 += len;
      }
    });
    const [mx, my, Mx, My] = bbox(parts), sh = q => q.map(([x, y]) => [x - mx, y - my]);
    return { form: 'Y', L: Mx - mx, D: My - my, parts: parts.map(sh), cores: [hex.map(p => [p[0] * 0.75 - mx, p[1] * 0.75 - my])], divs: divs.map(sh), units: units.map(rs => rs.map(sh)), wings: wings.slice(), angles: angles.slice() };
  }

  /* ---------- 평형 배열 만들기 ---------- */
  const typeDef = id => (DT.타입 || []).find(x => x.id === id) || null;
  const formKind = f => (f === 'tower' || f === 'Y' ? 'tower' : 'slab');  // T자 꼬리는 판상 세대를 돌려 씀
  // 동 타입 + 쓸 평형 목록 → 조합 규칙을 지키는 평형 배열들(같은 배열의 좌우 뒤집기는 하나로)
  //  6·8호는 끝 평형 + 가운데 평형 두 가지로만(배열 수가 너무 많아짐)
  function assignments(id, ts) {
    const T = typeDef(id); if (!T) return [];
    ts = [...new Set(ts.map(String))].filter(t => U[t]).sort((a, b) => +a - +b);
    const n = T.호수, slots = T.슬롯, rules = T.조합_규칙 || [], out = [], seen = new Set();
    let raw = [];
    if (T.형태 === 'tower' || (T.형태 === 'Y' && n <= 3)) {
      // 코어 둘레: 순서 없는 조합 → 큰 것·작은 것을 번갈아 둠
      const rec = (start, acc) => { if (acc.length === n) { raw.push(acc.slice()); return; } for (let i = start; i < ts.length; i++) { acc.push(ts[i]); rec(i, acc); acc.pop(); } };
      rec(0, []);
      raw = raw.map(a => { const s = a.slice().sort((x, y) => +y - +x), r = []; let lo = s.length - 1, hi = 0; for (let i = 0; i < s.length; i++) r.push(i % 2 ? s[lo--] : s[hi++]); return r; });
    } else if (n > 4) {
      // 칸이 많으면 칸 성격(end·mid·stem·corner)마다 평형 하나씩만 고름
      const roles = [...new Set(slots)];
      const rec = (i, pick) => { if (i === roles.length) { raw.push(slots.map(sl => pick[sl])); return; } ts.forEach(t => { pick[roles[i]] = t; rec(i + 1, pick); }); };
      rec(0, {});
    } else {
      const rec = acc => { if (acc.length === n) { raw.push(acc.slice()); return; } ts.forEach(t => { acc.push(t); rec(acc); acc.pop(); }); };
      rec([]);
    }
    raw.forEach(a => {
      const ends = a.filter((_, i) => slots[i] === 'end'), mids = a.filter((_, i) => slots[i] === 'mid'), corner = a.filter((_, i) => slots[i] === 'corner'), wings = a.filter((_, i) => slots[i] !== 'corner');
      if (rules.includes('end_ge_mid') && mids.length && Math.min(...ends.map(Number)) < Math.max(...mids.map(Number))) return;
      const stems = a.filter((_, i) => slots[i] === 'stem'), bars = a.filter((_, i) => slots[i] !== 'stem');
      if (rules.includes('stem_le_bar') && stems.length && Math.max(...stems.map(Number)) > Math.min(...bars.map(Number))) return;
      if (rules.includes('corner_le_wing') && corner.length && Math.max(...corner.map(Number)) > Math.min(...wings.map(Number))) return;
      if (rules.includes('symmetric') && T.형태 === 'slab' && a.join() !== a.slice().reverse().join()) return;
      if (T.형태 === 'T') { const b2 = a.slice(0, T.앞동); if (b2.join() !== b2.slice().reverse().join()) return; }
      const k = T.형태 === 'T' || T.형태 === 'Y' && n > 3 ? a.join() : [a.join(), a.slice().reverse().join()].sort()[0];
      if (seen.has(k)) return; seen.add(k); out.push(a);
    });
    return out;
  }
  // 동 만들기: 동 타입 id + 평형 배열 → 모듈. opt.maxW {t: 최대 세대 폭}(자리 맞추기용), opt.high 고층 코어, opt.mirror
  //  세대 평면이 범위 밖이면 null
  function build(id, seq, opt) {
    opt = opt || {};
    const T = typeDef(id); if (!T || !seq || seq.length !== T.호수) return null;
    const kind = formKind(T.형태), maxW = opt.maxW || {};
    const us = seq.map(t => unitFor(t, kind, maxW[t])); if (us.some(u => !u)) return null;
    let m;
    if (T.형태 === 'slab') m = slabMix(us, opt.high);
    else if (T.형태 === 'bent') m = bentMix(us, opt.high, opt.mirror);
    else if (T.형태 === 'T') m = tMix(us, T.앞동, opt.high);
    else if (T.형태 === 'tower') m = towerMix(us);
    else if (T.형태 === 'Y') m = yMix(us, T.날개);
    else return null;
    const mixT = {}; seq.forEach(t => { mixT[t] = (mixT[t] || 0) + 1; });
    const t = Object.keys(mixT).sort((a, b) => mixT[b] - mixT[a] || +b - +a)[0];
    const adjusted = us.filter(u => u.adjusted).map(u => u.t);
    const depthGap = T.형태 === 'slab' || T.형태 === 'bent' ? Math.max(...us.map(u => u.깊이)) - Math.min(...us.map(u => u.깊이)) : 0;
    return Object.assign(m, {
      dtype: id, dname: T.이름, t, n: seq.length, seq: seq.map(String), mixT, uplans: us,
      vname: [...new Set(us.map(u => u.vname))].join(' · '), adjusted,
      notes: [].concat(adjusted.length ? [`평면 조정 필요(${adjusted.join('·')}㎡형, 실제 사례 범위 안에서 폭을 줄이고 깊이를 늘림)`] : [],
        depthGap > 2 ? [`한 동 안 세대 깊이 차이 ${depthGap.toFixed(1)}m — 후면 요철 큼`] : [],
        T.형태 === 'Y' && Math.max(...(T.날개 || [1])) >= 3 ? ['Y자 날개 3세대 이상 — 날개 끝 피난 동선(직통계단) 확인 필요'] : []),
    });
  }
  // 쓸 평형 목록으로 만들 수 있는 동 전체(타입 × 배열). 같은 평형만 쓴 동(단일)과 섞은 동(혼합)을 다 냄
  function catalog(ts, opt) {
    const res = [];
    (DT.타입 || []).forEach(T => assignments(T.id, ts).forEach(seq => { const m = build(T.id, seq, opt); if (m) res.push(m); }));
    return res;
  }

  /* ---------- 자유형 Y자(날개마다 세대 수·각도를 따로) ----------
     wings [남, 북동, 북서] 날개별 세대 수(1~3), angles 날개 방향(도). 날개 사이 각도 60° 미만이거나 세대가 서로 겹치면 null
     심화 배치에서 대지 모양에 맞춰 날개를 펼치거나(남향 쪽으로 눕힘) 오므리고, 한쪽 꼬리만 길게 뺄 때 씀 */
  const Y_ANGLES = { 표준: [-90, 30, 150], 펼침: [-90, 15, 165], 오므림: [-90, 45, 135], 한쪽펼침: [-90, 15, 140], 남날개기울임: [-110, 30, 150] };
  function overlapRects(a, b) {
    const axes = [a, b].flatMap(P => P.map((p, i) => { const q = P[(i + 1) % P.length], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; }));
    return axes.every(n => { const pa = a.map(p => p[0] * n[0] + p[1] * n[1]), pb = b.map(p => p[0] * n[0] + p[1] * n[1]); return Math.max(...pa) > Math.min(...pb) + 0.05 && Math.max(...pb) > Math.min(...pa) + 0.05; });
  }
  function buildY(seq, wings, angles, opt) {
    opt = opt || {};
    if (!wings || wings.length !== 3 || wings.some(k => k < 1 || k > 3) || seq.length !== wings[0] + wings[1] + wings[2]) return null;
    angles = angles || Y_ANGLES.표준;
    const sorted = angles.map(a => ((a % 360) + 360) % 360).sort((x, y) => x - y), gaps = sorted.map((a, i) => (i ? a - sorted[i - 1] : a + 360 - sorted[2]));
    if (Math.min(...gaps) < 60) return null;
    const maxW = opt.maxW || {}, us = seq.map(t => unitFor(t, 'tower', maxW[t])); if (us.some(u => !u)) return null;
    const m = yMix(us, wings, angles);
    // 다른 날개 세대끼리 겹치면 못 씀(날개를 너무 오므렸거나 세대 폭이 넓음)
    let k = 0; const wingOf = []; wings.forEach((c, i) => { for (let j = 0; j < c; j++) wingOf[k++] = i; });
    for (let i = 0; i < m.units.length; i++) for (let j = i + 1; j < m.units.length; j++) if (wingOf[i] !== wingOf[j] && overlapRects(m.units[i][0], m.units[j][0])) return null;
    const mixT = {}; seq.forEach(t => { mixT[t] = (mixT[t] || 0) + 1; });
    const t = Object.keys(mixT).sort((a, b) => mixT[b] - mixT[a] || +b - +a)[0];
    return Object.assign(m, { dtype: 'YF', dname: `Y자 ${seq.length}호(날개 ${wings.join('·')}세대, ${angles.join('°·')}°)`, t, n: seq.length, seq: seq.map(String), mixT, uplans: us,
      vname: [...new Set(us.map(u => u.vname))].join(' · '), adjusted: us.filter(u => u.adjusted).map(u => u.t),
      notes: Math.max(...wings) >= 3 ? ['Y자 날개 3세대 이상 — 날개 끝 피난 동선(직통계단) 확인 필요'] : [] });
  }
  // 자유형 Y자 후보: 날개 세대 수 조합(북동·북서 맞바꾼 것은 하나로) × 각도 틀. 평형 배열은 날개 끝 ≥ 안쪽
  function yShapes(ts, opt) {
    ts = [...new Set(ts.map(String))].filter(t => U[t]).sort((a, b) => +a - +b);
    const out = [], seen = new Set();
    for (let a = 1; a <= 3; a++) for (let b = 1; b <= 3; b++) for (let c = b; c <= 3; c++) {
      const wings = [a, b, c];
      Object.keys(Y_ANGLES).forEach(nm => ts.forEach(e => ts.forEach(mid => {
        if (+e < +mid) return;
        const seq = wings.flatMap(k => Array(k - 1).fill(mid).concat([e]));
        const key = wings.join() + nm + seq.join(); if (seen.has(key)) return; seen.add(key);
        const m = buildY(seq, wings, Y_ANGLES[nm], opt); if (m) { m.angleName = nm; out.push(m); }
      })));
    }
    return out;
  }

  const api = { init, ranges, casesOf, unitFor, assignments, build, catalog, typeDef, buildY, yShapes, Y_ANGLES, get types() { return DT.타입 || []; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.JbsDong = api;
})(typeof window !== 'undefined' ? window : globalThis);
