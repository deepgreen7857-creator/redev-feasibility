// 자동 복사본 — 원본: auction-web/src/lib/analyze.js (직접 고치지 말 것)
// 물건 판정 — 정민 님 기준: 모든 물건을 볼 필요 없이
//  ① 지금 매력  ② 유찰 대기  ③ 권리 확인 후 판단(특수물건) — 권리가 복잡해도 버리지 않고 바닥 가치·상승 시나리오로 계산
// + 현금청산형(조합설립인가 전후 분양권 없는 물건), 농지(농취증), 관심 제외 표시

import { TAX_DEFAULTS, propertyKind, flipTax, corpFit, acquisitionTax } from './tax.mjs';
import { specialAnalysis, detectSpecial, shareInfo } from './special.mjs';
import { valuation } from './valuation.mjs';
import { stageInfo, rightsCheck } from './zoneMatch.mjs';

export const VERDICT = {
  now: { label: '지금 매력', tone: 'now' },
  wait: { label: '유찰 대기', tone: 'wait' },
  check: { label: '권리 확인 후 판단', tone: 'cash' },
  suspect: { label: '오류 의심 — 원문 확인', tone: 'hard' },
  shareUnknown: { label: '지분비율 미확인', tone: 'muted' },
  hard: { label: '가격 안 맞음', tone: 'hard' },
  unknown: { label: '시세 부족', tone: 'muted' },
};

// 분석기 버전 — 계산식을 바꿀 때마다 올리고 수정일·내용을 남긴다(예측 기록에 함께 저장)
export const ANALYZER_VERSION = '2026-10-23e';
export const ANALYZER_CHANGES = [
  { version: '2026-10-23e', date: '2026-10-23', note: 'Claude 직접 검토(2025타경4883) 반영: ① 같은 이름 다른 동 단지 실거래를 같은 단지로 쓰던 오류(대림동↔당산동6가) — 주소 괄호에서 동을 찾아 동이 같을 때만 같은 단지 ② 매각물건명세서를 못 읽은 법원 물건은 권리 점수 만점 불가(25→10), 3회 이상 유찰이거나 주변 전세가가 가치의 90% 이상이면 \'권리 확인 후 판단\' ③ 명세서의 인수 보증금이 있으면 전액 인수 전제로 바닥 가치 계산 ④ 수집기 3판(명세서 PDF 읽기) 물건을 초기 수집분으로 오인하지 않음' },
  { version: '2026-10-23d', date: '2026-10-23', note: '성적표 보정: ① 유찰 상한 — 같은 단지 실거래(A·B)가 없으면 판단 가치가 직전 회차 유찰가(아무도 안 산 값)를 넘지 않게, 2회 이상 유찰이면 지금 최저가와 직전 유찰가의 가운데로 ② 감정가 하나뿐인 물건은 감정가 대신 경매 시장가(감정가 × 낙찰가율) ③ 토지는 같은 단지 실거래가 없으면 \'지금 매력·유찰 대기\' 대신 \'권리 확인 후 판단\'(물건별 검토 대상) — 상가 적중률 34%·낙찰가÷우리 가치 60%, 대지 오차 F 대응' },
  { version: '2026-10-23c', date: '2026-10-23', note: '지분비율 미반영 수정(비율 미확인이면 금액 계산 안 함) · 감정가 없는 물건 확실성 최대 C · 계산 이상(수익률 1,000% 초과·바닥가치 최저가 100배 초과) 경고 · 임야·농지 지분 공유자 매도 가능성 낮춤 · 정비구역 목록 연계·권리산정기준일 판정' },
];

export const SOURCE_LABEL = { court: '법원경매', public: '공매', bankrupt: '파산자산', onbid: '공매' };

const FARM = /(^|\s)(전|답|과수원)(\s|$)|농지|전답/;

