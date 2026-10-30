// PDF에서 글자 뽑기(글자가 들어 있는 PDF만 — 스캔 이미지 PDF는 빈 글자)
//  · 명세서·현황조사서·감정평가서(앞쪽 요항표)를 글자로 만들어 dataCases.summary 에 같이 올린다
//  · 회사 망처럼 저장소(PDF)가 막힌 곳에서도 /data 와 Claude 가 바로 읽게 하려는 것
import fs from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function pdfText(file, maxPages = 30) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const out = [];
  try {
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      let line = ''; let lastY = null; let endX = null;
      for (const it of tc.items) {
        if (!('str' in it)) continue;
        const x = it.transform[4]; const y = Math.round(it.transform[5]);
        if (lastY !== null && Math.abs(y - lastY) > 3) { if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim()); line = ''; endX = null; }
        const gap = endX === null ? 0 : x - endX; const h = Math.abs(it.transform[0]) || 10;
        if (line && gap > h * 0.25 && !line.endsWith(' ')) line += ' '; // 글자 사이가 벌어졌을 때만 띄움
        line += it.str; lastY = y; endX = x + (it.width || 0);
      }
      if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim());
      out.push(`── ${p}쪽 끝 ──`);
      page.cleanup();
    }
  } finally { await doc.destroy(); }
  return out.join('\n');
}

// 사건 폴더의 PDF 목록(상대경로)에서 종류별로 글자를 뽑아 summary 에 넣을 조각을 만든다(총 길이 제한)
export async function caseTexts(dir, rels, log = () => {}) {
  const pick = (re) => rels.filter((r) => /\.pdf$/i.test(r) && re.test(r));
  const parts = [['specText', /명세서/, 30, 12000], ['surveyText', /현황조사/, 10, 6000], ['appraisalText', /감정평가/, 8, 9000]];
  const res = {};
  for (const [key, re, pages, cap] of parts) {
    const files = pick(re);
    if (!files.length) continue;
    let txt = '';
    for (const r of files) {
      try { txt += (files.length > 1 ? `[${r}]\n` : '') + await pdfText(`${dir}/${r}`, pages) + '\n'; }
      catch (e) { log(`글자 뽑기 실패 ${r}: ${e.message}`); }
      if (txt.length > cap) break;
    }
    txt = txt.trim();
    if (txt.replace(/── \d+쪽 끝 ──|\s/g, '').length < 20) { res[key + 'Empty'] = true; continue; } // 스캔 PDF
    res[key] = txt.length > cap ? txt.slice(0, cap) + '\n…(뒤 생략, 원본 PDF 참고)' : txt;
  }
  return res;
}
