// 상세 화면의 '매각물건명세서' 버튼 → 법원 문서뷰어 창(새 창) → 그 창이 받는 PDF를 그대로 받아 글자를 읽는다.
//  사람이 버튼을 눌러 문서를 보는 것과 같은 요청만 생긴다(뷰어가 원래 받는 PDF를 옆에서 함께 받음).
//  PDF를 못 잡으면 뷰어의 '파일저장' 버튼(사람이 저장 누르는 것과 같음)으로 받는다.
import { pdfText, parseSpec } from './spec.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isPdf = (b) => b && b.length > 4 && b.slice(0, 4).toString() === '%PDF';

export async function readSpecDoc(page, { log = () => {}, name = '매각물건명세서' } = {}) {
  const btn = page.locator(`input[type=button][value="${name}"]:visible, button:visible:has-text("${name}")`).first();
  if (!(await btn.count())) return { read: false, why: '버튼 없음' };
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
    for (let i = 0; i < 25 && !pdf; i++) await sleep(1000); // 뷰어가 PDF를 받을 때까지(최대 25초)
    if (!pdf) {
      const save = popup.locator('#mf_btn_save');
      if (await save.count()) {
        const [dl] = await Promise.all([popup.waitForEvent('download', { timeout: 60000 }), save.click()]);
        const fs = await import('node:fs');
        const p = await dl.path();
        if (p) { const b = fs.readFileSync(p); if (isPdf(b)) pdf = b; }
      }
    }
    if (!pdf) return { read: false, why: 'PDF를 받지 못함' };
    const text = await pdfText(pdf);
    const spec = parseSpec(text);
    if (!spec.read) return { read: false, why: `글자 없는 PDF(그림 문서) ${text.replace(/\s/g, '').length}자` };
    return spec;
  } catch (e) {
    log(`${name} 읽기 실패: ${e.message}`);
    return { read: false, why: e.message.slice(0, 120) };
  } finally {
    ctx.off('response', onResp);
    if (popup) { await sleep(3000 + Math.random() * 4000); await popup.close().catch(() => {}); } // 문서를 읽는 사람처럼 잠깐 보고 닫음
  }
}
