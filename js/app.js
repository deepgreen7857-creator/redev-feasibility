'use strict';

// ---------- 입력 바인딩 ----------
// data-bind="경로", data-type="number", data-scale="10000"(억원 입력 → 만원 저장), data-rerender
function bindInputs(root = document) {
  $$('[data-bind]', root).forEach(inp => {
    const p = inp.dataset.bind;
    const isNum = inp.dataset.type === 'number';
    const scale = num(inp.dataset.scale) || 1;
    const v = getPath(S, p);
    if (inp.type === 'radio') inp.checked = inp.value === v;
    else if (inp.type === 'checkbox') inp.checked = !!v;
    else if (document.activeElement !== inp) inp.value = isNum ? (v ? +(v / scale).toFixed(4) : (inp.tagName === 'SELECT' ? v : '')) : (v ?? '');
    if (inp._bound) return;
    inp._bound = true;
    const ev = inp.tagName === 'SELECT' || inp.type === 'radio' || inp.type === 'checkbox' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      if (inp.type === 'radio' && !inp.checked) return;
      const val = inp.type === 'checkbox' ? inp.checked : isNum ? num(inp.value) * scale : inp.value;
      setPath(S, p, val);
      App.update(!!inp.dataset.rerender);
    });
  });
}

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ratioClass(r) {
  if (!isFinite(r)) return '';
  return r >= 100 ? 'good' : r >= 90 ? 'warn' : 'bad';
}

