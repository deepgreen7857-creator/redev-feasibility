'use strict';

// 작업 파일을 PDF로 저장: 사람이 읽는 요약·도면 페이지(그림) + 사이트가 다시 읽는 작업 데이터(압축해 PDF 정보에 숨김)
// 불러오기: PDF의 숨긴 데이터를 꺼내 그대로 복원. 예전 JSON 파일도 그대로 열림.
const PdfStore = {
  KEY: 'JBSProjectData',

  async lib() {
    if (window.PDFLib) return PDFLib;
    await new Promise((ok, bad) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';
      s.onload = ok; s.onerror = () => bad(new Error('PDF 라이브러리를 불러오지 못했습니다'));
      document.head.append(s);
    });
    return PDFLib;
  },

  // 문자열 ↔ gzip+base64
  async pack(text) {
    const bytes = new TextEncoder().encode(text);
    let out = bytes, z = 0;
    if (window.CompressionStream) {
      out = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
      z = 1;
    }
    let bin = '';
    for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    return (z ? 'gz:' : 'raw:') + btoa(bin);
  },

  async unpack(s) {
    const z = s.startsWith('gz:');
    const bin = atob(s.slice(z ? 3 : 4));
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    if (!z) return new TextDecoder().decode(bytes);
    return new TextDecoder().decode(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  },

  // SVG → PNG 바이트 (글꼴은 기기에 있는 한글 글꼴 사용)
  async svgToPng(svg, w, h) {
    const img = new Image();
    await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error('그림 변환 실패')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  },

  // 1쪽: 사업 요약 (A4 세로, mm 단위 SVG)
  summarySVG() {
    const W = 210, H = 297, x = 18;
    const font = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";
    const out = [];
    let y = 26;
    const t = (s, size = 3.6, weight = 400, color = '#111', xx = x) => out.push(`<text x="${xx}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}">${esc(s)}</text>`);
    const gap = d => { y += d; };
    const sv = Calc.survey(S), r = Calc.result(S), site = Calc.siteArea(S);
    t('정비사업 사업성 검토', 3.4, 400, '#c2410c'); gap(9);
    t(S.meta.name || '정비사업', 7, 700); gap(7);
    t(`${TYPES[S.meta.type].label} · 저장일 ${new Date().toLocaleDateString('sv-SE')}`, 3.4, 400, '#555'); gap(8);
    out.push(`<line x1="${x}" x2="${W - x}" y1="${y}" y2="${y}" stroke="#c2410c" stroke-width="0.6"/>`); gap(9);

    const row = (k, v) => { t(k, 3.4, 400, '#666'); t(v, 3.4, 500, '#111', x + 42); gap(6.4); };
    const sect = s => { gap(2); t(s, 4.2, 700); gap(7); };
    sect('사업 개요');
    row('위치', S.meta.location || '–');
    row('용도지역', [S.meta.zoning, ...(S.meta.zoningList || []).filter(z => z !== S.meta.zoning)].filter(Boolean).join(', ') || '–');
    row('구역 면적', site ? `${fmt(site)}㎡ (${fmt(site / PY)}평)` : '–');
    row('계획 용적률', `${fmt(num(S.plan.far))}%`);
    sect('조서·노후도');
    row('토지', `${fmt(sv.landCount)}필지 · ${fmt(sv.landArea)}㎡ (국공유지 ${fmt(sv.publicArea)}㎡)`);
    row('건축물', `${fmt(sv.count)}동`);
    row('노후·불량건축물', `${fmt(sv.old)}동 · 노후도 ${fmtPct(sv.oldRatio)} (기준일 ${sv.base.toLocaleDateString('sv-SE')})`);
    if (sv.unknown) row('판정 불가', `${fmt(sv.unknown)}동 (사용승인일 정보 없음)`);
    sect('요건 검토');
    Calc.requirements(S, sv).forEach(q => {
      const mk = q.pass === true ? '충족' : q.pass === false ? '미충족' : '확인 필요';
      const col = q.pass === true ? '#15803d' : q.pass === false ? '#b91c1c' : '#a16207';
      t(`[${mk}]`, 3.2, 700, col); t(`${q.label} – 현황 ${q.value}`, 3.2, 400, '#111', x + 18); gap(5.6);
    });
    sect('사업성');
    row('종후자산(분양수입)', fmtEok(r.rev.total));
    row('총사업비', fmtEok(r.cost.total));
    row('종전자산', fmtEok(r.prior));
    row('비례율', fmtPct(r.ratio, 2));
    if (S.members.length) row('조합원(입력)', `${fmt(S.members.length)}명`);

    y = H - 22;
    t('이 PDF는 www.jbslab.co.kr 의 "파일 열기"로 다시 불러와 이어서 작업할 수 있습니다.', 3, 400, '#555'); gap(5);
    t('결과는 입력한 가정에 따른 추정치이며, 판정 기준은 관할 법령·조례로 확인하세요.', 3, 400, '#888');
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${font}"><rect width="${W}" height="${H}" fill="#fff"/>${out.join('')}</svg>`, W, H };
  },

  async save() {
    const say = m => { const e = $('#saveMsg'); if (e) e.textContent = m; };
    try {
      say('PDF를 만드는 중…');
      const { PDFDocument, PDFName, PDFString } = await this.lib();
      const doc = await PDFDocument.create();
      doc.setTitle(S.meta.name || '정비사업 사업성 검토');
      doc.setProducer('정비사업 사업성 검토 (www.jbslab.co.kr)');
      const mm = v => v * 72 / 25.4;

      // 1쪽 요약
      const sum = this.summarySVG();
      const png1 = await doc.embedPng(await this.svgToPng(sum.svg, 1654, 2339));   // A4 200dpi
      const p1 = doc.addPage([mm(sum.W), mm(sum.H)]);
      p1.drawImage(png1, { x: 0, y: 0, width: mm(sum.W), height: mm(sum.H) });

      // 2쪽 구역계 도면 (구역이 있고 브이월드를 쓸 수 있을 때)
      if (S.area.geojson && VWorld.enabled) {
        say('구역계 도면을 그리는 중…');
        try {
          const d = await Export.collect();
          const { svg } = Export.sheetSVG(d, 'A4');
          const png2 = await doc.embedPng(await this.svgToPng(svg.replace("font-family=\"'Noto Sans KR','Malgun Gothic',sans-serif\"", "font-family=\"'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif\""), 3508, 2480));
          const p2 = doc.addPage([mm(297), mm(210)]);
          p2.drawImage(png2, { x: 0, y: 0, width: mm(297), height: mm(210) });
        } catch (e) { console.warn('도면 페이지 생략', e); }
      }

      // 작업 데이터 숨기기
      say('작업 데이터를 넣는 중…');
      const data = await this.pack(JSON.stringify(S));
      doc.getInfoDict().set(PDFName.of(this.KEY), PDFString.of(data));

      const bytes = await doc.save();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      a.download = `${S.meta.name || '사업성검토'}_${new Date().toLocaleDateString('sv-SE')}.pdf`;
      document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      say(`PDF로 저장했습니다 (${fmt(bytes.length / 1024)}KB). 다운로드 폴더에서 확인하세요.`);
      return true;
    } catch (e) {
      say('PDF 저장에 실패했습니다: ' + e.message);
      alert('PDF 저장에 실패했습니다: ' + e.message);
      return false;
    }
  },

  // PDF 또는 JSON 파일을 열어 작업 상태로
  async open() {
    const file = await new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = '.pdf,application/pdf,.json,application/json';
      i.onchange = () => res(i.files[0] || null);
      i.click();
    });
    if (!file) return;
    try {
      let text;
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const { PDFDocument, PDFName } = await this.lib();
        const doc = await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
        const v = doc.getInfoDict().lookup(PDFName.of(this.KEY));
        if (!v) { alert('이 PDF에는 작업 데이터가 없습니다. 이 사이트의 "파일 저장"으로 만든 PDF만 불러올 수 있습니다.'); return; }
        text = await this.unpack(v.decodeText ? v.decodeText() : v.asString());
      } else {
        text = await file.text();
      }
      App.replaceState(JSON.parse(text));
      if (MapView.map) MapView.load();
      App.go('overview');
      alert(`"${S.meta.name || file.name}" 작업을 불러왔습니다.`);
      MapView.checkFit('저장된 구역계');
    } catch (e) {
      alert('파일을 열지 못했습니다: ' + e.message);
    }
  },
};
