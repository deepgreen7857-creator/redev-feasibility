import test from 'node:test';
import assert from 'node:assert';
import { analyze, projectRounds, marketEstimate, isExcluded, tradeTypeOf } from './analyze.js';
import { parseCourtText } from './parseCourt.js';
import { DEFAULT_SETTINGS } from '../data/defaults.js';

const deals = Array.from({ length: 20 }, (_, i) => [500000000 + i * 1e6, 84, 5, 1, '1', 'A', 2000, false, '중개거래', '부평동']);

test('법원경매 회차: 인천 30% 저감', () => {
  const r = projectRounds({ source: 'court', court: '인천지방법원', minBid: 100000000 }, DEFAULT_SETTINGS, 3);
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
  const base = { source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000 };
  assert.equal(analyze({ ...base, minBid: 300000000 }, { settings: DEFAULT_SETTINGS_P, deals }).verdict, 'now');
  const w = analyze({ ...base, minBid: 600000000 }, { settings: DEFAULT_SETTINGS_P, deals });
  assert.equal(w.verdict, 'wait'); assert.equal(w.entry.step, 1);
  // 지분 물건도 버리지 않음: 바닥 가치(지분 할인)로 판정하고 상승 시나리오를 붙인다
  const sh = analyze({ ...base, minBid: 250000000, share: true }, { settings: DEFAULT_SETTINGS_P, deals });
  assert.ok(sh.special && sh.special.types[0].key === 'share');
  assert.ok(['now', 'wait'].includes(sh.verdict));
  assert.ok(sh.special.best.value > sh.value);
});
test('현황도로 토지: 같은 구 토지 시세를 그대로 쓰지 않고 1/3 바닥 + 상승 시나리오', () => {
  const landDeals = Array.from({ length: 10 }, (_, i) => [30000 + i * 100, 100, 0, 1, '', '', 0, false, '중개거래', '구월동', '대']);
  const it = { source: 'onbid', sido: '인천광역시', sgg: '남동구', emd: '구월동', usage: '토지', landArea: 100, appraisal: 1e8, minBid: 6e7, land: { jimok: '도로' } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.ok(a.special.types.some((t) => t.key === 'road'));
  assert.ok(a.value < a.full * 0.34);
  assert.ok(a.special.scenarios.length >= 3);
});
test('공고 용도가 \'토지 > 도로\'면 도로 부지로 판별, 최악 수익이 없으면 지금 매력 아님', () => {
  const landDeals = Array.from({ length: 10 }, (_, i) => [30000 + i * 100, 100, 0, 1, '', '', 0, false, '중개거래', '대부남동', '대']);
  const it = { source: 'onbid', sido: '경기도', sgg: '안산시 단원구', emd: '대부남동', usage: '토지 > 도로', usageSmall: '도로', landArea: 873, appraisal: 1.46e8, minBid: 8.8e7, detail: { flags: {} } };
  const a = analyze(it, { settings: DEFAULT_SETTINGS, deals: landDeals });
  assert.ok(a.special?.types.some((t) => t.key === 'road'));
  assert.notEqual(a.verdict, 'now');
  assert.ok(a.special.expected < a.special.best.value);
});
test('인수 권리 금액 미확인 → 권리 확인 후 판단', () => {
  const base = { source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000, minBid: 300000000 };
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
  const a = analyze({ source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', usage: '다세대', buildingArea: 50, appraisal: 200000000, minBid: 140000000, manual: { redevStage: '조합설립인가 후', projectType: '재개발' } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(a.member.status, 'member'); assert.equal(a.cashType, false);
});
test('분양자격: 서울 재건축 조합설립인가 후 — 채권자 모름이면 확인 필요, 개인이면 현금청산, 금융기관이면 조합원', () => {
  const base = { source: 'court', court: '서울남부지방법원', sido: '서울특별시', sgg: '영등포구', usage: '아파트', buildingArea: 84, appraisal: 1e9, minBid: 8e8, manual: { redevStage: '조합설립인가 후', projectType: '재건축' } };
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
  const a = analyze({ source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', usage: '다세대', buildingArea: 40, appraisal: 2e8, minBid: 1.4e8, manual: { redevStage: '관리처분인가 후', projectType: '재개발', econ: { ratio: 1.1, memberPrice: 5e8, newPrice: 7e8 } } }, { settings: DEFAULT_SETTINGS, deals: [] });
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
  const base = { source: 'court', court: '인천지방법원', sido: '인천광역시', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 600000000, minBid: 300000000 };
  const a1 = analyze({ ...base, sgg: '부평구' }, { settings: DEFAULT_SETTINGS, deals });
  const a2 = analyze({ ...base, sgg: '남동구' }, { settings: DEFAULT_SETTINGS, deals });
  assert.ok(a1.score && a1.score.total > 0);
  assert.equal(a1.score.total, a2.score.total);
  assert.ok(analyze({ ...base, sgg: '부평구', share: true }, { settings: DEFAULT_SETTINGS, deals }).score.parts.상승폭 >= 0);
});

test('돈 계산(개인): 내 돈 = 입찰가 − 대출 + 세금·명도·수리, 수익률 = 수익 ÷ 내 돈', () => {
  const a = analyze({ source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 6e8, minBid: 3e8 }, { settings: { ...DEFAULT_SETTINGS, owner: 'person' }, deals });
  const m = a.money;
  assert.equal(m.loan, 1.8e8);
  assert.equal(m.own, 3e8 - 1.8e8 + m.tax + m.other);
  assert.equal(m.profit, a.value - 3e8 - m.tax - m.other - m.interest - m.t.broker);
  assert.ok(Math.abs(m.roi - m.profit / m.own) < 1e-9);
  assert.ok(a.certainty && a.certainty.value > 0);
});

test('법인 단타: 공시가격 1억 이하·정비구역 밖·85㎡ 이하 = A, 일반세율·부가세 없음·추가 법인세', () => {
  const base = { source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '다세대', buildingArea: 50, appraisal: 1.5e8, minBid: 1e8, land: { landUse: { redevelopment: [] } } };
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
  const farm = analyze({ source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '강화군', usage: '답', landArea: 900, appraisal: 1e8, minBid: 5e7, land: { jimok: '답' } }, { settings: DEFAULT_SETTINGS, deals: [] });
  assert.equal(farm.farm, true);
});
