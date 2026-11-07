/* 일조 연계 다듬기(2026-11-07, 사용자 목록 2 — 지난 시험 스크립트 repair4/5를 사이트 기능으로)
   기준(사용자 '채광창 이격 + 모든 세대 동지 연속 2시간'): 대지 경계 채광창 이격·정북·경계·겹침·모서리·용적률·건폐율 같은 규칙은 지키고,
   동 사이 본문 거리(시행령 제86조③2호 본문)는 같은 호 단서(모든 세대 동지 9~15시 연속 2시간)로 갈음 → 세대별 일조로 판정
   점수 = 순세대 = 세대 − (동지 2시간 미달 세대). 한 줄(같은 자리 세대 기둥)의 미달이 아래 keepLow(3)개 층 안이면 그 층만 비움(필로티·커뮤니티),
   그보다 많으면 그 줄은 못 씀(줄 전체를 뺌)
   방법: 출발 배치에서 동 하나씩 옮기기(±2·4·8m)·돌리기(±5·10°)·층수(±1·2·4)·빼기·끼워 넣기(있는 동 모양 복사)를 대 보고 순세대가 늘면 채택(언덕 오르기),
   시간 예산(ms)이 다하면 멈춤. 같은 seed면 같은 결과
   입력 blds = /arch 대안 동(월드 좌표 poly·parts·cores·units·walls?·center·angle·floors·n·mixT·t·form) */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('./arch-geom.js') : g.ArchGeom;
  const K = isNode ? require('./arch-check.js') : g.JbsCheck;
  const V = isNode ? require('./sun-verify.js') : g.JbsSunVerify;
  const SH = isNode ? (() => { try { return require('./dong-shapes.js'); } catch (e) { return null; } })() : g.JbsShapes;
  const D2R = Math.PI / 180;

  function rng(seed) { let s = (seed >>> 0) || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

  // 동을 c(가운데) 기준으로 dθ 돌리고 d만큼 옮긴 새 동(캐시 없이 새로 만듦)
  function moved(b, d, dth) {
    const c = b.center || b.poly.reduce((a, p) => [a[0] + p[0] / b.poly.length, a[1] + p[1] / b.poly.length], [0, 0]);
    const cs = Math.cos(dth), sn = Math.sin(dth);
    const T = p => { const x = p[0] - c[0], y = p[1] - c[1]; return [c[0] + x * cs - y * sn + d[0], c[1] + x * sn + y * cs + d[1]]; };
    const R = v => [v[0] * cs - v[1] * sn, v[0] * sn + v[1] * cs];
    const ring = q => q.map(T), rings = a => (a || []).map(ring);
    const nb = Object.assign({}, b, { poly: ring(b.poly), parts: rings(b.parts), cores: rings(b.cores), units: Array.isArray(b.units) ? b.units.map(u => (Array.isArray(u[0]) && Array.isArray(u[0][0]) ? rings(u) : ring(u))) : b.units,   // 세대마다 조각 여러 개(고리 묶음) divs: rings(b.divs),
      center: [c[0] + d[0], c[1] + d[1]], angle: (+b.angle || 0) + dth / D2R });
    if (b.walls) nb.walls = b.walls.map(w => Object.assign({}, w, { a: T(w.a), b: T(w.b), n: R(w.n) }));
    if (b.sc) nb.sc = b.sc.map(pp => pp.map(T));          // 세대 줄마다 창 점(빠른 채점용)도 같이 옮김
    return nb;
  }

  /* 빠른 채점(2026-11-07): 세대별 일조(JbsCheck.unitSun, 한 번 1초 안팎)를 매번 다시 하지 않고, 처음 한 번 구한 세대 줄마다의 창 점을 동과 함께 옮기며
     창에서 해 쪽 광선(JbsSunVerify — 엔진과 판정 100% 일치 시험)으로 몇 층부터 통과하는지 이분 탐색. 그림자는 동 바깥선(poly) 기둥 */
  function fastNet(blds, T, opt, keepLow) {
    const fh = +opt.assume.floorHeight_m || 2.9, ge = +opt.assume.groundExtra_m || 0, Hf = f => f * fh + ge;
    const PR = V.prisms(blds.map(b => (Array.isArray(b.partFl) ? { parts: b.parts, partFl: b.partFl, floors: b.floors } : { poly: b.poly, floors: b.floors })), Hf);   // 계단식 동은 조각마다 제 높이
    let gross = 0, low = 0, dead = 0; const per = {};
    blds.forEach(b => (b.sc || []).forEach((pts, k) => {
      if (!pts) return;
      const F = Array.isArray(b.unitFl) && b.unitFl[k] > 0 ? b.unitFl[k] : b.floors, pass = L => pts.some(p => V.contMin(p, (L - 1) * fh, T, PR, 120) >= 120 - 1e-6);
      let ok; if (!pass(F)) ok = F + 1; else { let lo = 1, hi = Math.min(F, keepLow + 1); if (pass(hi)) { while (lo < hi) { const m = (lo + hi) >> 1; if (pass(m)) hi = m; else lo = m + 1; } ok = lo; } else ok = keepLow + 2; }
      const lost = Math.min(F, ok - 1); gross += F; per[b.id] = (per[b.id] || 0) + lost;
      if (lost <= 0) return; if (lost <= keepLow) low += lost; else dead += F;
    }));
    return { gross, low, dead, net: gross - low - dead, per };
  }
  // 엔진으로 한 번 셈: 창 점(b.sc)을 엔진이 고른 자리로 다시 붙이고 엔진 순세대도 같이(unitSun 한 번)
  function engineSync(site, blds, opt, keepLow) {
    const us = K.unitSun(site, blds, opt), by = {};
    (us.cols || []).forEach(c => { const a = (by[c.id] = by[c.id] || []); a[c.k != null ? c.k : a.length] = c.pts && c.pts.length ? c.pts : [c.pt]; });
    let gross = 0, low = 0, dead = 0;
    (us.cols || []).forEach(c => { const F = +c.floors || 0, lost = Math.min(F, (c.okFrom || F + 1) - 1); gross += F; if (lost <= 0) return; if (lost <= keepLow) low += lost; else dead += F; });
    return { blds: blds.map(b => Object.assign({}, b, { sc: by[b.id] || [] })), net: gross - low - dead, gross, low, dead, us };
  }
  // 처음 한 번: 엔진 세대별 일조로 줄마다 창 점을 구해 동에 붙임(b.sc)
  function attachCols(site, blds, opt) {
    const us = K.unitSun(site, blds, opt), by = {};
    (us.cols || []).forEach((c, i) => { const a = (by[c.id] = by[c.id] || []); a[c.k != null ? c.k : a.length] = c.pts && c.pts.length ? c.pts : [c.pt]; });   // 세대 번호 자리에(계단식 층수와 짝)
    return blds.map(b => Object.assign({}, b, { sc: by[b.id] || [] }));
  }

  // 순세대: 세대별 일조(줄마다 몇 층부터 통과하는지)로 계산
  function netOf(site, blds, opt, keepLow) {
    const us = K.unitSun(site, blds, opt); let gross = 0, low = 0, dead = 0;
    (us.cols || []).forEach(c => { const F = +c.floors || 0, lost = Math.min(F, (c.okFrom || F + 1) - 1); gross += F; if (lost <= 0) return; if (lost <= keepLow) low += lost; else dead += F; });
    return { gross, low, dead, net: gross - low - dead, us };
  }
  // 규칙(동 사이 본문 거리는 단서로 갈음하므로 빼고 봄)
  function legal(site, blds, opt) {
    const q = K.quick(site, blds, opt), bad = q.rules.filter(r => !['spacing', 'side'].includes(r.id));
    return { ok: !bad.length, bad };
  }

  /* refine(site, blds, opt, o) — o = { budget(ms, 기본 60000), seed, keepLow(3), onProgress(stat) }
     돌려주는 것 { blds, start:{net,gross,low,dead}, best:{…}, steps:[{kind, id, net}], tries, ms } */
  async function refine(site, blds0, opt, o) {
    o = o || {}; const t0 = Date.now(), budget = +o.budget || 60000, keepLow = o.keepLow == null ? 3 : +o.keepLow, R = rng(o.seed || 7);
    const A = opt.assume, maxF = +A.maxFloors || 35, minF = +A.minFloors || 5, cap = G.capper(site, opt);
    const capOf = b => { try { return Math.min(maxF, cap({ poly: b.poly, form: b.form, angle: b.angle, inner: b.inner || 0, walls: b.walls })); } catch (e) { return maxF; } };
    const TR = V.sunTrack({ lat: +opt.lat || 37.46, step: +o.step || 5 });
    const E0 = engineSync(site, blds0, opt, keepLow);
    let cur = E0.blds, L0 = legal(site, cur, opt);
    const S0 = E0;
    // 엔진 기준 최고안(빠른 채점이 후하게 볼 수 있어 중간중간 엔진으로 다시 세고 엔진 기준으로 가장 좋은 배치를 남김)
    let bestE = { net: E0.net, blds: cur, legal: L0.ok }, accSince = 0, lastSync = Date.now();
    let S = fastNet(cur, TR, opt, keepLow); const start = { net: S0.net, gross: S0.gross, low: S0.low, dead: S0.dead, legal: L0.ok, fast: S.net };
    const steps = [], shapes = cur.slice();
    // 섞을 동 틀(o.shapes — JbsShapes.templates: V자 꼭짓점형·일자 2·4·6호). 창 점은 틀마다 한 번 구해 둠(가운데 0,0 기준)
    const extra = (o.shapes || []).map(tp => attachCols(site, [Object.assign({}, tp, { id: 1, floors: 10 })], opt)[0]).filter(tp => tp.sc && tp.sc.length);
    const pool = shapes.concat(extra);           // 끼워 넣기에 쓸 동 모양
    let tries = 0, nextId = Math.max(0, ...blds0.map(b => +b.id || 0)) + 1;
    const xs = site.pts.map(p => p[0]), ys = site.pts.map(p => p[1]), X0 = Math.min(...xs), X1 = Math.max(...xs), Y0 = Math.min(...ys), Y1 = Math.max(...ys);
    const accept = (cand, kind, id) => {
      tries++;
      const Lc = legal(site, cand, opt); if (!Lc.ok && (L0.ok || Lc.bad.length >= L0.bad.length)) return false;   // 출발 배치가 규칙 위반이면 위반이 줄어드는 쪽만
      const Sc = fastNet(cand, TR, opt, keepLow);
      if (Sc.net > S.net || (!L0.ok && Lc.bad.length < L0.bad.length)) { cur = cand; S = Sc; L0 = Lc; steps.push({ kind, id, net: Sc.net }); accSince++; return true; }
      return false;
    };
    const tick = () => new Promise(r => setTimeout(r, 0));
    let round = 0, lastGain = 0, lastGainTries = 0;
    while (Date.now() - t0 < budget) {
      round++;
      // 한 바퀴: 동마다 한 가지 수를 대 봄(순서 섞음). 미달이 많은 동부터
      const per = S.per;
      const order = cur.map((b, i) => i).sort((i, j) => (per[cur[j].id] || 0) - (per[cur[i].id] || 0) || R() - 0.5);
      let gained = false;
      for (const i of order) {
        if (Date.now() - t0 >= budget) break;
        const b = cur[i]; if (!b) continue;
        const r = R(), id = b.id, put = nb => cur.map((x, k) => (k === i ? nb : x));
        if (r < 0.34) {                                   // 옮기기
          const st = [2, 4, 8][Math.floor(R() * 3)], a = Math.floor(R() * 8) * Math.PI / 4;
          if (accept(put(moved(b, [st * Math.cos(a), st * Math.sin(a)], 0)), '옮기기', id)) gained = true;
        } else if (r < 0.5) {                             // 돌리기
          const dd = [-10, -5, 5, 10][Math.floor(R() * 4)] * D2R;
          const nb = moved(b, [0, 0], dd); nb.floors = Math.min(b.floors, capOf(nb)); if (nb.floors >= minF && accept(put(nb), '돌리기', id)) gained = true;
        } else if (r < 0.85) {                            // 층수: 미달 줄이 있으면 낮추기 먼저, 아니면 올리기
          const lostHere = per[id] || 0, up = lostHere === 0 ? R() < 0.75 : R() < 0.25, st = [1, 2, 4][Math.floor(R() * 3)];
          const f = Math.max(minF, Math.min(capOf(b), b.floors + (up ? st : -st)));
          const nb = b.wingFloors && SH ? SH.setWingFloors(b, b.wingFloors.map(x => Math.max(minF, Math.min(capOf(b), x + (f - b.floors))))) : Object.assign({}, b, { floors: f });
          if (nb.floors !== b.floors && accept(put(nb), up ? '층수 올리기' : '층수 낮추기', id)) gained = true;
        } else if (r < 0.80 && b.wingUnits && b.partWing && SH && SH.setWingFloors) {   // 날개 층수(계단식): 한 날개만 ±1·2·4층
          const wf = (b.wingFloors || [b.floors, b.floors]).slice(), w = R() < 0.5 ? 0 : 1, st = [1, 2, 4][Math.floor(R() * 3)] * (R() < 0.5 ? -1 : 1);
          wf[w] = Math.max(minF, Math.min(capOf(b), wf[w] + st));
          if (wf[w] !== (b.wingFloors || [b.floors, b.floors])[w] && accept(put(SH.setWingFloors(b, wf)), `날개 층수(${w ? '동' : '서'} ${wf[w]}층)`, id)) gained = true;
        } else if (r < 0.88 && extra.length) {            // 바꿔 끼우기: 이 동 자리(가운데·방향)에 다른 틀(V자·2호 판상 등)
          const tp = extra[Math.floor(R() * extra.length)], c = b.center || b.poly[0];
          const nb = moved(tp, c, (+b.angle || 0) * D2R); nb.id = b.id; nb.floors = Math.min(capOf(nb), b.floors);
          if (nb.floors >= minF && accept(put(nb), '바꿔 끼우기(' + (tp.dname || tp.form) + ')', id)) gained = true;
        } else if (r < 0.93) {                            // 빼기
          if (cur.length > 1 && accept(cur.filter((x, k) => k !== i), '빼기', id)) gained = true;
        } else {                                          // 끼워 넣기: 아무 동 모양을 빈 곳에
          const sh = pool[Math.floor(R() * pool.length)], c0 = sh.center || sh.poly[0], at = [X0 + R() * (X1 - X0), Y0 + R() * (Y1 - Y0)];
          if (!G.inside(at[0], at[1], site.pts)) continue;
          const nb = moved(sh, [at[0] - c0[0], at[1] - c0[1]], [0, -15, 15, -30, 30][Math.floor(R() * 5)] * D2R); nb.id = nextId; nb.floors = Math.min(capOf(nb), Math.max(sh.floors || 0, maxF));
          if (nb.floors >= minF && accept(cur.concat([nb]), '끼워 넣기', nb.id)) { gained = true; nextId++; }
        }
      }
      if (gained) { lastGain = round; lastGainTries = tries; }
      // 채택이 쌓였거나 8초가 지나면 엔진으로 다시 셈: 엔진 기준 최고안 갱신, 창 점·채점 기준을 엔진에 맞춤
      if (accSince >= 12 || (accSince > 0 && Date.now() - lastSync > 8000)) {
        const E = engineSync(site, cur, opt, keepLow); cur = E.blds; S = fastNet(cur, TR, opt, keepLow); accSince = 0; lastSync = Date.now();
        if (L0.ok && (E.net > bestE.net || !bestE.legal)) bestE = { net: E.net, blds: cur, legal: true };
      }
      if (o.onProgress) o.onProgress({ round, net: S.net, gross: S.gross, low: S.low, dead: S.dead, n: cur.length, tries, ms: Date.now() - t0 });
      await tick();
      if (tries - lastGainTries > Math.max(400, 60 * cur.length)) break;   // 오래(동 수 × 60번, 최소 400번) 대 봐도 나아진 게 없으면 멈춤
    }
    // 마지막에 엔진 세대별 일조로 다시 셈(보고 숫자는 엔진 기준) — 엔진 기준 최고안과 비교해 더 좋은 쪽. 동 번호는 101부터 다시
    { const E = engineSync(site, cur, opt, keepLow); if (L0.ok && (E.net > bestE.net || !bestE.legal)) bestE = { net: E.net, blds: E.blds, legal: true }; }
    if (bestE.legal || !L0.ok) { cur = bestE.blds; L0 = legal(site, cur, opt); }
    const out = cur.map((b, i) => { const nb = Object.assign({}, b, { id: 101 + i }); delete nb.sc; return nb; });
    const SF = netOf(site, out, opt, keepLow);
    return { blds: out, start, best: { net: SF.net, gross: SF.gross, low: SF.low, dead: SF.dead, fast: S.net, legal: L0.ok, bad: L0.bad.map(r => r.항목) }, steps, tries, ms: Date.now() - t0, us: SF.us };
  }

  const api = { refine, netOf, fastNet, attachCols, engineSync, legal, moved };
  if (isNode) module.exports = api; else g.JbsRefine = api;
})(typeof window !== 'undefined' ? window : globalThis);
