// ───────────────────────────────────────────────────────────────
// 법원경매정보(www.courtauction.go.kr) 화면 읽기 — 이 파일만 사이트 구조에 맞춰 고치면 된다.
//
// 화면 순서(2026.10 확인): 첫 화면(공지 팝업 닫기) → 상단 '경매물건' → '물건상세검색'
//   → 법원 선택 → 검색 → 목록(한 쪽 10건, 물건 1건 = 표 2줄) → 소재지 클릭 → 상세 → '이전' → 목록
//    - 화면 이동은 사람이 클릭하는 순서 그대로 한다(검색 → 목록 → 상세). 숨은 내부 주소를 직접 대량 호출하지 않는다.
//    - 보안문자·접속 차단이 나오면 우회하지 말고 throw new Blocked() 로 멈춘다.
//    - 사이트는 WebSquare 화면이라 주소창 URL이 바뀌지 않는다. 요소 id 중 'wq_uuid_' 가 붙은 것은 매번 바뀌므로 쓰지 않는다.
// ───────────────────────────────────────────────────────────────

export const HOME = 'https://www.courtauction.go.kr/';

export class Blocked extends Error {}

const M = '#mf_wfm_mainFrame_';
const SEL = {
  court: `${M}sbx_rletCortOfc`,
  searchBtn: `${M}btn_gdsDtlSrch`,
  grid: `${M}grd_gdsDtlSrchResult_body_table`,
  pager: `${M}pgl_gdsDtlSrchPage`,
  pageSelected: `${M}pgl_gdsDtlSrchPage .w2pageList_label_selected`,
  pageLabels: `[id^="mf_wfm_mainFrame_pgl_gdsDtlSrchPage_page_"]`,
  pageNext: `${M}pgl_gdsDtlSrchPage_next_btn`,
  rounds: `${M}grd_dxdyDtsLst_body_table`,
  backBtn: `${M}btn_prevBtn`,
};

// 공통: 차단·보안문자 화면 감지
export async function checkBlocked(page) {
  const text = (await page.content()).slice(0, 20000);
  if (/자동입력\s*방지|보안문자|captcha|접근이\s*제한|비정상적인\s*접근|과도한\s*요청/i.test(text)) throw new Blocked('사이트가 접속을 막았거나 보안문자를 요구합니다. 수집을 멈춥니다.');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => { const d = String(s || '').replace(/[^\d]/g, ''); return d ? Number(d) : undefined; };
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// 화면 전환 뒤 '조회중' 표시가 사라지고 통신이 잦아들 때까지 기다린다
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await sleep(800);
  await checkBlocked(page);
}

// 첫 화면에 뜨는 공지사항 팝업(여러 개일 수 있음)을 닫는다 — 사람이 '닫기'를 누르는 것과 같음
async function closeNotices(page) {
  for (let i = 0; i < 5; i++) {
    const btn = page.locator('input.w2window_close[value="닫기"]:visible').last(); // 겹쳐 있으면 맨 위(마지막) 것부터
    if (!(await btn.count())) return;
    await btn.click();
    await sleep(500);
  }
}

// config.json 의 법원 이름 → 화면 선택칸의 이름 ('인천지방법원 부천지원' → '부천지원')
async function selectCourt(page, court) {
  const labels = await page.$$eval(`${SEL.court} option`, (os) => os.map((o) => o.textContent.trim()));
  const label = labels.includes(court) ? court : labels.find((l) => l === court.split(/\s+/).pop());
  if (!label) throw new Error(`법원 선택칸에 '${court}' 이 없습니다`);
  await page.selectOption(SEL.court, { label });
  await settle(page); // 담당계 목록이 새로 채워짐
}

async function currentPageNo(page) {
  return num(await page.locator(SEL.pageSelected).first().textContent().catch(() => '1')) || 1;
}

// 목록 아래 쪽 번호를 눌러 n쪽으로 간다(보이지 않으면 '다음' 묶음 버튼)
async function goToPage(page, n, pace) {
  for (let guard = 0; guard < 50 && (await currentPageNo(page)) !== n; guard++) {
    const label = page.locator(`${SEL.pageLabels}:visible`).filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) }).first();
    await pace.beforePage();
    if (await label.count()) await label.click();
    else await page.locator(SEL.pageNext).click();
    await settle(page);
  }
  if ((await currentPageNo(page)) !== n) throw new Error(`목록 ${n}쪽으로 이동하지 못했습니다`);
}

