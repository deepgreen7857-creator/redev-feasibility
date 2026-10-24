// 첨부 PDF의 글자·쪽 배치는 그대로 두고, 안에 든 사진(JPEG)만 화면으로 볼 만한 크기로 줄인다.
//  · 글자 PDF는 글자가 그대로 남아 드래그·검색이 된다(글자를 뽑아 다시 앉히지 않음 → 표가 흐트러지지 않음)
//  · 사진: 긴 쪽 maxSide 픽셀, JPEG 품질 quality. 평면도처럼 그림으로 들어간 도면도 이 크기면 읽을 수 있게 1600으로 둠
//  · 줄일 수 없는 그림(CMYK·마스크·특수 압축)은 손대지 않는다. 결과가 이상하면 원본을 그대로 쓴다(호출하는 쪽에서 검사)
import { PDFDocument, PDFName, PDFNumber, PDFArray, PDFRawStream, PDFDict, PDFRef } from 'pdf-lib';
import jpeg from 'jpeg-js';

const N = (s) => PDFName.of(s);

function isDct(filter) {
  if (filter === N('DCTDecode')) return true;
  return filter instanceof PDFArray && filter.size() === 1 && filter.get(0) === N('DCTDecode');
}

// 넓이 평균으로 줄이기(계단 현상 없이)
function shrink(rgba, w, h, nw, nh) {
  const out = Buffer.alloc(nw * nh * 4);
  const sx = w / nw; const sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy); const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx); const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        let i = (yy * w + x0) * 4;
        for (let xx = x0; xx < x1; xx++, i += 4) { r += rgba[i]; g += rgba[i + 1]; b += rgba[i + 2]; n++; }
      }
      const o = (y * nw + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return out;
}

/** → { buf, changed, before, after } — changed=0 이면 buf 는 원본 그대로 */
export async function slimPdf(input, { maxSide = 1600, quality = 72, minBytes = 120 * 1024 } = {}) {
  const before = input.length;
  let doc;
  try { doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false }); } catch { return { buf: input, changed: 0, before, after: before, why: '열 수 없는 PDF' }; }
  const ctx = doc.context;
  let changed = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict;
    if (d.get(N('Subtype')) !== N('Image') || !isDct(d.get(N('Filter')))) continue;
    if (d.get(N('ImageMask')) || d.get(N('Decode')) || d.get(N('DecodeParms'))) continue;
    let cs = d.get(N('ColorSpace'));
    if (cs instanceof PDFRef) cs = ctx.lookup(cs);
    if (cs === N('DeviceCMYK')) continue;
    if (cs instanceof PDFArray) {
      if (cs.get(0) !== N('ICCBased')) continue; // Indexed·Separation 등은 건드리지 않음
      const icc = ctx.lookup(cs.get(1));
      const n = icc && icc.dict ? icc.dict.get(N('N')) : null;
      if (!(n instanceof PDFNumber) || n.asNumber() === 4) continue;
    }
    const bytes = obj.contents;
    if (bytes.length < minBytes) continue;
    let img;
    try { img = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 1024, maxResolutionInMP: 200 }); } catch { continue; }
    const k = Math.min(1, maxSide / Math.max(img.width, img.height));
    const nw = Math.max(1, Math.round(img.width * k)); const nh = Math.max(1, Math.round(img.height * k));
    const px = k < 1 ? shrink(img.data, img.width, img.height, nw, nh) : img.data;
    const enc = jpeg.encode({ data: px, width: nw, height: nh }, quality).data;
    if (enc.length >= bytes.length * 0.9) continue; // 별로 안 줄면 원래 것 유지
    const nd = PDFDict.withContext(ctx);
    for (const [key, val] of d.entries()) nd.set(key, val);
    nd.set(N('Width'), PDFNumber.of(nw)); nd.set(N('Height'), PDFNumber.of(nh));
    nd.set(N('ColorSpace'), N('DeviceRGB')); nd.set(N('BitsPerComponent'), PDFNumber.of(8));
    nd.set(N('Filter'), N('DCTDecode')); nd.set(N('Length'), PDFNumber.of(enc.length));
    ctx.assign(ref, PDFRawStream.of(nd, enc));
    changed++;
  }
  if (!changed) return { buf: input, changed: 0, before, after: before };
  const out = Buffer.from(await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false }));
  if (out.length >= before) return { buf: input, changed: 0, before, after: before, why: '줄지 않음' };
  return { buf: out, changed, before, after: out.length };
}
