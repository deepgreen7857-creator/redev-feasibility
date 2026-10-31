'use strict';
// 교통성 검토 계산 — 화면과 분리한 순수 함수 (node 단위테스트: node traffic/test-calc.js)
// 법령 숫자는 전부 기준표(criteria)에서 읽는다. 여기에는 숫자를 넣지 않는다.
(function (g) {
  const num = v => (v === '' || v === null || v === undefined || isNaN(+v)) ? null : +v;
  const item = (C, id) => (C.items || []).find(x => x.id === id) || null;
  const unconfirmed = it => !it || /확인필요/.test(it.상태 || '');
  const band = (rows, units, key) => {
    const r = rows.find(b => units >= b.세대수_이상 && (b.세대수_미만 === null || units < b.세대수_미만));
    return r ? r[key] : null;
  };

  // 교통영향평가 대상 여부
  function tia(C, p) {
    const type = p.type || 'redev';
    const local = item(C, 'tia_local_ordinance');
    if (type === 'redev') {
      const it = item(C, 'tia_redev_site_area'), a = num(p.siteArea);
      const r = { basisId: it.id, basis: it.근거, threshold: it.값, unit: '부지면적', value: a, when: it.제출시기, unconfirmed: unconfirmed(it) || unconfirmed(local) };
      r.result = a === null ? '○○' : a >= it.값 ? '대상' : '대상 아님';
      return r;
    }
    if (type === 'building') {
      const it = item(C, 'tia_apartment_gfa'), a = num(p.aptGFA);
      const r = { basisId: it.id, basis: it.근거, threshold: it.값, unit: '아파트 건축 연면적', value: a, when: '「건축법」 제11조 허가 전(개별법 인허가 대상이면 그 인허가 전)', unconfirmed: true };
      r.result = a === null ? '○○' : a >= it.값 ? '대상' : '대상 아님';
      return r;
    }
    return { result: '기준확인필요', basis: '사업 유형별 기준이 기준표에 아직 없음', unconfirmed: true, value: num(p.siteArea), threshold: null, unit: '부지면적' };
  }

  // 진입도로 폭 판정 (roads: [{name, w}])
  function accessRoad(C, p) {
    const units = num(p.units), roads = (p.roads || []).filter(r => num(r.w) !== null).map(r => ({ name: r.name || '도로', w: +r.w })).sort((a, b) => b.w - a.w);
    const s = item(C, 'access_road_width_single'), d = item(C, 'access_road_width_dual');
    if (units === null) return { result: '○○', reason: '계획 세대수 미입력', roads, basis: s.근거 };
    const req = band(s.구간, units, '최소폭_m'), reqSum = band(d.구간, units, '합계폭_m');
    const maxW = roads.length ? roads[0].w : null;
    const two = roads.filter(r => r.w >= 4).slice(0, 2), sum2 = two.length === 2 ? two[0].w + two[1].w : null;
    const out = { units, required: req, requiredSum: reqSum, maxW, sum2, roads, two, basis: s.근거, basisDual: d.근거, noteDual: d.비고 };
    if (!roads.length) { out.result = '○○'; out.reason = '접도 도로 폭 미입력'; return out; }
    out.ok = roads.filter(r => r.w >= req);
    out.short = roads.filter(r => r.w < req);
    if (maxW >= req) out.result = '충족';
    else if (sum2 !== null && sum2 >= reqSum) out.result = '충족(2개 진입도로 합계 기준)';
    else out.result = '미충족';
    return out;
  }

  // 법정 주차대수 (주택)
  function parking(C, p) {
    const it = item(C, 'parking_housing');
    const a = num(p.area85below), b = num(p.area85above), u = num(p.units), u60 = num(p.units60below) || 0;
    const out = { basis: it.근거, note: it.비고, unconfirmed: unconfirmed(it) || /확인필요/.test(it.상태 || '') };
    out.minByUnits = u === null ? null : Math.ceil(u60 * it.세대당_최저.전용60이하 + Math.max(0, u - u60) * it.세대당_최저.일반 - 1e-9);
    out.byArea = (a === null && b === null) ? null : Math.ceil((a || 0) / it.비율['85이하'] + (b || 0) / it.비율['85초과'] - 1e-9);
    out.formula = `전용 85㎡ 이하 합계 ÷ ${it.비율['85이하']} + 85㎡ 초과 합계 ÷ ${it.비율['85초과']} (끝수 1대), 세대당 최저 ${it.세대당_최저.일반}대(전용 60㎡ 이하 ${it.세대당_최저.전용60이하}대)와 비교해 큰 값`;
    const vals = [out.minByUnits, out.byArea].filter(v => v !== null);
    out.legal = vals.length ? Math.max(...vals) : null;
    out.partial = out.byArea === null && out.minByUnits !== null;
    return out;
  }

  // 첨두시 발생교통량 (원단위가 비어 있으면 식만)
  function trips(C, p) {
    const ra = item(C, 'trip_rate_apartment'), rr = item(C, 'trip_rate_retail');
    const u = num(p.units), r = num(p.retailGFA);
    const out = { formula: '발생량 = 세대수 × 공동주택 원단위 + (근생 연면적 ÷ 100) × 근생 원단위', basis: ra.근거, unconfirmed: ra.값 === null || (r && rr.값 === null) };
    out.value = (ra.값 === null || u === null) ? null : Math.round(u * ra.값 + (r && rr.값 !== null ? (r / 100) * rr.값 : 0));
    return out;
  }

  // 개선방안 문장 + /arch 배치 조건
  function improvements(T, C, p, res) {
    const f = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] === undefined || o[k] === null || o[k] === '') ? '○○' : o[k]);
    const list = [];
    const ar = res.access;
    if (ar.result === '미충족') ar.short.forEach(r => list.push(f(T.imp_road_short, { road: r.name, from: r.w, to: ar.required })));
    if (/합계/.test(ar.result)) list.push(f(T.imp_road_dual, { sum: ar.sum2, req: ar.requiredSum, roads: ar.two.map(r => r.name).join('·') }));
    const dist = num(p.stationDist);
    if (dist !== null && dist <= 500) list.push(f(T.imp_station, { station: p.station || '도시철도역', dist }));
    const roads = (p.roads || []).filter(r => num(r.w) !== null);
    if (roads.length === 1) list.push(T.imp_one_road);
    if (roads.length && roads.every(r => r.level === '국지도로')) list.push(T.imp_local_only);
    if (res.tia.result === '대상') list.push(f(T.imp_tia, { when: res.tia.when }));
    list.push(T.imp_construction);
    const need = [T.need_count, T.need_los, T.need_layout];
    if (res.trips.value === null) need.unshift(T.need_rate);
    if (res.tia.unconfirmed) need.push(T.need_ordinance);
    const constraints = {
      진입도로_필요폭_m: ar.required ?? null,
      진입_가능_도로: (ar.ok || []).map(r => r.name),
      확폭_검토_도로: ar.result === '미충족' ? (ar.short || []).map(r => ({ 도로: r.name, 현재_m: r.w, 필요_m: ar.required })) : [],
      법정_주차대수: res.parking.legal,
      교통영향평가: res.tia.result,
      역_방향_보행축: dist !== null && dist <= 500 ? (p.station || '도시철도역') : null,
    };
    return { list, need, constraints };
  }

  function run(C, T, p) {
    const res = { tia: tia(C, p), access: accessRoad(C, p), parking: parking(C, p), trips: trips(C, p) };
    Object.assign(res, improvements(T, C, p, res));
    return res;
  }

  const api = { num, item, unconfirmed, tia, accessRoad, parking, trips, improvements, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else g.TrafficCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
