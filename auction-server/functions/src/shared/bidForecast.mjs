// 자동 복사본 — 원본: auction-web/src/lib/bidForecast.js (직접 고치지 말 것)
// 예상 낙찰가 = 우리 입찰가 (가산 폭 0%)
// 완료 물건(낙찰가가 있는 것)에서 '낙찰가 ÷ 그 회차 최저가'를 종류별로 모아 중앙값을 쓴다.
// 가산 폭은 일부러 0% — 분석기의 오차가 그대로 드러나게 하고, 필요한 가산 폭은 결과 지표로 계산해 보여 준다.
import { typeLabel } from './analyze.mjs';

const MIN_PEERS = 3;
const med = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
export const quantile = (xs, p) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };

// 첫 회차인가: 유찰 0회, 또는 최저가가 감정가와 같음(법원·공매 모두 첫 회차 최저가 = 감정가). 알 수 없으면 null
export function isFirstRound(it) {
  if (it.failCount === 0) return true;
  if (typeof it.failCount === 'number' && it.failCount > 0) return false;
  if (it.appraisal && it.minBid) return it.minBid / it.appraisal >= 0.995;
  if (String(it.round || '') === '1' && it.source === 'court') return true;
  return null;
}

export const soldOf = (it) => (it.result?.soldPrice && it.minBid ? it.result.soldPrice : null);

// 완료 물건에서 종류별 프리미엄 표 만들기. 어이없는 낙찰(최저가의 3배 초과)은 뺀다
export function premiumTable(items) {
  const byType = {}; const all = [];
  items.forEach((it) => {
    const p = soldOf(it); if (!p) return;
    const r = p / it.minBid; if (!(r >= 1 && r <= 3)) return;
    (byType[typeLabel(it)] ||= []).push(r); all.push(r);
  });
  return { byType, all, n: all.length };
}

// 한 물건의 예상 낙찰가. self=true면 이 물건 자신의 값을 빼고 계산(완료 물건 채점용 — 답을 보고 맞히지 않게)
export function predictPrice(it, table, { self = false } = {}) {
  if (!it.minBid || !table || !table.n) return null;
  const own = self ? (soldOf(it) ? soldOf(it) / it.minBid : null) : null;
  const drop = (arr) => { if (own === null) return arr; const i = arr.indexOf(own); return i < 0 ? arr : [...arr.slice(0, i), ...arr.slice(i + 1)]; };
  const peers = drop(table.byType[typeLabel(it)] || []);
  const base = peers.length >= MIN_PEERS ? peers : drop(table.all);
  const prem = med(base);
  if (!prem) return null;
  return { price: Math.round(it.minBid * prem), premium: prem, peers: base.length, scope: peers.length >= MIN_PEERS ? `같은 종류(${typeLabel(it)}) ${base.length}건` : `전체 ${base.length}건(같은 종류 ${peers.length}건뿐)` };
}

// 오차 등급: A ≤2% · B ≤4% · C ≤7% · D ≤10% · F >10%, 10건 미만은 표본 부족
export const gradeOf = (m, n) => { const g = m <= 0.02 ? 'A' : m <= 0.04 ? 'B' : m <= 0.07 ? 'C' : m <= 0.1 ? 'D' : 'F'; return n < 10 ? `표본 부족(${g})` : g; };

// 오차 묶음 → 성적
export function scoreErrors(errs) {
  const abs = errs.map(Math.abs); const m = med(abs);
  return {
    n: errs.length,
    error: m, bias: med(errs),
    win0: errs.filter((e) => e <= 0).length / errs.length, // 예상가 그대로 써서 이긴 비율(동점 포함)
    margin70: Math.max(0, quantile(errs, 0.7) ?? 0), // 승률 70%를 내려면 필요한 가산 폭
    grade: gradeOf(m, errs.length),
  };
}

// 실거래 근거 묶음(성적표 나눠 보기)
export function evidenceGroup(a) {
  const g = a?.market?.value ? a.market.grade : null;
  if (g === 'A' || g === 'B') return 'ab';
  if (g === 'C' || g === 'D') return 'cd';
  return 'none';
}
export const EVIDENCE_LABEL = { all: '전체', ab: '실거래 A·B(같은 단지)', cd: '실거래 C·D(같은 동·시군구)', none: '실거래 없음(감정가·공시가만)' };

// 우리 입찰가로 본 결과
export function bidOutcome(it, bid, cap, resultKind) {
  if (!bid) return null;
  if (cap && bid > cap) return { kind: 'skip', label: '입찰 안 함 — 예상 낙찰가가 우리 매수상한보다 높음' };
  if (resultKind === 'fail') return { kind: 'alone', label: '유찰 회차 — 우리가 입찰했으면 단독 낙찰' };
  const p = soldOf(it);
  if (resultKind === 'sold' && p) return bid >= p ? { kind: 'win', label: `이김 — 낙찰가보다 ${Math.round((bid / p - 1) * 1000) / 10}% 더 씀`, over: bid / p - 1 } : { kind: 'lose', label: `짐 — 시장이 ${Math.round((p / bid - 1) * 1000) / 10}% 높게 씀`, gap: p / bid - 1 };
  return null;
}
