/* 화면 위 머리줄·단계 탭 고정 (2026-11-04, 사용자 요구: 스크롤해도 탭까지는 늘 보이게)
 * 쓰는 곳: 본 화면(.topbar → #kpis → #tabs), /urban(header.top → nav.steps), 검토서 도구(header.top → nav.tools)
 * 페이지에 있는 것만 위에서부터 차례로 붙이고, 각 줄의 높이를 재어 아래 줄의 top을 맞춤.
 * 다 붙인 높이는 CSS 변수 --sticky-h로 남김(본 화면 구역계 오른쪽 칸 등이 그 아래에 붙도록).
 * 창 높이가 낮으면(560px 미만) 맨 위 머리줄은 빼고 탭만 고정해 내용 볼 자리를 남김. */
(() => {
  const SEL = ['#siteNav', '#planSteps', '.topbar', '#kpis', '#tabs', 'header.top', 'nav.steps', 'nav.tools'];
  const bgOf = el => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
    }
    return getComputedStyle(document.body).backgroundColor || '#fff';
  };
  let els = [];
  const layout = () => {
    els = SEL.map(s => document.querySelector(s)).filter(el => el && el.offsetParent !== null);
    // 같은 줄이 두 번 잡히지 않게, 문서 순서대로
    els = [...new Set(els)].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    const low = window.innerHeight < 560;
    let top = 0;
    els.forEach((el, i) => {
      const isTabs = el.matches('#siteNav, #planSteps, #tabs, nav.steps, nav.tools');
      // 지표줄(#kpis)은 창이 넉넉할 때(850px 이상)만 고정 — 낮은 화면에서는 내용 볼 자리를 남김
      if ((low && !isTabs) || (el.id === 'kpis' && window.innerHeight < 850)) { el.style.position = ''; el.style.top = ''; return; }
      el.style.position = 'sticky';
      el.style.top = top + 'px';
      el.style.zIndex = String(1000 - i);
      if (getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)') el.style.background = bgOf(el.parentElement || document.body);
      top += el.getBoundingClientRect().height;
    });
    document.documentElement.style.setProperty('--sticky-h', Math.round(top) + 'px');
  };
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(layout, 50); };
  const start = () => {
    layout();
    window.addEventListener('resize', later);
    if (window.ResizeObserver) { const ro = new ResizeObserver(later); SEL.forEach(s => { const el = document.querySelector(s); if (el) ro.observe(el); }); }
    setTimeout(layout, 800); setTimeout(layout, 2500);   // 지표·탭이 늦게 그려지는 화면(검토서 도구는 머리줄을 나중에 그림)
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
