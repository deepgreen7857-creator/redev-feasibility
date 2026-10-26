// 같은 물건의 여러 회차(공매는 회차마다 따로 공고 번호가 붙는다)를 한 줄로 합친다.
//  · 고르는 회차: 오늘 이후 가장 가까운 회차(없으면 가장 최근 회차)
//  · roundList: 고른 회차부터의 회차별 날짜·최저가(일정표·진입 회차에 씀)
//  · 호가: 어느 회차에 넣었든 같은 집의 호가이므로, 가장 최근에 넣은 호가를 고른 회차에 붙인다
//    (전에는 10-28 회차에 넣은 호가가 11-04 회차에서는 안 보여 같은 집을 또 확인하게 됐다)
const KST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

export const roundKey = (it) => `${it.source}|${it.caseNo || it.id}|${it.address || it.title}`;

export function dedupeRounds(items, today = KST()) {
  const groups = new Map();
  items.forEach((it) => {
    const key = roundKey(it);
    const g = groups.get(key);
    if (g) g.push(it); else groups.set(key, [it]);
  });
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const end = (x) => String(x.bidEnd || '').replace(/\./g, '-').slice(0, 10);
    const upcoming = g.filter((x) => end(x) >= today).sort((p, q) => end(p).localeCompare(end(q)));
    const pick = upcoming[0] || [...g].sort((p, q) => end(q).localeCompare(end(p)))[0];
    const roundList = upcoming.map((x) => ({ bidEnd: x.bidEnd, minBid: x.minBid, id: x.id }));
    const asks = g.map((x) => x.manual?.asking).filter((a) => a?.at).sort((p, q) => String(q.at).localeCompare(String(p.at)));
    const out = { ...pick, otherRounds: g.length - 1, roundList, groupIds: g.map((x) => x.id) };
    if (asks[0] && asks[0] !== pick.manual?.asking) out.manual = { ...(pick.manual || {}), asking: asks[0] };
    return out;
  });
}

// 법원 물건 '다음 기일 대기': 매각기일이 지났는데(50일 안) 매각·취하 표시가 없으면 유찰로 보고 다음 회차를 추정해 이어 보여 준다.
//  법원 사이트가 2주 안 물건만 보여 줘서 다음 기일(보통 4~6주 뒤)이 아직 안 잡혀 보이는 동안 목록에서 사라지던 문제(2026-10-26)
//  추정값: 최저가 × (1 − 저감률), 날짜 +35일. 실제 기일이 올라오면 그 자료로 바뀐다.
export function withNextCourtRound(items, { today, rate = 0.3 } = {}) {
  const t = today || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const end = (x) => String(x.bidEnd || '').replace(/\./g, '-').slice(0, 10);
  const hasFuture = new Set(items.filter((x) => end(x) >= t).map((x) => `${x.source}|${x.caseNo}|${x.itemNo || 1}`));
  return items.map((x) => {
    if (x.source !== 'court' || end(x) >= t || x.result?.soldPrice) return x;
    if (/(매각|낙찰|취하|취소|기각|정지|종국|종결|변경)/.test(x.status || '') && !/유찰/.test(x.status || '')) return x;
    if (hasFuture.has(`${x.source}|${x.caseNo}|${x.itemNo || 1}`)) return x;
    const d = new Date(`${end(x)}T00:00:00+09:00`); d.setDate(d.getDate() + 35);
    let next = new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    if (next < t) return x; // 너무 오래된 것
    const fc = (Number(x.failCount) || 0) + 1;
    return { ...x, bidEnd: next, minBid: Math.round((x.minBid || 0) * (1 - rate)), failCount: fc, status: `유찰 ${fc}회(결과 확인 전 추정)`, nextEstimated: { from: end(x), prevMinBid: x.minBid } };
  });
}
