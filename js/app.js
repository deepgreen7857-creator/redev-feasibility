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

// 주소 검색·구역 지정 결과로 개요의 위치·용도지역을 자동 기록
const Auto = {
  async zoning(lat, lon, bbox) {
    if (!VWorld.enabled || S.meta.zoningManual) return;
    try {
      const z = await VWorld.zoningAt(lat, lon);
      const list = bbox ? await VWorld.zoningsInBox(bbox) : (z ? [z] : []);
      if (z) S.meta.zoning = z;
      S.meta.zoningList = list;
      App.update();
    } catch (e) { console.warn('용도지역 조회 실패', e); }
  },
  // 구역 안 필지 주소로 "○○동 123 일대". force: 구역을 새로 그렸을 때 (이전 검색 위치를 덮어씀)
  async locationFromParcel(lat, lon, force) {
    if (!VWorld.enabled || S.meta.locationManual || (S.meta.location && !force)) return;
    try {
      const f = await VWorld.parcelAt(lat, lon);
      const addr = f && f.properties && f.properties.addr;
      if (addr) { S.meta.location = addr + ' 일대'; this.region(addr); App.update(); }
    } catch (e) { console.warn('위치 조회 실패', e); }
  },
  // 주소가 인천·서울이면 그 지역 조례 기준으로 (직접 고른 경우 제외)
  region(addr) {
    if (S.criteria.regionManual) return;
    const r = /^인천/.test(addr) ? 'incheon' : /^서울/.test(addr) ? 'seoul' : '';
    if (r && r !== S.criteria.region) { applyRegion(S.criteria, r); bindInputs(); }
  },
  location(r) {
    if (!S.meta.locationManual) S.meta.location = r.label;
    this.region(r.label || '');
    S.area.center = [r.lat, r.lon];
    S.area.zoom = r.precise ? 18 : 16;
    App.update();
    return this.zoning(r.lat, r.lon);
  },
};

function ratioClass(r) {
  if (!isFinite(r)) return '';
  return r >= 100 ? 'good' : r >= 90 ? 'warn' : 'bad';
}

