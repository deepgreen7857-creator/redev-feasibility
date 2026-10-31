'use strict';
// 환경성 검토 계산 — 순수 함수 (node 단위테스트: node env/test-calc.js). 숫자는 기준표에서만 읽음
(function (g) {
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const item = (C, id) => (C.items || []).find(x => x.id === id) || null;
  const unc = it => !it || /확인필요/.test(it.상태 || '') || /재대조/.test(it.상태 || '');

  function eia(C, p) {
    const e = item(C, 'eia_redev_area'), s = item(C, 'small_eia_urban'), st = item(C, 'strategic_eia');
    const a = num(p.siteArea), green = num(p.greenArea) || 0;
    const out = { area: a, eia: e, small: s, strategic: { result: st.값 == null ? '기준확인필요' : a === null ? '○○' : a >= st.값 ? '전략환경영향평가 대상(정비구역 지정)' : '대상 아님', basis: st.근거, when: st.협의시기 }, unconfirmed: unc(e) || unc(s) };
    if (a === null) { out.result = '○○'; return out; }
    if (a >= e.값) { out.result = '환경영향평가 대상'; out.basis = e.근거; return out; }
    if (p.urban === '아니오') { out.result = '확인필요(도시지역 외)'; out.basis = s.근거; return out; }
    if (a >= s.값 || green >= s.녹지지역_값) { out.result = '소규모 환경영향평가 대상'; out.basis = s.근거; out.when = s.협의시기; return out; }
    out.result = '대상 아님'; out.basis = `${e.근거}; ${s.근거}`;
    return out;
  }
  function heritage(C, p) {
    const h = item(C, 'heritage_radius'), d = num(p.heritageDist);
    return { radius: h.값, dist: d, name: p.heritage || '', basis: h.근거, unconfirmed: unc(h), result: d === null ? (p.heritage ? '○○' : '해당 정보 없음') : d <= h.값 ? '보존지역 해당 가능' : '범위 밖' };
  }
  function noise(C, p) {
    const n = item(C, 'noise_outdoor');
    const roads = (p.roads || []).filter(r => /간선/.test(r.level || ''));
    return { db: n.값, roads, basis: n.근거, unconfirmed: unc(n), result: roads.length ? '소음 검토 필요' : ((p.roads || []).some(r => !r.level) ? '○○' : '주요 소음원 없음') };
  }
  // 정북방향 이격: 높이 H → H≤10이면 1.5m, 초과면 H×0.5 (층고는 가정값)
  function sunlight(C, p) {
    const s = item(C, 'sunlight_north'), fl = num(p.floors), fh = num(p.floorHeight) || 3;
    const H = fl === null ? null : fl * fh;
    const need = H === null ? null : (H <= 10 ? s.이격.높이10m이하_m : Math.round(H * s.이격.높이10m초과_높이비 * 10) / 10);
    return { H, fh, need, a: s.이격.높이10m이하_m, b: s.이격.높이10m초과_높이비, basis: s.근거, note: s.비고, apply: p.northRes === '예', result: p.northRes === '예' ? '높이 제한 반영 필요' : p.northRes === '아니오' ? '해당 없음' : '○○' };
  }
  function slope(C, p) {
    const s = item(C, 'slope_limit'), v = num(p.slope);
    return { value: v, limit: s.값, basis: s.근거, unconfirmed: unc(s), result: v === null ? '○○' : (s.값 === null ? '기준확인필요' : '검토') };
  }
  function run(C, T, p) {
    const res = { eia: eia(C, p), heritage: heritage(C, p), noise: noise(C, p), sun: sunlight(C, p), slope: slope(C, p) };
    const f = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] === undefined || o[k] === null || o[k] === '') ? '○○' : o[k]);
    const list = [];
    if (res.noise.roads.length) list.push(f(T.imp_noise, { roads: res.noise.roads.map(r => r.name || '간선도로').join('·'), db: res.noise.db }));
    if (res.sun.apply) list.push(f(T.imp_sun, { a: res.sun.a, b: '2분의 1' }));
    if (res.heritage.result === '보존지역 해당 가능') list.push(f(T.imp_heritage, { name: res.heritage.name || '국가유산', dist: res.heritage.dist, r: res.heritage.radius }));
    if (res.slope.value !== null && res.slope.value >= 10) list.push(f(T.imp_slope, { slope: res.slope.value }));
    list.push(T.imp_green, T.imp_construction);
    const need = [T.need_tree, T.need_noise, T.need_strategic, T.need_ordinance, T.need_layout];
    const constraints = {
      소음_검토_도로: res.noise.roads.map(r => r.name || '간선도로'),
      북측_일조_높이제한: res.sun.apply ? `높이 10m 이하 ${res.sun.a}m, 초과 부분 높이의 1/2 이상 이격` : null,
      국가유산_검토: res.heritage.result === '보존지역 해당 가능' ? `${res.heritage.name || '국가유산'} 방향 층수 조정` : null,
      평균경사도_퍼센트: res.slope.value,
      영향평가: res.eia.result,
    };
    return Object.assign(res, { list, need, constraints });
  }
  const api = { num, item, eia, heritage, noise, sunlight, slope, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.EnvCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
