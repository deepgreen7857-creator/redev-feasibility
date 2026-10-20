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

  // 자치단체별 서식 원본. 지역 키는 REGION_PRESETS와 같음
  const FORMS = {
    incheon: {
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
    },
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
  function allowSplit(tbl, headerRows = 0) {
    tbl.setAttribute('pageBreak', 'TABLE');   // 행 단위로 다음 쪽에 (CELL은 행 가운데서 잘림)
    tbl.setAttribute('repeatHeader', headerRows ? '1' : '0');
    rows(tbl).forEach((tr, r) => cells(tr).forEach(tc => tc.setAttribute('header', r < headerRows ? '1' : '0')));
  }

  // 틀 풀기: 서식 한 쪽 전체가 바깥 표(1열, 글자처럼 취급) 안에 들어 있으면, 그 칸 안의 표는 다음 쪽으로 넘어가지 못해 잘림
  //   → 제목 행(안쪽 표가 없는 앞쪽 행)은 바깥 표에 그대로 두고, 그 아래 칸의 문단(표·주석·작성자란)을 본문으로 꺼냄
  //   용지 규격 행(210㎜×297㎜…)은 인쇄 안내라 뺌
  function unframe(doc) {
    const sec = doc.documentElement;
    const topPs = kids(sec, 'p');
    for (const p of topPs) {
      const frame = kids(p, 'run').flatMap(r => kids(r, 'tbl')).find(t => t.getAttribute('colCnt') === '1');
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

  return { FORMS, open, para, removeParas, alignRow, findTable, rows, cells, cell, setText, fillRows, replaceText, allowSplit, unframe, save, textOf };
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

  const MAKERS = { land: (form, z) => f4(form, z, 'land'), bldg: (form, z) => f4(form, z, 'bldg'), f4: (form, z) => f4(form, z) };
  const has = kind => !!MAKERS[kind];

  // region: S.criteria.region. 그 지역 서식이 없으면 null
  function formFor(region) { return Hwpx.FORMS[region] || null; }

  async function make(z, kind, region, fname) {
    const form = formFor(region);
    if (!form) throw new Error('이 지역 조례의 한글 서식이 아직 등록되지 않았습니다.');
    if (!MAKERS[kind]) throw new Error('이 서식은 아직 한글로 만들 수 없습니다.');
    const f = await MAKERS[kind](form, z);
    return Hwpx.save(f, fname);
  }

  return { make, has, formFor };
})();
