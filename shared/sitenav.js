/* 사이트 공통 길잡이(2026-11-04 사용자 결정 '탭이 물 흐르듯이')
 * 오른쪽 끝 [▶ 사용법 영상](2026-11-07 사용자 결정 '홈페이지 위에 매뉴얼 버튼, 쇼츠나 길지 않은 롱폼') — 목록은 shared/manuals.json
 * 1단(2026-11-13 정리, 사용자 결정 '정비사업은 설정 모드·검토 모드 두 갈래, 경매·주식 등은 정비사업 메뉴에서 빼서 내 업무실로'):
 *   정비사업 — 설정 모드 [① 구역·사업성(/) · ② 정비계획(/urban 등)] · [검토 모드(/#review)]  |  오른쪽 [내 업무실 ▾](경매·판단기록장·입찰 판단표·자료·검토서 라이브러리·주식·안전관리)
 * 2단(정비계획 검토 쪽 화면만): 1 건축선·출입구 설정(건축한계선·차량출입 불허구간 → 주출입구) → 2 정비기반시설 지정 → 3 교통성 검토 → 4 환경성 검토 → 5 경관성 검토 → 6 건축계획 수립 → 7 판넬·팸플릿(/panel) → 8 정비계획 결정(안)(/decision) → 9 지정 절차 서류(/proc) → 10 고시용 지형도면(/topo)
 *   /urban의 4탭(단지 출입구)·3탭(기반시설)과 /traffic·/env·/landscape·/arch를 한 줄로 이음. /urban은 탭을 바꿀 때 JbsNav.mark()로 표시를 옮김
 * 페이지마다 <script src="/shared/sitenav.js"></script>(workfile.js 앞)만 넣으면 됨. sticky-top.js가 이 두 줄도 위에 고정함 */
