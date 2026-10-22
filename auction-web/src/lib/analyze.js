// 물건 판정 — 정민 님 기준: 모든 물건을 볼 필요 없이
//  ① 지금 매력  ② 유찰 대기(몇 회차에 들어가면 되는지)  ③ 가격으로 해결 안 됨
// + 현금청산형(조합설립인가 전후 분양권 없는 물건), 농지(농취증), 관심 제외 표시

import { TAX_DEFAULTS, propertyKind, flipTax, corpFit, acquisitionTax } from './tax.js';

export const VERDICT = {
  now: { label: '지금 매력', tone: 'now' },
  wait: { label: '유찰 대기', tone: 'wait' },
  hard: { label: '가격으로 해결 안 됨', tone: 'hard' },
  unknown: { label: '시세 부족', tone: 'muted' },
};

export const SOURCE_LABEL = { court: '법원경매', public: '공매', bankrupt: '파산자산', onbid: '공매' };

const FARM = /(^|\s)(전|답|과수원)(\s|$)|농지|전답/;

export function tradeTypeOf(item) {
  const s = `${item.usage || ''} ${item.usageSmall || ''} ${item.title || ''} ${item.detail?.landCategory || ''} ${item.land?.jimok || ''}`;
  if (/오피스텔/.test(s)) return 'offi';
  if (/아파트/.test(s)) return 'apt';
  if (/다세대|연립|빌라|도시형/.test(s)) return 'rh';
  if (/단독|다가구|주택/.test(s)) return 'sh';
  if (/토지|대지|임야|전답|농지|잡종지|(^|\s)(전|답|대|과수원)(\s|$)/.test(s) || (!item.buildingArea && item.landArea)) return 'land';
  return 'rh';
}

export function isFarmland(item) {
  const s = `${item.usage || ''} ${item.usageSmall || ''} ${item.detail?.landCategory || ''} ${item.land?.jimok || ''} ${item.title || ''}`;
  return FARM.test(s);
}

function median(arr) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// deals: 압축 거래 [가격, 면적, 층, 일, 지번, 이름, 건축년도, 해제, 거래유형, 읍면동, 추가]
export function marketEstimate(item, deals, { excludeDirect = true } = {}) {
  const type = tradeTypeOf(item);
  const area = type === 'land' ? item.landArea : item.buildingArea || item.landArea;
  if (!area || !deals || !deals.length) return { type, area, value: null, count: 0, basis: '시세 자료 없음' };
  let pool = deals.filter((d) => d[0] && d[1] && !d[7] && !(excludeDirect && d[8] === '직거래'));
  const sameDong = pool.filter((d) => item.emd && d[9] === item.emd);
  let scope = '같은 시군구';
  if (sameDong.length >= 5) { pool = sameDong; scope = `같은 동(${item.emd})`; }
  if (type !== 'land') {
    const near = pool.filter((d) => d[1] >= area * 0.8 && d[1] <= area * 1.2);
    if (near.length >= 3) pool = near;
  }
  if (!pool.length) return { type, area, value: null, count: 0, basis: '조건에 맞는 거래 없음' };
  const unit = median(pool.map((d) => d[0] / d[1]));
  return {
    type, area, unit, value: Math.round(unit * area), count: pool.length,
    basis: `${scope} 실거래 ${pool.length}건 ㎡당 중앙값 (해제${excludeDirect ? '·직거래' : ''} 제외)`,
    samples: pool.slice(0, 12),
  };
}

export function courtRate(item, settings) {
  const courts = settings?.courts || [];
  const hit = courts.find((c) => item.court && (item.court === c.name || item.court.startsWith(c.name)));
  if (hit) return { rate: hit.rate, verified: hit.verified, name: hit.name };
  if (item.sido === '서울특별시') return { rate: 0.2, verified: false, name: '서울 기본값' };
  return { rate: 0.3, verified: false, name: '인천·경기 기본값' };
}

// 다음 회차들의 최저가 예상
export function projectRounds(item, settings, count = 5) {
  const out = [];
  const now = item.minBid || item.appraisal;
  if (!now) return out;
  if (item.source === 'court') {
    const { rate } = courtRate(item, settings);
    for (let k = 0; k < count; k++) out.push({ step: k, label: k === 0 ? '현재' : `${k}회 더 유찰`, price: Math.round(now * (1 - rate) ** k) });
  } else {
    const first = item.firstPrice || item.appraisal || now;
    const floor = first * 0.5;
    let p = now;
    for (let k = 0; k < count; k++) {
      out.push({ step: k, label: k === 0 ? '현재' : `${k}회 더 유찰`, price: Math.round(p), floor: p <= floor + 1 });
      p = Math.max(floor, p - first * 0.1);
    }
  }
  return out;
}

