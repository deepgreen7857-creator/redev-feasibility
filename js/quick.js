'use strict';

// 빠른 사업성 — 구역계만 그리면 인천 2030 정비기본계획 용적률 체계·표준 평면·표준 공사비로 1차 비례율을 바로 내고,
// 계획 손잡이(기반시설·용적률·평형 구성·평면 크기·임대 비율)를 돌려 비례율이 어떻게 바뀌는지 봄.
// 공사비·분양가는 조정 수단이 아니라 시장이 정하는 값이라 손잡이에 넣지 않고 시나리오(보수·표준·낙관)로만 보여 줌.
const Quick = {
  FAR: null,       // urban/rules/incheon.json 의 far (원문 대조 verified)
  UNITS: null,     // shared/criteria/arch.json 의 평면 (공급면적)
  // 기준표를 못 읽었을 때 쓰는 값: 2030 인천 정비기본계획 변경 고시 제2026-96호(2026.4.27.) — incheon.json과 같은 값
  FALLBACK_FAR: {
    by_zone: {
      '제1종일반주거지역': { base: 180, allowed: 200, max: 200 },
      '제2종일반주거지역': { base: 210, allowed: 230, max: 250 },
      '제3종일반주거지역': { base: 230, allowed: 250, max: 285 },
      '준주거지역_순수공동주택': { base: 230, allowed: 250, max: 300 },
      '역세권_준주거지역_순수공동주택': { base: 250, allowed: 270, max: 360 },
    },
    max_incentive_formula: { public_facility_build: 1.5 },
  },
  SCEN: [
    { key: '보수', con: 10, gen: -5, note: '공사비 +10%, 일반분양가 −5%' },
    { key: '표준', con: 0, gen: 0, note: '입력값 그대로' },
    { key: '낙관', con: -5, gen: 5, note: '공사비 −5%, 일반분양가 +5%' },
  ],

  async load() {
    const get = u => fetch(u + '?v=' + Date.now()).then(r => r.ok ? r.json() : null).catch(() => null);
    const [inc, arch] = await Promise.all([get('urban/rules/incheon.json'), get('shared/criteria/arch.json')]);
    if (inc && inc.far && inc.far.by_zone) this.FAR = inc.far;
    if (arch && arch.평면) this.UNITS = Object.assign({}, arch.평면, arch.평면_추가 || {});
    if (App.current === 'quick') Tabs.quick.refresh();
  },
  far() { return this.FAR || this.FALLBACK_FAR; },
  zones() { return Object.keys(this.far().by_zone); },
  zoneKey(z) {
    z = String(z || '');
    if (/역세권/.test(z) && /준주거/.test(z)) return '역세권_준주거지역_순수공동주택';
    if (/준주거/.test(z)) return '준주거지역_순수공동주택';
    if (/제3종/.test(z)) return '제3종일반주거지역';
    if (/제1종/.test(z)) return '제1종일반주거지역';
    return '제2종일반주거지역';
  },
  sup(t, fb) { const u = this.UNITS && this.UNITS[t]; return u && num(u.공급) > 0 ? num(u.공급) : fb; },

  // 처음 열 때 기본값 채우기(사업성 가정값 창의 기본값과 같은 근거)
  ensure() {
    const q = S.quick || (S.quick = {});
    if (q.init) return q;
    const a = Assume.defaults();
    Object.assign(q, {
      init: true, zone: this.zoneKey(S.meta.zoning), farStep: 'calc', farCustom: 250, infraPct: 25,
      mix59: 40, sizePct: 100, rentRatio: a.rentRatio, members: a.members, avgLand: 0,
      generalPrice: a.generalPrice, memberRatio: a.memberRatio, conPrice: a.conPrice, etcPct: a.etcPct,
      priorMul: a.priorMul, gfaFactor: a.gfaFactor, resRatio: a.resRatio, rentPrice: a.rentPrice, shopPrice: a.shopPrice, target: 100,
    });
    return q;
  },

  // 구역 안 '설치된' 기존 공공시설(토지조서 지목 도로·공원 등) — 상한용적률 산식에서 새 공공시설 면적에서 뺌
  existingInfra(s) { return s.lands.filter(l => Calc.isInfra(l.jimok)).reduce((a, l) => a + num(l.area), 0); },

  // 용적률: 기준·허용·산식(상한 이내)·직접
  farOf(q, s) {
    const F = this.far(), z = F.by_zone[q.zone] || F.by_zone['제2종일반주거지역'];
    const coef = num((F.max_incentive_formula || {}).public_facility_build) || 1.5;
    const site = Calc.siteArea(s), infra = site * num(q.infraPct) / 100, lot = site - infra, old = this.existingInfra(s);
    const pa = Math.max(0, infra - old);
    const raw = z.allowed + coef * pa / (lot || 1) * z.base;
    const calc = Math.round(Math.min(z.max, raw) * 10) / 10;
    const v = q.farStep === 'base' ? z.base : q.farStep === 'allowed' ? z.allowed : q.farStep === 'custom' ? Math.min(num(q.farCustom), z.max) : calc;
    return { v, z, raw, calc, pa, old, lot, site, infra, capped: raw > z.max, coef };
  },

  // 입력값 q로 사업성 계산 (S는 건드리지 않음). m: 시나리오 배율
  evaluate(q, m = {}) {
    const t = JSON.parse(JSON.stringify(S));
    t.plan.infraMode = 'ratio'; t.plan.infraRatio = num(q.infraPct);
    const f = this.farOf(q, t);
    const k = num(q.sizePct || 100) / 100;
    const v = {
      far: f.v, gfaFactor: num(q.gfaFactor) || 1.45, resRatio: num(q.resRatio) || 97, mix59: num(q.mix59),
      sup59: this.sup('59', 80) * k, sup84: this.sup('84', 110) * k, supRent: this.sup('49', 67) * k,
      rentRatio: num(q.rentRatio), members: num(q.members), generalPrice: num(q.generalPrice), memberRatio: num(q.memberRatio),
      memberPrice: num(q.generalPrice) * num(q.memberRatio) / 100, rentPrice: num(q.rentPrice), shopPrice: num(q.shopPrice),
      conPrice: num(q.conPrice), etcPct: num(q.etcPct), comp: 0, priorMul: num(q.priorMul) || 1.4, src: '',
    };
    const p = Assume.applyTo(t, v);
    // 토지조서가 아직 없으면 평균 공시지가(만원/㎡) × (구역 − 기존 공공시설) × 보정배율로 종전자산 추정
    let priorNote = '';
    if (Calc.officialLandValue(t) <= 0 && num(q.avgLand) > 0) {
      t.prior.mode = 'manual';
      t.prior.manual = Math.max(0, f.site - f.old) * num(q.avgLand) * v.priorMul;
      priorNote = `평균 공시지가 ${fmt(q.avgLand)}만원/㎡ × ${fmt(f.site - f.old)}㎡ × ${v.priorMul}`;
    } else if (t.prior.mode === 'estimate') priorNote = `공시지가 합계 × ${v.priorMul}`;
    const r = Calc.result(t, m);
    return { p, r, f, t, v, priorNote };
  },
  ratio(q, m) { return this.evaluate(q, m).r.ratio; },

  // 손잡이별로 한 단계 내리고 올렸을 때 비례율
  LEVERS: [
    { key: 'infraPct', label: '정비기반시설 비율', unit: '%p', step: 5, min: 5, max: 50, help: '공공시설을 늘리면 상한용적률 산식으로 용적률이 오르지만 획지는 줄어듦' },
    { key: 'farStep', label: '용적률 단계', discrete: true, help: '허용(인센티브 다 받음) ↔ 산식(공공시설 제공 상한)' },
    { key: 'mix59', label: '59㎡형 비율', unit: '%p', step: 20, min: 0, max: 100, help: '나머지는 84㎡형' },
    { key: 'sizePct', label: '세대당 평면 크기', unit: '%', step: 5, min: 80, max: 120, help: '표준 평면 공급면적 대비. 같은 연면적에서 크기를 줄이면 세대수가 늘어남' },
    { key: 'rentRatio', label: '임대주택 비율', unit: '%p', step: 5, min: 0, max: 30, help: '법정 범위는 정비계획에서 확인' },
  ],
  leverRows(q) {
    const base = this.ratio(q);
    return this.LEVERS.map(L => {
      let lo, hi, loTxt, hiTxt;
      if (L.discrete) {
        lo = { ...q, farStep: 'allowed' }; hi = { ...q, farStep: 'calc' };
        loTxt = '허용용적률'; hiTxt = '산식(상한 이내)';
      } else {
        const cur = num(q[L.key]);
        const a = Math.max(L.min, cur - L.step), b = Math.min(L.max, cur + L.step);
        lo = { ...q, [L.key]: a }; hi = { ...q, [L.key]: b };
        loTxt = `${fmt(a)}%`; hiTxt = `${fmt(b)}%`;
      }
      return { L, base, lo: this.ratio(lo), hi: this.ratio(hi), loTxt, hiTxt };
    });
  },

  // 기반시설 비율을 훑어 비례율이 가장 높은 점 찾기(산식 용적률 기준)
  infraScan(q) {
    const rows = [];
    for (let i = 10; i <= 45; i += 2.5) {
      const qq = { ...q, infraPct: i, farStep: 'calc' }, e = this.evaluate(qq);
      rows.push({ i, far: e.f.v, capped: e.f.capped, units: e.p.total, ratio: e.r.ratio });
    }
    const ok = rows.filter(r => isFinite(r.ratio));
    const best = ok.length ? ok.reduce((a, b) => (b.ratio > a.ratio ? b : a)) : null;
    return { rows, best };
  },

  // 지금 값을 사업성 표(분양수입·사업비·종전자산)에 채움
  apply() {
    const q = this.ensure(), e = this.evaluate(q);
    S.plan.infraMode = 'ratio'; S.plan.infraRatio = num(q.infraPct);
    Assume.applyTo(S, e.v);
    if (Calc.officialLandValue(S) <= 0 && num(q.avgLand) > 0) { S.prior.mode = 'manual'; S.prior.manual = e.t.prior.manual; }
    S.quick.appliedAt = new Date().toLocaleString('sv-SE').slice(0, 16);
    App.update(true);
    App.go('result');
  },
  reset() { S.quick = {}; this.ensure(); App.update(true); },
};

