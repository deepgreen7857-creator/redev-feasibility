// 첨부 문서(PDF·HWP·HWPX)에서 글자만 뽑는다 — 파산 공고 첨부(대법원)용. 스캔본(그림)은 글자가 없으니 빈 값.
const path = require('path');
const zlib = require('zlib');

async function pdfText(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: path.join(base, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(base, 'standard_fonts') + path.sep,
    useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
  const pages = [];
  for (let p = 1; p <= Math.min(doc.numPages, 40); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = it.transform[5]; const x = it.transform[4];
      let row = rows.find((r) => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, cells: [] }; rows.push(row); }
      row.cells.push({ x, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    pages.push(rows.map((r) => r.cells.sort((a, b) => a.x - b.x).map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim()).join('\n'));
  }
  return { text: pages.join('\n\n'), pages: doc.numPages };
}

// HWP 5.0: OLE 묶음 파일 안 BodyText/SectionN 스트림(대개 압축)을 풀어 문단 글자 레코드(HWPTAG_PARA_TEXT=67)만 읽는다
const INLINE8 = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]); // 8글자 칸을 차지하는 조종 문자
function paraText(b) {
  let s = '';
  for (let i = 0; i + 1 < b.length;) {
    const c = b.readUInt16LE(i);
    if (c < 32) {
      if (c === 13 || c === 10) s += '\n';
      else if (c === 9) s += '\t';
      i += INLINE8.has(c) ? 16 : 2;
      continue;
    }
    s += String.fromCharCode(c); i += 2;
  }
  return s;
}
function hwpRecords(buf) {
  const out = [];
  for (let i = 0; i + 4 <= buf.length;) {
    const h = buf.readUInt32LE(i); i += 4;
    const tag = h & 0x3ff; let size = (h >>> 20) & 0xfff;
    if (size === 0xfff) { size = buf.readUInt32LE(i); i += 4; }
    if (tag === 67) out.push(paraText(buf.subarray(i, i + size)));
    i += size;
  }
  return out.join('');
}
function hwpText(buf) {
  const CFB = require('cfb');
  const cfb = CFB.read(buf, { type: 'buffer' });
  const get = (p) => { const e = CFB.find(cfb, p); return e && e.content ? Buffer.from(e.content) : null; };
  const head = get('FileHeader');
  const flags = head ? head.readUInt32LE(36) : 1;
  const compressed = Boolean(flags & 1);
  if (flags & 2) return { text: '', note: '암호가 걸린 HWP' };
  const sections = cfb.FullPaths.filter((p) => /\/BodyText\/Section\d+$/i.test(p)).sort((a, b) => Number(a.match(/(\d+)$/)[1]) - Number(b.match(/(\d+)$/)[1]));
  let text = '';
  for (const p of sections) {
    const raw = get(p.replace(/^Root Entry\//, ''));
    if (!raw) continue;
    let body = raw;
    if (compressed) { try { body = zlib.inflateRawSync(raw); } catch { try { body = zlib.inflateSync(raw); } catch { continue; } } }
    text += hwpRecords(body) + '\n';
  }
  // 배포용 문서(본문 암호화)는 BodyText가 비어 있다 → 미리보기 글자(PrvText, 앞부분만)라도
  if (!text.trim()) {
    const prv = get('PrvText');
    if (prv) return { text: prv.toString('utf16le').replace(/<|>/g, ' '), note: '미리보기 글자만(앞부분)' };
  }
  return { text };
}

// HWPX: zip 안 Contents/section*.xml 의 글자(<hp:t>)
async function hwpxText(buf) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter((n) => /Contents\/section\d+\.xml$/i.test(n)).sort();
  let text = '';
  for (const n of names) {
    const xml = await zip.files[n].async('string');
    text += xml.replace(/<hp:lineBreak\/>/g, '\n').replace(/<\/hp:p>/g, '\n').replace(/<hp:tab[^>]*\/>/g, '\t').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"') + '\n';
  }
  return { text };
}

function kindOf(name, buf) {
  const head = buf.subarray(0, 8).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return 'hwp';
  if (head.startsWith('PK')) return /\.hwpx$/i.test(name) ? 'hwpx' : 'zip';
  return (String(name).split('.').pop() || '').toLowerCase();
}

async function extract(name, buf) {
  const kind = kindOf(name, buf);
  try {
    let r;
    if (kind === 'pdf') r = await pdfText(buf);
    else if (kind === 'hwp') r = hwpText(buf);
    else if (kind === 'hwpx') r = await hwpxText(buf);
    else return { kind, text: '', status: 'unsupported' };
    const text = String(r.text || '').replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { kind, text, pages: r.pages || null, status: text.length >= 30 ? 'ok' : 'noText', note: r.note || (text.length < 30 && kind === 'pdf' ? '글자 없는 스캔본으로 보임' : undefined) };
  } catch (e) {
    return { kind, text: '', status: 'error', note: String(e.message || e).slice(0, 200) };
  }
}

module.exports = { extract, hwpRecords, paraText, kindOf };
