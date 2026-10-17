'use strict';

// 모든 금액은 '만원' 단위. 면적은 ㎡.
const Calc = {
  landTotal(s) {
    return s.lands.reduce((a, l) => a + num(l.area), 0);
  },

  siteArea(s) {
    const a = s.area;
    if (a.mode === 'manual') return num(a.manualArea);
    if (a.mode === 'lands') return this.landTotal(s);
    return num(a.drawnArea);
  },

  gfa(s) {
    if (num(s.plan.gfaManual) > 0) return num(s.plan.gfaManual);
    return this.siteArea(s) * num(s.plan.far) / 100 * num(s.plan.gfaFactor);
  },

  saleAmount(row, mul = 1) {
    return num(row.units) * (num(row.area) / PY) * num(row.price) * mul;
  },

  // m.general: 일반분양가 배율
  revenue(s, m = {}) {
    const byCat = Object.fromEntries(SALE_CATS.map(c => [c, 0]));
    let total = 0;
    for (const r of s.sales) {
      const amt = this.saleAmount(r, r.cat === '일반' ? (m.general ?? 1) : 1);
      byCat[r.cat] = (byCat[r.cat] || 0) + amt;
      total += amt;
    }
    return { total, byCat };
  },

  // m.construction: 공사비 배율
  costs(s, revenueTotal, m = {}) {
    const gfaPy = this.gfa(s) / PY;
    const cm = m.construction ?? 1;
    const items = s.costs.map(it => ({ ...it, amount: 0 }));

    // 1차: 직접 금액·평당 단가 항목
    for (const it of items) {
      const mul = it.group === '공사비' ? cm : 1;
      if (it.basis === 'fixed') it.amount = num(it.value) * mul;
      else if (it.basis === 'perGFA') it.amount = num(it.value) * gfaPy * mul;
    }
    const construction = items
      .filter(it => it.group === '공사비' && (it.basis === 'fixed' || it.basis === 'perGFA'))
      .reduce((a, it) => a + it.amount, 0);

    // 2차: 비율 항목
    for (const it of items) {
      if (it.basis === 'pctConstruction') it.amount = construction * num(it.value) / 100;
      else if (it.basis === 'pctRevenue') it.amount = revenueTotal * num(it.value) / 100;
    }
    const subtotal = items.filter(it => it.basis !== 'pctSubtotal').reduce((a, it) => a + it.amount, 0);
    for (const it of items) {
      if (it.basis === 'pctSubtotal') it.amount = subtotal * num(it.value) / 100;
    }

    const byGroup = Object.fromEntries(COST_GROUPS.map(g => [g, 0]));
    let total = 0;
    for (const it of items) {
      byGroup[it.group] = (byGroup[it.group] || 0) + it.amount;
      total += it.amount;
    }
    return { items, byGroup, total, construction };
  },

  // 공시지가 합계 (만원)
  officialLandValue(s) {
    return s.lands.reduce((a, l) => a + num(l.area) * num(l.price), 0) / 10000;
  },

  prior(s) {
    const p = s.prior;
    if (p.mode === 'manual') return num(p.manual);
    if (p.mode === 'members') return s.members.reduce((a, m) => a + num(m.prior), 0);
    return this.officialLandValue(s) * num(p.multiplier);
  },

  result(s, m = {}) {
    const rev = this.revenue(s, m);
    const cost = this.costs(s, rev.total, m);
    const prior = this.prior(s);
    // 분양수입을 아직 입력하지 않았으면 비례율을 계산하지 않음
    const ratio = prior > 0 && rev.total > 0 ? (rev.total - cost.total) / prior * 100 : NaN;
    return { rev, cost, prior, ratio, profit: rev.total - cost.total };
  },

  // 조합원 1인: 권리가액 = 종전자산 × 비례율, 분담금 = 조합원분양가 − 권리가액
  member(s, mem, ratio) {
    const right = num(mem.prior) * (isFinite(ratio) ? ratio : 0) / 100;
    const row = s.sales.find(r => r.cat === '조합원' && r.name === mem.want);
    const price = row ? (num(row.area) / PY) * num(row.price) : 0;
    return { right, price, charge: row ? price - right : NaN };
  },

  // ---------- 조서 분석 ----------
  isOld(s, b, year) {
    const y = num(b.year);
    if (!y) return false;
    const strong = b.structure === '철근콘크리트' || b.structure === '철골';
    return year - y >= (strong ? s.criteria.rcYears : s.criteria.otherYears);
  },

  survey(s) {
    const year = new Date().getFullYear();
    const bs = s.buildings;
    let old = 0, oldArea = 0, area = 0, detached = 0, apartment = 0, minAge = Infinity, aptMinAge = Infinity;
    for (const b of bs) {
      const isOld = this.isOld(s, b, year);
      const fa = num(b.floorArea);
      area += fa;
      if (isOld) { old++; oldArea += fa; }
      if (b.use === '단독주택' || b.use === '다가구주택') detached += 1;
      if (b.use === '다세대주택' || b.use === '연립주택' || b.use === '아파트') {
        apartment += num(b.units);
        if (num(b.year)) aptMinAge = Math.min(aptMinAge, year - num(b.year));
      }
      if (num(b.year)) minAge = Math.min(minAge, year - num(b.year));
    }
    const lands = s.lands;
    const landArea = this.landTotal(s);
    const publicArea = lands.filter(l => l.ownerType === '국공유지').reduce((a, l) => a + num(l.area), 0);
    const small = lands.filter(l => l.jimok === '대' && num(l.area) > 0 && num(l.area) < 90).length;
    const owners = new Set(lands.map(l => (l.owner || '').trim()).filter(Boolean)).size;
    return {
      year,
      count: bs.length, old, oldRatio: bs.length ? old / bs.length * 100 : NaN,
      area, oldArea, oldAreaRatio: area ? oldArea / area * 100 : NaN,
      detached, apartment,
      minAge: isFinite(minAge) ? minAge : NaN,
      aptMinAge: isFinite(aptMinAge) ? aptMinAge : NaN,
      landCount: lands.length, landArea, publicArea, small, owners,
    };
  },

  // 사업 유형별 요건 검토. pass: true/false/null(판단 불가·별도 확인)
  requirements(s, sv) {
    const c = s.criteria;
    const site = this.siteArea(s);
    const out = [];
    const has = sv.count > 0;
    if (s.meta.type === 'redevelopment') {
      out.push({ label: '노후·불량건축물 비율 (동수 기준)', value: fmtPct(sv.oldRatio), need: `${fmt(c.redev.oldRatio, 1)}% 이상`, pass: has ? sv.oldRatio >= c.redev.oldRatio : null });
      out.push({ label: '구역 면적', value: `${fmt(site)}㎡`, need: `${fmt(c.redev.minArea)}㎡ 이상`, pass: site > 0 ? site >= c.redev.minArea : null });
      out.push({ label: '노후·불량건축물 비율 (연면적 기준)', value: fmtPct(sv.oldAreaRatio), need: '참고 (조례에 따라 요건)', pass: null });
      out.push({ label: '과소필지 (90㎡ 미만 대지)', value: `${sv.small}필지`, need: '참고 (호수밀도·과소필지 등 선택 요건)', pass: null });
    } else if (s.meta.type === 'reconstruction') {
      out.push({ label: '공동주택 준공 후 경과연수 (가장 최근 동)', value: isFinite(sv.aptMinAge) ? `${sv.aptMinAge}년` : '–', need: `${c.recon.minYears}년 이상`, pass: isFinite(sv.aptMinAge) ? sv.aptMinAge >= c.recon.minYears : null });
      const okScale = sv.apartment >= c.recon.minUnits || site >= c.recon.minArea;
      out.push({ label: '규모 (세대수 또는 부지면적)', value: `${fmt(sv.apartment)}세대 / ${fmt(site)}㎡`, need: `${fmt(c.recon.minUnits)}세대 이상 또는 ${fmt(c.recon.minArea)}㎡ 이상`, pass: has || site > 0 ? okScale : null });
      out.push({ label: '재건축진단(구 안전진단) 통과', value: s.checks.safety ? '확인함' : '미확인', need: 'D·E등급 등', pass: s.checks.safety ? true : null, check: 'safety' });
    } else {
      const g = c.garo;
      out.push({ label: '가로구역 면적', value: `${fmt(site)}㎡`, need: `${fmt(g.maxArea)}㎡ 미만`, pass: site > 0 ? site < g.maxArea : null });
      out.push({ label: '노후·불량건축물 비율 (동수 기준)', value: fmtPct(sv.oldRatio), need: `${fmt(g.oldRatio, 1)}% 이상`, pass: has ? sv.oldRatio >= g.oldRatio : null });
      let need, pass;
      if (sv.detached && !sv.apartment) { need = `단독주택 ${g.minDetached}호 이상`; pass = sv.detached >= g.minDetached; }
      else if (!sv.detached && sv.apartment) { need = `공동주택 ${g.minApartment}세대 이상`; pass = sv.apartment >= g.minApartment; }
      else { need = `단독+공동 합계 ${g.minMixed}채 이상`; pass = sv.detached + sv.apartment >= g.minMixed; }
      out.push({ label: '기존 주택 수', value: `단독 ${sv.detached}호 · 공동 ${sv.apartment}세대`, need, pass: has ? pass : null });
      out.push({ label: '가로구역 해당 (도로로 둘러싸이고 폭 4m 초과 도로가 통과하지 않음)', value: s.checks.garoBlock ? '확인함' : '미확인', need: '현황 확인', pass: s.checks.garoBlock ? true : null, check: 'garoBlock' });
    }
    return out;
  },
};
