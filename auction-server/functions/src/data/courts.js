// 수도권 법원·지원 유찰 저감률. 관리자 화면에서 고칠 수 있고, 이 값은 처음 설치할 때의 기본값.
// 근거: 서울 소재 법원 20%, 인천·경기 30%(안양지원만 20%) — 아시아경제 2022.7.29 기사.
// 인천지방법원 30%는 사용자 확인값. verified:false 는 개별 공고로 한 번 더 확인할 것.

const COURTS = [
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

// 공매(온비드 압류재산 등)는 회차마다 최초 예정가의 10%씩 내려가고 50%가 하한(이후 재공고).
const ONBID_RULE = { step: 0.1, floor: 0.5 };

module.exports = { COURTS, ONBID_RULE };