export function tradeTypeOf(item) {
  const s = `${item.usage || ''} ${item.usageSmall || ''} ${item.title || ''} ${item.detail?.landCategory || ''} ${item.land?.jimok || ''}`;
  if (/오피스텔/.test(s)) return 'offi';
  if (/아파트/.test(s)) return 'apt';
  if (/다세대|연립|빌라|도시형/.test(s)) return 'rh';
  if (/공장|창고/.test(s)) return 'indu';
  if (/(상가|근린|점포|판매|업무시설|사무|숙박)/.test(s) && !/주택/.test(s)) return 'nrg';
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

function quantile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const i = (a.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}

// ── 올수리 후 매도 시나리오(빌라·아파트·단독) ───────────────────────────
// 수리 후 가격 = 같은 동(또는 시군구)·비슷한 면적 거래의 ㎡당 상위 25% 가격(수리된 집 수준).
// 다만 10년 이내 지은 집 거래가 3건 이상이면 그 중앙값을 넘지 않게(올수리해도 신축보다 비싸지 않음).
// 수리비 = 전용면적(평) × 평당 올수리 비용(관리자 설정, 기본 120만 원).
export function renovation(item, deals, settings, market) {
  const type = tradeTypeOf(item);
  if (!['rh', 'apt', 'sh'].includes(type) || !item.buildingArea || !market?.value) return null;
  const year = new Date().getFullYear();
  if (item.buildYear && year - item.buildYear < 10) return null; // 새 집은 대상 아님
  if (item.ledger?.age !== undefined && item.ledger?.age !== null && item.ledger.age < 10) return null; // 건축물대장 사용승인 10년 미만
  const area = item.buildingArea;
  let pool = (deals || []).filter((d) => d[0] && d[1] && !d[7] && d[8] !== '직거래');
  const sameDong = pool.filter((d) => item.emd && d[9] === item.emd);
  if (sameDong.length >= 5) pool = sameDong;
  const near = pool.filter((d) => d[1] >= area * 0.8 && d[1] <= area * 1.2);
  if (near.length >= 3) pool = near;
  if (pool.length < 5) return null;
  const units = pool.map((d) => d[0] / d[1]);
  let unit = quantile(units, settings?.renoQuantile ?? 0.75);
  let basis = `${sameDong.length >= 5 ? '같은 동' : '같은 시군구'} 비슷한 면적 거래 ${pool.length}건의 ㎡당 상위 ${Math.round((1 - (settings?.renoQuantile ?? 0.75)) * 100)}%`;
  const newer = pool.filter((d) => d[6] && year - Number(d[6]) <= 10);
  if (newer.length >= 3) {
    const cap = median(newer.map((d) => d[0] / d[1]));
    if (cap < unit) { unit = cap; basis += ` — 10년 이내 신축 ${newer.length}건 중앙값으로 상한`; }
  }
  const after = Math.round(unit * area);
  const perPyeong = settings?.renoPerPyeong ?? 1200000;
  const cost = Math.round((area / 3.3058) * perPyeong);
  const uplift = after - market.value;
  return { after, cost, uplift, months: settings?.renoMonths ?? 5, basis, perPyeong, area, worth: uplift > cost * 1.3 };
}

// 물건의 읍면동: 수집값 → 주소 괄호 '(대림동, 단지명)' → 주소 낱말 순서로 찾는다
export function emdOf(item, label) {
  if (item.emd) return item.emd;
  const t = `${item.parcelAddress || ''} ${label || `${item.title || ''} ${item.address || ''} ${item.detail?.addressFull || ''}`}`;
  const m = t.match(/\(\s*([가-힣0-9]+(?:동|가|읍|면|리))\s*[,)]/) || t.match(/(?:^|\s)([가-힣]+[0-9]*(?:동|가)[0-9]*가?)(?=\s|$|,)/);
  return m ? m[1] : undefined;
}

// deals: 압축 거래 [가격, 면적, 층, 일, 지번, 이름, 건축년도, 해제, 거래유형, 읍면동, 추가]
export function marketEstimate(item, deals, { excludeDirect = true } = {}) {
  const type = tradeTypeOf(item);
  const area = type === 'land' ? item.landArea : item.buildingArea || item.landArea;
  if (!area || !deals || !deals.length) return { type, area, value: null, count: 0, basis: '시세 자료 없음' };
  let pool = deals.filter((d) => d[0] && d[1] && !d[7] && !(excludeDirect && d[8] === '직거래'));
  const q = (arr) => { const u = arr.map((d) => d[0] / d[1]).sort((x, y) => x - y); const at = (r) => u[Math.min(u.length - 1, Math.max(0, Math.round((u.length - 1) * r)))]; return { p25: at(0.25), p75: at(0.75) }; };
  // 같은 단지(거래 이름이 물건 이름·주소에 들어 있음): 같은 평형(±10%) 있으면 A, 단지 거래 2건 이상이면 B
  if (type !== 'land') {
    const label = `${item.title || ''} ${item.address || ''} ${item.detail?.addressFull || ''} ${item.parcelAddress || ''}`;
    const GENERIC = /^(단독|다가구|다중|연립|다세대|아파트|오피스텔|주택|빌라|상가|근린|공동주택)$/;
    // 같은 이름의 다른 단지(예: 대림동 유탑유블레스 ↔ 당산동6가 유탑유블레스)를 막는다: 동이 같아야 같은 단지
    const emd = emdOf(item, label);
    const sameDongOk = (d) => (d[9] ? (emd ? d[9] === emd : label.includes(String(d[9]))) : false);
    const same = pool.filter((d) => d[5] && String(d[5]).length >= 2 && !GENERIC.test(String(d[5])) && sameDongOk(d) && label.includes(String(d[5])));
    const sameArea = same.filter((d) => d[1] >= area * 0.9 && d[1] <= area * 1.1);
    const pick = sameArea.length ? { arr: sameArea, grade: 'A', scope: `같은 단지(${sameArea[0][5]})·같은 평형` } : same.length >= 2 ? { arr: same, grade: 'B', scope: `같은 단지(${same[0][5]})·다른 평형 포함` } : null;
    if (pick) {
      const unit = median(pick.arr.map((d) => d[0] / d[1])); const r = q(pick.arr);
      return { type, area, unit, value: Math.round(unit * area), low: Math.round(r.p25 * area), high: Math.round(r.p75 * area), count: pick.arr.length, grade: pick.grade, basis: `${pick.scope} 실거래 ${pick.arr.length}건 ㎡당 중앙값`, samples: pick.arr.slice(0, 12) };
    }
  }
  let jimokNote = '';
  if (type === 'land') {
    const jm = String(item.land?.jimok || item.detail?.landCategory || '').replace(/\s/g, '');
    const key = { 대: '대', 대지: '대', 전: '전', 답: '답', 임야: '임야', 잡종지: '잡종지', 과수원: '과수원', 공장용지: '공장용지', 도로: '도로' }[jm] || null;
    const sameJ = key ? pool.filter((d) => String(d[10] || '').replace(/\s/g, '') === key) : [];
    if (sameJ.length >= 3) { pool = sameJ; jimokNote = ` · 지목 ${key}만`; }
  }
  const sameDong = pool.filter((d) => item.emd && d[9] === item.emd);
  let scope = '같은 시군구';
  if (sameDong.length >= 5) { pool = sameDong; scope = `같은 동(${item.emd})`; }
  if (type !== 'land') {
    // 비슷한 면적(±20%) 거래가 3건 미만이면 큰·작은 평형 가격을 끌어다 쓰지 않고 '시세 부족'
    const near = pool.filter((d) => d[1] >= area * 0.8 && d[1] <= area * 1.2);
    if (near.length < 3) return { type, area, value: null, count: near.length, basis: `비슷한 면적(${Math.round(area)}㎡ ±20%) 거래가 ${near.length}건뿐 — 시세 부족` };
    pool = near;
  }
  if (!pool.length) return { type, area, value: null, count: 0, basis: '조건에 맞는 거래 없음' };
  const unit = median(pool.map((d) => d[0] / d[1])); const r = q(pool);
  return {
    type, area, unit, value: Math.round(unit * area), low: Math.round(r.p25 * area), high: Math.round(r.p75 * area), count: pool.length, grade: scope.startsWith('같은 동') ? 'C' : 'D',
    basis: `${scope}${jimokNote} 실거래 ${pool.length}건 ㎡당 중앙값 (해제${excludeDirect ? '·직거래' : ''} 제외)`,
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

// 직전 회차 유찰가: 이 값에는 공개 입찰에서 아무도 안 샀다(시장이 확인한 상한). 모르면 null
export function lastFailedPrice(item, settings) {
  if (!item.minBid) return null;
  const known = typeof item.failCount === 'number';
  const failed = known ? item.failCount >= 1 : Boolean(item.appraisal && item.minBid / item.appraisal <= 0.9);
  if (!failed) return null;
  if (item.source === 'court') {
    const { rate } = courtRate(item, settings);
    return Math.round(item.minBid / (1 - rate));
  }
  const prev = item.bidInfo?.prevMinBid;
  if (prev && prev > item.minBid && /유찰/.test(item.bidInfo?.prevResult || '유찰')) return prev;
  const first = item.firstPrice || item.appraisal;
  if (!first) return null;
  return Math.round(Math.min(first, item.minBid + first * 0.1));
}

export function costEstimate(item, value, settings) {
  const type = tradeTypeOf(item);
  // 명의(법인/개인)·공시가격·정비구역에 따라 취득세율을 정한다(매수상한 계산에도 반영)
  const kind = propertyKind(item, type, isFarmland(item));
  const taxRate = acquisitionTax(item, { price: value, kind, settings: { ...TAX_DEFAULTS, ...settings } }).rate;
  const tenants = item.detail?.flags?.tenants || 0;
  const eviction = (settings?.evictionCost ?? 3000000) * (tenants ? 1 : 0.3);
  const repair = type === 'land' ? (settings?.landRepairCost ?? 0) : (settings?.repairCost ?? 5000000);
  return { taxRate, tax: Math.round(value * taxRate), eviction: Math.round(eviction), repair, total: Math.round(value * taxRate + eviction + repair) };
}

export function hardReasons(item) {
  const r = [];
  const f = item.detail?.flags || {};
  // 법정지상권·지분·인수권리·도로 등은 버리지 않고 special.js 에서 바닥 가치·상승 시나리오로 계산한다
  if (f.qualification) r.push('매수인 자격 제한');
  if (item.manual?.hard) r.push(item.manual.hardNote || '수동 표시: 제외');
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

// 관리자 정비구역 목록에 연결된 구역(해제 제외) — 서버가 매일 물건에 붙인다(listing.redevMatch)
export function listedZone(item) {
  const z = item.redevMatch;
  return z?.status === 'listed' && z.stage !== '해제' ? z : null;
}

export function projectKind(item) {
  const t = `${item.manual?.zone?.type || ''} ${item.manual?.projectType || ''} ${item.manual?.zone?.kind || ''} ${listedZone(item)?.type || ''}`;
  if (/재건축|가로주택|소규모|자율주택/.test(t)) return 'rebuild'; // 소규모주택정비도 조합설립인가 후 기준으로 본다
  if (/재개발|촉진|도시환경|주거환경/.test(t)) return 'redevelop';
  return null;
}

export function membership(item, settings) {
  const lz = listedZone(item);
  const lzStage = lz ? stageInfo(lz.stage) : null;
  const stage = item.manual?.zone?.stage || item.manual?.redevStage || (lzStage ? lzStage.legacy : null);
  if (!stage) return { status: 'none' };
  const rank = lzStage && stage === lzStage.legacy ? lzStage.rank : STAGE_RANK[stage] ?? (/관리처분/.test(stage) ? 5 : /사업시행/.test(stage) ? 4 : /조합설립인가 후/.test(stage) ? 3 : 1);
  const overheated = isOverheated(item, settings);
  const kind = projectKind(item);
  if (item.manual?.cashOut === true) return { status: 'cash', stage, rank, overheated, kind, reason: '직접 표시: 현금청산' };
  // 권리산정기준일(도시정비법 제77조①) — 기준일 다음 날 이후 분할·집합건물 전환·분리 소유·신축이면 분양권 제한
  const r77 = lz ? rightsCheck(item, lz) : null; // 관리자가 서류로 확인한 값(manual.rights77)이 바로 반영되게 매번 다시 판정
  if (r77?.status === 'restricted') return { status: 'cash', stage, rank, overheated, kind, rights: r77, reason: `${r77.text} (${r77.law})` };
  if (r77?.status === 'risk') return { status: 'check', stage, rank, overheated, kind, rights: r77, reason: `${r77.text} (${r77.law})` };
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

// 전세 시세(같은 동/시군구·비슷한 면적, 월세 없는 계약의 ㎡당 보증금 중앙값) → 임차인 보증금이 시세에 맞는지
export function jeonseEstimate(item, rentDeals) {
  const area = item.buildingArea;
  if (!area || !rentDeals?.length) return null;
  let pool = rentDeals.filter((d) => d[0] && d[1] && !d[10]); // 월세 0 = 전세
  const same = pool.filter((d) => item.emd && d[9] === item.emd);
  if (same.length >= 5) pool = same;
  pool = pool.filter((d) => d[1] >= area * 0.8 && d[1] <= area * 1.2);
  if (pool.length < 3) return null;
  return { value: Math.round(median(pool.map((d) => d[0] / d[1])) * area), count: pool.length, basis: `${same.length >= 5 ? '같은 동' : '같은 시군구'} 비슷한 면적 전세 ${pool.length}건 ㎡당 중앙값` };
}

// 월세 시세(같은 동/시군구·비슷한 면적, 월세 있는 계약의 보증금·월세 중앙값)
export function rentEstimate(item, rentDeals) {
  const area = item.buildingArea;
  if (!area || !rentDeals?.length) return null;
  let pool = rentDeals.filter((d) => d[1] && d[10] > 0);
  const same = pool.filter((d) => item.emd && d[9] === item.emd);
  if (same.length >= 5) pool = same;
  pool = pool.filter((d) => d[1] >= area * 0.8 && d[1] <= area * 1.2);
  if (pool.length < 3) return null;
  return { deposit: Math.round(median(pool.map((d) => d[0] || 0))), monthly: Math.round(median(pool.map((d) => d[10]))), count: pool.length, basis: `${same.length >= 5 ? '같은 동' : '같은 시군구'} 비슷한 면적 월세 ${pool.length}건 중앙값` };
}

// 회전율: 같은 동(없으면 시군구) 같은 종류 최근 12개월 거래 건수 — 적으면 팔기 어려움
export function liquidityOf(item, deals) {
  const pool = (deals || []).filter((d) => d[0] && !d[7]);
  const same = pool.filter((d) => item.emd && d[9] === item.emd);
  const near = item.buildingArea ? same.filter((d) => d[1] >= item.buildingArea * 0.7 && d[1] <= item.buildingArea * 1.3) : same;
  const n = same.length;
  return { sameDong: n, similar: near.length, level: n >= 24 ? '좋음' : n >= 8 ? '보통' : '낮음', basis: `같은 동 최근 12개월 ${n}건(비슷한 면적 ${near.length}건)` };
}

export function analyze(item, { settings, deals, aptDeals, rentDeals } = {}) {
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

  const sh = shareInfo(item);
  const shareUnknown = sh.share && !sh.ratio && !cashType && !rightType;
  let value = market.value;
  let valueBasis = market.basis;
  let fromAppraisal = false;
  if (cashType) {
    value = Math.round((item.appraisal || 0) * (settings?.settlementRatio ?? 0.9));
    valueBasis = `현금청산형: 감정가 × ${Math.round((settings?.settlementRatio ?? 0.9) * 100)}% (예상 청산금)`;
  } else if (rightType) {
    value = right.value;
    valueBasis = `입주권형: 신축 ${right.area}㎡ 시세 ${Math.round(right.newPrice / 1e4).toLocaleString('ko-KR')}만 − 추가분담금 ${Math.round(right.contribution / 1e4).toLocaleString('ko-KR')}만 (비례율 ${Math.round(right.ratio * 100)}%)`;
  }
  // 토지 거래가 없으면 개별공시지가 × 면적을 대신 쓴다(보수적인 기준)
  if (!value && tradeTypeOf(item) === 'land' && item.land?.officialPrice && item.landArea && !cashType && !rightType) {
    value = Math.round(item.land.officialPrice * item.landArea);
    valueBasis = `거래 사례 부족 → 개별공시지가 ${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡ × ${Math.round(item.landArea)}㎡`;
  }
  // 특수물건은 시세가 없어도 버리지 않고 감정가를 기준으로 계산
  if (!value && item.appraisal && !cashType && !rightType && detectSpecial(item).length) {
    value = item.appraisal;
    valueBasis = '거래 사례·공시지가 없음 → 감정가 기준';
    fromAppraisal = true; // 지분 물건의 감정가는 이미 지분 값
  }
  // 지분 물건: 시세·공시지가는 필지(집) 전체 값 → 전체 가치 × 지분비율.
  // 지분비율을 원본에서 못 읽으면 금액을 계산하지 않는다('지분비율 미확인', 매력 판정 제외)
  if (shareUnknown) {
    value = null;
    valueBasis = '지분비율 미확인 — 원본(공고·등기)에서 지분(분자/분모)을 읽지 못해 금액을 계산하지 않음';
  } else if (sh.share && value && !cashType && !rightType && !fromAppraisal) {
    const f = sh.areaIsShare ? 1 : sh.ratio;
    if (f !== 1) { value = Math.round(value * f); valueBasis += ` × 지분 ${sh.num}/${sh.den}`; } else valueBasis += ' (수집 면적이 이미 지분 면적)';
  }
  // ── 오류 의심 걸러내기: 원본(감정가·공시가격)과 크게 어긋나면 계산을 믿지 않는다 ──
  const anomalies = [];
  // 법원 수집기 초기판(10/23 이전)은 앞 물건 상세가 섞였을 수 있다 → 다시 읽기 전까지 계산 보류
  if (item.source === 'court' && item.detail && !(item.detailVer >= 2)) anomalies.push('법원 상세를 앞 물건과 섞어 읽었을 수 있는 초기 수집분 — 수집기가 다시 읽는 중(주소·면적 확인 전 계산 보류)');
  // 건축물대장 교차 확인: 전유면적이 읽어 온 면적과 30% 넘게 다르면 오류 의심
  const ua = item.ledger?.unit?.exclusiveArea;
  const uaDiff = ua && item.buildingArea ? Math.abs(ua - item.buildingArea) / ua : null;
  if (uaDiff !== null && uaDiff > 0.3) anomalies.push(`건축물대장 전유면적 ${ua}㎡와 읽어 온 면적 ${item.buildingArea}㎡가 크게 다름 — 자료 확인`);
  const mixed = /,/.test(item.usage || '') || /,/.test(item.title || '') && /(상가|근린|오피스텔|아파트|다세대|주택).*,.*(상가|근린|오피스텔|아파트|다세대|주택)/.test(item.title || '');
  if (item.bulk || mixed) anomalies.push('여러 물건·용도 일괄 매각 — 시세 하나로 계산할 수 없음');
  if (value && item.appraisal && !cashType && !rightType) {
    const r = value / item.appraisal;
    if (r > 2) anomalies.push(`시세로 계산한 가치(${eok(value)})가 감정가(${eok(item.appraisal)})의 ${r.toFixed(1)}배 — 지분·일부 매각이거나 자료를 잘못 읽었을 수 있음`);
    if (r < 0.5) anomalies.push(`시세로 계산한 가치(${eok(value)})가 감정가(${eok(item.appraisal)})의 절반 미만 — 자료 확인 필요`);
  }
  const hp = item.housePrice?.matched ? item.housePrice.price : null;
  if (hp && item.appraisal && item.appraisal < hp * 0.6 && !sh.share) anomalies.push(`감정가(${eok(item.appraisal)})가 공시가격(${eok(hp)})보다 훨씬 낮음 — 지분 매각 의심`);
  if (anomalies.length) { value = null; valueBasis = '오류 의심으로 계산 보류'; }
  // 가치 검토: 실거래·감정가·공시가격·전세를 맞대어 범위와 판단용 가치(검토 과정은 화면에 그대로)
  const jeonse = jeonseEstimate(item, rentDeals);
  let val = null;
  if (!anomalies.length && !cashType && !rightType && !shareUnknown) {
    val = valuation(item, { type: tradeTypeOf(item), market, marketValue: market.value ? value : null, jeonse, settings, stats: settings?.saleRates, shareRatio: sh.share ? sh.ratio : 1, landShare: sh.share ? (sh.areaIsShare ? 1 : sh.ratio) : 1 });
    if (val.value) { value = val.value; valueBasis = val.summary; }
  }
  // 유찰 상한: 직전 회차 유찰가에 아무도 안 샀는데, 같은 단지 실거래(A·B) 없이 그보다 높게 볼 근거는 약하다
  const strongTrade = Boolean(market.value && ['A', 'B'].includes(market.grade));
  const failedPrice = lastFailedPrice(item, settings);
  let failCap = null;
  if (value && failedPrice && !strongTrade && !cashType && !rightType && !shareUnknown && !anomalies.length && value > failedPrice) {
    // 두 번 넘게 유찰: 시장 가치는 '지금 최저가 ~ 직전 유찰가' 사이로 본다(가운데 값). 한 번 유찰: 직전 유찰가가 상한
    const repeated = (item.failCount || 0) >= 2;
    const capped = repeated ? Math.round((item.minBid + failedPrice) / 2) : failedPrice;
    failCap = { before: value, price: capped, failedPrice, repeated };
    value = Math.min(value, capped);
    valueBasis = repeated
      ? `유찰 ${item.failCount}회 — 직전 회차 ${eok(failedPrice)}에도 아무도 안 삼 → 지금 최저가와의 가운데 ${eok(capped)}로 봄(같은 단지 실거래 없음) · 원래 계산 ${eok(failCap.before)} (${valueBasis})`
      : `유찰 상한 ${eok(failedPrice)} — 직전 회차 이 가격에 아무도 안 삼(같은 단지 실거래 없어 그 이상은 믿지 않음) · 원래 계산 ${eok(failCap.before)} (${valueBasis})`;
  }
  const full = value;
  const special = specialAnalysis(item, { full, settings, member, rightValue: right?.value, redev, rounds });
  if (special) {
    if (special.floorKnown) {
      value = special.floor;
      valueBasis = `바닥 가치(최악): ${special.types.map((t) => t.floorBasis).join(' × ')} — 하자 없을 때 ${eok(full)} (${valueBasis})`;
    } else {
      value = null;
      valueBasis = full ? `인수 금액을 확인해야 바닥 가치가 나옵니다 (하자 없을 때 ${eok(full)})` : '시세 자료가 없어 바닥 가치를 계산하지 못했습니다';
    }
  }
  const costs = value ? costEstimate(item, value, settings) : null;
  // 취득세는 가치가 아니라 사는 가격(상한)에 붙는다 → 상한 = (가치 × (1 − 마진) − 명도 − 수리) ÷ (1 + 취득세율)
  const cap = value ? Math.round((value * (1 - margin) - costs.eviction - costs.repair) / (1 + costs.taxRate)) : null;
  if (costs && cap) { costs.tax = Math.round(Math.max(0, cap) * costs.taxRate); costs.total = costs.tax + costs.eviction + costs.repair; }
  const entry = special?.floorKnown ? special.floorEntry : cap ? rounds.find((r) => r.price <= cap) : null;

  let verdict = 'unknown';
  if (reasons.length) verdict = 'hard';
  else if (anomalies.length) verdict = 'suspect';
  else if (shareUnknown) verdict = 'shareUnknown';
  else if (special && !special.floorKnown) verdict = full ? 'check' : 'unknown';
  // 특수물건: 마진을 따로 두지 않고 '바닥 가치 이하로 살 수 있느냐'로 판정(수익은 상승 시나리오에서)
  else if (special) verdict = !special.floorEntry ? 'hard' : special.floorEntry.step === 0 ? 'now' : 'wait';
  else if (cap !== null && cap <= 0) verdict = 'hard';
  else if (entry && entry.step === 0) verdict = 'now';
  else if (entry) verdict = 'wait';
  else if (cap !== null) verdict = 'hard';
  // 토지: 성적표상 가치 오차가 커서(대지 F) 같은 단지 수준 실거래가 없으면 자동 '매력' 판정을 하지 않고 물건별 검토로
  const landReview = tradeTypeOf(item) === 'land' && !special && !cashType && !rightType && !strongTrade && ['now', 'wait'].includes(verdict);
  if (landReview) verdict = 'check';
  // 권리(매각물건명세서)를 못 본 법원 물건: 여러 번 유찰됐으면 이유가 있다고 보고 자동 '매력' 판정을 하지 않는다
  const specRead = Boolean(item.detail?.specRead);
  const manyFails = (item.failCount || 0) >= (settings?.specCheckFails ?? 3);
  const jeonseOver = Boolean(jeonse?.value && full && jeonse.value >= full * 0.9);
  const rightsReview = item.source === 'court' && !specRead && !special && ['now', 'wait'].includes(verdict) && (manyFails || jeonseOver);
  if (rightsReview) verdict = 'check';

  const warnings = [];
  if (rightsReview) warnings.push(`매각물건명세서 미확인${manyFails ? ` + 유찰 ${item.failCount}회` : ''}${jeonseOver ? ' + 주변 전세가가 가치의 90% 이상' : ''} — 대항력 임차인 보증금 인수 등 유찰 이유를 확인하기 전에는 자동 판정하지 않음`);
  else if (item.source === 'court' && !specRead) warnings.push('매각물건명세서 미확인 — 권리(말소기준·임차인·인수 권리)는 아직 안 봄');
  if (jeonseOver) warnings.push(`주변 전세 시세(${eok(jeonse.value)})가 가치(${eok(full)})의 ${Math.round((jeonse.value / full) * 100)}% — 깡통 전세 신호: 선순위 임차인 보증금이 낙찰가를 넘으면 매수인이 인수`);
  if (landReview) warnings.push('토지 — 사이트 가치 계산의 오차가 커서 자동 판정하지 않음: 물건별 검토(Claude 검토) 후 판단');
  if (failCap) warnings.push(`유찰 상한 적용 — 가치 ${eok(failCap.before)} → ${eok(failCap.price)}${failCap.repeated ? '(지금 최저가와 직전 유찰가의 가운데)' : '(직전 회차 유찰가)'}`);
  if (farm) warnings.push(item.land?.landUse?.farmPromotion ? '농업진흥구역 농지 — 농취증·용도 제한 확인' : '농지 — 농지취득자격증명 필요');
  if (member.status === 'check') warnings.push(`분양자격 확인 필요: ${member.reason}`);
  if (member.status === 'member' && /임박/.test(member.reason || '')) warnings.push(member.reason);
  if (member.status === 'member' && member.rank >= 3 && !rightType) warnings.push('입주권형 — 구역의 비례율·조합원분양가를 넣으면 입주권 가치로 계산합니다');
  const lz = listedZone(item);
  if (lz) {
    const r77 = rightsCheck(item, lz);
    if (['pending', 'noHit'].includes(r77.status)) warnings.push(r77.text);
    if (lz.recheck) warnings.push(`정비구역 목록 '${lz.name}' 확인일이 90일 지남 — 추진현황 재확인 필요`);
    if (lz.permitZone?.yes) warnings.push(`토지거래허가구역${lz.permitZone.from || lz.permitZone.to ? `(${lz.permitZone.from || ''}~${lz.permitZone.to || ''})` : ''} — 경매는 허가 예외(국토계획법 시행령 제121조), 공매·일반 매매는 허가 대상인지 확인`);
    if (lz.actRestriction?.yes) warnings.push('행위제한 고시 구역 — 신축·분할 등 제한');
  }
  if (item.redevMatch?.status === 'unlisted') warnings.push(`브이월드 토지이용계획에 정비구역(${item.redevMatch.vworld.join(', ')}) — 관리자 정비구역 목록에 아직 없음`);
  if (member.status !== 'none') warnings.push('권리산정기준일 이후 신축·지분분할 물건이거나 한 세대가 여러 채를 가지면 분양자격이 달라질 수 있음');
  if (uaDiff !== null && uaDiff > 0.1 && uaDiff <= 0.3) warnings.push(`건축물대장 전유면적 ${item.ledger.unit.exclusiveArea}㎡ ≠ 읽어 온 면적 ${item.buildingArea}㎡`);
  if (item.ledger?.age >= 30) warnings.push(`사용승인 ${item.ledger.age}년 경과(${item.ledger.useApr}) — 노후, 수리비·누수 확인`);
  if (jeonse) {
    (item.detail?.leases || []).forEach((l) => {
      if (!l.deposit || l.rent) return;
      const r = l.deposit / jeonse.value;
      if (r > 1.3) warnings.push(`임차인 보증금 ${eok(l.deposit)} — 주변 전세(${eok(jeonse.value)})보다 ${Math.round(r * 100)}% 높음: 과다·허위 임차 의심`);
      else if (r < 0.3) warnings.push(`임차인 보증금 ${eok(l.deposit)} — 주변 전세(${eok(jeonse.value)})의 ${Math.round(r * 100)}%뿐: 가장 임차인(가족 등) 의심`);
    });
  }
  if (item.detail?.flags?.unclaimedTenants) warnings.push(`배분요구 안 한 임차인 ${item.detail.flags.unclaimedTenants}명 — 인수 여부 확인`);
  if (item.source === 'court' && !courtRate(item, settings).verified) warnings.push('이 법원 저감률은 확인 전 기본값');
  if (market.count && market.count < 5 && !cashType && !rightType) warnings.push('비교 거래가 적음 — 시세 신뢰도 낮음');

  const result = {
    verdict, market, jeonse, valuation: val, full, value, valueBasis, costs, cap, rounds, entry, reasons, warnings, special, anomalies, specRead, rightsReview,
    farm, redev, cashType, rightType, right, member, stage, failCap, landReview, excluded: isExcluded(item, settings), share: sh, shareUnknown,
    ratio: item.appraisal && item.minBid ? item.minBid / item.appraisal : null,
  };
  result.score = anomalies.length ? null : special ? special.score : scoreOf(item, result);
  result.money = moneyOf(item, result, settings);
  // 특수물건의 '지금 매력'은 최악(바닥 가치에 팔 때)에도 세금·비용 빼고 남을 때만
  if (special && result.verdict === 'now' && !(result.money?.profit > 0)) result.verdict = 'check';
  result.certainty = anomalies.length ? null : special ? specialCertainty(special) : certaintyOf(result.score);
  // 감정가가 없는 물건(파산재산 등): 확실성 최대 C, 대체 추정 근거를 카드에 보인다
  result.noAppraisal = !item.appraisal;
  if (result.noAppraisal && result.certainty) result.certainty = { ...capGrade(result.certainty, 'C'), note: '감정가 없음 — 최대 C' };
  result.estimateBasis = result.noAppraisal && full ? estimateBasisOf(item, { market, val, value: full, valueBasis }) : null;
  // 상승 시나리오가 성공했을 때의 돈 계산(지금 최저가로 샀다고 보고, 시나리오 기간만큼 보유)
  if (special?.best?.value && item.minBid) {
    result.upMoney = moneyOf(item, { ...result, value: special.best.value, verdict: 'now', costs: costEstimate(item, special.best.value, settings) }, { ...settings, holdMonths: special.best.months || 12 });
  }
  if (!result.money && result.upMoney) result.money = { ...result.upMoney, profit: null, roi: null, upside: true };

  // 올수리 후 매도
  if (!special && !reasons.length && !anomalies.length) {
    const reno = renovation(item, deals, settings, market);
    if (reno) {
      result.renovation = reno;
      const price = result.verdict === 'wait' && entry ? entry.price : item.minBid;
      if (price) {
        const c = costEstimate(item, reno.after, settings);
        result.renoMoney = moneyOf(item, { ...result, value: reno.after, verdict: 'now', costs: { ...c, repair: reno.cost } }, { ...settings, holdMonths: reno.months });
      }
    }
  }

  // 기회: 권리를 풀면(가능성 반영 기대 가치) 또는 올수리하면 지금 계산보다 돈이 더 되는 물건
  const opp = [];
  // 땅값(대지지분 가치): 빌라를 땅값 수준에 사면 손해가 적다는 실전 기준(정민 님) — 대지권 면적 × 개별공시지가 ÷ 토지 현실화율
  if (['rh', 'sh', 'apt'].includes(tradeTypeOf(item)) && item.landArea && item.land?.officialPrice) {
    const r = settings?.valuation?.realization?.land ?? 0.655;
    const v = Math.round((item.landArea * item.land.officialPrice) / r);
    result.landValue = { value: v, ratio: item.minBid ? item.minBid / v : null, basis: `대지 ${Math.round(item.landArea * 10) / 10}㎡ × 개별공시지가 ${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡ ÷ ${Math.round(r * 1000) / 10}%` };
  }
  // 물렸을 때 버틸 수 있나: 회전율 + 두 번째 출구(전세로 돌리면 묶이는 돈, 월세로 돌리면 이자 감당)
  if (['rh', 'sh', 'apt', 'offi'].includes(tradeTypeOf(item))) {
    result.liquidity = liquidityOf(item, deals);
    const base = result.renoMoney || result.money;
    if (base && !base.upside) {
      const rent = rentEstimate(item, rentDeals);
      const invested = base.price + (base.t?.acqTax || 0) + (base.other || 0); // 산 값 + 취득세 + 명도·수리
      const exit = { invested };
      if (jeonse) { exit.jeonse = jeonse.value; exit.lockedAfterJeonse = Math.max(0, invested - jeonse.value); }
      if (rent) { const interest = Math.round(base.loan * (base.rate || 0.045) / 12); exit.rent = rent; exit.monthlyInterest = interest; exit.rentCovers = rent.monthly >= interest; }
      // 전월세 자료가 하나도 없으면 판단 보류(null) — '막힘'으로 단정하지 않는다
      exit.ok = exit.jeonse === undefined && exit.rent === undefined ? null : (exit.lockedAfterJeonse !== undefined && exit.lockedAfterJeonse <= base.own) || exit.rentCovers === true;
      result.exit2 = exit;
    }
  }
  if (special?.expected && item.minBid) {
    const exp = moneyOf(item, { ...result, value: special.expected, verdict: 'now', costs: costEstimate(item, special.expected, settings) }, { ...settings, holdMonths: special.best?.months || 12 });
    if (exp?.profit > 0) opp.push({ kind: '권리 풀기', profit: exp.profit, own: exp.own, roi: exp.roi, months: exp.months, note: special.best ? `${special.best.name} (가능성 ${special.best.prob} 반영)` : '' });
  }
  if (result.renoMoney?.profit > Math.max(0, result.money?.profit || 0) + 10000000) {
    opp.push({ kind: '올수리', profit: result.renoMoney.profit, own: result.renoMoney.own, roi: result.renoMoney.roi, months: result.renoMoney.months, note: `수리비 ${eok(result.renovation.cost)} → 수리 후 ${eok(result.renovation.after)}` });
  }
  result.opportunity = opp.length ? opp.sort((x, y) => y.profit - x.profit)[0] : null;
  result.opportunities = opp;

  // 상식 검사: 이런 숫자는 계산이 틀렸을 가능성이 크다 → '계산 이상', 지금 매력·A등급·기회에서 뺀다
  const odd = sanityOf(item, result);
  if (odd.length) {
    result.calcAnomaly = odd;
    result.verdict = 'suspect';
    if (result.score) result.score = capGrade(result.score, 'B');
    if (result.certainty) result.certainty = capGrade(result.certainty, 'B');
    result.opportunity = null; result.opportunities = [];
  }
  return result;
}

// 등급 상한: A → B 처럼 grade 만 낮춘다(점수는 그대로 보여 줌)
const GRADE_ORDER = ['A', 'B', 'C'];
function capGrade(x, max) {
  if (!x?.grade || GRADE_ORDER.indexOf(x.grade) >= GRADE_ORDER.indexOf(max)) return x;
  return { ...x, grade: max, capped: true };
}

export const SANITY = { maxRoi: 10, maxValueToBid: 100 }; // 수익률 1,000%, 가치/최저가 100배

export function sanityOf(item, a) {
  const out = [];
  const bid = item.minBid || a.entry?.price;
  const rois = [['수익률', a.money?.roi], ['상승 시 수익률', a.upMoney?.roi], ['올수리 수익률', a.renoMoney?.roi], ...(a.opportunities || []).map((o) => [`기회(${o.kind}) 수익률`, o.roi])];
  const badRoi = rois.find(([, r]) => r !== null && r !== undefined && r > SANITY.maxRoi);
  if (badRoi) out.push(`${badRoi[0]} ${Math.round(badRoi[1] * 100).toLocaleString('ko-KR')}% — ${SANITY.maxRoi * 100}% 초과`);
  if (bid) {
    const vals = [['바닥가치', a.special?.floorKnown ? a.special.floor : null], ['판단 가치', a.value], ['하자 없을 때 가치', a.full], ['기대 가치', a.special?.expected]];
    const big = vals.find(([, v]) => v && v > bid * SANITY.maxValueToBid);
    if (big) out.push(`${big[0]} ${eok(big[1])}이 최저가 ${eok(bid)}의 ${Math.round(big[1] / bid).toLocaleString('ko-KR')}배 — ${SANITY.maxValueToBid}배 초과`);
  }
  return out;
}

// 감정가 없는 물건: 가치를 무엇으로 추정했는지 한 줄로
function estimateBasisOf(item, { market, val, valueBasis }) {
  const parts = [];
  const used = (k) => val?.anchors?.some((x) => x.key === k && x.used && x.value);
  if (used('official') && item.land?.officialPrice && tradeTypeOf(item) === 'land') parts.push(`공시지가 ${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡`);
  else if (used('official') && item.housePrice?.price) parts.push(`주택 공시가격 ${eok(item.housePrice.price)}`);
  if ((used('trade') || (!val && market?.value)) && market?.unit) parts.push(`실거래 ㎡당 ${Math.round(market.unit).toLocaleString('ko-KR')}원(${market.count}건)`);
  if (used('jeonse')) parts.push('전세 환산');
  if (used('asking')) parts.push('직접 확인한 호가');
  if (!parts.length && /공시지가/.test(valueBasis || '') && item.land?.officialPrice) parts.push(`공시지가 ${item.land.officialPrice.toLocaleString('ko-KR')}원/㎡`);
  return parts.length ? `추정 근거: ${parts.join(' · ')} (감정가 없음)` : `추정 근거: ${valueBasis || '—'} (감정가 없음)`;
}

// 돈 계산: 들어갈 가격(지금 최저가 또는 진입 회차 가격)으로 샀을 때
//  필요 자기자본 = 입찰가 − 대출 + 취득세 + 명도·수리비
//  예상 수익 = 예상 가치 − 입찰가 − 취득세 − 명도·수리비 − 보유기간 이자
//  수익률 = 예상 수익 ÷ 필요 자기자본
export function moneyOf(item, a, settings) {
  if (!a.value || (a.verdict === 'hard' && a.reasons?.length)) return null;
  // 가격이 안 맞는 물건도 지금 최저가로 샀을 때 얼마나 손해인지 보여 준다
  const price = a.verdict === 'wait' ? a.entry?.price : item.minBid || a.entry?.price;
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

function specialCertainty(sp) {
  if (!sp?.score) return null;
  const p = sp.score.parts;
  const v = Math.round(((p.실현가능성 + p.정보 + (sp.floorKnown ? 10 : 0)) / 40) * 100);
  return { value: v, grade: v >= 75 ? 'A' : v >= 55 ? 'B' : 'C' };
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
    // 가치 검토 신뢰도(기준 수·일치도·실거래 등급)
    pTrust = { 높음: 20, 보통: 13, 낮음: 6 }[a.valuation?.confidence] ?? 0;
  }
  pTrust = Math.min(20, pTrust);
  const f = item.detail?.flags;
  // 권리 점수는 매각물건명세서를 읽었을 때만 만점이 가능하다(읽지 못하면 '자료상 표시 없음'은 안전하다는 뜻이 아님)
  const specRead = Boolean(item.detail?.specRead) || item.source !== 'court';
  let pRights = f && specRead ? 25 : 10;
  if (f && specRead) {
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

const m2 = (v) => `${(Math.round(v * 100) / 100).toLocaleString('ko-KR')}㎡`;
export function areaText(item) {
  const sh = shareInfo(item);
  const b = item.buildingArea ? `건물 ${Math.round(item.buildingArea * 10) / 10}㎡(${Math.round(item.buildingArea / 3.3058)}평)` : '';
  let l = item.landArea ? `토지 ${Math.round(item.landArea * 10) / 10}㎡(${Math.round(item.landArea / 3.3058)}평)` : '';
  // 지분 물건: '전체 ○㎡ 중 지분 ○㎡(○/○)'
  if (sh.share) {
    const kind = sh.isLand || !item.buildingArea ? '토지' : '건물';
    const shareText = !sh.ratio ? `${kind} ${m2(sh.area || item.landArea || item.buildingArea || 0)} · 지분비율 미확인`
      : sh.totalArea ? `${kind} 전체 ${m2(sh.totalArea)} 중 지분 ${m2(sh.shareArea)}(${sh.num}/${sh.den})` : `${kind} 지분 ${sh.num}/${sh.den}(면적 미상)`;
    return kind === '토지' ? [b, shareText].filter(Boolean).join(' · ') : [shareText, l].filter(Boolean).join(' · ');
  }
  return [b, l].filter(Boolean).join(' · ');
}
