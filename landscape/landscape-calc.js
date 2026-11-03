'use strict';
// 경관 검토 계산 — 순수 함수 (node landscape/test-calc.js)
(function (g) {
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const item = (C, id) => (C.items || []).find(x => x.id === id) || null;
  function review(C, p) {
    const d = item(C, 'landscape_dev_redev'), b = item(C, 'landscape_building');
    const a = num(p.siteArea), lim = p.urban === '아니오' ? (d.도시지역외_값 || d.값) : d.값;
    const dev = d.값 === null ? '기준확인필요' : a === null ? '○○' : a >= lim ? '심의 대상' : '대상 아님';
    const B = b.값 || {}, fl = num(p.floors), gfa = num(p.gfa), sale = p.sale !== '아니오';
    let bld, bldWho = '';
    if (p.keyArea === '예' || p.district === '예') { bld = '심의 대상'; bldWho = p.district === '예' ? '경관지구 건축물' : '중점경관관리구역 건축물(경관계획이 정한 것)'; }
    else if (fl === null && gfa === null) bld = '○○';
    else if (sale && ((fl !== null && fl >= B.시_21층이상) || (gfa !== null && gfa >= B.시_연면적_m2))) { bld = '심의 대상'; bldWho = `시 경관위원회(분양 목적 ${B.시_21층이상}층 이상 또는 연면적 ${(B.시_연면적_m2 || 0).toLocaleString()}㎡ 이상 — 시 건축위원회 심의 건축물)`; }
    else if (sale && gfa !== null && gfa >= B.구_분양바닥면적_m2) { bld = '심의 대상'; bldWho = `구 경관위원회(분양 바닥면적 ${(B.구_분양바닥면적_m2 || 0).toLocaleString()}㎡ 이상 — 구 건축위원회 심의 건축물)`; }
    else bld = '대상 아님(조례 기준 미만)';
    const unc = it => !it || /확인필요/.test(it.상태 || '');
    return { dev, devLim: lim, devBasis: d.근거, devNote: d.비고, when: d.심의시기, bld, bldWho, bldBasis: b.근거, bldNote: b.비고, keyList: (item(C, 'landscape_plan_key_area') || {}).값, unconfirmed: unc(d) || unc(b) };
  }
  function height(C, p) {
    const fl = num(p.floors), ar = num(p.aroundFloors), lim = (C._내부검토기준 || {}).주변대비_층수배율_주의;
    if (fl === null || ar === null || ar <= 0) return { result: '○○', ratio: null, lim };
    const ratio = Math.round(fl / ar * 10) / 10;
    return { ratio, lim, result: ratio >= lim ? '스카이라인 변화 큼' : '주변과 조화 범위' };
  }
  function run(C, T, p, cons) {
    const res = { rev: review(C, p), h: height(C, p) };
    const f = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] === undefined || o[k] === null || o[k] === '') ? '○○' : o[k]);
    const list = [];
    if (p.keyArea === '예' || p.district === '예') list.push(T.imp_key);
    if (res.h.result === '스카이라인 변화 큼') list.push(f(T.imp_height, { floors: p.floors, around: p.aroundFloors, ratio: res.h.ratio }));
    if (p.views) list.push(f(T.imp_view, { views: p.views }));
    if (p.axis) list.push(f(T.imp_axis, { axis: p.axis }));
    if (cons && cons.env && cons.env.국가유산_검토) list.push(T.imp_heritage);
    list.push(T.imp_street);
    const hasArch = !!(cons && cons.arch);
    const need = [T.need_plan]; if (!hasArch) need.unshift(T.need_layout);
    const constraints = {
      층수_점감_검토: res.h.result === '스카이라인 변화 큼' ? `주변 평균 ${p.aroundFloors}층 대비 ${res.h.ratio}배` : null,
      통경축_방향: p.axis || null,
      조망점: p.views ? p.views.split(/[,，·]/).map(s => s.trim()).filter(Boolean) : [],
      관리구역: p.keyArea === '예' ? '중점경관관리구역' : p.district === '예' ? '경관지구' : null,
    };
    return Object.assign(res, { list, need, constraints, hasArch });
  }
  // 통경축 개방률: 조망축 방향(방위각, 북=0 시계방향)으로 바라볼 때 동에 가려지지 않는 폭의 비율
  function openness(blds, sitePts, bearing, minGap = 15) {
    const b = bearing * Math.PI / 180, perp = [Math.cos(b), -Math.sin(b)];
    const pr = p => p[0] * perp[0] + p[1] * perp[1];
    const sv = sitePts.map(pr), s0 = Math.min(...sv), s1 = Math.max(...sv), W = s1 - s0;
    const iv = blds.map(bd => { const v = bd.poly.map(pr); return [Math.min(...v), Math.max(...v)]; }).sort((a, c) => a[0] - c[0]);
    const merged = []; iv.forEach(x => { const l = merged[merged.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else merged.push(x.slice()); });
    const covered = merged.reduce((a, x) => a + Math.min(x[1], s1) - Math.max(x[0], s0), 0);
    const gaps = []; let at = s0; merged.forEach(x => { if (x[0] - at >= minGap) gaps.push(Math.round(x[0] - at)); at = Math.max(at, x[1]); }); if (s1 - at >= minGap) gaps.push(Math.round(s1 - at));
    return { width: Math.round(W), open: W ? Math.round((1 - covered / W) * 1000) / 10 : null, gaps, minGap };
  }
  // 경계부 층수 점감: 구역 경계에서 dist 안에 있는 동 중 주변 평균의 배율 이상인 동
  function edgeTall(blds, sitePts, around, ratio, dist = 30, segDist) {
    if (!around) return [];
    const E = sitePts.map((a, i) => [a, sitePts[(i + 1) % sitePts.length]]);
    return blds.filter(bd => bd.floors >= around * ratio && Math.min(...bd.poly.map(p => Math.min(...E.map(e => segDist(p, e[0], e[1]))))) < dist).map(bd => bd.id);
  }
  const api = { num, review, height, run, openness, edgeTall };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.LandscapeCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
