// 상세 화면의 문서 버튼(매각물건명세서·감정평가서·현황조사서) → 법원 문서뷰어 창(새 창) → 그 창이 받는 PDF를 그대로 받는다.
//  사람이 버튼을 눌러 문서를 보는 것과 같은 요청만 생긴다(뷰어가 원래 받는 PDF를 옆에서 함께 받음).
//  PDF를 못 잡으면 뷰어의 '파일저장' 버튼(사람이 저장 누르는 것과 같음)으로 받고,
//  그래도 없으면(뷰어가 아니라 일반 화면으로 열리는 문서) 그 창을 PDF로 인쇄해 둔다.
import { pdfText, parseSpec } from './spec.js';
import { readPhotos, closeLayers, hasLayer, layerText } from './site.js';

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
    // 새 창으로 열리는 문서(뷰어)와 화면 안에 뜨는 창(현황조사서 등) 둘 다 있다
    const newPage = ctx.waitForEvent('page', { timeout: 15000 }).catch(() => null);
    await btn.click();
    popup = await newPage;
    if (!popup) {
      // 화면 안 창: 뷰어가 PDF를 받으면 그걸 쓰고, 글자 화면이면 창의 글자·사진을 읽는다. 끝나면 반드시 닫는다(finally)
      for (let i = 0; i < waitSec && !pdf; i++) {
        await sleep(1000);
        if (html && i >= 3 && (await hasLayer(page)) && (await layerText(page)).replace(/\s/g, '').length > 300) break;
      }
      if (pdf) return { pdf, how: 'viewer-layer' };
      if (!(await hasLayer(page))) return { why: '문서 창이 열리지 않음' };
      // 감정평가서: 화면 안 창 속 틀(iframe)이 한국감정평가사협회 뷰어(ca.kapanet.or.kr)를 띄우고, 그 안에서 PDF를 <embed>로 보여 준다.
      //  창 없이 도는 브라우저는 PDF 보기 기능이 없어 embed가 PDF를 받지 않는다 → 틀 안의 PDF 주소를 읽어 사람이 연 것과 같은 요청으로 받는다
      const outer = await embeddedPdf(page, { log, name });
      if (outer) return { pdf: outer.pdf, how: outer.how };
      const text = await layerText(page);
      if (!html || text.replace(/\s/g, '').length < 100) return { why: '화면 안 창에 PDF·글자 없음' };
      const photos = await readPhotos(page, { max: 20, scope: '.w2window, .w2popup_window' }).catch(() => []);
      return { pdf: null, how: 'layer', text, photos };
    }
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
    await sleep(3000 + Math.random() * 4000); // 문서를 읽는 사람처럼 잠깐 보고 닫음
    if (popup) await popup.close().catch(() => {});
    await closeLayers(page).catch(() => {}); // 화면 안에 뜬 문서 창도 닫는다(남으면 목록을 덮음)
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

// 화면 안 창의 틀(iframe) → 그 안의 embed/object/iframe/링크 중 PDF를 찾아 받는다(감정평가서: ca.kapanet.or.kr)
async function embeddedPdf(page, { log = () => {}, name = '' } = {}) {
  const req = page.context().request;
  const frameSrcs = await page.$$eval('.w2window iframe, .w2popup_window iframe', (fs) => fs.filter((f) => f.offsetParent !== null).map((f) => f.src).filter((u) => /^https?:/.test(u))).catch(() => []);
  for (const src of frameSrcs) {
    const cands = [src];
    // 틀이 다른 사이트(협회)여도 Playwright는 안을 읽을 수 있다
    const fr = page.frames().find((f) => f.url() === src) || page.frames().find((f) => f.url().startsWith(src.split('?')[0]));
    if (fr) {
      await fr.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      const inner = await fr.evaluate(() => [...document.querySelectorAll('embed[src], object[data], iframe[src], a[href]')]
        .map((e) => e.src || e.data || e.href).filter((u) => u && /^https?:/.test(u))).catch(() => []);
      // PDF 같아 보이는 주소부터
      inner.sort((a, b) => Number(/pdf|down|file|view/i.test(b)) - Number(/pdf|down|file|view/i.test(a)));
      cands.push(...inner.slice(0, 6));
    }
    for (const u of cands) {
      try {
        const r = await req.get(u, { headers: { Referer: u === src ? page.url() : src }, timeout: 60000 });
        const b = await r.body();
        if (isPdf(b)) return { pdf: b, how: u === src ? 'frame' : 'embed' };
        // 틀 주소가 HTML이면 그 안의 PDF 주소를 한 번 더 찾는다(틀을 못 읽은 경우)
        if (u === src && !fr) {
          const html = b.toString('utf8');
          const m = [...html.matchAll(/(?:src|data|href)\s*=\s*["']([^"']+)["']/gi)].map((x) => new URL(x[1], src).href).filter((x) => /pdf|down|file/i.test(x));
          cands.push(...m.slice(0, 6));
        }
      } catch (e) { log(`${name} 틀 PDF 받기 실패 ${u.slice(0, 80)}: ${e.message}`); }
    }
  }
  return null;
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
