// 법인 단기매매(사서 바로 팔기) 세금 계산 — 일반 기준의 추정치. 세율은 관리자 설정에서 바꿀 수 있다.
// 근거(요약)
//  · 취득세: 법인 주택 12% 중과(지방세법 제13조의2). 수도권 시가표준액 1억원 이하 주택은 중과 제외(시행령 제28조의2 제1호)
//    단, 도시정비법 정비구역·소규모주택정비법 사업시행구역 안의 주택은 그 제외에서 빠진다(=12%).
//  · 주택 외(토지·상가·오피스텔) 취득세 4.6%. 법인은 원칙적으로 농지를 취득할 수 없다(농지법, 농업법인 예외).
//  · 부가세: 사업자(법인)가 파는 건물분 과세. 전용 85㎡ 이하 주택과 토지는 면세.
//  · 법인세: 과세표준 구간 세율 + 주택·비사업용 토지 양도차익 추가 과세(법인세법 제55조의2). 지방소득세 포함 추정.

export const TAX_DEFAULTS = {
  owner: 'corp',               // corp | person
  holdMonths: 6,
  corpHouseLimit: 100000000,   // 수도권 시가표준액 기준
  brokerRate: 0.005,           // 팔 때 중개수수료
  buildingRatio: 0.5,          // 매매가 중 건물분 비율(부가세 계산용)
  corpTaxRate: 0.11,           // 법인세+지방소득세(과세표준 2억 이하 구간 기준)
  surchargeRate: 0.22,         // 주택·비사업용 토지 추가 과세(지방소득세 포함)
};

const COMMERCIAL = /(상가|근린|업무|공장|창고|숙박|판매|점포|사무소|오피스(?!텔))/;

export function propertyKind(item, tradeType, farm) {
  const s = `${item.usage || ''} ${item.usageSmall || ''} ${item.title || ''}`;
  if (farm) return 'farm';
  if (tradeType === 'offi' || /오피스텔/.test(s)) return 'offi';
  if (COMMERCIAL.test(s)) return 'commercial';
  if (tradeType === 'land') return 'land';
  return 'house';
}

export function inRedevArea(item) {
  return Boolean(item.manual?.zone || item.manual?.redevStage || (item.land?.landUse?.redevelopment || []).length);
}

// 시가표준액: 호가 맞으면 그 값, 아니면 그 필지 전 호가 기준 이하일 때만 최댓값으로 인정
export function houseStdPrice(item, limit) {
  const h = item.housePrice;
  if (!h) return null;
  if (h.price) return h.price;
  if (h.max && h.max <= limit) return h.max;
  return null;
}

function houseGeneralRate(price, area) {
  const base = price <= 6e8 ? 0.01 : price <= 9e8 ? (price * 2 / 3e8 - 3) / 100 : 0.03;
  return base + base * 0.1 + (area > 85 ? 0.002 : 0); // 지방교육세 + 농특세(85㎡ 초과)
}

export function acquisitionTax(item, { price, kind, settings }) {
  const s = { ...TAX_DEFAULTS, ...settings };
  const area = item.buildingArea || 0;
  if (kind !== 'house') return { rate: 0.046, label: kind === 'farm' ? '농지 4.6%(법인 취득 불가)' : '주택 외 4.6%', heavy: false };
  if (s.owner !== 'corp') return { rate: houseGeneralRate(price, area), label: '개인 1주택 기준 일반세율', heavy: false };
  if (inRedevArea(item)) return { rate: area > 85 ? 0.134 : 0.124, label: '법인 12% 중과 — 정비구역 안 주택은 1억 이하 예외 없음', heavy: true };
  const std = houseStdPrice(item, s.corpHouseLimit);
  if (std === null) return { rate: area > 85 ? 0.134 : 0.124, label: '공시가격 확인 전 — 12% 중과로 가정', heavy: true, unknown: true };
  if (std > s.corpHouseLimit) return { rate: area > 85 ? 0.134 : 0.124, label: `법인 12% 중과 — 공시가격 ${Math.round(std / 1e4).toLocaleString('ko-KR')}만 (1억 초과)`, heavy: true };
  return { rate: houseGeneralRate(price, area), label: `일반세율 — 공시가격 ${Math.round(std / 1e4).toLocaleString('ko-KR')}만 (1억 이하, 정비구역 밖)`, heavy: false };
}

// 법인 단타 적합도: A 적합 · B 조건부 · ? 확인 필요 · X 부적합
export function corpFit(item, kind) {
  const area = item.buildingArea || 0;
  if (kind === 'farm') return { grade: 'X', reason: '법인은 농지 취득 불가' };
  if (kind === 'house') {
    if (inRedevArea(item)) return { grade: 'X', reason: '정비구역 안 주택 → 취득세 12%' };
    const std = houseStdPrice(item, TAX_DEFAULTS.corpHouseLimit);
    if (std === null) return { grade: '?', reason: '공시가격 확인 필요' };
    if (std > TAX_DEFAULTS.corpHouseLimit) return { grade: 'X', reason: '공시가격 1억 초과 → 취득세 12%' };
    return area > 85 ? { grade: 'B', reason: '취득세 일반, 85㎡ 초과라 부가세 있음' } : { grade: 'A', reason: '취득세 일반·부가세 면세' };
  }
  if (kind === 'land') return { grade: 'B', reason: '취득세 4.6%, 비사업용이면 추가 법인세' };
  return { grade: 'B', reason: '취득세 4.6%, 건물분 부가세' };
}

// 사서(price) 예상 가치(sale)에 팔 때의 비용·세금
export function flipTax(item, { price, sale, kind, other, interest, settings }) {
  const s = { ...TAX_DEFAULTS, ...settings };
  const acq = acquisitionTax(item, { price, kind, settings: s });
  const acqTax = Math.round(price * acq.rate);
  const broker = Math.round(sale * s.brokerRate);
  const area = item.buildingArea || 0;
  const vatable = s.owner === 'corp' && (kind === 'commercial' || kind === 'offi' || (kind === 'house' && area > 85));
  const vat = vatable ? Math.round(sale * s.buildingRatio * 10 / 110) : 0;
  const preTax = sale - price - acqTax - other - interest - broker - vat;
  let incomeTax = 0; let surcharge = 0;
  if (s.owner === 'corp' && preTax > 0) {
    incomeTax = Math.round(preTax * s.corpTaxRate);
    if (kind === 'house' || kind === 'land') surcharge = Math.round(preTax * s.surchargeRate);
  }
  return { acq, acqTax, broker, vat, preTax, incomeTax, surcharge, afterTax: preTax - incomeTax - surcharge, owner: s.owner };
}
