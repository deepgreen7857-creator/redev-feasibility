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

  /* ---------- 1단계: 빠른 검사(규칙) ---------- */
  function quick(site, blds, opt) {
    const rules = [], add = r => rules.push(Object.assign({ 갈래: '규칙' }, r));
    const sp = opt.spacing, sb = itemOf(opt, 'spacing_ratio'), winI = itemOf(opt, 'window_setback'), sunI = itemOf(opt, 'sunlight_north');
    // ① 대지 안·경계 이격(가정 이격 포함) — 경계에서 띄울 거리 중 법정 부분은 아래 높이 상한에서 따로 봄
    const test = G.buildableTest(site.pts, site.setbacks || []), ex = site.exclude || [];
    blds.forEach(b => {
      const pts = b.poly.flatMap((p, i) => { const q = b.poly[(i + 1) % b.poly.length]; return [p, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]]; });
      const outN = pts.filter(p => !test(p[0], p[1])).length, inEx = pts.filter(p => ex.some(e => G.inside(p[0], p[1], e))).length;
      if (outN) add({ id: 'boundary', 항목: '대지 경계·이격', 동: [b.id], 판정: '위반', 값: `꼭짓점·변 중점 ${outN}곳이 대지 밖 또는 경계 이격 안`, 근거: '대지 경계(입력한 변별 이격 포함)' });
      if (inEx) add({ id: 'infra', 항목: '기반시설 침범', 동: [b.id], 판정: '위반', 값: `${inEx}곳이 공원·도로 등 건축 불가 영역 안`, 근거: '정비기반시설 계획(건축 불가 영역)' });
    });
    // ② 동끼리 겹침, ③ 동 사이 거리(시행령 제86조③2호)
    for (let i = 0; i < blds.length; i++) for (let j = i + 1; j < blds.length; j++) {
      const a = blds[i], b = blds[j];
      if (overlapConvex(a.poly, b.poly)) { add({ id: 'collide', 항목: '동 겹침', 동: [a.id, b.id], 판정: '위반', 값: '두 동이 겹침', 근거: '' }); continue; }
      const th = (a.angle || 0) * D2R, A = bboxIn(a.poly, th), B = bboxIn(b.poly, th);
      const xo = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), yo = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (xo > 0.5) {
        // 앞뒤로 마주봄: 남쪽 동 S, 북쪽 동 N. 가목 = 채광창 벽면에서 높이 × 배수(두 동 모두 → 높은 쪽), 나목 = 북쪽(높은) 동 주된 개구부가 남쪽(낮은) 동을 향하면 10m 이상 + 낮은 동 높이 × 배수
        const [S, N, s, n] = A.y0 <= B.y0 ? [a, b, A, B] : [b, a, B, A];
        const gap = n.y0 - s.y1, hS = H(opt, S.floors), hN = H(opt, N.floors);
        const need = hN >= hS ? Math.max(10, sp * hS) : sp * Math.max(hS, hN), lawNeed = hN >= hS ? Math.max(10, 0.5 * hS) : 0.5 * Math.max(hS, hN);
        if (gap < need - 0.05) add({ id: 'spacing', 항목: '동 사이 거리(앞뒤)', 동: [S.id, N.id], 판정: '위반', 기준: `${need.toFixed(1)}m 이상`, 값: `${gap.toFixed(1)}m`,
          근거: (hN >= hS ? '건축법 시행령 제86조③2호나목(높은 동 주된 개구부가 낮은 동을 향함: 10m 이상, 낮은 동 높이 × ' : '같은 조 ③2호가목(채광창 벽면에서 높이 × ') + `${sp}배 — 인천 건축조례 제32조⑤·⑥), 법정 하한 ${lawNeed.toFixed(1)}m` + (sb.상태 ? '' : ' ※ 기준 확인 필요') });
      } else if (yo > 0.5) {
        // 옆으로 나란함: 측벽끼리(판상 끝벽) 4m(마목), 창 있는 벽이 마주보면(탑상·Y·ㅁ) 가목
        const gap = Math.max(B.x0 - A.x1, A.x0 - B.x1), side = f => ['slab', 'L'].includes(f);
        const need = side(a.form) && side(b.form) ? 4 : sp * Math.max(H(opt, a.floors), H(opt, b.floors));
        if (gap < need - 0.05) add({ id: 'side', 항목: '동 사이 거리(옆)', 동: [a.id, b.id], 판정: '위반', 기준: `${need.toFixed(1)}m 이상`, 값: `${gap.toFixed(1)}m`,
          근거: side(a.form) && side(b.form) ? '건축법 시행령 제86조③2호마목(측벽과 측벽 4m 이상)' : `같은 조 ③2호가목(창 있는 벽면 높이 × ${sp}배 — 탑상·Y·ㅁ형은 옆 벽에도 창)` });
      }
    }
    // ④ 높이 상한: 정북 일조(시행령 제86조①)·채광창 벽면(제86조③1호·⑥) — 정북만 켠 것과 모두 켠 것을 따로 재서 어느 조문인지 가림
    const capAll = G.capper(site, opt), capSun = G.capper(site, Object.assign({}, opt, { winRatio: 0 }));
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
    const ev = evaluate(site, blds, opt, q);
    return Object.assign({}, q, { risks, prefs: ev.prefs, score: ev.score });
  }

  const api = { quick, evaluate, verify, gfaOf, unitsOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.JbsCheck = api;
})(typeof window !== 'undefined' ? window : globalThis);