// 지금 보이는 목록 한 쪽을 읽는다(물건 1건 = 셀 id ..._cell_{i}_{0~10})
async function readListPage(page, court) {
  const rows = await page.$$eval(`${SEL.grid} td[id*="_cell_"]`, (tds) => {
    const by = {};
    for (const td of tds) {
      const m = td.id.match(/_cell_(\d+)_(\d+)$/);
      if (!m) continue;
      (by[m[1]] ||= {})[m[2]] = { text: td.innerText, link: td.querySelector('a[onclick*="moveDtlPage"]')?.textContent || '' };
    }
    return Object.entries(by).map(([i, c]) => ({ i: Number(i), c }));
  });
  return rows.map(({ i, c }) => {
    const t = (k) => (c[k]?.text || '').replace(/\s+/g, ' ').trim();
    const caseNo = (t(1).match(/\d{4}타경\d+/) || t(0).match(/\d{4}타경\d+/) || [])[0];
    const status = t(10);
    return {
      index: i, caseNo, itemNo: t(2) || '1', court,
      usage: t(8) || undefined,
      address: clean(c[3]?.link) || t(3).split('[')[0].trim(),
      appraisal: num(t(6)),
      minBid: num(t(9).split('(')[0]),
      failCount: /유찰\s*(\d+)/.test(status) ? Number(status.match(/유찰\s*(\d+)/)[1]) : 0,
      bidEnd: (t(7).match(/\d{4}\.\d{2}\.\d{2}/) || [])[0],
      status: status || '진행',
      remarks: t(5) || undefined,
    };
  }).filter((r) => r.caseNo);
}

/**
 * 법원 하나의 '진행 중' 물건 목록을 처음부터 끝까지 넘기며 돌려준다.
 * 화면 하나를 열 때마다 반드시 await pace.beforePage() 를 먼저 부른다.
 * 검색 기간은 화면 기본값(오늘부터 2주 안의 매각기일) 그대로 — 매일 돌리므로 모든 물건이 매각 2주 전에는 잡힌다.
 * @returns {AsyncGenerator<{caseNo, itemNo, court, usage, address, appraisal, minBid, failCount, bidEnd, status, open: () => Promise<void>}>}
 *   open(): 그 물건의 상세 화면으로 이동하는 함수(목록에서 클릭)
 */
export async function* listCourt(page, court, pace) {
  // 1) 첫 화면
  await pace.beforePage();
  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await settle(page);
  await closeNotices(page);

  // 2) 상단 메뉴 '경매물건' → '물건상세검색'
  await pace.beforePage();
  await page.locator('a:visible', { hasText: /^\s*경매물건\s*$/ }).first().click();
  await sleep(1000);
  await page.locator('a:visible', { hasText: /^\s*물건상세검색\s*$/ }).first().click();
  await page.waitForSelector(SEL.court, { timeout: 30000 });
  await settle(page);

  // 3) 법원 선택 → 검색
  await selectCourt(page, court);
  await pace.beforePage();
  await page.click(SEL.searchBtn);
  await settle(page);
  const head = await page.locator('body').innerText();
  const total = num((head.match(/총\s*물건수\s*([\d,]+)\s*건/) || [])[1]) || 0;
  if (!total) return;
  await page.waitForSelector(`${SEL.grid} a[onclick*="moveDtlPage"]`, { timeout: 30000 });
  const pages = Math.ceil(total / 10);

  // 4) 쪽마다 행을 읽고, 다음 쪽으로 넘긴다
  for (let p = 1; p <= pages; p++) {
    if (p > 1) await goToPage(page, p, pace);
    const rows = await readListPage(page, court);
    for (const row of rows) {
      yield {
        ...row,
        open: async () => {
          // 상세에서 돌아오면 목록이 다시 그려지므로, 같은 쪽인지 확인한 뒤 소재지를 누른다
          if ((await currentPageNo(page)) !== p) await goToPage(page, p, pace);
          await page.locator(`${SEL.grid} a[onclick="moveDtlPage(${row.index})"]`).first().click();
          await page.waitForSelector(SEL.rounds, { timeout: 30000 });
          await settle(page);
        },
      };
    }
  }
}

