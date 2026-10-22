'use strict';

// =====================================================================
// 한글(HWPX) 서식 채우기
//   자치단체 조례 시행규칙의 별지 서식 원본(.hwpx)을 틀로 열어, 표의 칸에 값을 넣고 행을 늘려 .hwpx로 내려받음
//   HWPX = zip(XML). 본문은 Contents/section0.xml, 표는 hp:tbl > hp:tr > hp:tc > hp:subList > hp:p > hp:run > hp:t
//   괘선·글꼴·칸 너비는 원본 그대로 두고 글자만 바꿈 (줄 배치 캐시 hp:linesegarray는 지워 한글이 다시 계산하게)
// =====================================================================
const Hwpx = (() => {
  const HP = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

  // 자치단체·근거법별 서식 원본. 지역 키는 REGION_PRESETS, 근거법 키는 TYPES[].act
  //   urban: 도시정비법 사업(재개발·재건축) — 시·도 도시 및 주거환경정비 조례 시행규칙 별지
  //   small: 빈집법 사업(가로주택 등) — 아직 등록된 서식 없음
  const FORMS = {
    incheon: { urban: {
      law: '「인천광역시 도시 및 주거환경정비 조례 시행규칙」',
      dir: 'forms/incheon/',
      files: {
        f1_3: '별지 제1호의3서식 정비계획 입안 요청 구역의 범위(구역계)',
        f1_4: '별지 제1호의4서식 정비계획 입안 요청 구역의 건축물 현황',
        f4: '별지 제4호서식 토지 및 건축물 조서',
        f5: '별지 제5호서식 기초 조사·확인 내역서',
        f6: '별지 제6호서식 동의총괄표',
        f7: '별지 제7호서식 재건축진단 요청을 위한 동의서',
        f8: '별지 제8호서식 정비계획(변경)의 입안 제안을 위한 동의서',
        f9: '별지 제9호서식 토지등소유자 명부',
        f11: '별지 제11호서식 조합원 명부',
      },
    } },
  };

  function loadZipLib() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = JSZIP;
      s.onload = () => res(window.JSZip);
      s.onerror = () => rej(new Error('압축 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
      document.head.append(s);
    });
  }

  // 서식 원본 열기 → { zip, doc(section0 XML) }
  async function open(url) {
    const JSZip = await loadZipLib();
    const res = await fetch(url);
    if (!res.ok) throw new Error(`서식 파일을 찾지 못했습니다 (${url})`);
    const zip = await JSZip.loadAsync(await res.arrayBuffer());
    const xml = await zip.file('Contents/section0.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('서식 파일을 읽지 못했습니다.');
    return { zip, doc };
  }

  // (NodeList는 Array.from으로: 브라우저와 시험용 xmldom 모두에서 동작)
  const kids = (el, name) => Array.from(el.childNodes).filter(c => c.nodeType === 1 && c.localName === name);
  const all = (el, name) => Array.from(el.getElementsByTagNameNS(HP, name));
  const textOf = el => all(el, 't').map(t => t.textContent).join('');

  // 표 찾기: 셀 글자를 모두 이은 문자열에 words가 다 들어 있는 표 중 가장 안쪽(작은) 표
  function findTable(doc, words) {
    const hit = all(doc, 'tbl').filter(t => { const s = textOf(t).replace(/\s/g, ''); return words.every(w => s.includes(w.replace(/\s/g, ''))); });
    return hit.sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
  }
  const rows = tbl => kids(tbl, 'tr');
  const cells = tr => kids(tr, 'tc');

  // 셀(또는 문단)의 첫 글자 칸에 text를 넣고 나머지 글자는 지움. 글자 모양은 첫 run 그대로
  function setText(el, text) {
    const ps = el.localName === 'p' ? [el] : all(el, 'p');
    const p = ps[0];
    if (!p) return;
    const runs = kids(p, 'run');
    let run = runs[0];
    if (!run) { run = p.ownerDocument.createElementNS(HP, 'hp:run'); run.setAttribute('charPrIDRef', '0'); p.insertBefore(run, p.firstChild); }
    const ts = all(p, 't');
    let t = ts.find(x => x.parentNode === run) || null;
    ts.forEach(x => { if (x !== t) x.parentNode.removeChild(x); });
    if (!t) { t = p.ownerDocument.createElementNS(HP, 'hp:t'); run.appendChild(t); }
    t.textContent = text == null ? '' : String(text);
    // 셀 안의 두 번째 이후 문단은 비움 (원본 서식의 빈 줄은 그대로 두되 글자만 지움)
    ps.slice(1).forEach(q => all(q, 't').forEach(x => { x.textContent = ''; }));
    ps.forEach(q => kids(q, 'linesegarray').forEach(x => q.removeChild(x)));
  }

  // 한 행의 모든 칸을 그 행 첫 칸(가운데 정렬)의 문단 모양으로 (합계 행 등)
  function alignRow(tr) {
    const p0 = all(cells(tr)[0], 'p')[0];
    if (!p0) return;
    const id = p0.getAttribute('paraPrIDRef');
    cells(tr).forEach(tc => { all(tc, 'p').forEach(p => p.setAttribute('paraPrIDRef', id)); kids(tc, 'subList').forEach(x => x.setAttribute('vertAlign', 'CENTER')); });
  }

  // 칸에 여러 줄: 첫 문단을 틀로 줄마다 문단을 만듦 (기초조사서처럼 한 칸에 구분이 여러 줄인 표)
  function setLines(tc, lines) {
    const ps = all(tc, 'p');
    if (!ps.length) return;
    const p0 = ps[0], parent = p0.parentNode;
    ps.slice(1).forEach(p => p.parentNode.removeChild(p));
    setText(p0, lines[0]);
    let prev = p0;
    lines.slice(1).forEach(t => { const q = p0.cloneNode(true); setText(q, t); parent.insertBefore(q, prev.nextSibling); prev = q; });
  }

  // 셀 주소(행 번호) 바꾸기
  function setRowAddr(tr, r) {
    cells(tr).forEach(tc => kids(tc, 'cellAddr').forEach(a => a.setAttribute('rowAddr', String(r))));
  }

  // 표의 행 채우기: tmplRow(0부터) 행을 틀로 data 행 수만큼 복제해 넣고, 그 아래 원래 예시 행들은 지움
  //   data: [[셀1, 셀2, ...], ...]  (병합 없는 행 기준, 셀 순서대로)
  function fillRows(tbl, tmplRow, data, opt = {}) {
    const trs = rows(tbl);
    const tmpl = trs[tmplRow];
    const keepAfter = opt.keepAfter || 0;   // 표 맨 아래에서 그대로 둘 행 수 (합계 행 등)
    const tail = keepAfter ? trs.slice(trs.length - keepAfter) : [];
    trs.slice(tmplRow, trs.length - keepAfter).forEach(tr => tbl.removeChild(tr));
    const before = tail[0] || null;
    let h = (() => { const sz = kids(cells(tmpl)[0] || tmpl, 'cellSz')[0]; return sz ? +sz.getAttribute('height') : 0; })();
    // 서식의 예시 행은 한 쪽을 채우려고 높게 잡혀 있으므로, 데이터 행은 낮게 (글자가 넘치면 한글이 늘림). 1mm ≈ 283
    if (opt.rowHeight) h = opt.rowHeight;
    // 글자 정렬: 첫 칸(연번, 가운데 정렬)의 문단 모양을 모든 칸에 (원본 예시 행은 배분 정렬이라 "단 독 주택"처럼 벌어짐)
    const para0 = (() => { const p = all(cells(tmpl)[0], 'p')[0]; return p ? p.getAttribute('paraPrIDRef') : null; })();
    data.forEach(vals => {
      const tr = tmpl.cloneNode(true);
      cells(tr).forEach((tc, c) => {
        setText(tc, vals[c]);
        if (para0 != null && opt.align !== false) all(tc, 'p').forEach(p => p.setAttribute('paraPrIDRef', para0));
        kids(tc, 'subList').forEach(s => s.setAttribute('vertAlign', 'CENTER'));
        const s = kids(tc, 'cellSz')[0]; if (s && opt.rowHeight) s.setAttribute('height', String(opt.rowHeight));
      });
      tbl.insertBefore(tr, before);
    });
    rows(tbl).forEach((tr, r) => setRowAddr(tr, r));
    tbl.setAttribute('rowCnt', String(rows(tbl).length));
    // 표 높이(캐시)를 행 수에 맞게
    const sz = kids(tbl, 'sz')[0];
    if (sz && h) {
      const total = rows(tbl).reduce((a, tr) => a + Math.max(...cells(tr).map(tc => { const s = kids(tc, 'cellSz')[0]; const span = kids(tc, 'cellSpan')[0]; return s && (!span || span.getAttribute('rowSpan') === '1') ? +s.getAttribute('height') : 0; })), 0);
      sz.setAttribute('height', String(total));
    }
    return tbl;
  }

  // 표의 한 셀 (행·열은 0부터, 셀 주소 기준)
  function cell(tbl, r, c) {
    for (const tr of rows(tbl)) for (const tc of cells(tr)) {
      const a = kids(tc, 'cellAddr')[0];
      if (a && +a.getAttribute('rowAddr') === r && +a.getAttribute('colAddr') === c) return tc;
    }
    return null;
  }

  // 문단 글자 바꾸기: find(정규식)가 들어 있는 hp:t의 글자를 replace로
  function replaceText(doc, find, replace) {
    let n = 0;
    all(doc, 't').forEach(t => { if (find.test(t.textContent)) { t.textContent = t.textContent.replace(find, replace); n++; } });
    return n;
  }

  // 쪽을 넘어가도록: 표를 '쪽 경계에서 나눔', 제목 행(headerRows개)은 쪽마다 반복
//   headerRows: 앞에서부터 반복할 행 수, 또는 [시작, 끝) 행 범위 (제목 행 아래의 머리 행만 반복할 때)
  //   글자처럼 취급(treatAsChar)인 표는 쪽을 넘지 못하므로 끔
  function allowSplit(tbl, headerRows = 0) {
    const [h0, h1] = Array.isArray(headerRows) ? headerRows : [0, headerRows];
    tbl.setAttribute('pageBreak', 'TABLE');   // 행 단위로 다음 쪽에 (CELL은 행 가운데서 잘림)
    tbl.setAttribute('repeatHeader', h1 > h0 ? '1' : '0');
    rows(tbl).forEach((tr, r) => cells(tr).forEach(tc => tc.setAttribute('header', r >= h0 && r < h1 ? '1' : '0')));
    kids(tbl, 'pos').forEach(p => p.setAttribute('treatAsChar', '0'));
  }

  // 표 나누기: at번째 행부터를 새 표로 떼어 원래 표가 든 문단 바로 다음 문단에 둠 (새 표를 돌려줌)
  //   한글은 표 맨 위 행만 쪽마다 반복하므로, 서식 제목 행과 명부 머리 행이 한 표에 있으면 제목 아래에서 나눔
  function splitTable(tbl, at) {
    const run = tbl.parentNode, p = run.parentNode;
    const np = p.cloneNode(false), nrun = run.cloneNode(false), nt = tbl.cloneNode(true);
    nt.setAttribute('id', String(1000000000 + Math.floor(Math.random() * 900000000)));
    nrun.appendChild(nt); np.appendChild(nrun);
    p.parentNode.insertBefore(np, p.nextSibling);
    rows(tbl).slice(at).forEach(tr => tbl.removeChild(tr));
    rows(nt).slice(0, at).forEach(tr => nt.removeChild(tr));
    [tbl, nt].forEach((t, i) => {
      rows(t).forEach((tr, r) => setRowAddr(tr, r));
      const n = rows(t).length;
      t.setAttribute('rowCnt', String(n));
      kids(t, 'cellzoneList').forEach(zl => kids(zl, 'cellzone').forEach(z => {
        let a = +z.getAttribute('startRowAddr'), b = +z.getAttribute('endRowAddr');
        if (i) { a -= at; b -= at; }
        if (b < 0 || a >= n) { zl.removeChild(z); return; }
        z.setAttribute('startRowAddr', String(Math.max(0, a))); z.setAttribute('endRowAddr', String(Math.min(n - 1, b)));
      }));
    });
    kids(p, 'linesegarray').forEach(x => p.removeChild(x));
    return nt;
  }

  // 표의 한 행 지우기 (행 번호·행 수 맞춤)
  function removeRow(tbl, idx) {
    const tr = rows(tbl)[idx];
    if (!tr) return;
    tbl.removeChild(tr);
    rows(tbl).forEach((t, r) => setRowAddr(t, r));
    tbl.setAttribute('rowCnt', String(rows(tbl).length));
  }

  // 틀 풀기: 서식 한 쪽 전체가 바깥 표(1열, 글자처럼 취급) 안에 들어 있으면, 그 칸 안의 표는 다음 쪽으로 넘어가지 못해 잘림
  //   → 제목 행(안쪽 표가 없는 앞쪽 행)은 바깥 표에 그대로 두고, 그 아래 칸의 문단(표·주석·작성자란)을 본문으로 꺼냄
  //   용지 규격 행(210㎜×297㎜…)은 인쇄 안내라 뺌
  function unframe(doc) {
    const sec = doc.documentElement;
    const topPs = kids(sec, 'p');
    for (const p of topPs) {
      // 틀 = 행 안에 다른 표를 품은 맨 위 표 (서식마다 열 수는 다름)
      const frame = kids(p, 'run').flatMap(r => kids(r, 'tbl')).find(t => rows(t).some(tr => all(tr, 'tbl').length));
      if (!frame) continue;
      const trs = rows(frame);
      const hasTbl = tr => all(tr, 'tbl').length > 0;
      const first = trs.findIndex(hasTbl);
      if (first < 0) continue;
      let after = p.nextSibling;
      trs.slice(first).forEach(tr => {
        if (/㎜\s*×\s*\d+\s*㎜/.test(textOf(tr)) && !hasTbl(tr)) { frame.removeChild(tr); return; }
        cells(tr).forEach(tc => kids(tc, 'subList').forEach(sub => kids(sub, 'p').forEach(q => {
          all(q, 'linesegarray').forEach(x => x.parentNode.removeChild(x));
          kids(q, 'linesegarray').forEach(x => q.removeChild(x));
          sec.insertBefore(q, after);
        })));
        frame.removeChild(tr);
      });
      // 바깥 표: 남은 행 수·높이·셀 영역 맞춤
      const left = rows(frame);
      frame.setAttribute('rowCnt', String(left.length));
      const h = left.reduce((a, tr) => a + Math.max(0, ...cells(tr).map(tc => { const s = kids(tc, 'cellSz')[0]; return s ? +s.getAttribute('height') : 0; })), 0);
      const sz = kids(frame, 'sz')[0]; if (sz) sz.setAttribute('height', String(h));
      kids(frame, 'cellzoneList').forEach(zl => kids(zl, 'cellzone').forEach(z => {
        if (+z.getAttribute('startRowAddr') >= left.length) zl.removeChild(z);
        else if (+z.getAttribute('endRowAddr') >= left.length) z.setAttribute('endRowAddr', String(left.length - 1));
      }));
      kids(p, 'linesegarray').forEach(x => p.removeChild(x));
    }
  }

  async function save({ zip, doc }, fname) {
    let xml = new XMLSerializer().serializeToString(doc);
    if (!/^<\?xml/.test(xml)) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>' + xml;
    zip.file('Contents/section0.xml', xml);
    zip.file('mimetype', 'application/hwp+zip', { compression: 'STORE' });
    zip.remove('Preview/PrvImage.png');   // 빈 서식 미리보기 그림은 뺌 (한글이 저장할 때 다시 만듦)
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/hwp+zip', compression: 'DEFLATE' });
    if (fname) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fname;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    return blob;
  }

  // 본문(맨 위) 문단 중 글자가 re에 맞는 첫 문단
  function para(doc, re) {
    return kids(doc.documentElement, 'p').find(p => re.test(kids(p, 'run').flatMap(r => kids(r, 't')).map(t => t.textContent).join(''))) || null;
  }
  // 본문 문단 from부터 to 바로 앞까지 지움 (to가 null이면 from 하나만)
  function removeParas(from, to) {
    let p = from;
    while (p && p !== to) { const n = p.nextSibling; if (p.nodeType === 1) p.parentNode.removeChild(p); p = to === null ? null : n; }
  }

  return { FORMS, open, para, removeParas, alignRow, removeRow, splitTable, setLines, findTable, rows, cells, cell, setText, fillRows, replaceText, allowSplit, unframe, save, textOf };
})();