// ---------- 탭 ----------
const Tabs = {
  overview: {
    render() {
      this.refresh();
    },
    refresh() {
      // 용도지역 목록에 없는 값(자동으로 받은 세부 용도지역 등)도 고를 수 있게
      const sel = $('#zoningSelect');
      const opts = ['', ...ZONINGS];
      if (S.meta.zoning && !opts.includes(S.meta.zoning)) opts.push(S.meta.zoning);
      if (sel.options.length !== opts.length) {
        sel.innerHTML = '';
        opts.forEach(z => sel.add(new Option(z || '주소를 검색하면 자동으로 채워집니다', z)));
      }
      bindInputs($('#tab-overview'));
      $('#zoningBadge').hidden = !S.meta.zoning || S.meta.zoningManual;
      $('#locBadge').hidden = !S.meta.location || S.meta.locationManual;
      const others = (S.meta.zoningList || []).filter(z => z !== S.meta.zoning);
      $('#zoningListNote').textContent = others.length ? `구역에 ${others.join(', ')}도 걸쳐 있습니다.` : '';
      const fz = FAR_BY_ZONING[S.meta.zoning];
      $('#farHint').innerHTML = fz
        ? `참고: 서울시 조례 ${fz.seoul}%, 법정 상한 ${fz.max}%. 정비계획으로 높아질 수 있습니다. <button type="button" class="link-btn" data-far="${fz.seoul}">${fz.seoul}% 넣기</button>`
        : '';
      const fb = $('#farHint [data-far]');
      if (fb) fb.onclick = () => { S.plan.far = num(fb.dataset.far); App.update(); };
      // 1단계는 계획 조건만. 면적은 2단계(구역계)에서 구역을 정해야 생김
      $('#planStats').innerHTML = `
        <div><span>사업 유형</span><strong>${TYPES[S.meta.type].label}</strong><em>${TYPES[S.meta.type].law}</em></div>
        <div><span>계획 용적률</span><strong>${fmt(num(S.plan.far))}%</strong><em>${esc(S.meta.zoning || '용도지역 미정')}</em></div>
        <div><span>연면적 배율</span><strong>${num(S.plan.gfaManual) > 0 ? '설계 연면적 사용 중(2단계)' : '× ' + fmt(num(S.plan.gfaFactor), 2)}</strong><em>${num(S.plan.gfaManual) > 0 ? '' : '지하·공용 포함'}</em></div>`;
    },
  },

  area: {
    render() {
      bindInputs($('#tab-area'));
      MapView.init();
      MapView.drawParcels();
      this.refresh();
    },
    refresh() {
      $('#drawnArea').textContent = S.area.drawnArea ? `${fmt(S.area.drawnArea)}㎡` : '(없음)';
      $('#ledgerArea').textContent = S.lands.length ? `${fmt(Calc.landTotal(S), 1)}㎡` : '(조서 없음)';
      this.areaDiff();
      const site = Calc.siteArea(S);
      $('#siteArea').innerHTML = `${fmt(site)}㎡ <em>${fmt(site / PY)}평</em>`;
      $('#pickBox').hidden = !VWorld.enabled;
      $('#vworldOff').hidden = VWorld.enabled;
      $('#zoneSyncNote').hidden = !(S.area.geojson && VWorld.enabled && S.area.importedKey !== zoneKey(S.area.geojson));
      $('#btnPick').textContent = MapView.picking ? '필지 선택 끄기' : '필지 선택 켜기';
      $('#btnPick').classList.toggle('on', MapView.picking);
      MapView.updateInZone();
      const picked = S.lands.filter(l => l.geom), sel = picked.filter(l => !l.inZone);
      $('#pickCount').textContent = `지도 필지 ${picked.length}개 · 구역에 합쳐짐 ${picked.length - sel.length}개 · 선택만 됨 ${sel.length}개`;
      $('#btnParcelsToArea').textContent = `선택 필지 ${sel.length}개 → 구역계로 합치기`;
      $('#btnParcelsToArea').disabled = !sel.length;
      $('#showParcels').checked = !!S.area.showParcels;
      this.summary();
    },
    // 토지대장 합계(조서 편입면적)와 연속지적 도형(그린 구역) 면적 차이
    areaDiff() {
      const el = $('#areaDiff');
      const L = Calc.landTotal(S), D = num(S.area.drawnArea);
      if (!L || !D) { el.hidden = true; return; }
      const d = D - L, pct = Math.abs(d) / L * 100;
      const text = `대장 합계 ${fmt(L, 1)}㎡ / 연속지적 도형 ${fmt(D, 1)}㎡ (차이 ${d > 0 ? '+' : ''}${fmt(d, 1)}㎡, ${fmt(pct, 2)}%)`;
      el.hidden = false;
      el.className = pct <= 0.1 ? 'note' : 'note warn-box';
      if (pct <= 0.1) { el.textContent = text; return; }
      // 대장·연속지적 차이가 가장 큰 필지
      const gap = l => (num(l.ledgerArea) > 0 && num(l.cadArea) > 0 ? Math.abs(l.ledgerArea - l.cadArea) * (l.inRatio ?? 1) : 0);
      const worst = S.lands.filter(l => l.geom && gap(l) > 0.05).sort((a, b) => gap(b) - gap(a))[0];
      el.innerHTML = `<b>${esc(text)}</b><br>구역선과 조서 필지가 맞지 않거나(빠진·남은 필지), 공부와 도면 면적이 다른 필지가 있습니다.`
        + (worst ? ` <a href="#" id="areaDiffGo">차이 큰 필지: ${esc(worst.jibun)} (대장 ${fmt(worst.ledgerArea, 1)}㎡ / 연속지적 ${fmt(worst.cadArea, 1)}㎡)</a>` : '');
      if (worst) $('#areaDiffGo').onclick = e => { e.preventDefault(); MapView.focusLand(worst); };
    },
    // 면적 요약: 구역 → 기반시설 공제 → 건축 대지 → 연면적
    summary() {
      bindInputs($('.area-summary'));
      const mode = S.plan.infraMode;
      $('#infraRatioBox').hidden = mode === 'area';
      $('#infraAreaBox').hidden = mode !== 'area';
      const site = Calc.siteArea(S), inf = Calc.infra(S), net = Calc.netSite(S), gfa = Calc.gfa(S);
      const modeName = S.area.mode === 'ledger'
        ? (Calc.landTotal(S) > 0 ? '토지대장 면적 합계(편입면적 기준)' : '토지조서가 없어 지도에서 그린 면적')
        : { drawn: '연속지적 도형 면적(참고)', manual: '직접 입력' }[S.area.mode] || '';
      // 설계 연면적: 체크 상태는 따로 저장하지 않고 gfaManual > 0 으로 판단
      const manual = num(S.plan.gfaManual) > 0;
      const est = net * num(S.plan.far) / 100 * num(S.plan.gfaFactor);
      const chk = $('#gfaUseManual'), gin = $('#gfaManualInput');
      if (!chk.dataset.open) chk.checked = manual;   // 켠 직후 값을 넣는 중에는 그대로 둠
      gin.disabled = !chk.checked;
      if (!chk._bound) {
        chk._bound = true;
        chk.onchange = () => {
          if (chk.checked) { chk.dataset.open = '1'; gin.disabled = false; gin.focus(); return; }
          delete chk.dataset.open;
          S.plan.gfaManual = 0;
          App.update(true);
        };
        gin.addEventListener('change', () => { if (num(S.plan.gfaManual) > 0) delete chk.dataset.open; });
      }
      const estText = `건축 대지 ${fmt(net)}㎡ × 용적률 ${fmt(num(S.plan.far))}% × 배율 ${fmt(num(S.plan.gfaFactor), 2)}`;
      const row = (label, v, basis, cls = '') => `<tr class="${cls}"><td>${label}</td><td class="num">${site ? fmt(v) : '–'}</td><td class="num">${site ? fmt(v / PY) : '–'}</td><td>${esc(basis)}</td></tr>`;
      $('#areaSummary').innerHTML = !site
        ? '<tr><td colspan="4" class="muted">구역을 그리거나 면적을 입력하면 계산됩니다.</td></tr>'
        : row('구역면적', site, modeName)
          + row('− 정비기반시설', inf.area, `${inf.basis}${site ? ` (구역의 ${fmt(inf.area / site * 100, 1)}%)` : ''}`)
          + row('= 건축 대지면적', net, '구역면적 − 정비기반시설', 'strong')
          + row('계획 연면적', gfa, manual ? `설계 연면적 직접 입력 (참고: 추정값 ${fmt(est)}㎡ = ${estText})` : `${estText} (추정)`, 'strong');
    },
  },

  survey: {
    lands: null,
    buildings: null,
    declinedKey: '',   // 자동 다시 불러오기를 거절한 구역 (이 구역이면 다시 묻지 않고 경고만)

    // 지금 2단계 구역이 조서를 불러온 구역과 다르면 true
    stale() {
      return !!S.area.geojson && S.area.importedKey !== zoneKey(S.area.geojson);
    },

    // 3단계 진입 시: 구역이 바뀌었으면 필지·건축물을 다시 불러옴
    //  지도에서 불러온 행이 없으면 바로, 있으면 한 번 물어봄 (직접 입력한 행은 유지)
    async autoImport() {
      if (!VWorld.enabled || !this.stale() || MapView.importing) return;
      const key = zoneKey(S.area.geojson);
      if (this.declinedKey === key) return;
      const hasAuto = S.lands.some(l => l.pnu) || S.buildings.some(b => b.auto);
      if (hasAuto && !confirm('구역이 바뀌었습니다. 조서를 지금 구역 기준으로 다시 불러올까요? (직접 입력한 행은 유지)')) {
        this.declinedKey = key;
        this.sync();
        return;
      }
      await this.reimport();
    },

    async reimport() {
      this.declinedKey = '';
      const p = MapView.importArea({ silent: true, msg: $('#surveySyncMsg') });
      this.sync();   // 불러오는 중 표시
      await p;
      this.sync();
    },

    // 상단 상태 줄
    sync() {
      const bar = $('#surveySync');
      if (!bar) return;
      let cls = '', html;
      if (!S.area.geojson) html = '2단계에서 구역을 먼저 그리면 필지·건축물이 자동으로 들어옵니다.';
      else if (MapView.importing) html = '구역 안 필지 불러오는 중…';
      else if (MapView.ledgerBusy) html = '토지대장 면적 조회 중…';
      else if (!VWorld.enabled) html = '지적 조회를 쓸 수 없어 조서를 직접 입력하거나 CSV로 불러와야 합니다.';
      else if (this.stale()) {
        cls = 'warn';
        html = '<b>2단계 구역이 조서를 불러온 구역과 다릅니다.</b> 아래 조서는 예전 구역 기준입니다. <button type="button" class="btn small" id="btnSurveyReimport">지금 구역으로 다시 불러오기</button>';
      } else {
        const n = S.lands.filter(l => l.pnu).length, m = S.buildings.filter(b => b.auto).length;
        const own = S.lands.length - n + S.buildings.length - m;
        html = n || m
          ? `2단계 구역 기준 필지 <b>${fmt(n)}개</b> · 건축물 <b>${fmt(m)}동</b>${S.area.importedAt ? ` (${esc(S.area.importedAt)} 불러옴)` : ''}${own ? ` · 직접 입력 ${fmt(own)}행` : ''}`
          : own
            ? `조서 필지 <b>${fmt(S.lands.length)}개</b> · 건축물 <b>${fmt(S.buildings.length)}동</b> (직접 입력하거나 파일에서 불러온 조서)`
            : '2단계 구역 안에서 불러온 필지가 없습니다. 필지를 추가하거나 CSV를 불러오세요.';
      }
      // 대장 면적을 아직 못 받은 지도 필지(예전 파일·조회 실패)
      const need = this.ledgerTodo();
      if (need.length && VWorld.enabled && !MapView.importing && !MapView.ledgerBusy) html += ` <span class="warn">· 연속지적 면적으로 들어간 필지 ${fmt(need.length)}개</span> <button type="button" class="btn small" id="btnLedgerRefetch">토지대장 면적 다시 조회</button>`;
      bar.className = 'sync-bar ' + cls;
      bar.innerHTML = html;
      const b = $('#btnSurveyReimport');
      if (b) b.onclick = () => this.reimport();
      const lb = $('#btnLedgerRefetch');
      if (lb) lb.onclick = () => this.refetchLedger();
    },

    ledgerTodo() {
      return S.lands.filter(l => l.pnu && (l.ledgerFail || (!(num(l.ledgerArea) > 0) && /연속지적/.test(l.areaSrc || ''))));
    },

    async refetchLedger() {
      const ls = this.ledgerTodo();
      const out = $('#surveySyncMsg');
      const p = MapView.fillLedger(ls, t => { out.textContent = t; });
      this.sync();
      const fail = await p;
      out.textContent = `토지대장 면적 ${fmt(ls.length - fail)}/${fmt(ls.length)}필지 조회했습니다.` + (fail ? ` ${fail}필지는 대장 자료가 없어 연속지적 면적으로 두었습니다(분할·합병 여부 확인).` : '');
      App.update(true);
    },

    render() {
      bindInputs($('#tab-survey'));
      this.lands = makeTable($('#landsTable'), {
        rows: S.lands,
        addLabel: '필지 추가',
        emptyText: '필지를 추가하거나 CSV를 불러오세요.',
        newRow: () => ({ id: uid(), jibun: '', jimok: '대', area: 0, ownerType: '사유지', owner: '', price: 0 }),
        onChange: () => App.update(),
        columns: [
          { key: 'no', label: '연번', computed: (r, i) => String(i + 1) },
          { key: 'jibun', label: '지번', width: 80 },
          { key: 'jimok', label: '지목', type: 'select', options: JIMOK },
          { key: 'ledgerArea', label: '대장 면적 (㎡)', computed: r => (num(r.ledgerArea) > 0 ? fmt(r.ledgerArea, 1) : '–') },
          { key: 'cadArea', label: '연속지적 면적 (㎡)', computed: r => (num(r.cadArea) > 0 ? fmt(r.cadArea, 1) : '–') },
          { key: 'inRatio', label: '편입비율', computed: r => (r.inRatio == null ? '–' : `${fmt(r.inRatio * 100, 1)}%`) },
          { key: 'area', label: '조서(편입) 면적 (㎡)', type: 'number', dec: 1, width: 90 },
          { key: 'areaSrc', label: '면적 출처', computed: r => landAreaSrc(r), cls: r => (/연속지적/.test(landAreaSrc(r)) ? 'tag warn' : 'tag') },
          { key: 'ownerType', label: '소유 구분', type: 'select', options: ['사유지', '국공유지'] },
          { key: 'owner', label: '소유자', width: 90 },
          { key: 'price', label: '공시지가 (원/㎡)', type: 'number', width: 120 },
          { key: 'value', label: '공시가격', computed: r => fmtEok(num(r.area) * num(r.price) / 10000, 2) },
          { key: 'small', label: '비고', computed: r => landNote(r), cls: () => 'tag' },
        ],
        footer: rows => ({ jibun: `${rows.length}필지`, ledgerArea: fmt(rows.reduce((a, r) => a + num(r.ledgerArea), 0), 1), cadArea: fmt(rows.reduce((a, r) => a + num(r.cadArea), 0), 1), area: fmt(rows.reduce((a, r) => a + num(r.area), 0), 1), value: fmtEok(Calc.officialLandValue(S), 2) }),
      });
      const year = new Date().getFullYear();
      this.buildings = makeTable($('#buildingsTable'), {
        rows: S.buildings,
        addLabel: '건축물 추가',
        emptyText: '건축물을 추가하거나 CSV를 불러오세요.',
        newRow: () => ({ id: uid(), jibun: '', use: '단독주택', structure: '조적', year: 0, floorArea: 0, units: 1 }),
        onChange: () => App.update(),
        columns: [
          { key: 'no', label: '연번', computed: (r, i) => String(i + 1) },
          { key: 'jibun', label: '지번', width: 80 },
          { key: 'name', label: '건물명', width: 110 },
          { key: 'use', label: '용도', type: 'select', options: BLDG_USES },
          { key: 'structure', label: '구조', type: 'select', options: STRUCTURES },
          { key: 'floors', label: '지상층', type: 'number', width: 55 },
          { key: 'year', label: '사용승인연도', type: 'number', width: 90 },
          { key: 'aprDate', label: '사용승인일', width: 100, placeholder: 'YYYY-MM-DD' },
          { key: 'floorArea', label: '연면적 (㎡)', type: 'number', dec: 1, width: 90 },
          { key: 'units', label: '호·세대수', type: 'number', width: 70 },
          { key: 'hoCount', label: '전유 호수', computed: r => (r.hoCount ? `${r.hoCount}호` : '') },
          {
            key: 'age', label: '경과연수 (노후 도래일)',
            computed: r => {
              const a = Calc.age(S, r);
              if (!isFinite(a)) return '–';
              const od = Calc.oldDate(S, r);
              return Calc.isOld(S, r) ? `${a}년` : `${a}년 (${od.toLocaleDateString('sv-SE')})`;
            },
          },
          { key: 'old', label: '노후 판정', computed: r => (Calc.isOld(S, r, year) ? '노후' : '–'), cls: r => (Calc.isOld(S, r, year) ? 'tag bad' : 'tag') },
          {
            key: 'check', label: '비고',
            computed: r => [r.ledger ? '대장' : '', r.noLedger ? '대장 없음 – 무허가 등 확인' : '', r.noInfo && !num(r.year) ? '정보 없음 – 건축물대장 확인' : '', r.needUnits && !num(r.units) ? '세대수 확인 필요' : '', r.guessed ? '용도 추정' : ''].filter(Boolean).join(' · '),
            cls: r => ((r.noInfo && !num(r.year)) || (r.needUnits && !num(r.units)) ? 'tag warn' : 'tag'),
          },
        ],
        footer: rows => ({ jibun: `${rows.length}동`, floorArea: fmt(rows.reduce((a, r) => a + num(r.floorArea), 0), 1), units: fmt(rows.reduce((a, r) => a + num(r.units), 0)) }),
      });
      this.refresh();
    },
    refresh() {
      this.lands && this.lands.refresh();
      this.buildings && this.buildings.refresh();
      this.sync();
      const sv = Calc.survey(S);
      $('#oldStats').innerHTML = `
        <div><span>건축물</span><b>${fmt(sv.count)}동</b></div>
        <div><span>기준일</span><b>${sv.base.toLocaleDateString('sv-SE')}${S.criteria.baseDate ? '' : ' (오늘)'}</b></div>
        <div><span>노후·불량건축물</span><b>${fmt(sv.old)}동</b></div>
        <div><span>1년 안에 노후 도래</span><b>${fmt(sv.soon1)}동</b></div>
        <div><span>3년 안에 노후 도래</span><b>${fmt(sv.soon3)}동</b></div>
        ${isFinite(sv.req) && sv.count ? `<div class="hl"><span>노후도 ${fmt(sv.req, 1)}% 요건</span><b class="${sv.needMore ? 'warn' : 'good'}">${sv.needMore ? (sv.reachDate ? `${sv.needMore}동 부족 → ${sv.reachDate.toLocaleDateString('sv-SE')} 충족 예상` : `${sv.needMore}동 부족 (도래 예정 건물로 충족 불가)`) : '충족'}</b></div>` : ''}
        ${sv.unknown ? `<div><span>사용승인연도 없음 (판정 불가)</span><b class="warn">${fmt(sv.unknown)}동</b></div>` : ''}
        <div class="hl"><span>노후도 (동수 기준)</span><b class="${sv.oldRatio >= 60 ? 'good' : ''}">${fmtPct(sv.oldRatio)}</b></div>
        <div><span>노후도 (연면적 기준)</span><b>${fmtPct(sv.oldAreaRatio)}</b></div>
        <div><span>단독·다가구</span><b>${fmt(sv.detached)}호</b></div>
        <div><span>공동주택</span><b>${fmt(sv.apartment)}세대</b></div>
        ${(S.exposUnits || []).length ? `<div><span>전유부 호수 (집합건물)</span><b>${fmt(S.exposUnits.length)}호 · ${fmt(new Set(S.exposUnits.map(u => u.pnu)).size)}필지</b></div>` : ''}
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
        <p>${!isFinite(r.ratio) ? '분양수입과 종전자산 총액을 입력하면 비례율이 계산됩니다.'
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
    // 3단계에 들어올 때 2단계 구역이 조서를 불러온 구역과 다르면 다시 불러옴
    if (tab === 'survey') Tabs.survey.autoImport();
  },

  go(tab) {
    history.replaceState(null, '', '#' + tab);
    this.show(tab);
    window.scrollTo(0, 0);
  },

  update(rerender) {
    this.persist();
    this.kpis();
    const t = Tabs[this.current];
    rerender ? t.render() : t.refresh();
  },

  kpis() {
    const rp = REGION_PRESETS[S.criteria.region];
    const rs = $('#regionSelect');
    if (rs) rs.value = S.criteria.region;
    if ($('#critSummary')) $('#critSummary').textContent = `${rp ? rp.label : '사용자'} 조례 기준${S.criteria.regionManual ? ' (직접 선택)' : ''}`;
    if ($('#regionLaw')) $('#regionLaw').textContent = rp ? `적용: ${rp.law}` : '';
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

  // 홈: 초기화 안내 창을 띄움
  home() {
    const d = $('#homeDialog');
    if (d.open) return;
    d.showModal();
  },

  // 모든 입력·지도 표시를 지우고 첫 화면으로
  fullReset() {
    if ($('#map').classList.contains('map-full')) MapView.toggleFull();
    if (MapView.picking) MapView.setPicking(false);
    if (typeof RefOverlay !== 'undefined') RefOverlay.remove(true);
    if (MapView.roughLayer) { MapView.roughLayer.remove(); MapView.roughLayer = null; }
    if (MapView.marker) { MapView.marker.remove(); MapView.marker = null; }
    ['#jibunList', '#jibunBase', '#anchorTarget', '#ovSearchInput', '#searchInput'].forEach(s => { const e = $(s); if (e) e.value = ''; });
    ['#jibunMsg', '#jibunReport', '#pickMsg', '#surveySyncMsg', '#refMsg', '#exportMsg', '#ovSearchMsg', '#searchResults'].forEach(s => { const e = $(s); if (e) e.innerHTML = ''; });
    this.replaceState(defaultState());
    this.go('overview');
  },

  replaceState(next) {
    S = adoptZoneKey(next, migrate(mergeDefaults(defaultState(), next)));
    if ($('#surveySyncMsg')) $('#surveySyncMsg').textContent = '';   // 다른 작업의 불러오기 결과 문구는 지움
    Tabs.survey.declinedKey = '';
    MapView.sampleAsked = false;   // 예시를 다시 불러오면 다시 물어봄
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
  // 조합원 명단: 종전자산은 만원 단위 (제목에 "(원)"이 있으면 원 단위로 보고 바꿈)
  members: {
    file: '조합원명단',
    cols: [['조합원', 'name'], ['종전자산', 'prior', 1], ['신청평형', 'want']],
    make: () => ({ id: uid(), name: '', prior: 0, want: '' }),
    sample: ['조합원1', '45000', '84㎡'],
  },
};

// "84", "84타입", "84㎡A" → 분양수입 표의 조합원 평형 이름(예: "84㎡")
function matchWant(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  const names = S.sales.filter(r => r.cat === '조합원').map(r => r.name);
  if (names.includes(s)) return s;
  const n = (s.match(/\d+/) || [])[0];
  return (n && names.find(x => (x.match(/\d+/) || [])[0] === n)) || s;
}

async function csvAction(kind, act) {
  const spec = CSV_SPEC[kind];
  if (act === 'template' || act === 'export') {
    const rows = [spec.cols.map(c => c[0])];
    if (act === 'export') S[kind].forEach(r => rows.push(spec.cols.map(c => r[c[1]])));
    else rows.push(spec.sample || (kind === 'lands' ? ['123-4', '대', '165.3', '사유지', '홍길동', '6500000'] : ['123-4', '단독주택', '조적', '1985', '120.5', '1']));
    if (kind === 'members') rows[0] = ['조합원', '종전자산(만원)', '신청평형'];
    download(`${spec.file}${act === 'template' ? '_양식' : ''}.csv`, toCSV(rows), 'text/csv;charset=utf-8');
    return;
  }
  const rows = (await pickTableFile() || []).filter(r => r.some(v => String(v).trim()));
  if (!rows.length) return;
  if (rows.length < 2) { alert('데이터 행이 없습니다.'); return; }
  const header = rows[0].map(h => String(h).trim());
  const idx = spec.cols.map(c => header.findIndex(h => h.replace(/\s|\(.*\)/g, '').startsWith(c[0])));
  if (idx[0] < 0) { alert(`첫 줄에 '${spec.cols.map(c => c[0]).join(', ')}' 제목이 있어야 합니다. 양식을 받아 확인하세요.`); return; }
  // 종전자산이 원 단위면 만원으로
  const won = kind === 'members' && idx[1] >= 0 && /\(원\)|원\s*$/.test(header[idx[1]]) && !/만원/.test(header[idx[1]]);
  const items = rows.slice(1).map(r => {
    const o = spec.make();
    spec.cols.forEach((c, k) => { if (idx[k] >= 0) o[c[1]] = c[2] ? num(r[idx[k]]) : String(r[idx[k]] || '').trim() || o[c[1]]; });
    if (won) o.prior = Math.round(o.prior / 10000);
    if (kind === 'members') o.want = matchWant(o.want);
    return o;
  });
  const replace = !S[kind].length || confirm(`${items.length}행을 불러옵니다. 기존 ${S[kind].length}행을 지우고 바꿀까요?\n(취소를 누르면 뒤에 추가합니다)`);
  if (replace) S[kind].splice(0, S[kind].length, ...items); else S[kind].push(...items);
  App.update(true);
}

// ---------- 조서: 지번순 정렬, 엑셀 저장, 인쇄 ----------
// "123-4" < "123-10" < "산1" 순서
function jibunKey(j) {
  const s = String(j || '').trim(), san = s.startsWith('산') ? 1 : 0;
  const m = s.replace(/^산/, '').match(/(\d+)(?:-(\d+))?/);
  return m ? [san, +m[1], +(m[2] || 0)] : [2, 0, 0];
}
// 조서 면적의 출처: 토지대장 / 연속지적(대장 조회 전·실패) / 직접 수정 / 직접 입력
function landAreaSrc(l) {
  if (num(l.ledgerArea) > 0 && l.inRatio != null && Math.abs(num(l.area) - Math.round(l.ledgerArea * l.inRatio * 10) / 10) > 0.05) return '직접 수정';
  return l.areaSrc || (l.pnu ? '' : '직접 입력');
}

function landNote(l) {
  const led = num(l.ledgerArea), cad = num(l.cadArea);
  const gap = led > 0 && cad > 0 ? Math.abs(led - cad) / led * 100 : 0;
  const thisYear = String(new Date().getFullYear());
  return [
    gap > 1 ? `공부-도면 면적 차이 ${fmt(gap, 1)}%` : '',
    l.pnu && (l.ledgerFail || l.areaSrc === '연속지적' || (l.baseYear && String(l.baseYear) !== thisYear)) ? '대장 면적 확인 필요(분할·합병 여부)' : '',
    l.jimok === '대' && num(l.area) > 0 && num(l.area) < (num(S.criteria.smallLot) || 90) ? '과소필지' : '',
    l.enclosed ? '갇힌 필지' : '',
    l.boundary ? `경계 필지(${l.boundary}%)` : '',
    l.partial ? `일부 편입${l.wholeArea ? `(전체 ${fmt(l.wholeArea, 1)}㎡${l.cutBy ? ', ' + l.cutBy : ''})` : ''}` : '',
  ].filter(Boolean).join(', ');
}

function sortByJibun() {
  const cmp = (a, b) => { const x = jibunKey(a.jibun), y = jibunKey(b.jibun); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };
  S.lands.sort(cmp);
  S.buildings.sort(cmp);
  App.update(true);
}

function surveyRows() {
  const year = new Date().getFullYear();
  const lands = S.lands.map((l, i) => ({
    '연번': i + 1, '소재지': l.addr || S.meta.location || '', '지번': l.jibun, '지목': l.jimok,
    '면적(㎡)': num(l.area), '소유구분': l.ownerType, '소유자': l.owner || '',
    '공시지가(원/㎡)': num(l.price), '공시가격(원)': Math.round(num(l.area) * num(l.price)),
    '비고': landNote(l),
  }));
  const bldgs = S.buildings.map((b, i) => ({
    '연번': i + 1, '지번': b.jibun, '건물명': b.name || '', '용도': b.use, '구조': b.structure,
    '지상층': num(b.floors) || '', '사용승인일': b.aprDate || (num(b.year) ? String(b.year) : ''),
    '경과연수': isFinite(Calc.age(S, b)) ? Calc.age(S, b) : '',
    '노후도래일': Calc.oldDate(S, b) ? Calc.oldDate(S, b).toLocaleDateString('sv-SE') : '',
    '연면적(㎡)': num(b.floorArea), '호·세대수': num(b.units) || '', '전유 호수': num(b.hoCount) || '',
    '노후여부': Calc.isOld(S, b, year) ? '노후' : (num(b.year) ? '' : '판정불가'),
    '비고': [b.ledger ? '건축물대장' : '', b.noLedger ? '대장 없음' : '', b.purpose || '', b.noInfo && !num(b.year) ? '건축물대장 확인' : '', b.needUnits && !num(b.units) ? '세대수 확인' : '', b.guessed ? '용도 추정' : ''].filter(Boolean).join(', '),
  }));
  return { lands, bldgs };
}

// ---------- 구역지정 서류 (생성 모드) ----------
// 구역계로 만든 토지·건축물 조서를 법정서식 자료(Forms의 zone)로 바꿈. 소유자는 브이월드에서 오지 않으므로 빈칸(직접 입력한 소유자만)
function zoneDocsData() {
  const dongOf = l => { const a = String((l && l.addr) || '').trim().split(/\s+/); return a.length > 1 ? a[a.length - 2] : ''; };
  const landOf = b => S.lands.find(l => (b.pnu && l.pnu === b.pnu) || l.jibun === b.jibun);
  const APT = ['아파트', '연립주택', '다세대주택'];
  const parcels = S.lands.map(l => ({
    jibun: l.jibun, dong: dongOf(l), jimok: l.ledgerJimok || l.jimok || '',
    ledgerArea: num(l.ledgerArea) > 0 ? num(l.ledgerArea) : '', area: num(l.area),
    zoning: l.zoning || '', jiga: num(l.price), ownerType: l.ownerType === '국공유지' ? '국공유지' : '사유지',
    ownerName: l.owner || '', landUse: l.landUse || '', note: landNote(l),
  }));
  const buildings = S.buildings.map(b => {
    const apt = APT.includes(b.use);
    return {
      jibun: b.jibun, dong: dongOf(landOf(b)), bname: b.name || '', use: b.use || '', structure: b.structureName || b.structure || '',
      dongs: 1, units: apt ? (num(b.hoCount) || '') : num(b.units), households: apt ? num(b.units) : '',
      year: b.year || '', archArea: num(b.archArea) || '', floorArea: num(b.floorArea), floors: num(b.floors), basement: num(b.basement),
      source: b.ledger ? '건축물대장' : b.auto ? 'GIS건물통합정보' : '직접 입력', aprDate: b.aprDate || '',
      note: [b.noLedger ? '대장 없음 – 무허가 등 확인' : '', b.needUnits && !num(b.units) ? '세대수 확인 필요' : '', !b.ledger && b.auto ? '건축물대장 확인 전(GIS 기준)' : ''].filter(Boolean).join(' · '),
    };
  });
  const units = (S.exposUnits || []).map(u => ({ dong: dongOf(landOf(u)), jibun: u.jibun, bldgName: u.bldNm || '', use: u.purpose || '', dongNo: u.dong || '', ho: u.ho || '', excl: u.area }));
  const sv = Calc.survey(S);
  const years = [...new Set(S.lands.map(l => l.baseYear).filter(Boolean))];
  return {
    name: S.meta.name, location: S.meta.location, baseYear: years.join('·'), parcels, buildings, units,
    req: Calc.requirements(S, sv), baseDate: sv.base.toLocaleDateString('sv-SE'),
    ledgerDone: S.lands.filter(l => l.ledgerEmpty === true || S.buildings.some(b => b.ledger && b.pnu === l.pnu)).map(l => l.jibun),
  };
}

// 서식 내려받기. kind: land 토지조서 | bldg 건축물조서 | survey 기초조사·확인 내역서 | owners 토지등소유자 명부
//   | consent 동의총괄표 | req 요건 검토 | 없으면 전부 한 엑셀로
const ZONE_DOC_NAMES = { land: '토지조서', bldg: '건축물조서', survey: '기초조사·확인 내역서', owners: '토지등소유자 명부', consent: '동의총괄표', req: '요건 검토' };
function saveZoneDocs(kind) {
  if (!S.lands.length) { alert('토지조서가 비어 있습니다. 2단계에서 구역을 정하고 구역 안 필지·건축물을 불러오세요.'); return; }
  if (!window.XLSX || typeof Forms === 'undefined') { alert('엑셀·서식 모듈을 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
  if (Tabs.survey.stale() && !confirm('조서가 지금 구역이 아니라 예전 구역 기준입니다. 그래도 저장할까요?\n(3단계에 들어가면 지금 구역 기준으로 다시 불러올 수 있습니다)')) return;
  const todo = Tabs.survey.ledgerTodo().length, noLedger = S.buildings.filter(b => b.auto && !b.ledger).length;
  if (kind) Forms.exportZoneDoc(zoneDocsData(), kind);
  else Forms.exportZoneDocs(zoneDocsData(), `${S.meta.name || '정비구역'}_구역지정서류.xlsx`);
  const msg = [`${kind ? ZONE_DOC_NAMES[kind] : '구역지정 서류 전체'}를 저장했습니다 (토지 ${S.lands.length}필지 · 건축물 ${S.buildings.length}동).`];
  if (!kind || kind === 'owners') msg.push('토지등소유자 명부의 소유자 칸은 등기부등본 등 열람으로 채워 주세요.');
  if (todo) msg.push(`토지대장 면적을 못 받은 필지 ${todo}개는 연속지적 면적입니다.`);
  if (noLedger) msg.push(`건축물 ${noLedger}동은 건축물대장 확인 전(GIS 기준)입니다. 3단계 "건축물대장으로 채우기" 후 다시 저장하면 정확해집니다.`);
  $$('.zone-docs-msg').forEach(e => { e.textContent = msg.join(' '); });
}

function saveSurveyXlsx() {
  if (!window.XLSX) { alert('엑셀 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하세요.'); return; }
  const { lands, bldgs } = surveyRows();
  const sv = Calc.survey(S);
  const wb = XLSX.utils.book_new();
  const head = t => [[`${S.meta.name || '정비사업'} ${t}`], [`위치: ${S.meta.location || '-'}`, '', `작성일: ${new Date().toLocaleDateString('sv-SE')}`], []];
  const sheet = (title, rows, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(head(title));
    XLSX.utils.sheet_add_json(ws, rows, { origin: 'A4' });
    ws['!cols'] = widths.map(w => ({ wch: w }));
    return ws;
  };
  XLSX.utils.book_append_sheet(wb, sheet('토지조서', lands, [5, 28, 10, 6, 10, 9, 12, 14, 16, 10]), '토지조서');
  XLSX.utils.book_append_sheet(wb, sheet('건축물조서', bldgs, [5, 10, 16, 12, 12, 7, 12, 8, 12, 11, 9, 9, 8, 18]), '건축물조서');
  // 전유부(호별 목록): 건축물대장으로 채운 집합건물만
  const units = (S.exposUnits || []).slice().sort((a, b) => {
    const x = jibunKey(a.jibun), y = jibunKey(b.jibun);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.dong.localeCompare(b.dong) || a.ho.localeCompare(b.ho, 'ko', { numeric: true });
  }).map((u, i) => ({ '연번': i + 1, '지번': u.jibun, '건물명': u.bldNm, '동': u.dong, '호': u.ho, '층': u.floor, '전유면적(㎡)': u.area, '전유면적(평)': Math.round(u.area / PY * 100) / 100, '용도': u.purpose }));
  if (units.length) XLSX.utils.book_append_sheet(wb, sheet('호별 목록(건축물대장 전유부)', units, [5, 10, 16, 8, 14, 6, 11, 11, 14]), '호별목록(전유부)');
  const sum = [
    ['구분', '값'], ['필지 수', sv.landCount], ['토지 면적(㎡)', Math.round(sv.landArea * 10) / 10], ['국공유지 면적(㎡)', Math.round(sv.publicArea * 10) / 10],
    ['과소필지(90㎡ 미만)', sv.small], ['건축물 동수', sv.count], ['노후·불량건축물', sv.old], ['노후도(동수, %)', Math.round(sv.oldRatio * 10) / 10],
    ['노후도(연면적, %)', Math.round(sv.oldAreaRatio * 10) / 10], ['사용승인연도 없음(판정 불가)', sv.unknown],
    ['노후 기준', `철근콘크리트·철골 ${S.criteria.rcYears}년, 기타 ${S.criteria.otherYears}년`],
    ['노후도 기준일', sv.base.toLocaleDateString('sv-SE')],
    ['1년 안에 노후 도래', sv.soon1], ['3년 안에 노후 도래', sv.soon3],
    ...(isFinite(sv.req) ? [[`노후도 ${sv.req}% 요건`, sv.needMore ? (sv.reachDate ? `${sv.needMore}동 부족, ${sv.reachDate.toLocaleDateString('sv-SE')} 충족 예상` : `${sv.needMore}동 부족`) : '충족']] : []),
  ];
  const ws3 = XLSX.utils.aoa_to_sheet(sum); ws3['!cols'] = [{ wch: 26 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws3, '요약');
  XLSX.writeFile(wb, `${S.meta.name || '정비사업'}_토지건축물조서.xlsx`);
}

function printSurvey() {
  const { lands, bldgs } = surveyRows();
  const table = (title, rows) => {
    if (!rows.length) return `<h2>${title}</h2><p>입력된 행이 없습니다.</p>`;
    const keys = Object.keys(rows[0]);
    const cell = v => (typeof v === 'number' ? fmt(v, Number.isInteger(v) ? 0 : 1) : esc(v));
    return `<h2>${title}</h2><table><thead><tr>${keys.map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${keys.map(k => `<td>${cell(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  let sheet = $('#printSheet');
  if (!sheet) { sheet = document.createElement('div'); sheet.id = 'printSheet'; document.body.append(sheet); }
  sheet.innerHTML = `<div class="survey-print"><h1>${esc(S.meta.name || '정비사업')} 토지·건축물조서</h1><p>위치: ${esc(S.meta.location || '-')} · 작성일 ${new Date().toLocaleDateString('sv-SE')}</p>${table('토지조서', lands)}<div class="pb"></div>${table('건축물조서', bldgs)}</div>`;
  let st = $('#pageStyle');
  if (!st) { st = document.createElement('style'); st.id = 'pageStyle'; document.head.append(st); }
  st.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.body.classList.add('print-sheet');
  const done = () => { document.body.classList.remove('print-sheet'); sheet.innerHTML = ''; st.textContent = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 100);
}

// ---------- 시작 ----------
function boot() {
  bindInputs();

  $$('#tabs a').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    App.go(a.dataset.tab);
  }));

  $('#btnSample').onclick = () => {
    if (confirm('예시 데이터(가상의 재개발 구역)를 불러옵니다. 지금 입력한 내용은 바뀝니다. 계속할까요?')) App.replaceState(sampleState());
  };
  // 홈·새로 시작: 둘 다 초기화 안내 창을 거침
  $('#btnHome').onclick = () => App.home();
  $('#btnReset').onclick = () => App.home();
  $('#homeCancel').onclick = () => $('#homeDialog').close();
  $('#homeReset').onclick = () => { $('#homeDialog').close(); App.fullReset(); };
  $('#homeSaveReset').onclick = async () => {
    $('#homeDialog').close();
    if (await PdfStore.save()) setTimeout(() => App.fullReset(), 300);
  };
  // 저장은 PDF(요약·도면 + 숨긴 작업 데이터), 열기는 그 PDF 또는 예전 JSON
  $('#btnSave').onclick = () => PdfStore.save();
  $('#btnOpen').onclick = () => PdfStore.open();
  $('#btnPrint').onclick = () => {
    // 인쇄 시 모든 탭을 펼쳐서 보고서처럼 출력
    Object.keys(Tabs).forEach(t => { if (t !== 'area') Tabs[t].render(); });
    document.body.classList.add('printing');
    setTimeout(() => { window.print(); document.body.classList.remove('printing'); App.show(App.current); }, 100);
  };

  $('#searchForm').onsubmit = e => { e.preventDefault(); MapView.search($('#searchInput').value); };
  $('#btnGeojson').onclick = () => MapView.exportGeoJSON();
  $('#btnGeojsonOpen').onclick = () => MapView.importGeoJSON();
  // 참고 도면 겹쳐 보기
  $('#btnRefLoad').onclick = () => RefOverlay.load();
  $('#btnRefAlign').onclick = () => RefOverlay.startAlign();
  $('#btnRefToggle').onclick = () => RefOverlay.toggle();
  $('#btnRefRemove').onclick = () => RefOverlay.remove();
  $('#refOpacity').oninput = e => RefOverlay.setOpacity(num(e.target.value));
  $('#btnPick').onclick = () => MapView.setPicking(!MapView.picking);
  $('#btnImportArea').onclick = () => MapView.importArea();
  // 지도에서 불러온 필지·건축물만 지움 (직접 입력한 행은 유지)
  $('#btnClearParcels').onclick = () => {
    const n = S.lands.filter(l => l.pnu).length, m = S.buildings.filter(b => b.auto).length;
    const sr = sampleRows(), sn = sr.lands.length + sr.buildings.length;
    if (!n && !m && !sn) { alert('지도에서 불러온 필지가 없습니다.'); return; }
    // 예시 데이터(가상 필지)가 있으면 같이 지울지 따로 물음
    const withSample = sn > 0 && confirm(`예시 데이터(가상 필지 ${sr.lands.length}개·건축물 ${sr.buildings.length}동)도 함께 지울까요?`);
    if (n || m) {
      if (!confirm(`지도에서 불러온 필지 ${n}개와 건축물 ${m}동을 조서에서 지울까요? 직접 입력한 행은 그대로 둡니다.`)) { if (!withSample) return; }
      else { S.lands = S.lands.filter(l => !l.pnu); S.buildings = S.buildings.filter(b => !b.auto); }
    } else if (!withSample) return;
    if (withSample) clearSampleRows();
    MapView.drawParcels();
    $('#pickMsg').textContent = '불러온 필지와 건축물을 지웠습니다. 필지 선택을 켜고 다시 고르거나, 구역 안 필지·건축물 불러오기를 누르세요.';
    App.update(true);
  };
  $('#btnPdf').onclick = () => Export.pdf($('#exportPaper').value);
  $('#btnDxf').onclick = () => Export.dxf();

  // 개요의 주소 검색: 위치·용도지역 자동 입력, 구역계 지도도 그 위치로
  $('#ovSearchForm').onsubmit = async e => {
    e.preventDefault();
    const q = $('#ovSearchInput').value.trim();
    const msg = $('#ovSearchMsg');
    if (!q) return;
    msg.textContent = '검색 중…';
    try {
      let list = VWorld.enabled ? await MapView.searchVWorld(q).catch(() => []) : [];
      if (!list.length) list = await MapView.searchOSM(q);
      if (!list.length) { msg.textContent = '검색 결과가 없습니다. 지번이나 도로명 주소로 다시 검색해 보세요.'; return; }
      if (MapView.map) MapView.goTo(list[0]);
      await Auto.location(list[0]);
      msg.innerHTML = `<b>${esc(list[0].label)}</b>(으)로 설정했습니다. 다음은 <a href="#area" data-goto="area">구역계</a>에서 사업 구역을 그려 주세요.`;
      $('[data-goto]', msg).onclick = ev => { ev.preventDefault(); App.go('area'); };
    } catch (err) {
      msg.textContent = '검색에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    }
  };
  // 직접 고친 위치·용도지역은 이후 자동 입력으로 덮어쓰지 않음
  $('#locInput').addEventListener('input', () => { S.meta.locationManual = true; });
  $('#zoningSelect').addEventListener('change', () => { S.meta.zoningManual = true; App.update(); });

  // 각 단계 아래에 이전/다음 버튼
  const order = Object.keys(Tabs);
  order.forEach((t, i) => {
    const nav = document.createElement('div');
    nav.className = 'step-nav';
    if (i > 0) nav.innerHTML += `<button class="btn" data-goto="${order[i - 1]}">← ${$(`#tabs a[data-tab="${order[i - 1]}"]`).textContent.slice(1)}</button>`;
    if (i < order.length - 1) nav.innerHTML += `<button class="btn primary" data-goto="${order[i + 1]}">다음: ${$(`#tabs a[data-tab="${order[i + 1]}"]`).textContent.slice(1)} →</button>`;
    $('#tab-' + t).append(nav);
  });
  $$('.step-nav [data-goto]').forEach(b => { b.onclick = () => App.go(b.dataset.goto); });
  $('#btnParcelsToArea').onclick = () => MapView.parcelsToArea();
  $('#showParcels').onchange = e => { S.area.showParcels = e.target.checked; MapView.drawParcels(); App.persist(); };
  $$('[data-csv]').forEach(b => { b.onclick = () => csvAction(b.dataset.csv, b.dataset.act); });
  $('#btnSortJibun').onclick = sortByJibun;
  $('#btnLedger').onclick = async () => { await Ledger.fill(); App.update(true); };

  // 지번 목록으로 구역 만들기
  const guessBase = () => {
    const m = String(S.meta.location || '').match(/^(.*?[가-힣]+(동|리|가))(\s|\d|$)/);
    return m ? m[1].trim() : '';
  };
  $('#btnAnchorZone').onclick = () => MapView.estimateFromAnchors(
    $('#jibunList').value.split(/[\n,;\t]+/),
    $('#jibunBase').value.trim() || guessBase(),
    num($('#anchorTarget').value),
    { threshold: num($('#snapThreshold').value) || 0.5, fillHoles: $('#optFillHoles').checked, bridge: $('#optBridge').checked },
  );
  $('#btnSnapZone').onclick = () => MapView.snapToParcels({
    threshold: num($('#snapThreshold').value) || 0.5,
    fillHoles: $('#optFillHoles').checked, bridge: $('#optBridge').checked,
  });
  $('#btnJibunZone').onclick = () => {
    const base = $('#jibunBase').value.trim() || guessBase();
    const items = $('#jibunList').value.split(/[\n,;\t]+/);
    MapView.zoneFromJibuns(items, base, { fillHoles: $('#optFillHoles').checked, bridge: $('#optBridge').checked });
  };
  $('#btnJibunFile').onclick = () => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = '.xlsx,.xls,.csv,.txt';
    i.onchange = async () => {
      const f = i.files[0];
      if (!f) return;
      let rows;
      if (/\.xlsx?$/i.test(f.name)) {
        const wb = XLSX.read(await f.arrayBuffer());
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false });
      } else {
        const buf = await f.arrayBuffer();
        let text;
        try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('euc-kr').decode(buf); }
        rows = parseCSV(text);
      }
      // '지번' 제목이 있는 열을 찾고, '소재지·주소' 열이 있으면 앞에 붙임
      const hi = rows.findIndex(r => r.some(c => /지번/.test(String(c))));
      let list;
      if (hi >= 0) {
        const jc = rows[hi].findIndex(c => /지번/.test(String(c)));
        const ac = rows[hi].findIndex(c => /소재지|주소/.test(String(c)));
        list = rows.slice(hi + 1).map(r => {
          const j = String(r[jc] ?? '').trim(), a = ac >= 0 ? String(r[ac] ?? '').trim() : '';
          return a && !/\d+(-\d+)?$/.test(a) ? `${a} ${j}` : j;
        });
      } else list = rows.flat().map(c => String(c ?? '').trim());
      $('#jibunList').value = list.filter(s => /\d/.test(s)).join('\n');
      $('#jibunMsg').textContent = `${f.name}에서 지번 ${$('#jibunList').value.split('\n').filter(Boolean).length}개를 읽었습니다. 기준 동을 확인하고 "지번으로 구역 만들기"를 누르세요.`;
    };
    i.click();
  };
  $('#btnBaseToday').onclick = () => { S.criteria.baseDate = ''; App.update(true); };
  Assume.bind();
  $('#btnRoadCut').onclick = () => { LotCut.stop(); RoadCut.start(); };
  $('#btnLotCut').onclick = () => LotCut.start();
  $('#fitKeep').onclick = () => $('#fitDialog').close();
  $('#fitSnap').onclick = async () => {
    $('#fitDialog').close();
    App.go('area');
    await new Promise(r => setTimeout(r, 300));   // 지도가 그려진 뒤
    const jb = $('#jibunMsg');
    if (jb) jb.closest('details') && (jb.closest('details').open = true);
    MapView.snapToParcels({ threshold: 0.5, fillHoles: $('#optFillHoles').checked, bridge: $('#optBridge').checked });
  };
  $('#regionSelect').onchange = e => {
    applyRegion(S.criteria, e.target.value);
    S.criteria.regionManual = true;
    bindInputs();
    App.update(true);
  };
  $('#btnSurveyXlsx').onclick = saveSurveyXlsx;
  $$('.btn-zone-docs').forEach(b => { b.onclick = () => saveZoneDocs(); });
  $$('[data-zdoc]').forEach(b => { b.onclick = () => saveZoneDocs(b.dataset.zdoc); });
  $('#btnSurveyPrint').onclick = printSurvey;

  App.show((location.hash || '#overview').slice(1));
}

document.addEventListener('DOMContentLoaded', boot);
