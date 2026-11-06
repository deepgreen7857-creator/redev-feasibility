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
    const units = num(p.units), roads = (p.roads || []).filter(r => num(r.w) !== null).map(r => ({ name: r.name || '도로', w: num(r.pw) !== null && +r.pw > +r.w ? +r.pw : +r.w, now: +r.w, planned: num(r.pw) !== null && +r.pw > +r.w })).sort((a, b) => b.w - a.w);
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

  // 법정 주차대수 (주택) — 조례(인천: 세대당 1대 이상)가 있으면 세대당 최저를 그 값 이상으로
  function parking(C, p) {
    const it = item(C, 'parking_housing'), rt = item(C, 'parking_retail');
    const a = num(p.area85below), b = num(p.area85above), u = num(p.units), u60 = num(p.units60below) || 0, rg = num(p.retailGFA);
    const ord = it.조례 && num(it.조례.세대당_최저) !== null ? +it.조례.세대당_최저 : null;
    const per = Math.max(it.세대당_최저.일반, ord || 0), per60 = Math.max(it.세대당_최저.전용60이하, ord || 0);
    const out = { basis: it.근거, note: [it.비고, ord ? it.조례.근거 : ''].filter(Boolean).join(' / '), unconfirmed: unconfirmed(it), per, per60, ordinance: ord };
    out.minByUnits = u === null ? null : Math.ceil(u60 * per60 + Math.max(0, u - u60) * per - 1e-9);
    out.byArea = (a === null && b === null) ? null : Math.ceil((a || 0) / it.비율['85이하'] + (b || 0) / it.비율['85초과'] - 1e-9);
    out.formula = `전용 85㎡ 이하 합계 ÷ ${it.비율['85이하']} + 85㎡ 초과 합계 ÷ ${it.비율['85초과']} (끝수 1대), 세대당 최저 ${per}대${per60 !== per ? `(전용 60㎡ 이하 ${per60}대)` : ''}와 비교해 큰 값${ord ? ' — 인천 주차장 조례 [별표 2] 제5호: 세대당 1대 이상' : ''}`;
    const vals = [out.minByUnits, out.byArea].filter(v => v !== null);
    out.housing = vals.length ? Math.max(...vals) : null;
    out.retail = rt && rg ? Math.ceil(rg / rt.값 - 1e-9) : 0;
    out.retailBasis = rt ? `${rt.근거} — 시설면적 ${rt.값}㎡당 1대` : '';
    out.legal = out.housing === null ? null : out.housing + out.retail;
    out.partial = out.byArea === null && out.minByUnits !== null;
    return out;
  }

  // 첨두시 발생교통량(승용차, 대/시) — 활동인구 원단위 × 첨두 유출입률 × 승용차 분담률 ÷ 재차인원
  function trips(C, p) {
    const ra = item(C, 'trip_rate_apartment'), rr = item(C, 'trip_rate_retail');
    const u = num(p.units), r = num(p.retailGFA) || 0;
    const out = { formula: `발생량(대/시) = 세대수 × ${ra.값 ?? '○○'}(공동주택, 오후 첨두) + (근생 연면적 ÷ 100) × ${rr.값 ?? '○○'}(근생)`, basis: ra.근거, rateNote: ra.비고, parts: ra.구성, retailParts: rr.구성, unconfirmed: !!(unconfirmed(ra) || ra.값 === null || (r && (unconfirmed(rr) || rr.값 === null))) };
    if (ra.값 === null || u === null) { out.value = null; return out; }
    const ret = r && rr.값 !== null ? (r / 100) * rr.값 : 0;
    out.apt = Math.round(u * ra.값); out.aptAm = ra.오전 != null ? Math.round(u * ra.오전) : null; out.retail = Math.round(ret);
    out.value = Math.round(u * ra.값 + ret);
    out.am = ra.오전 != null ? Math.round(u * ra.오전 + ret) : null;
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
      진입_가능_도로: ((ar.ok || []).length ? ar.ok : /합계/.test(ar.result || '') ? (ar.two || []) : []).map(r => r.name),   // 2개 합계로 충족이면 그 두 도로(2026-11-06)
      확폭_검토_도로: ar.result === '미충족' ? (ar.short || []).map(r => ({ 도로: r.name, 현재_m: r.w, 필요_m: ar.required })) : [],
      법정_주차대수: res.parking.legal,
      교통영향평가: res.tia.result,
      역_방향_보행축: dist !== null && dist <= 500 ? (p.station || '도시철도역') : dist !== null ? `해당 없음(${p.station || '최근접 역'} ${dist}m — 500m 밖)` : null,
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
