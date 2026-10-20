'use strict';

// 모든 금액은 '만원' 단위. 면적은 ㎡.
const Calc = {
  landTotal(s) {
    return s.lands.reduce((a, l) => a + num(l.area), 0);
  },

  siteArea(s) {
    const a = s.area;
    if (a.mode === 'manual') return num(a.manualArea);
    // ledger: 토지조서 면적(토지대장 × 편입비율) 합계. 조서가 아직 없으면 그린 구역 면적
    if (a.mode === 'ledger' || a.mode === 'lands') { const t = this.landTotal(s); return t > 0 ? t : num(a.drawnArea); }
    return num(a.drawnArea);
  },

  // 정비기반시설(도로·공원·구거·하천·제방·철도·수도) 지목. 한 글자 부호와 전체 이름 모두
  INFRA_JIMOK: ['도', '공', '구', '천', '제', '철', '수', '도로', '공원', '구거', '하천', '제방', '철도용지', '수도용지'],
  isInfra(jimok) { return this.INFRA_JIMOK.includes(String(jimok || '').trim()); },

  // 정비기반시설 면적과 근거. auto: 토지조서 지목 합계(토지조서가 비면 구역면적 × infraRatio%)
  infra(s) {
    const p = s.plan, site = this.siteArea(s);
    const ratio = num(p.infraRatio);
    const byRatio = basis => ({ area: site * ratio / 100, basis });
    if (p.infraMode === 'area') return { area: Math.min(num(p.infraArea), site), basis: '직접 입력' };
    if (p.infraMode === 'ratio') return byRatio(`구역면적의 ${fmt(ratio, 1)}%`);
    if (!s.lands.length) return { ...byRatio(`토지조서가 없어 구역면적의 ${fmt(ratio, 1)}%로 계산`), fallback: true };
    const ls = s.lands.filter(l => this.isInfra(l.jimok));
    const sum = ls.reduce((a, l) => a + num(l.area), 0);
    return { area: Math.min(sum, site), count: ls.length, basis: `토지조서 지목 도로 등 ${ls.length}필지 합계` };
  },
  infraArea(s) { return this.infra(s).area; },

  // 건축 대지(획지)면적 = 구역면적 − 정비기반시설
  netSite(s) { return Math.max(0, this.siteArea(s) - this.infraArea(s)); },

  // 계획 연면적: 구역면적이 아니라 건축 대지면적에 용적률을 곱함 (요건 판정은 그대로 구역면적)
  gfa(s) {
    if (num(s.plan.gfaManual) > 0) return num(s.plan.gfaManual);
    return this.netSite(s) * num(s.plan.far) / 100 * num(s.plan.gfaFactor);
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
  // 노후도 판단 기준일 (비어 있으면 오늘)
  baseDate(s) {
    const d = s.criteria.baseDate;
    const t = d ? new Date(d + 'T00:00:00') : new Date();
    if (isNaN(t)) return new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  },

  limitYears(s, b) {
    const c = s.criteria;
    const detached = b.use === '단독주택' || b.use === '다가구주택';
    const apt = ['아파트', '연립주택', '다세대주택'].includes(b.use);
    let strong = (b.structure === '철근콘크리트' || b.structure === '철골') && !(detached && c.detachedOther);
    // 인천: 주거용 지하층(반지하 세대 등)이 있는 철근콘크리트 공동주택은 20년
    if (strong && apt && c.basementRes20 && b.resBasement) strong = false;
    return strong ? c.rcYears : c.otherYears;
  },

  // 호수밀도(동/1만㎡): 공동주택은 세대수가 가장 많은 층의 세대 수, 비주거는 건축면적 90㎡당 1동(소수점 절사), 그 외 1동
  density(s, buildings) {
    const site = this.siteArea(s);
    if (!site || !buildings.length) return { value: NaN, exact: false };
    let dong = 0, approx = 0;
    for (const b of buildings) {
      const apt = ['아파트', '연립주택', '다세대주택'].includes(b.use);
      if (apt) {
        if (num(b.maxPerFloor)) dong += num(b.maxPerFloor);
        else { dong += 1; approx++; }        // 전유부가 없으면 1동으로 (과소 계산)
      } else if (b.use === '근린생활시설' || b.use === '기타') {
        if (num(b.archArea)) dong += Math.floor(num(b.archArea) / 90);
        else { dong += 1; approx++; }
      } else dong += 1;                       // 단독·다가구
    }
    return { value: dong / (site / 10000), dong, exact: approx === 0, approx };
  },

  aprParts(b) {
    const m = String(b.aprDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    return m ? [+m[1], +m[2], +m[3]] : null;
  },

  // 노후가 되는 날 = 사용승인일 + 기준 연수. 사용승인일이 없고 연도만 있으면 그해 1월 1일로 가정
  oldDate(s, b) {
    const n = this.limitYears(s, b), p = this.aprParts(b);
    if (p) return new Date(p[0] + n, p[1] - 1, p[2]);
    const y = num(b.year);
    return y ? new Date(y + n, 0, 1) : null;
  },

  isOld(s, b) {
    const d = this.oldDate(s, b);
    return !!d && d <= this.baseDate(s);
  },

  // 기준일 현재 만 경과연수
  age(s, b) {
    const base = this.baseDate(s), p = this.aprParts(b);
    if (p) {
      let a = base.getFullYear() - p[0];
      const bm = base.getMonth() + 1, bd = base.getDate();
      if (bm < p[1] || (bm === p[1] && bd < p[2])) a--;
      return a;
    }
    const y = num(b.year);
    return y ? base.getFullYear() - y : NaN;
  },

  // 노후도 요건 기준(%): 재개발·가로주택만
  oldRequirement(s) {
    if (s.meta.type === 'redevelopment') return s.criteria.redev.oldRatio;
    if (s.meta.type === 'garo') return s.criteria.garo.oldRatio;
    return NaN;
  },

  survey(s) {
    const base = this.baseDate(s);
    const year = base.getFullYear();
    // 기준일에 아직 사용승인 전인 건물은 그때 없던 건물이므로 제외
    const bs = s.buildings.filter(b => {
      const p = this.aprParts(b);
      if (p) return new Date(p[0], p[1] - 1, p[2]) <= base;
      return !num(b.year) || num(b.year) <= year;
    });
    let old = 0, oldArea = 0, area = 0, detached = 0, apartment = 0, minAge = Infinity, aptMinAge = Infinity, unknown = 0;
    const future = [];          // 아직 노후가 아닌 건물이 노후가 되는 날
    for (const b of bs) {
      if (!num(b.year)) unknown++;
      const isOld = this.isOld(s, b);
      const fa = num(b.floorArea);
      area += fa;
      if (isOld) { old++; oldArea += fa; }
      else { const od = this.oldDate(s, b); if (od) future.push(od); }
      const age = this.age(s, b);
      if (b.use === '단독주택' || b.use === '다가구주택') detached += 1;
      if (b.use === '다세대주택' || b.use === '연립주택' || b.use === '아파트') {
        apartment += num(b.units);
        if (isFinite(age)) aptMinAge = Math.min(aptMinAge, age);
      }
      if (isFinite(age)) minAge = Math.min(minAge, age);
    }
    future.sort((a, b) => a - b);
    const addYears = n => new Date(base.getFullYear() + n, base.getMonth(), base.getDate());
    const soon1 = future.filter(d => d <= addYears(1)).length;
    const soon3 = future.filter(d => d <= addYears(3)).length;
    // 노후도 요건을 채우는 날 (지금 그대로 시간이 흐른다고 볼 때)
    const req = this.oldRequirement(s);
    let reachDate = null, needMore = 0;
    if (isFinite(req) && bs.length) {
      needMore = Math.max(0, Math.ceil(req / 100 * bs.length - 1e-9) - old);
      if (needMore > 0 && future.length >= needMore) reachDate = future[needMore - 1];
    }
    const lands = s.lands;
    const landArea = this.landTotal(s);
    const publicArea = lands.filter(l => l.ownerType === '국공유지').reduce((a, l) => a + num(l.area), 0);
    const lot = num(s.criteria.smallLot) || 90;
    const small = lands.filter(l => l.jimok === '대' && num(l.area) > 0 && num(l.area) < lot).length;
    const owners = new Set(lands.map(l => (l.owner || '').trim()).filter(Boolean)).size;
    const dens = this.density(s, bs);
    return {
      year, base, soon1, soon3, req, needMore, reachDate, density: dens,
      count: bs.length, old, unknown, oldRatio: bs.length ? old / bs.length * 100 : NaN,
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
      const o = c.redev.opt || { road: 40, small: 40, density: 60, oldArea: 60 };
      const rl = (REGION_PRESETS[c.region] || {}).label || '조례';
      out.push({ label: '노후·불량건축물 비율 (동수 기준)', value: fmtPct(sv.oldRatio), need: `${fmt(c.redev.oldRatio, 1)}% 이상 (재정비촉진지구 50%)`, pass: has ? sv.oldRatio >= c.redev.oldRatio : null });
      out.push({ label: '구역 면적', value: `${fmt(site)}㎡`, need: `${fmt(c.redev.minArea)}㎡ 이상`, pass: site > 0 ? site >= c.redev.minArea : null });
      // 선택 요건: 아래 중 하나 이상 (주택접도율은 도로 폭 자료가 없어 자동 판단 불가)
      const smallRatio = sv.landCount ? sv.small / sv.landCount * 100 : NaN;
      const d = sv.density;
      out.push({ label: `[선택] 노후·불량건축물 연면적 비율 (${rl})`, value: fmtPct(sv.oldAreaRatio), need: `${o.oldArea}% 이상`, pass: isFinite(sv.oldAreaRatio) ? sv.oldAreaRatio >= o.oldArea : null });
      out.push({ label: `[선택] 과소필지 비율 (${fmt(c.smallLot || 90)}㎡ 미만 대지)`, value: `${sv.small}필지 (${fmtPct(smallRatio)})`, need: `${o.small}% 이상`, pass: isFinite(smallRatio) ? smallRatio >= o.small : null });
      out.push({
        label: '[선택] 호수밀도 (동/1만㎡)',
        value: isFinite(d.value) ? `${fmt(d.value, 1)} (${fmt(d.dong)}동)${d.exact ? '' : ` · 추정 – 전유부·건축면적 없는 ${d.approx}동은 1동으로 셈`}` : '–',
        need: `${o.density} 이상`, pass: isFinite(d.value) ? d.value >= o.density : null,
      });
      out.push({ label: '[선택] 주택접도율', value: '현장·도면 확인', need: `${o.road}% 이하 (폭 4m 이상 도로에 4m 이상 접한 건축물 비율)`, pass: null });
    } else if (s.meta.type === 'reconstruction') {
      out.push({ label: '공동주택 준공 후 경과연수 (가장 최근 동)', value: isFinite(sv.aptMinAge) ? `${sv.aptMinAge}년` : '–', need: `${c.recon.minYears}년 이상`, pass: isFinite(sv.aptMinAge) ? sv.aptMinAge >= c.recon.minYears : null });
      const okScale = sv.apartment >= c.recon.minUnits || site >= c.recon.minArea;
      out.push({ label: '규모 (세대수 또는 부지면적)', value: `${fmt(sv.apartment)}세대 / ${fmt(site)}㎡`, need: `${fmt(c.recon.minUnits)}세대 이상 또는 ${fmt(c.recon.minArea)}㎡ 이상`, pass: has || site > 0 ? okScale : null });
      out.push({ label: '재건축진단(구 안전진단) 통과', value: s.checks.safety ? '확인함' : '미확인', need: '2025.6.4.부터 사업시행계획인가 전까지 통과하면 됨', pass: s.checks.safety ? true : null, check: 'safety' });
    } else {
      const g = c.garo;
      out.push({ label: '가로구역 면적', value: `${fmt(site)}㎡`, need: `${fmt(g.maxArea)}㎡ 미만 (조례 1만3천㎡, 심의 시 2만㎡, 관리지역 4만㎡ 미만 특례)`, pass: site > 0 ? site < g.maxArea : null });
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