(() => {
  const P = location.pathname.replace(/index\.html$/, '');
  const isReview = () => P === '/' && location.hash === '#review';
  const PAGES = [
    { k: 'main', grp: '설정 모드', name: '① 구역·사업성', title: '구역계를 정하고 1회차(빠른) 사업성을 봅니다', href: '/', on: p => p === '/' && !isReview() },
    { k: 'plan', name: '② 정비계획 세우기', title: '건축선·기반시설·교통·환경·경관·건축계획 → 2회차 사업성 → 서류·도면', href: '/urban/', on: p => /^\/(urban|traffic|env|landscape|arch|panel|decision|topo|proc)\//.test(p) },
    { k: 'review', grp: '검토 모드', name: '제출 서류 검토', title: '명부·조서를 공부와 대조해 오류를 찾습니다', href: '/#review', on: () => isReview() },
  ];
  // 내 업무실 — 정비사업 메뉴와 섞지 않음(본인 전용 도구)
  const DESK = [
    { name: '판단기록장', href: '/judge/', on: p => /^\/judge\//.test(p) },
    { name: '입찰 판단표', href: '/review/', on: p => /^\/review\//.test(p) },
    { name: '정비경매 리포트', href: '/auction/', on: p => /^\/auction\//.test(p) },
    { name: '자료 보기(경매 원문)', href: '/data/', on: p => /^\/data\//.test(p) },
    { name: '검토서 라이브러리', href: '/library/', on: p => /^\/library\//.test(p) },
    { name: '주식 모의투자', href: '/stock/', on: p => /^\/stock\//.test(p) },
    { name: '안전관리계획서(시험판)', href: '/safety/', on: p => /^\/safety\//.test(p) },
  ];
  const STEPS = [
    { n: 1, name: '건축선·출입구 설정', href: '/urban/?tab=arch&focus=bline', on: () => /^\/urban\//.test(P) && window.__urbanTab === 'arch' },
    { n: 2, name: '정비기반시설 지정', href: '/urban/?tab=plan', on: () => /^\/urban\//.test(P) && window.__urbanTab === 'plan' },
    { n: 3, name: '교통성 검토', href: '/traffic/', on: () => /^\/traffic\//.test(P) },
    { n: 4, name: '환경성 검토', href: '/env/', on: () => /^\/env\//.test(P) },
    { n: 5, name: '경관성 검토', href: '/landscape/', on: () => /^\/landscape\//.test(P) },
    { n: 6, name: '건축계획 수립', href: '/arch/', on: () => /^\/arch\//.test(P) },
    { n: 7, name: '판넬·팸플릿', href: '/panel/', on: () => /^\/panel\//.test(P) },   // 2026-11-07 사용자 목록 8·9
    { n: 8, name: '정비계획 결정(안)', href: '/decision/', on: () => /^\/decision\//.test(P) },   // 2026-11-07 결정조서(정비계획 + 지구단위계획)
    { n: 9, name: '지정 절차 서류', href: '/proc/', on: () => /^\/proc\//.test(P) },   // 2026-11-08 도정법 제15조·제16조
    { n: 10, name: '고시용 지형도면', href: '/topo/', on: () => /^\/topo\//.test(P) },   // 2026-11-08 토지이용규제 기본법 제8조
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
#siteNav .grp{flex:none;align-self:center;font-size:11px;color:#8b98a5;padding:0 2px 0 10px;white-space:nowrap}
#siteNav .desk{margin-left:14px;flex:none;align-self:center;background:transparent;color:#cfd6dd;border:1px solid #4a5763;border-radius:6px;padding:4px 10px;font-size:13px;cursor:pointer;white-space:nowrap;margin-right:8px}
#siteNav .desk[aria-current="page"]{color:#fff;border-color:#e8590c}
#jbsDesk{position:fixed;z-index:100001;background:#fff;border:1px solid #cfd6dd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:6px;min-width:200px;font-family:inherit}
#jbsDesk a{display:block;padding:8px 12px;font-size:14px;color:#1f2933;text-decoration:none;border-radius:6px}
#jbsDesk a:hover{background:#f1f3f5}#jbsDesk a[aria-current="page"]{font-weight:700;color:#e8590c}
#jbsDesk .t{font-size:11px;color:#8a949c;padding:4px 12px 6px}
#siteNav .man{flex:none;align-self:center;background:#e8590c;color:#fff;border:0;border-radius:6px;padding:5px 11px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap}
#jbsMan{position:fixed;inset:0;z-index:100000;background:rgba(15,20,25,.6);display:flex;align-items:center;justify-content:center;padding:16px}
#jbsMan .box{background:#fff;border-radius:10px;max-width:980px;width:100%;max-height:92vh;overflow:auto;padding:14px 16px}
#jbsMan .hd{display:flex;align-items:center;gap:8px;margin-bottom:10px}#jbsMan .hd b{font-size:16px}#jbsMan .hd button{margin-left:auto}
#jbsMan .list{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
#jbsMan .list button{border:1px solid #cfd6dd;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;cursor:pointer}
#jbsMan .list button[aria-pressed="true"]{background:#1f2933;color:#fff;border-color:#1f2933}
#jbsMan .player{display:flex;justify-content:center;background:#111;border-radius:8px;padding:8px}
#jbsMan .body{font-size:14px;line-height:1.6;color:#1f2933}
#jbsMan iframe{border:0;display:block}
@media print{#siteNav,#planSteps{display:none!important}}`;
  function build() {
    if (document.getElementById('siteNav')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const nav = document.createElement('nav'); nav.id = 'siteNav'; nav.setAttribute('aria-label', '사이트 페이지');
    nav.innerHTML = `<span class="mk"><svg width="18" height="18" viewBox="0 0 26 26" aria-hidden="true"><rect x="1" y="1" width="24" height="24" rx="4" fill="#fff"/><path d="M6 6h6v6H6zM14 6h6v6h-6zM6 14h6v6H6z" fill="#1f2933" opacity=".85"/><path d="M14 14h6v6h-6z" fill="none" stroke="#e8590c" stroke-width="1.6"/></svg>jbslab</span>`
      + PAGES.map(pg => `${pg.grp ? `<span class="grp">${pg.grp}</span>` : ''}<a href="${pg.href}" data-k="${pg.k}" title="${pg.title}"${pg.on(P) ? ' aria-current="page"' : ''}>${pg.name}</a>`).join('')
      + `<button class="desk" type="button" title="정비사업과 따로 쓰는 본인 전용 도구"${DESK.some(d => d.on(P)) ? ' aria-current="page"' : ''}>${(DESK.find(d => d.on(P)) || { name: '내 업무실' }).name} ▾</button>`
      + '<button class="man" type="button" title="이 화면 사용법(글·영상)">▶ 사용법</button>';
    nav.querySelector('.man').addEventListener('click', openManual);
    nav.querySelector('.desk').addEventListener('click', e => { e.stopPropagation(); toggleDesk(e.currentTarget); });
    // 사업성 화면 안에서 설정 ↔ 검토 모드를 바꿀 때는 새로 열지 않고 탭만 바꿈
    nav.querySelectorAll('a[data-k="main"],a[data-k="review"]').forEach(a => a.addEventListener('click', e => {
      if (P !== '/' || typeof App === 'undefined' || !App.go) return;
      e.preventDefault(); App.go(a.dataset.k === 'review' ? 'review' : 'overview'); mark();
    }));
    window.addEventListener('hashchange', mark);
    document.body.insertBefore(nav, document.body.firstChild);
    if (PAGES[1].on(P)) {
      const ps = document.createElement('nav'); ps.id = 'planSteps'; ps.setAttribute('aria-label', '정비계획 검토 순서');
      document.body.classList.add('has-plansteps');
      nav.insertAdjacentElement('afterend', ps);
      render();
    }
  }
  function mark() {
    document.querySelectorAll('#siteNav a[data-k]').forEach(a => { const pg = PAGES.find(x => x.k === a.dataset.k); if (pg && pg.on(P)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  }
  function toggleDesk(btn) {
    const old = document.getElementById('jbsDesk'); if (old) { old.remove(); return; }
    const m = document.createElement('div'); m.id = 'jbsDesk'; m.setAttribute('role', 'menu');
    m.innerHTML = '<div class="t">내 업무실 — 본인 전용</div>' + DESK.map(d => `<a role="menuitem" href="${d.href}"${d.on(P) ? ' aria-current="page"' : ''}>${d.name}</a>`).join('');
    const r = btn.getBoundingClientRect();
    m.style.top = (r.bottom + 4) + 'px'; m.style.left = Math.max(8, Math.min(r.left, innerWidth - 220)) + 'px';
    document.body.appendChild(m);
    const off = ev => { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } };
    setTimeout(() => document.addEventListener('click', off), 0);
  }
  function render() {
    const ps = document.getElementById('planSteps'); if (!ps) return;
    ps.innerHTML = '<span class="lab">설정 모드 ② 정비계획 순서</span>' + STEPS.map((s, i) => `${i ? '<span class="ar">›</span>' : ''}<a href="${s.href}"${s.on() ? ' aria-current="step"' : ''}><b>${s.n}</b>${s.name}</a>`).join('')
      + '<a class="back" href="/" title="정비사업 사업성 검토 화면 — 건축계획을 확정했으면 ★빠른 사업성 맨 아래 ⑤ 2차 사업성으로 1회차와 비교">→ 사업성으로(2차 비교)</a>';
  }
  // 사용법: shared/manuals.json — 매뉴얼(글)이 원본, 단계마다 영상이 있으면 같이 보여 줌(누르면 재생 — 자동재생 없음)
  async function openManual() {
    let M = { pages: {} };
    try { M = await (await fetch('/shared/manuals.json', { cache: 'no-cache' })).json(); } catch (e) { /* 목록 없음 */ }
    const key = Object.keys(M.pages || {}).filter(k => k === '/' ? P === '/' : P.startsWith(k)).sort((a, b) => b.length - a.length)[0];
    let pg = (M.pages || {})[key] || [];
    if (Array.isArray(pg)) pg = { title: '사용법', steps: [], videos: pg }; // 예전 꼴(영상 목록만)
    const steps = pg.steps || [], vids = pg.videos || [];
    const old = document.getElementById('jbsMan'); if (old) old.remove();
    const w = document.createElement('div'); w.id = 'jbsMan';
    const esc = t => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const player = v => { if (!v || !v.id) return ''; const sh = v.kind === 'shorts', W = sh ? 300 : 640, H = sh ? 533 : 360; return `<iframe width="${W}" height="${H}" style="max-width:100%" src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?rel=0" title="사용법 영상" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`; };
    const stepHtml = i => { const s = steps[i]; return `<h3 style="margin:0 0 6px">${esc(s.name)}</h3><p style="margin:0 0 10px;color:#5b6670">${esc(s.why)}</p>`
      + `<ol style="margin:0 0 10px;padding-left:20px;display:grid;gap:4px">${(s.do || []).map(d => `<li>${esc(d)}</li>`).join('')}</ol>`
      + (s.check ? `<p style="margin:0 0 6px"><b>확인</b> ${esc(s.check)}</p>` : '') + (s.stuck ? `<p style="margin:0 0 6px"><b>막히면</b> ${esc(s.stuck)}</p>` : '') + (s.next ? `<p style="margin:0 0 10px"><b>다음</b> ${esc(s.next)}</p>` : '')
      + (s.video && s.video.id ? `<div class="player">${player(s.video)}</div>` : `<p style="margin:0;font-size:12px;color:#8a949c">이 단계 영상은 준비 중입니다.</p>`); };
    w.innerHTML = `<div class="box" role="dialog" aria-label="사용법"><div class="hd"><b>${esc(pg.title || '사용법')}</b><button type="button" data-x>닫기</button></div>`
      + (pg.goal ? `<p style="margin:0 0 10px;color:#5b6670">${esc(pg.goal)}</p>` : '')
      + `<div class="list">${steps.map((s, i) => `<button type="button" data-s="${i}">${esc(s.name)}</button>`).join('')}${vids.map((v, i) => `<button type="button" data-v="${i}">▶ ${esc(v.title)}${v.id ? '' : ' (준비 중)'}</button>`).join('')}</div>`
      + `<div class="body" style="min-height:120px">${steps.length ? '' : '<p style="color:#5b6670">이 화면 사용법은 준비 중입니다.</p>'}</div>`
      + (M.channel ? `<p style="margin:10px 0 0;font-size:13px"><a href="${esc(M.channel)}" target="_blank" rel="noopener">유튜브 채널에서 전체 영상 보기 →</a></p>` : '') + `</div>`;
    document.body.appendChild(w);
    const body = w.querySelector('.body');
    const pick = btn => { w.querySelectorAll('.list button').forEach(b => b.setAttribute('aria-pressed', b === btn ? 'true' : 'false')); };
    w.addEventListener('click', e => {
      if (e.target === w || e.target.dataset.x !== undefined) { w.remove(); return; }
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.s !== undefined) { pick(t); body.innerHTML = stepHtml(+t.dataset.s); }
      if (t.dataset.v !== undefined) { pick(t); const v = vids[+t.dataset.v]; body.innerHTML = v.id ? `<div class="player">${player(v)}</div>` : `<p>'${esc(v.title)}' 영상은 준비 중입니다.</p>`; }
    });
    // 지금 보고 있는 단계를 먼저 펼침(사업성 화면은 주소 #탭)
    const tabIdx = steps.findIndex(s => { const h = (location.hash || '').slice(1); const map = { overview: 0, area: 1, quick: 2, survey: 3, revenue: 4, cost: 5, result: 6, sensitivity: 7, review: 8 }; return h in map && map[h] === steps.indexOf(s); });
    const first = w.querySelector(`.list button[data-s="${tabIdx >= 0 ? tabIdx : 0}"]`) || w.querySelector('.list button');
    if (first) first.click();
  }
  window.JbsNav = { mark(tab) { window.__urbanTab = tab; render(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build); else build();
})();
