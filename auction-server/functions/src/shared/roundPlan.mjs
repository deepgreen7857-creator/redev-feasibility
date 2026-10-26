// 자동 복사본 — 원본: auction-web/src/lib/roundPlan.js (직접 고치지 말 것)
// 회차별 진입 검토 — "지금 상태에서 몇 번 더 유찰되면 매력이 되나, 그때까지 남아 있을까"
// 회차마다: 최저가 → 그 회차 예상 낙찰가(같은 종류 '낙찰가÷최저가' 중앙값) → 우리 매수상한 대비 남는 돈
//          × 그 회차까지 안 팔리고 남아 있을 확률(완료 물건에서 같은 종류·같은 '최저가÷감정가' 구간의 낙찰률)
// 기대값이 가장 큰 회차가 '들어갈 회차'. 기다릴수록 싸지지만, 그 사이 남이 사 갈 확률이 커진다.
import { typeLabel, roundSchedule } from './analyze.mjs';
import { predictPrice } from './bidForecast.mjs';

const BUCKETS = [[0.9, '감정가 90%↑'], [0.7, '70~90%'], [0.5, '50~70%'], [0.3, '30~50%'], [0, '30% 미만']];
const bucketOf = (ratio) => (BUCKETS.find(([b]) => ratio >= b) || BUCKETS[BUCKETS.length - 1])[1];

// 완료 물건으로 종류×구간별 낙찰률 표 만들기(낙찰·유찰 결과가 있는 것만)
export function soldRateTable(items) {
  const g = {}; const all = {};
  (items || []).forEach((it) => {
    const r = it.result || {};
    const sold = Boolean(r.soldPrice) || /낙찰|매각/.test(r.status || '');
    const fail = !sold && /유찰/.test(r.status || it.status || '');
    if ((!sold && !fail) || !it.minBid || !it.appraisal) return;
    const b = bucketOf(it.minBid / it.appraisal);
    for (const key of [`${typeLabel(it)}|${b}`, `*|${b}`]) { const x = (key.startsWith('*') ? all : g)[key] ||= { sold: 0, n: 0 }; x.n++; if (sold) x.sold++; }
  });
  return { g, all };
}
function soldRate(table, it, price) {
  if (!table || !it.appraisal) return null;
  const b = bucketOf(price / it.appraisal);
  const own = table.g[`${typeLabel(it)}|${b}`];
  const x = own && own.n >= 10 ? own : table.all[`*|${b}`];
  return x && x.n >= 10 ? { p: x.sold / x.n, n: x.n, scope: own && own.n >= 10 ? `${typeLabel(it)} ${b}` : `전체 ${b}` } : null;
}

// 앞으로 회차별 최저가(법원: 저감률, 공매: 처음 가격의 10%씩 최저 50%까지)
const ymd = (v) => { const m = String(v || '').match(/(\d{4})[.-](\d{2})[.-](\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const plusDays = (d, n) => { if (!d) return null; const t = new Date(`${d}T00:00:00+09:00`); t.setDate(t.getDate() + n); return new Date(t.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
// 공매: 공고에 나온 회차별 일정(roundList)이 있으면 그대로(실제 날짜). 없으면 공매 1주·법원 5주 간격으로 날짜 추정
export function futureRounds(item, courtRate = 0.3, count = 10) {
  return roundSchedule(item, courtRate, count); // 진입 시점과 같은 회차표
}

export function roundPlan(item, a, { premium, rates, courtRate } = {}) {
  const cap = a?.cap; if (!cap || !item.minBid) return null;
  const rounds = futureRounds(item, courtRate ?? 0.3);
  let survive = 1; const rows = [];
  for (const r of rounds) {
    const pred = predictPrice({ ...item, minBid: r.price }, premium);
    const bid = Math.max(r.price, pred ? pred.price : r.price); // 그 회차에 이기려면 써야 할 값(예상 낙찰가, 최저가 이상)
    const room = cap - bid; // 우리 상한까지 남는 돈(+면 살 만함)
    const sr = soldRate(rates, item, r.price);
    // 이 회차까지 남아 있을 확률 × 이 회차에 우리가 이길 확률(예상 낙찰가를 쓰면 대략 반반) × 남는 돈
    const ev = room > 0 ? Math.round(survive * 0.5 * room) : 0;
    rows.push({ ...r, bid, room, survive, soldP: sr ? sr.p : null, rateScope: sr?.scope, ev, label: r.k === 0 ? '지금 회차' : `${r.k}회 더 유찰` });
    survive *= sr ? 1 - sr.p : 0.85; // 모르면 회차마다 15%는 팔린다고 봄
  }
  const firstOk = rows.find((x) => x.room > 0) || null;
  const best = rows.reduce((m, x) => (x.ev > (m?.ev || 0) ? x : m), null);
  // 예상 낙찰 회차: 그 회차가 끝나면 '아직 남아 있을 확률'이 절반 아래로 떨어지는 첫 회차(= 유찰 몇 번 뒤에 팔릴 것 같나)
  const expectSale = rows.find((x) => x.survive * (1 - (x.soldP ?? 0.15)) <= 0.5) || null;
  return { rows, firstOk, best, expectSale };
}
