'use strict';

// 사업성 가정값 대화창: 몇 가지 가정만 넣으면 분양수입·사업비 표를 채우고 비례율·분담금을 바로 보여줌
const Assume = {
  FIELDS: ['far', 'gfaFactor', 'resRatio', 'mix59', 'sup59', 'sup84', 'rentRatio', 'supRent', 'members',
    'generalPrice', 'memberRatio', 'memberPrice', 'rentPrice', 'shopPrice', 'conPrice', 'etcPct', 'comp', 'priorMul'],

  defaults() {
    const sv = Calc.survey(S);
    // 조합원 수 추정: 건축물의 호(전유부 호 수·세대수, 없으면 1) + 건물 없는 대지 필지
    const withBldg = new Set(S.buildings.map(b => b.pnu).filter(Boolean));
    // 공동주택은 대장 세대수와 전유부 호수 중 큰 값(전유부가 덜 받혔을 때 대비), 그 밖은 호수 → 세대수 → 1
    const est = S.buildings.reduce((a, b) => a + (Math.max(num(b.hoCount), num(b.units)) || 1), 0)
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
    v.stage = v.src ? num(($('#as_stage') || {}).value) : 0;
    v.gfaBasis = v.src ? (($('#as_gfaBasis') || {}).value || 'factor') : 'factor';
    return v;
  },

  // pre: { src, stage } — 주소의 ?arch=<site id>로 열 때 그 확정안을 세대수 기준으로 미리 고름
  open(pre) {
    const v = { ...this.defaults(), ...(S.assume || {}), ...(pre || {}) };
    v.memberPrice = Math.round(v.generalPrice * v.memberRatio / 100);
    this.FIELDS.forEach(k => { $('#as_' + k).value = v[k]; });
    this.fillSrc(v.src || '', v.stage, v.gfaBasis);
    this.preview();
    $('#assumeDialog').showModal();
  },
  // 주소에 ?arch=<site id>가 있으면 그 구역의 /arch 확정안으로 가정값 창을 바로 엶(기본은 마지막 단계 — 2차가 있으면 2차)
  openFromUrl() {
    let id = ''; try { id = new URLSearchParams(location.search).get('arch') || ''; } catch (e) { id = ''; }
    if (!id) return;
    const x = this.archOf(id);
    if (!x) { alert('주소의 /arch 확정안을 이 브라우저에서 찾지 못했습니다. /arch에서 다시 확정해 보세요.'); return; }
    this.loadSiteZone(x).finally(() => this.open({ src: id, stage: this.defStage(x) }));
  },
  // 비례율에는 구역 면적·종전자산(토지조서)이 필요 — 사업성 화면에 구역이 없거나 /arch 구역과 많이 다르면 가져올지 물음
  async loadSiteZone(x) {
    if (!x.geojson || !window.turf || typeof MapView === 'undefined') return;
    const siteA = turf.area(x.geojson);
    let ov = 0;
    if (S.area.geojson) { try { const i = turf.intersect(turf.feature(S.area.geojson.geometry || S.area.geojson), turf.feature(x.geojson.geometry || x.geojson)); ov = i ? turf.area(i) / Math.max(siteA, turf.area(S.area.geojson)) : 0; } catch (e) { ov = 0; } }
    if (S.area.geojson && ov >= 0.9) return;   // 같은 구역(90% 이상 겹침)이면 그대로
    const ask = S.area.geojson
      ? `사업성 화면의 구역이 /arch 구역 '${x.name || x.id}'(${fmt(siteA)}㎡)과 다릅니다(겹침 ${fmt(ov * 100)}%).\n/arch 구역으로 바꾸고 필지·토지조서를 다시 불러올까요?\n(취소하면 지금 구역으로 계산합니다)`
      : `사업성 화면에 구역이 없어 비례율(종전자산)을 계산할 수 없습니다.\n/arch 구역 '${x.name || x.id}'(${fmt(siteA)}㎡)을 가져와 필지·토지조서까지 불러올까요?\n(브이월드 조회에 1~2분 걸릴 수 있습니다)`;
    if (!confirm(ask)) return;
    App.go('area');
    await new Promise(r => setTimeout(r, 300));   // 지도가 그려진 뒤
    await MapView.zoneFromTool('s:' + x.id, true);   // 이미 물었으므로 다시 묻지 않음
    App.update(true);
  },

  // 가정값 → 세대수·분양 행·사업비 행
  // /arch(개략 건축계획)에서 확정한 배치안 목록 (같은 사이트 localStorage 'jbs.sites.v1')
  archList() {
    try { return (window.JbsSite ? JbsSite.list() : []).filter(x => x.arch && x.arch.chosen && x.arch.chosen.units > 0); } catch (e) { return []; }
  },
  archOf(id) {
    try { const x = id && window.JbsSite ? JbsSite.get(id) : null; return x && x.arch && x.arch.chosen && x.arch.chosen.units > 0 ? x : null; } catch (e) { return null; }
  },
  fillSrc(cur, stage, gfaBasis) {
    const sel = $('#as_src'); if (!sel) return;
    const list = this.archList();
    sel.innerHTML = '<option value="">용적률·평형 비율로 계산 (아래 가정값)</option>' + list.map(x => {
      const c = x.arch.chosen;
      return `<option value="${esc(x.id)}">/arch 확정안: ${esc(x.name || x.id)} · ${esc(c.label || '')} · ${fmt(c.units)}세대 (${esc(x.arch.at || '')})</option>`;
    }).join('');
    sel.value = list.some(x => x.id === cur) ? cur : '';
    this.syncStage(stage, gfaBasis);
  },
  // /arch 단계: stages[1] 1차 개략(초기 사업성), stages[2] 2차(교통·환경 반영). 예전 저장안(stage·stages 없음)은 1차로 봄
  STAGE_LABEL: { 1: '1차 개략 (초기 사업성)', 2: '2차 (교통·환경 반영)' },
  stagesOf(x) {
    const a = (x && x.arch) || {}, st = {};
    [1, 2].forEach(k => { const c = (a.stages || {})[k]; if (c && c.units > 0) st[k] = c; });
    if (!Object.keys(st).length && a.chosen) st[num(a.chosen.stage) || 1] = a.chosen;
    return st;
  },
  defStage(x) { const st = this.stagesOf(x); return st[2] ? 2 : st[1] ? 1 : 0; },
  chosenOf(x, stage) { const st = this.stagesOf(x); return st[stage] || st[this.defStage(x)] || x.arch.chosen; },
  syncStage(stage, gfaBasis) {
    const x = this.archOf(($('#as_src') || {}).value), wrap = $('#as_stageWrap'), ss = $('#as_stage'), gw = $('#as_gfaBasisWrap'), gb = $('#as_gfaBasis');
    if (!wrap || !ss) return;
    if (!x) { wrap.hidden = true; if (gw) gw.hidden = true; return; }
    const st = this.stagesOf(x), ks = Object.keys(st).map(Number);
    ss.innerHTML = ks.map(k => `<option value="${k}">${this.STAGE_LABEL[k]} · ${fmt(st[k].units)}세대${st[k].at ? ` (${esc(st[k].at)})` : ''}</option>`).join('');
    const want = num(stage) || num(ss.value);
    ss.value = String(st[want] ? want : this.defStage(x));
    ss.disabled = ks.length < 2;
    wrap.hidden = false;
    // 공사비 연면적: /arch가 총 연면적(지상+지하주차장+주민공동시설+관리사무소)을 낸 안이면 고를 수 있음
    const c = st[num(ss.value)] || {};
    if (gw && gb) { const has = num((c.ex || {}).totalGfa) > 0; gw.hidden = !has; if (gfaBasis) gb.value = gfaBasis; if (!has) gb.value = 'factor'; }
  },

  // /arch 확정안 → 분양 행. 임대는 작은 평형부터, 조합원은 분양 세대 비율대로 배분
  planArch(s, v, x) {
    const c = this.chosenOf(x, v.stage), site = Calc.siteArea(s);
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
      memTotal: given, short: Math.max(0, Math.round(v.members) - given), arch: x, chosen: c, stage: num(c.stage) || (Object.entries(this.stagesOf(x)).find(([, cc]) => cc === c) || [1])[0] * 1 };
  },

  plan(s, v) {
    if (v.src) { const x = this.archOf(v.src); if (x) return this.planArch(s, v, x); }
    const site = Calc.siteArea(s);
    const farArea = Calc.netSite(s) * v.far / 100;   // 기반시설을 뺀 건축 대지 기준
    // 세대수·분양 행은 공통 계산(shared/feas.js) — /urban 사업성 탭과 같은 식·같은 평형 비율
    const A0 = JbsFeas.get();
    const A = { ...A0, rentRatio: v.rentRatio, resRatio: v.resRatio, generalPrice: v.generalPrice, memberRatio: v.memberRatio, rentPrice: v.rentPrice, shopPrice: v.shopPrice };
    // /urban에서 고른 다른 평형(39·49·74·101㎡형 등)이 있으면 그대로 넣고, 84㎡형이 나머지를 채움
    const m114 = v.mix114 ?? A0.mix114, mix = { ...JbsFeas.mixOf(A0), 59: v.mix59, 114: m114 };
    mix[84] = Math.max(0, 100 - Object.keys(mix).filter(t => t !== '84').reduce((s, t) => s + (+mix[t] || 0), 0));
    const k84 = v.sup84 / JbsFeas.supply(84) || 1;
    const supOv = { 59: v.sup59, 84: v.sup84, 114: JbsFeas.supply(114) * k84, 49: v.supRent };
    const U = JbsFeas.units(farArea, A, mix, supOv);
    // 임대 부속토지 감정단가(만원/㎡) = 공시지가 합 × 보정배율 ÷ 사유지 면적(토지조서 없으면 평균 공시지가 × 배율)
    const privA = s.lands.filter(l => !Calc.isInfra(l.jimok)).reduce((a, l) => a + num(l.area), 0);
    const off = Calc.officialLandValue(s);
    const landUnit = off > 0 && privA > 0 ? off * v.priorMul / privA : num(A0.avgLand) * v.priorMul;
    const M = JbsFeas.money({ sale: U.sale, rental: U.rental, rentSupply: U.rentSupply, supply: U.supply, members: v.members, farArea, resArea: U.resArea, prior: 0, lotArea: Calc.netSite(s), landUnit }, A);
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
      //  '개략 건축계획 기준'을 고르면 /arch 총 연면적(지상 + 지하주차장 + 주민공동시설 + 관리사무소)을 그대로 씀
      const tg = num((p.chosen.ex || {}).totalGfa);
      s.plan.far = Math.round(num(p.chosen.far) * 10) / 10; s.plan.gfaFactor = v.gfaFactor;
      s.plan.gfaManual = v.gfaBasis === 'arch' && tg > 0 ? Math.round(tg) : Math.round(p.farArea * v.gfaFactor);
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
    s.assumeSource = p.arch ? { siteId: p.arch.id, name: p.arch.name || '', label: p.chosen.label || '', at: p.chosen.at || p.arch.arch.at || '', units: p.total, stage: p.stage, stageName: this.STAGE_LABEL[p.stage] || '', gfaBasis: v.gfaBasis } : null;
    return p;
  },

  // /arch 1차·2차가 모두 있으면 같은 가정값으로 둘을 계산해 비례율·총수입·총사업비를 나란히 보여 줌
  stageCompare(v, p) {
    const box = $('#as_stageCmp'); if (!box) return;
    const st = p.arch ? this.stagesOf(p.arch) : {};
    if (!st[1] || !st[2]) { box.hidden = true; box.innerHTML = ''; return; }
    const run = k => { const t = JSON.parse(JSON.stringify(S)), q = this.applyTo(t, { ...v, stage: k }); return { q, r: Calc.result(t) }; };
    const a = run(1), b = run(2);
    const d = (x, y, f) => isFinite(x) && isFinite(y) ? `${y - x >= 0 ? '+' : '−'}${f(Math.abs(y - x))}` : '–';
    const row = (name, f, g) => `<tr><td>${name}</td><td>${f(a)}</td><td>${f(b)}</td><td>${g ? g(a, b) : ''}</td></tr>`;
    box.hidden = false;
    box.innerHTML = `<table class="grid" style="margin:8px 0"><caption style="text-align:left;font-weight:600;padding:4px 0">1차 · 2차 건축계획 사업성 비교 (같은 가정값)</caption>
      <tr><th>항목</th><th>${this.STAGE_LABEL[1]}</th><th>${this.STAGE_LABEL[2]}</th><th>증감</th></tr>
      ${row('세대수', x => `${fmt(x.q.total)}세대`, (x, y) => d(x.q.total, y.q.total, n => fmt(n)))}
      ${row('비례율', x => fmtPct(x.r.ratio), (x, y) => d(x.r.ratio, y.r.ratio, n => `${fmt(n, 1)}%p`))}
      ${row('총수입', x => fmtEok(x.r.rev.total), (x, y) => d(x.r.rev.total, y.r.rev.total, fmtEok))}
      ${row('총사업비', x => fmtEok(x.r.cost.total), (x, y) => d(x.r.cost.total, y.r.cost.total, fmtEok))}
    </table>`;
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
        const c = p.chosen, ex = c.ex || {};
        info.innerHTML = `<b>/arch 확정안 기준 · ${esc(this.STAGE_LABEL[p.stage] || '')}</b>: ${esc(c.label || '')} · ${fmt(c.units)}세대 · 용적률 ${fmt(c.far, 1)}% · 지상 연면적 ${fmt(c.gfa)}㎡${num(ex.totalGfa) > 0 ? ` · 총 연면적(추정) ${fmt(ex.totalGfa)}㎡(지하주차장 ${fmt(ex.ugArea)}㎡·${fmt(ex.ugFloors)}개 층, 계획 주차 ${fmt(ex.plan)}대)` : ''} — ${p.types.map(t => `${t}㎡ ${fmt(p.byType[t])}세대(공급 ${fmt(p.sup(t), 1)}㎡)`).join(' · ')}. 이 기준에서는 아래 용적률·평형 비율·공급면적 입력은 쓰지 않습니다.`;
      }
    }
    this.stageCompare(v, p);
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
    d.addEventListener('change', e => {
      const id = e.target.id;
      if (id === 'as_src' || id === 'as_stage') this.syncStage(id === 'as_src' ? 0 : num(e.target.value), id === 'as_stage' ? ($('#as_gfaBasis') || {}).value : '');
      if (id === 'as_src' || id === 'as_stage' || id === 'as_gfaBasis') this.preview();
    });
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
    // /arch [초기 사업성 보기]·[사업성 다시 보기]로 열린 경우(?arch=<site id>) — 화면이 다 그려진 뒤 엶
    setTimeout(() => this.openFromUrl(), 400);
  },
};
