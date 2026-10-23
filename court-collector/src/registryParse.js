// 등기사항전부증명서(열람용) PDF 정리 — 마이옥션 열람본(대법원 인터넷등기소 양식, TCPDF로 만든 글자 PDF)
//  · 표제부 / 갑구(소유권) / 을구(소유권 외 권리)를 표 칸 위치(x)로 나눠 기록 하나하나로 정리
//  · 마지막 쪽 '주요 등기사항 요약(참고용)' = 말소되지 않은 사항 → 살아 있는 권리의 기준
//  · 주민·법인 등록번호는 지운다(이름·주소는 관리자 전용 자료로만 보관)
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// PDF → 쪽별 줄 [{ y, cells: [{ x, s }] }] (위에서 아래로, 왼쪽부터). 워터마크·빈 글자는 뺀다.
export async function pdfRows(buf) {
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
    const tc = await (await doc.getPage(p)).getTextContent();
    pages.push(groupRows(tc.items.map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str }))));
  }
  await doc.destroy();
  return pages;
}

const NOISE = /^(MYAUCTION|열람용)$/;
export function groupRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.s || !it.s.trim() || NOISE.test(it.s.replace(/\s/g, ''))) continue;
    let row = rows.find((r) => Math.abs(r.y - it.y) < 2.5);
    if (!row) { row = { y: it.y, cells: [] }; rows.push(row); }
    row.cells.push({ x: it.x, s: it.s.trim() });
  }
  rows.sort((a, b) => b.y - a.y);
  rows.forEach((r) => r.cells.sort((a, b) => a.x - b.x));
  return rows;
}