/**
 * 지금 열려 있는 물건 상세 화면을 읽는다.
 * ※ 사진은 화면에 이미지 데이터(data:, 장당 수백 KB)로만 들어 있어 주소가 없으므로 photos 는 비워 둔다.
 * ※ 감정평가서·현황조사서·매각물건명세서는 버튼(팝업)으로만 열려 주소가 없으므로 documents 에 이름만 적는다.
 *   임차인·말소기준권리·인수권리는 매각물건명세서 팝업 안에 있어 이 화면에서는 읽지 않는다(비워 둠).
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
  await checkBlocked(page);
  // 목록내역·감정평가요항표는 기일내역보다 늦게 채워지므로 내용이 들어올 때까지 기다린다(없는 물건도 있어 최대 15초)
  await page.waitForFunction(() => {
    let n = [...document.querySelectorAll('h3')].find((e) => e.offsetParent !== null && e.textContent.trim() === '목록내역');
    while (n && !n.nextElementSibling) n = n.parentElement;
    return n && n.nextElementSibling.innerText.replace(/\s/g, '').length > 40;
  }, null, { timeout: 15000 }).catch(() => {});
  const raw = await page.evaluate((roundsSel) => {
    const vis = (e) => e && e.offsetParent !== null;
    const txt = (e) => (e ? e.innerText.trim() : '');
    // 표의 제목칸(th) → 바로 옆 칸(td)
    const fields = {};
    for (const th of document.querySelectorAll('th')) {
      if (!vis(th) || !th.nextElementSibling) continue;
      const k = th.textContent.replace(/\s+/g, '');
      if (!(k in fields)) fields[k] = txt(th.nextElementSibling);
    }
    // 소제목(h3) 바로 아래 묶음 — h3 가 제목 묶음(div)에 싸여 있어 다음 칸이 나올 때까지 위로 올라간다
    const section = (name) => {
      let n = [...document.querySelectorAll('h3')].find((e) => vis(e) && e.textContent.trim() === name);
      while (n && !n.nextElementSibling) n = n.parentElement;
      return n ? txt(n.nextElementSibling) : '';
    };
    const rounds = [...document.querySelectorAll(`${roundsSel} tbody tr`)].map((tr) => [...tr.cells].map((c) => c.innerText.trim()));
    const docs = [...document.querySelectorAll('input[type=button],button')].filter(vis)
      .map((b) => (b.value || b.textContent).trim()).filter((n) => /^(감정평가서|현황조사서|매각물건명세서)$/.test(n));
    return { fields, rounds, docs: [...new Set(docs)], items: section('목록내역'), appraisal: section('감정평가요항표 요약') };
  }, SEL.rounds);

  const f = raw.fields;
  const addrKeys = Object.keys(f).filter((k) => /^목록\d+소재지$/.test(k));
  const address = clean((f[addrKeys[0]] || '').replace(/^\([^)]*\)\s*/, '').split('\n')[0]);
  const remarks = clean(f['물건비고']);
  const items = raw.items;

  // 면적: 전유부분 면적 / 대지권(비율의 분자) 또는 토지 목록 면적
  const bArea = items.match(/전유부분[\s\S]*?면\s*적\s*:\s*([\d.,]+)\s*㎡/);
  const ratio = items.match(/대지권의\s*비율\s*:?\s*\d*\.?\s*[\d.,]+\s*분의\s*([\d.,]+)/);
  const landRows = [...items.matchAll(/(?:^|\s)(?:대|전|답|임야|잡종지|공장용지|창고용지|도로|주차장|과수원|목장용지|학교용지|체육용지|구거|유지)\s+([\d.,]+)\s*㎡/g)];
  const landArea = ratio ? Number(ratio[1].replace(/,/g, '')) : (!bArea && landRows.length ? landRows.reduce((s, m) => s + Number(m[1].replace(/,/g, '')), 0) : undefined);

  let round = 0;
  const rounds = raw.rounds.filter((r) => r[1] === '매각기일').map((r) => ({
    round: ++round,
    date: (r[0].match(/\d{4}\.\d{2}\.\d{2}/) || [])[0],
    minBid: num(r[3]),
    result: r[4] || undefined,
  }));

  return {
    title: undefined, // run.js 가 주소·용도로 만든다
    usage: clean(f['물건종류']) || undefined,
    address,
    landArea,
    buildingArea: bArea ? Number(bArea[1].replace(/,/g, '')) : undefined,
    // 지분: 비고·목록내역·상세 칸 어디든 '지분' 또는 '공유자 우선매수'가 있으면(대지권 비율 '○분의 ○'은 제외)
    share: /지분|공유자\s*우선매수/.test(`${remarks} ${items} ${Object.values(f).join(' ')}`),
    shareText: (`${remarks} ${items} ${Object.values(f).join(' ')}`.match(/[^\n]{0,40}(?:지분|공유자\s*우선매수)[^\n]{0,40}/) || [])[0]?.trim() || undefined,
    bulk: addrKeys.length > 1 || /일괄매각/.test(remarks),
    photos: [],
    appraisalSummary: raw.appraisal || undefined,
    specialConditions: remarks || undefined,
    baseRightDate: undefined,
    leases: [],
    survivingRights: undefined,
    superficies: /법정지상권/.test(remarks + raw.appraisal) ? (remarks.match(/[^.\n]*법정지상권[^.\n]*/) || raw.appraisal.match(/[^.\n]*법정지상권[^.\n]*/) || [])[0] : undefined,
    rounds,
    documents: raw.docs.map((name) => ({ name, url: undefined })),
  };
}

/** 상세 화면에서 목록으로 돌아간다(화면 아래 '이전' 버튼 — 사이트가 보던 쪽 번호를 기억해 목록을 다시 그림). */
export async function backToList(page) {
  await sleep((10 + Math.random() * 10) * 1000); // 상세 화면을 읽는 사람처럼 10~20초 머문 뒤 돌아간다
  const btn = page.locator(SEL.backBtn);
  if (await btn.count()) await btn.click();
  else await page.locator('input[type=button][value="이전으로"]:visible').first().click();
  await page.waitForSelector(`${SEL.grid} a[onclick*="moveDtlPage"]`, { timeout: 30000 });
  await settle(page);
}
