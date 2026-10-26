// 자동 복사본 — 원본: auction-web/src/lib/rounds.js (직접 고치지 말 것)
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