// ---------- 탭 ----------
const Tabs = {
  overview: {
    render() {
      const sel = $('#zoningSelect');
      if (!sel.options.length) ZONINGS.forEach(z => sel.add(new Option(z, z)));
      bindInputs($('#tab-overview'));
      this.refresh();
    },
    refresh() {
      const site = Calc.siteArea(S);
      const gfa = Calc.gfa(S);
      $('#planStats').innerHTML = `
        <div><span>적용 대지면적</span><strong>${fmt(site)}㎡</strong><em>${fmt(site / PY)}평</em></div>
        <div><span>계획 연면적 ${num(S.plan.gfaManual) > 0 ? '(직접 입력)' : '(추정)'}</span><strong>${fmt(gfa)}㎡</strong><em>${fmt(gfa / PY)}평</em></div>
        <div><span>사업 유형</span><strong>${TYPES[S.meta.type].label}</strong><em>${TYPES[S.meta.type].law}</em></div>`;
    },
  },

  area: {
    render() {
      bindInputs($('#tab-area'));
      MapView.init();
      this.refresh();
    },
    refresh() {
      $('#drawnArea').textContent = S.area.drawnArea ? `${fmt(S.area.drawnArea)}㎡` : '(없음)';
      $('#landsArea').textContent = `${fmt(Calc.landTotal(S))}㎡`;
      const site = Calc.siteArea(S);
      $('#siteArea').innerHTML = `${fmt(site)}㎡ <em>${fmt(site / PY)}평</em>`;
    },
  },

  survey: {
    lands: null,
    buildings: null,
    render() {
      bindInputs($('#tab-survey'));
      this.lands = makeTable($('#landsTable'), {
        rows: S.lands,
        addLabel: '필지 추가',
        emptyText: '필지를 추가하거나 CSV를 불러오세요.',
        newRow: () => ({ id: uid(), jibun: '', jimok: '대', area: 0, ownerType: '사유지', owner: '', price: 0 }),
        onChange: () => App.update(),
        columns: [
          { key: 'jibun', label: '지번', width: 80 },
          { key: 'jimok', label: '지목', type: 'select', options: JIMOK },
          { key: 'area', label: '면적 (㎡)', type: 'number', dec: 1, width: 90 },
          { key: 'ownerType', label: '소유 구분', type: 'select', options: ['사유지', '국공유지'] },
          { key: 'owner', label: '소유자', width: 90 },
          { key: 'price', label: '공시지가 (원/㎡)', type: 'number', width: 120 },
          { key: 'value', label: '공시가격', computed: r => fmtEok(num(r.area) * num(r.price) / 10000, 2) },
          { key: 'small', label: '비고', computed: r => (r.jimok === '대' && num(r.area) > 0 && num(r.area) < 90 ? '과소필지' : ''), cls: () => 'tag' },
        ],
        footer: rows => ({ jibun: `${rows.length}필지`, area: fmt(rows.reduce((a, r) => a + num(r.area), 0), 1), value: fmtEok(Calc.officialLandValue(S), 2) }),
      });
      const year = new Date().getFullYear();
      this.buildings = makeTable($('#buildingsTable'), {
        rows: S.buildings,
        addLabel: '건축물 추가',
        emptyText: '건축물을 추가하거나 CSV를 불러오세요.',
        newRow: () => ({ id: uid(), jibun: '', use: '단독주택', structure: '조적', year: 0, floorArea: 0, units: 1 }),
        onChange: () => App.update(),
        columns: [
          { key: 'jibun', label: '지번', width: 80 },
          { key: 'use', label: '용도', type: 'select', options: BLDG_USES },
          { key: 'structure', label: '구조', type: 'select', options: STRUCTURES },
          { key: 'year', label: '사용승인연도', type: 'number', width: 90 },
          { key: 'floorArea', label: '연면적 (㎡)', type: 'number', dec: 1, width: 90 },
          { key: 'units', label: '호·세대수', type: 'number', width: 70 },
          { key: 'age', label: '경과연수', computed: r => (num(r.year) ? `${year - num(r.year)}년` : '–') },
          { key: 'old', label: '노후 판정', computed: r => (Calc.isOld(S, r, year) ? '노후' : '–'), cls: r => (Calc.isOld(S, r, year) ? 'tag bad' : 'tag') },
        ],
        footer: rows => ({ jibun: `${rows.length}동`, floorArea: fmt(rows.reduce((a, r) => a + num(r.floorArea), 0), 1), units: fmt(rows.reduce((a, r) => a + num(r.units), 0)) }),
      });
      this.refresh();
    },
    refresh() {
      this.lands && this.lands.refresh();
      this.buildings && this.buildings.refresh();
      const sv = Calc.survey(S);
      $('#oldStats').innerHTML = `
        <div><span>건축물</span><b>${fmt(sv.count)}동</b></div>
        <div><span>노후·불량건축물</span><b>${fmt(sv.old)}동</b></div>
        <div class="hl"><span>노후도 (동수 기준)</span><b class="${sv.oldRatio >= 60 ? 'good' : ''}">${fmtPct(sv.oldRatio)}</b></div>
        <div><span>노후도 (연면적 기준)</span><b>${fmtPct(sv.oldAreaRatio)}</b></div>
        <div><span>단독·다가구</span><b>${fmt(sv.detached)}호</b></div>
        <div><span>공동주택</span><b>${fmt(sv.apartment)}세대</b></div>
        <div><span>토지</span><b>${fmt(sv.landCount)}필지 · ${fmt(sv.landArea)}㎡</b></div>
        <div><span>국공유지</span><b>${fmt(sv.publicArea)}㎡ (${fmtPct(sv.landArea ? sv.publicArea / sv.landArea * 100 : NaN)})</b></div>
        <div><span>과소필지 (90㎡ 미만)</span><b>${fmt(sv.small)}필지</b></div>
        <div><span>토지 소유자</span><b>${fmt(sv.owners)}명</b></div>`;
      $('#reqTitle').textContent = `${TYPES[S.meta.type].label} 요건 검토`;
      const reqs = Calc.requirements(S, sv);
      $('#reqList').innerHTML = reqs.map(r => `
        <li class="${r.pass === true ? 'ok' : r.pass === false ? 'ng' : 'na'}">
          <span class="mark" aria-hidden="true">${r.pass === true ? '✓' : r.pass === false ? '✕' : '?'}</span>
          <div><b>${esc(r.label)}</b><small>현황 ${esc(r.value)} · 기준 ${esc(r.need)}</small>
          ${r.check ? `<label class="chk"><input type="checkbox" data-check="${r.check}" ${S.checks[r.check] ? 'checked' : ''}> 확인 완료로 표시</label>` : ''}</div>
        </li>`).join('');
      $$('#reqList [data-check]').forEach(c => { c.onchange = () => { S.checks[c.dataset.check] = c.checked; App.update(); }; });
    },
  },

  revenue: {
    table: null,
    render() {
      this.table = makeTable($('#salesTable'), {
        rows: S.sales,
        addLabel: '평형 추가',
        newRow: () => sale('일반', '', 0, 0, 0),
        onChange: () => App.update(),
        columns: [
          { key: 'cat', label: '구분', type: 'select', options: SALE_CATS },
          { key: 'name', label: '평형·명칭', width: 100, placeholder: '예: 84㎡' },
          { key: 'units', label: '세대(실)수', type: 'number', width: 80 },
          { key: 'area', label: '공급면적 (㎡)', type: 'number', dec: 1, width: 90 },
          { key: 'py', label: '공급면적 (평)', computed: r => fmt(num(r.area) / PY, 1) },
          { key: 'price', label: '평당 분양가 (만원)', type: 'number', width: 110 },
          { key: 'unit', label: '세대당 분양가', computed: r => fmtEok(num(r.area) / PY * num(r.price), 2) },
          { key: 'amount', label: '분양수입', computed: r => fmtEok(Calc.saleAmount(r)) },
        ],
        footer: rows => ({ cat: '합계', units: fmt(rows.reduce((a, r) => a + num(r.units), 0)), amount: fmtEok(Calc.revenue(S).total) }),
      });
      this.refresh();
    },
    refresh() {
      this.table && this.table.refresh();
      const rev = Calc.revenue(S);
      $('#revStats').innerHTML = SALE_CATS.map(c => `<div><span>${c} 분양</span><strong>${fmtEok(rev.byCat[c])}</strong><em>${fmtPct(rev.total ? rev.byCat[c] / rev.total * 100 : NaN)}</em></div>`).join('')
        + `<div class="hl"><span>종후자산 총액</span><strong>${fmtEok(rev.total)}</strong></div>`;
    },
  },

  cost: {
    table: null,
    render() {
      this.table = makeTable($('#costTable'), {
        rows: S.costs,
        addLabel: '사업비 항목 추가',
        newRow: () => cost('관리비', '', 'fixed', 0),
        onChange: () => App.update(),
        columns: [
          { key: 'group', label: '항목군', type: 'select', options: COST_GROUPS },
          { key: 'name', label: '세부 항목', width: 180 },
          { key: 'basis', label: '산정 방식', type: 'select', options: BASIS },
          { key: 'value', label: '입력값', type: 'number', dec: 2, width: 100 },
          { key: 'amount', label: '금액', computed: (r, i) => fmtEok(this.items()[i]?.amount ?? 0, 2) },
          { key: 'share', label: '비중', computed: (r, i) => { const c = this.calc(); return fmtPct(c.total ? c.items[i].amount / c.total * 100 : NaN); } },
        ],
        footer: () => ({ group: '합계', amount: fmtEok(this.calc().total, 2) }),
      });
      this.refresh();
    },
    calc() { return Calc.costs(S, Calc.revenue(S).total); },
    items() { return this.calc().items; },
    refresh() {
      this.table && this.table.refresh();
      const gfa = Calc.gfa(S);
      $('#gfaRef').textContent = `${fmt(gfa)}㎡ = ${fmt(gfa / PY)}평`;
      const c = this.calc();
      const max = Math.max(...Object.values(c.byGroup), 1);
      $('#costGroups').innerHTML = COST_GROUPS.map(g => `
        <div class="bar-row"><span>${g}</span><div class="bar"><i style="width:${c.byGroup[g] / max * 100}%"></i></div><b>${fmtEok(c.byGroup[g])}</b></div>`).join('')
        + `<div class="bar-row total"><span>총사업비</span><div></div><b>${fmtEok(c.total)}</b></div>`;
    },
  },

  result: {
    table: null,
    render() {
      bindInputs($('#tab-result'));
      const wants = () => [{ label: '선택', value: '' }, ...S.sales.filter(r => r.cat === '조합원').map(r => r.name)];
      this.table = makeTable($('#membersTable'), {
        rows: S.members,
        addLabel: '조합원 추가',
        emptyText: '조합원을 추가하면 개인별 분담금을 계산합니다.',
        newRow: () => ({ id: uid(), name: '', prior: 0, want: '' }),
        onChange: () => App.update(),
        columns: [
          { key: 'name', label: '조합원', width: 100 },
          { key: 'prior', label: '종전자산 평가액 (만원)', type: 'number', width: 130 },
          { key: 'want', label: '분양 신청 평형', type: 'select', options: wants },
          { key: 'right', label: '권리가액', computed: r => fmt(Calc.member(S, r, this.ratio()).right) + '만원' },
          { key: 'price', label: '조합원 분양가', computed: r => { const m = Calc.member(S, r, this.ratio()); return m.price ? fmt(m.price) + '만원' : '–'; } },
          {
            key: 'charge', label: '분담금 (+납부 / −환급)',
            computed: r => { const m = Calc.member(S, r, this.ratio()); return isFinite(m.charge) ? (m.charge >= 0 ? '+' : '−') + fmt(Math.abs(m.charge)) + '만원' : '평형 선택'; },
            cls: r => { const m = Calc.member(S, r, this.ratio()); return !isFinite(m.charge) ? '' : m.charge > 0 ? 'pay' : 'refund'; },
          },
        ],
      });
      this.refresh();
    },
    ratio() { return Calc.result(S).ratio; },
    refresh() {
      bindInputs($('#tab-result'));
      this.table && this.table.refresh();
      const r = Calc.result(S);
      $('#officialSum').textContent = fmtEok(Calc.officialLandValue(S), 1);
      $('#ratioBig').innerHTML = `<span class="${ratioClass(r.ratio)}">${fmtPct(r.ratio, 2)}</span>`;
      $('#ratioFormula').innerHTML = `
        <div class="frac">
          <div>(종후자산 <b>${fmtEok(r.rev.total)}</b> − 총사업비 <b>${fmtEok(r.cost.total)}</b>)</div>
          <div class="line"></div>
          <div>종전자산 <b>${fmtEok(r.prior)}</b></div>
        </div>
        <p>${!isFinite(r.ratio) ? '종전자산 총액을 입력하면 비례율이 계산됩니다.'
          : r.ratio >= 100 ? '비례율이 100% 이상이면 조합원 권리가액이 종전자산 평가액보다 커집니다.'
          : '비례율이 100% 미만이면 권리가액이 종전자산 평가액보다 작아져 분담금이 늘어납니다.'}</p>`;
    },
  },

  sensitivity: {
    chart: null,
    render() {
      bindInputs($('#tab-sensitivity'));
      this.refresh();
    },
    steps() {
      const range = num(S.sens.range) || 20, step = num(S.sens.step) || 10;
      const out = [];
      for (let v = -range; v <= range + 1e-9; v += step) out.push(Math.round(v));
      return out;
    },
    refresh() {
      const steps = this.steps();
      const head = steps.map(g => `<th class="num">${g > 0 ? '+' : ''}${g}%</th>`).join('');
      const body = steps.map(c => `<tr><th>${c > 0 ? '+' : ''}${c}%</th>${steps.map(g => {
        const r = Calc.result(S, { construction: 1 + c / 100, general: 1 + g / 100 }).ratio;
        return `<td class="num heat ${ratioClass(r)}${c === 0 && g === 0 ? ' base' : ''}">${fmtPct(r)}</td>`;
      }).join('')}</tr>`).join('');
      $('#sensGrid').innerHTML = `<table class="grid sens"><thead><tr><th>공사비 ↓ / 분양가 →</th>${head}</tr></thead><tbody>${body}</tbody></table>`;
      this.drawChart(steps);
    },
    drawChart(steps) {
      if (!window.Chart) return;
      const cases = [-10, 0, 10, 20];
      const colors = [cssVar('--series-1'), cssVar('--series-2'), cssVar('--series-3'), cssVar('--series-4')];
      const datasets = cases.map((c, i) => ({
        label: `공사비 ${c > 0 ? '+' : ''}${c}%`,
        data: steps.map(g => +Calc.result(S, { construction: 1 + c / 100, general: 1 + g / 100 }).ratio.toFixed(2)),
        borderColor: colors[i], backgroundColor: colors[i],
        borderWidth: c === 0 ? 3 : 2, pointRadius: 3, tension: 0.2,
      }));
      const ink = cssVar('--muted'), grid = cssVar('--line');
      if (this.chart) this.chart.destroy();
      this.chart = new Chart($('#sensChart'), {
        type: 'line',
        data: { labels: steps.map(g => `${g > 0 ? '+' : ''}${g}%`), datasets },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { labels: { color: ink, boxWidth: 12 } },
            tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${fmt(ctx.parsed.y, 1)}%` } },
          },
          scales: {
            x: { title: { display: true, text: '일반분양가 변동', color: ink }, ticks: { color: ink }, grid: { color: grid } },
            y: { title: { display: true, text: '비례율 (%)', color: ink }, ticks: { color: ink }, grid: { color: grid } },
          },
        },
      });
    },
  },
};

// ---------- 앱 ----------
const App = {
  current: 'overview',
  persist: debounce(saveState, 400),

  show(tab) {
    if (!Tabs[tab]) tab = 'overview';
    this.current = tab;
    $$('.panel').forEach(p => { p.hidden = p.id !== 'tab-' + tab; });
    $$('#tabs a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
    Tabs[tab].render();
    this.kpis();
  },

  update(rerender) {
    this.persist();
    this.kpis();
    const t = Tabs[this.current];
    rerender ? t.render() : t.refresh();
  },

  kpis() {
    const sv = Calc.survey(S);
    const r = Calc.result(S);
    const site = Calc.siteArea(S);
    $('#kpis').innerHTML = `
      <div><span>사업 유형</span><strong>${TYPES[S.meta.type].label}</strong></div>
      <div><span>구역 면적</span><strong>${fmt(site)}㎡</strong><em>${fmt(site / PY)}평</em></div>
      <div><span>노후도</span><strong>${fmtPct(sv.oldRatio)}</strong><em>${sv.old}/${sv.count}동</em></div>
      <div><span>종후자산</span><strong>${fmtEok(r.rev.total)}</strong></div>
      <div><span>총사업비</span><strong>${fmtEok(r.cost.total)}</strong></div>
      <div class="hl"><span>비례율</span><strong class="${ratioClass(r.ratio)}">${fmtPct(r.ratio)}</strong></div>`;
  },

  replaceState(next) {
    S = mergeDefaults(defaultState(), next);
    saveState();
    bindInputs();
    if (MapView.map) MapView.load();
    this.show(this.current);
  },
};

// ---------- CSV 조서 ----------
const CSV_SPEC = {
  lands: {
    file: '토지조서',
    cols: [['지번', 'jibun'], ['지목', 'jimok'], ['면적', 'area', 1], ['소유구분', 'ownerType'], ['소유자', 'owner'], ['공시지가', 'price', 1]],
    make: () => ({ id: uid(), jibun: '', jimok: '대', area: 0, ownerType: '사유지', owner: '', price: 0 }),
  },
  buildings: {
    file: '건축물조서',
    cols: [['지번', 'jibun'], ['용도', 'use'], ['구조', 'structure'], ['사용승인연도', 'year', 1], ['연면적', 'floorArea', 1], ['세대수', 'units', 1]],
    make: () => ({ id: uid(), jibun: '', use: '단독주택', structure: '조적', year: 0, floorArea: 0, units: 1 }),
  },
};

async function csvAction(kind, act) {
  const spec = CSV_SPEC[kind];
  if (act === 'template' || act === 'export') {
    const rows = [spec.cols.map(c => c[0])];
    if (act === 'export') S[kind].forEach(r => rows.push(spec.cols.map(c => r[c[1]])));
    else rows.push(kind === 'lands' ? ['123-4', '대', '165.3', '사유지', '홍길동', '6500000'] : ['123-4', '단독주택', '조적', '1985', '120.5', '1']);
    download(`${spec.file}${act === 'template' ? '_양식' : ''}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
    return;
  }
  const text = await pickTextFile('.csv,text/csv');
  if (!text) return;
  const rows = parseCSV(text);
  if (rows.length < 2) { alert('데이터 행이 없습니다.'); return; }
  const header = rows[0].map(h => h.trim());
  const idx = spec.cols.map(c => header.findIndex(h => h.replace(/\s|\(.*\)/g, '').startsWith(c[0])));
  if (idx[0] < 0) { alert(`첫 줄에 '${spec.cols.map(c => c[0]).join(', ')}' 제목이 있어야 합니다. CSV 양식을 받아 확인하세요.`); return; }
  const items = rows.slice(1).map(r => {
    const o = spec.make();
    spec.cols.forEach((c, k) => { if (idx[k] >= 0) o[c[1]] = c[2] ? num(r[idx[k]]) : (r[idx[k]] || '').trim() || o[c[1]]; });
    return o;
  });
  const replace = !S[kind].length || confirm(`${items.length}행을 불러옵니다. 기존 ${S[kind].length}행을 지우고 바꿀까요?\n(취소를 누르면 뒤에 추가합니다)`);
  if (replace) S[kind].splice(0, S[kind].length, ...items); else S[kind].push(...items);
  App.update(true);
}

// ---------- 시작 ----------
function boot() {
  bindInputs();

  $$('#tabs a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    history.replaceState(null, '', '#' + a.dataset.tab);
    App.show(a.dataset.tab);
  }));

  $('#btnSample').onclick = () => {
    if (confirm('예시 데이터(가상의 재개발 구역)를 불러옵니다. 지금 입력한 내용은 바뀝니다. 계속할까요?')) App.replaceState(sampleState());
  };
  $('#btnReset').onclick = () => {
    if (confirm('모든 입력을 지우고 새로 시작할까요? 필요하면 먼저 "파일 저장"으로 보관하세요.')) App.replaceState(defaultState());
  };
  $('#btnSave').onclick = () => download(`${S.meta.name || '사업성검토'}.json`, JSON.stringify(S, null, 2), 'application/json');
  $('#btnOpen').onclick = async () => {
    const text = await pickTextFile('.json,application/json');
    if (!text) return;
    try { App.replaceState(JSON.parse(text)); } catch { alert('파일을 읽을 수 없습니다. 이 도구에서 저장한 JSON 파일인지 확인하세요.'); }
  };
  $('#btnPrint').onclick = () => {
    // 인쇄 시 모든 탭을 펼쳐서 보고서처럼 출력
    Object.keys(Tabs).forEach(t => { if (t !== 'area') Tabs[t].render(); });
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); document.body.classList.remove('printing'); App.show(App.current); }, 100);
  };

  $('#searchForm').onsubmit = e => { e.preventDefault(); MapView.search($('#searchInput').value); };
  $('#btnGeojson').onclick = () => MapView.exportGeoJSON();
  $$('[data-csv]').forEach(b => { b.onclick = () => csvAction(b.dataset.csv, b.dataset.act); });

  App.show((location.hash || '#overview').slice(1));
}

document.addEventListener('DOMContentLoaded', boot);
