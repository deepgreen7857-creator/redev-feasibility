// 국토교통부 실거래가(매매) 수집 — 수도권 시군구 × 월 단위.
// 저장은 (종류·시군구·월) 한 묶음당 문서 1개(tradeMonths)로 해서 쓰기 횟수와 요금을 줄인다.
const { call, num, text } = require('./dataGoKr');
const { REGIONS, PRIORITY_CODES } = require('../data/regions');

const BASE = 'https://apis.data.go.kr/1613000';
const TYPES = {
  apt: { name: '아파트', api: 'rt-apt', url: `${BASE}/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev`, fallback: `${BASE}/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade` },
  rh: { name: '연립다세대', api: 'rt-rh', url: `${BASE}/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade` },
  sh: { name: '단독/다가구', api: 'rt-sh', url: `${BASE}/RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade` },
  offi: { name: '오피스텔', api: 'rt-offi', url: `${BASE}/RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade` },
  land: { name: '토지', api: 'rt-land', url: `${BASE}/RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade` },
  // 분양권·입주권(활용신청: 국토교통부_아파트 분양권전매 신고 자료) — 정비구역 입주권 가치 비교용
  silv: { name: '분양권·입주권', api: 'rt-silv', url: `${BASE}/RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade` },
};

// 한 건 → 압축 형식 [가격(원), 면적㎡, 층, 일, 지번, 이름, 건축년도, 해제여부, 거래유형, 읍면동, 추가]
function compact(type, r) {
  const amount = num(String(r.dealAmount || '').replace(/,/g, '')) ;
  const won = amount === null ? null : amount * 10000;
  let area = null; let extra = null;
  if (type === 'apt' || type === 'offi' || type === 'rh' || type === 'silv') area = num(r.excluUseAr);
  if (type === 'silv') extra = text(r.ownershipGbn) || text(r.ownershipGbnNm);
  if (type === 'rh') extra = num(r.landAr);
  if (type === 'sh') { area = num(r.totalFloorAr); extra = num(r.plottageAr); }
  if (type === 'land') { area = num(r.dealArea); extra = text(r.jimok); }
  const name = text(r.aptNm) || text(r.mhouseNm) || text(r.offiNm) || text(r.houseType) || text(r.landUse) || null;
  return [
    won, area, num(r.floor), num(r.dealDay), text(r.jibun), name, num(r.buildYear),
    text(r.cdealType) === 'O' || Boolean(text(r.cdealDay)), text(r.dealingGbn), text(r.umdNm), extra,
  ];
}

function ymList(months, from = new Date()) {
  const k = new Date(from.getTime() + 9 * 3600e3);
  const out = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function fetchMonth({ type, lawd, ym, serviceKey, quota, fetcher }) {
  const t = TYPES[type];
  const deals = [];
  let pageNo = 1; let total = 0;
  for (;;) {
    const page = await call({ api: t.api, url: t.url, serviceKey, quota, fetcher, params: { LAWD_CD: lawd, DEAL_YMD: ym, pageNo, numOfRows: 1000 } });
    total = page.total;
    deals.push(...page.rows.map((r) => compact(type, r)));
    if (!page.rows.length || pageNo * 1000 >= total) break;
    pageNo++;
  }
  return deals;
}

// 계획 세우기: 최근 2개월은 매일 다시 받고(신고 지연분), 그 이전은 backfillMonths까지 한 번만 받는다.
function plan({ type, done, backfillMonths = 12, codes }) {
  const regionCodes = codes || REGIONS.map((r) => r.code);
  const ordered = [...PRIORITY_CODES.filter((c) => regionCodes.includes(c)), ...regionCodes.filter((c) => !PRIORITY_CODES.includes(c))];
  const months = ymList(backfillMonths);
  const recent = months.slice(0, 2);
  const jobs = [];
  for (const ym of recent) for (const lawd of ordered) jobs.push({ type, lawd, ym, recent: true });
  for (const ym of months.slice(2)) for (const lawd of ordered) if (!done[`${lawd}_${ym}`]) jobs.push({ type, lawd, ym, recent: false });
  return jobs;
}

async function collect({ serviceKey, quota, fetcher, getProgress, saveMonth, saveProgress, backfillMonths = 12, types = Object.keys(TYPES), log = console.log, codes, deadline = Infinity }) {
  const summary = {};
  for (const type of types) {
    if (Date.now() > deadline) { summary[type] = { stopped: 'time' }; continue; }
    const progress = (await getProgress(type)) || { done: {}, empty: {} };
    const jobs = plan({ type, done: progress.done || {}, backfillMonths, codes });
    let ok = 0; let stopped = null; const errors = [];
    for (const job of jobs) {
      if (Date.now() > deadline) { stopped = 'time'; break; }
      if (quota && (await quota.remaining(TYPES[type].api)) <= 0) { stopped = 'quota'; break; }
      try {
        const deals = await fetchMonth({ ...job, serviceKey, quota, fetcher });
        await saveMonth({ type, lawd: job.lawd, ym: job.ym, deals });
        if (!job.recent) progress.done[`${job.lawd}_${job.ym}`] = true;
        if (!deals.length) progress.empty = { ...(progress.empty || {}), [job.lawd]: (progress.empty?.[job.lawd] || 0) + 1 };
        ok++;
      } catch (e) {
        errors.push(`${job.lawd} ${job.ym}: ${e.message}`);
        if (e.code === '22') { stopped = 'quota'; break; }
        if (e.code === 'NO_KEY' || e.code === '30' || e.code === '20') { stopped = e.message; break; } // 키 오류·미승인
      }
    }
    progress.updatedAt = new Date().toISOString();
    progress.remaining = Math.max(0, jobs.length - ok);
    await saveProgress(type, progress);
    summary[type] = { planned: jobs.length, ok, stopped, errors: errors.slice(0, 10) };
    log(`${TYPES[type].name}: ${ok}/${jobs.length}${stopped ? ` (중단: ${stopped})` : ''}`);
  }
  return summary;
}

module.exports = { TYPES, compact, ymList, plan, fetchMonth, collect };