// ---------- 탭 ----------
Tabs.quick = {
  render() {
    Quick.ensure();
    const zs = $('#qk_zone');
    if (zs && !zs.options.length) zs.innerHTML = Quick.zones().map(z => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join('');
    bindInputs($('#tab-quick'));
    if (!this._bound) {
      this._bound = true;
      $('#qkApply').onclick = () => Quick.apply();
      $('#qkReset').onclick = () => Quick.reset();
      $('#qkZoneFromMeta').onclick = () => { S.quick.zone = Quick.zoneKey(S.meta.zoning); App.update(true); };
    }
    this.refresh();
  },
  refresh() {
    const q = Quick.ensure();
    bindInputs($('#tab-quick'));
    const out = $('#qkOut'); if (!out) return;
    const site = Calc.siteArea(S);
    if (!(site > 0)) { out.innerHTML = '<p class="warn-box">구역 면적이 없습니다. <b>2 구역계</b>에서 구역을 그리거나 면적을 직접 넣으면 바로 계산됩니다.</p>'; $('#qkLevers').innerHTML = ''; $('#qkScan').innerHTML = ''; return; }
    const e = Quick.evaluate(q), f = e.f, p = e.p, r = e.r;
    const scen = Quick.SCEN.map(sc => ({ sc, ratio: Calc.result(e.t, { construction: 1 + sc.con / 100, general: 1 + sc.gen / 100 }).ratio }));
    const avgPrior = num(q.members) > 0 ? r.prior / num(q.members) : 0;
    const right = isFinite(r.ratio) ? avgPrior * r.ratio / 100 : NaN;
    const charge = sup => { if (!isFinite(right)) return '–'; const c = p.memberPrice * sup / PY - right; return `${c >= 0 ? '' : '환급 '}${fmtEok(Math.abs(c))}`; };
    const farTxt = q.farStep === 'calc'
      ? `산식: 허용 ${f.z.allowed}% + ${f.coef} × 공공시설 제공 ${fmt(f.pa)}㎡ ÷ 획지 ${fmt(f.lot)}㎡ × 기준 ${f.z.base}% = ${fmt(f.raw, 1)}%${f.capped ? ` → 상한 ${f.z.max}%` : ''}`
      : q.farStep === 'base' ? `기준용적률 ${f.z.base}%` : q.farStep === 'allowed' ? `허용용적률 ${f.z.allowed}% (인센티브 다 받는다고 가정)` : `직접 입력(상한 ${f.z.max}% 이내)`;
    const warn = [];
    if (!(r.prior > 0)) warn.push('종전자산이 0입니다. 3탭 토지조서(공시지가)를 채우거나, 아래 <b>평균 공시지가</b>를 넣으면 비례율이 나옵니다.');
    if (!num(q.members)) warn.push('조합원 수가 0입니다. 토지등소유자 수(추정)를 넣으세요.');
    if (p.short) warn.push(`조합원 ${fmt(q.members)}명보다 분양 세대가 ${fmt(p.short)}세대 부족합니다.`);
    if (q.farStep === 'calc' && !S.lands.length) warn.push('토지조서가 없어 기존 공공시설(도로 등) 면적을 0으로 보고 산식 용적률을 냈습니다. 실제로는 기존 도로를 빼야 해서 용적률이 더 낮을 수 있습니다.');
    const tgt = num(q.target) || 100;
    out.innerHTML = `
      <div class="qk-head">
        <div class="qk-ratio ${ratioClass(r.ratio)}"><span>1차 비례율 (표준)</span><b>${fmtPct(r.ratio)}</b><em>${isFinite(r.ratio) ? (r.ratio >= tgt ? `목표 ${tgt}% 이상` : `목표 ${tgt}%까지 ${fmt(tgt - r.ratio, 1)}%p 부족`) : '계산 전'}</em></div>
        <div class="qk-scen">${scen.map(x => `<div class="${ratioClass(x.ratio)}"><span>${x.sc.key}</span><b>${fmtPct(x.ratio)}</b><em>${x.sc.note}</em></div>`).join('')}</div>
      </div>
      <div class="as-grid">
        <div><span>구역 면적</span><b>${fmt(site)}㎡</b><em>기반시설 ${fmt(q.infraPct)}% → 획지 ${fmt(f.lot)}㎡</em></div>
        <div><span>적용 용적률</span><b>${fmt(f.v, 1)}%</b><em>${esc(q.zone.replace(/_/g, ' '))}</em></div>
        <div><span>총 세대수</span><b>${fmt(p.total)}세대</b><em>59㎡ ${fmt(p.u59)} · 84㎡ ${fmt(p.u84)} · 임대 ${fmt(p.rentU)}</em></div>
        <div><span>조합원 / 일반분양</span><b>${fmt(p.mem59 + p.mem84)} / ${fmt(p.u59 + p.u84 - p.mem59 - p.mem84)}세대</b></div>
        <div><span>총수입</span><b>${fmtEok(r.rev.total)}</b></div>
        <div><span>총사업비</span><b>${fmtEok(r.cost.total)}</b><em>계획연면적 ${fmt(Calc.gfa(e.t))}㎡</em></div>
        <div><span>종전자산</span><b>${fmtEok(r.prior)}</b><em>${esc(e.priorNote)}</em></div>
        <div><span>평균 분담금 (59㎡ / 84㎡)</span><b>${charge(e.v.sup59)} / ${charge(e.v.sup84)}</b><em>평균 권리가액 ${fmtEok(right)}</em></div>
      </div>
      <p class="note">${esc(farTxt)}. 용적률 체계는 2030 인천 도시·주거환경정비기본계획 변경 고시(제2026-96호) 기준입니다. 평면 공급면적은 표준 평면 라이브러리의 개략값(검증필요)입니다.</p>
      ${warn.map(w => `<p class="warn-box">${w}</p>`).join('')}`;

    // 손잡이 효과
    const rows = Quick.leverRows(q);
    const span = Math.max(1, ...rows.map(x => Math.max(Math.abs(x.lo - x.base) || 0, Math.abs(x.hi - x.base) || 0)));
    // 내리면 왼쪽, 올리면 오른쪽으로 그림. 색은 비례율이 오르면 초록, 떨어지면 빨강
    const bar = (d, side) => { if (!isFinite(d)) return ''; const w = Math.min(50, Math.abs(d) / span * 50); return `<span class="qk-bar ${d >= 0 ? 'up' : 'down'}" style="${side === 'lo' ? 'right' : 'left'}:50%;width:${w}%"></span>`; };
    const dTxt = d => isFinite(d) ? `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d), 1)}%p` : '–';
    $('#qkLevers').innerHTML = `<table class="grid qk-lev"><thead><tr><th>손잡이</th><th class="num">내리면</th><th class="qk-barcol">비례율 변화</th><th class="num">올리면</th></tr></thead><tbody>
      ${rows.map(x => `<tr><th>${esc(x.L.label)}<small>${esc(x.L.help)}</small></th>
        <td class="num">${esc(x.loTxt)}<br><b>${fmtPct(x.lo)}</b> <small>${dTxt(x.lo - x.base)}</small></td>
        <td class="qk-barcol"><div class="qk-track">${bar(x.lo - x.base, 'lo')}${bar(x.hi - x.base, 'hi')}<i></i></div></td>
        <td class="num">${esc(x.hiTxt)}<br><b>${fmtPct(x.hi)}</b> <small>${dTxt(x.hi - x.base)}</small></td></tr>`).join('')}
      </tbody></table>
      <p class="note">구역계 조정(사업성이 낮은 땅 빼기·도로변 땅 넣기)은 2탭에서 구역을 고친 뒤 이 화면으로 돌아오면 다시 계산됩니다. 공사비·분양가는 손잡이가 아니라 위의 보수·표준·낙관 시나리오로 봅니다.</p>`;

    // 기반시설 비율 훑기
    const sc = Quick.infraScan(q);
    $('#qkScan').innerHTML = `<table class="grid"><thead><tr><th class="num">기반시설 비율</th><th class="num">산식 용적률</th><th class="num">세대수</th><th class="num">비례율</th></tr></thead><tbody>
      ${sc.rows.map(x => `<tr class="${sc.best && x.i === sc.best.i ? 'qk-best' : ''}${Math.abs(x.i - num(q.infraPct)) < 0.01 ? ' qk-cur' : ''}"><td class="num">${fmt(x.i, 1)}%</td><td class="num">${fmt(x.far, 1)}%${x.capped ? ' (상한)' : ''}</td><td class="num">${fmt(x.units)}</td><td class="num ${ratioClass(x.ratio)}">${fmtPct(x.ratio)}</td></tr>`).join('')}
      </tbody></table>
      ${sc.best ? `<p class="note">산식 용적률 기준으로 기반시설 <b>${fmt(sc.best.i, 1)}%</b>에서 비례율이 가장 높습니다(${fmtPct(sc.best.ratio)}). 상한용적률에 닿은 뒤에는 기반시설을 늘릴수록 획지만 줄어 비례율이 떨어집니다. 실제 기반시설은 교통·공원 기준을 먼저 맞춰야 합니다.</p>` : ''}`;
    const ap = $('#qkApplied'); if (ap) ap.textContent = q.appliedAt ? `마지막으로 사업성 표에 채운 시각: ${q.appliedAt}` : '';
  },
};

// 단계 이전/다음 버튼이 Tabs 순서를 따르므로 '구역계' 바로 다음에 오도록 순서 조정
(() => {
  const ks = Object.keys(Tabs), o = {};
  ks.forEach(k => { if (k === 'quick') return; o[k] = Tabs[k]; if (k === 'area') o.quick = Tabs.quick; });
  if (!o.quick) o.quick = Tabs.quick;
  ks.forEach(k => { delete Tabs[k]; });
  Object.assign(Tabs, o);
})();

document.addEventListener('DOMContentLoaded', () => Quick.load());
