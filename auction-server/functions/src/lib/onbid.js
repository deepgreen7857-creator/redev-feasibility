// 온비드(한국자산관리공사) 차세대 부동산 물건 수집
//  - 수도권(서울·인천·경기) 매각 물건 전부
//  - 파산자산(재산유형 0013)은 전국
// 필요한 API(공공데이터포털 활용신청):
//  · 한국자산관리공사_차세대 온비드 부동산 물건목록 조회서비스   (OnbidRlstListSrvc2/getRlstCltrList2)
//  · 한국자산관리공사_차세대 온비드 부동산 물건상세정보 조회서비스 (OnbidRlstDtlSrvc2/getRlstDtlInf2)
const { call, won, num, text } = require('./dataGoKr');
const { CAPITAL_SIDO } = require('../data/regions');

const ENDPOINTS = {
  list: process.env.ONBID_LIST_URL || 'https://apis.data.go.kr/B010003/OnbidRlstListSrvc2/getRlstCltrList2',
  detail: process.env.ONBID_DETAIL_URL || 'https://apis.data.go.kr/B010003/OnbidRlstDtlSrvc2/getRlstDtlInf2',
  // 물건상세 입찰정보: 이전 회차 입찰결과(낙찰·유찰, 낙찰금액, 감정가 대비 낙찰가율)와 입찰 방법·보증금
  resultList: process.env.ONBID_RESULT_LIST_URL || 'https://apis.data.go.kr/B010003/OnbidCltrBidRsltListSrvc2/getCltrBidRsltList2',
  bid: process.env.ONBID_BID_URL || 'https://apis.data.go.kr/B010003/OnbidCltrBidDtlSrvc2/getCltrBidInf2',
};

// 재산유형: 0007 압류, 0010 국유, 0005 기타일반, 0002 공유, 0003 금융권담보, 0006 유입, 0008 수탁, 0011 공공개발, 0013 파산자산
// (0004 불용품은 동산이라 뺀다)
const PROPERTY_CODES = '0007,0010,0005,0002,0003,0006,0008,0011,0013';
const BANKRUPT_CODE = '0013';
const PAGE_SIZE = 100;
// 상세 해석 판. 바뀌면 예전 판으로 받은 상세를 다시 받는다(2 = 2026.10 실제 항목 이름).
const DETAIL_VERSION = 2;

const PRPT_NAMES = {
  '0007': '압류재산', '0010': '국유재산', '0005': '기타일반재산', '0002': '공유재산', '0003': '금융권담보재산',
  '0006': '유입재산', '0008': '수탁재산', '0011': '공공개발재산', '0013': '파산자산',
};

function ymd(d) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return k.toISOString().slice(0, 10).replace(/-/g, '');
}

// 수집 구간: 수도권 시도 × 수의계약(N/Y) + 파산자산 전국 × (N/Y)
function partitions() {
  const out = [];
  for (const sido of CAPITAL_SIDO) for (const pv of ['N', 'Y']) out.push({ sido, prptDivCd: PROPERTY_CODES, pvctTrgtYn: pv, label: `${sido}/${pv}` });
  for (const pv of ['N', 'Y']) out.push({ sido: null, prptDivCd: BANKRUPT_CODE, pvctTrgtYn: pv, label: `파산자산 전국/${pv}` });
  return out;
}

function onbidDate(v) {
  const s = text(v);
  if (!s || !/^\d{8,14}$/.test(s)) return null;
  const p = (a, b) => s.slice(a, b) || '00';
  return `${p(0, 4)}-${p(4, 6)}-${p(6, 8)}${s.length >= 12 ? ` ${p(8, 10)}:${p(10, 12)}` : ''}`;
}

function listingId(r) {
  return `onbid_${String(r.cltrMngNo).replace(/[^\w-]/g, '')}_${String(r.pbctCdtnNo || '0').replace(/[^\w-]/g, '')}`;
}

