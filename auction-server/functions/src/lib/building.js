// 건축HUB(국토교통부): 건축물대장(표제부·전유부)과 건축인허가
//  - 대장: 법원·온비드에서 읽은 면적·용도·사용승인일이 맞는지 교차 확인, 오래된 집(올수리 대상) 판단
//  - 인허가: 같은 법정동의 최근 신축 허가 — 도로·맹지 물건의 '주변 개발 움직임'
const { call, num, text } = require('./dataGoKr');

const BASE = 'https://apis.data.go.kr/1613000';
const URL = {
  title: `${BASE}/BldRgstHubService/getBrTitleInfo`,
  expos: `${BASE}/BldRgstHubService/getBrExposPubuseAreaInfo`,
  permit: `${BASE}/ArchPmsHubService/getApBasisOulnInfo`,
};

// PNU 19자리 → 대장 조회 키: 시군구(5)·법정동(5)·대지구분(0 대지, 1 산)·번(4)·지(4)
function keyOf(pnu) {
  const p = String(pnu || '');
  if (!/^\d{19}$/.test(p)) return null;
  return { sigunguCd: p.slice(0, 5), bjdongCd: p.slice(5, 10), platGbCd: p[10] === '2' ? '1' : '0', bun: p.slice(11, 15), ji: p.slice(15, 19) };
}

const ymd = (v) => { const t = text(v); return t && /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t || null; };

function hoOf(address) {
  const m = String(address || '').match(/제?\s*(\d{1,5})\s*호/);
  return m ? m[1] : null;
}
function dongOf(address) {
  const m = String(address || '').match(/제?\s*([\dA-Z가-힣]{1,4})\s*동(?=\s|제|\d|$)/);
  return m ? m[1] : null;
}

// 건축물대장: 표제부(동별) + 주소에 호가 있으면 그 호의 전유면적
async function ledger({ pnu, address, serviceKey, quota, fetcher }) {
  const k = keyOf(pnu);
  if (!k) return null;
  const t = await call({ api: 'bld-ledger', url: URL.title, serviceKey, quota, fetcher, params: { ...k, numOfRows: 50, pageNo: 1, _type: 'json' } });
  const titles = t.rows.map((r) => ({
    bldNm: text(r.bldNm), dongNm: text(r.dongNm), kind: text(r.regstrKindCdNm), mainPurpose: text(r.mainPurpsCdNm), etcPurpose: text(r.etcPurps),
    useApr: ymd(r.useAprDay), permit: ymd(r.pmsDay), totArea: num(r.totArea), platArea: num(r.platArea), archArea: num(r.archArea),
    bcRat: num(r.bcRat), vlRat: num(r.vlRat), floors: num(r.grndFlrCnt), basements: num(r.ugrndFlrCnt), households: num(r.hhldCnt), units: num(r.hoCnt), structure: text(r.strctCdNm),
  }));
  let unit = null;
  const ho = hoOf(address);
  if (ho) {
    const dong = dongOf(address);
    const e = await call({ api: 'bld-ledger', url: URL.expos, serviceKey, quota, fetcher, params: { ...k, hoNm: `${ho}호`, ...(dong ? { dongNm: `${dong}동` } : {}), numOfRows: 50, pageNo: 1, _type: 'json' } });
    const rows = e.rows.filter((r) => /전유/.test(text(r.exposPubuseGbCdNm) || ''));
    if (rows.length) unit = { ho, dong, exclusiveArea: Math.round(rows.reduce((s, r) => s + (num(r.area) || 0), 0) * 100) / 100, purpose: text(rows[0].mainPurpsCdNm), floor: text(rows[0].flrNoNm) };
  }
  const oldest = titles.map((x) => x.useApr).filter(Boolean).sort()[0] || null;
  return { titles: titles.slice(0, 10), unit, useApr: oldest, age: oldest ? new Date().getFullYear() - Number(oldest.slice(0, 4)) : null, checkedAt: new Date().toISOString() };
}

// 건축인허가: 같은 법정동에서 최근 2년간 난 허가(신축 위주)
async function permits({ pnu, serviceKey, quota, fetcher, years = 2 }) {
  const k = keyOf(pnu);
  if (!k) return null;
  const from = new Date(Date.now() - years * 365 * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
  const rows = [];
  for (let pageNo = 1; pageNo <= 3; pageNo++) {
    const r = await call({ api: 'bld-permit', url: URL.permit, serviceKey, quota, fetcher, params: { sigunguCd: k.sigunguCd, bjdongCd: k.bjdongCd, startDate: from, numOfRows: 100, pageNo, _type: 'json' } });
    rows.push(...r.rows);
    if (!r.rows.length || pageNo * 100 >= r.total) break;
  }
  const list = rows.map((r) => ({
    kind: text(r.archGbCdNm), purpose: text(r.mainPurpsCdNm), place: text(r.platPlc), name: text(r.bldNm),
    permitDay: ymd(r.archPmsDay), startDay: ymd(r.realStcnsDay), totArea: num(r.totArea), households: num(r.hhldCnt),
  })).filter((x) => !x.permitDay || x.permitDay.replace(/-/g, '') >= from);
  const newBuild = list.filter((x) => /신축/.test(x.kind || ''));
  const sameBun = list.filter((x) => x.place && x.place.includes(` ${Number(k.bun)}`));
  return {
    years, total: list.length, newBuild: newBuild.length, nearby: sameBun.length,
    recent: newBuild.sort((a, b) => String(b.permitDay).localeCompare(String(a.permitDay))).slice(0, 8),
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { keyOf, hoOf, ledger, permits, URL };
