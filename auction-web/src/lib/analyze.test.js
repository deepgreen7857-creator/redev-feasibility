import test from 'node:test';
import assert from 'node:assert';
import { analyze, projectRounds, marketEstimate, isExcluded, tradeTypeOf } from './analyze.js';
import { parseCourtText } from './parseCourt.js';
import { DEFAULT_SETTINGS } from '../data/defaults.js';

const deals = Array.from({ length: 20 }, (_, i) => [500000000 + i * 1e6, 84, 5, 1, '1', 'A', 2000, false, '중개거래', '부평동']);

test('법원경매 회차: 인천 30% 저감', () => {
  const r = projectRounds({ source: 'court', detailVer: 2, court: '인천지방법원', minBid: 100000000 }, DEFAULT_SETTINGS, 3);
  assert.deepEqual(r.map((x) => x.price), [100000000, 70000000, 49000000]);
});
test('공매 회차: 최초가 10%씩, 50% 하한', () => {
  const r = projectRounds({ source: 'onbid', minBid: 60000000, firstPrice: 100000000 }, DEFAULT_SETTINGS, 4);
  assert.deepEqual(r.map((x) => x.price), [60000000, 50000000, 50000000, 50000000]);
});
test('시세 추정: 같은 동 5건 이상이면 동 기준, 해제 제외', () => {
  const m = marketEstimate({ emd: '부평동', buildingArea: 84, usage: '아파트' }, [...deals, [9e9, 84, 1, 1, '', '', 0, true, '중개거래', '부평동']]);
  assert.equal(m.count, 20);
  assert.ok(m.value > 500000000 && m.value < 530000000);
});
test('판정: 지금 매력 / 유찰 대기 / 해결 안 됨 (개인 기준)', () => {
  const DEFAULT_SETTINGS_P = { ...DEFAULT_SETTINGS, owner: 'person' };
  const base = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000 };
  assert.equal(analyze({ ...base, minBid: 300000000 }, { settings: DEFAULT_SETTINGS_P, deals }).verdict, 'now');
  const w = analyze({ ...base, minBid: 600000000 }, { settings: DEFAULT_SETTINGS_P, deals });
  assert.equal(w.verdict, 'wait'); assert.equal(w.entry.step, 1);
  // 지분 물건도 버리지 않음: 지분비율을 읽으면 바닥 가치(지분 할인)로 판정하고 상승 시나리오를 붙인다
  const sh = analyze({ ...base, minBid: 120000000, appraisal: 300000000, share: true, detail: { shareText: '2분의 1 지분 매각' } }, { settings: DEFAULT_SETTINGS_P, deals });
  assert.ok(sh.special && sh.special.types[0].key === 'share');
  assert.ok(['now', 'wait'].includes(sh.verdict));
  assert.ok(sh.special.best.value > sh.value);
  assert.ok(sh.full < 300000000); // 전체 가치(약 5억) × 1/2
  // 지분비율을 못 읽으면 금액 계산 안 함
  const un = analyze({ ...base, minBid: 250000000, share: true }, { settings: DEFAULT_SETTINGS_P, deals });
  assert.equal(un.verdict, 'shareUnknown'); assert.equal(un.value, null); assert.equal(un.money, null);
});
test('현황도로 토지: 같은 구 토지 시세를 그대로 쓰지 않고 1/3 바닥 + 상승 시나리오', () => {
  const landDeals = Array.from({ length: 10 }, (_, i) => [30000000 + i * 100000, 100, 0, 1, '', '', 0, false, '중개거래', '구월동', '대']);
  const it = { source: 'onbid', sido: '인천광역시', sgg: '남동구', emd: '구월동', usage: '토지', landArea: 100, appraisal: 4e7, minBid: 1e7, land: { jimok: '도로' } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.ok(a.special.types.some((t) => t.key === 'road'));
  assert.ok(a.value < a.full * 0.34);
  assert.ok(a.special.scenarios.length >= 3);
});
test('공고 용도가 \'토지 > 도로\'면 도로 부지로 판별, 최악 수익이 없으면 지금 매력 아님', () => {
  const landDeals = Array.from({ length: 10 }, (_, i) => [30000000 + i * 100000, 100, 0, 1, '', '', 0, false, '중개거래', '대부남동', '대']);
  const it = { source: 'onbid', sido: '경기도', sgg: '안산시 단원구', emd: '대부남동', usage: '토지 > 도로', usageSmall: '도로', landArea: 873, appraisal: 1.46e8, minBid: 8.8e7, detail: { flags: {} } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.ok(a.special?.types.some((t) => t.key === 'road'));
  assert.notEqual(a.verdict, 'now');
  assert.ok(a.special.expected < a.special.best.value);
});
test('인수 권리 금액 미확인 → 권리 확인 후 판단', () => {
  const base = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000, minBid: 300000000 };
  const a = analyze({ ...base, detail: { flags: { survivingRights: true }, survivingRights: '선순위 가처분' } }, { settings: DEFAULT_SETTINGS, deals });
  assert.equal(a.verdict, 'check');
  assert.ok(a.upMoney);
});
test('관심 제외: 미추홀구 정비구역 물건(조회 전 포함), 부평은 제외 안 함', () => {
  assert.equal(isExcluded({ sido: '인천광역시', sgg: '미추홀구' }, DEFAULT_SETTINGS), true);
  assert.equal(isExcluded({ sido: '인천광역시', sgg: '미추홀구', land: { landUse: { redevelopment: [] } } }, DEFAULT_SETTINGS), false);
  assert.equal(isExcluded({ sido: '인천광역시', sgg: '부평구' }, DEFAULT_SETTINGS), false);
});
test('분양자격: 비투기과열(인천)은 조합설립인가 후에도 조합원 → 현금청산 아님', () => {
  const a = analyze({ source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', usage: '다세대', buildingArea: 50, appraisal: 200000000, minBid: 140000000, manual: { redevStage: '조합설립인가 후', projectType: '재개발' } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.member.status, 'member'); assert.equal(a.cashType, false);
});
test('분양자격: 서울 재건축 조합설립인가 후 — 채권자 모름이면 확인 필요, 개인이면 현금청산, 금융기관이면 조합원', () => {
  const base = { source: 'court', detailVer: 2, court: '서울남부지방법원', sido: '서울특별시', sgg: '영등포구', usage: '아파트', buildingArea: 84, appraisal: 1e9, minBid: 8e8, manual: { redevStage: '조합설립인가 후', projectType: '재건축' } };
  assert.equal(analyze(base, { settings: DEFAULT_SETTINGS }).member.status, 'check');
  const c = analyze({ ...base, manual: { ...base.manual, creditor: 'other' } }, { settings: DEFAULT_SETTINGS });
  assert.equal(c.cashType, true); assert.equal(c.value, 9e8);
  assert.equal(analyze({ ...base, manual: { ...base.manual, creditor: 'public' } }, { settings: DEFAULT_SETTINGS }).member.status, 'member');
});
test('분양자격: 서울 재개발은 관리처분인가 전이면 조합원 가능', () => {
  const m = analyze({ source: 'court', sido: '서울특별시', sgg: '성북구', appraisal: 5e8, minBid: 4e8, manual: { redevStage: '사업시행인가 후', projectType: '재개발' } }, { settings: DEFAULT_SETTINGS }).member;
  assert.equal(m.status, 'member');
});
test('분양자격: 온비드 압류재산 공매는 예외(체납) → 조합원', () => {
  const m = analyze({ source: 'onbid', propertyType: '0007', sido: '경기도', sgg: '성남시 분당구', appraisal: 5e8, minBid: 4e8, manual: { redevStage: '관리처분인가 후', projectType: '재건축' } }, { settings: DEFAULT_SETTINGS }).member;
  assert.equal(m.overheated, true); assert.equal(m.status, 'member');
});
test('입주권 가치: 신축 시세 − (조합원분양가 − 감정가×비례율)', () => {
  const a = analyze({ source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', usage: '다세대', buildingArea: 40, appraisal: 2e8, minBid: 1.4e8, manual: { redevStage: '관리처분인가 후', projectType: '재개발', econ: { ratio: 1.1, memberPrice: 5e8, newPrice: 7e8 } } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.right.rightPrice, 2.2e8); assert.equal(a.right.contribution, 2.8e8); assert.equal(a.value, 4.2e8); assert.equal(a.rightType, true);
});
test('용도 → 실거래 종류', () => {
  assert.equal(tradeTypeOf({ usage: '부동산 > 토지 > 답' }), 'land');
  assert.equal(tradeTypeOf({ usage: '다세대' }), 'rh');
});
test('법원경매 붙여넣기 해석', () => {
  const t = '인천지방법원 2026 타경 10234\n소재지 인천광역시 부평구 십정동 123-4 ○○빌라 3층\n감정가 230,000,000원 최저가 161,000,000원 유찰 1회\n매각기일 2026.11.05\n전용 52.3㎡ 대지권 21.4㎡';
  const r = parseCourtText(t);
  assert.equal(r.caseNo, '2026타경10234'); assert.equal(r.appraisal, 230000000); assert.equal(r.minBid, 161000000);
  assert.equal(r.sgg, '부평구'); assert.equal(r.emd, '십정동'); assert.equal(r.bidEnd, '2026-11-05'); assert.equal(r.buildingArea, 52.3);
});

test('매력도: 지금 매력 물건에 점수, 지역 가산 없음', () => {
  const base = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000, minBid: 300000000 };
  const a1 = analyze({ ...base, sgg: '부평구' }, { settings: DEFAULT_SETTINGS, deals });
  const a2 = analyze({ ...base, sgg: '남동구' }, { settings: DEFAULT_SETTINGS, deals });
  assert.ok(a1.score && a1.score.total > 0);
  assert.equal(a1.score.total, a2.score.total);
  assert.ok(analyze({ ...base, sgg: '부평구', share: true }, { settings: DEFAULT_SETTINGS, deals }).score.parts.상승폭 >= 0);
});

test('돈 계산(개인): 내 돈 = 입찰가 − 대출 + 세금·명도·수리, 수익률 = 수익 ÷ 내 돈', () => {
  const a = analyze({ source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 6e8, minBid: 3e8 }, { settings: { ...DEFAULT_SETTINGS, owner: 'person' }, deals });
  const m = a.money;
  assert.equal(m.loan, 1.8e8);
  assert.equal(m.own, 3e8 - 1.8e8 + m.tax + m.other);
  assert.equal(m.profit, a.value - 3e8 - m.tax - m.other - m.interest - m.t.broker);
  assert.ok(Math.abs(m.roi - m.profit / m.own) < 1e-9);
  assert.ok(a.certainty && a.certainty.value > 0);
});

test('법인 단타: 공시가격 1억 이하·정비구역 밖·85㎡ 이하 = A, 일반세율·부가세 없음·추가 법인세', () => {
  const base = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '다세대', buildingArea: 50, appraisal: 1.5e8, minBid: 1e8, land: { landUse: { redevelopment: [] } } };
  const d = Array.from({ length: 20 }, () => [1.6e8, 50, 2, 1, '1', 'v', 2000, false, '중개거래', '부평동']);
  const a = analyze({ ...base, housePrice: { kind: '공동주택', price: 7e7 } }, { settings: DEFAULT_SETTINGS, deals: d });
  assert.equal(a.money.fit.grade, 'A');
  assert.ok(a.money.t.acq.rate < 0.02);
  assert.equal(a.money.t.vat, 0);
  assert.ok(a.money.t.surcharge > 0);
  assert.equal(a.money.profit, a.money.preTax - a.money.t.incomeTax - a.money.t.surcharge);
  const z = analyze({ ...base, housePrice: { price: 7e7 }, manual: { redevStage: '구역지정' } }, { settings: DEFAULT_SETTINGS, deals: d });
  assert.equal(z.money ? z.money.t.acq.rate : 0.124, 0.124);
  const u = analyze(base, { settings: DEFAULT_SETTINGS, deals: d });
  assert.equal(u.money.fit.grade, '?');
});
test('법인: 농지는 X, 상가는 B(부가세)', () => {
  const t = (await_ => 0);
  const farm = analyze({ source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '강화군', usage: '답', landArea: 900, appraisal: 1e8, minBid: 5e7, land: { jimok: '답' } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(farm.farm, true);
});

test('올수리 후 매도: 같은 동 비슷한 면적 상위 25% 가격, 수리비는 평당 단가', () => {
  const vd = Array.from({ length: 12 }, (_, i) => [150000000 + i * 10000000, 50, 2, 1, '1', 'B', 1995, false, '중개거래', '십정동']);
  const it = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '십정동', usage: '다세대', buildingArea: 50, appraisal: 2e8, minBid: 1.4e8, detail: { flags: {} } };
  const a = analyze(it, { settings: { ...DEFAULT_SETTINGS, owner: 'person' }, deals: vd });
  assert.ok(a.renovation);
  assert.ok(a.renovation.after > a.market.value);
  assert.equal(a.renovation.cost, Math.round((50 / 3.3058) * 1200000));
  assert.ok(a.renoMoney && a.renoMoney.months === 5);
});

test('오류 의심: 시세 가치가 감정가의 2배를 넘으면 계산 보류, 지분이면 비율을 곱함', () => {
  const big = Array.from({ length: 10 }, (_, i) => [3e9 + i * 1e7, 138, 30, 1, '40', 'G', 2005, false, '중개거래', '잠실동']);
  const base = { source: 'court', detailVer: 2, court: '서울중앙지방법원', sido: '서울특별시', sgg: '송파구', emd: '잠실동', usage: '아파트', buildingArea: 138.6, appraisal: 3.97e8, minBid: 3.176e8 };
  const a = analyze(base, { settings: DEFAULT_SETTINGS, deals: big });
  assert.equal(a.verdict, 'suspect');
  assert.equal(a.money, null);
  assert.equal(a.opportunity, null);
  const s = analyze({ ...base, share: true, detail: { shareText: '10분의 1 지분 매각', flags: {} } }, { settings: DEFAULT_SETTINGS, deals: big });
  assert.notEqual(s.verdict, 'suspect');
  assert.ok(s.full < 4e8);
});
test('비슷한 면적 거래가 3건 미만이면 시세 부족', () => {
  const d = Array.from({ length: 10 }, (_, i) => [3e8 + i * 1e6, 40, 3, 1, '1', 'O', 2015, false, '중개거래', '봉천동']);
  const m = marketEstimate({ emd: '봉천동', buildingArea: 13.2, usage: '오피스텔' }, d);
  assert.equal(m.value, null);
});

test('점검 수정: 없다고 쓴 글은 특수 사정 아님, 일반 이름은 같은 단지 아님, 토지는 같은 지목, 취득세는 사는 가격에', async () => {
  const { detectSpecial } = await import('./special.js');
  assert.equal(detectSpecial({ detail: { cautions: '유치권 신고 없음. 분묘 해당 없음. 매수인이 인수할 권리 없음' } }).length, 0);
  assert.ok(detectSpecial({ detail: { cautions: '유치권 신고 있음(공사대금 3천만 원)' } }).some((x) => x.key === 'lien'));
  const shDeals = Array.from({ length: 8 }, (_, i) => [3e8 + i * 1e7, 100, 1, 1, '1', '단독', 1990, false, '중개거래', '용현동']);
  const m = marketEstimate({ title: '용현동 단독주택', usage: '단독주택', emd: '용현동', buildingArea: 100 }, shDeals);
  assert.notEqual(m.grade, 'B'); assert.notEqual(m.grade, 'A');
  const landDeals = [...Array.from({ length: 5 }, () => [1e8, 100, 0, 1, '', '', 0, false, '중개거래', '구월동', '대']), ...Array.from({ length: 5 }, () => [1e7, 100, 0, 1, '', '', 0, false, '중개거래', '구월동', '전'])];
  const lm = marketEstimate({ usage: '토지', emd: '구월동', landArea: 100, land: { jimok: '전' } }, landDeals);
  assert.equal(lm.value, 1e7);
  const base = { source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 5.1e8, minBid: 3e8 };
  const a = analyze(base, { settings: { ...DEFAULT_SETTINGS, owner: 'person' }, deals });
  assert.equal(a.costs.tax, Math.round(a.cap * a.costs.taxRate));
  assert.ok(Math.abs(a.cap * (1 + a.costs.taxRate) + a.costs.eviction + a.costs.repair - a.value * 0.9) < 5);
});

// ── 2026-10-23c: 지분·감정가 없음·상식 검사·공유자 매도 ─────────────────
import { shareInfo } from './special.js';
import { areaText, sanityOf } from './analyze.js';
const landDeals = Array.from({ length: 12 }, (_, i) => [400000000 + i * 1e6, 1000, 0, 1, '', '', 0, false, '중개거래', '포곡읍', '임야']);
const sam = { source: 'onbid', category: 'bankrupt', sido: '경기도', sgg: '용인시 처인구', emd: '포곡읍', title: '경기도 용인시 처인구 포곡읍 삼계리 산 56 임야', usage: '부동산 > 토지 > 임야', usageSmall: '임야', landArea: 36364, appraisal: null, minBid: 5000000, share: true, detail: { flags: {} } };

test('2012358 유형: 임야 지분, 비율 미확인 → 금액 계산 안 함(95억·154,336% 같은 값이 나오지 않음)', () => {
  const a = analyze(sam, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.equal(a.verdict, 'shareUnknown');
  assert.equal(a.value, null); assert.equal(a.money, null); assert.equal(a.upMoney, undefined);
  assert.equal(a.opportunity, null);
  assert.match(areaText(sam), /지분비율 미확인/);
});
test('임야 지분, 비율을 읽으면 전체 가치 × 지분비율, 면적 "전체 ○㎡ 중 지분 ○㎡(○/○)"', () => {
  const it = { ...sam, detail: { flags: {}, areas: [{ kind: '토지>임야', area: '36364', share: '1/40' }] } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  const unit = 405500; // 실거래 ㎡당 중앙값(약 40.6만)
  assert.ok(Math.abs(a.full - unit * 36364 / 40) / a.full < 0.05, `full ${a.full}`);
  assert.equal(areaText(it), '토지 전체 36,364㎡ 중 지분 909.1㎡(1/40)');
  // 감정가 없음 → 확실성 최대 C, 추정 근거 표시
  if (a.certainty) assert.equal(a.certainty.grade, 'C');
  assert.match(a.estimateBasis, /추정 근거: .*실거래 ㎡당/);
  // 임야 지분: 다른 공유자에게 매도 가능성 기본 '낮음'
  const sc = a.special.scenarios.find((x) => x.name === '다른 공유자에게 매도');
  assert.equal(sc.prob, '낮음');
});
test('지분비율 모양: 3분의 1 · 1/3 · ㎡ 중 ㎡ · 대지권 비율은 지분 아님', () => {
  assert.equal(shareInfo({ source: 'court', share: true, detail: { shareText: '지분매각 공유자 우선매수 3분의 1 지분' } }).num, 1);
  assert.equal(shareInfo({ source: 'onbid', share: true, title: '임야 지분 1/3' }).den, 3);
  const r = shareInfo({ source: 'onbid', share: true, usage: '토지', landArea: 1000, detail: { cautions: '전체 1,000㎡ 중 250㎡ 지분 매각' } });
  assert.equal(r.ratio, 0.25); assert.equal(r.totalArea, 1000);
  assert.equal(shareInfo({ source: 'onbid', share: true, detail: { shareText: '대지권의 비율 1234분의 56' } }).ratio, null);
  // 법원: '적정 대지지분'만 있으면 지분 매각이 아님
  assert.equal(shareInfo({ source: 'court', share: true, detail: { conditions: '대지권 미등기, 적정대지지분 포함 일괄평가' } }).share, false);
});
test('수집 면적이 이미 지분 면적이면 다시 곱하지 않음', () => {
  const r = shareInfo({ source: 'onbid', share: true, usage: '토지 > 답', landArea: 250, land: { area: 1000 }, detail: { areas: [{ share: '1/4' }] } });
  assert.equal(r.areaIsShare, true); assert.equal(r.totalArea, 1000); assert.equal(r.shareArea, 250);
});
test('공유자 수가 많을수록 공유자 매도 가능성 낮춤', () => {
  const it = { ...sam, detail: { flags: {}, areas: [{ share: '1/40' }], conditions: '공유자 12명' } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.equal(a.special.scenarios.find((x) => x.name === '다른 공유자에게 매도').prob, '매우 낮음');
  const apt = analyze({ source: 'court', detailVer: 2, court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 3e8, minBid: 1.2e8, share: true, detail: { shareText: '지분매각 2분의 1' } }, { settings: DEFAULT_SETTINGS, deals });
  assert.equal(apt.special.scenarios.find((x) => x.name === '다른 공유자에게 매도').prob, '보통');
});
test('상식 검사: 수익률 1,000% 초과·가치가 최저가 100배 초과 → 계산 이상, 지금 매력·A등급 제외', () => {
  assert.equal(sanityOf({ minBid: 5e6 }, { value: 9.5e9 }).length, 1);
  assert.equal(sanityOf({ minBid: 5e6 }, { money: { roi: 1543 } }).length, 1);
  assert.equal(sanityOf({ minBid: 1e8 }, { value: 2e8, money: { roi: 0.3 } }).length, 0);
  // 비율을 읽었어도 숫자가 말이 안 되면 경고(예: 1/2 지분인데 최저가 500만)
  const it = { ...sam, detail: { flags: {}, areas: [{ share: '1/2' }] } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.ok(a.calcAnomaly?.length);
  assert.equal(a.verdict, 'suspect');
  assert.notEqual(a.score?.grade, 'A'); assert.equal(a.opportunity, null);
});

// 2026-10-23d 성적표 보정
test('유찰 상한: 감정가뿐인 상가가 5회 유찰이면 지금 최저가와 직전 유찰가 사이로 보고 지금 매력이 아님', async () => {
  const { analyze: an, lastFailedPrice } = await import('./analyze.js');
  const it = { source: 'onbid', category: 'public', title: '경기도 수원시 영통구 이의동 1-1, 126호 근린생활시설', usage: '상가용및업무용건물 > 근린생활시설', sido: '경기도', sgg: '수원시 영통구', appraisal: 656900000, minBid: 348150000, failCount: 5, buildingArea: 50.6, landArea: 8.4, bidEnd: '2099-01-01 10:00' };
  const fp = lastFailedPrice(it, {});
  assert.equal(fp, 348150000 + 65690000);
  const a = an(it, { settings: {}, deals: [] });
  assert.ok(a.value <= Math.round((it.minBid + fp) / 2));
  assert.notEqual(a.verdict, 'now');
});
test('토지: 같은 단지 수준 실거래가 없으면 권리 확인 후 판단(물건별 검토)', async () => {
  const { analyze: an } = await import('./analyze.js');
  const it = { source: 'court', title: '대지', usage: '대지', sido: '경기도', sgg: '화성시', appraisal: 100000000, minBid: 49000000, failCount: 2, landArea: 300, bidEnd: '2099-01-01' };
  const a = an(it, { settings: {}, deals: [] });
  assert.equal(a.verdict, 'check');
  assert.ok(a.landReview);
});