// 목록 한 줄 → 사이트 물건 형식
function mapListRow(r) {
  const prpt = text(r.prptDivCd);
  const minBidText = text(r.lowstBidPrcIndctCont);
  return {
    id: listingId(r),
    source: 'onbid',
    category: prpt === BANKRUPT_CODE ? 'bankrupt' : 'public',
    caseNo: text(r.onbidCltrno) || text(r.cltrMngNo),
    cltrMngNo: text(r.cltrMngNo),
    pbctCdtnNo: text(r.pbctCdtnNo),
    noticeNo: text(r.onbidPbancNo),
    court: text(r.orgNm) || '한국자산관리공사',
    title: text(r.onbidCltrNm) || text(r.cltrMngNo),
    propertyType: prpt,
    propertyTypeName: text(r.prptDivNm) || PRPT_NAMES[prpt] || null,
    usage: [text(r.cltrUsgLclsCtgrNm), text(r.cltrUsgMclsCtgrNm), text(r.cltrUsgSclsCtgrNm)].filter(Boolean).join(' > ') || null,
    usageSmall: text(r.cltrUsgSclsCtgrNm),
    address: text(r.zadrNm) || text(r.cltrRadr) || [r.lctnSdnm, r.lctnSggnm, r.lctnEmdNm].filter(Boolean).join(' '),
    sido: text(r.lctnSdnm),
    sgg: text(r.lctnSggnm),
    emd: text(r.lctnEmdNm),
    pnu: validPnu(r.ltnoPnu),
    appraisal: won(r.apslEvlAmt),
    minBid: minBidText && /\d/.test(minBidText) ? won(minBidText) : null,
    minBidText,
    firstPrice: won(r.frstBidPrc),
    failCount: num(r.usbdNft),
    bidCount: num(r.bidPrgnNft),
    round: text(r.pbctNsq),
    bidStart: onbidDate(r.cltrBidBgngDt),
    bidEnd: onbidDate(r.cltrBidEndDt),
    status: text(r.pbctStatNm),
    statusCode: text(r.pbctStatCd),
    disposal: text(r.dspsMthodNm),
    bidMethod: text(r.cptnMthodNm),
    privateContract: text(r.pvctTrgtYn) === 'Y',
    share: text(r.alcYn) === 'Y',
    bulk: text(r.batcBidYn) === 'Y',
    landArea: num(r.landSqms),
    buildingArea: num(r.bldSqms),
    ratioToAppraisal: num(r.apslPrcCtrsLowstBidRto),
    corrected: text(r.crtnYn) === 'Y',
    thumbnail: text(r.thnlImgUrlAdr),
    sourceUpdatedAt: onbidDate(r.mdfcnDt),
    url: 'https://www.onbid.co.kr',
  };
}

const asList = (v) => {
  if (!v) return [];
  const x = v.item ?? v;
  return Array.isArray(x) ? x : typeof x === 'object' ? [x] : [];
};
const clip = (s, n = 2000) => (s ? String(s).slice(0, n) : null);
const meaningful = (s) => Boolean(s && !/^(없음|해당\s*없음|-|무|N)$/.test(String(s).trim()));
// 사진·지도 주소: potoUrlList 는 [{urlAdr}] 배열, lrmUrlAdrList 는 '|'로 이은 글자로 온다(2026.10 실제 응답)
const urlsOf = (v) => (Array.isArray(v) ? v.map((x) => text(x && typeof x === 'object' ? x.urlAdr : x)) : (text(v) || '').split('|').map((s) => s.trim())).filter(Boolean);
const ymd8 = (v) => { const m = String(text(v) || '').match(/(\d{4})[./-]?(\d{2})[./-]?(\d{2})/); return m ? `${m[1]}${m[2]}${m[3]}` : null; };
const validPnu = (v) => { const s = text(v); return s && /^\d{19}$/.test(s) && !/0{8}$/.test(s) ? s : null; };