const text = (r) => r.cells.map((c) => c.s).join(' ').replace(/\s+/g, ' ').trim();
const flat = (r) => text(r).replace(/\s/g, '');
const mask = (s) => String(s || '').replace(/\d{6}\s*-\s*[\d*]{7}/g, '').replace(/\s{2,}/g, ' ').trim();
export const ymd = (s) => {
  const m = String(s || '').match(/(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  return m ? `${m[1]}.${m[2].padStart(2, '0')}.${m[3].padStart(2, '0')}` : undefined;
};
const won = (s) => { const m = String(s || '').replace(/\s/g, '').match(/금([\d,]+)원/); return m ? Number(m[1].replace(/,/g, '')) : undefined; };

// 쪽마다 반복되는 머리·꼬리 줄
const SKIP = [/^열람일시/, /^출력일시/, /^\d+\/\d+$/, /^\*/, /^-*이하여백-*$/, /^관할등기소/, /^PoweredbyTCPDF/, /^\[(건물|토지|집합건물)\]/, /^등기사항전부증명서/, /^-(건물|토지|집합건물)-$/, /^고유번호/];

// 표 머리 줄 + 본문 줄 → 칸 경계.
//  머리 글자는 칸 가운데에 찍히고 본문은 칸 왼쪽부터 찍히므로, 이웃한 두 머리 사이에서
//  본문 글자 시작 위치들의 '가장 큰 빈틈' 가운데를 경계로 잡는다(본문이 없으면 두 머리의 가운데).
//  실제 열람본 확인: 갑구 경계 64·140·233·309, 소유자 표 경계 79·157·235·445
//  '접 수'·'주 소'처럼 한 글자씩 띄어 찍힌 두 글자 머리는 하나로 합친다('지 목'·'면 적'이 '지목면적'으로 붙지 않게 두 글자까지만).
function boundsOf(header, rows = []) {
  const labels = [];
  for (const c of header.cells) {
    const last = labels[labels.length - 1];
    if (last && last.single && last.s.replace(/\s/g, '').length < 2 && c.s.trim().length === 1 && c.x - last.lastX < 70) { last.s += c.s; last.lastX = c.x; continue; }
    labels.push({ x: c.x, lastX: c.x, s: c.s, single: c.s.trim().length === 1 });
  }
  const names = labels.map((l) => l.s.replace(/\s/g, ''));
  const lefts = [...new Set(rows.flatMap((r) => r.cells.map((c) => Math.round(c.x))))].sort((p, q) => p - q);
  const cuts = labels.slice(1).map((l, i) => {
    const a = labels[i].x; const b = l.x;
    // 본문은 머리보다 조금 왼쪽에서 시작하기도 해서 창을 왼쪽으로 15 넓힌다. 오른쪽 머리 자리는 넣지 않는다(가운데 찍힌 머리라 본문 시작이 아님).
    const near = lefts.filter((x) => x > a - 15 && x < b + 5);
    if (!near.length) return (a + b) / 2;
    const pts = [...new Set([a, ...near])].sort((p, q) => p - q);
    let best = { gap: -1, cut: (a + b) / 2 };
    for (let k = 1; k < pts.length; k++) if (pts[k] - pts[k - 1] > best.gap) best = { gap: pts[k] - pts[k - 1], cut: (pts[k] + pts[k - 1]) / 2 };
    return best.cut;
  });
  return { names, cuts };
}
const colOf = (x, cuts) => { let i = 0; while (i < cuts.length && x >= cuts[i]) i++; return i; };

// 표 줄들 → 기록. 첫 칸(순위번호·표시번호 등)에 값이 있으면 새 기록.
function tableEntries(rows, header, startRe = /^\d+(-\d+)?$/) {
  const { names, cuts } = boundsOf(header, rows);
  const out = [];
  let cur = null;
  for (const r of rows) {
    const cols = names.map(() => []);
    r.cells.forEach((c) => cols[colOf(c.x, cuts)].push(c.s));
    const first = cols[0].join(' ').trim();
    if (first && startRe.test(first.replace(/\s/g, ''))) { cur = { cols: names.map(() => []) }; out.push(cur); }
    if (!cur) continue;
    cols.forEach((parts, i) => { if (parts.length) cur.cols[i].push(parts.join(' ')); });
  }
  return { names, entries: out };
}

// 갑구·을구 기록 하나 → 보기 좋은 모양
function rightOf(e) {
  const [rank, purpose, receipt, cause, holder] = e.cols;
  const rec = (receipt || []).join(' ');
  const hold = mask((holder || []).join('\n'));
  return {
    rank: (rank || []).join('').replace(/\s/g, ''),
    purpose: (purpose || []).join('').replace(/\s/g, ''),
    date: ymd(rec), receiptNo: (rec.match(/제\s*([\d]+)\s*호/) || [])[1],
    cause: mask((cause || []).join(' ')),
    holder: hold,
    amount: won(hold),
  };
}

// 'N번…말소' 기록이 가리키는 순위번호들
const cancelTargets = (purpose) => (/말소$/.test(purpose) ? [...purpose.matchAll(/(\d+(?:-\d+)?)번/g)].map((m) => m[1]) : []);

function markCanceled(list) {
  for (const e of list) for (const t of cancelTargets(e.purpose)) {
    const hit = list.find((x) => x.rank === t);
    if (hit) { hit.canceled = true; hit.canceledBy = e.rank; }
  }
  for (const e of list) if (cancelTargets(e.purpose).length) e.cancelEntry = true;
  // 부기(1-1 등)는 주등기가 말소되면 함께 말소
  for (const e of list) { const p = e.rank.split('-')[0]; if (p !== e.rank && list.find((x) => x.rank === p)?.canceled) e.canceled = true; }
  return list;
}

export function parseRegistry(pages) {
  const all = pages.flatMap((rows, p) => rows.map((r) => ({ ...r, page: p })));
  const meta = {};
  for (const r of all) {
    const f = flat(r);
    if (!meta.kind) { const m = f.match(/^-(건물|토지|집합건물)-$/); if (m) meta.kind = m[1]; }
    if (!meta.uniqueNo) { const m = f.match(/^고유번호([\d-]+)/); if (m) meta.uniqueNo = m[1]; }
    if (!meta.address) { const m = text(r).match(/^\[(건물|토지|집합건물)\]\s*(.+)$/); if (m) { meta.address = m[2].trim(); meta.kind ||= m[1]; } }
    if (!meta.viewedAt) { const m = f.match(/^열람일시:(\d{4})년(\d{2})월(\d{2})일(\d{2})시(\d{2})분/); if (m) meta.viewedAt = `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}`; }
    if (!meta.title && /^등기사항전부증명서/.test(f)) meta.title = text(r);
  }

  // 1) 본문: 표제부·갑구·을구
  const sumAt = all.findIndex((r) => /^주요등기사항요약/.test(flat(r)));
  const body = sumAt >= 0 ? all.slice(0, sumAt) : all;
  const sec = { pyo: [], gap: [], eul: [] };
  // 구역별 표 조각: 표 머리가 바뀌면 새 조각(집합건물 표제부는 표가 여럿). 쪽마다 반복되는 같은 머리는 이어 붙인다.
  const segs = { pyo: [], gap: [], eul: [] };
  let cur = null;
  for (const r of body) {
    const f = flat(r);
    if (/^【표제부】/.test(f)) { cur = 'pyo'; continue; }
    if (/^【갑구】/.test(f)) { cur = 'gap'; continue; }
    if (/^【을구】/.test(f)) { cur = 'eul'; continue; }
    if (!cur || SKIP.some((re) => re.test(f))) continue;
    if (/^(순위번호|표시번호)/.test(f)) {
      const last = segs[cur][segs[cur].length - 1];
      if (!last || flat(last.header) !== f) segs[cur].push({ header: r, rows: [] });
      continue;
    }
    if (/^\(.*\)$/.test(f) && f.length < 30) continue; // (대지권의 표시) 같은 소제목
    const last = segs[cur][segs[cur].length - 1];
    if (last) last.rows.push(r);
  }
  for (const k of ['pyo', 'gap', 'eul']) {
    for (const seg of segs[k]) {
      const { names, entries } = tableEntries(seg.rows, seg.header);
      if (k === 'pyo') sec.pyo.push(...entries.map((e) => Object.fromEntries(names.map((n, i) => [n, mask(e.cols[i].join(' '))]))));
      else sec[k].push(...entries.map(rightOf));
    }
    if (k !== 'pyo') markCanceled(sec[k]);
  }

  // 2) 주요 등기사항 요약(말소되지 않은 사항)
  const summary = sumAt >= 0 ? { owners: [], gap: [], eul: [] } : null;
  if (summary) {
    const rest = all.slice(sumAt + 1);
    let part = null; let header = null; let buf = [];
    const flush = () => {
      if (!part || !header) return;
      if (part === 'owners') {
        const { entries } = tableEntries(buf, header, /^\S{1,}$/);
        summary.owners = entries.map((e) => ({ name: e.cols[0].join(' ').trim(), share: e.cols[2]?.join(' ').trim(), address: mask(e.cols[3]?.join(' ')), rank: e.cols[4]?.join(' ').trim() })).filter((o) => o.name && !/^\(?주민\)?/.test(o.name));
      } else {
        const { entries } = tableEntries(buf, header);
        summary[part] = entries.map((e) => {
          const [rank, purpose, receipt, main, owner] = e.cols;
          const rec = (receipt || []).join(' ');
          const m = mask((main || []).join(' '));
          return { rank: rank.join('').replace(/\s/g, ''), purpose: purpose.join('').replace(/\s/g, ''), date: ymd(rec), receiptNo: (rec.match(/제\s*(\d+)\s*호/) || [])[1], main: m, amount: won(m), owner: mask((owner || []).join(' ')) };
        });
      }
    };
    for (const r of rest) {
      const f = flat(r);
      if (/^\[참고사항\]/.test(f)) break;
      if (/^\[주의사항\]/.test(f) || /^(본주요등기사항|실제권리사항)/.test(f) || SKIP.some((re) => re.test(f))) continue;
      const next = /^1\.소유지분현황/.test(f) ? 'owners' : /^2\.소유지분을제외한/.test(f) ? 'gap' : /^3\./.test(f) && /을구/.test(f) ? 'eul' : null;
      if (next) { flush(); part = next; header = null; buf = []; continue; }
      if (!part) continue;
      if (/^-?기록사항없음$/.test(f)) continue;
      if (!header && /(등기명의인|순위번호)/.test(f)) { header = r; continue; }
      buf.push(r);
    }
    flush();
  }

  return { ...meta, sections: sec, summary, flags: flagsOf(sec, summary) };
}

// 분석용 표시(이름 없음 — 물건에 공개로 붙여도 되는 값만)
//  말소기준권리 후보: 살아 있는 (근)저당·압류·가압류·담보가등기·경매개시결정 중 가장 이른 것
//  그보다 앞선 가처분·가등기·전세권·지상권·지역권·임차권·환매특약은 '인수 위험'으로 표시
export function flagsOf(sec, summary) {
  const live = summary
    ? [...summary.gap.map((x) => ({ ...x, part: 'gap' })), ...summary.eul.map((x) => ({ ...x, part: 'eul' }))]
    : [...sec.gap, ...sec.eul].filter((x) => !x.canceled && !x.cancelEntry && !/^소유권(보존|이전)$/.test(x.purpose));
  const has = (re) => live.filter((x) => re.test(x.purpose));
  const sortDate = (a, b) => String(a.date || '9').localeCompare(String(b.date || '9')) || Number(a.receiptNo || 0) - Number(b.receiptNo || 0);
  const baseCand = live.filter((x) => /(근저당|저당권|압류|담보가등기|경매개시결정)/.test(x.purpose) && !/말소|변경|이전$/.test(x.purpose)).sort(sortDate);
  const base = baseCand[0];
  const seniorRe = /(가처분|가등기|전세권|지상권|지역권|임차권|환매)/;
  const senior = base ? live.filter((x) => seniorRe.test(x.purpose) && !/담보가등기/.test(x.purpose) && sortDate(x, base) < 0) : live.filter((x) => seniorRe.test(x.purpose));
  const owners = summary?.owners || [];
  return {
    liveCount: live.length,
    owners: owners.length || undefined,
    shareOwners: owners.length > 1 || owners.some((o) => /분의/.test(o.share || '')) || undefined,
    trust: has(/신탁/).length > 0 || undefined,
    provisionalReg: has(/가등기/).length || undefined,
    injunction: has(/가처분/).length || undefined,
    attachment: has(/가압류/).length || undefined,
    seizure: has(/(^|[^가])압류/).length || undefined,
    auctionStart: has(/경매개시결정/).length || undefined,
    mortgageMax: has(/근저당|저당권/).reduce((s, x) => s + (x.amount || 0), 0) || undefined,
    lease: has(/전세권|임차권/).length || undefined,
    superficies: has(/지상권/).length || undefined,
    baseRight: base ? { purpose: base.purpose, date: base.date } : undefined,
    senior: senior.length ? senior.map((x) => ({ purpose: x.purpose, date: x.date })) : undefined,
  };
}

// 전체 글자(관리자 화면·Claude 검토용). 등록번호는 지운다.
export const plainText = (pages) => mask(pages.map((rows) => rows.map(text).join('\n')).join('\n\n'));
