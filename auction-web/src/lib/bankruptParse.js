// 대법원 회생·파산 매각공고 첨부(PDF·HWP)에서 뽑은 글자 → 소재지·면적·매각가·감정가·기한·보증금·연락처
// 공고문 모양이 관재인마다 달라서 '찾은 것만' 보여 주고, 못 찾은 칸은 빈칸(원문 확인)으로 둔다 — 추정으로 메우지 않는다.

const KOR_NUM = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };
// '123,456,000원' · '1억 2,000만원' · '금 일억이천만원' → 원
export function moneyOf(s) {
  const t = String(s || '').replace(/\s/g, '');
  let m = t.match(/([\d,]+(?:\.\d+)?)억(?:([\d,]+)만)?(?:([\d,]+))?원/);
  if (m) return Math.round(Number(m[1].replace(/,/g, '')) * 1e8 + Number((m[2] || '0').replace(/,/g, '')) * 1e4 + Number((m[3] || '0').replace(/,/g, '')));
  m = t.match(/([\d,]+)만원/); if (m) return Number(m[1].replace(/,/g, '')) * 1e4;
  m = t.match(/([\d]{1,3}(?:,\d{3})+|\d{5,})원/); if (m) return Number(m[1].replace(/,/g, ''));
  m = t.match(/금([일이삼사오육칠팔구십백천만억]+)원/);
  if (m) {
    let total = 0; let sec = 0; let num = 0;
    for (const ch of m[1]) {
      if (KOR_NUM[ch]) num = KOR_NUM[ch];
      else if (ch === '십' || ch === '백' || ch === '천') { sec += (num || 1) * { 십: 10, 백: 100, 천: 1000 }[ch]; num = 0; }
      else if (ch === '만' || ch === '억') { total += (sec + num || 1) * (ch === '만' ? 1e4 : 1e8); sec = 0; num = 0; }
    }
    return total + sec + num || null;
  }
  return null;
}

// 라벨 뒤 가까운 곳(같은 줄~다음 줄)에서 금액 찾기
function moneyAfter(text, re) {
  const out = [];
  for (const m of text.matchAll(new RegExp(re.source, 'g'))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 90);
    const v = moneyOf(tail);
    if (v && v >= 100000) out.push(v);
  }
  return out;
}

function dateOf(s) {
  const m = String(s).match(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}
function timeOf(s) {
  const m = String(s).match(/(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{2})?/);
  if (!m) return null;
  let h = Number(m[2]); if (m[1] === '오후' && h < 12) h += 12;
  return `${String(h).padStart(2, '0')}:${m[3] || '00'}`;
}

const SIDO = '(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청북|충청남|충북|충남|전라북|전라남|전북|전남|경상북|경상남|경북|경남|제주)[가-힣]*';
const ADDR = new RegExp(`${SIDO}\\s+[가-힣]+(시|군|구)(\\s+[가-힣]+(구|시))?\\s+[가-힣0-9]+(동|읍|면|가|리|로|길)[가-힣0-9\\s]{0,20}?\\s*(산\\s*)?\\d+(-\\d+)?(번지)?`, 'g');

export function parseNotice(text) {
  const t = String(text || '').replace(/\r/g, '');
  if (t.length < 30) return null;
  const flat = t.replace(/\s+/g, ' ');
  // 소재지: 시도 시군구 동 지번 꼴(중복 제거, 앞의 5개)
  const addrs = [...new Set([...flat.matchAll(ADDR)].map((m) => m[0].replace(/\s+/g, ' ').trim()))].slice(0, 5);
  // 면적
  const areas = [...flat.matchAll(/([\d,]+(?:\.\d+)?)\s*(㎡|m²|m2|제곱미터|평방미터)/g)].map((m) => Number(m[1].replace(/,/g, ''))).filter((v) => v > 0 && v < 1e7);
  // 지목·종류
  const kinds = [...new Set((flat.match(/(아파트|다세대|연립|오피스텔|단독주택|다가구|근린생활시설|상가|공장|창고|대지|임야|(?<![가-힣])(전|답|대|잡종지|과수원)(?=\s|\d))/g) || []))].slice(0, 4);
  // 가격
  const minPrice = moneyAfter(flat, /(최저\s*매각\s*가격|최저\s*입찰\s*가(격)?|매각\s*예정\s*가(격)?|최저\s*매각가|매각\s*최저\s*가(격)?|입찰\s*최저\s*가(격)?|매각\s*가격|매도\s*희망\s*가(격)?)/)[0] || null;
  const appraisal = moneyAfter(flat, /(감정\s*평가\s*액|감정\s*가(격|액)?|감정\s*평가\s*금액|시가\s*감정\s*액)/)[0] || null;
  // 보증금(금액 또는 %)
  let deposit = null;
  const dm = flat.match(/(입찰\s*보증금|보증금)[^.。\n]{0,40}?(\d{1,2})\s*(%|퍼센트|할)/);
  if (dm) deposit = `${dm[2]}${dm[3] === '할' ? '할' : '%'}`;
  else { const dv = moneyAfter(flat, /입찰\s*보증금/)[0]; if (dv) deposit = dv; }
  // 기한: 입찰·제출·마감·접수 + 날짜
  let due = null; let open = null;
  for (const m of flat.matchAll(/(입찰\s*(서)?\s*(제출|마감|기간|기한|일시|접수)|제출\s*(기한|기간|마감)|접수\s*(기한|기간|마감)|매수\s*(신청|의향)\s*(기한|마감))/g)) {
    // 다음 항목 번호('4.')나 '개찰'·'보증금' 앞에서 자른다(기간이면 그 안의 마지막 날짜가 마감)
    let seg = flat.slice(m.index, m.index + 120);
    const cut = seg.slice(m[0].length).search(/\s\d{1,2}\.\s*[가-힣]|개찰|보증금|[①-⑳]/);
    if (cut > 0) seg = seg.slice(0, m[0].length + cut);
    const ds = [...seg.matchAll(/(20\d{2})\s*[.\-년/]\s*(\d{1,2})\s*[.\-월/]\s*(\d{1,2})/g)];
    if (ds.length) { const last = ds[ds.length - 1]; due = { date: dateOf(last[0]), time: timeOf(seg.slice(last.index + last[0].length, last.index + last[0].length + 25)) }; break; }
  }
  const om = flat.match(/개찰\s*(일시|일자|장소|기일)?[^0-9]{0,15}(20\d{2}\s*[.\-년/]\s*\d{1,2}\s*[.\-월/]\s*\d{1,2})/);
  if (om) open = dateOf(om[2]);
  // 연락처(관재인)
  const tm = flat.match(/(파산\s*관재인|관재인|문의|연락처|담당)[^0-9]{0,40}?(0\d{1,2}[)\-.\s]\s?\d{3,4}[\-.\s]\d{4})/);
  const phone = tm ? tm[2].replace(/[).\s]/g, '-').replace(/-+/g, '-') : null;
  const trustee = (flat.match(/파산\s*관재인\s*(변호사)?\s*([가-힣]{2,4})/) || [])[2] || null;
  // 수의계약·공개입찰
  const method = /수의\s*계약/.test(flat) ? '수의계약' : /공개\s*(경쟁\s*)?입찰|입찰\s*방식|최고가/.test(flat) ? '입찰' : null;
  const found = [addrs.length, areas.length, minPrice, appraisal, due].filter(Boolean).length;
  return { addrs, areas: areas.slice(0, 6), kinds, minPrice, appraisal, ratio: minPrice && appraisal ? minPrice / appraisal : null, deposit, due, open, phone, trustee, method, found };
}