// 상세(getRlstDtlInf2) 한 줄 → 권리분석 기초자료. 항목 이름은 2026.10 실제 응답 기준.
//  권리(등기): rgstPrmrInfList [{irstDivNm 권리종류, cltrInprNm 권리자, rgstYmd, inprStngAmt}]
//  임차·점유: leasInfList [{irstDivNm, cltrInprNm, bidGrteeAmt 보증금, mthrAmt 월세, convGrteeAmt, cfmtnYmd 확정일자, mvinYmd 전입일}]
//  면적: sqmsList [{clandCont '토지>대', sqmsCont, pursAlcCont, dtlCltrNm}] · 감정: apslEvlClgList [{apslEvlYmd, apslEvlOrgNm, apslEvlAmt, urlAdr}]
//  회차 목록·법정지상권·인수권리 전용 항목은 없다 → 유의사항 글에서 찾는다.
function mapDetail(d) {
  const rights = asList(d.rgstPrmrInfList).map((x) => ({
    kind: text(x.irstDivNm), holder: text(x.cltrInprNm), date: ymd8(x.rgstYmd), amount: won(x.inprStngAmt) || null,
  }));
  const leases = asList(d.leasInfList).map((x) => ({
    kind: text(x.irstDivNm), tenant: text(x.cltrInprNm), deposit: won(x.bidGrteeAmt) || won(x.convGrteeAmt) || null,
    rent: won(x.mthrAmt) || null, moveIn: ymd8(x.mvinYmd), fixedDate: ymd8(x.cfmtnYmd), claimed: null,
  }));
  const occupants = asList(d.ocpyRelList).map((x) => ({ kind: text(x.irstDivNm), name: text(x.cltrInprNm), moveIn: ymd8(x.mvinYmd) }));
  const areas = asList(d.sqmsList).map((x) => ({ kind: text(x.clandCont), area: text(x.sqmsCont), share: text(x.pursAlcCont) || text(x.dtlCltrNm) }));
  const appraisals = asList(d.apslEvlClgList).map((x) => ({ date: ymd8(x.apslEvlYmd), org: text(x.apslEvlOrgNm), amount: won(x.apslEvlAmt), file: text(x.urlAdr) }));
  const landRow = areas.find((a) => /^토지/.test(a.kind || ''));
  const notes = [d.pytnMtrsCont, d.icdlCdtnCont, d.dsplVldCont, d.cltrEtcCont].map(text).filter(Boolean).join('\n');
  const superficies = (notes.match(/[^.\n]*법정지상권[^.\n]*/) || [])[0] || null;
  const surviving = (notes.match(/[^.\n]*(인수|대항력|선순위)[^.\n]*/) || [])[0] || null;
  // 실제 임차 정보(보증금·전입·확정일자 중 하나라도)가 있는 줄만 임차인으로 센다. 전부 빈 줄은 '조사 안 됨' 표시용.
  const realLeases = leases.filter((l) => l.deposit || l.rent || l.moveIn || l.fixedDate);
  return {
    addressFull: text(d.zadrNm) || text(d.onbidCltrNm),
    roadAddress: text(d.cltrRadr),
    pnu: validPnu(d.ltnoPnu),
    landCategory: landRow ? landRow.kind.split('>').pop() : null,
    areas,
    firstNoticeDate: ymd8(d.frstPbancYmd),
    distributionDeadline: ymd8(d.dtbtRqrEdtmCont),
    requestOrg: text(d.rqstOrgNm),
    bidMethod: [text(d.bidDivNm), text(d.cptnMthodNm), text(d.bidMthodNm)].filter(Boolean).join(' · ') || null,
    appraisalDate: appraisals[0] ? appraisals[0].date : null,
    appraisalOrg: appraisals[0] ? appraisals[0].org : null,
    appraisalFile: (appraisals.find((a) => a.file) || {}).file || null,
    appraisals,
    usageStatus: clip(text(d.utlzPscdCont)),
    location: clip(text(d.locVntyPscdCont)),
    deliveryDuty: clip(text(d.evcRsbyTrgtCont)),
    cautions: clip(text(d.pytnMtrsCont)),
    conditions: clip(text(d.icdlCdtnCont)),
    extraNotes: clip(text(d.dsplVldCont) || text(d.cltrEtcCont)),
    buyerQualification: clip(text(d.purrQlfcCont)),
    shareText: clip(areas.map((a) => a.share).filter(Boolean).join(' / ') || null),
    superficies: clip(superficies),
    survivingRights: clip(surviving),
    rights, leases, occupants, rounds: [],
    photos: urlsOf(d.potoUrlList).slice(0, 8),
    mapUrls: urlsOf(d.lrmUrlAdrList).slice(0, 5),
    flags: {
      superficies: Boolean(superficies),
      survivingRights: Boolean(surviving),
      tenants: realLeases.length,
      tenantsUnknown: leases.length - realLeases.length,
      unclaimedTenants: null, // 배분요구 여부는 상세 API에 없음
      qualification: meaningful(text(d.purrQlfcCont)),
      share: text(d.alcYn) === 'Y',
    },
  };
}

async function fetchListPage({ part, pageNo, serviceKey, quota, fetcher, modifiedSince }) {
  return call({
    api: 'onbid-list', url: ENDPOINTS.list, serviceKey, quota, fetcher,
    params: {
      pageNo, numOfRows: PAGE_SIZE, resultType: 'json',
      prptDivCd: part.prptDivCd, pvctTrgtYn: part.pvctTrgtYn, dspsMthodCd: '0001',
      lctnSdnm: part.sido || undefined,
      mdfcnYmdStart: modifiedSince || undefined,
      mdfcnYmdEnd: modifiedSince ? ymd(new Date()) : undefined,
    },
  });
}