export function costEstimate(item, value, settings) {
  const type = tradeTypeOf(item);
  // 명의(법인/개인)·공시가격·정비구역에 따라 취득세율을 정한다(매수상한 계산에도 반영)
  const kind = propertyKind(item, type, isFarmland(item));
  const taxRate = acquisitionTax(item, { price: value, kind, settings: { ...TAX_DEFAULTS, ...settings } }).rate;
  const tenants = item.detail?.flags?.tenants || 0;
  const eviction = (settings?.evictionCost ?? 3000000) * (tenants ? 1 : 0.3);
  const repair = settings?.repairCost ?? (type === 'land' ? 0 : 5000000);
  return { taxRate, tax: Math.round(value * taxRate), eviction: Math.round(eviction), repair, total: Math.round(value * taxRate + eviction + repair) };
}

export function hardReasons(item) {
  const r = [];
  const f = item.detail?.flags || {};
  if (f.superficies) r.push('법정지상권 성립 여지');
  if (f.survivingRights) r.push('말소되지 않는 권리(인수)');
  if (item.share) r.push('지분 물건');
  if (f.qualification) r.push('매수인 자격 제한');
  if (item.land?.landUse?.greenbelt) r.push('개발제한구역');
  if (item.land?.landUse?.roadConflict?.length) r.push('도시계획도로 저촉');
  if (item.manual?.hard) r.push(item.manual.hardNote || '수동 표시: 가격으로 해결 안 됨');
  return r;
}

export function isExcluded(item, settings) {
  const rules = settings?.analysisExclude || [];
  return rules.some((rule) => {
    if (rule.sido && rule.sido !== item.sido) return false;
    if (rule.sgg && !(item.sgg || '').includes(rule.sgg)) return false;
    if (rule.scope === 'all') return true;
    // 정비구역 물건만 제외: 판정 전(토지이용 미조회)도 안전하게 제외
    const redev = item.land?.landUse?.redevelopment;
    return !item.land || (redev && redev.length > 0) || Boolean(item.manual?.redevStage);
  });
}

// ── 정비사업 분양자격(조합원 지위) 판정 ─────────────────────────────
// 도시정비법 제39조제2항: 투기과열지구에서 재건축은 조합설립인가 후, 재개발은 관리처분계획인가 후
// 토지·건축물을 양수한 자는 조합원이 될 수 없다(현금청산).
// 예외(시행령 제37조제3항제5호): 국가·지방자치단체·금융기관에 대한 채무를 이행하지 못하여
// 재개발·재건축사업의 토지 또는 건축물이 경매 또는 공매되는 경우.
// 투기과열지구가 아니면 이 제한이 없다(권리산정기준일·다물권 등 별도 확인).
const STAGE_RANK = { '정비예정구역': 0, '구역지정': 1, '추진위원회 승인': 2, '조합설립인가 전(임박)': 2, '조합설립인가 후': 3, '건축심의': 3.5, '사업시행인가 후': 4, '관리처분인가 후': 5, '착공': 6, '준공': 7, '이전고시': 8 };

export function isOverheated(item, settings) {
  const last = (x) => String(x || '').trim().split(/\s+/).pop();
  return (settings?.overheated || []).some((r) => r.sido === item.sido && (r.sgg === '*' || (item.sgg && last(item.sgg) === last(r.sgg))));
}

export function projectKind(item) {
  const t = `${item.manual?.zone?.type || ''} ${item.manual?.projectType || ''} ${item.manual?.zone?.kind || ''}`;
  if (/재건축|가로주택|소규모|자율주택/.test(t)) return 'rebuild'; // 소규모주택정비도 조합설립인가 후 기준으로 본다
  if (/재개발|촉진|도시환경|주거환경/.test(t)) return 'redevelop';
  return null;
}

