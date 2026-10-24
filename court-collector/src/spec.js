// 매각물건명세서 읽기 — 법원 문서뷰어가 받는 PDF에서 글자를 뽑아 권리 정보를 정리한다.
//  · 사람 이름은 저장하지 않는다(임차인은 보증금·날짜·배당요구 여부만).
//  · 글자를 못 뽑은 PDF(그림 문서)는 read:false 로 돌려준다 → 분석기는 '권리 미확인'으로 본다.
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// PDF → 줄 단위 글자(같은 높이의 글자를 한 줄로, 왼쪽부터)
export async function pdfText(buf) { return (await pdfPages(buf)).join('\n'); }

// PDF → 쪽마다 글자(배열, 0번이 1쪽) — 여러 사건이 한 문서에 든 경우 이 물건 쪽을 찾는 데 씀
export async function pdfPages(buf) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const base = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: path.join(base, 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(base, 'standard_fonts') + path.sep,
    useSystemFonts: false, isEvalSupported: false, verbosity: 0,
  }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
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
  await doc.destroy();
  return pages;
}

const ymd = (s) => {
  const m = String(s || '').match(/(\d{4})\s*[.\-]\s*(\d{1,2})\s*[.\-]\s*(\d{1,2})/);
  return m ? `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}` : undefined;
};
const won = (s) => Number(String(s).replace(/[^\d]/g, ''));
const between = (t, a, b) => {
  const i = t.search(a); if (i < 0) return '';
  const rest = t.slice(i).replace(a, '');
  const j = b ? rest.search(b) : -1;
  return (j >= 0 ? rest.slice(0, j) : rest).trim();
};
// 사람 이름(2~4자) 뒤 ':' → '임차인:' (기관 이름처럼 긴 것은 그대로)
const maskNames = (s) => String(s || '').replace(/(^|[\s,(])([가-힣]{2,4})(\s*:)/g, '$1임차인$3').replace(/임차권자\s+[가-힣]{2,4}의/g, '임차권자의');
const empty = (s) => !s || /^[\s\-·]*$/.test(s) || /^(없음|해당\s*없음|해당사항\s*없음)\.?$/.test(s.trim());

/**
 * 명세서 글자 → 권리 정보
 * @returns {{ read, baseRightDate, baseRightType, distributionDeadline, leases, survivingRights, superficies, remarks, tenantNote, assumedAmount, opposable }}
 */
export function parseSpec(text) {
  const raw = String(text || '');
  const t = raw.replace(/[ \t]+/g, ' ');
  if (!/매각물건명세서/.test(t.replace(/\s/g, '')) || t.replace(/\s/g, '').length < 150) return { read: false };
  const flat = t.replace(/\s+/g, ' ');

  // 최선순위 설정(말소기준권리)
  const bm = flat.match(/최선순위\s*(?:설\s*정)?\s*(\d{4}\s*[.\-]\s*\d{1,2}\s*[.\-]\s*\d{1,2})\.?\s*([가-힣]{2,10})?/);
  const baseRightDate = bm ? ymd(bm[1]) : undefined;
  const baseRightType = bm && bm[2] && !/배당|설정/.test(bm[2]) ? bm[2] : undefined;
  const dm = flat.match(/배당요구\s*종기\s*(\d{4}\s*[.\-]\s*\d{1,2}\s*[.\-]\s*\d{1,2})/);

  // 점유자 표: 머리줄(배당 요구여부) 다음부터 <비고> 또는 ※ 앞까지
  const table = between(t, /요구\s*여부[^\n]*\n?/, /<\s*비\s*고\s*>|※\s*최선순위|등기된\s*부동산에\s*관한/);
  const tenantNote = maskNames(between(t, /<\s*비\s*고\s*>/, /※\s*최선순위|등기된\s*부동산에\s*관한/).replace(/\s+/g, ' ').trim()) || undefined;
  const leases = [];
  if (table && !/조사된\s*임차내역\s*없음|임차인\s*없음/.test(table.replace(/\s+/g, ' '))) {
    // 행 나누기: 정보출처 구분(등기사항전부증명서·현황조사·권리신고)이 행마다 하나씩 있다
    const flatT = table.replace(/\s+/g, ' ');
    const SRC = /(등기사항\s*전부\s*(?:증명서)?|현황\s*조사|권리\s*신고)/g;
    const marks = [...flatT.matchAll(SRC)].map((m) => ({ i: m.index, src: m[1].replace(/\s/g, '') }));
    marks.forEach((m, k) => {
      const seg = flatT.slice(m.i, k + 1 < marks.length ? marks[k + 1].i : undefined);
      const amounts = [...seg.matchAll(/\d{1,3}(?:,\d{3})+/g)].map((x) => ({ i: x.index, v: won(x[0]) }));
      const dep = amounts.find((a) => a.v >= 1000000);
      const rent = dep ? amounts.find((a) => a.i > dep.i && a.v < dep.v) : undefined;
      const datesAfter = dep ? [...seg.slice(dep.i).matchAll(/\d{4}\s*[.\-]\s*\d{1,2}\s*[.\-]\s*\d{1,2}/g)].map((x) => ymd(x[0])) : [];
      const use = (seg.match(/(주거|점포|사무실|영업)/) || [])[1];
      const type = /주택임차권/.test(seg) ? '주택임차권자' : /상가임차권/.test(seg) ? '상가임차권자' : /임차인/.test(seg) ? '임차인' : /전세권/.test(seg) ? '전세권자' : undefined;
      if (!dep && datesAfter.length === 0 && !use) return;
      leases.push({
        source: m.src, use, type,
        deposit: dep ? dep.v : null, rent: rent ? rent.v : null,
        moveIn: datesAfter[0], fixedDate: datesAfter[1], claimDate: datesAfter[2],
        claimed: Boolean(datesAfter[2]),
      });
    });
  }
  // 같은 사람이 '등기사항'과 '권리신고' 두 줄로 나오는 경우(보증금·전입일 같음) → 하나로 합치고 배당요구는 둘 중 하나라도
  const merged = [];
  for (const l of leases) {
    const same = merged.find((m) => m.deposit && m.deposit === l.deposit && m.moveIn && m.moveIn === l.moveIn);
    if (same) { same.claimed = same.claimed || l.claimed; same.claimDate = same.claimDate || l.claimDate; same.source += `·${l.source}`; } else merged.push({ ...l });
  }

  const survivingRights = between(t, /소멸되지\s*아니하는\s*것/, /매각에\s*따라\s*설정된|지상권의\s*개요|비\s*고\s*란/).replace(/\s+/g, ' ').trim();
  const superficies = between(t, /지상권의\s*개요/, /비\s*고\s*란/).replace(/\s+/g, ' ').trim();
  const remarks = between(t, /비\s*고\s*란/, /※\s*1\s*[:：]|\n\s*\d+\s*\/\s*\d+\s*$/).replace(/\s+/g, ' ').trim();

  const base = (baseRightDate || '').replace(/\D/g, '');
  const opp = merged.filter((l) => l.moveIn && base && l.moveIn.replace(/\D/g, '') < base);
  const am = survivingRights.match(/(?:임차\s*보증금|보증금)\s*([\d,]{7,})\s*원/);
  const assumedAmount = am ? won(am[1]) : (/인수/.test(survivingRights) && opp.length ? opp.reduce((s, l) => s + (l.deposit || 0), 0) : 0);

  return {
    read: true,
    baseRightDate, baseRightType,
    distributionDeadline: dm ? ymd(dm[1]) : undefined,
    leases: merged,
    tenantNote,
    survivingRights: empty(survivingRights) ? undefined : maskNames(survivingRights).slice(0, 600),
    superficies: empty(superficies) ? undefined : superficies.slice(0, 400),
    remarks: empty(remarks) ? undefined : maskNames(remarks).slice(0, 600),
    opposable: opp.length, // 말소기준보다 먼저 전입한(대항력 있을 수 있는) 임차인 수
    assumedAmount: assumedAmount || undefined, // 명세서에 적힌 인수 보증금(배당받으면 줄어듦)
  };
}
