// 자동 복사본 — 원본: auction-web/src/data/defaults.js (직접 고치지 말 것)
// 처음 설정값(서버 functions/src/data/courts.js 와 같은 내용)
export const DEFAULT_COURTS = [
  { name: '서울중앙지방법원', sido: '서울특별시', rate: 0.2, verified: false },
  { name: '서울동부지방법원', sido: '서울특별시', rate: 0.2, verified: false },
  { name: '서울남부지방법원', sido: '서울특별시', rate: 0.2, verified: false },
  { name: '서울북부지방법원', sido: '서울특별시', rate: 0.2, verified: false },
  { name: '서울서부지방법원', sido: '서울특별시', rate: 0.2, verified: false },
  { name: '인천지방법원', sido: '인천광역시', rate: 0.3, verified: true },
  { name: '인천지방법원 부천지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원 성남지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원 여주지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원 평택지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원 안산지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '수원지방법원 안양지원', sido: '경기도', rate: 0.2, verified: false },
  { name: '의정부지방법원', sido: '경기도', rate: 0.3, verified: false },
  { name: '의정부지방법원 고양지원', sido: '경기도', rate: 0.3, verified: false },
  { name: '의정부지방법원 남양주지원', sido: '경기도', rate: 0.3, verified: false },
];

export const DEFAULT_SETTINGS = {
  courts: DEFAULT_COURTS,
  backfillMonths: 12,
  collectBankrupt: true, collectOnbid: true, collectTrades: true,
  priorityRegions: ['인천광역시 부평구', '인천광역시 계양구'],
  analysisExclude: [{ sido: '인천광역시', sgg: '미추홀구', scope: 'redevelopment' }],
  marginRate: 0.1,
  settlementRatio: 0.9,
  excludeDirect: true,
  // 투기과열지구(주택법 제63조) — 2025.10.16 지정, 2026.6 기준 자료로 확인. 지정·해제 때 관리자 화면에서 고칠 것
  overheated: [
    { sido: '서울특별시', sgg: '*' },
    { sido: '경기도', sgg: '과천시' }, { sido: '경기도', sgg: '광명시' },
    { sido: '경기도', sgg: '성남시 분당구' }, { sido: '경기도', sgg: '성남시 수정구' }, { sido: '경기도', sgg: '성남시 중원구' },
    { sido: '경기도', sgg: '수원시 영통구' }, { sido: '경기도', sgg: '수원시 장안구' }, { sido: '경기도', sgg: '수원시 팔달구' },
    { sido: '경기도', sgg: '안양시 동안구' }, { sido: '경기도', sgg: '용인시 수지구' }, { sido: '경기도', sgg: '의왕시' }, { sido: '경기도', sgg: '하남시' },
  ],
  evictionCost: 3000000,
  loanRatio: 0.6, landLoanRatio: 0.4, cashLoanRatio: 0.5, interestRate: 0.045, holdMonths: 6,
  owner: 'corp', corpHouseLimit: 100000000, brokerRate: 0.005, buildingRatio: 0.5, corpTaxRate: 0.11, surchargeRate: 0.22,
  repairCost: 5000000,
  rights77: null, // null이면 RIGHTS77_DEFAULT — 관리자 설정에서 고친 값이 우선
};

// 권리산정기준일(도시정비법 제77조제1항, 현행) — 기준일 '다음 날' 이후 아래가 생기면 분양받을 권리를 제한.
// 법이 바뀌면 관리자 화면 '권리산정기준일 판정 규칙'에서 고친다(코드에 고정하지 않음).
//  date: 비교할 날짜(물건 manual.rights77[date], 사용승인일은 건축물대장에서 자동)
//  applies: all(모든 물건) · building(건물이 있거나 토지·건물을 따로 파는 물건) · collective(집합건물 호실)
export const RIGHTS77_DEFAULT = {
  law: '도시 및 주거환경정비법 제77조제1항',
  rules: [
    { ho: 1, text: '1필지의 토지가 여러 필지로 분할', date: 'splitDate', dateLabel: '토지 분할일', applies: 'all' },
    { ho: 2, text: '집합건물이 아닌 건축물이 집합건물로 전환', date: 'collectiveDate', dateLabel: '집합건물 전환일(구분등기일)', applies: 'collective' },
    { ho: 3, text: '하나의 대지 범위의 동일인 소유 토지와 건축물을 각각 분리 소유', date: 'separatedDate', dateLabel: '토지·건물 분리 소유 시점', applies: 'building' },
    { ho: 4, text: '나대지 신축 또는 기존 건축물 철거 후 다세대·공동주택 건축으로 토지등소유자 수 증가', date: 'useAprDate', dateLabel: '사용승인일', applies: 'building' },
    { ho: 5, text: '집합건물법 제2조제3호 전유부분 분할로 토지등소유자 수 증가', date: 'unitSplitDate', dateLabel: '전유부분 분할일', applies: 'collective' },
  ],
  // 시·도 조례 기준 메모(분양 대상·면적 기준 등) — 판정 화면에 함께 보여 준다
  ordinance: { '서울특별시': '', '인천광역시': '', '경기도': '' },
};

export const SIDO = ['서울특별시', '인천광역시', '경기도'];

// 시군구 이름 → 실거래가 코드 (서버 regions.js 와 같은 표)
export const SGG_CODES = {
  '서울특별시': { 종로구: '11110', 중구: '11140', 용산구: '11170', 성동구: '11200', 광진구: '11215', 동대문구: '11230', 중랑구: '11260', 성북구: '11290', 강북구: '11305', 도봉구: '11320', 노원구: '11350', 은평구: '11380', 서대문구: '11410', 마포구: '11440', 양천구: '11470', 강서구: '11500', 구로구: '11530', 금천구: '11545', 영등포구: '11560', 동작구: '11590', 관악구: '11620', 서초구: '11650', 강남구: '11680', 송파구: '11710', 강동구: '11740' },
  '인천광역시': { 중구: '28110', 동구: '28140', 미추홀구: '28177', 연수구: '28185', 남동구: '28200', 부평구: '28237', 계양구: '28245', 서구: '28260', 강화군: '28710', 옹진군: '28720' },
  '경기도': { '수원시 장안구': '41111', '수원시 권선구': '41113', '수원시 팔달구': '41115', '수원시 영통구': '41117', '성남시 수정구': '41131', '성남시 중원구': '41133', '성남시 분당구': '41135', 의정부시: '41150', '안양시 만안구': '41171', '안양시 동안구': '41173', 부천시: '41190', '부천시 원미구': '41192', '부천시 소사구': '41194', '부천시 오정구': '41196', 광명시: '41210', 평택시: '41220', 동두천시: '41250', '안산시 상록구': '41271', '안산시 단원구': '41273', '고양시 덕양구': '41281', '고양시 일산동구': '41285', '고양시 일산서구': '41287', 과천시: '41290', 구리시: '41310', 남양주시: '41360', 오산시: '41370', 시흥시: '41390', 군포시: '41410', 의왕시: '41430', 하남시: '41450', '용인시 처인구': '41461', '용인시 기흥구': '41463', '용인시 수지구': '41465', 파주시: '41480', 이천시: '41500', 안성시: '41550', 김포시: '41570', 화성시: '41590', 광주시: '41610', 양주시: '41630', 포천시: '41650', 여주시: '41670', 연천군: '41800', 가평군: '41820', 양평군: '41830' },
};

// 2026년 행정구역 개편으로 생긴 구 → 실거래 자료가 쌓여 있는 개편 전 구(새 코드는 공식 코드표 확인 후 수집 목록에 추가)
//  인천(2026.7.1): 서해구·검단구 ← 서구, 영종구·제물포구 ← 중구(제물포구의 옛 동구 지역은 동구 자료가 더 가깝다)
const SGG_ALIAS = { 인천광역시: { 서해구: '서구', 검단구: '서구', 영종구: '중구', 제물포구: '중구' } };
export function lawdOf(sido, sgg) {
  const table = SGG_CODES[sido] || {};
  if (!sgg) return null;
  const alias = SGG_ALIAS[sido] && Object.keys(SGG_ALIAS[sido]).find((k) => sgg.includes(k));
  if (alias) return table[SGG_ALIAS[sido][alias]] || null;
  if (table[sgg]) return table[sgg];
  const key = Object.keys(table).find((k) => sgg.includes(k) || k.includes(sgg));
  return key ? table[key] : null;
}