// =====================================================================
// 구역지정 서류(한글) — 생성 모드의 zoneDocsData() 자료로 자치단체 서식을 채움
// =====================================================================
const ZoneHwp = (() => {
  const n1 = v => (v === '' || v == null || !isFinite(+v) ? '' : (Math.round(+v * 10) / 10).toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
  const n2 = v => (v === '' || v == null || !isFinite(+v) ? '' : (+v).toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const n0 = v => (v === '' || v == null || !isFinite(+v) ? '' : Math.round(+v).toLocaleString('ko-KR'));
  const loc = x => `${x.dong || ''} ${x.jibun || ''}`.trim();
  const jkey = j => { const m = String(j).match(/\d+/g) || [0]; return (+m[0]) * 100000 + (+(m[1] || 0)); };
  const owners = p => p.ownerName || '';
  const isDet = b => /단독|다가구|다중주택/.test(b.use || '');
  const isApt = b => /아파트|연립|다세대/.test(b.use || '');
  const ROW_H = 1700;   // 데이터 행 최소 높이(약 6mm). 글자가 넘치면 한글이 늘림

  // 별지 제4호 토지 및 건축물 조서. part: 'land' | 'bldg' | 없으면 둘 다
  async function f4(form, z, part) {
    const f = await Hwpx.open(form.dir + 'f4.hwpx');
    const doc = f.doc;
    Hwpx.unframe(doc);
    if (part !== 'bldg') {
      const P = [...z.parcels].sort((a, b) => jkey(a.jibun) - jkey(b.jibun));
      const t = Hwpx.findTable(doc, ['지목', '소유주']);
      Hwpx.fillRows(t, 2, P.map((p, i) => [i + 1, loc(p), p.jimok || '', n1(p.area), p.zoning || '', p.district || '', p.facility || '', owners(p), p.landUse || '']), { rowHeight: ROW_H });
      const sum = Hwpx.rows(t)[1];
      Hwpx.setText(Hwpx.cells(sum)[1], `${P.length}필지`);
      Hwpx.setText(Hwpx.cells(sum)[3], n1(P.reduce((a, p) => a + (+p.area || 0), 0)));
      Hwpx.alignRow(sum);
      Hwpx.allowSplit(t, 1);
      // 단독주택 용지 / 공동주택 용지: 대지 필지를 그 위 건축물로 나눔
      const bj = new Map(); (z.buildings || []).forEach(b => { const a = bj.get(b.jibun) || []; a.push(b); bj.set(b.jibun, a); });
      let det = 0, apt = 0;
      P.forEach(p => { if (!/^대/.test(p.jimok || '')) return; const bs = bj.get(p.jibun) || []; if (bs.some(isApt)) apt += +p.area || 0; else if (bs.length && bs.every(isDet)) det += +p.area || 0; });
      const q = Hwpx.para(doc, /단독주택\s*용지/);
      if (q) Hwpx.setText(q, `※ 단독주택 용지 : ${n1(det)}㎡,  공동주택 용지 : ${n1(apt)}㎡`);
    }
    if (part !== 'land') {
      const B = [...(z.buildings || [])].sort((a, b) => jkey(a.jibun) - jkey(b.jibun));
      const U = z.units || [];
      const t = Hwpx.findTable(doc, ['구 조', '세대수']);
      const rows = [];
      let k = 0;
      const used = new Set();
      B.forEach(b => {
        rows.push([++k, `${loc(b)}${b.bname ? ' ' + b.bname : ''}`, b.use || '', b.structure || '', b.dongs || 1, b.units === '' ? '' : n0(b.units), b.households === '' ? '' : n0(b.households),
          b.year || '', n1(b.archArea), n1(b.floorArea), b.floors || b.basement ? `${b.basement || 0}/${b.floors || 0}` : '', b.note || '']);
        // 집합건축물: 그 건물 바로 아래에 호별 행 (건축물대장 전유부)
        if (isApt(b)) {
          const mine = U.filter(u => !used.has(u) && u.jibun === b.jibun && (!b.bname || !u.bldgName || b.bname.includes(u.bldgName) || u.bldgName.includes(b.bname)));
          mine.sort((a, c) => String(a.dongNo || '').localeCompare(String(c.dongNo || ''), 'ko', { numeric: true }) || (+(String(a.ho).match(/\d+/) || [0])[0]) - (+(String(c.ho).match(/\d+/) || [0])[0]));
          // 호별 행은 한 줄로: 용도는 위 건물과 같아 비우고, 전유면적은 연면적 칸에 (비고 "전유")
          mine.forEach(u => { used.add(u); rows.push(['', `└ ${[u.dongNo, u.ho].filter(Boolean).join(' ')}`, '', '', '', '1', '', '', '', u.excl === '' || u.excl == null ? '' : n2(u.excl), u.floor ? `${u.floor}층` : '', '전유']); });
        }
      });
      // 짝을 못 찾은 호(건물 행이 없는 집합건물)는 끝에
      U.filter(u => !used.has(u)).forEach(u => rows.push(['', `${loc(u)} ${u.bldgName || ''} ${[u.dongNo, u.ho].filter(Boolean).join(' ')}`.trim(), u.use || '', '', '', '1', '', '', '', u.excl == null || u.excl === '' ? '' : n2(u.excl), u.floor ? `${u.floor}층` : '', '전유']));
      Hwpx.fillRows(t, 3, rows, { rowHeight: ROW_H });
      const sumRow = Hwpx.rows(t)[2], sum = Hwpx.cells(sumRow);
      Hwpx.alignRow(sumRow);
      const S = key => B.reduce((a, b) => a + (+b[key] || 0), 0);
      Hwpx.setText(sum[1], `${B.length}동${U.length ? ` (집합 ${U.length}호)` : ''}`);
      Hwpx.setText(sum[4], n0(B.reduce((a, b) => a + (+b.dongs || 1), 0)));
      Hwpx.setText(sum[5], n0(S('units')));
      Hwpx.setText(sum[6], n0(S('households')));
      Hwpx.setText(sum[8], n1(S('archArea')));
      Hwpx.setText(sum[9], n1(S('floorArea')));
      Hwpx.allowSplit(t, 2);
      const detN = B.filter(isDet).reduce((a, b) => a + (+b.units || 1), 0);
      const apt = B.filter(isApt), aptH = apt.reduce((a, b) => a + (+b.households || +b.units || 0), 0);
      const q = Hwpx.para(doc, /단독주택\s*수/);
      if (q) Hwpx.setText(q, `   ※ 단독주택 수 : ${detN}호,    공동주택 수 : ${apt.length}개동, ${aptH}세대`);
    }
    // 한쪽만 받을 때는 다른 쪽 절을 뺌
    const pLand = Hwpx.para(doc, /^\s*1\.\s*토지조서/), pBld = Hwpx.para(doc, /^\s*2\.\s*건축물\s*조서/);
    if (part === 'bldg' && pLand && pBld) Hwpx.removeParas(pLand, pBld);
    if (part === 'land' && pBld) {
      const sign = Hwpx.para(doc, /작성자\s*:/);
      Hwpx.removeParas(pBld, sign);
    }
    return f;
  }

  // 별지 제9호 토지등소유자 명부 — 공부 기준 작성 틀 (소유자 칸은 등기부 등 열람으로 기재)
  //   지번마다 한 행, 집합건물은 그 아래 호마다 한 행(서식 주: 공동주택은 소재지에 호수 기재)
  async function f9(form, z) {
    const f = await Hwpx.open(form.dir + 'f9.hwpx');
    const doc = f.doc;
    const t = Hwpx.findTable(doc, ['토지등소유자', '권 리 내 역']);
    const rowsOf = () => Hwpx.rows(t);
    // 사업 명칭
    const nameRow = rowsOf().findIndex(tr => /정비사업\s*명칭/.test(Hwpx.textOf(tr)));
    if (nameRow >= 0) Hwpx.setText(Hwpx.cells(rowsOf()[nameRow])[0], `(정비사업 명칭 : ${z.name || ''})`);
    // 용지 규격 행은 뺌
    const paper = rowsOf().findIndex(tr => /㎜\s*×/.test(Hwpx.textOf(tr)));
    if (paper >= 0) Hwpx.removeRow(t, paper);
    const tmpl = rowsOf().findIndex(tr => Hwpx.cells(tr).length >= 12 && !Hwpx.textOf(tr).trim());
    const keepAfter = rowsOf().length - tmpl - 1;
    const P = [...z.parcels].sort((a, b) => jkey(a.jibun) - jkey(b.jibun));
    const B = z.buildings || [], U = z.units || [];
    const data = [];
    let k = 0;
    P.forEach(p => {
      const bs = B.filter(b => b.jibun === p.jibun), us = U.filter(u => u.jibun === p.jibun);
      const permit = !bs.length ? '' : bs.every(b => b.source === '건축물대장') ? '유' : bs.some(b => b.source === '건축물대장') ? '유·확인 필요' : '확인 필요';
      const ratio = p.ledgerArea ? (+p.area || 0) / p.ledgerArea : 1;
      const note = [p.ownerType === '국공유지' ? '국공유지' : '', ratio < 0.98 ? `일부 편입(공부 ${n1(p.ledgerArea)}㎡)` : '', us.length ? `집합건물 ${us.length}호(아래)` : ''].filter(Boolean).join(', ');
      // 셀 순서: 연번, 성명, 생년월일, 주소, 전화번호, 소재지, 토지 소유면적, 편입면적, 공유여부, 건축물 동수, 허가유무, 공유여부, 지상권, 세대주 성명, 동의여부, 비고
      data.push([++k, p.ownerName || '', '', '', '', loc(p), '', n1(p.area), '', bs.length || '', permit, '', '', '', '', note]);
      us.sort((a, c) => String(a.dongNo || '').localeCompare(String(c.dongNo || ''), 'ko', { numeric: true }) || (+(String(a.ho).match(/\d+/) || [0])[0]) - (+(String(c.ho).match(/\d+/) || [0])[0]))
        .forEach(u => data.push([++k, '', '', '', '', `${p.jibun} ${[u.dongNo, u.ho].filter(Boolean).join(' ')}`.trim(), '', '', '', 1, '유', '', '', '', '', u.excl == null || u.excl === '' ? '' : `전유 ${n2(u.excl)}㎡`]));
    });
    Hwpx.fillRows(t, tmpl, data, { rowHeight: ROW_H, keepAfter });
    // 제목(서식 번호·이름·명칭)과 명부를 두 표로 나눠, 명부 머리 3행만 쪽마다 반복
    const head0 = rowsOf().findIndex(tr => /연번/.test(Hwpx.textOf(tr)));
    const body = Hwpx.splitTable(t, head0);
    Hwpx.allowSplit(body, tmpl - head0);
    return f;
  }

  // 필지·집합건물 호 목록 (명부·동의자 명부의 '권리의 소재지' 행)
  function rightRows(z) {
    const P = [...z.parcels].sort((a, b) => jkey(a.jibun) - jkey(b.jibun));
    const U = z.units || [];
    const out = [];
    P.forEach(p => {
      out.push({ p, loc: loc(p) });
      U.filter(u => u.jibun === p.jibun)
        .sort((a, c) => String(a.dongNo || '').localeCompare(String(c.dongNo || ''), 'ko', { numeric: true }) || (+(String(a.ho).match(/\d+/) || [0])[0]) - (+(String(c.ho).match(/\d+/) || [0])[0]))
        .forEach(u => out.push({ p, u, loc: `${p.jibun} ${[u.dongNo, u.ho].filter(Boolean).join(' ')}`.trim() }));
    });
    return out;
  }

  // 별지 제6호 동의총괄표 — 동의대상 총면적(사유지·국공유지)과 동의자 명부의 권리 소재지 행
  //   토지등소유자 수·동의자·지상권 설정 여부는 공부로 알 수 없어 빈칸
  async function f6(form, z) {
    const f = await Hwpx.open(form.dir + 'f6.hwpx');
    const doc = f.doc;
    Hwpx.unframe(doc);
    const q = Hwpx.para(doc, /정비사업\s*명칭/);
    if (q) Hwpx.setText(q, `1. 동의총괄내역(정비사업 명칭 : ${z.name || ''})`);
    // 가. 토지면적: 동의대상 총면적 계
    const ta = Hwpx.findTable(doc, ['동의대상 총면적', '지상권비설정토지']);
    if (ta) {
      const P = z.parcels;
      const pub = p => p.ownerType === '국공유지';
      const area = f => P.filter(f).reduce((a, p) => a + (+p.area || 0), 0);
      const byLabel = { '계': () => true, '사유지': p => !pub(p), '국공유지': pub, '기타': () => false };
      Hwpx.rows(ta).forEach(tr => {
        const cs = Hwpx.cells(tr);
        const lab = Hwpx.textOf(cs[0]).replace(/\s/g, '');
        if (cs.length === 8 && byLabel[lab]) Hwpx.setText(cs[2], n1(area(byLabel[lab])));
      });
    }
    // 2. 동의자 명부: 권리의 소재지마다 한 행
    const tn = Hwpx.findTable(doc, ['조합원', '권리의소재지']);
    if (tn) {
      const tmpl = Hwpx.rows(tn).findIndex(tr => Hwpx.cells(tr).length >= 12 && !Hwpx.textOf(tr).trim());
      const data = rightRows(z).map((r, i) => [i + 1, '', r.u ? '' : (r.p.ownerName || ''), '', r.loc, '', '', '', '', '', '', r.u ? '' : (r.p.ownerType === '국공유지' ? '국공유지' : '')]);
      Hwpx.fillRows(tn, tmpl, data, { rowHeight: ROW_H });
      Hwpx.allowSplit(tn, tmpl);
    }
    return f;
  }

  // 별지 제5호 기초 조사·확인 내역서 — 공부(토지대장·건축물대장·연속지적)로 알 수 있는 표만 채움
  //   인구·세대·산업·임대차·주민의견·수목·문화유적 등 현장 조사 항목은 빈칸
  async function f5(form, z) {
    const f = await Hwpx.open(form.dir + 'f5.hwpx');
    const doc = f.doc;
    Hwpx.unframe(doc);
    const P = z.parcels, B = z.buildings || [], U = z.units || [];
    const T = words => Hwpx.findTable(doc, words);
    const put = (t, r, c, v) => { const tc = t && Hwpx.cell(t, r, c); if (tc) Hwpx.setText(tc, v); };
    const pct = (a, tot) => (tot ? (a / tot * 100).toFixed(1) : '');
    const ha = (+z.siteArea || P.reduce((a, p) => a + (+p.area || 0), 0)) / 10000;
    const dens = n => (ha ? (n / ha).toFixed(1) : '');
    const areaOf = ps => ps.reduce((a, p) => a + (+p.area || 0), 0);
    const cnt = (xs, f) => xs.filter(f).length;

    // 지목 이름 (대장 전체 이름 / 연속지적 한 글자 부호)
    const JM = { 대: '대지', 도: '도로', 구: '구거', 답: '답', 임: '임야', 전: '전', 잡: '잡종지', 차: '주차장', 학: '학교용지', 종: '종교용지', 천: '하천', 공: '공원', 제: '제방', 철: '철도용지', 수: '수도용지' };
    const jimokName = j => { j = String(j || '').trim(); return JM[j] || (j === '대' ? '대지' : j) || '기타'; };
    const INFRA = ['도로', '구거', '하천', '공원', '제방', '철도용지', '수도용지'];
    const isRes = b => /주택|아파트|다가구|다세대|연립/.test(b.use || '');
    const isDet = b => /단독|다가구|다중주택/.test(b.use || '');
    const isApt = b => /아파트|연립|다세대/.test(b.use || '');
    const bj = new Map(); B.forEach(b => { const a = bj.get(b.jibun) || []; a.push(b); bj.set(b.jibun, a); });

    // 1. 주민: 호수밀도(동/ha)만
    put(T(['전체인구', '호수밀도']), 2, 11, dens(B.length));

    // 2. 토지 및 건축물 이용현황
    const t2 = T(['주거용건축물', '나대지']);
    if (t2) {
      const isLot = p => jimokName(p.jimok) === '대지';
      const g = {
        res: p => isLot(p) && (bj.get(p.jibun) || []).some(isRes),
        nonres: p => isLot(p) && (bj.get(p.jibun) || []).length && !(bj.get(p.jibun) || []).some(isRes),
        vacant: p => isLot(p) && !(bj.get(p.jibun) || []).length,
        infra: p => INFRA.includes(jimokName(p.jimok)),
      };
      const other = p => !Object.values(g).some(f => f(p));
      [[3, () => true], [4, g.res], [5, g.nonres], [6, g.vacant], [7, g.infra], [8, other]].forEach(([c, f]) => {
        const ps = P.filter(f);
        put(t2, 2, c, String(ps.length)); put(t2, 3, c, n1(areaOf(ps)));
      });
      put(t2, 2, 9, '나대지: 건축물 없는 대지');
      // 건축물: 구분별 — 서식의 구분 칸은 한 칸에 여러 줄(문단)이라, 값 칸도 같은 줄 구성으로 넣음
      //   map: 구분 칸 문단마다 몇 번째 구분인지 (null은 앞 줄이 이어지는 줄·빈 줄)
      const struct = b => { const s = b.structure || ''; return /철|콘크리트|강구조/.test(s) ? 0 : /연와|벽돌|석조|조적|블록|블럭/.test(s) ? 1 : /목/.test(s) ? 2 : 3; };
      const use = b => (isRes(b) ? 0 : /업무/.test(b.use || '') ? 1 : /근린/.test(b.use || '') ? 2 : 3);
      const ageC = b => (!isFinite(+b.age) ? -1 : b.age < 20 ? 0 : b.age < 30 ? 1 : b.age < 40 ? 2 : 3);
      const SIZE = [30, 60, 85, 115, 165, 297];
      const size = b => { const a = +b.floorArea || 0; const k = SIZE.findIndex(x => a < x); return k < 0 ? SIZE.length : k; };
      const gb = b => !!b.aprDate && b.aprDate < '1985-06-30';   // 개발제한구역 지정('85.6.30.) 이전 사용승인
      const groups = [
        { r: 6, f: struct, map: [0, null, 1, 2, 3] },
        { r: 7, f: use, map: [0, 1, 2, 3] },
        { r: 8, f: ageC, map: [0, 1, 2, 3, 'gb', null, null] },
        { r: 9, f: size, map: [0, 1, 2, 3, 4, 5, 6] },
      ];
      groups.forEach(gr => {
        const lab = Hwpx.cell(t2, gr.r, 2);
        const nP = lab ? lab.getElementsByTagNameNS('http://www.hancom.co.kr/hwpml/2011/paragraph', 'p').length : gr.map.length;
        const map = gr.map.slice(0, nP);
        const sel = k => (k === 'gb' ? B.filter(gb) : B.filter(b => gr.f(b) === k));
        const col = (c, fn) => { const tc = Hwpx.cell(t2, gr.r, c); if (tc) Hwpx.setLines(tc, map.map(k => (k == null ? '' : fn(sel(k))))); };
        col(4, xs => String(xs.length));
        col(5, xs => String(cnt(xs, b => b.old)));
        col(6, xs => pct(cnt(xs, b => b.old), xs.length));
        col(7, xs => dens(xs.length));
        col(8, xs => n1(xs.reduce((a, b) => a + (+b.archArea || 0), 0)));
        col(9, xs => n1(xs.reduce((a, b) => a + (+b.floorArea || 0), 0)));
      });
    }

    // 5. 토지 가격: 개별공시지가 × 편입면적
    const t4 = T(['총 토지가격']);
    const land = P.reduce((a, p) => a + (+p.area || 0) * (+p.jiga || 0), 0);
    put(t4, 2, 0, land ? `${n0(land)}원` : '');
    put(t4, 2, 4, '공시지가×편입면적');

    // 10-가. 지목별
    const t9 = T(['잡종지', '학교용지']);
    if (t9) {
      const cols = ['대지', '도로', '구거', '답', '임야', '전', '잡종지', '주차장', '학교용지', '종교용지'];
      const totN = P.length, totA = areaOf(P);
      const by = c => (c === '기타' ? P.filter(p => !cols.includes(jimokName(p.jimok))) : c === '총계' ? P : P.filter(p => jimokName(p.jimok) === c));
      ['총계', ...cols, '기타'].forEach((c, i) => {
        const ps = by(c);
        put(t9, 1, i + 1, String(ps.length)); put(t9, 2, i + 1, pct(ps.length, totN));
        put(t9, 3, i + 1, n1(areaOf(ps))); put(t9, 4, i + 1, pct(areaOf(ps), totA));
      });
    }

    // 10-나. 소유별 (관리청은 공부에 없어 국공유지 소계만)
    const t10 = T(['관리청별']);
    if (t10) {
      const gu = (String(z.location || '').match(/인천광역시\s+(\S+구|\S+군)/) || [])[1];
      if (gu) put(t10, 1, 8, `인천광역시${gu}`);
      const pub = P.filter(p => p.ownerType === '국공유지'), pri = P.filter(p => p.ownerType !== '국공유지');
      [[1, P], [2, pub], [10, pri]].forEach(([c, ps]) => {
        put(t10, 2, c, String(ps.length)); put(t10, 3, c, pct(ps.length, P.length));
        put(t10, 4, c, n1(areaOf(ps))); put(t10, 5, c, pct(areaOf(ps), areaOf(P)));
      });
    }

    // 10-다. 필지규모별 (90㎡ 기준)
    const t11 = T(['90㎡ 미만', '대지 외 필지']);
    if (t11) {
      const lot = p => jimokName(p.jimok) === '대지', small = p => (+p.area || 0) < 90;
      const sets = [P, P.filter(lot), P.filter(p => lot(p) && small(p)), P.filter(p => lot(p) && !small(p)), P.filter(p => !lot(p)), P.filter(p => !lot(p) && small(p)), P.filter(p => !lot(p) && !small(p))];
      sets.forEach((ps, i) => {
        put(t11, 2, i + 1, String(ps.length)); put(t11, 3, i + 1, pct(ps.length, P.length));
        put(t11, 4, i + 1, n1(areaOf(ps))); put(t11, 5, i + 1, pct(areaOf(ps), areaOf(P)));
      });
    }

    // 11-가. 허가유무: 건축물대장 있음 = 유허가, 대장 없음 = 무허가(확인 필요)
    const t12 = T(['유 허 가', '무 허 가']);
    if (t12) {
      const yes = cnt(B, b => b.source === '건축물대장'), no = cnt(B, b => b.noLedger), unk = B.length - yes - no;
      [[1, B.length], [2, yes], [3, no]].forEach(([c, v]) => { put(t12, 1, c, String(v)); put(t12, 2, c, pct(v, B.length)); });
      put(t12, 1, 4, [no ? '무허가: 건축물대장 없는 건물(무허가건축물확인원으로 확인)' : '', unk ? `대장 확인 전 ${unk}동` : ''].filter(Boolean).join(', '));
    }

    // 11-나. 경과연수별
    const t13 = T(['20～40년 미만']);
    if (t13) {
      const ok = B.filter(b => isFinite(+b.age));
      [[1, ok], [2, ok.filter(b => b.age < 20)], [3, ok.filter(b => b.age >= 20 && b.age < 40)], [4, ok.filter(b => b.age >= 40)]].forEach(([c, xs]) => { put(t13, 1, c, String(xs.length)); put(t13, 2, c, pct(xs.length, ok.length)); });
      if (ok.length < B.length) put(t13, 1, 5, `사용승인일 없음 ${B.length - ok.length}동`);
    }

    // 11-다. 용도별
    const t14 = T(['복합용', '근린생활시설']);
    if (t14) {
      const det = B.filter(isDet), apt = B.filter(isApt), res = B.filter(isRes), nonres = B.filter(b => !isRes(b));
      const near = nonres.filter(b => /근린/.test(b.use || '')), etc = nonres.filter(b => !/근린/.test(b.use || ''));
      [[1, B], [2, res], [3, det], [4, apt], [5, nonres], [6, near], [7, etc], [8, []]].forEach(([c, xs]) => { put(t14, 2, c, String(xs.length)); put(t14, 3, c, pct(xs.length, B.length)); });
    }

    // 11-라. 구조별
    const t15 = T(['세면벽돌']);
    if (t15) {
      const sc = s => (/목/.test(s) ? 2 : /연와/.test(s) ? 3 : /시멘트|세멘|세면|블록|블럭/.test(s) ? 5 : /조적|벽돌|석조/.test(s) ? 4 : /철|콘크리트|강구조/.test(s) ? 6 : 7);
      put(t15, 1, 1, String(B.length)); put(t15, 2, 1, pct(B.length, B.length));
      [2, 3, 4, 5, 6, 7].forEach(c => { const v = cnt(B, b => sc(b.structure || '') === c); put(t15, 1, c, String(v)); put(t15, 2, c, pct(v, B.length)); });
    }

    // 11-마. 층수별 (지상층): 1·2·3·4층, 5층 이상
    const t16 = T(['층층층']);
    if (t16) {
      const heads = ['1층', '2층', '3층', '4층', '5층 이상'];
      heads.forEach((h, i) => put(t16, 0, i + 2, h));
      const fc = b => Math.min(4, Math.max(0, (+b.floors || 1) - 1));
      put(t16, 1, 1, String(B.length)); put(t16, 2, 1, pct(B.length, B.length));
      heads.forEach((_, i) => { const v = cnt(B, b => fc(b) === i); put(t16, 1, i + 2, String(v)); put(t16, 2, i + 2, pct(v, B.length)); });
    }

    // 11-바. 노후·불량
    const t17 = T(['노후', '일반건축물']);
    if (t17) {
      const old = B.filter(b => b.old);
      [[1, B], [2, old], [3, old.filter(isDet)], [4, old.filter(isApt)], [5, old.filter(b => !isRes(b))], [6, []], [7, B.filter(b => !b.old)]].forEach(([c, xs]) => { put(t17, 2, c, String(xs.length)); put(t17, 3, c, pct(xs.length, B.length)); });
      put(t17, 2, 8, z.baseDate ? `기준일 ${z.baseDate}` : '');
    }

    // 11-사. 기존 주택 호수: 주거용 동수, 세대수(전용면적별). 공동주택은 전유부, 단독·다가구는 연면적으로 1세대
    const t18 = T(['40㎡ 이하', '135㎡ 초과']);
    if (t18) {
      const band = a => (a <= 40 ? 0 : a <= 60 ? 1 : a <= 85 ? 2 : a <= 135 ? 3 : 4);
      const n = [0, 0, 0, 0, 0];
      B.filter(isDet).forEach(b => { n[band(+b.floorArea || 0)]++; });
      U.forEach(u => { if (u.excl !== '' && u.excl != null) n[band(+u.excl)]++; });
      put(t18, 2, 0, String(B.filter(isRes).length));
      n.forEach((v, i) => put(t18, 2, i + 1, String(v)));
    }

    return f;
  }

  const MAKERS = { land: (form, z) => f4(form, z, 'land'), bldg: (form, z) => f4(form, z, 'bldg'), f4: (form, z) => f4(form, z), owners: f9, consent: f6, survey: f5 };
  const has = kind => !!MAKERS[kind];

  // region: S.criteria.region, act: TYPES[사업 유형].act. 그 지역·근거법 서식이 없으면 null
  function formFor(region, act = 'urban') { return (Hwpx.FORMS[region] || {})[act] || null; }

  async function make(z, kind, region, fname) {
    const form = formFor(region, z.act || 'urban');
    if (!form) throw new Error('이 지역·사업 유형의 한글 서식이 아직 등록되지 않았습니다.');
    if (!MAKERS[kind]) throw new Error('이 서식은 아직 한글로 만들 수 없습니다.');
    const f = await MAKERS[kind](form, z);
    return Hwpx.save(f, fname);
  }

  return { make, has, formFor };
})();