// raw: true 면 해석 전 원본 줄을 돌려준다(관리자 API 연결 시험용)
async function fetchDetail({ cltrMngNo, pbctCdtnNo, serviceKey, quota, fetcher, raw = false }) {
  const r = await call({
    api: 'onbid-detail', url: ENDPOINTS.detail, serviceKey, quota, fetcher,
    params: { pageNo: 1, numOfRows: 10, resultType: 'json', cltrMngNo, pbctCdtnNo },
  });
  if (raw) return r.rows[0] || null;
  return r.rows[0] ? mapDetail(r.rows[0]) : null;
}

// 전체 수집. mode: 'daily'(어제 이후 수정분) | 'full'(전부)
// backfill: 예전에 상세를 못 받은 물건 목록을 돌려주는 함수(평일 수집 뒤 남은 상세 한도로 다시 받는다)
async function collect({ serviceKey, quota, fetcher, mode = 'daily', save, log = console.log, maxDetails = 600, maxBackfill = 400, deadline = Infinity, enrich, backfill }) {
  const since = mode === 'daily' ? ymd(new Date(Date.now() - 2 * 86400e3)) : null;
  const stats = { pages: 0, rows: 0, saved: 0, details: 0, errors: [] };
  const fresh = [];
  for (const part of partitions()) {
    let pageNo = 1;
    for (;;) {
      if (Date.now() > deadline) return { ...stats, stopped: 'time' };
      let page;
      try {
        page = await fetchListPage({ part, pageNo, serviceKey, quota, fetcher, modifiedSince: since });
      } catch (e) {
        stats.errors.push(`${part.label} p${pageNo}: ${e.message}`);
        if (e.code === '22') { log('온비드 목록 한도 도달 — 다음 실행에서 이어 받음'); return { ...stats, stopped: 'quota' }; }
        break;
      }
      stats.pages++;
      const items = page.rows.filter((r) => r.cltrMngNo).map(mapListRow);
      stats.rows += items.length;
      if (items.length) {
        const res = await save(items);
        stats.saved += items.length;
        fresh.push(...(res && res.needDetail ? res.needDetail : items));
      }
      if (!page.rows.length || pageNo * PAGE_SIZE >= page.total) break;
      pageNo++;
    }
  }
  // 새로 들어왔거나 바뀐 물건 상세 조회(권리·사진). 정비구역·부평·계양·파산자산 먼저.
  const ctx = { serviceKey, quota, fetcher, save, enrich, deadline, stats };
  fresh.sort((a, b) => score(b) - score(a));
  const done = new Set();
  const stop1 = await fetchDetails(fresh.slice(0, maxDetails), ctx, done);
  if (stop1 === 'time') return { ...stats, stopped: 'time' };
  // 평일(daily) 수집 뒤: 상세가 빠진 물건을 남은 상세 호출 한도 안에서 다시 받는다
  if (mode === 'daily' && backfill && stop1 !== 'quota') {
    const left = quota ? await quota.remaining('onbid-detail') : maxBackfill;
    if (left > 0) {
      // 상세가 아예 없는 물건 먼저, 그다음 예전 판으로 받은 물건
      const rank = (it) => (it.detailAt ? 0 : 10) + score(it);
      const pending = (await backfill()).filter((it) => !done.has(it.id)).sort((a, b) => rank(b) - rank(a));
      const before = stats.details;
      stats.backfillPending = pending.length;
      const stop2 = await fetchDetails(pending.slice(0, Math.min(left, maxBackfill)), ctx, done);
      stats.backfilled = stats.details - before;
      if (stop2 === 'time') return { ...stats, stopped: 'time' };
    }
  }
  return stats;
}

