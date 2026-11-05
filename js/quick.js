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
  // 정비기반시설 비율 3단계 — 평균·보수는 실무 경험치(가정값, 인천 고시 사례로 보정 전). 최소는 구역마다 자동 계산
  get INFRA() { const A = JbsFeas.get(); return { avg: A.infraAvg, cons: A.infraCons, minFallback: A.infraMinFallback, parkPerUnit: A.parkPerUnit }; },
  // 시장 값은 공통 가정값(shared/feas.js)에서 읽음 — /urban 사업성 탭과 같은 값
  FEAS_KEYS: ['mix59', 'mix114', 'generalPrice', 'memberRatio', 'conPrice', 'etcPct', 'priorMul', 'avgLand', 'rentRatio', 'gfaFactor', 'resRatio', 'rentPrice', 'shopPrice'],
  // 공사비 단계(기준 공사비 대비) — 구역마다 고름(S.quick.conLevel)
  CON_LV: [['low', '낮게', -5], ['base', '기준', 0], ['high', '높게', 5], ['higher', '많이 높게', 10]],
  conMul(q) { const l = this.CON_LV.find(x => x[0] === (q.conLevel || 'base')); return 1 + (l ? l[2] : 0) / 100; },
  // 조합원 분양가 비율 단계(일반분양가 대비 %) — 공통 가정값(memberRatio)에 저장
  MEM_LV: [80, 85, 90],
  // 평형 비율 프리셋(59·84·114㎡형 %) — 공통 가정값(mix59·mix84·mix114)에 저장
  MIX_LV: [['small', '소형 위주', 60, 35, 5], ['base', '기본', 40, 50, 10], ['large', '중대형 위주', 20, 60, 20]],
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
    const A = JbsFeas.get();
    // 용도지역은 개요(주소 검색·구역계로 자동 판정)를 따라감. 이 화면에서 직접 고른 뒤에는 그대로 둠(zoneManual)
    const syncZone = () => { if (!q.zoneManual && S.meta.zoning && q.zoneSrc !== S.meta.zoning) { q.zone = this.zoneKey(S.meta.zoning); q.zoneSrc = S.meta.zoning; } };
    // 조합원 수도 처음 연 때 값에 고정되던 것 → 구역·조서(건축물 전유 호수·건물 없는 대지·소유자 수)로 다시 추정. 직접 고치면 유지(membersManual)
    const syncMembers = () => { if (q.membersManual) return; try { const m = Math.round(num(Assume.defaults().members)); if (m > 0 && m !== num(q.members)) q.members = m; } catch (e) { /* 조서 없음 */ } };
    if (q.init) { if (!q.infraLevel) q.infraLevel = 'avg'; syncZone(); syncMembers(); this.FEAS_KEYS.forEach(k => { q[k] = A[k]; }); return q; }
    const a = Assume.defaults();
    Object.assign(q, {
      init: true, zone: this.zoneKey(S.meta.zoning), farStep: 'calc', farCustom: 250, infraLevel: 'avg', infraPct: 25,
      mix59: 40, sizePct: 100, rentRatio: a.rentRatio, members: a.members, avgLand: 0,
      generalPrice: a.generalPrice, memberRatio: a.memberRatio, conPrice: a.conPrice, etcPct: a.etcPct,
      priorMul: a.priorMul, gfaFactor: a.gfaFactor, resRatio: a.resRatio, rentPrice: a.rentPrice, shopPrice: a.shopPrice, target: 100,
    });
    q.zoneSrc = S.meta.zoning || '';
    this.FEAS_KEYS.forEach(k => { q[k] = A[k]; });
    return q;
  },

  // 최소 비율: 무상양도 균형(구역 안 기존 국공유 도로 등 면적)과 법정 공원(세대당 2㎡) 중 큰 값. 토지조서가 없으면 15%(가정)
  minInfra(q) {
    const site = Calc.siteArea(S); if (!(site > 0)) return { v: this.INFRA.minFallback, basis: '구역 면적 없음' };
    const old = this.existingInfra(S);
    if (!S.lands.length) return { v: this.INFRA.minFallback, basis: '토지조서가 없어 15%로 둠(가정) — 토지조서를 채우면 구역에 맞게 다시 계산' };
    let v = Math.max(old / site * 100, 5), units = 0;
    for (let k = 0; k < 3; k++) {   // 세대수가 비율에 따라 바뀌므로 몇 번 맞춤
      units = this.evaluate({ ...q, infraLevel: 'custom', infraPct: v }).p.total;
      v = Math.max(old / site * 100, units * this.INFRA.parkPerUnit / site * 100);
    }
    v = Math.ceil(v * 2) / 2;
    return { v, basis: `기존 국공유 도로 등 ${fmt(old)}㎡(${fmt(old / site * 100, 1)}%)와 법정 공원 세대당 2㎡(${fmt(units)}세대 → ${fmt(units * 2)}㎡) 중 큰 값` };
  },
  levelPct(q, lv) { return lv === 'min' ? this.minInfra(q).v : lv === 'cons' ? this.INFRA.cons : lv === 'custom' ? num(q.infraPct) : this.INFRA.avg; },

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
    if (q.infraLevel && q.infraLevel !== 'custom') q = { ...q, infraPct: this.levelPct(q, q.infraLevel) };
    t.plan.infraMode = 'ratio'; t.plan.infraRatio = num(q.infraPct);
    const f = this.farOf(q, t);
    const k = num(q.sizePct || 100) / 100;
    // '배치 기준으로 계산'을 켰으면 개략 배치로 실제 들어간 용적률을 상한으로(땅 모양·일조로 목표를 다 못 채우는 구역)
    const lay = q.layout, layOk = q.useLayoutFar && lay && lay.far > 0 && S.area.geojson && lay.zone === zoneKey(S.area.geojson);
    const v = {
      far: layOk ? Math.min(f.v, Math.round(lay.far * 10) / 10) : f.v, gfaFactor: num(q.gfaFactor) || 1.45, resRatio: num(q.resRatio) || 97, mix59: num(q.mix59),
      sup59: JbsFeas.supply(59) * k, sup84: JbsFeas.supply(84) * k, supRent: JbsFeas.supply(49) * k,
      rentRatio: num(q.rentRatio), mix114: num(q.mix114), members: num(q.members), generalPrice: num(q.generalPrice), memberRatio: num(q.memberRatio),
      memberPrice: num(q.generalPrice) * num(q.memberRatio) / 100, rentPrice: num(q.rentPrice), shopPrice: num(q.shopPrice),
      conPrice: num(q.conPrice) * this.conMul(q), etcPct: num(q.etcPct), comp: 0, priorMul: num(q.priorMul) || 1.4, src: '',
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
    { key: 'mix59', label: '59㎡형 비율', unit: '%p', step: 20, min: 0, max: 90, help: '84㎡형이 나머지를 채움(114㎡형 비율은 그대로)' },
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
        const fix = L.key === 'infraPct' ? { infraLevel: 'custom' } : {};   // 단계(평균 등)가 비율을 덮어쓰지 않게
        lo = { ...q, ...fix, [L.key]: a }; hi = { ...q, ...fix, [L.key]: b };
        loTxt = `${fmt(a)}%`; hiTxt = `${fmt(b)}%`;
      }
      return { L, base, lo: this.ratio(lo), hi: this.ratio(hi), loTxt, hiTxt };
    });
  },

  // 기반시설 비율을 훑어 비례율이 가장 높은 점 찾기(산식 용적률 기준)
  infraScan(q) {
    const rows = [];
    for (let i = 10; i <= 45; i += 2.5) {
      const qq = { ...q, infraLevel: 'custom', infraPct: i, farStep: 'calc' }, e = this.evaluate(qq);
      rows.push({ i, far: e.f.v, capped: e.f.capped, units: e.p.total, ratio: e.r.ratio });
    }
    const ok = rows.filter(r => isFinite(r.ratio));
    const best = ok.length ? ok.reduce((a, b) => (b.ratio > a.ratio ? b : a)) : null;
    return { rows, best };
  },

  // 지금 값을 사업성 표(분양수입·사업비·종전자산)에 채움
  apply() {
    const q0 = this.ensure(), q = { ...q0, infraLevel: 'custom', infraPct: this.levelPct(q0, q0.infraLevel || 'avg') }, e = this.evaluate(q);
    S.plan.infraMode = 'ratio'; S.plan.infraRatio = num(q.infraPct);
    Assume.applyTo(S, e.v);
    if (Calc.officialLandValue(S) <= 0 && num(q.avgLand) > 0) { S.prior.mode = 'manual'; S.prior.manual = e.t.prior.manual; }
    S.quick.appliedAt = new Date().toLocaleString('sv-SE').slice(0, 16);
    App.update(true);
    App.go('result');
  },
  // ---------- 1차 재검토로 넘기기 — 이 구역과 빠른 사업성(1회차) 결과를 공통 구역(jbs.sites.v1)으로 저장 ----------
  //  같은 구역이면 같은 id를 갱신(S.quick.siteId). 교통·환경·경관·개략 배치·/urban이 ?site=id로 이어받고,
  //  /arch 확정 뒤 '/?arch=id'로 돌아오면 2차 사업성(stage 2)으로 비교함
  toReview() {
    if (!S.area.geojson) { alert('먼저 2단계에서 구역계를 정해 주세요.'); return null; }
    if (!window.JbsSite) { alert('공통 구역 저장 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return null; }
    const q0 = this.ensure(), q = { ...q0, infraLevel: 'custom', infraPct: this.levelPct(q0, q0.infraLevel || 'avg') }, e = this.evaluate(q), p = e.p;
    const n = x => (isFinite(+x) ? String(Math.round(+x * 10) / 10) : '');
    let site = (S.quick.siteId && JbsSite.get(S.quick.siteId)) || null;
    // 예전에 넘긴 구역과 지금 구역이 다르면(90% 미만 겹침) 새 구역으로 — 같은 id를 다시 쓰면 교통성·환경성 화면에 예전 구역의 입력이 그대로 뜸
    if (site && site.geojson && window.turf) {
      try {
        const a = turf.area(site.geojson), b = turf.area(S.area.geojson), x = turf.intersect(site.geojson, S.area.geojson);
        const ov = x ? turf.area(x) / Math.max(a, b) : 0;
        if (!(ov >= 0.9)) site = null;
      } catch (er) { site = null; }
    }
    const loc = String(S.meta.location || ''), apt = (loc.match(/\(([^)]*)\)/) || [])[1];
    const autoName = (S.meta.name && S.meta.name !== '새 정비사업') ? S.meta.name : (apt ? apt.split(',').pop().trim() : loc.replace(/^인천광역시\s*|^서울특별시\s*/, '').replace(/\s*일대$/, '')) || '정비구역';
    if (!site) site = { name: autoName, plan: {}, profile: {}, v: {} };
    site.source = 'main';
    site.name = autoName;
    site.geojson = S.area.geojson;
    site.profile = site.profile || {}; site.plan = site.plan || {}; site.v = site.v || {};
    if (S.meta.zoning) site.profile.zoning = S.meta.zoning;
    site.plan.type = /small|street|가로/.test(S.meta.type || '') ? 'street' : 'redev';
    const byType = {}; Object.entries(p.saleBy || {}).forEach(([t, c]) => { if (+c) byType[t] = +c; });
    if (p.rentU) byType[49] = (byType[49] || 0) + p.rentU;
    let u60 = 0, a85 = 0, a85u = 0;
    Object.entries(byType).forEach(([t, c]) => { const ex = +t; if (ex <= 60) u60 += c; if (ex <= 85) a85 += c * ex; else a85u += c * ex; });
    const v = site.v, at = new Date().toLocaleString('sv-SE').slice(0, 16);
    Object.assign(v, {
      name: site.name, siteArea: n(Calc.siteArea(S)), units: n(p.total), far: n(e.f.v), aptGFA: n(p.farArea),
      units60below: n(u60), area85below: n(a85), area85above: n(a85u),
      planFrom: `사업성 검토 빠른 사업성 1회차 (${at}) — 기반시설 ${fmt(q.infraPct, 1)}%·용적률 ${fmt(e.f.v, 1)}%`,
    });
    if (S.meta.zoning) v.zoning = S.meta.zoning;
    site.quick = { at, infraPct: num(q.infraPct), far: e.f.v, units: p.total, byType, ratio: e.r.ratio, prior: Math.round(num(e.r.prior)), members: num(q.members) };   // prior·members: /arch 안별 비례율(2026-11-05)
    JbsSite.save(site);
    S.quick.siteId = site.id; App.persist();
    return site;
  },
  // 1차 재검토 순서 안내 + 각 도구로 가는 버튼
  reviewLinks() {
    const box = $('#qkReviewBox'); if (!box) return;
    const id = S.quick && S.quick.siteId, site = id && window.JbsSite ? JbsSite.get(id) : null;
    if (!site) { box.innerHTML = ''; return; }
    const c = site.constraints || {}, done = k => (c[k] ? `<em class="ok">완료 ${esc(c[k].at || '')}</em>` : '<em>아직</em>');
    const archDone = site.arch && site.arch.chosen ? `<em class="ok">확정 ${esc(site.arch.chosen.label || '')}</em>` : '<em>아직</em>';
    const u = (path, extra = '') => `${path}?site=${encodeURIComponent(site.id)}${extra}`;
    // /urban(기반시설)을 거쳐 4탭에서 넘긴 경우 구역 id가 'urban:안'으로 따로 생김 → 개략 배치가 확정된 것 중 최근 것으로 2차 사업성
    const archSite = [site, ...JbsSite.list().filter(x => /^urban:/.test(x.source || ''))].filter(x => x.arch && x.arch.chosen)
      .sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')))[0];
    box.innerHTML = `<p class="note">넘긴 구역: <b>${esc(site.name)}</b> (${esc(site.updated || '')}) — 1회차 ${fmt(site.quick ? site.quick.units : 0)}세대 · 용적률 ${fmt(site.quick ? site.quick.far : 0, 1)}%. 아래 순서로 열면 각 도구가 이 구역과 1회차 값을 그대로 이어받습니다.</p>
      <p style="margin:8px 0 2px"><b>1회차</b> — 구역계 → 빠른 사업성(자동 배치) → 출입구 → 기반시설(도로 확폭·공원) → 교통·환경 → 배치 확정 → 사업성</p>
      <ol class="rv-steps">
        <li><a class="btn small" href="urban/?from=main" target="_blank" rel="noopener">① 단지 출입구 (/urban 4탭)</a> 구역을 가져와 주출입구·부출입구·주차장 출입구를 찍음 — 주출입구가 닿은 도로가 진입도로가 됨</li>
        <li><a class="btn small" href="urban/?tab=plan" target="_blank" rel="noopener">② 정비기반시설 (/urban 3탭)</a> 진입도로 확폭(주출입구 도로 기준)·경계 도로 폭 → 공원·녹지 위치와 면적</li>
        <li><a class="btn small" href="${u('traffic/')}" target="_blank" rel="noopener">③ 교통성 검토</a> ${done('traffic')} · <a class="btn small" href="${u('env/')}" target="_blank" rel="noopener">환경성 검토</a> ${done('env')} — 잘 모르면 기본값 그대로 [검토서 만들기]만 눌러도 됨(모르는 칸은 '○○')</li>
        <li><a class="btn small" href="${u('arch/')}" target="_blank" rel="noopener">④ 개략 배치 (/arch)</a> 기반시설·출입구·검토 조건을 받아 형태 비교 → [이 안으로 확정] ${archDone}</li>
        <li>${archSite ? `<a class="btn small primary" href="./?arch=${encodeURIComponent(archSite.id)}">⑤ 2차 사업성 (1회차와 비교)</a> ${esc(archSite.name)} 확정안 기준` : '<span class="btn small" aria-disabled="true" style="opacity:.5">⑤ 2차 사업성 (1회차와 비교)</span> ④ 개략 배치를 확정하면 눌러집니다'}</li>
      </ol>
      <p style="margin:10px 0 2px"><b>2회차</b> — 교통성·환경성 검토를 제대로 채워 다시 만들고(확폭 도로는 /urban 3탭 [추천 폭 적용]), <a class="btn small" href="${u('landscape/')}" target="_blank" rel="noopener">높이·경관 검토</a> ${done('landscape')} 뒤 ①~⑤를 다시 누르면 회차가 비교됩니다</p>
      <p class="note">구역계나 1회차 값을 바꿨으면 [1차 재검토로 넘기기]를 다시 누르세요. 같은 구역으로 갱신되고, 이미 만든 검토 결과(배치 조건)는 남습니다.</p>`;
  },

  // ---------- 실제 사례 대조 (shared/cases.js JbsCases) ----------
  //  지금 구역의 자동 값(빠른 사업성 1회차와 같은 계산) — 실제 사례와 같은 항목 이름으로
  autoValues() {
    if (!(Calc.siteArea(S) > 0)) return null;
    const q0 = this.ensure(), q = { ...q0, infraLevel: 'custom', infraPct: this.levelPct(q0, q0.infraLevel || 'avg') }, e = this.evaluate(q), p = e.p, r = e.r;
    const k = v => (isFinite(v) ? Math.round(v * 10) / 10 : '');
    const sb = p.saleBy || {};
    return {
      siteArea: k(e.f.site), infraPct: k(num(q.infraPct)), lotArea: k(e.f.lot), far: k(e.f.v), farArea: k(p.farArea),
      units: k(p.total), rentU: k(p.rentU), u59: k(num(sb[59])), u84: k(num(sb[84])), u114: k(num(sb[114])),
      conPrice: k(e.v.conPrice), generalPrice: k(e.v.generalPrice),
      revTotal: k(r.rev.total / 1e4), costTotal: k(r.cost.total / 1e4), prior: r.prior > 0 ? k(r.prior / 1e4) : "", ratio: k(r.ratio),
    };
  },
  // 지금 구역이 사례 구역과 같은지(겹침 90% 이상) — 같을 때만 '지금 자동'을 그 사례와 비교
  sameZone(c) {
    try {
      if (!c || !c.geojson || !S.area.geojson) return false;
      const i = turf.intersect(turf.feature(c.geojson.geometry || c.geojson), turf.feature(S.area.geojson.geometry || S.area.geojson));
      if (!i) return false;
      const a = turf.area(i);
      return a / turf.area(c.geojson) > 0.9 && a / turf.area(S.area.geojson) > 0.9;
    } catch (e) { return false; }
  },
  caseUi() {
    const box = $('#csBox'); if (!box || !window.JbsCases) return;
    const list = JbsCases.list(), sel = this._case && JbsCases.get(this._case) ? this._case : '';
    const c = sel ? JbsCases.get(sel) : null, auto = this.autoValues(), same = c ? this.sameZone(c) : true;
    const curAuto = same ? auto : null;
    const f = (v, u) => (v === '' || v === undefined || v === null || !isFinite(+v) ? '–' : fmt(+v, u === '%' || u === '억원' ? 1 : 0));
    const dTxt = (d, u) => {
      if (!d) return '';
      const cls = Math.abs(d.pct) <= 5 ? 'ok' : Math.abs(d.pct) <= 15 ? 'mid' : 'bad';
      return `<span class="cs-d ${cls}">${d.d >= 0 ? '+' : ''}${fmt(d.d, u === '%' || u === '억원' ? 1 : 0)}${u === '%' ? '%p' : ''} (${d.pct >= 0 ? '+' : ''}${fmt(d.pct, 1)}%)</span>`;
    };
    const rows = JbsCases.rows(c || { actual: {} }, curAuto);
    let grp = '';
    const body = rows.map(r => {
      const head = r.grp !== grp ? `<tr class="cs-grp"><td colspan="6">${esc(r.grp)}</td></tr>` : '';
      grp = r.grp;
      return head + `<tr><td>${esc(r.label)} <small>${esc(r.unit)}</small></td>
        <td><input class="cs-in" data-cs="${r.k}" inputmode="decimal" value="${esc(r.actual ?? '')}" placeholder="실제 값"></td>
        <td class="num">${c ? f(r.saved, r.unit) : '–'}</td><td>${c ? dTxt(r.dSaved, r.unit) : ''}</td>
        <td class="num">${curAuto ? f(r.cur, r.unit) : '–'}</td><td>${curAuto ? dTxt(r.dCur, r.unit) : ''}</td></tr>`;
    }).join('');
    const sum = JbsCases.summary(list).filter(x => x.n);
    box.innerHTML = `
      <div class="cs-top">
        <label>사례 <select id="csSel"><option value="">+ 새 사례</option>${list.map(x => `<option value="${esc(x.id)}"${x.id === sel ? ' selected' : ''}>${esc(x.name)} · ${esc(x.stage || '')} (${esc(x.updated || '')})</option>`).join('')}</select></label>
        <label>이름 <input id="csName" value="${esc(c ? c.name : '')}" placeholder="예: A구역 (익명으로)"></label>
        <label>단계 <select id="csStage">${JbsCases.STAGES.map(t => `<option${c && c.stage === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
        <label class="cs-memo">메모(근거 문서) <input id="csMemo" value="${esc(c ? c.memo || '' : '')}" placeholder="예: ○○고시 제2025-○○호 정비계획 결정"></label>
      </div>
      ${c && !same ? (c.geojson ? `<p class="note warn">지금 지도 구역이 이 사례 구역과 다릅니다. '지금 자동'은 비워 두었습니다. <button type="button" class="btn small" id="csLoadZone">이 사례 구역 불러오기</button></p>` : `<p class="note warn">이 사례에는 구역 도형이 없어 '지금 자동'을 비교하지 않습니다. 사례 구역(고시 구역계)을 2단계에서 그리거나 불러온 뒤 [실제 값 저장 + 지금 자동값으로 갱신]을 누르면 자동값이 함께 저장됩니다.</p>`) : ''}
      <div class="table-wrap"><table class="grid cs-tbl"><thead><tr><th>항목</th><th>실제</th><th class="num">저장 당시 자동</th><th>차이</th><th class="num">지금 자동</th><th>차이</th></tr></thead><tbody>${body}</tbody></table></div>
      <div class="btns">
        <button type="button" class="btn primary" id="csSave">${c ? '실제 값 저장 + 지금 자동값으로 갱신' : '새 사례로 저장 (지금 구역·자동값과 함께)'}</button>
        ${c ? '<button type="button" class="btn" id="csSaveActual">실제 값만 저장</button><button type="button" class="btn ghost danger" id="csDel">이 사례 지우기</button>' : ''}
        <span class="small muted" id="csMsg"></span>
      </div>
      <h4>전체 사례 차이 요약 <small>저장 당시 자동값 − 실제, 사례 ${list.length}개</small></h4>
      ${sum.length ? `<div class="table-wrap"><table class="grid cs-sum"><thead><tr><th>항목</th><th class="num">사례 수</th><th class="num">평균 차이</th><th class="num">평균 크기</th><th class="num">범위</th><th>판단</th></tr></thead><tbody>
        ${sum.map(x => `<tr><td>${esc(x.label)}</td><td class="num">${x.n}</td><td class="num">${x.mean >= 0 ? '+' : ''}${fmt(x.mean, 1)}%${x.pp !== null ? ` (${x.pp >= 0 ? '+' : ''}${fmt(x.pp, 1)}%p)` : ''}</td><td class="num">${fmt(x.absMean, 1)}%</td><td class="num">${fmt(x.min, 1)} ~ ${fmt(x.max, 1)}%</td>
          <td>${x.n < 3 ? '사례가 더 필요' : Math.abs(x.mean) <= 5 ? '잘 맞음' : `자동이 ${x.mean > 0 ? '많게(높게)' : '적게(낮게)'} 나옴 — 가정값 보정 검토`}</td></tr>`).join('')}
        </tbody></table></div>` : '<p class="note">아직 비교할 사례가 없습니다. 실제 값을 넣고 저장하면 여기에 항목별 차이가 쌓입니다.</p>'}
      <p class="note">이 브라우저에만 저장되고 '작업 저장·불러오기' 파일에 함께 들어갑니다. 사례 이름은 익명으로, 고시된 자료 수준의 숫자만 넣으세요. 빈 칸은 비교하지 않습니다.</p>`;
    const read = () => { const a = {}; $$('#csBox [data-cs]').forEach(i => { if (i.value.trim() !== '') a[i.dataset.cs] = i.value.trim().replace(/,/g, ''); }); return a; };
    const say = t => { const m = $('#csMsg'); if (m) m.textContent = t; };
    $('#csSel').onchange = e => { this._case = e.target.value; this.caseUi(); };
    const lz = $('#csLoadZone'); if (lz) lz.onclick = () => { App.go('area'); setTimeout(() => MapView.setZoneGeo(c.geojson, `사례 '${c.name}' 구역`, '사례 구역'), 300); };
    const doSave = withAuto => {
      const name = $('#csName').value.trim();
      if (!name) { say('이름을 넣어 주세요(예: A구역).'); $('#csName').focus(); return; }
      const actual = read();
      if (!Object.keys(actual).length) { say('실제 값을 하나 이상 넣어 주세요.'); return; }
      const cc = c ? { ...c } : {};
      Object.assign(cc, { name, stage: $('#csStage').value, memo: $('#csMemo').value.trim(), actual });
      if (withAuto) {
        if (!auto) { say('지금 구역이 없어 자동값을 계산하지 못했습니다. 구역계를 먼저 정하세요.'); return; }
        if (c && !same && !confirm('지금 지도 구역이 이 사례 구역과 다릅니다. 그래도 지금 구역의 자동값으로 바꿀까요?')) return;
        cc.auto = auto; cc.autoAt = new Date().toLocaleString('sv-SE').slice(0, 16); cc.geojson = S.area.geojson;
        cc.assume = { infraLevel: S.quick.infraLevel, farStep: S.quick.farStep, zone: S.quick.zone };
      }
      const r = JbsCases.save(cc);
      if (!r) { say('저장하지 못했습니다(브라우저 저장 공간). 작업 저장으로 파일을 내려받아 두세요.'); return; }
      this._case = r.id; this.caseUi(); say('저장했습니다.');
    };
    $('#csSave').onclick = () => doSave(true);
    const sa = $('#csSaveActual'); if (sa) sa.onclick = () => doSave(false);
    const dl = $('#csDel'); if (dl) dl.onclick = () => { if (!confirm(`사례 '${c.name}'을(를) 지울까요?`)) return; JbsCases.remove(c.id); this._case = ''; this.caseUi(); };
    // 실제 값을 바꾸면 차이를 바로 다시 보여 줌(저장 전 미리 보기)
    $$('#csBox [data-cs]').forEach(i => i.addEventListener('change', () => {
      const tr = i.closest('tr'), k = i.dataset.cs, it = JbsCases.ITEMS.find(x => x[0] === k), cells = tr.querySelectorAll('td');
      if (c) cells[3].innerHTML = dTxt(JbsCases.diff(c.auto && c.auto[k], i.value, it[2]), it[2]);
      if (curAuto) cells[5].innerHTML = dTxt(JbsCases.diff(curAuto[k], i.value, it[2]), it[2]);
    }));
  },

  // ---------- 사업성 검토서(1회차) — 새 창에 보고서를 열고 인쇄·PDF 저장 ----------
  // mode: 'client' 사용자용(결과만, 안내 한 줄) · 'staff' 검토자용(산식·가정값·범위·한계 모두)
  report(mode = 'client') {
    const q0 = this.ensure(), lvNow = q0.infraLevel || 'avg';
    const q = { ...q0, infraLevel: 'custom', infraPct: this.levelPct(q0, lvNow) };
    const site = Calc.siteArea(S);
    if (!(site > 0)) { alert('구역 면적이 없어 검토서를 만들 수 없습니다. 2 구역계에서 구역을 정하세요.'); return; }
    const e = this.evaluate(q), f = e.f, p = e.p, r = e.r, A = JbsFeas.get(), mi = this.minInfra(q0);
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const eok = v => isFinite(v) ? fmt(v / 10000, 1) + '억원' : '–';
    const pct = v => isFinite(v) ? fmt(v, 1) + '%' : '–';
    const lvName = { min: '최소', avg: '평균', cons: '보수적', custom: '직접 입력' };
    const levels = [['min', mi.v], ['avg', A.infraAvg], ['cons', A.infraCons]];
    const grid = levels.map(([k, v]) => {
      const ee = this.evaluate({ ...q, infraPct: v });
      return { k, v, units: ee.p.total, far: ee.f.v, vals: this.SCEN.map(sc => Calc.result(ee.t, { construction: 1 + sc.con / 100, general: 1 + sc.gen / 100 }).ratio) };
    });
    const all = grid.flatMap(g => g.vals).filter(isFinite);
    const avgPrior = num(q.members) > 0 ? r.prior / num(q.members) : 0, right = isFinite(r.ratio) ? avgPrior * r.ratio / 100 : NaN;
    const chg = sup => { if (!isFinite(right)) return '–'; const c = p.memberPrice * sup / PY - right; return (c >= 0 ? '' : '환급 ') + eok(Math.abs(c)); };
    const farTxt = q.farStep === 'calc' ? `상한용적률 산식(허용 ${f.z.allowed}% + ${f.coef} × 공공시설 제공 ${fmt(f.pa)}㎡ ÷ 획지 ${fmt(f.lot)}㎡ × 기준 ${f.z.base}% = ${fmt(f.raw, 1)}%${f.capped ? `, 상한 ${f.z.max}% 적용` : ''})`
      : q.farStep === 'base' ? '기준용적률' : q.farStep === 'allowed' ? '허용용적률(인센티브 모두 받는다고 가정)' : '직접 입력';
    const cls = v => !isFinite(v) ? '' : v >= 100 ? 'g' : v >= 90 ? 'w' : 'b';
    const typeRows = [['59', p.u59], ['84', p.u84], ['114', p.u114]].filter(([, n]) => n > 0)
      .map(([t, n]) => `<tr><td>${t}㎡형</td><td class="n">${fmt(n)}</td><td class="n">${fmt(JbsFeas.supply(t) * (num(q.sizePct || 100) / 100), 1)}㎡</td><td class="n">${chg(JbsFeas.supply(t) * (num(q.sizePct || 100) / 100))}</td></tr>`).join('');
    const costRows = r.cost.items.filter(it => it.amount > 0).map(it => `<tr><td>${esc(it.name.replace(/\s*\(가정값\)/, ''))}</td><td class="n">${eok(it.amount)}</td></tr>`).join('');
    const revName = { 조합원: '조합원 분양', 일반: '일반 분양', 임대: '임대주택 인수', 상가: '근린생활시설 분양' };
    const revRows = Object.entries(r.rev.byCat).filter(([, v]) => v > 0).map(([k, v]) => `<tr><td>${esc(revName[k] || k)}</td><td class="n">${eok(v)}</td></tr>`).join('');
    const grp = [['시장 값', [['generalPrice', '만원/평(공급)'], ['memberRatio', '%'], ['buildCost', '만원/㎡(기본형건축비, 2026.9.15. 고시)'], ['rentBuildPct', '% (임대 건축물 인수 비율, 부속토지는 감정가)'], ['shopPrice', '만원/평'], ['conPrice', '만원/평(계획연면적)'], ['etcPct', '% (공사비 대비)'], ['priorMul', '배 (공시지가 대비)']]],
      ['계획 값', [['gfaFactor', '배 (지하·공용 포함)'], ['resRatio', '%'], ['rentRatio', '% (49㎡형)'], ['mix59', '%'], ['mix84', '%'], ['mix114', '%']]],
      ['정비기반시설 비율', [['infraAvg', '% (실무 경험치)'], ['infraCons', '% (실무 경험치)']]]];
    const assume = grp.map(([g, ks]) => `<tr class="h"><th colspan="2">${g}</th></tr>` + ks.map(([k, u]) => `<tr><td>${esc((JbsFeas.LABEL[k] || k).replace(/\(.*\)$/, ''))}</td><td class="n">${fmt(A[k], k === 'gfaFactor' || k === 'priorMul' ? 2 : 0)} ${u}</td></tr>`).join('')).join('');
    // 검토자용 추가 표: 손잡이, 기반시설 비율 훑기, 공사비×분양가 민감도
    const lev = mode === 'staff' ? this.leverRows(q) : [];
    const scan = mode === 'staff' ? this.infraScan(q) : { rows: [] };
    const steps = [-10, -5, 0, 5, 10];
    const sens = mode === 'staff' ? steps.map(c => steps.map(g => Calc.result(e.t, { construction: 1 + c / 100, general: 1 + g / 100 }).ratio)) : [];
    const sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + '%';
    const name = S.meta.name || '정비구역';
    const zname = name.replace(/사업구역$/, '사업').replace(/정비구역$/, '정비사업');   // 예: 숭의2구역 재개발사업구역 → 숭의2구역 재개발사업
    const css = `<style>
@page { size: A4; margin: 15mm 14mm 16mm; }
* { box-sizing: border-box; }
body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; color: #1d2a33; font-size: 10pt; line-height: 1.55; margin: 0 auto; max-width: 800px; padding: 18px; background: #fff; }
.head { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 3px solid #1d2a33; padding-bottom: 8px; }
.brand { font-size: 8.5pt; color: #5b6770; letter-spacing: .04em; }
.brand b { color: #c2410c; font-size: 10pt; }
h1 { font-size: 20pt; margin: 6px 0 2px; letter-spacing: -.01em; }
.zn { font-size: 13pt; font-weight: 700; margin: 0 0 2px; }
.meta { font-size: 9pt; color: #5b6770; }
.stamp { border: 1.5px solid #c2410c; color: #c2410c; border-radius: 4px; padding: 3px 8px; font-size: 8.5pt; font-weight: 700; white-space: nowrap; }
h2 { font-size: 11.5pt; margin: 20px 0 7px; padding-left: 8px; border-left: 4px solid #c2410c; break-after: avoid; }
table { width: calc(100% - 2px); margin: 6px 1px 4px; border-collapse: collapse; table-layout: fixed; break-inside: avoid; }
tr.h th.n { white-space: normal; }
tr.h th .note { display: block; font-weight: 400; margin: 0; }
th, td { border: 1px solid #c9d1d6; padding: 5px 8px; text-align: left; vertical-align: middle; overflow-wrap: anywhere; }
thead th, tr.h th { background: #eef1f3; font-weight: 700; font-size: 9pt; }
th.k { background: #f6f7f8; width: 26%; font-weight: 600; }
td.n, th.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
tr.sum th, tr.sum td { background: #eef1f3; font-weight: 700; }
.cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }
.cards div { border: 1px solid #c9d1d6; border-radius: 6px; padding: 8px 10px; }
.cards div.main { border: 2px solid #1d2a33; }
.cards span { display: block; font-size: 8.5pt; color: #5b6770; }
.cards b { font-size: 15pt; font-variant-numeric: tabular-nums; }
.verdict { background: #f6f7f8; border-radius: 6px; padding: 8px 12px; margin: 8px 0; }
.g { color: #15803d; } .w { color: #a16207; } .b { color: #b91c1c; } td.g, td.w, td.b { font-weight: 700; }
.note { font-size: 8.5pt; color: #5b6770; margin: 4px 0; } ul { margin: 4px 0 4px 18px; padding: 0; } li { margin: 2px 0; }
.foot { margin-top: 18px; border-top: 1px solid #c9d1d6; padding-top: 6px; font-size: 8pt; color: #8a949b; display: flex; justify-content: space-between; }
.bar { position: sticky; top: 0; background: #fff; padding: 8px 0; border-bottom: 1px solid #ddd; margin-bottom: 12px; display: flex; gap: 10px; align-items: center; }
.bar button { font: inherit; padding: 6px 14px; border: 1px solid #c2410c; background: #c2410c; color: #fff; border-radius: 6px; cursor: pointer; }
.cl h2 { margin: 12px 0 5px; } .cl th, .cl td { padding: 3px 8px; } .cl table { margin: 3px 1px 2px; } .cl .cards { margin: 5px 0; } .cl .foot { margin-top: 8px; }
@media print { .bar { display: none; } body { padding: 0; max-width: none; } }
</style>`;
    const top = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>(개략)사업성검토서 - ${esc(zname)}</title>${css}</head><body>
<div class="bar"><button onclick="window.print()">PDF로 저장 · 인쇄</button> <span class="note">인쇄 창에서 '대상: PDF로 저장'을 고르면 PDF 파일로 저장됩니다.</span></div>
<div class="head"><div><div class="brand"><b>jbslab</b> 정비사업 개략 검토</div><h1>(개략)사업성검토서</h1><div class="zn">${esc(zname)}</div>
<div class="meta">${esc(S.meta.location || '')}${S.meta.location ? ' · ' : ''}검토일 ${today}</div></div>${mode === 'staff' ? '<div class="stamp">검토자용 · 1회차(교통·환경·경관 검토 전)</div>' : ''}</div>`;
    const staff = `

<h2>1. 결과 요약</h2>
<div class="cards">
  <div class="main"><span>추정 비례율(표준)</span><b class="${cls(r.ratio)}">${pct(r.ratio)}</b></div>
  <div><span>비례율 범위</span><b>${all.length ? fmt(Math.min(...all), 0) + '~' + fmt(Math.max(...all), 0) + '%' : '–'}</b></div>
  <div><span>총 세대수</span><b>${fmt(p.total)}세대</b></div>
  <div><span>평균 권리가액</span><b>${eok(right)}</b></div>
</div>
<div class="verdict">${!isFinite(r.ratio) ? '종전자산 또는 분양수입이 없어 비례율을 계산하지 못했습니다.' : r.ratio >= 100
  ? `표준 기준 비례율이 <b class="g">${pct(r.ratio)}</b>로 100% 이상입니다. 다만 공사비가 오르고 분양가가 내리는 보수 시나리오에서는 <b class="${cls(Math.min(...all))}">${pct(Math.min(...all))}</b>까지 내려갈 수 있습니다.`
  : `표준 기준 비례율이 <b class="${cls(r.ratio)}">${pct(r.ratio)}</b>로 100%에 <b>${fmt(100 - r.ratio, 1)}%p</b> 못 미칩니다. 범위는 ${pct(Math.min(...all))} ~ ${pct(Math.max(...all))}입니다(아래 5. 참고).`}
<br><span class="note">기준: 정비기반시설 ${lvName[lvNow]} ${fmt(q.infraPct, 1)}% · 시장 값 표준. 가정값으로 낸 개략 결과이며 감정평가·관리처분계획에 따라 달라집니다.</span></div>

<h2>2. 구역 개요</h2>
<table><tr><th class="k">구역 면적</th><td>${fmt(site)}㎡ (${fmt(site / PY)}평)</td></tr>
<tr><th class="k">용도지역</th><td>${esc(String(q.zone || '').replace(/_/g, ' '))}</td></tr>
<tr><th class="k">토지등소유자(조합원) 수</th><td>${fmt(q.members)}명</td></tr>
<tr><th class="k">필지 수</th><td>${fmt(S.lands.length)}필지${S.lands.length ? '' : ' (토지조서 없음 — 종전자산은 평균 공시지가로 추정)'}</td></tr></table>

<h2>3. 토지이용·건축 개략</h2>
<table><tr><th class="k">정비기반시설 비율</th><td>${lvName[lvNow]} ${fmt(q.infraPct, 1)}% → ${fmt(f.infra)}㎡ ${lvNow === 'min' ? `(${esc(mi.basis)})` : lvNow === 'custom' ? '' : '(실무 경험치, 가정값)'}</td></tr>
<tr><th class="k">공동주택 획지</th><td>${fmt(f.lot)}㎡</td></tr>
<tr><th class="k">적용 용적률</th><td>${fmt(f.v, 1)}% — ${esc(farTxt)}</td></tr>
<tr><th class="k">용적률 연면적</th><td>${fmt(p.farArea)}㎡ (주거 ${fmt(A.resRatio)}%, 나머지 근린생활시설)</td></tr>
<tr><th class="k">계획연면적(지하 포함)</th><td>${fmt(Calc.gfa(e.t))}㎡ (용적률 연면적 × ${A.gfaFactor})</td></tr></table>
<table><tr class="h"><th>평형</th><th class="n">세대</th><th class="n">세대당 공급면적(개략)</th><th class="n">조합원 평균 분담금</th></tr>${typeRows}
<tr><td>임대(49㎡형)</td><td class="n">${fmt(p.rentU)}</td><td class="n">${fmt(JbsFeas.supply(49) * (num(q.sizePct || 100) / 100), 1)}㎡</td><td class="n">–</td></tr>
<tr class="sum"><th>합계</th><td class="n">${fmt(p.total)}</td><td colspan="2" class="n">조합원 ${fmt(p.memTotal)} · 일반분양 ${fmt(p.total - p.rentU - p.memTotal)} · 임대 ${fmt(p.rentU)}</td></tr></table>

<h2>4. 사업성</h2>
<table><colgroup><col style="width:70%"><col></colgroup><tr class="h"><th>종후자산(총수입)</th><th class="n">금액</th></tr>${revRows}<tr class="sum"><th>합계</th><td class="n">${eok(r.rev.total)}</td></tr></table>
<table><colgroup><col style="width:70%"><col></colgroup><tr class="h"><th>총사업비</th><th class="n">금액</th></tr>${costRows}<tr class="sum"><th>합계</th><td class="n">${eok(r.cost.total)}</td></tr></table>
<table><tr><th class="k">종전자산</th><td>${eok(r.prior)} ${esc(e.priorNote ? '(' + e.priorNote + ')' : '')}</td></tr>
<tr><th class="k">검토 조건</th><td>정비기반시설 ${lvName[lvNow]} ${fmt(q.infraPct, 1)}% · 공사비 ${esc((this.CON_LV.find(x => x[0] === (q0.conLevel || 'base')) || [])[1] || '기준')} ${fmt(e.v.conPrice)}만원/평 · 조합원 분양가 일반분양가의 ${fmt(A.memberRatio)}% · 평형 비율 59·84·114㎡형 ${fmt(A.mix59)}·${fmt(A.mix84)}·${fmt(A.mix114)}%</td></tr>
<tr><th class="k">비례율</th><td><b class="${cls(r.ratio)}">${pct(r.ratio)}</b> = (종후자산 ${eok(r.rev.total)} − 총사업비 ${eok(r.cost.total)}) ÷ 종전자산 ${eok(r.prior)}</td></tr>
<tr><th class="k">조합원 분양가</th><td>${fmt(p.memberPrice)}만원/평 (일반분양가 ${fmt(A.generalPrice)}만원/평의 ${fmt(A.memberRatio)}%)</td></tr></table>

<h2>5. 범위로 본 비례율</h2>
<table><colgroup><col style="width:22%"><col style="width:12%"><col><col><col></colgroup><tr class="h"><th>정비기반시설 비율</th><th class="n">세대수</th>${this.SCEN.map(sc => `<th class="n">${sc.key}<span class="note">${sc.note}</span></th>`).join('')}</tr>
${grid.map(g => `<tr><td>${lvName[g.k]} ${fmt(g.v, 1)}%</td><td class="n">${fmt(g.units)}</td>${g.vals.map(v => `<td class="n ${cls(v)}">${pct(v)}</td>`).join('')}</tr>`).join('')}</table>
<p class="note">녹색 100% 이상 · 황색 90~100% · 적색 90% 미만. 공사비·분양가는 조정 수단이 아니라 시장이 정하는 값이라 시나리오로만 봅니다.</p>

<h2>6. 가정값</h2>
<table><colgroup><col style="width:55%"><col></colgroup>${assume}</table>
<p class="note">위 값은 모두 가정값(법정값 아님)이며 화면에서 바꿀 수 있습니다.</p>
<p class="note">평형별 공급면적은 표준 평면 라이브러리 개략값입니다. 용적률 체계는 2030 인천광역시 도시·주거환경정비기본계획 변경 고시(제2026-96호) 기준입니다. 가정값은 인근 시세·인천 정비계획 사례로 보정해야 합니다.</p>

<h2>6-1. 조합원 분양가 비율별 비교 <span class="note">(비례율이 분양가 비율 때문에 오른 것인지 구분)</span></h2>
<table><tr class="h"><th>조합원 분양가 비율</th><th class="n">조합원분양가</th><th class="n">비례율</th><th class="n">평균 권리가액</th>${[['59', p.u59], ['84', p.u84], ['114', p.u114]].filter(([, n]) => n > 0).map(([t]) => `<th class="n">${t}㎡형 분담금</th>`).join('')}</tr>
${this.MEM_LV.map(mm => { const ee = this.evaluate({ ...q, memberRatio: mm }), rr = ee.r.ratio, rt = num(q.members) > 0 && isFinite(rr) ? ee.r.prior / num(q.members) * rr / 100 : NaN;
  return `<tr${Math.abs(mm - num(A.memberRatio)) < 0.01 ? ' style="background:#fdeee6"' : ''}><td>${mm}%</td><td class="n">${fmt(ee.p.memberPrice)}만원/평</td><td class="n ${cls(rr)}">${pct(rr)}</td><td class="n">${eok(rt)}</td>${[['59', p.u59], ['84', p.u84], ['114', p.u114]].filter(([, n]) => n > 0).map(([t]) => { const c = isFinite(rt) ? ee.p.memberPrice * JbsFeas.supply(t) * (num(q.sizePct || 100) / 100) / PY - rt : NaN; return `<td class="n">${isFinite(c) ? (c >= 0 ? '' : '환급 ') + eok(Math.abs(c)) : '–'}</td>`; }).join('')}</tr>`; }).join('')}</table>
<p class="note">조합원 분양가를 올리면 비례율과 권리가액이 함께 올라 조합원 전체 부담은 비슷하고, 평형 사이에서 유불리가 옮겨 갑니다. 사업 자체의 이익은 일반분양 수입·사업비로 판단해야 합니다.</p>

<h2>7. 계획 손잡이별 비례율 변화</h2>
<table><colgroup><col style="width:34%"><col><col><col></colgroup><tr class="h"><th>손잡이</th><th class="n">내리면</th><th class="n">현재</th><th class="n">올리면</th></tr>
${lev.map(x => `<tr><td>${esc(x.L.label)}<span class="note" style="display:block">${esc(x.L.help)}</span></td><td class="n">${esc(x.loTxt)} → <b class="${cls(x.lo)}">${pct(x.lo)}</b></td><td class="n">${pct(x.base)}</td><td class="n">${esc(x.hiTxt)} → <b class="${cls(x.hi)}">${pct(x.hi)}</b></td></tr>`).join('')}</table>

<h2>8. 정비기반시설 비율별 결과 <span class="note">(용적률 산식 단계 기준)</span></h2>
<table><tr class="h"><th class="n">기반시설 비율</th><th class="n">산식 용적률</th><th class="n">세대수</th><th class="n">비례율</th></tr>
${scan.rows.map(x => `<tr${scan.best && x.i === scan.best.i ? ' style="background:#e3f4e8"' : ''}><td class="n">${fmt(x.i, 1)}%</td><td class="n">${fmt(x.far, 1)}%${x.capped ? ' (상한)' : ''}</td><td class="n">${fmt(x.units)}</td><td class="n ${cls(x.ratio)}">${pct(x.ratio)}</td></tr>`).join('')}</table>
${scan.best ? `<p class="note">비례율이 가장 높은 지점: 기반시설 ${fmt(scan.best.i, 1)}% (${pct(scan.best.ratio)}). 실제 기반시설은 무상양도 균형·법정 공원·진입도로를 먼저 맞춰야 합니다.</p>` : ''}

<h2>9. 공사비·분양가 민감도</h2>
<table><tr class="h"><th>공사비 ↓ / 일반분양가 →</th>${steps.map(g => `<th class="n">${sg(g)}</th>`).join('')}</tr>
${sens.map((row, i) => `<tr><th class="k">${sg(steps[i])}</th>${row.map((v, j) => `<td class="n ${cls(v)}"${steps[i] === 0 && steps[j] === 0 ? ' style="outline:2px solid #1d2a33;outline-offset:-2px"' : ''}>${pct(v)}</td>`).join('')}</tr>`).join('')}</table>

<h2>10. 산식</h2>
<table><colgroup><col style="width:24%"><col></colgroup>
<tr><th class="k">세대수</th><td>용적률 연면적 × 주거비율 ÷ 세대당 평균 공급면적. 평균 공급면적 = 임대비율 × 49㎡형 + (1 − 임대비율) × Σ(평형 비율 × 평형 공급면적)</td></tr>
<tr><th class="k">상한용적률(산식)</th><td>허용용적률 + 1.5 × (새로 설치하는 공공시설 − 용도폐지되는 설치된 기존 공공시설) ÷ 공동주택 획지 × 기준용적률, 상한 이내</td></tr>
<tr><th class="k">종전자산</th><td>토지조서 공시지가 합 × 보정배율(토지조서가 없으면 평균 공시지가 × 사유지 면적 × 보정배율)</td></tr>
<tr><th class="k">총사업비</th><td>공사비 단가 × 계획연면적(용적률 연면적 × 계획연면적 배율) + 기타 사업비(공사비 × 비율)</td></tr>
<tr><th class="k">비례율</th><td>(종후자산 − 총사업비) ÷ 종전자산 × 100</td></tr>
<tr><th class="k">조합원 분담금</th><td>평형 공급면적 × 조합원분양가 − 권리가액(평균 종전자산 × 비례율)</td></tr></table>

<h2>11. 적용 기준</h2>
<ul><li>용적률 체계·상한용적률 산식: 2030 인천광역시 도시·주거환경정비기본계획 변경 고시(인천광역시 고시 제2026-96호, 2026. 4. 27.)</li>
<li>무상양도: 도시 및 주거환경정비법 제97조(용도폐지되는 정비기반시설과 새로 설치하는 정비기반시설)</li>
<li>법정 공원: 도시공원 및 녹지 등에 관한 법률 시행규칙 별표 2(정비계획 5만㎡ 이상 — 세대당 2㎡ 또는 부지면적 5% 중 큰 면적)</li>
<li>진입도로: 주택건설기준 등에 관한 규정 제25조</li>
<li>기반시설 비율 평균·보수, 분양가, 공사비, 평형 공급면적: 가정값(인천 사례·시세로 보정 필요)</li></ul>

<h2>12. 한계와 다음 단계</h2>
<ul><li>이 검토는 1회차(정비기반시설을 비율로 잡은 개략 검토)입니다. 교통성·환경성·경관 검토 결과(도로 확폭, 높이·배치 조건)를 반영한 2회차에서 세대수와 비례율이 달라질 수 있습니다.</li>
<li>종전자산은 공시지가 × 보정배율로 추정했습니다. 실제 권리가액은 감정평가 결과에 따릅니다.</li>
<li>상가·부대복리시설 세부, 국공유지 처리, 세입자 손실보상, 금융비용 세부는 기타 사업비 비율로 묶어 개략 반영했습니다.</li></ul>
<div class="foot"><span>jbslab.co.kr · 개략 검토 자료(법적 효력 없음)</span><span>${today}</span></div>
</body></html>`;
    // 사용자용: 결과·주요 숫자만, 설명은 맨 아래 한 줄
    const sc = this.SCEN.map(x => ({ x, v: Calc.result(e.t, { construction: 1 + x.con / 100, general: 1 + x.gen / 100 }).ratio }));
    const scName = { 보수: '분양가 하락·공사비 상승 시', 표준: '기준', 낙관: '분양가 상승·공사비 하락 시' };
    const c84 = p.u84 ? chg(JbsFeas.supply(84) * (num(q.sizePct || 100) / 100)) : '–';
    const client = `<div class="cl">
<h2>1. 결과 요약</h2>
<div class="cards">
  <div class="main"><span>추정 비례율</span><b>${pct(r.ratio)}</b></div>
  <div><span>총 세대수</span><b>${fmt(p.total)}세대</b></div>
  <div><span>평균 권리가액</span><b>${eok(right)}</b></div>
  <div><span>84㎡형 평균 분담금</span><b>${c84}</b></div>
</div>

<h2>2. 구역 개요</h2>
<table><tr><th class="k">구역 면적</th><td>${fmt(site)}㎡ (${fmt(site / PY)}평)</td></tr>
<tr><th class="k">용도지역</th><td>${esc(String(q.zone || '').replace(/_/g, ' '))}</td></tr>
<tr><th class="k">토지등소유자 수</th><td>${fmt(q.members)}명</td></tr></table>

<h2>3. 토지이용·건축 계획(개략)</h2>
<table><tr><th class="k">정비기반시설</th><td>${fmt(f.infra)}㎡ (구역 면적의 ${fmt(q.infraPct, 1)}%)</td></tr>
<tr><th class="k">공동주택 용지</th><td>${fmt(f.lot)}㎡</td></tr>
<tr><th class="k">용적률</th><td>${fmt(f.v, 1)}%</td></tr>
<tr><th class="k">연면적(지상)</th><td>${fmt(p.farArea)}㎡</td></tr></table>
<table><tr class="h"><th>평형</th><th class="n">세대</th><th class="n">조합원 평균 분담금</th></tr>
${[['59', p.u59], ['84', p.u84], ['114', p.u114]].filter(([, n]) => n > 0).map(([t, n]) => `<tr><td>${t}㎡형</td><td class="n">${fmt(n)}</td><td class="n">${chg(JbsFeas.supply(t) * (num(q.sizePct || 100) / 100))}</td></tr>`).join('')}
<tr><td>임대</td><td class="n">${fmt(p.rentU)}</td><td class="n">–</td></tr>
<tr class="sum"><th>합계</th><td class="n">${fmt(p.total)}</td><td class="n">조합원 ${fmt(p.memTotal)} · 일반분양 ${fmt(p.total - p.rentU - p.memTotal)}</td></tr></table>

<h2>4. 사업성</h2>
<table><colgroup><col style="width:26%"><col></colgroup>
<tr><th class="k">총수입(종후자산)</th><td class="n">${eok(r.rev.total)}</td></tr>
<tr><th class="k">총사업비</th><td class="n">${eok(r.cost.total)}</td></tr>
<tr><th class="k">종전자산</th><td class="n">${eok(r.prior)}</td></tr>
<tr class="sum"><th>추정 비례율</th><td class="n">${pct(r.ratio)}</td></tr>
<tr><th class="k">적용 단가</th><td class="n">일반분양가 ${fmt(A.generalPrice)} · 조합원분양가 ${fmt(p.memberPrice)} · 공사비 ${fmt(e.v.conPrice)} (만원/평)</td></tr></table>
<table><tr class="h"><th>분양가·공사비 변동 시 비례율</th>${sc.map(o => `<th class="n">${scName[o.x.key] || o.x.key}</th>`).join('')}</tr><tr><td>추정 비례율</td>${sc.map(o => `<td class="n">${pct(o.v)}</td>`).join('')}</tr></table>

<p class="note" style="margin-top:10px">※ 본 자료는 개략 검토 결과로, 인허가 및 심의 과정에서 변동될 수 있습니다.</p>
<div class="foot"><span>jbslab.co.kr</span><span>${today}</span></div></div>
</body></html>`;
    const html = mode === 'staff' ? top + staff : top + client;
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 막혀 검토서를 열지 못했습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  },
  reset() { if (confirm('빠른 사업성 입력값과 공통 가정값(분양가·공사비 등, /urban 사업성 탭과 같이 씀)을 기본값으로 되돌릴까요?')) { JbsFeas.reset(); S.quick = {}; this.ensure(); App.update(true); } },
};

// ---------- 탭 ----------
Tabs.quick = {
  render() {
    Quick.ensure();
    const zs = $('#qk_zone');
    if (zs && !zs.options.length) zs.innerHTML = Quick.zones().map(z => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join('');
    bindInputs($('#tab-quick'));
    // 공통 가정값 입력: 값 채우기·고치면 공통 저장소에 저장
    const A = JbsFeas.get();
    $$('#tab-quick [data-feas]').forEach(inp => {
      if (document.activeElement !== inp) inp.value = A[inp.dataset.feas] || (inp.dataset.feas === 'avgLand' ? '' : A[inp.dataset.feas]);
      if (inp._fb) return; inp._fb = true; inp.setAttribute('type', 'number'); inp.setAttribute('inputmode', 'decimal');
      inp.addEventListener('input', () => { JbsFeas.set({ [inp.dataset.feas]: num(inp.value) }); App.update(); });
    });
    if (!this._bound) {
      this._bound = true;
      $('#qkApply').onclick = () => Quick.apply();
      if ($('#qkReport')) $('#qkReport').onclick = () => Quick.report('client');
      if ($('#qkReportStaff')) $('#qkReportStaff').onclick = () => Quick.report('staff');
      $('#qkReset').onclick = () => Quick.reset();
      if ($('#qkToReview')) $('#qkToReview').onclick = () => { const st = Quick.toReview(); if (st) { Quick.reviewLinks(); $('#qkReviewBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } };
      $('#qkZoneFromMeta').onclick = () => { S.quick.zone = Quick.zoneKey(S.meta.zoning); S.quick.zoneSrc = S.meta.zoning; S.quick.zoneManual = false; App.update(true); };
      $('#qk_zone').addEventListener('change', () => { S.quick.zoneManual = true; });
      if ($('#qk_members')) $('#qk_members').addEventListener('input', () => { S.quick.membersManual = true; });
    }
    this.refresh();
    Quick.reviewLinks();
    Quick.caseUi();
  },
  // 배치 확인: 구역계가 정해지면 /arch와 같은 엔진으로 한 번 개략 배치(일꾼에서) — 목표 연면적이 땅 모양·정북 일조·인동간격으로 다 들어가는지
  layoutCheck(q, f) {
    if (!S.area.geojson || !(f.lot > 0) || !window.Worker) return;
    const g = S.area.geojson.geometry || S.area.geojson;
    const ring = g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.slice().sort((a, b) => turf.area(turf.polygon(b)) - turf.area(turf.polygon(a)))[0][0] : null;
    if (!ring) return;
    const mix = JbsFeas.mixOf(JbsFeas.get()), zk = zoneKey(S.area.geojson);
    const key = [zk, Math.round(f.lot), f.v, JSON.stringify(mix), S.meta.zoning || ''].join('|');
    const L0 = S.quick.layout;
    if (L0 && L0.key === key) return;
    if (this._layKey === key) return;
    this._layKey = key;
    try {
      if (!this._lw) { this._lw = new Worker('shared/layout-worker.js?v=10'); this._lw.onerror = () => { this._layKey = ''; this._lw = null; }; }
      const id = (this._lid = (this._lid || 0) + 1);
      this._lw.onmessage = e => {
        if (e.data.id !== this._lid) return;
        const r = e.data.r; this._layKey = '';
        S.quick.layout = r ? Object.assign({ key, zone: zk, at: new Date().toLocaleString('sv-SE').slice(0, 16) }, r) : { key, zone: zk, fail: e.data.err || '배치 실패' };
        App.persist(); if ($('#tab-quick') && !$('#tab-quick').hidden) App.update(true);
      };
      this._lw.postMessage({ id, ring, lot: f.lot, far: f.v, mix, zoning: S.meta.zoning || '' });
    } catch (e) { this._layKey = ''; }
  },
  layoutLine(q, f) {
    const L0 = q.layout, zk = S.area.geojson ? zoneKey(S.area.geojson) : '';
    if (!zk || !window.Worker) return '';
    if (!L0 || L0.zone !== zk || this._layKey) return `<p class="note">배치 확인 중… 이 구역에 /arch와 같은 방식으로 동을 놓아 목표 용적률이 다 들어가는지 봅니다(몇 초).</p>`;
    if (L0.fail) return `<p class="note">배치 확인: ${esc(L0.fail)}</p>`;
    const pct = L0.target > 0 ? L0.gfa / L0.target * 100 : 100, short = pct < 97;
    return `<div class="${short ? 'warn-box' : 'note'}" style="margin:8px 0">배치 확인(개략, 판상·정북 일조·인동간격 0.8·채광창 이격): <b>${fmt(L0.n)}개동 · ${fmt(L0.units)}세대 · 최고 ${L0.maxFloors}층</b>, 들어간 용적률 <b>${fmt(L0.far, 1)}%</b>(목표 ${fmt(f.v, 1)}%의 ${fmt(pct, 0)}%).
      ${short ? `<br>땅 모양·일조 제한 때문에 목표 용적률을 다 채우지 못할 수 있습니다. <label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" id="qkUseLay" ${q.useLayoutFar ? 'checked' : ''}> 배치 기준 용적률(${fmt(L0.far, 1)}%)로 사업성 계산</label>` : ' 목표 연면적이 다 들어갑니다.'}
      <span class="note">· 도로 자료 없이 대지경계로 본 보수적 값, 기반시설 위치는 반영 전 — 자세한 배치는 /arch</span></div>`;
  },
  // 조합원 수가 무엇으로 셈한 값인지(대장 조회 전이면 건물 동 수라 작게 나옴) 칸 아래에 보여 줌
  memSrc(q) {
    const el = $('#qk_memSrc'); if (!el) return;
    if (q.membersManual) { el.innerHTML = '직접 넣은 값 <button type="button" class="link-btn" id="qkMemAuto">자동 추정으로 되돌리기</button>'; }
    else if (!S.buildings.length && !S.lands.length) el.textContent = '조서가 아직 없습니다 — 구역을 만들면 토지·건축물대장을 불러와 셉니다';
    else if (Tabs.survey._ledgerRun || MapView.importing) {
      // 진행 상황(3탭 조회 문구)을 그대로 보여 주고 1초마다 새로 그림. 6분 넘게 안 끝나면 다시 시작 버튼
      const t0 = Tabs.survey._ledgerT0 || Date.now(), sec = Math.round((Date.now() - t0) / 1000);
      const pm = ($('#ledgerMsg') && $('#ledgerMsg').innerText || '').replace(/\s+/g, ' ').trim();
      el.innerHTML = `<b class="warn">건축물대장(세대·호수) 불러오는 중… ${sec >= 60 ? Math.floor(sec / 60) + '분 ' : ''}${sec % 60}초</b>${pm ? ` — ${esc(pm.slice(0, 120))}` : ''}`
        + (sec > 360 ? ' <button type="button" class="link-btn" id="qkMemRetry">너무 오래 걸립니다 — 다시 시작</button>' : ' 끝나면 자동으로 바뀝니다');
      clearTimeout(this._memT);
      this._memT = setTimeout(() => { if ($('#tab-quick') && !$('#tab-quick').hidden) this.memSrc(S.quick || q); }, 1000);
      const rt = $('#qkMemRetry'); if (rt) rt.onclick = async () => { Tabs.survey._ledgerRun = false; MapView.importing = false; await Tabs.survey.bldgLedger(true); App.update(true); };
    }
    else {
      const led = S.buildings.filter(b => b.ledger), noLed = S.buildings.filter(b => !b.ledger);
      const units = S.buildings.reduce((a, b) => a + (Math.max(num(b.hoCount), num(b.units)) || 1), 0);
      const withB = new Set(S.buildings.map(b => b.pnu).filter(Boolean));
      const bare = S.lands.filter(l => l.jimok === '대' && l.pnu && !withB.has(l.pnu)).length;
      el.innerHTML = `셈: 건축물 ${fmt(S.buildings.length)}동의 세대·호 ${fmt(units)}${bare ? ` + 건물 없는 대지 ${fmt(bare)}필지` : ''}`
        + (noLed.length ? ` · <b class="warn">건축물대장 미조회 ${fmt(noLed.length)}동(1동 = 1명으로 셈)</b> <button type="button" class="link-btn" id="qkMemLedger">다시 불러오기</button>` : led.length ? ' (건축물대장 기준)' : '');
    }
    // 대장 안 받은 건물이 있으면 누르지 않아도 바로 받기 시작(구역마다 한 번 — 실패하면 버튼으로 다시)
    try {
      const k = S.area.geojson ? zoneKey(S.area.geojson) : '';
      if (!q.membersManual && Ledger.enabled && k && this._ledAuto !== k && !Tabs.survey._ledgerRun && !MapView.importing
        && S.buildings.some(b => !b.ledger) && S.lands.some(l => /^\d{19}$/.test(String(l.pnu || '')))) {
        this._ledAuto = k;
        setTimeout(async () => { await Tabs.survey.bldgLedger(); App.update(true); }, 0);
      }
    } catch (e) { /* 무시 */ }
    const a = $('#qkMemAuto'); if (a) a.onclick = () => { S.quick.membersManual = false; App.update(true); };
    const l = $('#qkMemLedger'); if (l) l.onclick = async () => { l.disabled = true; l.textContent = '불러오는 중…'; this.memSrc(S.quick); await Tabs.survey.bldgLedger(true); App.update(true); };
  },
  refresh() {
    if (!this._layBound) { this._layBound = true; document.addEventListener('change', ev => { if (ev.target && ev.target.id === 'qkUseLay') { S.quick.useLayoutFar = ev.target.checked; App.update(true); } }); }
    const q0 = Quick.ensure();
    bindInputs($('#tab-quick'));
    this.memSrc(q0);
    // 고른 단계(최소·평균·보수)를 실제 비율로 바꿔 아래 계산·손잡이·표에 씀
    const q = { ...q0, infraLevel: 'custom', infraPct: Quick.levelPct(q0, q0.infraLevel || 'avg') };
    const pin = $('#qk_infraPct'); if (pin) pin.disabled = (q0.infraLevel || 'avg') !== 'custom';
    const out = $('#qkOut'); if (!out) return;
    const site = Calc.siteArea(S);
    if (!(site > 0)) { out.innerHTML = '<p class="warn-box">구역 면적이 없습니다. <b>2 구역계</b>에서 구역을 그리거나 면적을 직접 넣으면 바로 계산됩니다.</p>'; $('#qkLevers').innerHTML = ''; $('#qkScan').innerHTML = ''; return; }
    const e = Quick.evaluate(q), f = e.f, p = e.p, r = e.r;
    this.layoutCheck(q0, f);
    const scen = Quick.SCEN.map(sc => ({ sc, ratio: Calc.result(e.t, { construction: 1 + sc.con / 100, general: 1 + sc.gen / 100 }).ratio }));
    const avgPrior = num(q.members) > 0 ? r.prior / num(q.members) : 0;
    const right = isFinite(r.ratio) ? avgPrior * r.ratio / 100 : NaN;
    const charge = sup => { if (!isFinite(right)) return '–'; const c = p.memberPrice * sup / PY - right; return `${c >= 0 ? '' : '환급 '}${fmtEok(Math.abs(c))}`; };
    const farTxt = q.farStep === 'calc'
      ? `산식: 허용 ${f.z.allowed}% + ${f.coef} × 공공시설 제공 ${fmt(f.pa)}㎡ ÷ 획지 ${fmt(f.lot)}㎡ × 기준 ${f.z.base}% = ${fmt(f.raw, 1)}%${f.capped ? ` → 상한 ${f.z.max}%` : ''}`
      : q.farStep === 'base' ? `기준용적률 ${f.z.base}%` : q.farStep === 'allowed' ? `허용용적률 ${f.z.allowed}% (인센티브 다 받는다고 가정)` : `직접 입력(상한 ${f.z.max}% 이내)`;
    const warn = [];
    if (Tabs.survey && Tabs.survey.stale()) warn.push(MapView.importing || MapView.ledgerBusy ? '구역 안 토지·건축물을 불러오는 중입니다. 끝나면 조합원 수·종전자산이 새 구역 기준으로 바뀝니다.' : '토지·건축물 조서가 지금 구역 기준이 아닙니다(예전 구역). <button type="button" class="btn small" onclick="Tabs.survey.reimport().then(()=>App.update(true))">지금 구역으로 불러오기</button>');
    if (!(r.prior > 0)) warn.push('종전자산이 0입니다. 3탭 토지조서(공시지가)를 채우거나, 아래 <b>평균 공시지가</b>를 넣으면 비례율이 나옵니다.');
    if (!num(q.members)) warn.push('조합원 수가 0입니다. 토지등소유자 수(추정)를 넣으세요.');
    if (p.short) warn.push(`조합원 ${fmt(q.members)}명보다 분양 세대가 ${fmt(p.short)}세대 부족합니다.`);
    if (q.farStep === 'calc' && !S.lands.length) warn.push('토지조서가 없어 기존 공공시설(도로 등) 면적을 0으로 보고 산식 용적률을 냈습니다. 실제로는 기존 도로를 빼야 해서 용적률이 더 낮을 수 있습니다.');
    const tgt = num(q.target) || 100;
    out.innerHTML = this.layoutLine(q0, f) + `
      <div class="qk-head">
        <div class="qk-ratio ${ratioClass(r.ratio)}"><span>1차 비례율 (표준)</span><b>${fmtPct(r.ratio)}</b><em>${isFinite(r.ratio) ? (r.ratio >= tgt ? `목표 ${tgt}% 이상` : `목표 ${tgt}%까지 ${fmt(tgt - r.ratio, 1)}%p 부족`) : '계산 전'}</em></div>
        <div class="qk-scen">${scen.map(x => `<div class="${ratioClass(x.ratio)}"><span>${x.sc.key}</span><b>${fmtPct(x.ratio)}</b><em>${x.sc.note}</em></div>`).join('')}</div>
      </div>
      ${(() => {
        const mi = Quick.minInfra(q0), lv = [['min', '최소', mi.v, mi.basis], ['avg', '평균', Quick.INFRA.avg, '실무 경험치(가정값)'], ['cons', '보수적', Quick.INFRA.cons, '도로·공원을 더 내놓는 경우(가정값)']];
        const cur = q0.infraLevel || 'avg';
        return `<div class="qk-levels"><div class="qk-lv-h">정비기반시설(도로·공원 등) 비율별 사업성 <small>표준 시나리오</small></div>${lv.map(([k, nm, v, b]) => {
          const rr = Quick.ratio({ ...q, infraPct: v });
          return `<button type="button" class="qk-lv ${ratioClass(rr)}${cur === k ? ' on' : ''}" data-lv="${k}"><span>${nm} ${fmt(v, 1)}%</span><b>${fmtPct(rr)}</b><em>${esc(b)}</em></button>`;
        }).join('')}</div>`;
      })()}
      ${(() => {
        const cur = q0.conLevel || 'base';
        return `<div class="qk-levels qk4"><div class="qk-lv-h">공사비 수준별 사업성 <small>기준 ${fmt(q0.conPrice)}만원/평(계획연면적)</small></div>${Quick.CON_LV.map(([k, nm, d]) => {
          const rr = Quick.ratio({ ...q, conLevel: k });
          return `<button type="button" class="qk-lv ${ratioClass(rr)}${cur === k ? ' on' : ''}" data-con="${k}"><span>${nm}${d ? ` ${d > 0 ? '+' : '−'}${Math.abs(d)}%` : ''}</span><b>${fmtPct(rr)}</b><em>${fmt(q0.conPrice * (1 + d / 100))}만원/평</em></button>`;
        }).join('')}</div>`;
      })()}
      ${(() => {
        const curM = num(q0.memberRatio);
        return `<div class="qk-levels"><div class="qk-lv-h">조합원 분양가 비율별 사업성 <small>일반분양가 ${fmt(q0.generalPrice)}만원/평 대비 · 비례율과 함께 84㎡형 평균 분담금을 보세요</small></div>${Quick.MEM_LV.map(m => {
          const ee = Quick.evaluate({ ...q, memberRatio: m }), rr = ee.r.ratio;
          const rt = num(q.members) > 0 && isFinite(rr) ? ee.r.prior / num(q.members) * rr / 100 : NaN;
          const c84 = isFinite(rt) ? ee.p.memberPrice * ee.v.sup84 / PY - rt : NaN;
          return `<button type="button" class="qk-lv ${ratioClass(rr)}${Math.abs(curM - m) < 0.01 ? ' on' : ''}" data-mem="${m}"><span>${m}% (${fmt(q0.generalPrice * m / 100)}만원/평)</span><b>${fmtPct(rr)}</b><em>84㎡형 분담금 ${isFinite(c84) ? (c84 >= 0 ? '' : '환급 ') + fmtEok(Math.abs(c84)) : '–'}</em></button>`;
        }).join('')}</div>`;
      })()}
      ${(() => {
        const A0 = JbsFeas.get();
        return `<div class="qk-levels"><div class="qk-lv-h">평형 비율별 사업성 <small>59·84·114㎡형 분양 세대 비율 · 지금 ${fmt(A0.mix59)}·${fmt(A0.mix84)}·${fmt(A0.mix114)}</small></div>${Quick.MIX_LV.map(([k, nm, a, b2, c]) => {
          const ee = Quick.evaluate({ ...q, mix59: a, mix114: c });
          const on = Math.abs(A0.mix59 - a) < 0.01 && Math.abs(A0.mix84 - b2) < 0.01 && Math.abs(A0.mix114 - c) < 0.01;
          return `<button type="button" class="qk-lv ${ratioClass(ee.r.ratio)}${on ? ' on' : ''}" data-mix="${a},${b2},${c}"><span>${nm} ${a}·${b2}·${c}</span><b>${fmtPct(ee.r.ratio)}</b><em>${fmt(ee.p.total)}세대 (조합원 ${fmt(ee.p.memTotal)} · 일반 ${fmt(ee.p.total - ee.p.rentU - ee.p.memTotal)})</em></button>`;
        }).join('')}</div>`;
      })()}
      <div class="as-grid">
        <div><span>구역 면적</span><b>${fmt(site)}㎡</b><em>기반시설 ${fmt(q.infraPct)}% → 획지 ${fmt(f.lot)}㎡</em></div>
        <div><span>적용 용적률</span><b>${fmt(f.v, 1)}%</b><em>${esc(q.zone.replace(/_/g, ' '))}</em></div>
        <div><span>총 세대수</span><b>${fmt(p.total)}세대</b><em>59㎡ ${fmt(p.u59)} · 84㎡ ${fmt(p.u84)}${p.u114 ? ` · 114㎡ ${fmt(p.u114)}` : ''} · 임대 ${fmt(p.rentU)}</em></div>
        <div><span>조합원 / 일반분양</span><b>${fmt(p.memTotal)} / ${fmt(p.total - p.rentU - p.memTotal)}세대</b></div>
        <div><span>총수입</span><b>${fmtEok(r.rev.total)}</b></div>
        <div><span>총사업비</span><b>${fmtEok(r.cost.total)}</b><em>계획연면적 ${fmt(Calc.gfa(e.t))}㎡</em></div>
        <div><span>종전자산</span><b>${fmtEok(r.prior)}</b><em>${esc(e.priorNote)}</em></div>
        <div><span>평균 분담금 (59㎡ / 84㎡)</span><b>${charge(e.v.sup59)} / ${charge(e.v.sup84)}</b><em>평균 권리가액 ${fmtEok(right)}</em></div>
      </div>
      <p class="note">${esc(farTxt)}. 용적률 체계는 2030 인천 도시·주거환경정비기본계획 변경 고시(제2026-96호) 기준입니다. 평면 공급면적은 표준 평면 라이브러리의 개략값(검증필요)입니다.</p>
      ${warn.map(w => `<p class="warn-box">${w}</p>`).join('')}`;

    out.querySelectorAll('[data-lv]').forEach(b => { b.onclick = () => { S.quick.infraLevel = b.dataset.lv; App.update(true); }; });
    out.querySelectorAll('[data-con]').forEach(b => { b.onclick = () => { S.quick.conLevel = b.dataset.con; App.update(true); }; });
    out.querySelectorAll('[data-mix]').forEach(b => { b.onclick = () => { const [a, b2, c] = b.dataset.mix.split(',').map(Number); JbsFeas.set({ mix39: 0, mix49: 0, mix74: 0, mix101: 0, mix59: a, mix84: b2, mix114: c }); App.update(true); }; });
    out.querySelectorAll('[data-mem]').forEach(b => { b.onclick = () => { JbsFeas.set({ memberRatio: num(b.dataset.mem) }); App.update(true); }; });
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
