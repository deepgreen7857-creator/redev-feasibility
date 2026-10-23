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

// 글에서 "매매 ○억 ○,○○○" 패턴만 모은다(전세·월세는 앞 단어가 달라 안 잡힌다)
export function parseAsking(text) {
  const re = /매매(?:가|호가)?\s*:?\s*(\d+\s*억(?:\s*[\d,]{1,6})?|[\d,]{3,7}\s*만?)/g;
  const out = [];
  let m;
  while ((m = re.exec(String(text || '')))) {
    const v = toManwon(m[1]);
    if (v && v >= 1000 && v <= 5000000) out.push(v); // 1천만원~500억
  }
  return out;
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
  const src = `(function(){var t=document.body.innerText;var re=${/매매(?:가|호가)?\s*:?\s*(\d+\s*억(?:\s*[\d,]{1,6})?|[\d,]{3,7}\s*만?)/g};var p=[],m;function v(s){s=s.replace(/\\s+/g,'').replace(/만원?$/,'');var a=s.match(/^(\\d+)억(?:([\\d,]+))?$/);if(a)return +a[1]*1e4+(a[2]?+a[2].replace(/,/g,''):0);var n=+s.replace(/,/g,'');return n>0?n:0}while(m=re.exec(t)){var x=v(m[1]);if(x>=1000&&x<=5e6)p.push(x)}if(!p.length){alert('이 화면에서 매매 호가를 못 찾았습니다. 매물 목록이 보이는 화면에서 눌러 주세요.');return}window.open('${siteUrl}#/asking?prices='+p.join(',')+'&src='+encodeURIComponent(location.hostname),'jbslab_asking')})()`;
  return 'javascript:' + encodeURIComponent(src);
}