// 상세를 받아 저장하고 토지이용(정비구역)·주택 공시가격을 붙인다. 멈춘 까닭('time' | 'quota')을 돌려준다.
async function fetchDetails(items, { serviceKey, quota, fetcher, save, enrich, deadline, stats }, done) {
  for (const item of items) {
    if (Date.now() > deadline) return 'time';
    done.add(item.id);
    try {
      const detail = await fetchDetail({ cltrMngNo: item.cltrMngNo, pbctCdtnNo: item.pbctCdtnNo, serviceKey, quota, fetcher });
      const now = new Date().toISOString();
      if (!detail) { await save([{ id: item.id, detailEmptyAt: now }], { merge: true }); continue; }
      const extra = {};
      const pnu = item.pnu || detail.pnu;
      if (pnu && !item.pnu) extra.pnu = pnu;
      // 필지번호가 없으면 enrich 가 주소로 찾는다
      if (enrich) { try { Object.assign(extra, await enrich({ ...item, pnu, detail })); } catch (e) { stats.errors.push(`브이월드 ${item.id}: ${e.message}`); } }
      await save([{ id: item.id, detail, detailAt: now, detailVer: DETAIL_VERSION, ...extra }], { merge: true });
      stats.details++;
    } catch (e) {
      stats.errors.push(`상세 ${item.id}: ${e.message}`);
      if (e.code === '22') return 'quota';
    }
  }
  return null;
}

// 상세 조회 우선순위: 정비구역 +3, 부평·계양 +2, 파산자산 +1
// 집중 지역(2026-10-26 인천 서구 가좌동·석남동)은 원문을 가장 먼저 받는다 — 판정 가능한 물건을 먼저 100%로
const FOCUS = { sido: '인천광역시', sgg: /서구|서해구/, emd: /(가좌동|석남동)(\s|\d|,|\)|$)/ };
function inFocus(item) {
  const t = `${item.sgg || ''} ${item.emd || ''} ${item.title || ''} ${item.address || ''}`;
  return item.sido === FOCUS.sido && FOCUS.sgg.test(t) && FOCUS.emd.test(t);
}
function score(item) {
  let s = inFocus(item) ? 100 : 0;
  // 입찰일이 가까운 것 먼저(2주 안 +5, 4주 안 +2)
  const end = String(item.bidEnd || '').replace(/\./g, '-').slice(0, 10);
  if (end) { const d = (new Date(end) - Date.now()) / 86400e3; if (d >= -1 && d <= 14) s += 5; else if (d <= 28) s += 2; }
  const redev = item.land && item.land.landUse && item.land.landUse.redevelopment;
  if (Array.isArray(redev) && redev.length) s += 3;
  if (/부평구|계양구/.test(item.sgg || '')) s += 2;
  if (item.category === 'bankrupt') s += 1;
  return s;
}

