// 시세 성적표: 우리 시세 계산이 실제 거래를 얼마나 맞히는지 잰다.
// 최근 거래 하나하나를 '맞힐 문제'로 놓고, 그 거래보다 앞선 달의 거래만 써서 시세를 계산한 뒤 실제 거래가와 비교한다(답을 보고 맞히지 않게).
import { marketEstimate } from './analyze.js';

const USAGE = { apt: '아파트', rh: '다세대', sh: '단독주택', offi: '오피스텔' };
const med = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

// 거래 한 건을 '물건'처럼 만든다(이름·층·동·면적·연식)
export function dealAsItem(type, d) {
  return { usage: USAGE[type], title: `${d[5] || ''} 제${d[2] ?? ''}층`, address: `${d[9] || ''} ${d[4] || ''}`, emd: d[9] || null, buildingArea: d[1], buildYear: d[6] || null };
}

// deals: 같은 시군구·종류 12개월 거래([..., ym] 형식). recentMonths: 맞힐 문제로 쓸 최근 개월 수
export function backtest(type, deals, { recentMonths = 2, maxTargets = 400 } = {}) {
  const ok = (deals || []).filter((d) => d[0] && d[1] && !d[7] && d[11]);
  const months = [...new Set(ok.map((d) => d[11]))].sort();
  const targetMonths = new Set(months.slice(-recentMonths));
  let targets = ok.filter((d) => targetMonths.has(d[11]) && d[8] !== '직거래');
  if (targets.length > maxTargets) { const step = targets.length / maxTargets; targets = Array.from({ length: maxTargets }, (_, i) => targets[Math.floor(i * step)]); }
  const rows = [];
  for (const d of targets) {
    const before = ok.filter((x) => x[11] < d[11]); // 그 거래 달보다 앞선 거래만
    const m = marketEstimate(dealAsItem(type, d), before);
    if (!m.value) { rows.push({ d, ok: false, reason: m.basis }); continue; }
    const actual = d[0];
    rows.push({
      d, ok: true, grade: m.grade || '?', pred: m.value, basic: m.basic || null, top: m.top || null,
      err: actual / m.value - 1, inBand: m.basic && m.top ? actual >= m.basic * 0.98 && actual <= m.top * 1.02 : null, wide: Boolean(m.wide),
    });
  }
  return summarize(rows);
}

export const gradeOf = (m, n) => { if (m === null) return '—'; const g = m <= 0.03 ? 'A' : m <= 0.05 ? 'B' : m <= 0.08 ? 'C' : m <= 0.12 ? 'D' : 'F'; return n < 20 ? `표본 부족(${g})` : g; };

export function summarize(rows) {
  const done = rows.filter((r) => r.ok);
  const stat = (rs) => {
    const errs = rs.map((r) => r.err); const abs = errs.map(Math.abs); const band = rs.filter((r) => r.inBand !== null);
    const m = med(abs);
    return {
      n: rs.length, error: m, bias: med(errs),
      within5: rs.length ? abs.filter((x) => x <= 0.05).length / rs.length : null,
      within10: rs.length ? abs.filter((x) => x <= 0.1).length / rs.length : null,
      inBand: band.length ? band.filter((r) => r.inBand).length / band.length : null,
      grade: gradeOf(m, rs.length),
    };
  };
  const by = (keyOf) => {
    const g = {}; done.forEach((r) => { (g[keyOf(r)] ||= []).push(r); });
    return Object.entries(g).map(([k, rs]) => [k, stat(rs)]).sort((p, q) => q[1].n - p[1].n);
  };
  return {
    total: rows.length, covered: done.length, coverage: rows.length ? done.length / rows.length : null,
    all: stat(done),
    byGrade: by((r) => ({ A: 'A 같은 단지·같은 평형', B: 'B 같은 단지', C: 'C 같은 동', D: 'D 같은 시군구' }[r.grade] || r.grade)),
    byDong: by((r) => r.d[9] || '동 없음'),
    byFloor: by((r) => (r.d[2] !== null && r.d[2] <= 2 ? '저층(1~2층)' : '3층 이상')),
    worst: done.slice().sort((p, q) => Math.abs(q.err) - Math.abs(p.err)).slice(0, 10),
    misses: rows.filter((r) => !r.ok).slice(0, 5).map((r) => r.reason),
  };
}
