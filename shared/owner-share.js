/* 소유자별(종전자산 구간별) 추정 분담금(2026-11-08, 인계 남은 일 3 — '명부(별지 제9호) 종전자산과 /decision 분담금 추산 잇기')
   - 도정법 제9조①2의2는 '토지등소유자 유형별' 분담금 추산액 → 개인별이 아니라 종전자산 구간(유형)별로 냄. 개인 이름은 묶는 데만 쓰고 결과에 남기지 않음
   - 종전자산 출처(사업성 화면 'jbsc.project.v1' state — 이 브라우저 안에서만):
     ① 조합원 표(state.members, prior 만원)가 있으면 그것
     ② 없으면 토지 조서(state.lands)를 소유자 이름으로 묶어 Calc.prior와 같은 식: 공시지가 × 면적 × 배율(재건축은 공동주택가격 × 배율 우선). 국공유지는 뺌
   - 권리가액 = 종전자산 × 추정비례율. 비례율을 낸 종전자산 합계(site.quick.prior)와 명부 합계가 다르면 명부 값을 같은 비율로 맞춤(구성비 유지)
   순수 계산 — 브라우저(window.JbsOwnerShare)·node 둘 다. 개인정보가 들어가므로 결과를 저장소·서버에 올리지 말 것 */
(function (g) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const num = x => (isFinite(+x) ? +x : 0);
  const PUBLIC = /(대한민국|^국$|국유|광역시|특별시|[가-힣]+(시|구|군)$|한국토지주택공사|LH|도시공사|철도공단)/;

  // state → [{ no, prior(만원), n(필지 수 또는 1) }]
  function fromProject(st, assume) {
    if (!st) return { list: [], src: '' };
    const mem = (st.members || []).filter(m => num(m.prior) > 0);
    if (mem.length) return { list: mem.map((m, i) => ({ no: i + 1, prior: num(m.prior), n: 1 })), src: '사업성 화면 조합원 표' };
    const p = st.prior || {}, mult = num(p.multiplier) || 1, recon = (st.meta || {}).type === 'reconstruction';
    const hm = num(p.houseMul) || num((assume || {}).houseMul) || 1.7, useHouse = recon && (st.lands || []).some(l => num(l.housePrice) > 0);
    const by = new Map();
    (st.lands || []).forEach(l => {
      const name = String(l.owner || '').trim(); if (!name || l.ownerType === '국공유지' || PUBLIC.test(name)) return;
      const v = useHouse && num(l.housePrice) > 0 ? num(l.housePrice) * hm : num(l.area) * num(l.price) / 10000 * mult;
      const o = by.get(name) || { prior: 0, n: 0 }; o.prior += v; o.n++; by.set(name, o);
    });
    const list = [...by.values()].filter(o => o.prior > 0).sort((a, b) => a.prior - b.prior).map((o, i) => ({ no: i + 1, prior: o.prior, n: o.n }));
    return { list, src: list.length ? `토지 조서 소유자 ${list.length}명(${useHouse ? '공동주택가격 × ' + hm : '공시지가 × ' + mult})` : '' };
  }

  // 구간(억원): 1 미만, 1~2, 2~3, 3~5, 5~10, 10 이상 — 사람이 없는 구간은 뺌
  const BANDS = [[0, 1], [1, 2], [2, 3], [3, 5], [5, 10], [10, Infinity]];
  const bandName = ([a, b]) => (b === Infinity ? `${a}억원 이상` : a === 0 ? `${b}억원 미만` : `${a}억 ~ ${b}억원`);
  // owners: fromProject().list, ratio(%), priorTotal(만원 — 비례율 계산에 쓴 종전자산, 없으면 명부 합계), types: [{ t, a(권리자 분양가 만원) }]
  function bands(owners, ratio, priorTotal, types) {
    const sum = owners.reduce((s, o) => s + o.prior, 0); if (!sum || !isFinite(ratio)) return null;
    const k = priorTotal > 0 ? priorTotal / sum : 1;
    const rows = BANDS.map(bd => { const os = owners.filter(o => o.prior * k / 10000 >= bd[0] && o.prior * k / 10000 < bd[1]); if (!os.length) return null;
      const avg = os.reduce((s, o) => s + o.prior * k, 0) / os.length, right = avg * ratio / 100;
      return { band: bandName(bd), n: os.length, avg, right, charge: types.map(tp => ({ t: tp.t, v: tp.a - right })) }; }).filter(Boolean);
    return { rows, k, sum, n: owners.length };
  }
  // 두 구역이 같은지(가운데 점이 서로 안) — 사업성 화면 구역과 공통 구역 비교
  const inRing = (p, q) => { let r = false; for (let i = 0, j = q.length - 1; i < q.length; j = i++) { const a = q[i], b = q[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) r = !r; } return r; };
  const mid = q => [q.reduce((s, p) => s + p[0], 0) / q.length, q.reduce((s, p) => s + p[1], 0) / q.length];
  const ringOf = gj => { const geo = gj && (gj.geometry || gj); return !geo ? null : geo.type === 'Polygon' ? geo.coordinates[0] : geo.type === 'MultiPolygon' ? geo.coordinates[0][0] : null; };
  function sameZone(a, b) { const A = ringOf(a), B = ringOf(b); return !!(A && B && inRing(mid(A), B) && inRing(mid(B), A)); }

  const api = { fromProject, bands, sameZone, BANDS };
  if (isNode) module.exports = api; else g.JbsOwnerShare = api;
})(typeof window !== 'undefined' ? window : globalThis);