// ── 입찰 결과 ───────────────────────────────────────────────
const arr = (v) => (Array.isArray(v) ? v : v && Array.isArray(v.listItem) ? v.listItem : v && v.listItem ? [v.listItem] : v && typeof v === 'object' ? [v] : []);
const amount = (v) => { const n = Number(String(v ?? '').split('|')[0].replace(/[^\d]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
const ymdhm = (v) => { const t = text(v); return t && /^\d{12}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${t.slice(8, 10)}:${t.slice(10, 12)}` : t || null; };

function mapBidInfo(r) {
  const history = arr(r.prcnBidClgList).map((h) => ({
    round: text(h.pbctNsq), openAt: ymdhm(h.cltrOpbdDt), status: text(h.pbctStatNm),
    minBid: amount(h.lowstBidPrcIndctCont), soldPrice: amount(h.scfbAmt),
    rateToAppraisal: num(h.apslPrcCtrsLowstBidRto), rateToMinBid: num(h.frstCtrsLowstBidPrcRto),
  }));
  return {
    round: text(r.pbctNsq), failCount: num(r.usbdNft),
    prevResult: text(r.prcnNsqBidRsltNm), prevMinBid: amount(r.prcnNsqLowstBidPrc),
    deposit: text(r.pbctTdpsCont), payTerm: text(r.pcmtPayTermCont), coBid: text(r.collbBidPsblYn) === 'Y', proxyBid: text(r.subtBidPsblYn) === 'Y',
    nextRankApply: text(r.nrnkAplyPsblYn) === 'Y', bidCondition: text(r.bidVldCrtrCont), qualification: text(r.qlfcLmtCdtnCont) || text(r.bidPtctAplyDcmtCont) || null,
    history,
  };
}

async function fetchBidInfo({ cltrMngNo, pbctCdtnNo, serviceKey, quota, fetcher }) {
  const r = await call({ api: 'onbid-bid', url: ENDPOINTS.bid, serviceKey, quota, fetcher, params: { pageNo: 1, numOfRows: 10, resultType: 'json', cltrMngNo, pbctCdtnNo } });
  return r.rows[0] ? mapBidInfo(r.rows[0]) : null;
}

// 이 물건(이 회차)의 결과: 이력에서 같은 회차 → 없으면 가장 최근의 낙찰/유찰
function resultFor(item, info) {
  if (!info) return null;
  const done = info.history.filter((h) => /(낙찰|유찰|취소)/.test(h.status || ''));
  const hit = done.find((h) => item.round && String(h.round) === String(item.round)) || null;
  if (!hit) return null;
  return {
    status: hit.status, soldPrice: /낙찰/.test(hit.status) ? hit.soldPrice : null,
    rate: hit.rateToAppraisal ? hit.rateToAppraisal / 100 : null, minBid: hit.minBid || item.minBid || null,
    openAt: hit.openAt, source: '온비드 물건상세 입찰정보', at: new Date().toISOString(),
  };
}

// ── 물건 입찰결과목록: 개찰일 기간·시도로 끝난 물건 전체(낙찰가·낙찰가율·유효입찰자수) ──
// 물건명 앞부분이 지번 주소: '경기도 수원시 영통구 매탄동 123 ...' → 시도·시군구·읍면동
function placeOf(name) {
  const p = String(name || '').trim().split(/\s+/);
  const sido = p[0] || null;
  let i = 1; let sgg = p[1] || null;
  if (p[1] && /시$/.test(p[1]) && p[2] && /구$/.test(p[2])) { sgg = `${p[1]} ${p[2]}`; i = 2; }
  const emd = p.slice(i + 1).find((t) => /[동읍면가리]$/.test(t) && !/^\d/.test(t)) || null;
  return { sido, sgg, emd };
}

function mapResultRow(r) {
  const name = text(r.onbidCltrNm);
  const pl = placeOf(name);
  const status = text(r.pbctStatNm);
  const sold = /낙찰/.test(status || '') ? amount(r.scfbAmt) : null;
  const prpt = text(r.prptDivCd);
  return {
    id: listingId(r), source: 'onbid', category: prpt === BANKRUPT_CODE ? 'bankrupt' : 'public',
    caseNo: text(r.onbidCltrno) || text(r.cltrMngNo), cltrMngNo: text(r.cltrMngNo), pbctCdtnNo: text(r.pbctCdtnNo),
    title: name, propertyType: prpt, propertyTypeName: text(r.prptDivNm) || PRPT_NAMES[prpt] || null,
    usage: [text(r.cltrUsgLclsCtgrNm), text(r.cltrUsgMclsCtgrNm), text(r.cltrUsgSclsCtgrNm)].filter(Boolean).join(' > ') || null,
    usageSmall: text(r.cltrUsgSclsCtgrNm), address: name, ...pl,
    appraisal: num(r.apslEvlAmt), minBid: amount(r.lowstBidPrcIndctCont), round: text(r.pbctNsq),
    landArea: num(r.landSqms), buildingArea: num(r.bldSqms), bidEnd: ymdhm(r.cltrOpbdDt), status,
    url: 'https://www.onbid.co.kr',
    result: {
      status, soldPrice: sold, rate: num(r.apslPrcCtrsScfbPrcRto) ? num(r.apslPrcCtrsScfbPrcRto) / 100 : (sold && num(r.apslEvlAmt) ? sold / num(r.apslEvlAmt) : null),
      rateToMinBid: num(r.lowstBidCtrsScfbPrcRto) ? num(r.lowstBidCtrsScfbPrcRto) / 100 : null,
      bidders: num(r.vldBddrNope), invalidBidders: num(r.nfctBddrNope), minBid: amount(r.lowstBidPrcIndctCont),
      openAt: ymdhm(r.cltrOpbdDt), source: '온비드 물건 입찰결과목록', at: new Date().toISOString(),
    },
  };
}

async function fetchResultPage({ sido, prptDivCd, from, to, pageNo, serviceKey, quota, fetcher }) {
  return call({
    api: 'onbid-result-list', url: ENDPOINTS.resultList, serviceKey, quota, fetcher,
    params: { pageNo, numOfRows: PAGE_SIZE, resultType: 'json', cltrTypeCd: '0001', prptDivCd, dspsMthodCd: '0001', lctnSdnm: sido || undefined, opbdDtStart: from, opbdDtEnd: to },
  });
}

module.exports = { inFocus, score, placeOf, mapResultRow, fetchResultPage, CAPITAL_SIDO, mapBidInfo, fetchBidInfo, resultFor, DETAIL_VERSION, validPnu, ENDPOINTS, PROPERTY_CODES, BANKRUPT_CODE, partitions, mapListRow, mapDetail, fetchListPage, fetchDetail, fetchDetails, collect, listingId, score };
