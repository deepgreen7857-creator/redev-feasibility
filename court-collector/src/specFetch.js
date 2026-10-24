// 상세 화면의 문서 버튼(매각물건명세서·감정평가서·현황조사서) → 법원 문서뷰어 창(새 창) → 그 창이 받는 PDF를 그대로 받는다.
//  사람이 버튼을 눌러 문서를 보는 것과 같은 요청만 생긴다(뷰어가 원래 받는 PDF를 옆에서 함께 받음).
//  PDF를 못 잡으면 뷰어의 '파일저장' 버튼(사람이 저장 누르는 것과 같음)으로 받고,
//  그래도 없으면(뷰어가 아니라 일반 화면으로 열리는 문서) 그 창을 PDF로 인쇄해 둔다.
import { pdfText, parseSpec } from './spec.js';
import { readPhotos } from './site.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const isPdf = (b) => b && b.length > 4 && b.slice(0, 4).toString() === '%PDF';

/**
 * 문서 버튼을 눌러 PDF를 받는다. → { pdf?: Buffer, how?: 'viewer'|'save'|'print', why?: string, text?, photos? }
 * html: true 면 뷰어가 아닌 글자 화면(현황조사서 팝업)일 때 화면 글자(text)와 사진(photos)도 읽는다 — OCR 없이 원문 글자.
 */
export async function fetchDocPdf(page, name, { log = () => {}, waitSec = 25, html = false } = {}) {
  const btn = page.locator(`input[type=button][value="${name}"]:visible, button:visible:has-text("${name}")`).first();
  if (!(await btn.count())) return { why: '버튼 없음' };
  const ctx = page.context();
  let pdf = null;
  const onResp = async (res) => {
    try {
      if (pdf) return;
      const ct = (res.headers()['content-type'] || '').toLowerCase();
      if (!/getPdf|\.pdf|streamdocs/i.test(res.url()) && !ct.includes('pdf')) return;
      const b = await res.body().catch(() => null);
      if (isPdf(b)) pdf = b;
    } catch { /* 무시 */ }
  };
  ctx.on('response', onResp);
  let popup = null;
  try {
    [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 20000 }), btn.click()]);
    await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    let htmlDoc = false;
    for (let i = 0; i < waitSec && !pdf; i++) {
      await sleep(1000); // 뷰어가 PDF를 받을 때까지
      // 글자 화면 문서: 5초 지나도 PDF가 없고, 뷰어 저장 버튼이 없고, 화면에 글자가 충분하면 더 기다리지 않음
      if (html && i >= 4 && !(await popup.locator('#mf_btn_save').count())) {
        const n = await docText(popup).then((t) => t.replace(/\s/g, '').length).catch(() => 0);
        if (n > 300) { htmlDoc = true; break; }
      }
    }
    if (pdf) return { pdf, how: 'viewer' };
    if (htmlDoc) {
      await popup.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      const text = await docText(popup).catch(() => '');
      const photos = [];
      for (const fr of popup.frames()) { if (photos.length < 20) photos.push(...(await readPhotos(fr, { max: 20 - photos.length }).catch(() => []))); }
      let printed = null;
      try { const b = await popup.pdf({ format: 'A4', printBackground: true }); if (isPdf(b)) printed = b; } catch (e) { log(`${name} 화면 인쇄 실패: ${e.message}`); }
      return { pdf: printed, how: 'html', text, photos };
    }
    const save = popup.locator('#mf_btn_save');
    if (await save.count()) {
      try {
        const [dl] = await Promise.all([popup.waitForEvent('download', { timeout: 60000 }), save.click()]);
        const fs = await import('node:fs');
        const p = await dl.path();
        if (p) { const b = fs.readFileSync(p); if (isPdf(b)) return { pdf: b, how: 'save' }; }
      } catch (e) { log(`${name} 파일저장 실패: ${e.message}`); }
    }
    // 뷰어가 아닌 일반 화면 문서(현황조사서 등) — 화면 그대로 PDF로 인쇄(창을 띄우지 않는 실행에서만 됨)
    try {
      await popup.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      const b = await popup.pdf({ format: 'A4', printBackground: true });
      if (isPdf(b) && b.length > 2000) return { pdf: b, how: 'print' };
    } catch (e) { log(`${name} 화면 인쇄 실패: ${e.message}`); }
    return { why: 'PDF를 받지 못함' };
  } catch (e) {
    log(`${name} 열기 실패: ${e.message}`);
    return { why: e.message.slice(0, 120) };
  } finally {
    ctx.off('response', onResp);
    if (popup) { await sleep(3000 + Math.random() * 4000); await popup.close().catch(() => {}); } // 문서를 읽는 사람처럼 잠깐 보고 닫음
  }
}

/** 매각물건명세서 — PDF를 받아 권리 정보를 읽는다. 받은 PDF 원본은 pdf 로 함께 돌려준다(보관·관리자 열람용). */
export async function readSpecDoc(page, { log = () => {}, name = '매각물건명세서' } = {}) {
  const got = await fetchDocPdf(page, name, { log });
  if (!got.pdf) return { read: false, why: got.why };
  try {
    const text = await pdfText(got.pdf);
    const spec = parseSpec(text);
    if (!spec.read) return { read: false, why: `글자 없는 PDF(그림 문서) ${text.replace(/\s/g, '').length}자`, pdf: got.pdf, how: got.how };
    return { ...spec, pdf: got.pdf, how: got.how };
  } catch (e) {
    log(`${name} 읽기 실패: ${e.message}`);
    return { read: false, why: e.message.slice(0, 120), pdf: got.pdf, how: got.how };
  }
}

// 팝업의 글자 — 틀(frame) 안에 본문이 있는 경우까지 모두 모은다
async function docText(popup) {
  const parts = [];
  for (const fr of popup.frames()) {
    const t = await fr.evaluate(() => (document.body ? document.body.innerText : '')).catch(() => '');
    if (t && t.trim()) parts.push(t.trim());
  }
  return parts.join('\n\n');
}
