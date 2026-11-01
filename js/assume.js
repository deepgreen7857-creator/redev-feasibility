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
    // 시장 값은 공통 가정값(shared/feas.js — /urban 사업성 탭과 같은 값)
    const A = JbsFeas.get();
    const sp = t => JbsFeas.supply(t);
    return {
      far: num(S.plan.far) || 250, gfaFactor: A.gfaFactor,
      resRatio: A.resRatio, mix59: A.mix59 ?? 40, sup59: sp(59), sup84: sp(84), rentRatio: A.rentRatio, supRent: sp(49),
      members: Math.max(est, sv.owners, S.members.length),
      generalPrice: A.generalPrice, memberRatio: A.memberRatio, memberPrice: Math.round(A.generalPrice * A.memberRatio / 100),
      // 사업비 표에 세부 항목이 이미 있으면 기타 사업비는 0 (이중 계산 방지)
      rentPrice: A.rentPrice, shopPrice: A.shopPrice, conPrice: A.conPrice, comp: 0,
      etcPct: S.costs.some(c => c.group !== '공사비' && c.name !== '기타 사업비 (가정값)' && num(c.value) > 0) ? 0 : A.etcPct,
      priorMul: A.priorMul,
    };
  },

  values() {
    const v = {};
    this.FIELDS.forEach(k => { v[k] = num($('#as_' + k).value); });
    v.src = ($('#as_src') && $('#as_src').value) || '';
    return v;
  },

  open() {
    const v = { ...this.defaults(), ...(S.assume || {}) };
    v.memberPrice = Math.round(v.generalPrice * v.memberRatio / 100);
    this.FIELDS.forEach(k => { $('#as_' + k).value = v[k]; });
    this.fillSrc(v.src || '');
    this.preview();
    $('#assumeDialog').showModal();
  },

  // 가정값 → 세대수·분양 행·사업비 행
  // /arch(개략 건축계획)에서 확정한 배치안 목록 (같은 사이트 localStorage 'jbs.sites.v1')
  archList() {
    try { return (window.JbsSite ? JbsSite.list() : []).filter(x => x.arch && x.arch.chosen && x.arch.chosen.units > 0); } catch (e) { return []; }
  },
  archOf(id) {
    try { const x = id && window.JbsSite ? JbsSite.get(id) : null; return x && x.arch && x.arch.chosen && x.arch.chosen.units > 0 ? x : null; } catch (e) { return null; }
  },
  fillSrc(cur) {
    const sel = $('#as_src'); if (!sel) return;
    const list = this.archList();
    sel.innerHTML = '<option value="">용적률·평형 비율로 계산 (아래 가정값)</option>' + list.map(x => {
      const c = x.arch.chosen;
      return `<option value="${esc(x.id)}">/arch 확정안: ${esc(x.name || x.id)} · ${esc(c.label || '')} · ${fmt(c.units)}세대 (${esc(x.arch.at || '')})</option>`;
    }).join('');
    sel.value = list.some(x => x.id === cur) ? cur : '';
  },

  // /arch 확정안 → 분양 행. 임대는 작은 평형부터, 조합원은 분양 세대 비율대로 배분
  planArch(s, v, x) {
    const c = x.arch.chosen, site = Calc.siteArea(s);
    const types = Object.keys(c.byType || {}).filter(t => num(c.byType[t]) > 0).sort((a, b) => num(a) - num(b));
    const avgSup = num(c.gfa) && num(c.units) ? num(c.gfa) / num(c.units) : 0;
    const sup = t => num((c.supply || {})[t]) || avgSup;
    const total = types.reduce((n, t) => n + num(c.byType[t]), 0);
    let rentLeft = Math.round(total * v.rentRatio / 100);
    const rent = {}, sale_ = {}, mem = {};
    types.forEach(t => { const r = Math.min(rentLeft, num(c.byType[t])); rent[t] = r; rentLeft -= r; sale_[t] = num(c.byType[t]) - r; });
    const saleU = types.reduce((n, t) => n + sale_[t], 0);
    const memWant = Math.min(Math.max(0, Math.round(v.members)), saleU);
    let given = 0;
    types.forEach(t => { mem[t] = saleU ? Math.floor(memWant * sale_[t] / saleU) : 0; given += mem[t]; });
    for (const t of types.slice().sort((a, b) => sale_[b] - sale_[a])) { if (given >= memWant) break; if (mem[t] < sale_[t]) { mem[t]++; given++; } }
    const memberPrice = v.generalPrice * v.memberRatio / 100;
    const resArea = num(c.gfa);
    const farArea = v.resRatio > 0 && v.resRatio < 100 ? resArea * 100 / v.resRatio : resArea;
    const sales = [];
    types.forEach(t => { if (mem[t]) sales.push(sale('조합원', t + '㎡', mem[t], sup(t), memberPrice)); });
    types.forEach(t => { if (sale_[t] - mem[t]) sales.push(sale('일반', t + '㎡', sale_[t] - mem[t], sup(t), v.generalPrice)); });
    types.forEach(t => { if (rent[t]) sales.push(sale('임대', '임대 ' + t + '㎡', rent[t], sup(t), v.rentPrice)); });
    if (farArea - resArea > 1) sales.push(sale('상가', '근린생활시설', 1, Math.round(farArea - resArea), v.shopPrice));
    const rentU = types.reduce((n, t) => n + rent[t], 0);
    return { site, farArea, total, rentU, types, byType: c.byType, sup, mem, saleBy: sale_, rentBy: rent, memberPrice, sales,
      memTotal: given, short: Math.max(0, Math.round(v.members) - given), arch: x };
  },

  plan(s, v) {
    if (v.src) { const x = this.archOf(v.src); if (x) return this.planArch(s, v, x); }
    const site = Calc.siteArea(s);
    const farArea = Calc.netSite(s) * v.far / 100;   // 기반시설을 뺀 건축 대지 기준
    // 세대수·분양 행은 공통 계산(shared/feas.js) — /urban 사업성 탭과 같은 식·같은 평형 비율
    const A0 = JbsFeas.get();
    const A = { ...A0, rentRatio: v.rentRatio, resRatio: v.resRatio, generalPrice: v.generalPrice, memberRatio: v.memberRatio, rentPrice: v.rentPrice, shopPrice: v.shopPrice };
    const m114 = v.mix114 ?? A0.mix114, mix = { 59: v.mix59, 84: Math.max(0, 100 - v.mix59 - m114), 114: m114 };
    const k84 = v.sup84 / JbsFeas.supply(84) || 1;
    const supOv = { 59: v.sup59, 84: v.sup84, 114: JbsFeas.supply(114) * k84, 49: v.supRent };
    const U = JbsFeas.units(farArea, A, mix, supOv);
    const M = JbsFeas.money({ sale: U.sale, rental: U.rental, rentSupply: U.rentSupply, supply: U.supply, members: v.members, farArea, resArea: U.resArea, prior: 0 }, A);
    const memberPrice = M.memberPrice;
    const sales = M.rows.map(r => sale(r.cat, r.cat === '상가' ? '근린생활시설' : r.cat === '임대' ? '임대' : r.t + '㎡', r.units, r.cat === '상가' ? Math.round(r.area) : r.area, r.price));
    const u = t => U.sale[t] || 0, mm = t => M.mem[t] || 0;
    return { site, farArea, total: U.total, rentU: U.rental, u59: u(59), u84: u(84), u114: u(114), mem59: mm(59), mem84: mm(84), mem114: mm(114), memTotal: M.memTotal,
      types: M.types, saleBy: U.sale, memBy: M.mem, memberPrice, sales, short: M.short };
  },

  applyTo(s, v) {
    const p = this.plan(s, v);
    if (p.arch) {
      // 공사비 기준 계획연면적 = /arch 지상 연면적(주거) ÷ 주거비율 × 계획연면적 배율(지하·공용 포함)
      s.plan.far = Math.round(num(p.arch.arch.chosen.far) * 10) / 10; s.plan.gfaFactor = v.gfaFactor;
      s.plan.gfaManual = Math.round(p.farArea * v.gfaFactor);
    } else { s.plan.far = v.far; s.plan.gfaFactor = v.gfaFactor; s.plan.gfaManual = 0; }
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
    s.assumeSource = p.arch ? { siteId: p.arch.id, name: p.arch.name || '', label: p.arch.arch.chosen.label || '', at: p.arch.arch.at || '', units: p.total } : null;
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
    const info = $('#as_archInfo');
    if (info) {
      info.hidden = !p.arch;
      if (p.arch) {
        const c = p.arch.arch.chosen;
        info.innerHTML = `<b>/arch 확정안 기준</b>: ${esc(c.label || '')} · ${fmt(c.units)}세대 · 용적률 ${fmt(c.far, 1)}% · 지상 연면적 ${fmt(c.gfa)}㎡ — ${p.types.map(t => `${t}㎡ ${fmt(p.byType[t])}세대(공급 ${fmt(p.sup(t), 1)}㎡)`).join(' · ')}. 이 기준에서는 아래 용적률·평형 비율·공급면적 입력은 쓰지 않습니다.`;
      }
    }
    ['far', 'mix59', 'sup59', 'sup84', 'supRent'].forEach(k => { const e = $('#as_' + k); if (e) e.disabled = !!p.arch; });
    if (p.arch) {
      if (!p.site) { out.innerHTML = '<p class="warn-box">구역 면적이 없습니다. 구역계를 먼저 정하거나 구역 면적을 직접 입력하세요.</p>'; return; }
      const chargeA = t => isFinite(right) ? (() => { const c2 = p.memberPrice * p.sup(t) / PY - right; return `${c2 >= 0 ? '' : '환급 '}${fmtEok(Math.abs(c2))}`; })() : '–';
      out.innerHTML = `
      <div class="as-grid">
        <div><span>용적률 연면적</span><b>${fmt(p.farArea)}㎡</b><em>/arch 지상 연면적 기준</em></div>
        <div><span>총 세대수</span><b>${fmt(p.total)}세대</b><em>${p.types.map(t => `${t}㎡ ${fmt(p.byType[t])}`).join(' · ')} (임대 ${fmt(p.rentU)} 포함)</em></div>
        <div><span>조합원 / 일반분양</span><b>${fmt(p.memTotal)} / ${fmt(p.total - p.rentU - p.memTotal)}세대</b></div>
        <div><span>조합원 분양가</span><b>${fmt(p.memberPrice)}만원/평</b><em>일반분양가의 ${fmt(v.memberRatio, 1)}%</em></div>
        <div><span>총수입</span><b>${fmtEok(r.rev.total)}</b></div>
        <div><span>총사업비</span><b>${fmtEok(r.cost.total)}</b></div>
        <div><span>종전자산</span><b>${fmtEok(r.prior)}</b><em>${S.prior.mode === 'estimate' ? `공시지가 × ${v.priorMul}` : '조합원·직접 입력값 사용'}</em></div>
        <div class="big ${ratioClass(r.ratio)}"><span>비례율</span><b>${fmtPct(r.ratio)}</b></div>
        ${p.types.map(t => `<div><span>평균 조합원 분담금 (${t}㎡)</span><b>${chargeA(t)}</b></div>`).join('')}
        <div><span>평균 권리가액</span><b>${fmtEok(right)}</b></div>
      </div>
      ${p.short ? `<p class="warn-box">조합원 ${fmt(v.members)}명보다 분양 세대가 ${fmt(p.short)}세대 부족합니다. /arch에서 용적률·평형 구성을 조정해 보세요.</p>` : ''}
      ${r.prior ? '' : '<p class="warn-box">종전자산이 0입니다. 토지조서(공시지가)를 먼저 채우면 비례율이 계산됩니다.</p>'}`;
      return;
    }
    if (!p.site) { out.innerHTML = '<p class="warn-box">구역 면적이 없습니다. 구역계를 먼저 정하거나 구역 면적을 직접 입력하세요.</p>'; return; }
    out.innerHTML = `
      <div class="as-grid">
        <div><span>용적률 연면적</span><b>${fmt(p.farArea)}㎡</b></div>
        <div><span>총 세대수</span><b>${fmt(p.total)}세대</b><em>59㎡ ${fmt(p.u59)} · 84㎡ ${fmt(p.u84)}${p.u114 ? ` · 114㎡ ${fmt(p.u114)}` : ''} · 임대 ${fmt(p.rentU)}</em></div>
        <div><span>조합원 / 일반분양</span><b>${fmt(p.memTotal ?? (p.mem59 + p.mem84))} / ${fmt(p.total - p.rentU - (p.memTotal ?? (p.mem59 + p.mem84)))}세대</b></div>
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
    const v0 = this.values();
    if (window.JbsFeas) JbsFeas.set({ mix59: v0.mix59, generalPrice: v0.generalPrice, memberRatio: v0.memberRatio, rentPrice: v0.rentPrice, shopPrice: v0.shopPrice, conPrice: v0.conPrice, gfaFactor: v0.gfaFactor, priorMul: v0.priorMul, rentRatio: v0.rentRatio, resRatio: v0.resRatio, ...(v0.etcPct > 0 ? { etcPct: v0.etcPct } : {}) });
    this.applyTo(S, v0);
    $('#assumeDialog').close();
    App.update(true);
    App.go('result');
  },

  bind() {
    const d = $('#assumeDialog');
    d.addEventListener('change', e => { if (e.target.id === 'as_src') this.preview(); });
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
      this.fillSrc('');
      this.preview();
    };
  },
};
