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
    if (u.pathname.includes('Dtl')) return onbidJson([{ cltrMngNo: sampleRow.cltrMngNo, pytnMtrsCont: '토지만 매각 — 법정지상권 성립 여지 있음', leasInfList: [{ irstDivNm: '임차인', cltrInprNm: '홍**', bidGrteeAmt: 50000000, mvinYmd: '20230105' }] }]);
    if (u.searchParams.get('lctnSdnm') === '인천광역시' && u.searchParams.get('pvctTrgtYn') === 'N') return onbidJson([sampleRow]);
    return onbidJson([], 0);
  });
  const res = await onbid.collect({ serviceKey: 'k', quota: new Quota(null), fetcher, mode: 'full', save: async (items) => { saved.push(...items); return {}; } });
  assert.equal(res.rows, 1);
  assert.equal(res.details, 1);
  const row = saved.find((s) => s.detail);
  assert.equal(row.detailVer, onbid.DETAIL_VERSION);
  assert.equal(row.detail.flags.superficies, true);
  assert.equal(row.detail.flags.survivingRights, false);
  assert.equal(row.detail.flags.tenants, 1);
});

// 실제 상세 응답(2026.10, 이름·파일 해시는 지움)
const realDetail = require('./fixtures/onbid-detail.json');

test('온비드 상세 해석: 실제 응답의 항목 이름(사진 배열, 지도 | 구분, 등기·임차·면적·감정)', () => {
  assert.ok(Array.isArray(realDetail.potoUrlList), 'potoUrlList 는 [{urlAdr}] 배열');
  assert.ok(realDetail.lrmUrlAdrList.includes('|'), 'lrmUrlAdrList 는 | 로 이은 글자');
  const d = onbid.mapDetail(realDetail);
  assert.equal(d.photos.length, realDetail.potoUrlList.length);
  assert.ok(d.photos.every((u) => u.startsWith('https://www.onbid.co.kr/')));
  assert.equal(d.mapUrls.length, realDetail.lrmUrlAdrList.split('|').length);
  assert.ok(d.mapUrls.every((u) => u.startsWith('https://')));
  assert.equal(d.addressFull, realDetail.zadrNm);
  assert.equal(d.roadAddress, realDetail.cltrRadr);
  assert.equal(d.pnu, realDetail.ltnoPnu);
  assert.equal(d.landCategory, '대');
  assert.equal(d.appraisalDate, '20260825');
  assert.ok(d.appraisalFile.startsWith('https://'));
  assert.equal(d.distributionDeadline, '20260914');
  assert.equal(d.rights.length, realDetail.rgstPrmrInfList.length);
  const mortgage = d.rights.find((r) => r.kind === '근저당권');
  assert.equal(mortgage.amount, 36000000);
  assert.equal(mortgage.date, '20240411');
  assert.equal(d.leases.length, realDetail.leasInfList.length);
  assert.equal(d.leases[0].deposit, 220000000);
  assert.equal(d.leases[0].moveIn, '20240405');
  assert.ok(d.flags.tenants >= 1);
  assert.equal(d.flags.survivingRights, true); // 유의사항에 '인수' 문구
  assert.equal(d.flags.superficies, false);
  assert.match(d.shareText, /지분/);
  assert.equal(d.usageStatus, realDetail.utlzPscdCont);
});

test('온비드 PNU: 지번이 0인 값은 버린다', () => {
  assert.equal(onbid.validPnu('4145010100000000000'), null);
  assert.equal(onbid.validPnu('1174010700005150007'), '1174010700005150007');
  assert.equal(onbid.mapListRow({ ...sampleRow, ltnoPnu: '4145010100000000000' }).pnu, null);
});

test('상세 우선순위: 정비구역 +3, 부평·계양 +2, 파산자산 +1', () => {
  assert.equal(onbid.score({ land: { landUse: { redevelopment: ['정비구역'] } }, sgg: '부평구', category: 'bankrupt' }), 6);
  assert.equal(onbid.score({ sgg: '계양구' }), 2);
  assert.equal(onbid.score({ category: 'bankrupt', land: { landUse: { redevelopment: [] } } }), 1);
});

