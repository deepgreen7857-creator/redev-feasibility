/* 사이트 공통 길잡이(2026-11-04 사용자 결정 '탭이 물 흐르듯이')
 * 오른쪽 끝 [▶ 사용법 영상](2026-11-07 사용자 결정 '홈페이지 위에 매뉴얼 버튼, 쇼츠나 길지 않은 롱폼') — 목록은 shared/manuals.json
 * 1단: 페이지 — 정비사업 사업성 검토 · 정비계획 검토 · 정비경매 리포트 · 주식 모의투자 · 안전관리계획서 · 검토서 라이브러리
 * 2단(정비계획 검토 쪽 화면만): 1 주출입구 설정 → 2 정비기반시설 지정 → 3 교통성 검토 → 4 환경성 검토 → 5 경관성 검토 → 6 건축계획 수립
 *   /urban의 4탭(단지 출입구)·3탭(기반시설)과 /traffic·/env·/landscape·/arch를 한 줄로 이음. /urban은 탭을 바꿀 때 JbsNav.mark()로 표시를 옮김
 * 페이지마다 <script src="/shared/sitenav.js"></script>(workfile.js 앞)만 넣으면 됨. sticky-top.js가 이 두 줄도 위에 고정함 */
(() => {
  const P = location.pathname.replace(/index\.html$/, '');
  const PAGES = [
    { k: 'main', name: '정비사업 사업성 검토', href: '/', on: p => p === '/' },
    { k: 'plan', name: '정비계획 검토(시험판)', href: '/urban/', on: p => /^\/(urban|traffic|env|landscape|arch)\//.test(p) },
    { k: 'auction', name: '정비경매 리포트', href: '/auction/', on: p => /^\/auction\//.test(p) },
    { k: 'stock', name: '주식 모의투자', href: '/stock/', on: p => /^\/stock\//.test(p) },
    { k: 'safety', name: '안전관리계획서(시험판)', href: '/safety/', on: p => /^\/safety\//.test(p) },
    { k: 'library', name: '검토서 라이브러리', href: '/library/', on: p => /^\/library\//.test(p) },
  ];
  const STEPS = [
    { n: 1, name: '주출입구 설정', href: '/urban/?tab=arch&focus=gate', on: () => /^\/urban\//.test(P) && window.__urbanTab === 'arch' },
    { n: 2, name: '정비기반시설 지정', href: '/urban/?tab=plan', on: () => /^\/urban\//.test(P) && window.__urbanTab === 'plan' },
    { n: 3, name: '교통성 검토', href: '/traffic/', on: () => /^\/traffic\//.test(P) },
    { n: 4, name: '환경성 검토', href: '/env/', on: () => /^\/env\//.test(P) },
    { n: 5, name: '경관성 검토', href: '/landscape/', on: () => /^\/landscape\//.test(P) },
    { n: 6, name: '건축계획 수립', href: '/arch/', on: () => /^\/arch\//.test(P) },
  ];
  const css = `
#siteNav{display:flex;gap:2px;align-items:stretch;overflow-x:auto;background:#1f2933;padding:0 12px;scrollbar-width:thin;font-family:inherit}
#siteNav a{flex:none;color:#cfd6dd;text-decoration:none;font-size:14px;padding:9px 14px;border-bottom:3px solid transparent;white-space:nowrap}
#siteNav a:hover{color:#fff}
#siteNav a[aria-current="page"]{color:#fff;font-weight:700;border-bottom-color:#e8590c;background:#2b3743}
#siteNav .mk{display:flex;align-items:center;gap:6px;color:#fff;font-weight:700;padding:0 14px 0 2px;margin-right:6px;border-right:1px solid #3a4652;font-size:14px;white-space:nowrap}
#planSteps{display:flex;gap:4px;align-items:center;overflow-x:auto;background:#f3f5f7;border-bottom:1px solid #d9dee3;padding:7px 12px;scrollbar-width:thin}
#planSteps .lab{flex:none;font-size:12px;color:#5b6670;margin-right:4px;white-space:nowrap}
#planSteps a{flex:none;display:flex;gap:6px;align-items:center;font-size:13px;color:#1f2933;text-decoration:none;border:1px solid #cfd6dd;background:#fff;border-radius:999px;padding:4px 12px;white-space:nowrap}
#planSteps a b{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:#e9ecef;font-size:11px}
#planSteps a[aria-current="step"]{background:#1f2933;color:#fff;border-color:#1f2933}
#planSteps a[aria-current="step"] b{background:#e8590c;color:#fff}
#planSteps .ar{flex:none;color:#adb5bd}
#planSteps .back{margin-left:auto}
body.has-plansteps nav.tools{display:none!important}
#siteNav .man{margin-left:auto;flex:none;align-self:center;background:#e8590c;color:#fff;border:0;border-radius:6px;padding:5px 11px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
#jbsMan{position:fixed;inset:0;z-index:100000;background:rgba(15,20,25,.6);display:flex;align-items:center;justify-content:center;padding:16px}
#jbsMan .box{background:#fff;border-radius:10px;max-width:980px;width:100%;max-height:92vh;overflow:auto;padding:14px 16px}
#jbsMan .hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}#jbsMan .hd b{font-size:16px}#jbsMan .hd button{margin-left:auto}
#jbsMan .list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
#jbsMan .list button{border:1px solid #cfd6dd;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer}
#jbsMan .list button[aria-pressed="true"]{background:#1f2933;color:#fff;border-color:#1f2933}
#jbsMan .player{display:flex;justify-content:center;background:#111;border-radius:8px;min-height:120px;align-items:center;color:#ccc;font-size:14px}
#jbsMan iframe{border:0;display:block}
@media print{#siteNav,#planSteps{display:none!important}}`;
  function build() {
    if (document.getElementById('siteNav')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const nav = document.createElement('nav'); nav.id = 'siteNav'; nav.setAttribute('aria-label', '사이트 페이지');
    nav.innerHTML = `<span class="mk"><svg width="18" height="18" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="4" fill="#fff"/><path d="M6 6h6v6H6zM14 6h6v6h-6zM6 14h6v6H6z" fill="#1f2933" opacity=".85"/><path d="M14 14h6v6h-6z" fill="none" stroke="#e8590c" stroke-width="1.6"/></svg>jbslab</span>`
      + PAGES.map(pg => `<a href="${pg.href}"${pg.on(P) ? ' aria-current="page"' : ''}>${pg.name}</a>`).join('')
      + '<button class="man" type="button" title="이 화면 사용법 영상(쇼츠·짧은 영상)">▶ 사용법 영상</button>';
    nav.querySelector('.man').addEventListener('click', openManual);
    document.body.insertBefore(nav, document.body.firstChild);
    if (PAGES[1].on(P)) {
      const ps = document.createElement('nav'); ps.id = 'planSteps'; ps.setAttribute('aria-label', '정비계획 검토 순서');
      document.body.classList.add('has-plansteps');
      nav.insertAdjacentElement('afterend', ps);
      render();
    }
  }
  function render() {
    const ps = document.getElementById('planSteps'); if (!ps) return;
    ps.innerHTML = '<span class="lab">정비계획 순서</span>' + STEPS.map((s, i) => `${i ? '<span class="ar">›</span>' : ''}<a href="${s.href}"${s.on() ? ' aria-current="step"' : ''}><b>${s.n}</b>${s.name}</a>`).join('')
      + '<a class="back" href="/" title="정비사업 사업성 검토 화면 — 건축계획을 확정했으면 ★빠른 사업성 맨 아래 ⑤ 2차 사업성으로 1회차와 비교">→ 사업성으로(2차 비교)</a>';
  }
  // 사용법 영상: shared/manuals.json에서 이 페이지 영상 목록을 읽어 창으로 보여 줌(누르면 재생 — 자동재생 없음)
  async function openManual() {
    let M = { pages: {} };
    try { M = await (await fetch('/shared/manuals.json', { cache: 'no-cache' })).json(); } catch (e) { /* 목록 없음 */ }
    const key = Object.keys(M.pages || {}).filter(k => k === '/' ? P === '/' : P.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    const list = (M.pages || {})[key] || [];
    const old = document.getElementById('jbsMan'); if (old) old.remove();
    const w = document.createElement('div'); w.id = 'jbsMan';
    const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    w.innerHTML = `<div class="box" role="dialog" aria-label="사용법 영상"><div class="hd"><b>사용법 영상</b><span style="font-size:12px;color:#5b6670">이 화면에서 쓰는 방법을 짧게 보여 드립니다</span><button type="button" data-x>닫기</button></div>`
      + `<div class="list">${list.map((v, i) => `<button type="button" data-i="${i}">${v.kind === 'shorts' ? '쇼츠 · ' : ''}${esc(v.title)}${v.id ? '' : ' (준비 중)'}</button>`).join('') || '<span style="color:#5b6670">이 화면 영상은 준비 중입니다.</span>'}</div>`
      + `<div class="player">위에서 영상을 고르세요.</div>`
      + (M.channel ? `<p style="margin:10px 0 0;font-size:13px"><a href="${esc(M.channel)}" target="_blank" rel="noopener">유튜브 채널에서 전체 영상 보기 →</a></p>` : '') + `</div>`;
    document.body.appendChild(w);
    const pl = w.querySelector('.player');
    w.addEventListener('click', e => {
      if (e.target === w || e.target.dataset.x !== undefined) { w.remove(); return; }
      const i = e.target.dataset.i; if (i === undefined) return;
      w.querySelectorAll('.list button').forEach(b => b.setAttribute('aria-pressed', b === e.target ? 'true' : 'false'));
      const v = list[+i];
      if (!v.id) { pl.textContent = `'${v.title}' 영상은 준비 중입니다.`; return; }
      const sh = v.kind === 'shorts', W = sh ? 360 : Math.min(900, w.querySelector('.box').clientWidth - 32), H = sh ? 640 : Math.round(W * 9 / 16);
      pl.innerHTML = `<iframe width="${W}" height="${H}" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0" title="${esc(v.title)}" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    });
  }
  window.JbsNav = { mark(tab) { window.__urbanTab = tab; render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
