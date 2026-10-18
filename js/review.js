'use strict';

// =====================================================================
// 8. 검토 모드 (인허가 담당자용)
//   명부(엑셀) → 공부 조회(브이월드) → 구역 자동 생성 → 신청 도면(PDF) 구역선 정합
//   → 경계 필지 안/밖 면적 → 자동 검사 → 법정서식·사업성 검토표 엑셀, 사업성 탭 연결
//   개인정보는 이 브라우저 안에서만 다룸(서버 전송 없음)
//   필요: Leaflet, Turf 6.5, XLSX, VWorld, jsonp, App, Tabs, S, Forms (forms.js)
// =====================================================================

const Review = (() => {
  const PY = 3.305785;
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const PUBLIC_RE = /(대한민국|^국$|국유|인천광역시|서울특별시|광역시|특별시|[가-힣]+(시|구|군)$|미추홀구|남구청|한국토지주택공사|LH|도시공사|철도공단|국가철도)/;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const R = {                 // 현재 검토 상태 (메모리에만 보관)
    name: '', sigungu: '인천광역시 미추홀구', dongCodes: {}, defaultDong: '',
    rows: [], map: {}, header: [], hdrRow: 0, sheetName: '',
    parcels: [], owners: [], cad: {}, cadAll: {}, zone: null, drawn: null, fit: null,
    checks: [], leaflet: null, layers: {}, busy: false,
  };

  // ---------------------------------------------------------------
  // 화면
  // ---------------------------------------------------------------
  function css() {
    if (document.getElementById('review-css')) return;
    const st = document.createElement('style'); st.id = 'review-css';
    st.textContent = `
#tab-review .rv-step{border:1px solid #d9dee6;border-radius:10px;padding:14px 16px;margin:12px 0;background:#fff}
#tab-review .rv-step h3{margin:0 0 8px;font-size:16px}
#tab-review .rv-step h3 b{display:inline-block;width:24px;height:24px;border-radius:12px;background:#1f4e79;color:#fff;text-align:center;line-height:24px;margin-right:6px;font-size:13px}
#tab-review .rv-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:6px 0}
#tab-review .rv-row label{font-size:13px;color:#444}
#tab-review .rv-row input[type=text],#tab-review .rv-row input[type=number],#tab-review .rv-row select{padding:5px 7px;border:1px solid #c5ccd6;border-radius:6px;font-size:13px}
#tab-review .rv-msg{font-size:13px;color:#333;margin:6px 0;white-space:pre-wrap}
#tab-review .rv-msg.err{color:#b00020}
#tab-review .rv-prog{height:6px;background:#eef1f5;border-radius:3px;overflow:hidden;margin:6px 0}
#tab-review .rv-prog i{display:block;height:100%;width:0;background:#2e75b6;transition:width .2s}
#tab-review table.rv-t{border-collapse:collapse;font-size:12px;width:100%}
#tab-review table.rv-t th,#tab-review table.rv-t td{border:1px solid #e1e5ea;padding:3px 6px;text-align:left}
#tab-review table.rv-t td.n{text-align:right;font-variant-numeric:tabular-nums}
#tab-review table.rv-t tr.warn td{background:#fff4e5}
#tab-review table.rv-t tr.bad td{background:#fde8e8}
#tab-review .rv-map{height:560px;border:1px solid #d9dee6;border-radius:8px;margin-top:8px}
#tab-review .rv-scroll{max-height:360px;overflow:auto;border:1px solid #e1e5ea;border-radius:6px}
#tab-review .rv-kpi{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0}
#tab-review .rv-kpi div{border:1px solid #e1e5ea;border-radius:8px;padding:8px 12px;min-width:140px}
#tab-review .rv-kpi b{display:block;font-size:18px}
#tab-review .rv-kpi span{font-size:12px;color:#666}
#tab-review .rv-legend span{display:inline-block;margin-right:12px;font-size:12px}
#tab-review .rv-legend i{display:inline-block;width:14px;height:10px;margin-right:4px;vertical-align:middle}
#tab-review details{margin-top:6px}`;
    document.head.appendChild(st);
  }

  function html() {
    return `
<div class="card"><h2>검토 모드 <small class="muted">— 제출된 명부·도면을 공부와 대조합니다 (자료는 이 PC 브라우저 안에서만 처리)</small></h2>
<p class="small muted">순서: ① 명부 → ② 공부 조회 → ③ 구역 확인 → ④ 신청 도면 대조(선택) → ⑤ 검사 결과 → ⑥ 서식·사업성</p></div>

<div class="rv-step" id="rvS1"><h3><b>1</b>토지등소유자 명부 올리기</h3>
 <div class="rv-row"><label>구역 이름 <input type="text" id="rvName" placeholder="예: 용현1구역(B안)" size="22"></label>
  <label>시·군·구 <input type="text" id="rvSigungu" value="인천광역시 미추홀구" size="18"></label>
  <label>기본 법정동 <input type="text" id="rvDong" placeholder="예: 용현동" size="8"></label></div>
 <div class="rv-row"><input type="file" id="rvFile" accept=".xlsx,.xls,.csv"> <button class="btn" id="rvReparse">열 지정 다시 읽기</button></div>
 <div class="rv-msg" id="rvMsg1"></div>
 <details id="rvMapBox"><summary>읽은 열 확인·수정</summary><div id="rvMapping"></div></details>
</div>

<div class="rv-step" id="rvS2"><h3><b>2</b>공부 조회 (브이월드)</h3>
 <div class="rv-row"><button class="btn primary" id="rvFetch">지적도·토지특성 조회</button>
  <label><input type="checkbox" id="rvChar" checked> 토지특성(대장면적·지목·용도지역·공시지가)도 조회 (필지당 1건, 시간 걸림)</label></div>
 <div class="rv-prog"><i id="rvProg"></i></div><div class="rv-msg" id="rvMsg2"></div>
</div>

<div class="rv-step" id="rvS3"><h3><b>3</b>구역 확인</h3>
 <div class="rv-kpi" id="rvKpi"></div>
 <div class="rv-legend"><span><i style="background:#ffd27f"></i>명부 필지(전체편입)</span><span><i style="background:#ffa94d"></i>명부상 일부편입</span><span><i style="background:#ff4d4d"></i>도면 구역선 밖으로 나간 부분</span><span><i style="background:#7fb2ff"></i>구역선 안인데 명부에 없음</span><span><i style="border-top:3px solid #e67e00;height:0"></i>명부 필지 합친 경계</span><span><i style="border-top:3px dashed #1a1aff;height:0"></i>신청 도면 구역선</span></div>
 <div class="rv-map" id="rvMap"></div>
</div>

<div class="rv-step" id="rvS4"><h3><b>4</b>신청 도면 구역선 대조 (선택)</h3>
 <p class="small muted">편입지적도 PDF(빨간 구역선)를 올리면, 도면의 지번 글자를 기준점으로 지적도에 맞춘 뒤 경계 필지마다 구역선 안/밖 면적을 계산합니다.</p>
 <div class="rv-row"><input type="file" id="rvPdf" accept=".pdf"> <label>선 색 <select id="rvColor"><option value="red">빨강</option><option value="blue">파랑</option></select></label></div>
 <div class="rv-msg" id="rvMsg4"></div>
</div>

<div class="rv-step" id="rvS5"><h3><b>5</b>자동 검사 결과</h3>
 <div id="rvChecks" class="rv-msg">명부와 공부를 조회하면 결과가 나옵니다.</div>
 <div class="rv-scroll" id="rvTableBox"></div>
</div>

<div class="rv-step" id="rvS6"><h3><b>6</b>서식 자동 기입 · 사업성</h3>
 <div class="rv-row"><button class="btn primary" id="rvForms">법정서식 엑셀 (별지 제4·5·6·9호)</button>
  <button class="btn" id="rvReviewXlsx">검토표 엑셀</button>
  <button class="btn" id="rvFromArea">2구역계 탭의 구역으로 서식 만들기</button></div>
 <div class="rv-row"><label>공시지가 배율 <input type="number" id="rvMult" value="1.4" step="0.1" style="width:60px"></label>
  <label>동의율(분양대상) <input type="number" id="rvConsent" value="80" step="5" style="width:60px">%</label>
  <label>계획 연면적(㎡) <input type="number" id="rvGfa" placeholder="비우면 용적률로 추정" style="width:130px"></label>
  <label>용적률(%) <input type="number" id="rvFar" value="250" style="width:60px"></label>
  <label>평당 공사비(원) <input type="number" id="rvConst" value="7000000" step="100000" style="width:100px"></label>
  <label>단가 기준 <select id="rvPreset"><option value="">자동(규모로 판단)</option><option value="small">소규모·가로주택(구청 검토 엑셀)</option><option value="redev">재개발 대규모</option></select></label></div>
 <div class="rv-row"><label>평형 <input type="text" id="rvUnits" size="70" value="59형:82.78:59.98:0:0:17800000, 84형:112.45:84.98:0:0:17500000"></label>
  <span class="small muted">타입:공급㎡:전용㎡:조합원세대:일반세대:일반평당분양가</span></div>
 <div class="rv-row"><label>상가 분양면적(㎡) <input type="number" id="rvRetail" value="0" style="width:90px"></label>
  <button class="btn primary" id="rvFeas">사업성 검토표 엑셀</button>
  <button class="btn" id="rvToApp">사업성 탭(4~7)으로 보내기</button> <button class="btn" id="rvLedger">건축물대장 조회(건축물조서)</button> <button class="btn" id="rvRoad">접도 판정 지도</button></div>
 <div class="rv-row"><label>내 공공데이터 인증키 <input type="password" id="rvMyKey" size="40" placeholder="비우면 홈페이지 공용 키 사용"></label>
  <button class="btn" id="rvMyKeySave">이 PC에 저장</button> <button class="btn" id="rvCacheClear">저장된 대장 지우기</button> <span id="rvCacheInfo" class="rv-note"></span></div>
 <div class="rv-msg" id="rvMsg6"></div>
</div>`;
  }

  const $r = id => document.getElementById(id);
  const msg = (id, t, err) => { const e = $r(id); if (e) { e.textContent = t; e.classList.toggle('err', !!err); } };
  const prog = f => { const e = $r('rvProg'); if (e) e.style.width = Math.round(f * 100) + '%'; };
  const fmtN = (v, d = 1) => v == null || isNaN(v) ? '' : Number(v).toLocaleString('ko-KR', { maximumFractionDigits: d, minimumFractionDigits: 0 });

  function install() {
    if (document.getElementById('tab-review')) return;
    if (typeof Ledger !== 'undefined') hookDataGoKr();
    css();
    const nav = document.getElementById('tabs'), main = document.querySelector('main');
    if (!nav || !main) return;
    const a = document.createElement('a');
    a.href = '#review'; a.dataset.tab = 'review'; a.innerHTML = '<b>8</b>검토 모드';
    a.addEventListener('click', e => { e.preventDefault(); App.go('review'); });
    nav.appendChild(a);
    const sec = document.createElement('section');
    sec.id = 'tab-review'; sec.className = 'panel'; sec.hidden = true; sec.innerHTML = html();
    main.appendChild(sec);
    bind();
  }

  function bind() {
    $r('rvFile').onchange = e => e.target.files[0] && readFile(e.target.files[0]);
    $r('rvReparse').onclick = () => { if (R.rows.length) { applyMapping(); } };
    $r('rvFetch').onclick = () => fetchAll().catch(err => msg('rvMsg2', '조회 오류: ' + err.message, true));
    $r('rvPdf').onchange = e => e.target.files[0] && matchPdf(e.target.files[0]).catch(err => msg('rvMsg4', '도면 처리 오류: ' + err.message, true));
    $r('rvForms').onclick = () => { const z = zoneData(); if (!z) return; Forms.exportForms(z, `${z.name}_법정서식.xlsx`); };
    $r('rvReviewXlsx').onclick = exportReview;
    $r('rvFeas').onclick = () => { const z = zoneData(); if (!z) return; Forms.feasibility(z, feasParams(), `${z.name}_사업성검토.xlsx`); };
    $r('rvToApp').onclick = toApp;
    try { $r('rvMyKey').value = localStorage.getItem(KEY_LS) || ''; } catch (e) { }
    $r('rvMyKeySave').onclick = () => { const v = $r('rvMyKey').value.trim(); try { v ? localStorage.setItem(KEY_LS, v) : localStorage.removeItem(KEY_LS); } catch (e) { } msg('rvMsg6', v ? '내 인증키를 이 PC에 저장했습니다. 건축물대장 조회는 이제 내 키로 합니다.' : '내 인증키를 지웠습니다. 공용 키로 조회합니다.'); };
    $r('rvCacheClear').onclick = async () => { await Cache.clear(); cacheInfo(); msg('rvMsg6', '저장된 건축물대장을 지웠습니다. 다음 조회는 처음부터 받습니다.'); };
    cacheInfo();
    $r('rvRoad').onclick = toggleRoadLayer;
    $r('rvLedger').onclick = () => ledger().catch(err => msg('rvMsg6', '건축물대장 오류: ' + err.message, true));
    $r('rvFromArea').onclick = () => fromArea().catch(err => msg('rvMsg6', '오류: ' + err.message, true));
  }

  // ---------------------------------------------------------------
  // 1. 명부 읽기 (열 자동 인식)
  // ---------------------------------------------------------------
  const FIELDS = [
    ['jibun', '지번(소재지)', /^(지\s*번|소재지|소재\s*지번|대표지번)$|지번/],
    ['bon', '본번', /본번/], ['bu', '부번', /부번/],
    ['name', '성명', /성\s*명|소유자명|소유자$/],
    ['birth', '생년월일·주민번호', /생년|주민/],
    ['addr', '주소', /주\s*소/],
    ['phone', '전화', /전화|연락/],
    ['jimok', '지목', /지\s*목/],
    ['area1', '공부(1필지)면적', /공부|1\s*필지|필지면적|대장면적|토지면적/],
    ['areaIn', '편입면적', /편입/],
    ['own', '소유면적', /소유\s*면적|지분\s*면적/],
    ['share', '지분', /^지\s*분$|지분율|공유지분/],
    ['bdong', '동(건물)', /^동$|^동\s*명$|건물\s*동/],
    ['ho', '호', /^호$|^호\s*수$|호실/],
    ['type', '소유구분', /소유\s*구분|^구\s*분$|국공유/],
    ['ldong', '법정동', /법정동|^동\s*리$|동리/],
    ['ownerNo', '소유자 번호', /연번|^번호$|소유자\s*번호/],
  ];

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    // 가장 행이 많은 시트 = 명부
    let best = null;
    wb.SheetNames.forEach(n => { const a = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '' }); if (!best || a.length > best.a.length) best = { n, a }; });
    R.sheetName = best.n; R.rows = best.a;
    R.name = $r('rvName').value || file.name.replace(/\.[^.]+$/, '');
    if (!$r('rvName').value) $r('rvName').value = R.name;
    detectHeader(); renderMapping(); applyMapping();
  }

  function detectHeader() {
    let hr = 0, score = -1;
    for (let i = 0; i < Math.min(15, R.rows.length); i++) {
      const t = R.rows[i].map(String).join('|');
      const sc = (/성\s*명|소유자/.test(t) ? 2 : 0) + (/지\s*번|소재지|본번/.test(t) ? 2 : 0) + (/면적/.test(t) ? 1 : 0) + (/지\s*목/.test(t) ? 1 : 0);
      if (sc > score) { score = sc; hr = i; }
    }
    // 2단 머리글 합치기
    const h1 = R.rows[hr] || [], h2 = R.rows[hr + 1] || [];
    const two = h2.filter(v => String(v).trim() && isNaN(+v)).length >= 2;
    const width = Math.max(h1.length, h2.length);
    const up = []; let last = '';
    for (let c = 0; c < width; c++) { const v = String(h1[c] ?? '').trim(); if (v) last = v; up.push(v || (two ? last : '')); }
    R.header = up.map((v, c) => two ? `${v}${String(h2[c] ?? '').trim() ? ' ' + String(h2[c]).trim() : ''}`.trim() : v);
    R.hdrRow = hr + (two ? 2 : 1);
    R.map = {};
    const used = new Set();
    // 더 구체적인 것부터
    const order = ['areaIn', 'own', 'area1', 'bon', 'bu', 'name', 'birth', 'addr', 'phone', 'jimok', 'share', 'bdong', 'ho', 'type', 'ldong', 'ownerNo', 'jibun'];
    order.forEach(k => {
      const re = FIELDS.find(f => f[0] === k)[2];
      const c = R.header.findIndex((h, i) => !used.has(i) && re.test(h.replace(/\s+/g, ' ')));
      if (c >= 0) { R.map[k] = c; used.add(c); }
    });
    // 명부에 '면적' 하나만 있으면 공부면적으로
    if (R.map.area1 == null) { const c = R.header.findIndex((h, i) => !used.has(i) && /면적/.test(h)); if (c >= 0) R.map.area1 = c; }
  }

  function renderMapping() {
    const opts = ['<option value="">(없음)</option>', ...R.header.map((h, i) => `<option value="${i}">${XLSX.utils.encode_col(i)}열: ${esc(h || '-')}</option>`)].join('');
    $r('rvMapping').innerHTML = `<p class="small">시트 "${esc(R.sheetName)}", 머리글 ${R.hdrRow}행 아래부터 읽음</p>` +
      FIELDS.map(([k, lab]) => `<label style="display:inline-block;margin:3px 10px 3px 0">${lab} <select data-k="${k}">${opts}</select></label>`).join('');
    $r('rvMapping').querySelectorAll('select').forEach(s => { s.value = R.map[s.dataset.k] ?? ''; s.onchange = () => { s.value === '' ? delete R.map[s.dataset.k] : (R.map[s.dataset.k] = +s.value); }; });
  }

  const cleanName = n => String(n || '').replace(/\(\d+\)\s*$/, '').replace(/(?<=[가-힣])[A-Z]$/, '').trim();
  const num = v => { if (v === '' || v == null) return null; const x = +String(v).replace(/,/g, ''); return isNaN(x) ? null : x; };

  function normJibun(row) {
    const m = R.map;
    if (m.bon != null && String(row[m.bon]).trim()) {
      const b = String(row[m.bon]).trim().replace(/\.0$/, ''), s = m.bu != null ? String(row[m.bu]).trim().replace(/\.0$/, '') : '';
      return s && s !== '0' ? `${+b}-${+s}` : `${+b}`;
    }
    if (m.jibun == null) return '';
    const t = String(row[m.jibun]);
    const mm = t.match(/(산\s*)?(\d+)(?:\s*-\s*(\d+))?/);
    return mm ? (mm[3] && +mm[3] ? `${+mm[2]}-${+mm[3]}` : `${+mm[2]}`) : '';
  }

  function applyMapping() {
    const m = R.map; const body = R.rows.slice(R.hdrRow);
    let lastJ = '', lastA1 = null, lastJm = '', lastDong = '';
    const recs = [];
    body.forEach(row => {
      if (!row || !row.some(v => String(v).trim())) return;
      let j = normJibun(row);
      const nm = m.name != null ? cleanName(row[m.name]) : '';
      if (!j && nm) j = lastJ;                 // 같은 필지의 공유자 행
      if (!j) return;
      if (j !== lastJ) { lastA1 = null; lastJm = ''; }
      const a1 = m.area1 != null ? num(row[m.area1]) : null; if (a1 != null) lastA1 = a1;
      const jm = m.jimok != null ? String(row[m.jimok]).trim() : ''; if (jm) lastJm = jm;
      const ld = m.ldong != null ? String(row[m.ldong]).trim() : ''; if (ld) lastDong = ld;
      lastJ = j;
      recs.push({
        jibun: j, ldong: ld || lastDong, name: nm, birth: m.birth != null ? String(row[m.birth]).trim() : '',
        addr: m.addr != null ? String(row[m.addr]).trim() : '', phone: m.phone != null ? String(row[m.phone]).trim() : '',
        jimok: jm || lastJm, area1: a1 ?? lastA1, areaIn: m.areaIn != null ? num(row[m.areaIn]) : null,
        own: m.own != null ? num(row[m.own]) : null, share: m.share != null ? String(row[m.share]).trim() : '',
        bdong: m.bdong != null ? String(row[m.bdong]).trim() : '', ho: m.ho != null ? String(row[m.ho]).trim() : '',
        type: m.type != null ? String(row[m.type]).trim() : '', ownerNo: m.ownerNo != null ? String(row[m.ownerNo]).trim() : '',
      });
    });
    // 필지
    const P = new Map();
    recs.forEach(r => {
      const key = (r.ldong ? r.ldong + ' ' : '') + r.jibun;
      if (!P.has(key)) P.set(key, { key, jibun: r.jibun, dong: r.ldong || $r('rvDong').value || '', jimok: r.jimok, area1: r.area1, areaIn: r.areaIn, rows: [] });
      const p = P.get(key);
      if (p.area1 == null && r.area1 != null) p.area1 = r.area1;
      if (p.areaIn == null && r.areaIn != null) p.areaIn = r.areaIn;
      if (!p.jimok && r.jimok) p.jimok = r.jimok;
      p.rows.push(r);
    });
    R.parcels = [...P.values()].map(p => {
      const names = p.rows.map(r => r.name).filter(Boolean);
      const typ = p.rows.map(r => r.type).find(Boolean) || '';
      const pub = names.some(n => PUBLIC_RE.test(n));
      return { ...p, area: p.areaIn ?? p.area1, ownerType: typeLabel(typ, names), isPublic: pub || /국|시|구|공/.test(typ) };
    });
    // 소유자 (성명 + 생년 6자리, 국공유는 명의만)
    const O = new Map();
    recs.forEach(r => {
      if (!r.name) return;
      const pub = PUBLIC_RE.test(r.name);
      const k = pub ? 'PUB|' + r.name : r.name + '|' + String(r.birth).replace(/\D/g, '').slice(0, 6);
      if (!O.has(k)) O.set(k, { key: k, name: r.name, birth: r.birth, addr: r.addr, phone: r.phone, isPublic: pub, nos: new Set(), parcels: [] });
      const o = O.get(k); if (r.ownerNo) o.nos.add(r.ownerNo);
      o.parcels.push({ jibun: r.jibun, ho: [r.bdong, r.ho].filter(Boolean).join(' '), ownArea: r.own, inArea: r.own, share: r.share });
    });
    R.owners = [...O.values()].map((o, i) => ({ ...o, no: i + 1, nos: [...o.nos] }));
    const noArea = R.parcels.filter(p => p.area == null).length;
    msg('rvMsg1', `읽음: ${recs.length.toLocaleString()}행 → 필지 ${R.parcels.length.toLocaleString()}개, 소유자(성명+생년) ${R.owners.length.toLocaleString()}명` +
      `\n열: 지번=${colName('jibun', 'bon')}, 성명=${colName('name')}, 공부면적=${colName('area1')}, 편입면적=${colName('areaIn')}, 지목=${colName('jimok')}` +
      (m.areaIn == null ? '\n⚠ 편입면적 열이 없습니다 → 공부면적을 편입면적으로 봅니다(일부편입 필지 확인 필요).' : '') +
      (noArea ? `\n⚠ 면적이 비어 있는 필지 ${noArea}개` : ''));
    R.cad = {}; R.zone = null; R.drawn = null;
    runChecks();
  }
  const colName = (...ks) => { const k = ks.find(x => R.map[x] != null); return k ? `${XLSX.utils.encode_col(R.map[k])}열(${R.header[R.map[k]] || ''})` : '없음'; };
  function typeLabel(t, names) {
    if (/국/.test(t)) return '국유지'; if (/시유/.test(t)) return '시유지'; if (/구유|군유/.test(t)) return '구유지';
    if (/공공|공사/.test(t)) return '공공기관';
    const n = names.join(' ');
    if (/대한민국|^국$| 국 |국유/.test(n) || names.includes('국')) return '국유지';
    if (/광역시|특별시|도청/.test(n) && !/구$/.test(n)) return '시유지';
    if (/구청|미추홀구|남구|[가-힣]구$|[가-힣]군$/.test(n)) return '구유지';
    if (/한국토지주택공사|도시공사|공단/.test(n)) return '공공기관';
    return '사유지';
  }

  // ---------------------------------------------------------------
  // 2. 공부 조회
  // ---------------------------------------------------------------
  async function dongCode(dong) {
    if (R.dongCodes[dong]) return R.dongCodes[dong];
    const sg = $r('rvSigungu').value.trim();
    const sample = R.parcels.find(p => (p.dong || '') === dong) || R.parcels[0];
    const res = await VWorld.search(`${sg} ${dong} ${sample.jibun}`);
    const hit = (res || []).find(x => x.precise) || (res || [])[0];
    if (!hit) throw new Error(`"${sg} ${dong}" 위치를 찾지 못했습니다`);
    const f = await VWorld.parcelAt(hit.lat, hit.lon);
    const pnu = f && (f.properties ? f.properties.pnu : f.pnu);
    if (!pnu) throw new Error(`"${dong}" 법정동 코드를 찾지 못했습니다`);
    R.dongCodes[dong] = { code: pnu.slice(0, 10), lat: hit.lat, lon: hit.lon };
    return R.dongCodes[dong];
  }
  const pnuOf = (code, j) => { const [b, s] = String(j).split('-'); return code + '1' + String(b).padStart(4, '0') + String(s || 0).padStart(4, '0'); };

  async function fetchAll() {
    if (!R.parcels.length) return msg('rvMsg2', '먼저 명부를 올려 주세요.', true);
    if (R.busy) return; R.busy = true;
    try {
      const dongs = [...new Set(R.parcels.map(p => p.dong || $r('rvDong').value || ''))];
      if (dongs.includes('') && !$r('rvDong').value) throw new Error('명부에 법정동 열이 없으면 "기본 법정동"을 입력해 주세요 (예: 용현동)');
      for (const d of dongs) { await dongCode(d || $r('rvDong').value); }
      R.parcels.forEach(p => { const d = p.dong || $r('rvDong').value; p.dong = d; p.pnu = pnuOf(R.dongCodes[d].code, p.jibun); });
      // 지적도: 대표 위치에서 바둑판으로 넓혀 가며 받기
      msg('rvMsg2', '지적도 받는 중…');
      const need = new Set(R.parcels.map(p => p.pnu));
      const done = new Set(); const DX = 0.004, DY = 0.003;
      const seeds = Object.values(R.dongCodes).map(c => [Math.floor(c.lon / DX), Math.floor(c.lat / DY)]);
      const queue = [...seeds]; let n = 0;
      while (queue.length && n < 120) {
        const [ix, iy] = queue.shift(); const k = ix + ',' + iy; if (done.has(k)) continue; done.add(k); n++;
        const box = `BOX(${(ix * DX).toFixed(4)},${(iy * DY).toFixed(4)},${((ix + 1) * DX).toFixed(4)},${((iy + 1) * DY).toFixed(4)})`;
        let feats = [];
        try { feats = await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10); } catch (e) { await sleep(1500); try { feats = await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10); } catch (e2) { feats = []; } }
        let hit = 0; feats.forEach(f => { R.cadAll[f.properties.pnu] = f; if (need.has(f.properties.pnu)) hit++; });
        const found = [...need].filter(p => R.cadAll[p]).length;
        prog(found / need.size * 0.5);
        msg('rvMsg2', `지적도: 구획 ${n}개 조회, 명부 필지 ${found}/${need.size} 찾음`);
        if (found === need.size) break;
        if (hit > 0 || n <= seeds.length) [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]].forEach(([a, b]) => queue.push([ix + a, iy + b]));
        await sleep(300);
      }
      R.parcels.forEach(p => { p.feat = R.cadAll[p.pnu] || null; if (p.feat) { p.jiga = +p.feat.properties.jiga || p.jiga || 0; p.cadArea = turf.area(p.feat); } });
      const miss = R.parcels.filter(p => !p.feat);
      // 토지특성
      if ($r('rvChar').checked) {
        const yr = new Date().getFullYear();
        for (let i = 0; i < R.parcels.length; i++) {
          const p = R.parcels[i];
          try {
            let d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu: p.pnu, key: VWorld.key, domain: VWorld.domain, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(yr) }, 15000);
            let f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0];
            if (!f) { d = await jsonp('https://api.vworld.kr/ned/data/getLandCharacteristics', { pnu: p.pnu, key: VWorld.key, domain: VWorld.domain, format: 'json', numOfRows: 1, pageNo: 1, stdrYear: String(yr - 1) }, 15000); f = d && d.landCharacteristicss && d.landCharacteristicss.field && d.landCharacteristicss.field[0]; }
            if (f) { p.ledgerArea = +f.lndpclAr; p.ledgerJimok = f.lndcgrCodeNm; p.zoning = [f.prposArea1Nm, f.prposArea2Nm].filter(x => x && x !== '지정되지않음').join(', '); p.jiga = +f.pblntfPclnd || p.jiga; p.baseYear = f.stdrYear; p.landUse = f.ladUseSittnNm; }
            else p.charMissing = true;
          } catch (e) { p.charError = e.message; await sleep(1200); }
          if (i % 5 === 0) { prog(0.5 + 0.5 * (i + 1) / R.parcels.length); msg('rvMsg2', `토지특성 ${i + 1}/${R.parcels.length}`); }
          await sleep(250);
        }
      }
      prog(1);
      buildZone();
      msg('rvMsg2', `완료: 지적도 ${R.parcels.length - miss.length}/${R.parcels.length}필지` + (miss.length ? `\n지적도에서 못 찾은 필지: ${miss.slice(0, 30).map(p => p.jibun).join(', ')}${miss.length > 30 ? ' …' : ''}` : ''));
    } finally { R.busy = false; }
  }

  // ---------------------------------------------------------------
  // 3. 구역 (명부 필지 전체를 합친 경계)
  // ---------------------------------------------------------------
  function buildZone() {
    const F = R.parcels.filter(p => p.feat).map(p => p.feat);
    if (!F.length) return;
    let U = F[0];
    for (let i = 1; i < F.length; i++) { try { U = turf.union(U, F[i]); } catch (e) { /* 아주 작은 오류 필지는 건너뜀 */ } }
    try { U = turf.buffer(turf.buffer(U, 0.4, { units: 'meters' }), -0.4, { units: 'meters' }); } catch (e) { }
    R.zone = U;
    runChecks(); drawMap();
  }

  function drawMap() {
    if (!R.zone) return;
    if (!R.leaflet) {
      R.leaflet = L.map('rvMap', { preferCanvas: true, maxZoom: 21 });
      if (VWorld.enabled) L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${VWorld.key}/white/{z}/{y}/{x}.png`, { maxZoom: 21, maxNativeZoom: 19, opacity: 0.6 }).addTo(R.leaflet);
    }
    const m = R.leaflet;
    Object.values(R.layers).forEach(l => m.removeLayer(l)); R.layers = {};
    const bb = turf.bbox(turf.buffer(R.zone, 0.05, { units: 'kilometers' }));
    const bg = Object.values(R.cadAll).filter(f => { const b = turf.bbox(f); return !(b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]); });
    R.layers.bg = L.geoJSON(turf.featureCollection(bg), { style: { color: '#aaa', weight: 0.5, fill: false }, interactive: false }).addTo(m);
    const fc = turf.featureCollection(R.parcels.filter(p => p.feat).map(p => ({ ...p.feat, properties: { ...p.feat.properties, _p: p } })));
    R.layers.parcels = L.geoJSON(fc, {
      style: f => { const p = f.properties._p; const part = p.ledgerArea && p.area != null && p.area < p.ledgerArea - 0.05; return { color: '#888', weight: 0.6, fillColor: part ? '#ffa94d' : '#ffd27f', fillOpacity: 0.45 }; },
      onEachFeature: (f, l) => { const p = f.properties._p; l.bindTooltip(`${p.dong} ${p.jibun} ${p.jimok || ''}<br>명부 공부 ${fmtN(p.area1)}㎡ / 편입 ${fmtN(p.area)}㎡<br>대장 ${fmtN(p.ledgerArea)}㎡${p.outArea ? `<br>도면 구역선 밖 ${fmtN(p.outArea)}㎡` : ''}`, { sticky: true }); },
    }).addTo(m);
    R.layers.zone = L.geoJSON(R.zone, { style: { color: '#e67e00', weight: 3, fill: false }, interactive: false }).addTo(m);
    if (R.drawn) {
      R.layers.drawn = L.geoJSON(R.drawn, { style: { color: '#1a1aff', weight: 2.5, dashArray: '10 4 2 4', fill: false }, interactive: false }).addTo(m);
      const outs = R.parcels.filter(p => p.outGeom).map(p => p.outGeom);
      if (outs.length) R.layers.outs = L.geoJSON(turf.featureCollection(outs), { style: { color: '#b00000', weight: 1, fillColor: '#ff4d4d', fillOpacity: 0.6 }, interactive: false }).addTo(m);
      if (R.extra && R.extra.length) R.layers.extra = L.geoJSON(turf.featureCollection(R.extra.map(e => e.geom)), { style: { color: '#1f5fbf', weight: 1, fillColor: '#7fb2ff', fillOpacity: 0.6 } }).addTo(m);
    }
    m.fitBounds([[bb[1], bb[0]], [bb[3], bb[2]]]);
    setTimeout(() => m.invalidateSize(), 100);
  }

  // ---------------------------------------------------------------
  // 4. 신청 도면(PDF) 구역선 정합
  // ---------------------------------------------------------------
  async function loadPdfJs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((ok, no) => { const s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js'; s.onload = ok; s.onerror = () => no(new Error('pdf.js를 불러오지 못했습니다')); document.head.appendChild(s); });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return window.pdfjsLib;
  }

  async function matchPdf(file) {
    if (!R.parcels.some(p => p.feat)) return msg('rvMsg4', '먼저 ② 공부 조회를 해 주세요(기준점이 될 지적도가 필요합니다).', true);
    msg('rvMsg4', '도면 읽는 중…');
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const page = await pdf.getPage(1);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.max(1, 3400 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    // 지번 글자
    const tc = await page.getTextContent();
    const labels = [];
    tc.items.forEach(it => {
      const s = (it.str || '').replace(/\s+/g, '');
      const m = s.match(/^(\d{1,4}(?:-\d{1,4})?)([가-힣])$/);
      if (!m) return;
      const [a, b, , , e, f] = it.transform;
      const len = Math.hypot(a, b) || 1;
      const w = it.width || 0, h = it.height || len;
      // 글자 중심(PDF 좌표) -> 캔버스 좌표
      const cx = e + (a / len) * w / 2 - (b / len) * h / 3, cy = f + (b / len) * w / 2 + (a / len) * h / 3;
      const [px, py] = vp.convertToViewportPoint(cx, cy);
      labels.push({ jibun: m[1], px, py, size: w * h });
    });
    msg('rvMsg4', `도면 지번 글자 ${labels.length}개, 구역선 찾는 중…`);
    await sleep(30);
    const ring = extractRing(ctx, cv.width, cv.height, $r('rvColor').value);
    if (!ring) throw new Error('도면에서 닫힌 구역선을 찾지 못했습니다(선 색 확인)');
    // 기준점: 같은 지번이 하나뿐인 필지의 중심
    const byJ = {};
    Object.values(R.cadAll).forEach(f => { const j = String(f.properties.jibun || '').replace(/[^\d-]/g, ''); if (!j) return; (byJ[j] = byJ[j] || []).push(f); });
    const c0 = turf.center(R.zone).geometry.coordinates; const lon0 = c0[0], lat0 = c0[1];
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const toM = ([lo, la]) => [(lo - lon0) * kx, (la - lat0) * ky], toLL = ([x, y]) => [lon0 + x / kx, lat0 + y / ky];
    const zb = turf.bbox(turf.buffer(R.zone, 0.3, { units: 'kilometers' }));
    let pairs = [];
    labels.sort((a, b) => b.size - a.size).forEach(l => {
      const c = (byJ[l.jibun] || []).filter(f => { const p = turf.centerOfMass(f).geometry.coordinates; return p[0] > zb[0] && p[0] < zb[2] && p[1] > zb[1] && p[1] < zb[3]; });
      if (c.length !== 1) return;
      const [X, Y] = toM(turf.centerOfMass(c[0]).geometry.coordinates);
      pairs.push({ u: l.px, v: l.py, X, Y });
    });
    if (pairs.length < 12) throw new Error(`도면 지번과 지적도를 맞출 기준점이 부족합니다(${pairs.length}개)`);
    let T, res;
    for (let it = 0; it < 5; it++) {
      T = affine(pairs);
      res = pairs.map(p => Math.hypot(T[0][0] * p.u + T[0][1] * p.v + T[0][2] - p.X, T[1][0] * p.u + T[1][1] * p.v + T[1][2] - p.Y));
      const srt = res.slice().sort((a, b) => a - b); const thr = Math.max(3, srt[Math.floor(srt.length * 0.8)] * 2);
      const keep = pairs.filter((p, i) => res[i] < thr); if (keep.length === pairs.length || keep.length < 12) break; pairs = keep;
    }
    res = pairs.map(p => Math.hypot(T[0][0] * p.u + T[0][1] * p.v + T[0][2] - p.X, T[1][0] * p.u + T[1][1] * p.v + T[1][2] - p.Y)).sort((a, b) => a - b);
    const med = res[Math.floor(res.length / 2)];
    const mpp = Math.sqrt(Math.abs(T[0][0] * T[1][1] - T[0][1] * T[1][0]));    // m / 캔버스 픽셀
    const ptsPerPx = 1 / scale; const denom = mpp / (ptsPerPx * 0.0254 / 72);   // 축척 분모
    let poly = turf.polygon([ring.map(([u, v]) => toLL([T[0][0] * u + T[0][1] * v + T[0][2], T[1][0] * u + T[1][1] * v + T[1][2]]))]);
    try { poly = turf.buffer(turf.buffer(poly, 1.2, { units: 'meters' }), -1.2, { units: 'meters' }); } catch (e) { }
    R.drawn = poly; R.fit = { n: pairs.length, med, denom };
    compareDrawn();
    msg('rvMsg4', `정합 완료: 기준점 ${pairs.length}개, 중앙오차 ${med.toFixed(2)}m, 도면 축척 약 1/${Math.round(denom / 100) * 100}` +
      `\n도면 구역선 안 면적 ${fmtN(turf.area(poly), 0)}㎡ (명부 필지 합친 면적 ${fmtN(turf.area(R.zone), 0)}㎡)` + (med > 3 ? '\n⚠ 오차가 큽니다. 도면 글자 위치가 필지 중심과 다를 수 있으니 결과를 참고만 하세요.' : ''));
  }

  function affine(P) {
    const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    P.forEach(p => { const r = [p.u, p.v, 1]; for (let i = 0; i < 3; i++) { for (let k = 0; k < 3; k++) S[i][k] += r[i] * r[k]; bx[i] += r[i] * p.X; by[i] += r[i] * p.Y; } });
    const solve = (A, b) => { A = A.map((r, i) => [...r, b[i]]); for (let i = 0; i < 3; i++) { let m = i; for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[m][i])) m = k; [A[i], A[m]] = [A[m], A[i]]; for (let k = 0; k < 3; k++) if (k !== i) { const f = A[k][i] / A[i][i]; for (let c = i; c < 4; c++) A[k][c] -= f * A[i][c]; } } return A.map((r, i) => r[3] / r[i]); };
    return [solve(S, bx), solve(S, by)];
  }

  // 빨간(또는 파란) 점선 구역선 → 닫힌 외곽선 (캔버스 좌표)
  function extractRing(ctx, W, H, color) {
    const d = ctx.getImageData(0, 0, W, H).data;
    const red = new Uint8Array(W * H);
    for (let i = 0, p = 0; p < W * H; p++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      red[p] = color === 'blue' ? (b > 160 && r < 110 && g < 140) : (r > 170 && g < 110 && b < 110);
    }
    const rad = Math.max(6, Math.round(Math.max(W, H) / 170));
    const dil = dilate(red, W, H, rad);
    // 바깥쪽 채우기
    const out = new Uint8Array(W * H); const st = [];
    for (let x = 0; x < W; x++) { st.push(x, (H - 1) * W + x); }
    for (let y = 0; y < H; y++) { st.push(y * W, y * W + W - 1); }
    while (st.length) { const p = st.pop(); if (out[p] || dil[p]) continue; out[p] = 1; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * (H - 1)) st.push(p + W); }
    // 안쪽 영역 중 가장 큰 덩어리
    const lab = new Int32Array(W * H); let best = 0, bestSize = 0, id = 0;
    for (let p0 = 0; p0 < W * H; p0++) {
      if (out[p0] || dil[p0] || lab[p0]) continue;
      id++; let size = 0; st.push(p0);
      while (st.length) { const p = st.pop(); if (lab[p] || out[p] || dil[p]) continue; lab[p] = id; size++; const x = p % W; if (x > 0) st.push(p - 1); if (x < W - 1) st.push(p + 1); if (p >= W) st.push(p - W); if (p < W * (H - 1)) st.push(p + W); }
      if (size > bestSize) { bestSize = size; best = id; }
    }
    if (!best || bestSize < W * H * 0.01) return null;
    const inner = new Uint8Array(W * H); for (let p = 0; p < W * H; p++) inner[p] = lab[p] === best ? 1 : 0;
    const zone = dilate(inner, W, H, rad);
    const ring = trace(zone, W, H);
    return ring ? rdp(ring, 1.5) : null;
  }

  function dilate(src, W, H, r) {   // 정사각형 팽창 (가로·세로 분리)
    const tmp = new Uint8Array(W * H), dst = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) { let c = 0; const o = y * W;
      for (let x = 0; x < Math.min(r, W); x++) c += src[o + x];
      for (let x = 0; x < W; x++) { if (x + r < W) c += src[o + x + r]; if (x - r - 1 >= 0) c -= src[o + x - r - 1]; tmp[o + x] = c > 0 ? 1 : 0; } }
    for (let x = 0; x < W; x++) { let c = 0;
      for (let y = 0; y < Math.min(r, H); y++) c += tmp[y * W + x];
      for (let y = 0; y < H; y++) { if (y + r < H) c += tmp[(y + r) * W + x]; if (y - r - 1 >= 0) c -= tmp[(y - r - 1) * W + x]; dst[y * W + x] = c > 0 ? 1 : 0; } }
    return dst;
  }

  function trace(m, W, H) {        // 무어 이웃 외곽선 추적
    let s = -1; for (let p = 0; p < W * H; p++) if (m[p]) { s = p; break; }
    if (s < 0) return null;
    const dx = [1, 1, 0, -1, -1, -1, 0, 1], dy = [0, 1, 1, 1, 0, -1, -1, -1];
    const at = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x];
    let x = s % W, y = (s / W) | 0, dir = 7; const pts = [[x, y]]; const sx = x, sy = y;
    for (let n = 0; n < 4 * W * H; n++) {
      let found = false;
      for (let k = 0; k < 8; k++) { const d2 = (dir + 6 + k) % 8; const nx = x + dx[d2], ny = y + dy[d2]; if (at(nx, ny)) { x = nx; y = ny; dir = d2; found = true; break; } }
      if (!found) break;
      if (x === sx && y === sy) break;
      pts.push([x, y]);
    }
    pts.push(pts[0]);
    return pts;
  }

  function rdp(pts, eps) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
    while (st.length) { const [a, b] = st.pop(); let md = 0, mi = -1; const [x1, y1] = pts[a], [x2, y2] = pts[b]; const L2 = Math.hypot(x2 - x1, y2 - y1) || 1;
      for (let i = a + 1; i < b; i++) { const d = Math.abs((y2 - y1) * pts[i][0] - (x2 - x1) * pts[i][1] + x2 * y1 - y2 * x1) / L2; if (d > md) { md = d; mi = i; } }
      if (md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    const out = pts.filter((p, i) => keep[i]); if (out[0] !== out[out.length - 1]) out.push(out[0]); return out;
  }

  function compareDrawn() {
    const Z = R.drawn; if (!Z) return;
    R.parcels.forEach(p => {
      p.inDrawn = null; p.outArea = 0; p.outGeom = null;
      if (!p.feat) return;
      let x = null; try { x = turf.intersect(p.feat, Z); } catch (e) { }
      const a = p.cadArea || turf.area(p.feat), ia = x ? turf.area(x) : 0;
      p.inDrawn = ia; p.outArea = a - ia;
      if (p.outArea > 40 || (a > 0 && p.outArea / a > 0.25)) { try { p.outGeom = turf.difference(p.feat, Z); } catch (e) { } }
      // 대장 면적 기준으로 환산한 도면 편입면적
      p.drawnIn = p.ledgerArea ? p.ledgerArea * (a ? ia / a : 0) : ia;
    });
    const own = new Set(R.parcels.map(p => p.pnu));
    const zb = turf.bbox(Z); R.extra = [];
    Object.values(R.cadAll).forEach(f => {
      if (own.has(f.properties.pnu)) return; const b = turf.bbox(f); if (b[2] < zb[0] || b[0] > zb[2] || b[3] < zb[1] || b[1] > zb[3]) return;
      let x = null; try { x = turf.intersect(f, Z); } catch (e) { }
      const ia = x ? turf.area(x) : 0; if (ia > 5) R.extra.push({ jibun: f.properties.jibun, area: turf.area(f), inArea: ia, geom: x });
    });
    runChecks(); drawMap();
  }

  // ---------------------------------------------------------------
  // 5. 자동 검사
  // ---------------------------------------------------------------
  function runChecks() {
    const P = R.parcels; if (!P.length) return;
    const sum = (arr, f) => arr.reduce((a, x) => a + (+f(x) || 0), 0);
    const areaSum = sum(P, p => p.area);
    const ledSum = sum(P, p => p.ledgerArea ?? p.area);
    const partial = P.filter(p => p.ledgerArea && p.area != null && p.area < p.ledgerArea - 0.05);
    const diff = P.filter(p => p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05);
    const jmDiff = P.filter(p => p.ledgerJimok && p.jimok && norm(p.jimok) !== norm(p.ledgerJimok));
    const noArea = P.filter(p => p.area == null);
    const noJiga = P.filter(p => p.feat && !p.jiga);
    const multi = R.owners.filter(o => !o.isPublic && o.nos.length > 1);
    const outs = P.filter(p => p.outArea > 40 || (p.outArea > 0 && p.cadArea && p.outArea / p.cadArea > 0.25));
    const kp = [
      ['명부 필지', P.length.toLocaleString() + '개'], ['명부 편입면적 합', fmtN(areaSum) + '㎡'], ['토지대장 면적 합', fmtN(ledSum) + '㎡'],
      ['소유자(성명+생년)', R.owners.length.toLocaleString() + '명'], ['일부편입(명부)', partial.length + '필지'],
    ];
    if (R.zone) kp.push(['명부 필지 합친 면적', fmtN(turf.area(R.zone), 0) + '㎡']);
    if (R.drawn) kp.push(['도면 구역선 안 면적', fmtN(turf.area(R.drawn), 0) + '㎡']);
    $r('rvKpi').innerHTML = kp.map(([a, b]) => `<div><b>${b}</b><span>${a}</span></div>`).join('');
    const C = [];
    if (diff.length) C.push(`명부 공부면적 ≠ 토지대장: ${diff.length}필지 (분할·합병 전 면적 기재 의심) — ${diff.slice(0, 12).map(p => `${p.jibun}(${fmtN(p.area1)}→${fmtN(p.ledgerArea)})`).join(', ')}${diff.length > 12 ? ' …' : ''}`);
    if (jmDiff.length) C.push(`지목 불일치: ${jmDiff.map(p => `${p.jibun}(${p.jimok}→${p.ledgerJimok})`).join(', ')}`);
    if (noArea.length) C.push(`면적 미기재: ${noArea.map(p => p.jibun).join(', ')}`);
    if (R.map.areaIn == null) C.push('편입면적 열 없음: 경계에 걸친 필지도 전체면적으로 산입됨 → 편입면적 기재 요구');
    if (partial.length) C.push(`명부상 일부편입 ${partial.length}필지: ${partial.map(p => `${p.jibun}(${fmtN(p.area)}/${fmtN(p.ledgerArea)})`).join(', ')}`);
    if (outs.length) C.push(`도면 구역선 밖으로 나간 필지 ${outs.length}개 (명부엔 ${R.map.areaIn == null ? '전체면적' : '해당 면적'}) — ${outs.sort((a, b) => b.outArea - a.outArea).slice(0, 15).map(p => `${p.jibun} 밖 ${fmtN(p.outArea, 0)}㎡`).join(', ')}`);
    if (R.extra && R.extra.length) C.push(`도면 구역선 안인데 명부에 없는 필지 ${R.extra.length}개: ${R.extra.slice(0, 20).map(e => `${e.jibun}(${fmtN(e.inArea, 0)}㎡)`).join(', ')}`);
    if (multi.length) C.push(`같은 사람(성명+생년)에게 소유자 번호가 2개 이상: ${multi.length}명 — ${multi.slice(0, 15).map(o => `${o.name}(${o.nos.join('/')})`).join(', ')}${multi.length > 15 ? ' …' : ''}`);
    if (noJiga.length) C.push(`공시지가 없음 ${noJiga.length}필지 (사업성 종전자산에서 0원 처리)`);
    if (R.fit) C.push(`도면 정합: 기준점 ${R.fit.n}개, 중앙오차 ${R.fit.med.toFixed(2)}m`);
    R.checks = C;
    $r('rvChecks').innerHTML = C.length ? '<ul>' + C.map(c => `<li>${esc(c)}</li>`).join('') + '</ul>' : '특이사항 없음';
    // 표
    const rows = [...P].sort((a, b) => jk(a.jibun) - jk(b.jibun)).map(p => {
      const cls = (p.outArea > 40 || (p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05)) ? 'bad' : (p.ledgerArea && p.area < p.ledgerArea - 0.05) ? 'warn' : '';
      return `<tr class="${cls}"><td>${esc(p.dong || '')} ${esc(p.jibun)}</td><td>${esc(p.jimok || '')}${p.ledgerJimok && norm(p.ledgerJimok) !== norm(p.jimok) ? '→' + esc(p.ledgerJimok) : ''}</td><td class="n">${fmtN(p.area1)}</td><td class="n">${fmtN(p.area)}</td><td class="n">${fmtN(p.ledgerArea)}</td><td class="n">${p.inDrawn != null ? fmtN(p.drawnIn) : ''}</td><td class="n">${p.outArea ? fmtN(p.outArea, 0) : ''}</td><td>${esc(p.zoning || '')}</td><td class="n">${fmtN(p.jiga, 0)}</td><td>${esc(p.ownerType)}</td><td class="n">${p.rows.length}</td></tr>`;
    }).join('');
    $r('rvTableBox').innerHTML = `<table class="rv-t"><thead><tr><th>지번</th><th>지목</th><th>명부 공부면적</th><th>명부 편입면적</th><th>토지대장</th><th>도면 편입(환산)</th><th>도면 밖(㎡)</th><th>용도지역</th><th>공시지가</th><th>소유구분</th><th>명부 행</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const norm = s => String(s || '').replace('도로', '도').replace('잡종지', '잡').replace('대지', '대').trim().slice(0, 1);
  const jk = j => { const n = String(j).match(/\d+/g) || [0]; return (+n[0]) * 100000 + (+(n[1] || 0)); };

  // ---------------------------------------------------------------
  // 6. 산출물
  // ---------------------------------------------------------------
  // ---- 주택접도율 추정 (도정법 시행령 별표 1) ----
  // 폭 4m 이상 도로(지목 '도로' 필지)에 길이 4m 이상 접한 대지인지 필지마다 판정.
  // 도로 폭: 대지 경계에서 바깥(도로 쪽)으로 수직선을 그어 도로 반대편 경계까지 거리.
  //   도로 필지끼리 맞닿은 경계(도로를 가로로 나눈 선)는 지움 → 여러 필지로 나뉜 도로도 한 덩어리로 잼.
  function roadAccess(features, parcels, opt = {}) {
    const MINW = opt.minWidth || 4, MINL = opt.minLength || 4, STEP = 0.5, OFF = 0.3, MAXW = 60;
    const all = features.filter(f => f && f.geometry);
    if (!all.length) return null;
    let lat0 = 0; all.slice(0, 50).forEach(f => { lat0 += turf.centroid(f).geometry.coordinates[1]; }); lat0 /= Math.min(50, all.length);
    const lon0 = turf.centroid(all[0]).geometry.coordinates[0];
    const KX = 111320 * Math.cos(lat0 * Math.PI / 180), KY = 110540;
    const P = c => [(c[0] - lon0) * KX, (c[1] - lat0) * KY];
    const rings = f => { const g = f.geometry; const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return polys.map(pl => pl.map(r => r.map(P))); };
    const isRoad = f => /도$/.test(String(f.properties.jibun || '')) || f.properties.jimok === '도로';
    // 도로 폴리곤과 경계선
    const roads = all.filter(isRoad).map(f => ({ f, polys: rings(f) }));
    const key = (a, b) => { const k = p => Math.round(p[0] * 5) + ',' + Math.round(p[1] * 5); const x = k(a), y = k(b); return x < y ? x + '|' + y : y + '|' + x; };
    const cnt = new Map(), edges = [];
    roads.forEach(r => r.polys.forEach(pl => pl.forEach(ring => { for (let i = 0; i + 1 < ring.length; i++) { const k = key(ring[i], ring[i + 1]); cnt.set(k, (cnt.get(k) || 0) + 1); edges.push([ring[i], ring[i + 1], k]); } })));
    const G = 20, grid = new Map();
    const cellsOf = (a, b) => { const out = []; const x0 = Math.floor(Math.min(a[0], b[0]) / G), x1 = Math.floor(Math.max(a[0], b[0]) / G), y0 = Math.floor(Math.min(a[1], b[1]) / G), y1 = Math.floor(Math.max(a[1], b[1]) / G); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x + ',' + y); return out; };
    edges.forEach(e => { if (cnt.get(e[2]) > 1) return; cellsOf(e[0], e[1]).forEach(c => { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(e); }); });
    // 도로 폴리곤 bbox 색인(점이 도로 안인지)
    const rgrid = new Map();
    roads.forEach(r => r.polys.forEach(pl => { const xs = pl[0].map(p => p[0]), ys = pl[0].map(p => p[1]); const bb = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; const item = { pl, bb }; cellsOf([bb[0], bb[1]], [bb[2], bb[3]]).forEach(c => { if (!rgrid.has(c)) rgrid.set(c, []); rgrid.get(c).push(item); }); }));
    const inRing = (pt, ring) => { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; } return inside; };
    const inRoad = pt => { const c = Math.floor(pt[0] / G) + ',' + Math.floor(pt[1] / G); return (rgrid.get(c) || []).some(it => pt[0] >= it.bb[0] && pt[0] <= it.bb[2] && pt[1] >= it.bb[1] && pt[1] <= it.bb[3] && inRing(pt, it.pl[0]) && !it.pl.slice(1).some(h => inRing(pt, h))); };
    // 반직선과 도로 바깥 경계의 첫 교점까지 거리
    const cast = (o, d) => {
      let best = Infinity; const seen = new Set();
      for (let t = 0; t <= MAXW; t += G / 2) {
        const p = [o[0] + d[0] * t, o[1] + d[1] * t]; const c = Math.floor(p[0] / G) + ',' + Math.floor(p[1] / G);
        if (seen.has(c)) continue; seen.add(c);
        (grid.get(c) || []).forEach(e => {
          const [a, b] = e; const ex = b[0] - a[0], ey = b[1] - a[1]; const den = d[0] * ey - d[1] * ex; if (Math.abs(den) < 1e-9) return;
          const ax = a[0] - o[0], ay = a[1] - o[1]; const tt = (ax * ey - ay * ex) / den, u = (ax * d[1] - ay * d[0]) / den;
          if (tt > 0.05 && u >= 0 && u <= 1 && tt < best) best = tt;
        });
        if (best < t) break;
      }
      return best;
    };
    const res = [];
    parcels.forEach(p => {
      const f = p.feat; if (!f || !f.geometry) return;
      if (isRoad(f) || /^(도|도로|구|하천|공|공원|철|철도|수|제|제방)$/.test(String(p.jimok || ''))) return;
      let best = 0, run = 0, total = 0, maxW = 0;
      rings(f).forEach(pl => { const ring = pl[0];
        // 바깥 방향 판단: 링의 회전 방향
        let area2 = 0; for (let i = 0; i + 1 < ring.length; i++) area2 += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
        const ccw = area2 > 0;
        run = 0;
        for (let i = 0; i + 1 < ring.length; i++) {
          const a = ring[i], b = ring[i + 1]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.01) continue;
          const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L; const n = ccw ? [ty, -tx] : [-ty, tx];   // 바깥쪽 법선
          const k = Math.max(1, Math.round(L / STEP));
          for (let s = 0; s < k; s++) {
            const t = (s + 0.5) / k; const m = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
            const q = [m[0] + n[0] * OFF, m[1] + n[1] * OFF];
            const seg = L / k;
            if (inRoad(q)) {
              let w = Infinity; for (const ang of [-45, -30, -15, 0, 15, 30, 45]) { const ra = ang * Math.PI / 180, c = Math.cos(ra), sn = Math.sin(ra); const x = cast(q, [n[0] * c - n[1] * sn, n[0] * sn + n[1] * c]) * c; if (x < w) w = x; } w += OFF;   // 도로와 비스듬히 만나도 최소폭
              total += seg; if (isFinite(w)) maxW = Math.max(maxW, Math.min(w, MAXW));
              if (isFinite(w) && w >= MINW) { run += seg; best = Math.max(best, run); } else run = 0;
            } else run = 0;
          }
        }
      });
      res.push({ jibun: p.jibun, pnu: p.pnu, jimok: p.ledgerJimok || p.jimok, touchLen: total, longest4: best, maxWidth: maxW, ok: best >= MINL, none: total === 0 });
    });
    return { lots: res, minWidth: MINW, minLength: MINL };
  }

  function roadInfo() {
    const k = R.parcels.length + ':' + Object.keys(R.cadAll || {}).length;
    if (R.road && R.roadKey === k) return R.road;
    R.road = Object.keys(R.cadAll || {}).length ? roadAccess(Object.values(R.cadAll), R.parcels) : null; R.roadKey = k;
    return R.road;
  }
  function toggleRoadLayer() {
    const m = R.leaflet, ra = roadInfo(); if (!m || !ra) return msg('rvMsg6', '② 공부 조회를 먼저 해 주세요.', true);
    if (R.layers.road) { m.removeLayer(R.layers.road); delete R.layers.road; return msg('rvMsg6', '접도 판정 지도를 껐습니다.'); }
    const by = new Map(ra.lots.map(x => [x.jibun, x]));
    const fs = R.parcels.filter(p => by.has(p.jibun) && p.feat).map(p => ({ ...p.feat, properties: { j: p.jibun } }));
    R.layers.road = L.geoJSON({ type: 'FeatureCollection', features: fs }, {
      style: f => { const x = by.get(f.properties.j); return { weight: 0.5, color: '#333', fillOpacity: 0.75, fillColor: x.ok ? '#2e9d4a' : x.none ? '#9a9a9a' : '#d9342b' }; },
      onEachFeature: (f, l) => { const x = by.get(f.properties.j); l.bindTooltip(`${x.jibun} · 도로에 접한 길이 ${x.touchLen.toFixed(1)}m · 4m↑도로 연속 ${x.longest4.toFixed(1)}m · 최대폭 ${x.maxWidth.toFixed(1)}m`); },
    }).addTo(m);
    const ok = ra.lots.filter(x => x.ok).length, none = ra.lots.filter(x => x.none).length;
    msg('rvMsg6', `접도 판정(대지 필지): 접도 ${ok} · 미접도 ${ra.lots.length - ok - none} · 맹지 ${none} → ${(ok / ra.lots.length * 100).toFixed(1)}% (초록 접도, 빨강 미접도, 회색 맹지). 건축물 기준 비율은 건축물대장 조회 후 서식의 [별표1_요건검토]에 나옵니다.`);
  }

  // 별표 1 요건: 사업성 탭의 판정식(Calc)을 구역 자료로 돌림 + 주택접도율 자동 추정값 반영
  // 시군구가 인천이면 인천 조례 기준(노후 연수·선택요건 비율)으로 판정 (사업성 탭에서 직접 고른 경우는 그대로)
  function critFor() {
    const c = JSON.parse(JSON.stringify(S.criteria || {}));
    const sg = ($r('rvSigungu') || {}).value || '';
    if (!c.regionManual && typeof applyRegion === 'function' && typeof REGION_PRESETS !== 'undefined') {
      const reg = Object.keys(REGION_PRESETS).find(k => sg.includes(REGION_PRESETS[k].label.slice(0, 2)));
      if (reg) applyRegion(c, reg);
    }
    return c;
  }

  function zoneReq(parcels, rawB) {
    if (typeof Calc === 'undefined' || !Calc.survey || !Calc.requirements) return { req: [], baseDate: '' };
    const lands = parcels.map(p => ({ id: p.pnu || p.jibun, pnu: p.pnu, jibun: p.jibun, jimok: (p.jimok || '').slice(0, 1) === '잡' ? '잡' : (p.jimok || '').replace('도로', '도').slice(0, 2), area: p.area, owner: '', ownerType: Forms.isPublic(p.ownerType) ? '국공유지' : '사유지', price: p.jiga || 0 }));
    const s2 = { ...S, criteria: critFor(), lands, buildings: rawB };
    let req = [], bd = '';
    try { const sv = Calc.survey(s2); req = Calc.requirements(s2, sv).map(q => ({ ...q })); const d = Calc.baseDate(s2); bd = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''; } catch (e) { console.warn(e); }
    const ra = roadInfo(), bj = ra ? new Map(ra.lots.map(x => [x.jibun, x.ok])) : null;
    const hb = bj ? rawB.filter(b => bj.has(b.jibun)) : [];
    const q = req.find(x => /접도율/.test(x.label));
    if (q && hb.length) {
      const pct = hb.filter(b => bj.get(b.jibun)).length / hb.length * 100, lim = parseFloat(String(q.need)) || 40;
      q.value = `${pct.toFixed(1)}% (자동 추정, 건축물 ${hb.length}동)`; q.pass = pct <= lim;
    }
    return { req, baseDate: bd };
  }

  // 사업성 탭 건축물대장 조회 결과(S.buildings) 중 구역 필지의 것만 건축물조서로
  function zoneBuildings(parcels) {
    const set = new Set(parcels.map(p => p.pnu || p.jibun));
    const raw = (S.buildings || []).filter(b => set.has(b.pnu) || set.has(b.jibun));
    const ra = roadInfo(), bj = ra ? new Map(ra.lots.map(x => [x.jibun, x.ok])) : new Map();
    const s2 = { ...S, criteria: critFor(), buildings: raw }, C = typeof Calc !== 'undefined' ? Calc : null;
    const ann = b => { if (!C) return {}; try { return { age: C.age(s2, b), limit: C.limitYears(s2, b), old: C.isOld(s2, b) }; } catch (e) { return {}; } };
    return raw.map(b => ({ ...ann(b), aprDate: b.aprDate || '', road: bj.has(b.jibun) ? bj.get(b.jibun) : null,
      jibun: b.jibun, dong: b.dong || (parcels.find(p => p.jibun === b.jibun) || {}).dong || '', use: b.use, structure: b.structure,
      year: b.year || (b.aprDate || '').slice(0, 4), floorArea: b.floorArea, units: b.units, households: b.households || b.units || b.hoCount || b.families || '',
      archArea: b.archArea || '', floors: b.floors || '', dongs: b.dongs || 1, note: b.ledger ? '' : '대장 없음(현황조사 필요)' }));
  }

  // 전유부(집합건물 호별) → 집합건축물조서
  function zoneUnits(parcels) {
    const set = new Set(parcels.map(p => p.pnu || p.jibun));
    const dongOf = j => (parcels.find(p => p.jibun === j) || {}).dong || '';
    return (S.exposUnits || []).filter(u => set.has(u.pnu) || set.has(u.jibun)).map(u => ({
      dong: dongOf(u.jibun), jibun: u.jibun, bldgName: u.bldNm || '', use: u.purpose || '', dongNo: u.dong || '',
      ho: [u.floor ? u.floor + '층' : '', u.ho || ''].filter(Boolean).join(' '), excl: u.area ?? '' }));
  }

  // ---- 공공데이터(건축HUB) 호출: 내 키로 바꿔 쓰기 + 받은 결과를 이 PC에 30일 저장 ----
  const KEY_LS = 'jbs_myDataKey', TTL = 30 * 864e5;
  const Cache = (() => {
    let dbp = null;
    const db = () => dbp || (dbp = new Promise((ok, no) => { try { const r = indexedDB.open('jbs_cache', 1); r.onupgradeneeded = () => r.result.createObjectStore('api'); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); } catch (e) { no(e); } }));
    const tx = async (mode, fn) => { const d = await db(); return new Promise((ok, no) => { const t = d.transaction('api', mode), st = t.objectStore('api'); const r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => no(t.error); }); };
    return {
      get: k => tx('readonly', st => st.get(k)).catch(() => null),
      put: (k, v) => tx('readwrite', st => st.put(v, k)).catch(() => null),
      clear: () => tx('readwrite', st => st.clear()).catch(() => null),
      count: () => tx('readonly', st => st.count()).catch(() => 0),
    };
  })();
  async function cacheInfo() { const n = await Cache.count(); const el = document.getElementById('rvCacheInfo'); if (el) el.textContent = n ? `이 PC에 저장된 대장 응답 ${n}건(30일간 다시 조회 안 함)` : ''; }
  function myKey() { try { return (localStorage.getItem(KEY_LS) || '').trim(); } catch (e) { return ''; } }
  function hookDataGoKr() {
    if (window.__jbsFetchHooked) return; window.__jbsFetchHooked = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!/^https?:\/\/apis\.data\.go\.kr\//.test(url)) return orig(input, init);
      const u = new URL(url); let mk = myKey(); if (mk) { if (/%[0-9A-Fa-f]{2}/.test(mk)) { try { mk = decodeURIComponent(mk); } catch (e) { } } u.searchParams.set('serviceKey', mk); }
      const ck = (() => { const c = new URL(u); c.searchParams.delete('serviceKey'); return c.toString(); })();
      const hit = await Cache.get(ck);
      if (hit && Date.now() - hit.t < TTL) return new Response(hit.body, { status: 200, headers: { 'Content-Type': 'application/json' } });
      const res = await orig(u.toString(), init);
      try {
        const body = await res.clone().text(); const j = JSON.parse(body); const h = j && j.response && j.response.header;
        if (h && h.resultCode === '00') Cache.put(ck, { t: Date.now(), body });
      } catch (e) { }
      return res;
    };
    // 공용 키가 없어도 내 키가 있으면 조회 가능하게
    try { const d = Object.getOwnPropertyDescriptor(Ledger, 'enabled'); if (d && d.get && d.configurable) Object.defineProperty(Ledger, 'enabled', { configurable: true, get() { return !!myKey() || d.get.call(Ledger); } }); } catch (e) { }
  }

  // 건축물대장 조회: 구역 필지를 사업성 탭에 넘긴 뒤 기존 Ledger.fill(건축HUB) 실행
  async function ledger() {
    if (typeof Ledger !== 'undefined') hookDataGoKr();
    if (typeof Ledger === 'undefined' || !Ledger.enabled) return msg('rvMsg6', '건축물대장 인증키가 없어 조회할 수 없습니다.', true);
    const z = zoneData(); if (!z) return;
    if (!z.parcels.some(p => p.pnu)) return msg('rvMsg6', '② 공부 조회를 먼저 해 주세요(필지 고유번호가 필요).', true);
    const want = new Set(z.parcels.map(p => p.pnu));
    if (!(S.lands || []).some(l => want.has(l.pnu))) toApp();
    msg('rvMsg6', `건축물대장 조회 중… 필지 ${z.parcels.length}개 (필지 수에 따라 몇 분 걸림)`);
    const box = document.getElementById('ledgerMsg');
    const tick = setInterval(() => { if (box && box.textContent) msg('rvMsg6', '건축물대장: ' + box.textContent); }, 1000);
    try {
      await Ledger.fill();
      for (let i = 0; i < 2 && box && /조회 실패/.test(box.textContent); i++) { await sleep(5000); await Ledger.fill(); }   // 실패 필지만 자동 재조회
    } finally { clearInterval(tick); }
    cacheInfo();
    const bs = zoneBuildings(z.parcels);
    msg('rvMsg6', `건축물대장 조회 끝: 건축물 ${bs.length}동 (${new Set(bs.map(b => b.jibun)).size}필지). 이제 [법정서식 내려받기]를 누르면 건축물조서가 채워집니다.`);
  }

  function zoneData(useDrawn) {
    if (!R.parcels.length) { msg('rvMsg6', '먼저 명부를 올리거나 구역을 불러와 주세요.', true); return null; }
    const name = $r('rvName').value || R.name || '정비구역';
    const parcels = R.parcels.map(p => ({
      jibun: p.jibun, pnu: p.pnu, dong: p.dong, jimok: p.ledgerJimok || p.jimok, ledgerArea: p.ledgerArea ?? p.area1,
      area: useDrawn && p.drawnIn != null ? Math.round(p.drawnIn * 10) / 10 : (p.area ?? 0), zoning: p.zoning || '', jiga: p.jiga || 0,
      ownerType: p.ownerType, owners: p.rows.map(r => ({ name: r.name })),
      note: [p.ledgerArea && p.area1 != null && Math.abs(p.area1 - p.ledgerArea) > 0.05 ? `명부 공부면적 ${p.area1}` : '', p.outArea > 40 ? `도면 구역선 밖 ${Math.round(p.outArea)}㎡` : ''].filter(Boolean).join(' / '),
    }));
    const by = parcels.find(p => p.ledgerArea)?.baseYear;
    return { name, location: `${$r('rvSigungu').value} ${parcels[0]?.dong || ''} 일원`, baseYear: R.parcels.find(p => p.baseYear)?.baseYear || by || '',
      parcels, buildings: zoneBuildings(parcels), units: zoneUnits(parcels), road: roadInfo(), ledgerDone: [...(S.lands || []).filter(l => l.ledgerEmpty).map(l => l.jibun), ...(S.buildings || []).filter(b => b.ledger).map(b => b.jibun)], ...zoneReq(parcels, (S.buildings || []).filter(b => parcels.some(p => p.pnu === b.pnu || p.jibun === b.jibun))), owners: R.owners.map(o => ({ no: o.no, name: o.name, birth: o.birth, addr: o.addr, phone: o.phone, isPublic: o.isPublic, parcels: o.parcels })) };
  }

  function feasParams() {
    const units = $r('rvUnits').value.split(',').map(s => s.trim()).filter(Boolean).map(s => {
      const [type, supply, excl, member, general, genPy] = s.split(':'); return { type, supply: +supply, excl: +excl, member: +member || 0, general: +general || 0, genPy: +genPy || 0 };
    });
    return { multiplier: +$r('rvMult').value || 1.4, consent: (+$r('rvConsent').value || 80) / 100, gfaM2: +$r('rvGfa').value || null, far: +$r('rvFar').value || 250,
      constPerPy: +$r('rvConst').value || 7000000, preset: $r('rvPreset').value || undefined, units, retail: { areaM2: +$r('rvRetail').value || 0 } };
  }

  function exportReview() {
    if (!R.parcels.length) return;
    const head = ['지번', '법정동', '명부 지목', '대장 지목', '명부 공부면적', '명부 편입면적', '토지대장 면적', '연속지적 면적', '도면 구역선 안(연속지적)', '도면 편입(대장 환산)', '도면 밖', '용도지역', '공시지가', '소유구분', '명부 행수'];
    const rows = [...R.parcels].sort((a, b) => jk(a.jibun) - jk(b.jibun)).map(p => [p.jibun, p.dong, p.jimok, p.ledgerJimok || '', p.area1, p.area, p.ledgerArea ?? '', p.cadArea ? Math.round(p.cadArea * 10) / 10 : '', p.inDrawn != null ? Math.round(p.inDrawn * 10) / 10 : '', p.drawnIn != null ? Math.round(p.drawnIn * 10) / 10 : '', p.outArea ? Math.round(p.outArea * 10) / 10 : '', p.zoning || '', p.jiga || '', p.ownerType, p.rows.length]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['검토 결과'], ...R.checks.map(c => [c])]), '검사결과');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head, ...rows]), '필지대조');
    if (R.extra && R.extra.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['지번', '필지면적', '구역선 안 면적'], ...R.extra.map(e => [e.jibun, Math.round(e.area * 10) / 10, Math.round(e.inArea * 10) / 10])]), '명부누락의심');
    const multi = R.owners.filter(o => o.nos.length > 1);
    if (multi.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['성명', '생년', '소유자 번호', '필지'], ...multi.map(o => [o.name, o.birth, o.nos.join(', '), o.parcels.map(q => q.jibun + (q.ho ? ' ' + q.ho : '')).join(', ')])]), '복수번호(비공개)');
    XLSX.writeFile(wb, `${$r('rvName').value || '정비구역'}_검토표.xlsx`);
  }

  // 검토 결과를 사업성 탭(S.lands, S.area)으로 보냄
  function toApp() {
    const z = zoneData(); if (!z || !R.zone) { msg('rvMsg6', '공부 조회까지 끝나야 보낼 수 있습니다.', true); return; }
    S.lands = z.parcels.map(p => ({ id: uid(), pnu: p.pnu || '', jibun: p.jibun, jimok: (p.jimok || '').slice(0, 1) === '잡' ? '잡' : (p.jimok || '').replace('도로', '도').slice(0, 2), area: p.area, owner: (p.owners[0] || {}).name || '', ownerType: Forms.isPublic(p.ownerType) ? '국공유지' : '사유지', price: p.jiga || 0 }));
    const c = turf.center(R.zone).geometry.coordinates;
    S.area = { ...S.area, mode: 'drawn', geojson: R.drawn || R.zone, drawnArea: turf.area(R.drawn || R.zone), center: [c[1], c[0]], zoom: 17 };
    S.meta.name = z.name; S.meta.location = z.location; S.meta.locationManual = true;
    S.criteria = critFor();
    const fp = feasParams(); S.plan.far = fp.far; if (fp.gfaM2) S.plan.gfaManual = fp.gfaM2;
    S.plan.infraMode = 'auto';   // 기반시설은 보낸 토지조서의 지목(도로 등)으로
    // 분양 수입표(S.sales)도 채움: 평형별 세대수가 비어 있으면 자동 배분(건축 대지 연면적 × 공급비율)
    const pp = { ...Forms.DEFAULTS, ...fp };
    const gfa = fp.gfaM2 || Forms.netSite(z.parcels, fp.infraM2).net * fp.far / 100 * pp.gfaFactor;
    const AU = Forms.autoUnits(pp, gfa, z);
    S.sales = [];
    AU.units.forEach(u => {
      if (u.member) S.sales.push({ id: uid(), cat: '조합원', name: u.type, units: u.member, area: u.supply, price: Math.round(u.genPy * pp.memberRatio / 1e4) });
      if (u.general) S.sales.push({ id: uid(), cat: '일반', name: u.type, units: u.general, area: u.supply, price: Math.round(u.genPy / 1e4) });
    });
    App.update(true); App.persist && App.persist();
    msg('rvMsg6', `사업성 탭으로 보냄: 토지 ${S.lands.length}필지, 구역 ${fmtN(S.area.drawnArea, 0)}㎡, 분양 ${S.sales.reduce((a, r) => a + r.units, 0)}세대${AU.auto ? '(자동 배분)' : ''}. 3조서·요건 → 7민감도 탭에서 확인하세요(건축물은 3탭 "건축물대장 채우기"로).`);
  }

  // 설정 모드 연결: 2구역계 탭에서 그린 구역으로 필지·편입면적을 만들어 서식에 씀
  async function fromArea() {
    const g = S.area && S.area.geojson;
    if (!g) return msg('rvMsg6', '2구역계 탭에서 구역을 먼저 그려 주세요.', true);
    const poly = g.type === 'Feature' ? g : turf.feature(g);
    const bb = turf.bbox(poly); msg('rvMsg6', '구역 안 필지 조회 중…');
    const DX = 0.004, DY = 0.003;
    for (let x = Math.floor(bb[0] / DX); x <= Math.floor(bb[2] / DX); x++) for (let y = Math.floor(bb[1] / DY); y <= Math.floor(bb[3] / DY); y++) {
      const box = `BOX(${(x * DX).toFixed(4)},${(y * DY).toFixed(4)},${((x + 1) * DX).toFixed(4)},${((y + 1) * DY).toFixed(4)})`;
      try { (await VWorld.dataAll('LP_PA_CBND_BUBUN', box, 10)).forEach(f => { R.cadAll[f.properties.pnu] = f; }); } catch (e) { }
      await sleep(300);
    }
    const list = [];
    Object.values(R.cadAll).forEach(f => {
      const b = turf.bbox(f); if (b[2] < bb[0] || b[0] > bb[2] || b[3] < bb[1] || b[1] > bb[3]) return;
      let x = null; try { x = turf.intersect(f, poly); } catch (e) { }
      if (!x) return; const ia = turf.area(x), a = turf.area(f); if (ia < 1 || ia / a < 0.01) return;
      const jb = String(f.properties.jibun || ''); const jm = (jb.match(/[가-힣]+$/) || [''])[0];
      const own = (S.lands || []).find(l => l.jibun === jb.replace(/[^\d-]/g, ''));
      list.push({ key: f.properties.pnu, pnu: f.properties.pnu, jibun: jb.replace(/[^\d-]/g, ''), dong: (f.properties.addr || '').split(' ').slice(-2, -1)[0] || '', jimok: jm, area1: null,
        feat: f, cadArea: a, area: Math.round(ia * 10) / 10, jiga: +f.properties.jiga || 0, ownerType: own && own.ownerType === '국공유지' ? '구유지' : '사유지', rows: own ? [{ name: own.owner }] : [] });
    });
    R.parcels = list; R.owners = []; R.map = { areaIn: 1 };
    buildZone();
    msg('rvMsg6', `2구역계 탭 구역에서 필지 ${list.length}개를 만들었습니다(편입면적 = 구역 안 연속지적 면적). 토지대장 면적은 ② 조회로 보완할 수 있습니다.`);
  }

  // 탭 등록 (app.js의 Tabs·App 사용)
  //  app.js의 boot(DOMContentLoaded)가 Tabs 목록으로 단계 버튼을 만들 때 아직 없는 탭이 끼면 멈추므로,
  //  boot가 끝난 뒤에 탭 링크·화면·Tabs 등록을 한꺼번에 함
  function register() {
    install();
    if (typeof Tabs !== 'undefined' && !Tabs.review) Tabs.review = { render() { install(); if (R.leaflet) setTimeout(() => R.leaflet.invalidateSize(), 50); }, refresh() { } };
    if (location.hash === '#review' && typeof App !== 'undefined') { try { App.show('review'); } catch (e) { } }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(register, 0)); else register();

  return { R, install, readFile, fetchAll, buildZone, matchPdf, runChecks, zoneData, feasParams, toApp, ledger, roadAccess, roadInfo, toggleRoadLayer, fromArea, extractRing };
})();
