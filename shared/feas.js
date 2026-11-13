'use strict';
// 공통 개략 사업성 — jbslab 첫 화면(★빠른 사업성·사업성 가정값)과 /urban '사업성' 탭이 같은 가정값·같은 계산을 쓰도록 한 곳에 둠
//  가정값 저장: 브라우저 localStorage 'jbs-feas-assume-v1' (같은 사이트의 두 화면이 함께 씀, 서버로 보내지 않음)
//  금액 단위: 만원, 면적: ㎡, 분양가·공사비 단가: 만원/평
(function (g) {
  const KEY = 'jbs-feas-assume-v1', PY = 3.305785;
  // 기본 가정값 — 모두 '가정값'(법정값 아님). 인천 사례·시세로 보정 전까지 검증필요
  const DEF = {
    generalPrice: 2300,   // 일반분양가(공급면적 평당)
    memberRatio: 80,      // 조합원분양가 = 일반분양가 × %
    // 재개발 임대주택 인수가격: 건축물 = 기본형건축비 × 80%(2024년 시행령 개정, 종전 표준건축비), 부속토지 = 감정가(의무 임대).
    //  용적률 완화분 임대는 건축비만(토지 기부채납) — 1회차는 정비계획 상한 이내라 의무 임대만 셈
    buildCost: 232.8,     // 기본형건축비(만원/㎡, 공급면적) — 2026. 9. 15. 정기고시, 16~25층·전용 60~85㎡ 지상층 기준
    rentBuildPct: 80,     // 임대 건축물 인수 비율(기본형건축비 대비 %)
    rentLand: 1,          // 1이면 임대 부속토지 감정가 포함(의무 임대), 0이면 제외(완화분처럼 기부채납)
    rentPrice: 616,       // 임대 건축물 인수가(만원/평, 공급) — get()에서 기본형건축비 × 비율로 자동 계산
    shopPrice: 2500,      // 상가 분양가(평당)
    conPrice: 750,        // 공사비(계획연면적 평당)
    gfaFactor: 1.45,      // 계획연면적 = 용적률 연면적 × 배율(지하주차장·공용 포함)
    etcPct: 30,           // 기타 사업비(설계·감리·금융·제세·이주·보상 등) % of 공사비
    priorMul: 1.4,        // 종전자산 ≈ 공시지가 합 × 배율
    houseMul: 1.7,        // 재건축 종전자산 ≈ 공동주택가격 합 × 배율 — 인천 첫 준공업 재건축 A구역(2026.1 구역지정 고시 종전 1,789억 ÷ 2025 공동주택가격 합 1,052.7억 = 1.70) 1건 사례값
    avgLand: 0,           // 토지조서 공시지가가 없을 때 쓰는 평균 공시지가(만원/㎡)
    rentRatio: 5,         // 임대주택 비율(세대 %) — 인천 재개발 5%(학교용지 확보 구역·상업지역 2.5%): 인천광역시고시 제2018-251호 제2조, 국토부고시 제2024-26호 제4조⑥ 범위 5~20%(2026-11-05 원문 대조, urban/rules/incheon.json rental_housing_ratio). 임대는 49㎡형으로 셈
    rentFix: 1,           // 예전 기본값 15%가 저장된 것을 한 번만 5%로 고쳤다는 표시(get 참고)
    mix59: 40, mix84: 50, mix114: 10,   // 분양 평형 비율(%) — 평형 키는 전용㎡(shared/criteria/arch.json 평면과 같음)
    mix39: 0, mix49: 0, mix74: 0, mix101: 0,   // 소형·중형 평형(예전 저장값에는 없으므로 0)
    resRatio: 97,         // 용적률 연면적 중 주거 비율(나머지 상가)
    infraAvg: 25,         // 정비기반시설 비율 '평균'(실무 경험치)
    infraCons: 30,        // 정비기반시설 비율 '보수적'(실무 경험치)
    infraMinFallback: 15, // 토지조서가 없을 때 '최소' 대신 쓰는 값
    parkPerUnit: 2,       // 법정 공원 세대당 ㎡(도시공원법 시행규칙 별표2 — 정비계획 5만㎡ 이상)
  };
  const LABEL = {
    generalPrice: '일반분양가(만원/평)', memberRatio: '조합원분양가 비율(%)', rentPrice: '임대 건축물 인수가(만원/평)', buildCost: '기본형건축비(만원/㎡, 공급면적)', rentBuildPct: '임대 건축물 인수 비율(%)', rentLand: '임대 부속토지 감정가 포함(1/0)', shopPrice: '상가 분양가(만원/평)',
    conPrice: '공사비(만원/평, 계획연면적)', gfaFactor: '계획연면적 배율', etcPct: '기타 사업비(공사비 대비 %)', priorMul: '종전자산 보정배율(공시지가 ×)', houseMul: '재건축 종전자산 배율(공동주택가격 ×)',
    avgLand: '평균 공시지가(만원/㎡)', rentRatio: '임대주택 비율(%)', mix59: '59㎡형 비율(%)', mix84: '84㎡형 비율(%)', mix114: '114㎡형 비율(%)', mix39: '39㎡형 비율(%)', mix49: '49㎡형 비율(%)', mix74: '74㎡형 비율(%)', mix101: '101㎡형 비율(%)', resRatio: '주거 비율(%)', infraAvg: '기반시설 비율 평균(%)', infraCons: '기반시설 비율 보수적(%)',
  };
  // 표준 평면 공급면적(㎡) — shared/criteria/arch.json 평면과 같은 값. 모두 실제 사례 면적표(arch.json 평면 대표사례·면적사례)
  const SUPPLY = { 39: 53.79, 49: 68.36, 59: 79.34, 74: 102.51, 84: 110.52, 101: 135, 114: 153.76 };
  const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

  const JbsFeas = {
    KEY, DEF, LABEL, SUPPLY, PY,
    get() {
      let v = {}; try { v = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { v = {}; }
      const out = Object.assign({}, DEF);
      // 예전 기본값(임대 15%)이 그대로 저장돼 있으면 한 번만 인천 고시 값(5%)으로 — 사용자가 나중에 15%를 다시 고르면 rentFix가 저장돼 있어 그대로 둠
      if (!v.rentFix && +v.rentRatio === 15) { delete v.rentRatio; try { localStorage.setItem(KEY, JSON.stringify(Object.assign({}, v, { rentFix: 1 }))); } catch (e) { /* 무시 */ } }
      Object.keys(DEF).forEach(k => { if (v[k] !== undefined && v[k] !== '' && isFinite(+v[k])) out[k] = +v[k]; });
      out.rentPrice = Math.round(out.buildCost * PY * out.rentBuildPct / 100);   // 임대 건축물 인수가는 항상 기본형건축비에서 계산
      return out;
    },
    set(patch) {
      const cur = this.get(); Object.assign(cur, patch);
      // 59㎡형 비율만 바꾸면 84㎡형이 나머지를 채움(다른 평형은 그대로)
      if (patch.mix59 !== undefined && patch.mix84 === undefined) cur.mix84 = Math.max(0, 100 - Object.keys(cur).filter(k => /^mix\d+$/.test(k) && k !== 'mix84').reduce((s, k) => s + num(cur[k]), 0));
      try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch (e) { /* 저장 못 해도 계산은 됨 */ }
      return cur;
    },
    reset() { try { localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } return this.get(); },
    supply(t) { return SUPPLY[t] || num(t) * 1.33; },
    // 분양 평형 비율 {전용㎡: %} — A의 mixNN 키 전부(0인 평형은 units()에서 빠짐)
    mixOf(A) { const m = {}; Object.keys(A).forEach(k => { const x = /^mix(\d+)$/.exec(k); if (x) m[x[1]] = num(A[k]); }); return m; },

    // 세대수: 용적률 연면적 × 주거비율 ÷ 세대당 평균 공급면적(임대 49㎡형 + 분양 평형 비율). 두 화면 모두 이 식을 씀
    //  supOv {t: 공급㎡} — 평면 크기를 바꿀 때(49는 임대)
    units(farArea, A, mix, supOv) {
      A = A || this.get(); mix = mix || this.mixOf(A); supOv = supOv || {};
      const sp = t => num(supOv[t]) || this.supply(t);
      const ts = Object.keys(mix).filter(t => num(mix[t]) > 0).sort((a, b) => num(a) - num(b));
      const ms = ts.reduce((s, t) => s + num(mix[t]), 0) || 1;
      const rent = num(A.rentRatio) / 100, resArea = num(farArea) * num(A.resRatio) / 100;
      const avgSale = ts.reduce((s, t) => s + num(mix[t]) / ms * sp(t), 0);
      const avg = rent * sp(49) + (1 - rent) * avgSale;
      const total = avg > 0 ? Math.floor(resArea / avg) : 0, rental = Math.round(total * rent), saleU = total - rental;
      const sale = {}; let g0 = 0;
      ts.forEach(t => { sale[t] = Math.floor(saleU * num(mix[t]) / ms); g0 += sale[t]; });
      const big = ts.slice().sort((a, b) => num(mix[b]) - num(mix[a]))[0]; if (big) sale[big] += saleU - g0;
      const supply = {}; ts.forEach(t => { supply[t] = sp(t); });
      return { total, rental, sale, saleU, avg, resArea, rentSupply: sp(49), supply, perUnit: total ? num(farArea) / total : 0 };
    },

    // 세대 구성·연면적·종전자산 → 수입·사업비·비례율·분담금
    //  inp.byType {t: 전체 세대(임대 포함)}, inp.rental 임대 세대, inp.members 조합원(분양 신청) 수, inp.owners 평균 권리가액 나눌 사람 수,
    //  inp.farArea 용적률 연면적(지상), inp.resArea 그중 주거, inp.prior 종전자산(만원), inp.supply {t: 공급㎡}(없으면 표준)
    //  임대는 작은 평형부터, 조합원은 분양 세대 비율대로 배분(빠른 사업성의 /arch 확정안 방식과 같음)
    money(inp, A) {
      A = A || this.get();
      const sup = t => num((inp.supply || {})[t]) || this.supply(t);
      //  inp.sale {t: 분양 세대} + inp.rental(49㎡형 임대, inp.rentSupply) — units() 결과 그대로
      //  inp.byType {t: 전체 세대} — 실제 배치안(/arch)처럼 평형별 세대가 정해진 경우, 임대를 작은 평형부터 뺌
      const src = inp.sale || inp.byType || {};
      const types = Object.keys(src).filter(t => num(src[t]) > 0).sort((a, b) => num(a) - num(b));
      const rent = {}, sale = {}, mem = {};
      let total, rentSep = 0;
      if (inp.sale) {
        types.forEach(t => { sale[t] = num(inp.sale[t]); rent[t] = 0; });
        rentSep = Math.round(num(inp.rental));
        total = types.reduce((n, t) => n + sale[t], 0) + rentSep;
      } else {
        total = types.reduce((n, t) => n + num(inp.byType[t]), 0);
        let rentLeft = Math.min(total, Math.round(num(inp.rental)));
        types.forEach(t => { const r = Math.min(rentLeft, num(inp.byType[t])); rent[t] = r; rentLeft -= r; sale[t] = num(inp.byType[t]) - r; });
      }
      const saleU = types.reduce((n, t) => n + sale[t], 0);
      const memWant = Math.min(Math.max(0, Math.round(num(inp.members))), saleU);
      let given = 0;
      types.forEach(t => { mem[t] = saleU ? Math.floor(memWant * sale[t] / saleU) : 0; given += mem[t]; });
      for (const t of types.slice().sort((a, b) => sale[b] - sale[a])) { if (given >= memWant) break; if (mem[t] < sale[t]) { mem[t]++; given++; } }
      const memberPrice = A.generalPrice * A.memberRatio / 100;
      const amt = (n, t, p) => n * sup(t) / PY * p;
      const rows = [];
      types.forEach(t => { if (mem[t]) rows.push({ cat: '조합원', t, units: mem[t], area: sup(t), price: memberPrice, amount: amt(mem[t], t, memberPrice) }); });
      types.forEach(t => { const n = sale[t] - mem[t]; if (n) rows.push({ cat: '일반', t, units: n, area: sup(t), price: A.generalPrice, amount: amt(n, t, A.generalPrice) }); });
      // 임대 부속토지(의무 임대): 세대당 대지지분 ≈ 공동주택 획지 × (그 세대 공급면적 ÷ 전체 공급면적), × 토지 감정단가(만원/㎡)
      const rSup = num(inp.rentSupply) || this.supply(49);
      const allSup = types.reduce((s0, t) => s0 + (sale[t] + rent[t]) * sup(t), 0) + rentSep * rSup;
      const landOn = A.rentLand && num(inp.lotArea) > 0 && num(inp.landUnit) > 0 && allSup > 0;
      const landPer = area => landOn ? num(inp.lotArea) * area / allSup * num(inp.landUnit) : 0;   // 세대당 토지 인수가(만원)
      const rentRow = (t, n, area) => { const lp = landPer(area), bp = A.rentPrice, per = bp + (area > 0 ? lp / (area / PY) : 0);
        rows.push({ cat: '임대', t, units: n, area, price: per, buildPrice: bp, landPerUnit: lp, amount: n * area / PY * bp + n * lp, landAmount: n * lp }); };
      types.forEach(t => { if (rent[t]) rentRow(t, rent[t], sup(t)); });
      if (rentSep) rentRow('49', rentSep, rSup);
      const shopArea = Math.max(0, num(inp.farArea) - num(inp.resArea || inp.farArea));
      if (shopArea > 1) rows.push({ cat: '상가', t: '', units: 1, area: shopArea, price: A.shopPrice, amount: shopArea / PY * A.shopPrice });
      const rev = rows.reduce((s, r) => s + r.amount, 0);
      const byCat = rows.reduce((o, r) => { o[r.cat] = (o[r.cat] || 0) + r.amount; return o; }, {});
      const planGfa = num(inp.farArea) * A.gfaFactor;
      // 기타 사업비는 기준 공사비(A.etcConPrice — 시나리오로 공사비만 바꿀 때 넘김, 없으면 지금 공사비)로(2026-11-13 오류기록 7번)
      const construction = planGfa / PY * A.conPrice, etc = planGfa / PY * (num(A.etcConPrice) || A.conPrice) * A.etcPct / 100, cost = construction + etc;
      const prior = num(inp.prior);
      const ratio = prior > 0 && rev > 0 ? (rev - cost) / prior * 100 : NaN;
      const owners = num(inp.owners) || memWant;
      const right = owners > 0 && isFinite(ratio) ? prior / owners * ratio / 100 : NaN;
      const charge = {}; types.forEach(t => { charge[t] = isFinite(right) ? memberPrice * sup(t) / PY - right : NaN; });
      const rentU = rentSep + types.reduce((n, t) => n + rent[t], 0);
      return { types, total, rentU, rent, sale, mem, memTotal: given, short: Math.max(0, Math.round(num(inp.members)) - given), rows, rev, byCat,
        planGfa, construction, etc, cost, prior, ratio, profit: rev - cost, memberPrice, right, charge, sup, A };
    },
  };
  // 기타 사업비를 항목으로 나눠 볼 때의 구성비(총지출 대비 %, 2026-11-13) — 검증사례 A구역 1건(검증사례/검증사례_A구역_파라미터.md).
  //  사례가 쌓이면 평균·범위로 바꿀 것. 합계로 나눠 기타 사업비 금액을 비율대로 나눔(참고 표시용, 계산 결과는 바꾸지 않음)
  JbsFeas.ETC_SPLIT = { src: '검증사례 A구역(인천 재건축) 구성비, 1건', items: [['토지비', 4.92], ['세금과공과', 4.08], ['금융비용(이자)', 3.01], ['설계·감리', 2.78], ['외주용역', 2.59], ['예비비', 1.90], ['기타 경비', 1.32], ['분양 경비', 0.43]] };
  JbsFeas.etcSplit = function (amount) { const it = JbsFeas.ETC_SPLIT.items, t = it.reduce((a, x) => a + x[1], 0); return it.map(([n, v]) => [n, amount * v / t]); };
  g.JbsFeas = JbsFeas;
  if (typeof module !== 'undefined' && module.exports) module.exports = JbsFeas;
})(typeof window !== 'undefined' ? window : globalThis);