export function membership(item, settings) {
  const stage = item.manual?.zone?.stage || item.manual?.redevStage || null;
  if (!stage) return { status: 'none' };
  const rank = STAGE_RANK[stage] ?? (/관리처분/.test(stage) ? 5 : /사업시행/.test(stage) ? 4 : /조합설립인가 후/.test(stage) ? 3 : 1);
  const overheated = isOverheated(item, settings);
  const kind = projectKind(item);
  if (item.manual?.cashOut === true) return { status: 'cash', stage, rank, overheated, kind, reason: '직접 표시: 현금청산' };
  if (!overheated) return { status: 'member', stage, rank, overheated, kind, reason: '투기과열지구가 아니어서 조합원 지위 양도 제한(제39조②) 없음 — 권리산정기준일·다물권은 따로 확인' };
  if (!kind) return { status: 'check', stage, rank, overheated, kind, reason: '투기과열지구 — 재개발/재건축 구분이 없어 판정 보류' };
  const limitRank = kind === 'rebuild' ? 3 : 5;
  if (rank < limitRank) {
    return { status: 'member', stage, rank, overheated, kind, reason: `투기과열지구지만 아직 ${kind === 'rebuild' ? '조합설립인가' : '관리처분인가'} 전 — 지금 취득하면 조합원 가능${rank === limitRank - 1 || /임박/.test(stage) ? ' (인가 임박 여부 꼭 확인)' : ''}` };
  }
  // 제한 단계 이후: 경매·공매 예외 확인
  const creditor = item.manual?.creditor; // 'public' | 'other' | undefined
  const seizure = item.source !== 'court' && item.propertyType === '0007'; // 온비드 압류재산 = 국세·지방세 체납(국가·지자체 채무)
  if (creditor === 'public' || seizure) return { status: 'member', stage, rank, overheated, kind, reason: `제한 단계지만 ${seizure ? '체납 압류재산 공매' : '국가·지자체·금융기관 채무 경매'} — 시행령 제37조③5호 예외로 조합원 가능` };
  if (creditor === 'other') return { status: 'cash', stage, rank, overheated, kind, reason: `투기과열지구 ${kind === 'rebuild' ? '조합설립인가' : '관리처분인가'} 후 취득, 경매·공매 예외 아님 — 현금청산` };
  return { status: 'check', stage, rank, overheated, kind, reason: `투기과열지구 ${kind === 'rebuild' ? '조합설립인가' : '관리처분인가'} 후 — 경매 신청 채권자가 국가·지자체·금융기관이면 조합원 가능, 아니면 현금청산(등기부 확인)` };
}

// 입주권 가치 = 신축 예상 시세 − 추가분담금, 추가분담금 = 조합원분양가 − 권리가액(감정가 × 비례율)
export function newBuildPrice(aptDeals, area = 84) {
  const year = new Date().getFullYear();
  const pool = (aptDeals || []).filter((d) => d[0] && d[1] && !d[7] && d[6] && d[6] >= year - 5 && d[1] >= 59 && d[1] <= 115);
  if (pool.length < 3) return null;
  const units = pool.map((d) => d[0] / d[1]).sort((a, b) => a - b);
  return { price: Math.round(units[Math.floor(units.length / 2)] * area), count: pool.length };
}

export function rightValue(item, aptDeals) {
  const e = item.manual?.econ || {};
  const ratio = e.ratio ?? 1;
  const auto = newBuildPrice(aptDeals, e.area || 84);
  const newPrice = e.newPrice || (auto && auto.price) || null;
  const rightPrice = item.appraisal ? Math.round(item.appraisal * ratio) : null;
  const contribution = e.memberPrice && rightPrice !== null ? e.memberPrice - rightPrice : null;
  const value = newPrice && contribution !== null ? newPrice - contribution : null;
  return { ratio, newPrice, newPriceAuto: !e.newPrice && auto ? auto : null, memberPrice: e.memberPrice || null, rightPrice, contribution, value, area: e.area || 84 };
}

