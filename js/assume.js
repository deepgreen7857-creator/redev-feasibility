'use strict';

// 사업성 가정값 대화창: 몇 가지 가정만 넣으면 분양수입·사업비 표를 채우고 비례율·분담금을 바로 보여줌
const Assume = {
  FIELDS: ['far', 'gfaFactor', 'resRatio', 'mix59', 'sup59', 'sup84', 'rentRatio', 'supRent', 'members',
    'generalPrice', 'memberRatio', 'memberPrice', 'rentPrice', 'shopPrice', 'conPrice', 'etcPct', 'comp', 'priorMul'],

  defaults() {
    const sv = Calc.survey(S);
    // 조합원 수 추정: 건축물의 호(전유부 호 수·세대수, 없으면 1) + 건물 없는 대지 필지
    const withBldg = new Set(S.buildings.map(b => b.pnu).filter(Boolean));
    const est = S.buildings.reduce((a, b) => a + (num(b.hoCount) || num(b.units) || 1), 0)
      + S.lands.filter(l => l.jimok === '대' && l.pnu && !withBldg.has(l.pnu)).length;
    return {
      far: num(S.plan.far) || 250, gfaFactor: num(S.plan.gfaFactor) || 1.45,
      resRatio: 97, mix59: 40, sup59: 82, sup84: 112, rentRatio: 15, supRent: 62,
      members: Math.max(est, sv.owners, S.members.length),
      generalPrice: 2500, memberRatio: 80, memberPrice: 2000,
      // 사업비 표에 세부 항목이 이미 있으면 기타 사업비는 0 (이중 계산 방지)
      rentPrice: 600, shopPrice: 2500, conPrice: 750, comp: 0,
      etcPct: S.costs.some(c => c.group !== '공사비' && c.name !== '기타 사업비 (가정값)' && num(c.value) > 0) ? 0 : 30,
      priorMul: num(S.prior.multiplier) || 1.4,
    };
  },

  values() {
    const v = {};
    this.FIELDS.forEach(k => { v[k] = num($('#as_' + k).value); });
    return v;
  },

  open() {
    const v = { ...this.defaults(), ...(S.assume || {}) };
    v.memberPrice = Math.round(v.generalPrice * v.memberRatio / 100);
    this.FIELDS.forEach(k => { $('#as_' + k).value = v[k]; });
    this.preview();
    $('#assumeDialog').showModal();
  },

  // 가정값 → 세대수·분양 행·사업비 행
  plan(s, v) {
    const site = Calc.siteArea(s);
    const farArea = site * v.far / 100;
    const resArea = farArea * v.resRatio / 100;
    const m59 = v.mix59 / 100, rent = v.rentRatio / 100;
    const avg = rent * v.supRent + (1 - rent) * (m59 * v.sup59 + (1 - m59) * v.sup84);
    const total = avg > 0 ? Math.floor(resArea / avg) : 0;
    const rentU = Math.round(total * rent), saleU = total - rentU;
    const u59 = Math.round(saleU * m59), u84 = saleU - u59;
    const mem59 = Math.min(u59, Math.round(v.members * m59)), mem84 = Math.min(u84, v.members - Math.round(v.members * m59));
    const memberPrice = v.generalPrice * v.memberRatio / 100;
    const sales = [
      sale('조합원', '59㎡', mem59, v.sup59, memberPrice),
      sale('조합원', '84㎡', mem84, v.sup84, memberPrice),
      sale('일반', '59㎡', u59 - mem59, v.sup59, v.generalPrice),
      sale('일반', '84㎡', u84 - mem84, v.sup84, v.generalPrice),
      sale('임대', '임대', rentU, v.supRent, v.rentPrice),
      sale('상가', '근린생활시설', 1, Math.round(farArea - resArea), v.shopPrice),
    ];
    return { site, farArea, total, rentU, u59, u84, mem59, mem84, memberPrice, sales, short: Math.max(0, v.members - mem59 - mem84) };
  },

  applyTo(s, v) {
    const p = this.plan(s, v);
    s.plan.far = v.far; s.plan.gfaFactor = v.gfaFactor; s.plan.gfaManual = 0;
    s.sales = p.sales;
    const setCost = (match, make, value) => {
      let row = s.costs.find(match);
      if (!row) { row = make(); s.costs.push(row); }
      row.value = value;
    };
    setCost(c => c.group === '공사비' && c.basis === 'perGFA', () => cost('공사비', '신축 공사비 (지상+지하)', 'perGFA', 0), v.conPrice);
    setCost(c => c.name === '기타 사업비 (가정값)', () => cost('관리비', '기타 사업비 (가정값)', 'pctConstruction', 0), v.etcPct);
    setCost(c => c.group === '보상비', () => cost('보상비', '현금청산·손실보상·주거이전비', 'fixed', 0), v.comp * 10000);
    s.prior.multiplier = v.priorMul;
    s.assume = { ...v };
    return p;
  },

  preview() {
    const v = this.values();
    const t = JSON.parse(JSON.stringify(S));
    const p = this.applyTo(t, v);
    const r = Calc.result(t);
    const avgPrior = v.members > 0 ? r.prior / v.members : 0;
    const right = isFinite(r.ratio) ? avgPrior * r.ratio / 100 : NaN;
    const charge = sup => p.memberPrice * sup / PY - right;
    const chargeTxt = sup => isFinite(right) ? `${charge(sup) >= 0 ? '' : '환급 '}${fmtEok(Math.abs(charge(sup)))}` : '–';
    const out = $('#assumeOut');
    if (!p.site) { out.innerHTML = '<p class="warn-box">구역 면적이 없습니다. 구역계를 먼저 정하거나 구역 면적을 직접 입력하세요.</p>'; return; }
    out.innerHTML = `
      <div class="as-grid">
        <div><span>용적률 연면적</span><b>${fmt(p.farArea)}㎡</b></div>
        <div><span>총 세대수</span><b>${fmt(p.total)}세대</b><em>59㎡ ${fmt(p.u59)} · 84㎡ ${fmt(p.u84)} · 임대 ${fmt(p.rentU)}</em></div>
        <div><span>조합원 / 일반분양</span><b>${fmt(p.mem59 + p.mem84)} / ${fmt(p.u59 + p.u84 - p.mem59 - p.mem84)}세대</b></div>
        <div><span>조합원 분양가</span><b>${fmt(p.memberPrice)}만원/평</b><em>일반분양가의 ${fmt(v.memberRatio, 1)}%</em></div>
        <div><span>총수입</span><b>${fmtEok(r.rev.total)}</b></div>
        <div><span>총사업비</span><b>${fmtEok(r.cost.total)}</b></div>
        <div><span>종전자산</span><b>${fmtEok(r.prior)}</b><em>${S.prior.mode === 'estimate' ? `공시지가 × ${v.priorMul}` : '조합원·직접 입력값 사용'}</em></div>
        <div class="big ${ratioClass(r.ratio)}"><span>비례율</span><b>${fmtPct(r.ratio)}</b></div>
        <div><span>평균 조합원 분담금 (59㎡)</span><b>${chargeTxt(v.sup59)}</b></div>
        <div><span>평균 조합원 분담금 (84㎡)</span><b>${chargeTxt(v.sup84)}</b><em>평균 권리가액 ${fmtEok(right)}</em></div>
      </div>
      ${p.short ? `<p class="warn-box">조합원 ${fmt(v.members)}명보다 분양 세대가 ${fmt(p.short)}세대 부족합니다. 용적률·평형 구성을 확인하세요.</p>` : ''}
      ${r.prior ? '' : '<p class="warn-box">종전자산이 0입니다. 토지조서(공시지가)를 먼저 채우면 비례율이 계산됩니다.</p>'}`;
  },

  apply() {
    this.applyTo(S, this.values());
    $('#assumeDialog').close();
    App.update(true);
    App.go('result');
  },

  bind() {
    const d = $('#assumeDialog');
    d.addEventListener('input', e => {
      const id = e.target.id;
      // 조합원 분양가 ↔ 비율 어느 쪽을 고쳐도 맞춤
      if (id === 'as_memberPrice') {
        const g = num($('#as_generalPrice').value);
        if (g > 0) $('#as_memberRatio').value = +(num(e.target.value) / g * 100).toFixed(1);
      } else if (id === 'as_memberRatio' || id === 'as_generalPrice') {
        $('#as_memberPrice').value = Math.round(num($('#as_generalPrice').value) * num($('#as_memberRatio').value) / 100);
      }
      this.preview();
    });
    $('#btnAssume').onclick = () => this.open();
    $('#assumeApply').onclick = () => this.apply();
    $('#assumeCancel').onclick = () => d.close();
    $('#assumeReset').onclick = () => {
      const v = this.defaults();
      this.FIELDS.forEach(k => { $('#as_' + k).value = v[k]; });
      this.preview();
    };
  },
};
