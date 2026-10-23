// 호가 글 읽기 — 네이버 부동산·호갱노노 등에서 "보이는 글"에서 매매 호가만 뽑는다.
// 우리 서버는 남의 사이트에 접속하지 않는다. 정민 님 브라우저에 떠 있는 화면 글(북마클릿) 또는 복사한 글만 읽는다.
// 결과 단위: 만원

// "5억 2,000" → 52000, "5억" → 50000, "9,800" → 9800, "52,000만" → 52000
export function toManwon(s) {
  const t = String(s).replace(/\s+/g, '').replace(/만원?$/, '');
  const m = t.match(/^(\d+)억(?:([\d,]+))?$/);
  if (m) return Number(m[1]) * 10000 + (m[2] ? Number(m[2].replace(/,/g, '')) : 0);
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 글에서 "매매 ○억 ○,○○○"과 바로 뒤의 면적(전용 ㎡)을 함께 모은다(전세·월세는 앞 단어가 달라 안 잡힌다)
//  네이버 "매매 5억 2,000 … 115/84m²", 호갱노노 "매매 6억 1,500 115A / 84m²" → 면적은 m² 바로 앞 숫자(전용)
const PRICE_RE = /매매(?:가|호가)?\s*:?\s*(\d+\s*억(?:\s*[\d,]{1,6})?|[\d,]{4,7}\s*만?)/g;
export function parseAskingRows(text) {
  const t = String(text || '');
  const out = [];
  let m;
  PRICE_RE.lastIndex = 0;
  while ((m = PRICE_RE.exec(t))) {
    const v = toManwon(m[1]);
    if (!v || v < 1000 || v > 5000000) continue; // 1천만원~500억
    const tail = t.slice(m.index + m[0].length, m.index + m[0].length + 40).split(/매매|전세|월세/)[0];
    const a = tail.match(/(\d+(?:\.\d+)?)\s*(?:m²|㎡|m2)/);
    out.push({ price: v, area: a ? Number(a[1]) : null });
  }
  return out;
}
export const parseAsking = (text) => parseAskingRows(text).map((r) => r.price);

// 물건 전용면적과 비슷한 것(±10%, 최소 ±3㎡)만 남긴다. 면적 모르는 매물은 같은 면적이 하나도 없을 때만 쓴다
export function pickByArea(rows, area) {
  if (!area) return { rows, mixed: rows.some((r) => r.area) && new Set(rows.map((r) => Math.round(r.area || 0))).size > 1 };
  const tol = Math.max(3, area * 0.1);
  const same = rows.filter((r) => r.area && Math.abs(r.area - area) <= tol);
  if (same.length) return { rows: same, mixed: false };
  const unknown = rows.filter((r) => !r.area);
  return { rows: unknown, mixed: false, noSame: rows.length - unknown.length };
}

// 여러 건이면 끝값 하나씩 떼고(오기·특수 매물) 최저·최고를 잡는다
export function summarize(prices) {
  const p = [...prices].sort((a, b) => a - b);
  if (!p.length) return null;
  const core = p.length >= 6 ? p.slice(1, -1) : p;
  return { low: core[0], high: core[core.length - 1], n: p.length };
}

// 북마클릿: 네이버 부동산 등 화면에서 누르면 매매 호가를 읽어 우리 호가 확인 화면으로 보낸다
export function bookmarkletCode(siteUrl) {
  const src = `(function(){var t=document.body.innerText;var re=${/매매(?:가|호가)?\s*:?\s*(\d+\s*억(?:\s*[\d,]{1,6})?|[\d,]{4,7}\s*만?)/g};var p=[],m;function v(s){s=s.replace(/\\s+/g,'').replace(/만원?$/,'');var a=s.match(/^(\\d+)억(?:([\\d,]+))?$/);if(a)return +a[1]*1e4+(a[2]?+a[2].replace(/,/g,''):0);var n=+s.replace(/,/g,'');return n>0?n:0}while(m=re.exec(t)){var x=v(m[1]);if(x<1000||x>5e6)continue;var tl=t.slice(m.index+m[0].length,m.index+m[0].length+40).split(/매매|전세|월세/)[0];var ar=tl.match(/(\\d+(?:\\.\\d+)?)\\s*(?:m²|㎡|m2)/);p.push(x+(ar?'@'+ar[1]:''))}if(!p.length){alert('이 화면에서 매매 호가를 못 찾았습니다. 단지를 눌러 매물 목록(이 단지 매물)이 보이게 한 뒤 다시 눌러 주세요.');return}window.open('${siteUrl}#/asking?prices='+p.join(',')+'&src='+encodeURIComponent(location.hostname),'jbslab_asking')})()`;
  return 'javascript:' + encodeURIComponent(src);
}
