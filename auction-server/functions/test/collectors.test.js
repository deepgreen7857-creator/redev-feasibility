const test = require('node:test');
const assert = require('node:assert');
const { decode, Quota, call } = require('../src/lib/dataGoKr');
const onbid = require('../src/lib/onbid');
const trades = require('../src/lib/trades');
const bankrupt = require('../src/lib/bankrupt');
const vworld = require('../src/lib/vworld');

const onbidJson = (rows, total = rows.length) => JSON.stringify({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE' }, body: { totalCount: total, pageNo: 1, numOfRows: 100, items: { item: rows } } } });
const fakeFetch = (handler) => async (url) => ({ ok: true, status: 200, text: async () => handler(new URL(url)), json: async () => JSON.parse(handler(new URL(url))) });

const sampleRow = {
  cltrMngNo: '2026-01234-001', pbctCdtnNo: '7788', onbidCltrno: '0001234567', onbidPbancNo: '202610-1', onbidCltrNm: '인천광역시 부평구 부평동 123 대지',
  prptDivCd: '0013', prptDivNm: '파산자산', lctnSdnm: '인천광역시', lctnSggnm: '부평구', lctnEmdNm: '부평동', ltnoPnu: '2823710100101230000',
  apslEvlAmt: '300000000', lowstBidPrcIndctCont: '210,000,000', usbdNft: '3', pbctNsq: '4', cltrBidBgngDt: '202611021000', cltrBidEndDt: '202611041700',
  pbctStatCd: '0002', pbctStatNm: '입찰진행중', alcYn: 'N', landSqms: '165.3', bldSqms: '', mdfcnDt: '20261020093000',
};

test('공공데이터 응답 해석: JSON·XML·자료없음·오류', () => {
  assert.equal(decode(onbidJson([sampleRow])).rows.length, 1);
  const xml = '<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header><body><items><item><dealAmount>82,500</dealAmount><excluUseAr>84.97</excluUseAr><umdNm>부평동</umdNm></item></items><totalCount>1</totalCount></body></response>';
  assert.equal(decode(xml).rows[0].umdNm, '부평동');
  assert.equal(decode('<response><header><resultCode>03</resultCode></header></response>').rows.length, 0);
  assert.throws(() => decode('<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg></cmmMsgHeader></OpenAPI_ServiceResponse>'), /30/);
});

test('온비드 목록 한 줄 → 물건(파산자산 분류, 금액·날짜 변환)', () => {
  const it = onbid.mapListRow(sampleRow);
  assert.equal(it.category, 'bankrupt');
  assert.equal(it.minBid, 210000000);
  assert.equal(it.failCount, 3);
  assert.equal(it.bidEnd, '2026-11-04 17:00');
  assert.equal(it.id, 'onbid_2026-01234-001_7788');
  assert.equal(onbid.mapListRow({ ...sampleRow, lowstBidPrcIndctCont: '비공개' }).minBid, null);
});

test('온비드 수집 구간: 수도권 3개 시도 + 파산자산 전국', () => {
  const parts = onbid.partitions();
  assert.equal(parts.length, 8);
  assert.ok(parts.some((p) => p.sido === null && p.prptDivCd === '0013'));
});

test('온비드 수집 흐름(가짜 서버): 목록 저장 → 상세 조회', async () => {
  const saved = [];
  const fetcher = fakeFetch((u) => {
    if (u.pathname.includes('Dtl')) return onbidJson([{ cltrMngNo: sampleRow.cltrMngNo, sttyEbrVldCont: '법정지상권 성립 여지 있음', ersrExclRgtCont: '없음', leasInfList: { item: [{ acpmPrptOcpyIrpsFlnm: '홍길동', acpmGrteeAmt: '50000000', dtbtRqrYn: 'N' }] } }]);
    if (u.searchParams.get('lctnSdnm') === '인천광역시' && u.searchParams.get('pvctTrgtYn') === 'N') return onbidJson([sampleRow]);
    return onbidJson([], 0);
  });
  const res = await onbid.collect({ serviceKey: 'k', quota: new Quota(null), fetcher, mode: 'full', save: async (items) => { saved.push(...items); return {}; } });
  assert.equal(res.rows, 1);
  assert.equal(res.details, 1);
  const detail = saved.find((s) => s.detail).detail;
  assert.equal(detail.flags.superficies, true);
  assert.equal(detail.flags.survivingRights, false);
  assert.equal(detail.flags.unclaimedTenants, 1);
});

test('실거래가 압축: 만원→원, 해제·거래유형', () => {
  const r = trades.compact('apt', { dealAmount: ' 82,500', excluUseAr: '84.97', floor: '12', dealDay: '5', jibun: '123', aptNm: '부평래미안', buildYear: '2005', cdealType: 'O', dealingGbn: '직거래', umdNm: '부평동' });
  assert.deepEqual(r.slice(0, 10), [825000000, 84.97, 12, 5, '123', '부평래미안', 2005, true, '직거래', '부평동']);
  const land = trades.compact('land', { dealAmount: '15,000', dealArea: '330', jimok: '전', umdNm: '서운동' });
  assert.equal(land[0], 150000000); assert.equal(land[10], '전');
});

test('실거래가 계획: 부평·계양 먼저, 최근 2개월은 매번, 받은 달은 건너뜀', () => {
  const months = trades.ymList(12);
  const jobs = trades.plan({ type: 'apt', done: { [`28237_${months[5]}`]: true }, backfillMonths: 12 });
  assert.equal(jobs[0].lawd, '28237');
  assert.equal(jobs[1].lawd, '28245');
  assert.ok(!jobs.some((j) => j.lawd === '28237' && j.ym === months[5]));
  assert.equal(jobs.filter((j) => j.recent).length, 2 * require('../src/data/regions').REGIONS.length);
});

test('실거래가 수집: 한도 소진 시 멈추고 진행상황 저장', async () => {
  let calls = 0;
  const fetcher = fakeFetch(() => { calls++; return calls > 3 ? '<OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>22</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>' : '<response><header><resultCode>000</resultCode></header><body><items></items><totalCount>0</totalCount></body></response>'; });
  const progress = {};
  const res = await trades.collect({ serviceKey: 'k', quota: new Quota(null), fetcher, types: ['apt'], getProgress: async () => null, saveProgress: async (t, p) => { progress[t] = p; }, saveMonth: async () => {}, log: () => {} });
  assert.equal(res.apt.stopped, 'quota');
  assert.equal(res.apt.ok, 3);
  assert.ok(progress.apt.remaining > 0);
});

test('파산 공고: 목록·상세 해석과 부동산 분류', () => {
  const list = `<table><tbody>
    <tr><td>421</td><td>수원회생법원</td><td>파산채무자 (주)폴리씨앤피의 파산관재인 변호사 박찬림</td><td><a href="/portal/notice/realestate/RealNoticeView.work?pageIndex=1&bub_cd=&searchWord=&searchOption=&seq_id=35834">채권매각 및 포기 공고</a></td><td>97</td></tr>
    <tr><td>420</td><td>서울회생법원</td><td>파산관재인 김○○</td><td><a href="RealNoticeView.work?seq_id=35830">파산재단 부동산(토지 및 건물) 매각 공고</a></td><td>55</td></tr>
  </tbody></table><a href="?pageIndex=42">마지막</a>`;
  const p = bankrupt.parseList(list);
  assert.equal(p.rows.length, 2);
  assert.equal(p.rows[0].seq, 35834);
  assert.equal(p.lastPage, 42);
  const view = bankrupt.parseView(`<table><tr><th>매각기관</th><td>파산관재인 김○○</td></tr><tr><th>관할법원</th><td>서울회생법원</td></tr><tr><th>작성일</th><td>2026.10.21</td></tr><tr><th>공고만료일</th><td>2026.11.27</td></tr><tr><th>첨부파일</th><td><a href="/common/file/FileDown.work?id=1">매각공고문(토지).pdf</a></td></tr></table>`);
  assert.equal(view.expiresAt, '2026-11-27');
  assert.equal(view.attachments[0].name, '매각공고문(토지).pdf');
  assert.equal(bankrupt.classify('채권매각 및 포기 공고').realEstate, false);
  assert.equal(bankrupt.classify('파산재단 부동산(토지 및 건물) 매각 공고').kind, '부동산');
  assert.equal(bankrupt.classify('전국 소재 자산 매각').realEstate, false);
  assert.equal(bankrupt.sidoOfCourt('수원회생법원'), '경기도');
});

test('파산 공고 수집: 이미 받은 글에서 멈춤', async () => {
  const fetcher = fakeFetch((u) => u.pathname.endsWith('RealNoticeList.work')
    ? '<table><tbody><tr><td>2</td><td>서울회생법원</td><td>관재인</td><td><a href="x?seq_id=102">토지 매각</a></td><td>1</td></tr><tr><td>1</td><td>서울회생법원</td><td>관재인</td><td><a href="x?seq_id=100">옛 글</a></td><td>1</td></tr></tbody></table>'
    : '<table><tr><th>작성일</th><td>2026.10.22</td></tr></table>');
  const saved = [];
  const res = await bankrupt.collect({ fetcher, knownMaxSeq: 100, save: async (i) => saved.push(i), log: () => {}, delayMs: 0 });
  assert.equal(saved.length, 1);
  assert.equal(res.maxSeq, 102);
  assert.equal(res.pages, 1);
});

test('브이월드 토지이용 판정: 정비구역·농업진흥·도로저촉', () => {
  const r = vworld.analyzeLandUse([
    { prposAreaDstrcCodeNm: '제2종일반주거지역', cnflcAtNm: '포함' },
    { prposAreaDstrcCodeNm: '정비구역', cnflcAtNm: '포함' },
    { prposAreaDstrcCodeNm: '소로2류(폭 8M~10M)', cnflcAtNm: '저촉' },
    { prposAreaDstrcCodeNm: '농업진흥구역', cnflcAtNm: '포함' },
  ]);
  assert.equal(r.zone, '제2종일반주거지역');
  assert.deepEqual(r.redevelopment, ['정비구역']);
  assert.equal(r.farmPromotion, true);
  assert.equal(r.roadConflict.length, 1);
});

test('호출기: 키 없으면 바로 오류', async () => {
  await assert.rejects(call({ api: 'x', url: 'https://example.com', serviceKey: '' }), /인증키/);
});

const incheon = require('../src/lib/incheonZones');
const XLSX = require('xlsx');

test('인천 정비사업 현황: 새 글의 엑셀 2개를 받아 구역으로 저장', async () => {
  const book = (rows) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Sheet1'); return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }); };
  const f1 = book([['인천광역시 도시정비사업 추진현황'], ['연번', '군구', '구역명', '위치', '사업유형', '추진단계', '조합설립인가'], [1, '부평구', '십정○구역', '십정동 123 일원', '재개발', '조합설립인가', '2024.02.20']]);
  const f2 = book([['연번', '군구', '사업장명', '대지위치', '사업유형', '진행단계'], [1, '계양구', '작전○가로주택', '작전동 45', '가로주택정비', '사업시행인가']]);
  const fetcher = async (url) => {
    const u = String(url);
    const html = u.includes('board.do?')
      ? '<table><tr><td><a href="board_inscr.do?bbs_id=BBSMSTR_000000000015&ntt_id=1309">인천광역시 도시정비사업 추진현황(2026.9월말 기준)</a></td></tr><tr><td><a href="board_inscr.do?bbs_id=BBSMSTR_000000000015&ntt_id=1304">인천광역시 도시정비사업 추진현황(2026.8월말 기준)</a></td></tr></table>'
      : u.includes('board_inscr') ? '<a href="/cmm/fms/FileDown.do?atchFileId=FILE_1&fileSn=0">01. 도시정비사업 추진현황_2026년 9월말 기준.xlsx</a><a href="#" onclick="fn_egov_downFile(\'FILE_1\',\'1\')">02. 소규모주택정비사업 추진현황_2026년 9월말 기준.xlsx</a>' : null;
    if (html) return { ok: true, status: 200, text: async () => html };
    const buf = u.includes('fileSn=0') ? f1 : f2;
    return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  };
  let saved;
  const res = await incheon.collect({ fetcher, knownNtt: 1304, save: async (p) => { saved = p; }, log: () => {} });
  assert.equal(res.ntt, 1309);
  assert.equal(saved.zones.length, 2);
  assert.equal(saved.quarter, '2026.9월말');
  assert.equal(saved.zones[0].stage, '조합설립인가 후');
  assert.equal(saved.zones[1].kind, '소규모주택정비');
  assert.equal(saved.zones[1].stage, '사업시행인가 후');
  const again = await incheon.collect({ fetcher, knownNtt: 1309, save: async () => { throw new Error('저장하면 안 됨'); }, log: () => {} });
  assert.equal(again.skipped, '새 글 없음');
});
