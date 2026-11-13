'use strict';
// 실제 사례 대조 — 사용자가 입력한 실제 사례(정비계획 고시·사업시행·관리처분 값)와 이 사이트가 자동으로 낸 값을 늘 비교한다.
// 목적: 자동 값이 실제와 얼마나 차이 나는지(항목별 평균 차이·범위)를 쌓아 가정값을 고칠 근거로 씀.
// 저장 위치: 브라우저 localStorage 'jbs-cases-v1'(작업 저장·불러오기 파일에 자동 포함). 서버·저장소에 올리지 않음.
// 사례 이름은 'A구역'처럼 익명으로, 외부에 고시되는 자료 수준의 숫자만 넣는다.
(function (g) {
  const KEY = 'jbs-cases-v1';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { cases: {} }; } catch (e) { return { cases: {} }; } };
  const write = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch (e) { try { g.dispatchEvent(new CustomEvent('jbs-storage-full', { detail: { key: KEY } })); } catch (e2) { /* 무시 */ } return false; } };
  const now = () => new Date().toLocaleString('sv-SE').slice(0, 16);
  const n = v => { const x = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(x) ? x : NaN; };

  // 비교 항목: key, 이름, 단위, 묶음
  const ITEMS = [
    ['siteArea', '구역 면적', '㎡', '면적'],
    ['infraPct', '정비기반시설 비율', '%', '면적'],
    ['lotArea', '획지(건축 대지) 면적', '㎡', '면적'],
    ['far', '용적률', '%', '건축'],
    ['farArea', '용적률 산정 연면적', '㎡', '건축'],
    ['units', '총 세대수', '세대', '세대'],
    ['rentU', '임대 세대수', '세대', '세대'],
    ['u59', '59㎡형 분양 세대', '세대', '세대'],
    ['u84', '84㎡형 분양 세대', '세대', '세대'],
    ['u114', '114㎡형 분양 세대', '세대', '세대'],
    ['conPrice', '공사비', '만원/평', '단가'],
    ['generalPrice', '일반분양가', '만원/평', '단가'],
    ['revTotal', '총수입', '억원', '사업성'],
    ['costTotal', '총사업비', '억원', '사업성'],
    ['prior', '종전자산', '억원', '사업성'],
    ['ratio', '비례율', '%', '사업성'],
  ];
  const STAGES = ['정비계획(구역지정) 고시', '정비계획 변경 고시', '사업시행계획인가', '관리처분계획인가', '조합·추진위 제출안', '기타'];

  // 차이: 자동 − 실제, 차이율 = 차이 ÷ 실제 × 100. 비율 항목(%)은 %p도 함께
  function diff(auto, actual, unit) {
    const a = n(auto), b = n(actual);
    if (!isFinite(a) || !isFinite(b)) return null;
    const d = a - b, pct = b !== 0 ? d / Math.abs(b) * 100 : NaN;
    return { d, pct, pp: unit === '%' ? d : null };
  }

  const JbsCases = {
    ITEMS, STAGES, diff,
    list() { return Object.values(read().cases).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))); },
    get(id) { return read().cases[id] || null; },
    save(c) {
      const s = read();
      if (!c.id) c.id = 'c' + Date.now().toString(36);
      c.updated = now();
      s.cases[c.id] = c;
      return write(s) ? c : null;
    },
    remove(id) { const s = read(); delete s.cases[id]; write(s); },
    // 한 사례 비교 행
    rows(c, autoNow) {
      return ITEMS.map(([k, label, unit, grp]) => {
        const actual = c && c.actual ? c.actual[k] : '', saved = c && c.auto ? c.auto[k] : undefined, cur = autoNow ? autoNow[k] : undefined;
        return { k, label, unit, grp, actual, saved, cur, dSaved: diff(saved, actual, unit), dCur: diff(cur, actual, unit) };
      });
    },
    // 전체 사례: 항목별로 '저장 당시 자동값'과 실제의 차이율 평균·범위 — 자동 계산이 한쪽으로 치우치는지
    summary(cases) {
      cases = cases || this.list();
      return ITEMS.map(([k, label, unit]) => {
        const ds = cases.map(c => diff(c.auto && c.auto[k], c.actual && c.actual[k], unit)).filter(x => x && isFinite(x.pct));
        if (!ds.length) return { k, label, unit, n: 0 };
        const p = ds.map(x => x.pct), mean = p.reduce((a, b) => a + b, 0) / p.length;
        const absMean = p.reduce((a, b) => a + Math.abs(b), 0) / p.length;
        const pp = unit === '%' ? ds.reduce((a, x) => a + x.pp, 0) / ds.length : null;
        return { k, label, unit, n: ds.length, mean, absMean, min: Math.min(...p), max: Math.max(...p), pp };
      });
    },
  };
  // 고시된 실제 사례(저장소 shared/criteria/cases-ref.json, 2026-11-13 작업기준서 1장 완료 기준 4) — 사용자가 입력하지 않아도 같은 구역이면 늘 비교
  let REF = null, refP = null;
  JbsCases.loadRefs = function () {
    if (REF) return Promise.resolve(REF);
    if (!refP) refP = fetch('/shared/criteria/cases-ref.json').then(r => r.ok ? r.json() : { cases: [] }).catch(() => ({ cases: [] })).then(j => (REF = j.cases || []));
    return refP;
  };
  JbsCases.refs = () => REF || [];
  // 지금 구역과 90% 이상 겹치는 고시 사례(turf 필요)
  JbsCases.refMatch = function (gj) {
    if (!gj || !REF || !REF.length || !g.turf) return null;
    const f = gj.type === 'Feature' ? gj : { type: 'Feature', properties: {}, geometry: gj };
    for (const c of REF) {
      try { const i = g.turf.intersect(c.geojson, f); if (!i) continue; const a = g.turf.area(i); if (a / g.turf.area(c.geojson) > 0.9 && a / g.turf.area(f) > 0.9) return c; } catch (e) { /* 무시 */ }
    }
    return null;
  };
  JbsCases.ITEMS_ = ITEMS;
  g.JbsCases = JbsCases;
})(typeof window !== 'undefined' ? window : globalThis);