test('평일 수집 뒤 상세 빠진 물건 다시 받기: 우선순위 순서, 남은 한도 안에서', async () => {
  const asked = [];
  const fetcher = fakeFetch((u) => {
    if (u.pathname.includes('Dtl')) { asked.push(u.searchParams.get('cltrMngNo')); return onbidJson([{ cltrMngNo: u.searchParams.get('cltrMngNo') }]); }
    return onbidJson([], 0);
  });
  const backlog = [
    { id: 'a', cltrMngNo: 'A', sgg: '남동구' },
    { id: 'b', cltrMngNo: 'B', sgg: '부평구' },
    { id: 'c', cltrMngNo: 'C', sgg: '서구', land: { landUse: { redevelopment: ['재개발'] } } },
    { id: 'd', cltrMngNo: 'D', sgg: '계양구', detailAt: '2026-10-01', detailVer: 1 },
  ];
  const saved = [];
  const res = await onbid.collect({ serviceKey: 'k', quota: new Quota(null), fetcher, mode: 'daily', maxBackfill: 3, save: async (items) => { saved.push(...items); return {}; }, backfill: async () => backlog });
  assert.deepEqual(asked, ['C', 'B', 'A']); // 상세 없는 것 먼저(정비구역 > 부평 > 기타), 한도 3건
  assert.equal(res.backfilled, 3);
  assert.equal(res.backfillPending, 4);
  // full(일요일) 수집에서는 다시 받기를 하지 않는다
  asked.length = 0;
  await onbid.collect({ serviceKey: 'k', quota: new Quota(null), fetcher, mode: 'full', save: async () => ({}), backfill: async () => backlog });
  assert.equal(asked.length, 0);
});

