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
};

// 재산유형: 0007 압류, 0010 국유, 0005 기타일반, 0002 공유, 0003 금융권담보, 0006 유입, 0008 수탁, 0011 공공개발, 0013 파산자산
// (0004 불용품은 동산이라 뺀다)
const PROPERTY_CODES = '0007,0010,0005,0002,0003,0006,0008,0011,0013';
const BANKRUPT_CODE = '0013';
const PAGE_SIZE = 100;

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
    pnu: text(r.ltnoPnu),
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

// 상세 → 권리분석 기초자료
function mapDetail(d) {
  const rights = asList(d.rgstPrmrInfList).map((x) => ({
    kind: text(x.rgstPrmrInfCont || x.rgstKndNm || x.rgtKndNm), holder: text(x.acpmPrptBondDclFlnm || x.rgtrNm),
    date: text(x.rgstYmd || x.stngYmd), amount: won(x.bondDclrStngAmt || x.inprStngAmt || x.stngAmt),
  }));
  const leases = asList(d.leasInfList).map((x) => ({
    tenant: text(x.acpmPrptOcpyIrpsFlnm), part: text(x.lsdPartCont), deposit: won(x.acpmGrteeAmt || x.convGrteeAmt),
    rent: won(x.mthrAmt || x.rntAmt), moveIn: text(x.mvinYmd), fixedDate: text(x.cfmtnYmd), claimed: text(x.dtbtRqrYn) === 'Y',
  }));
  const occupants = asList(d.ocpyRelList).map((x) => ({ name: text(x.acpmPrptOcpyIrpsFlnm), part: text(x.lsdPartCont), moveIn: text(x.mvinYmd) }));
  const rounds = asList(d.bidInfList || d.pbctCdtnList).map((x) => ({
    round: text(x.pbctNsq), start: onbidDate(x.cltrBidBgngDt), end: onbidDate(x.cltrBidEndDt), minBid: won(x.lowstBidPrcIndctCont || x.lowstBidPrc), open: text(x.opbdYmd),
  }));
  const superficies = text(d.sttyEbrVldCont);
  const surviving = text(d.ersrExclRgtCont);
  return {
    addressFull: text(d.zadr) || text(d.cltrRadr),
    roadAddress: text(d.cltrRadr),
    landCategory: text(d.clandCont),
    firstNoticeDate: text(d.frstPbancYmd),
    openDate: text(d.opbdYmd),
    plannedPrice: won(d.pbctEspc),
    deposit: text(d.pbctTdps),
    appraisalDate: text(d.apslEvlYmd),
    appraisalFile: text(d.urlAdr),
    usageStatus: clip(text(d.utlzPscdCont)),
    location: clip(text(d.locVntyPscdCont)),
    deliveryDuty: clip(text(d.evcRsbyTrgtCont)),
    cautions: clip(text(d.pytnMtrsCont)),
    conditions: clip(text(d.icdlCdtnCont)),
    buyerQualification: clip(text(d.purrQlfcCont)),
    shareText: clip(text(d.alcCont || d.pursAlcCont)),
    superficies: clip(superficies),
    survivingRights: clip(surviving),
    extinguished: clip(text(d.dsplVldCont)),
    rights, leases, occupants, rounds,
    photos: (text(d.potoUrlList) || '').split('|').filter(Boolean).slice(0, 8),
    mapUrls: (text(d.lrmUrlAdrList) || '').split('|').filter(Boolean).slice(0, 3),
    flags: {
      superficies: meaningful(superficies),
      survivingRights: meaningful(surviving),
      tenants: leases.length,
      unclaimedTenants: leases.filter((l) => !l.claimed).length,
      qualification: meaningful(text(d.purrQlfcCont)),
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

async function fetchDetail({ cltrMngNo, pbctCdtnNo, serviceKey, quota, fetcher }) {
  const r = await call({
    api: 'onbid-detail', url: ENDPOINTS.detail, serviceKey, quota, fetcher,
    params: { pageNo: 1, numOfRows: 10, resultType: 'json', cltrMngNo, pbctCdtnNo },
  });
  return r.rows[0] ? mapDetail(r.rows[0]) : null;
}

// 전체 수집. mode: 'daily'(어제 이후 수정분) | 'full'(전부)
async function collect({ serviceKey, quota, fetcher, mode = 'daily', save, log = console.log, maxDetails = 600, deadline = Infinity, enrich }) {
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
  // 새로 들어왔거나 바뀐 물건만 상세 조회(권리 정보). 파산자산·부평·계양을 먼저.
  fresh.sort((a, b) => score(b) - score(a));
  for (const item of fresh.slice(0, maxDetails)) {
    if (Date.now() > deadline) return { ...stats, stopped: 'time' };
    try {
      const detail = await fetchDetail({ cltrMngNo: item.cltrMngNo, pbctCdtnNo: item.pbctCdtnNo, serviceKey, quota, fetcher });
      if (detail) {
        const extra = {};
        // 토지이용(정비구역 여부)·주택 공시가격을 함께 붙인다(법인 취득세 판정용)
        if (enrich && item.pnu) { try { Object.assign(extra, await enrich({ ...item, detail })); } catch (e) { stats.errors.push(`브이월드 ${item.id}: ${e.message}`); } }
        await save([{ id: item.id, detail, detailAt: new Date().toISOString(), ...extra }], { merge: true }); stats.details++;
      }
    } catch (e) {
      stats.errors.push(`상세 ${item.id}: ${e.message}`);
      if (e.code === '22') break;
    }
  }
  return stats;
}

function score(item) {
  let s = 0;
  if (item.category === 'bankrupt') s += 3;
  if (/부평구|계양구/.test(item.sgg || '')) s += 2;
  if (item.statusCode === '0002' || item.statusCode === '0001') s += 1;
  return s;
}

module.exports = { ENDPOINTS, PROPERTY_CODES, BANKRUPT_CODE, partitions, mapListRow, mapDetail, fetchListPage, fetchDetail, collect, listingId };