export function analyze(item, { settings, deals, aptDeals } = {}) {
  const margin = settings?.marginRate ?? 0.1;
  const market = marketEstimate(item, deals, { excludeDirect: settings?.excludeDirect !== false });
  const rounds = projectRounds(item, settings);
  const reasons = hardReasons(item);
  const farm = isFarmland(item);
  const redev = item.land?.landUse?.redevelopment || [];
  const member = membership(item, settings);
  const stage = member.stage || null;
  const cashType = member.status === 'cash';
  const right = member.status === 'member' && member.rank >= 3 ? rightValue(item, aptDeals) : null;
  const rightType = Boolean(right && right.value);

  let value = market.value;
  let valueBasis = market.basis;
  if (cashType) {
    value = Math.round((item.appraisal || 0) * (settings?.settlementRatio ?? 0.9));
    valueBasis = `현금청산형: 감정가 × ${Math.round((settings?.settlementRatio ?? 0.9) * 100)}% (예상 청산금)`;
  } else if (rightType) {
    value = right.value;
    valueBasis = `입주권형: 신축 ${right.area}㎡ 시세 ${Math.round(right.newPrice / 1e4).toLocaleString('ko-KR')}만 − 추가분담금 ${Math.round(right.contribution / 1e4).toLocaleString('ko-KR')}만 (비례율 ${Math.round(right.ratio * 100)}%)`;
  }
  const costs = value ? costEstimate(item, value, settings) : null;
  const cap = value ? Math.round(value * (1 - margin) - costs.total) : null;
  const entry = cap ? rounds.find((r) => r.price <= cap) : null;

  let verdict = 'unknown';
  if (reasons.length) verdict = 'hard';
  else if (cap !== null && cap <= 0) verdict = 'hard';
  else if (entry && entry.step === 0) verdict = 'now';
  else if (entry) verdict = 'wait';
  else if (cap !== null) verdict = 'hard';

  const warnings = [];
  if (farm) warnings.push(item.land?.landUse?.farmPromotion ? '농업진흥구역 농지 — 농취증·용도 제한 확인' : '농지 — 농지취득자격증명 필요');
  if (member.status === 'check') warnings.push(`분양자격 확인 필요: ${member.reason}`);
  if (member.status === 'member' && /임박/.test(member.reason || '')) warnings.push(member.reason);
  if (member.status === 'member' && member.rank >= 3 && !rightType) warnings.push('입주권형 — 구역의 비례율·조합원분양가를 넣으면 입주권 가치로 계산합니다');
  if (member.status !== 'none') warnings.push('권리산정기준일 이후 신축·지분분할 물건이거나 한 세대가 여러 채를 가지면 분양자격이 달라질 수 있음');
  if (item.detail?.flags?.unclaimedTenants) warnings.push(`배분요구 안 한 임차인 ${item.detail.flags.unclaimedTenants}명 — 인수 여부 확인`);
  if (item.source === 'court' && !courtRate(item, settings).verified) warnings.push('이 법원 저감률은 확인 전 기본값');
  if (market.count && market.count < 5 && !cashType && !rightType) warnings.push('비교 거래가 적음 — 시세 신뢰도 낮음');

  const result = {
    verdict, market, value, valueBasis, costs, cap, rounds, entry, reasons, warnings,
    farm, redev, cashType, rightType, right, member, stage, excluded: isExcluded(item, settings),
    ratio: item.appraisal && item.minBid ? item.minBid / item.appraisal : null,
  };
  result.score = scoreOf(item, result);
  result.money = moneyOf(item, result, settings);
  result.certainty = certaintyOf(result.score);
  return result;
}

// 돈 계산: 들어갈 가격(지금 최저가 또는 진입 회차 가격)으로 샀을 때
//  필요 자기자본 = 입찰가 − 대출 + 취득세 + 명도·수리비
//  예상 수익 = 예상 가치 − 입찰가 − 취득세 − 명도·수리비 − 보유기간 이자
//  수익률 = 예상 수익 ÷ 필요 자기자본
export function moneyOf(item, a, settings) {
  if (!a.value || a.verdict === 'hard') return null;
  const price = a.verdict === 'now' ? item.minBid || a.entry?.price : a.entry?.price;
  if (!price) return null;
  const s = { ...TAX_DEFAULTS, ...settings };
  const kind = propertyKind(item, tradeTypeOf(item), a.farm);
  const isLand = kind === 'land' || kind === 'farm';
  const loanRatio = a.cashType ? (s.cashLoanRatio ?? 0.5) : isLand ? (s.landLoanRatio ?? 0.4) : (s.loanRatio ?? 0.6);
  const rate = s.interestRate ?? 0.045;
  const months = s.holdMonths ?? 6;
  const loan = Math.round(price * loanRatio);
  const other = (a.costs?.eviction || 0) + (a.costs?.repair || 0);
  const interest = Math.round(loan * rate * (months / 12));
  const t = flipTax(item, { price, sale: a.value, kind, other, interest, settings: s });
  const own = price - loan + t.acqTax + other;
  const profit = t.afterTax;
  const later = a.rightType && a.right?.contribution > 0 ? a.right.contribution : 0;
  return { price, loan, loanRatio, tax: t.acqTax, other, interest, own, profit, preTax: t.preTax, roi: own > 0 ? profit / own : null, months, rate, later, t, kind, fit: corpFit(item, kind), owner: s.owner };
}

// 확실성 등급: 매력도 중 시세 신뢰도·권리·정비사업만(55점 → 100점 환산)
export function certaintyOf(score) {
  if (!score) return null;
  const p = score.parts;
  const v = Math.round(((p.시세신뢰도 + p.권리 + p.정비사업) / 55) * 100);
  return { value: v, grade: v >= 75 ? 'A' : v >= 55 ? 'B' : 'C' };
}

