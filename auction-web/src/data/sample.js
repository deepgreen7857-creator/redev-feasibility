// 데모 모드용 샘플(가상) 데이터 — 실제 물건·사람과 무관합니다.
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

function makeDeals(seed, n, { unit, area, spread = 0.12, dong, name, floorMax = 20, extra = null }) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const a = Math.round(area * (0.85 + r() * 0.3) * 100) / 100;
    const price = Math.round((unit * a * (1 - spread + r() * spread * 2)) / 1e6) * 1e6;
    const cancelled = r() < 0.04;
    const direct = r() < 0.12;
    return [price, a, floorMax ? 1 + Math.floor(r() * floorMax) : null, 1 + Math.floor(r() * 27), `${100 + i}`, name, 1995 + Math.floor(r() * 25), cancelled, direct ? '직거래' : '중개거래', dong, extra];
  });
}

const ym = (back) => { const d = new Date(); d.setMonth(d.getMonth() - back); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`; };

export const SAMPLE_TRADES = {};
function put(type, lawd, months, gen) { for (let m = 0; m < months; m++) SAMPLE_TRADES[`${type}_${lawd}_${ym(m)}`] = gen(m); }
put('apt', '28237', 12, (m) => makeDeals(100 + m, 30, { unit: 5600000, area: 84, dong: '부평동', name: '샘플아파트' }));
put('rh', '28237', 12, (m) => makeDeals(200 + m, 25, { unit: 3900000, area: 52, dong: '십정동', name: '샘플빌라', floorMax: 5 }));
put('rh', '28245', 12, (m) => makeDeals(300 + m, 20, { unit: 3500000, area: 48, dong: '작전동', name: '샘플빌라', floorMax: 5 }));
put('land', '28710', 12, (m) => makeDeals(400 + m, 15, { unit: 160000, area: 990, dong: '선원면', name: '농지', floorMax: 0, extra: '답' }));
put('apt', '41285', 12, (m) => makeDeals(500 + m, 30, { unit: 6200000, area: 84, dong: '백석동', name: '샘플아파트' }));
put('sh', '28177', 12, (m) => makeDeals(600 + m, 10, { unit: 2400000, area: 120, dong: '용현동', name: '단독', floorMax: 0, extra: 140 }));

const D = (days) => { const d = new Date(Date.now() + days * 86400e3); return `${d.toISOString().slice(0, 10)} 17:00`; };

export const SAMPLE_LISTINGS = [
  {
    id: 'demo-1', source: 'onbid', category: 'public', caseNo: '2026-0091-001', court: '한국자산관리공사', title: '[샘플] 부평동 아파트 84㎡',
    propertyTypeName: '압류재산', usage: '부동산 > 주거용건물 > 아파트', address: '인천광역시 부평구 부평동 ○○아파트', sido: '인천광역시', sgg: '부평구', emd: '부평동',
    appraisal: 520000000, minBid: 364000000, firstPrice: 520000000, failCount: 3, round: '4', bidEnd: D(9), status: '입찰진행중', statusCode: '0002',
    buildingArea: 84.9, landArea: 38.2, pnu: '2823710100100010000', housePrice: { kind: '공동주택', year: 2026, price: 312000000 },
    detail: { flags: { superficies: false, survivingRights: false, tenants: 0, unclaimedTenants: 0 }, deliveryDuty: '매수인 부담', cautions: '관리비 체납 확인 필요' },
    land: { landUse: { zone: '제2종일반주거지역', redevelopment: [], farmPromotion: false, greenbelt: false, roadConflict: [] }, officialPrice: 3150000 },
  },
  {
    id: 'demo-2', source: 'court', category: 'court', caseNo: '2026타경10234', court: '인천지방법원', title: '[샘플] 십정동 다세대 52㎡',
    usage: '다세대', address: '인천광역시 부평구 십정동 ○○빌라 3층', sido: '인천광역시', sgg: '부평구', emd: '십정동',
    appraisal: 230000000, minBid: 161000000, failCount: 1, round: '2', bidEnd: D(14), status: '진행', buildingArea: 52.3, landArea: 21.4,
    detail: { flags: { tenants: 1, unclaimedTenants: 0 } }, housePrice: { kind: '공동주택', year: 2026, price: 98000000 },
    land: { landUse: { zone: '제2종일반주거지역', redevelopment: ['정비예정구역'], roadConflict: [] }, officialPrice: 2100000 },
    manual: { redevStage: '추진위원회 승인' },
  },
  {
    id: 'demo-3', source: 'onbid', category: 'bankrupt', caseNo: '2026-1500-003', court: '파산관재인(샘플)', title: '[샘플] 파산재단 작전동 다세대 2세대 일괄',
    propertyTypeName: '파산자산', usage: '부동산 > 주거용건물 > 다세대', address: '인천광역시 계양구 작전동 ○○빌라', sido: '인천광역시', sgg: '계양구', emd: '작전동',
    appraisal: 360000000, minBid: 288000000, firstPrice: 360000000, failCount: 2, round: '3', bidEnd: D(6), status: '입찰진행중', statusCode: '0002',
    buildingArea: 97.0, landArea: 40.0, bulk: true, detail: { flags: { tenants: 2, unclaimedTenants: 1 } },
    manual: { zone: { name: '[샘플] 작전○구역 재건축', location: '계양구 작전동 45번지 일원', stage: '조합설립인가 후', type: '재건축', kind: '정비사업', dates: { union: '2024-02-20' } }, redevStage: '조합설립인가 후', econ: { ratio: 1.0, memberPrice: 520000000, newPrice: 780000000, area: 84 } },
  },
  {
    id: 'demo-4', source: 'court', category: 'court', caseNo: '2025타경55120', court: '인천지방법원', title: '[샘플] 강화 선원면 답 990㎡',
    usage: '답', address: '인천광역시 강화군 선원면 ○○리', sido: '인천광역시', sgg: '강화군', emd: '선원면',
    appraisal: 210000000, minBid: 102900000, failCount: 2, round: '3', bidEnd: D(20), status: '진행', landArea: 991,
    land: { jimok: '답', landUse: { zone: '농림지역', redevelopment: [], farmPromotion: true, roadConflict: [] }, officialPrice: 98000 },
  },
  {
    id: 'demo-5', source: 'court', category: 'court', caseNo: '2026타경3021', court: '인천지방법원', title: '[샘플] 용현동 단독주택(토지 지분)',
    usage: '단독주택', address: '인천광역시 미추홀구 용현동 ○○', sido: '인천광역시', sgg: '미추홀구', emd: '용현동', share: true,
    appraisal: 180000000, minBid: 88200000, failCount: 2, round: '3', bidEnd: D(11), status: '진행', buildingArea: 60, landArea: 70,
  },
  {
    id: 'demo-6', source: 'court', category: 'court', caseNo: '2026타경7788', court: '의정부지방법원 고양지원', title: '[샘플] 백석동 아파트 84㎡',
    usage: '아파트', address: '경기도 고양시 일산동구 백석동 ○○아파트', sido: '경기도', sgg: '고양시 일산동구', emd: '백석동',
    appraisal: 610000000, minBid: 610000000, failCount: 0, round: '1', bidEnd: D(25), status: '진행', buildingArea: 84.7, landArea: 40,
  },
  {
    id: 'demo-7', source: 'onbid', category: 'public', caseNo: '2026-0450-002', court: '한국자산관리공사', title: '[샘플] 부평동 상가 토지 — 법정지상권',
    propertyTypeName: '압류재산', usage: '부동산 > 토지 > 대지', address: '인천광역시 부평구 부평동 ○○', sido: '인천광역시', sgg: '부평구', emd: '부평동',
    appraisal: 400000000, minBid: 240000000, firstPrice: 400000000, failCount: 4, round: '5', bidEnd: D(4), status: '입찰진행중', landArea: 120,
    detail: { flags: { superficies: true, survivingRights: false, tenants: 0 }, superficies: '토지만 매각, 지상 건물 소유자 별도 — 법정지상권 성립 여지' },
  },
];

export const SAMPLE_BANKRUPT = [
  { id: 'demo-b1', seq: 99001, court: '서울회생법원', seller: '파산관재인(샘플)', title: '[샘플] 파산재단 부동산(토지 및 건물) 매각 공고', postedAt: '2026-10-20', expiresAt: '2026-11-20', realEstate: true, kind: '부동산', sido: '서울특별시', attachments: [{ name: '매각공고문.pdf' }], url: '#' },
  { id: 'demo-b2', seq: 99000, court: '수원회생법원', seller: '파산관재인(샘플)', title: '[샘플] 채권매각 및 포기 공고', postedAt: '2026-10-19', expiresAt: '2026-11-27', realEstate: false, kind: '채권·동산 등', sido: '경기도', attachments: [], url: '#' },
  { id: 'demo-b3', seq: 98990, court: '인천지방법원', seller: '파산관재인(샘플)', title: '[샘플] 파산재단 아파트 1세대 공개매각', postedAt: '2026-10-15', expiresAt: '2026-11-05', realEstate: true, kind: '부동산', sido: '인천광역시', attachments: [{ name: '공고문(아파트).pdf' }], url: '#' },
  { id: 'demo-b4', seq: 98980, court: '대전지방법원', seller: '파산관재인(샘플)', title: '[샘플] 공장 토지·건물 및 기계 일괄 매각', postedAt: '2026-10-12', expiresAt: '2026-10-30', realEstate: true, kind: '부동산+기타', sido: '대전·충남', attachments: [], url: '#' },
];

SAMPLE_LISTINGS.push({
  id: 'demo-8', source: 'onbid', category: 'public', caseNo: '2026-0777-001', court: '한국자산관리공사', title: '[샘플] 산곡동 다세대 46㎡ (법인 단타 적합 예시)',
  propertyTypeName: '압류재산', usage: '부동산 > 주거용건물 > 다세대', address: '인천광역시 부평구 십정동 ○○빌라 2층', sido: '인천광역시', sgg: '부평구', emd: '십정동',
  appraisal: 165000000, minBid: 99000000, firstPrice: 165000000, failCount: 4, round: '5', status: '입찰진행중', statusCode: '0002',
  buildingArea: 46.2, landArea: 19.1, housePrice: { kind: '공동주택', year: 2026, price: 72000000 },
  bidStart: '2026-11-02 10:00', bidEnd: '2026-11-04 17:00', bidCount: 5, bidMethod: '일반경쟁',
  detail: {
    flags: { superficies: false, survivingRights: false, tenants: 1, unclaimedTenants: 0 },
    addressFull: '인천광역시 부평구 십정동 ○○-○ ○○빌라 제2층 제201호', landCategory: '대', appraisalDate: '20260312', firstNoticeDate: '20260520', openDate: '20261105', deposit: '최저입찰가의 10%',
    location: '[샘플] 동암역 남서측 약 600m, 주변은 다세대·단독주택 밀집 주거지역. 버스정류장 도보 3분.',
    usageStatus: '[샘플] 다세대주택 2층(방2·욕실1), 현재 임차인 점유 중.',
    deliveryDuty: '매수인 부담', cautions: '[샘플] 관리비 체납 여부 확인 필요',
    leases: [{ tenant: '김○○', part: '전부', deposit: 30000000, rent: 200000, moveIn: '20230105', fixedDate: '20230105', claimed: true }],
    rights: [{ kind: '근저당권', holder: '○○은행', date: '20210310', amount: 96000000 }, { kind: '압류', holder: '부평구', date: '20250602', amount: null }],
    rounds: [{ round: '1', start: '2026-06-02 10:00', end: '2026-06-04 17:00', open: '20260605', minBid: 165000000 }, { round: '5', start: '2026-11-02 10:00', end: '2026-11-04 17:00', open: '20261105', minBid: 99000000 }],
  },
  land: { landUse: { zone: '제2종일반주거지역', redevelopment: [], farmPromotion: false, greenbelt: false, roadConflict: [] } },
});

SAMPLE_LISTINGS.push({
  id: 'demo-9', source: 'onbid', category: 'public', caseNo: '2026-0812-001', court: '한국자산관리공사', title: '[샘플] 구월동 토지 — 현황도로',
  usage: '토지', address: '인천광역시 남동구 구월동 ○○', sido: '인천광역시', sgg: '남동구', emd: '구월동',
  appraisal: 95000000, minBid: 47500000, firstPrice: 95000000, failCount: 5, round: '6', status: '입찰진행중', statusCode: '0002', landArea: 132,
  detail: { landCategory: '대', usageStatus: '현황 도로로 이용 중(포장)', flags: { superficies: false, survivingRights: false, tenants: 0, unclaimedTenants: 0 } },
  land: { jimok: '대', landUse: { zone: '제2종일반주거지역', redevelopment: [], farmPromotion: false, greenbelt: false, roadConflict: [] }, officialPrice: 1350000 },
});
