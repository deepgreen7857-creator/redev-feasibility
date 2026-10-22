// 법원경매 붙여넣기 해석: 사건번호·감정가·최저가·면적·주소
export function parseCourtText(t) {
  const out = {};
  const m = (re) => (t.match(re) || [])[1];
  const n = (s) => (s ? Number(String(s).replace(/[^\d.]/g, '')) : '');
  out.caseNo = m(/(\d{4}\s*타경\s*\d+)/)?.replace(/\s/g, '') || '';
  out.appraisal = n(m(/감정(?:평가)?(?:가|액)[^\d]{0,10}([\d,]+)/));
  out.minBid = n(m(/최저(?:매각)?(?:가|가격)[^\d]{0,10}([\d,]+)/));
  out.failCount = m(/유찰\s*(\d+)\s*회/) || '';
  out.bidEnd = m(/(?:매각기일|입찰기일)[^\d]{0,6}(\d{4}[.-]\d{1,2}[.-]\d{1,2})/)?.replace(/\./g, '-') || '';
  out.landArea = n(m(/대지권?[^\d]{0,12}([\d.]+)\s*㎡/) || m(/토지[^\d]{0,12}([\d.]+)\s*㎡/));
  out.buildingArea = n(m(/(?:전용|건물)[^\d]{0,12}([\d.]+)\s*㎡/));
  const addr = m(/((?:서울특별시|인천광역시|경기도)\s[^\n]{4,60})/);
  if (addr) {
    out.address = addr.trim();
    const parts = out.address.split(/\s+/);
    out.sido = parts[0];
    out.sgg = parts[1] && /[시군구]$/.test(parts[1]) ? (parts[2] && /구$/.test(parts[2]) ? `${parts[1]} ${parts[2]}` : parts[1]) : '';
    out.emd = parts.find((p) => /[동읍면리가]$/.test(p) && p !== out.sgg) || '';
  }
  const court = m(/((?:서울|인천|수원|의정부)[^\s]*지방법원(?:\s*[가-힣]+지원)?)/);
  if (court) out.court = court.replace(/\s+/, ' ');
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== '' && v !== undefined));
}