// 매력도(100점): 안전마진 45 · 시세 신뢰도 20 · 권리 깨끗함 25 · 정비사업 10  (지역 가산 없음)
export function scoreOf(item, a) {
  if (!['now', 'wait'].includes(a.verdict) || !a.cap) return null;
  const price = a.verdict === 'now' ? item.minBid || a.entry?.price : a.entry?.price;
  if (!price) return null;
  const margin = (a.cap - price) / price;
  const pMargin = Math.round(Math.max(0, Math.min(1, margin / 0.3)) * 45); // 안전마진 30% 이상이면 만점
  let pTrust;
  if (a.cashType) pTrust = 12;
  else if (a.rightType) pTrust = item.manual?.econ?.newPrice ? 18 : 14;
  else {
    const n = a.market.count || 0;
    pTrust = n >= 20 ? 15 : n >= 10 ? 12 : n >= 5 ? 8 : n > 0 ? 4 : 0;
    if (/같은 동/.test(a.market.basis || '')) pTrust += 5;
  }
  pTrust = Math.min(20, pTrust);
  const f = item.detail?.flags;
  let pRights = f ? 25 : 15; // 상세(권리 정보)가 없으면 중간값
  if (f) {
    if (f.unclaimedTenants) pRights -= 10;
    else if (f.tenants) pRights -= 5;
  }
  if (item.detail?.cautions) pRights -= 3;
  if (item.bulk) pRights -= 3;
  if (a.member.status === 'check') pRights -= 8;
  pRights = Math.max(0, pRights);
  const m = a.member;
  const pRedev = m.status === 'none' ? 5 : m.status === 'cash' ? 5 : m.status === 'check' ? 2 : a.rightType ? 10 : 7;
  const total = pMargin + pTrust + pRights + pRedev;
  return { total, grade: total >= 75 ? 'A' : total >= 55 ? 'B' : 'C', margin, parts: { 안전마진: pMargin, 시세신뢰도: pTrust, 권리: pRights, 정비사업: pRedev } };
}

export const won = (n) => (n === null || n === undefined || Number.isNaN(n) ? '—' : `${Math.round(n).toLocaleString('ko-KR')}원`);
export const eok = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  const v = Math.round(n / 10000);
  if (Math.abs(v) >= 10000) { const e = Math.floor(v / 10000); const m = v % 10000; return m ? `${e}억 ${m.toLocaleString('ko-KR')}만` : `${e}억`; }
  return `${v.toLocaleString('ko-KR')}만`;
};
export const pct = (r) => (r === null || r === undefined ? '—' : `${Math.round(r * 100)}%`);

// 물건 종류 표시용 이름: 아파트·다세대·단독·오피스텔·상가·토지·농지 등
export function typeLabel(item) {
  const s = `${item.usageSmall || ''} ${item.usage || ''} ${item.title || ''} ${item.detail?.landCategory || ''} ${item.land?.jimok || ''}`;
  const pick = [
    [/아파트/, '아파트'], [/오피스텔/, '오피스텔'], [/다세대|빌라/, '다세대'], [/연립/, '연립'], [/도시형/, '도시형생활주택'],
    [/다가구/, '다가구'], [/단독/, '단독주택'], [/근린|상가|점포|판매/, '상가'], [/업무|사무/, '업무시설'], [/공장/, '공장'], [/창고/, '창고'], [/숙박/, '숙박시설'],
    [/(^|\s)(전|답|과수원)(\s|$)|농지|전답/, '농지'], [/임야/, '임야'], [/대지|(^|\s)대(\s|$)/, '대지'], [/잡종지/, '잡종지'], [/도로/, '도로'], [/토지/, '토지'],
  ].find(([re]) => re.test(s));
  if (pick) return pick[1];
  const t = tradeTypeOf(item);
  return { apt: '아파트', rh: '다세대·연립', sh: '단독·다가구', offi: '오피스텔', land: '토지' }[t] || '기타';
}

export function areaText(item) {
  const b = item.buildingArea ? `건물 ${Math.round(item.buildingArea * 10) / 10}㎡(${Math.round(item.buildingArea / 3.3058)}평)` : '';
  const l = item.landArea ? `토지 ${Math.round(item.landArea * 10) / 10}㎡(${Math.round(item.landArea / 3.3058)}평)` : '';
  return [b, l].filter(Boolean).join(' · ');
}