test('브이월드 주소검색으로 PNU 찾기: 지번 주소만 떼고, 산/일반 지번 구분', async () => {
  assert.equal(vworld.parcelAddress('서울특별시 강동구 암사동 515-7 제3층 제301호'), '서울특별시 강동구 암사동 515-7');
  assert.equal(vworld.parcelAddress('경기도 의정부시 낙양동 산 104-1'), '경기도 의정부시 낙양동 산 104-1');
  assert.equal(vworld.parcelAddress('인천광역시 옹진군 영흥면 내리 1349-119 외 소재 부동산'), '인천광역시 옹진군 영흥면 내리 1349-119');
  const items = [
    { id: '4115010700101040001', address: { parcel: '경기도 의정부시 낙양동 104-1' } },
    { id: '4115010700201040001', address: { parcel: '경기도 의정부시 낙양동 산 104-1' } },
  ];
  const fetcher = async () => ({ ok: true, json: async () => ({ response: { status: 'OK', result: { items } } }) });
  assert.equal((await vworld.findPnu({ address: '경기도 의정부시 낙양동 산 104-1', key: 'k', fetcher })).pnu, '4115010700201040001');
  assert.equal((await vworld.findPnu({ address: '경기도 의정부시 낙양동 104-1 제2층', key: 'k', fetcher })).pnu, '4115010700101040001');
  assert.equal(await vworld.findPnu({ address: '경기도 의정부시 낙양동 104-2', key: 'k', fetcher }), null);
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

test('주변 필지 맹지 확인: 지적도 경계 → 주변 필지 → 도로접면', async () => {
  const sq = (x, y) => ({ type: 'MultiPolygon', coordinates: [[[[x, y], [x + 0.0001, y], [x + 0.0001, y + 0.0001], [x, y + 0.0001], [x, y]]]] });
  const fetcher = fakeFetch((u) => {
    if (u.pathname === '/req/data') {
      const feats = u.searchParams.get('attrFilter')
        ? [{ properties: { pnu: '4127310500100280060', jibun: '28-60 도' }, geometry: sq(126.6, 37.2) }]
        : [
          { properties: { pnu: '4127310500100280060', jibun: '28-60 도' }, geometry: sq(126.6, 37.2) },
          { properties: { pnu: '4127310500100280061', jibun: '28-61 전' }, geometry: sq(126.6001, 37.2) },
          { properties: { pnu: '4127310500100280062', jibun: '28-62 대' }, geometry: sq(126.5999, 37.2) },
          { properties: { pnu: '4127310500100280063', jibun: '28-63 도' }, geometry: sq(126.6, 37.2001) },
        ];
      return JSON.stringify({ response: { status: 'OK', result: { featureCollection: { features: feats } } } });
    }
    const pnu = u.searchParams.get('pnu');
    return JSON.stringify({ landCharacteristicss: { field: [{ pnu, roadSideCodeNm: pnu.endsWith('61') ? '맹지' : '세로한면(가)' }] } });
  });
  const nb = await vworld.neighbors({ pnu: '4127310500100280060', key: 'k', fetcher, year: 2026 });
  assert.equal(nb.total, 3);
  assert.equal(nb.landlocked, 1);
  assert.equal(nb.list.find((x) => x.jimok === '도').roadSide, null);
});

test('입찰 전 예측: 기일 전 물건만 판정하고, 기일이 된 물건은 굳힘', async () => {
  const forecast = require('../src/lib/forecast');
  const now = { day: '2026-10-23', stamp: '2026-10-23 08:00' };
  assert.equal(forecast.beforeBid({ bidEnd: '2026.10.24', status: '진행' }, now), true);
  assert.equal(forecast.beforeBid({ bidEnd: '2026.10.23', status: '진행' }, now), false); // 매각기일 당일은 굳힘
  assert.equal(forecast.beforeBid({ bidEnd: '2026-10-23 17:00', status: '입찰진행중' }, now), true);
  assert.equal(forecast.beforeBid({ bidEnd: '2026-11-01', status: '낙찰' }, now), false);
  assert.equal(forecast.beforeBid({ bidEnd: '2026.11.05', status: '유찰' }, now), true); // 법원 '유찰'은 지난 회차 결과 — 다음 기일 전이면 진행 중
  assert.equal(forecast.beforeBid({ bidEnd: '2026.11.05', status: '취하' }, now), false);
  // 가짜 Firestore로 실행
  const docs = [
    { id: 'a', data: { source: 'court', court: '인천지방법원', sido: '인천광역시', sgg: '부평구', emd: '부평동', usage: '아파트', buildingArea: 84, appraisal: 6e8, minBid: 3e8, bidEnd: '2099.01.01', status: '진행' } },
    { id: 'b', data: { source: 'court', sido: '인천광역시', sgg: '부평구', usage: '아파트', buildingArea: 84, appraisal: 6e8, minBid: 3e8, bidEnd: '2000.01.01', status: '매각' } },
  ];
  const written = {};
  const deals = JSON.stringify(Array.from({ length: 20 }, (_, i) => [5e8 + i * 1e6, 84, 5, 1, '1', 'A', 2000, false, '중개거래', '부평동']));
  const db = {
    collection: (name) => ({
      doc: (id) => ({ id, get: async () => ({ exists: name === 'settings' ? false : true, data: () => ({ d: deals }) }), _name: name }),
      get: async () => ({ size: docs.length, docs: docs.map((d) => ({ id: d.id, ref: { id: d.id }, data: () => d.data })) }),
    }),
    getAll: async (...refs) => refs.map(() => ({ exists: true, data: () => ({ d: deals }) })),
    batch: () => ({ set: (ref, v) => { written[ref.id] = v; }, commit: async () => {} }),
  };
  const st = await forecast.run({ db, log: () => {} });
  assert.equal(st.forecast, 1); assert.equal(st.frozen, 1);
  assert.ok(written.a.forecast.verdict && written.a.forecastFirst);
  assert.equal(written.b, undefined);
});

test('온비드 입찰결과: 이전 회차 내역에서 같은 회차의 낙찰가·낙찰가율', () => {
  const onbid = require('../src/lib/onbid');
  const info = onbid.mapBidInfo({
    pbctNsq: '3', usbdNft: '2', prcnNsqBidRsltNm: '유찰', prcnNsqLowstBidPrc: '80000000', pbctTdpsCont: '최저입찰가*10%',
    prcnBidClgList: [
      { pbctNsq: '1', cltrOpbdDt: '202610011030', pbctStatNm: '유찰', lowstBidPrcIndctCont: '100000000' },
      { pbctNsq: '2', cltrOpbdDt: '202610081030', pbctStatNm: '낙찰', lowstBidPrcIndctCont: '90000000', scfbAmt: '93500000', apslPrcCtrsLowstBidRto: '93.5' },
    ],
  });
  assert.equal(info.history.length, 2);
  const r = onbid.resultFor({ round: '2', minBid: 9e7 }, info);
  assert.equal(r.soldPrice, 93500000); assert.equal(r.rate, 0.935); assert.equal(r.status, '낙찰');
  const f = onbid.resultFor({ round: '1' }, info);
  assert.equal(f.status, '유찰'); assert.equal(f.soldPrice, null);
  assert.equal(onbid.resultFor({ round: '5' }, info), null);
  const one = onbid.mapBidInfo({ prcnBidClgList: { listItem: { pbctNsq: '1', pbctStatNm: '낙찰', scfbAmt: '1|2' } } });
  assert.equal(one.history[0].soldPrice, 1);
});

test('온비드 물건 입찰결과목록: 물건명에서 시도·시군구·읍면동, 낙찰가·낙찰가율·유효입찰자수', () => {
  const onbid = require('../src/lib/onbid');
  assert.deepEqual(onbid.placeOf('경기도 수원시 영통구 매탄동 123-4 아파트'), { sido: '경기도', sgg: '수원시 영통구', emd: '매탄동' });
  assert.deepEqual(onbid.placeOf('인천광역시 부평구 십정동 1 다세대'), { sido: '인천광역시', sgg: '부평구', emd: '십정동' });
  const r = onbid.mapResultRow({ cltrMngNo: '2026-0001-000001', pbctCdtnNo: '123', onbidCltrno: '1979485', prptDivCd: '0007', onbidCltrNm: '인천광역시 부평구 십정동 1 다세대', apslEvlAmt: '100000000', lowstBidPrcIndctCont: '70000000', pbctNsq: '4', pbctStatNm: '낙찰', scfbAmt: '81000000', apslPrcCtrsScfbPrcRto: '81', vldBddrNope: '6', cltrOpbdDt: '202610201100', bldSqms: '45.2' });
  assert.equal(r.id, 'onbid_2026-0001-000001_123');
  assert.equal(r.result.soldPrice, 81000000); assert.equal(r.result.rate, 0.81); assert.equal(r.result.bidders, 6);
  assert.equal(r.bidEnd, '2026-10-20 11:00'); assert.equal(r.sgg, '부평구'); assert.equal(r.category, 'public');
  const f = onbid.mapResultRow({ cltrMngNo: 'x', pbctCdtnNo: '1', prptDivCd: '0013', onbidCltrNm: '서울특별시 강남구 역삼동 1', pbctStatNm: '유찰', scfbAmt: '' });
  assert.equal(f.result.soldPrice, null); assert.equal(f.category, 'bankrupt');
});

test('건축HUB 조회 키와 상업업무용 실거래 압축', async () => {
  const building = require('../src/lib/building');
  assert.deepEqual(building.keyOf('2823710100100120004'), { sigunguCd: '28237', bjdongCd: '10100', platGbCd: '0', bun: '0012', ji: '0004' });
  assert.equal(building.keyOf('2823710100200120004').platGbCd, '1');
  assert.equal(building.hoOf('부평동 1-2 제3층 제301호'), '301');
  const json = (o) => JSON.stringify({ response: { header: { resultCode: '00' }, body: { totalCount: 1, items: { item: o } } } });
  const fetcher = fakeFetch((u) => (u.pathname.includes('getBrTitleInfo') ? json([{ bldNm: '샘플빌라', mainPurpsCdNm: '공동주택', useAprDay: '19950101', grndFlrCnt: '4' }])
    : u.pathname.includes('Expos') ? json([{ exposPubuseGbCdNm: '전유', area: '49.5', mainPurpsCdNm: '다세대주택', flrNoNm: '3층' }, { exposPubuseGbCdNm: '공용', area: '10' }])
      : json([{ archGbCdNm: '신축', archPmsDay: '20260301', platPlc: '인천광역시 부평구 부평동 12-3', mainPurpsCdNm: '공동주택' }])));
  const lg = await building.ledger({ pnu: '2823710100100120004', address: '제301호', serviceKey: 'k', fetcher });
  assert.equal(lg.unit.exclusiveArea, 49.5); assert.ok(lg.age >= 30);
  const pm = await building.permits({ pnu: '2823710100100120004', serviceKey: 'k', fetcher });
  assert.equal(pm.newBuild, 1);
  const trades = require('../src/lib/trades');
  const c = trades.compact('nrg', { dealAmount: '45,000', buildingAr: '60.5', buildingType: '집합', buildingUse: '제2종근린생활', umdNm: '부평동', cdealtype: 'O' });
  assert.equal(c[0], 450000000); assert.equal(c[1], 60.5); assert.equal(c[7], true); assert.equal(c[10], '집합');
});

test('Claude 검토: 원자료·사이트 계산을 보내고 JSON 결과를 읽음', async () => {
  const ai = require('../src/lib/aiReview');
  let sent = null;
  const fetcher = async (url, opt) => { sent = { url, body: JSON.parse(opt.body), headers: opt.headers }; return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '검토 결과입니다\n{"conclusion":"보류","verdict":"보류","agree":[],"disagree":[{"step":"시세","site":"2억","mine":"1.7억","why":"같은 단지 거래 없음"}],"risks":[],"upside":[],"checks":["등기부"],"ruleSuggestions":[{"step":"시세","rule":"D등급이면 매력 제외","why":"근거 약함"}],"confidence":"보통"}' }], usage: { input_tokens: 10 } }) }; };
  const out = await ai.review({ item: { title: 't', appraisal: 1e8, detail: { leases: [] } }, analysis: { verdict: 'now', valuation: { anchors: [{ label: '실거래', value: 2e8, used: true }] } }, apiKey: 'k', fetcher });
  assert.equal(out.verdict, '보류'); assert.equal(out.disagree[0].step, '시세'); assert.equal(out.ruleSuggestions.length, 1);
  assert.equal(sent.headers['x-api-key'], 'k'); assert.ok(sent.body.messages[0].content.includes('[사이트 자동 검토 결과]'));
  await assert.rejects(() => ai.review({ item: {}, analysis: null, apiKey: '' }));
});
