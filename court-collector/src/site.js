// ───────────────────────────────────────────────────────────────
// 법원경매정보(www.courtauction.go.kr) 화면 읽기 — 이 파일만 사이트 구조에 맞춰 고치면 된다.
//
// ※ 전용 PC의 Claude Code에게: 아래 TODO 함수 3개를 실제 사이트 화면을 열어 보면서 완성해라.
//    - 사이트는 자주 개편되므로 '물건 상세 보기' 화면의 실제 요소를 확인하고 고른다.
//    - 화면 이동은 사람이 클릭하는 순서 그대로 한다(검색 → 목록 → 상세). 숨은 내부 주소를 직접 대량 호출하지 않는다.
//    - 보안문자·접속 차단이 나오면 우회하지 말고 throw new Blocked() 로 멈춘다.
// ───────────────────────────────────────────────────────────────

export const HOME = 'https://www.courtauction.go.kr/';

export class Blocked extends Error {}

// 공통: 차단·보안문자 화면 감지
export async function checkBlocked(page) {
  const text = (await page.content()).slice(0, 20000);
  if (/자동입력\s*방지|보안문자|captcha|접근이\s*제한|비정상적인\s*접근|과도한\s*요청/i.test(text)) throw new Blocked('사이트가 접속을 막았거나 보안문자를 요구합니다. 수집을 멈춥니다.');
}

/**
 * 법원 하나의 '진행 중' 물건 목록을 처음부터 끝까지 넘기며 돌려준다.
 * 화면 하나를 열 때마다 반드시 await pace.beforePage() 를 먼저 부른다.
 * @returns {AsyncGenerator<{caseNo, itemNo, court, usage, address, appraisal, minBid, failCount, bidEnd, status, open: () => Promise<void>}>}
 *   open(): 그 물건의 상세 화면으로 이동하는 함수(목록에서 클릭)
 */
export async function* listCourt(page, court, pace) {
  // TODO(전용 PC): 경매물건 검색 화면 → 법원 선택(court) → 진행물건 검색 → 목록 행을 읽고, 다음 쪽으로 넘긴다.
  // 각 행에서 사건번호(예: 2026타경12345), 물건번호, 용도, 소재지, 감정가, 최저가, 유찰횟수, 매각기일, 진행상태를 읽는다.
  await pace.beforePage();
  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await checkBlocked(page);
  throw new Error(`site.js 의 listCourt() 가 아직 구현되지 않았습니다 (${court})`);
  // eslint-disable-next-line no-unreachable
  yield null;
}

/**
 * 지금 열려 있는 물건 상세 화면을 읽는다.
 * @returns {{
 *   title, usage, address, pnu?, landArea?, buildingArea?, share?: boolean, bulk?: boolean,
 *   photos: string[],                      // 사진 주소(현황사진·위치도·지적도)
 *   appraisalSummary?: string,             // 감정평가요항 요약
 *   specialConditions?: string,            // 특별매각조건·비고
 *   baseRightDate?: string,                // 최선순위 설정일(말소기준권리)
 *   leases: [{tenant, part, deposit, rent, moveIn, fixedDate, claimed}],
 *   survivingRights?: string,              // 매각으로 소멸되지 않는 권리
 *   superficies?: string,                  // 법정지상권 관련 기재
 *   rounds: [{round, date, minBid, result}],
 *   documents: [{name, url}]               // 감정평가서·매각물건명세서·현황조사서 보기 링크
 * }}
 */
export async function readDetail(page) {
  // TODO(전용 PC): 물건 상세 화면의 각 칸을 읽는다. 없는 칸은 비워 둔다.
  await checkBlocked(page);
  throw new Error('site.js 의 readDetail() 이 아직 구현되지 않았습니다');
}

/** 상세 화면에서 목록으로 돌아간다(브라우저 뒤로 가기 또는 목록 버튼). */
export async function backToList(page) {
  // TODO(전용 PC): 목록으로 돌아가는 동작
  await page.goBack({ waitUntil: 'domcontentloaded' });
}
