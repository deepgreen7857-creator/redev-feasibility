import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import AskingPage from './pages/AskingPage.jsx';
import ReportPage from './pages/ReportPage.jsx';
import RulesPage from './pages/RulesPage.jsx';
import ListPage from './pages/ListPage.jsx';
import DetailPage from './pages/DetailPage.jsx';
import BankruptPage from './pages/BankruptPage.jsx';
import MarketPage from './pages/MarketPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { JbsMark } from './components/ui.jsx';
import { DEMO, onUser, isAdmin, signOut, clearCache } from './lib/store.js';

// 메뉴는 하는 일 기준 네 묶음 — 위는 묶음, 아래 줄은 그 묶음 안의 화면
//  물건(고르기) · 일정(언제 볼지·오늘 할 일) · 성적(맞았나) · 기준·관리
const NAV_GROUPS = [
  { label: '물건', items: [['/', '전체'], ['/villa', '빌라 단타'], ['/opportunity', '기회(특수·올수리)'], ['/bankrupt', '파산 공고']] },
  { label: '일정', items: [['/schedule', '일정표'], ['/asking', '오늘의 호가 확인']] },
  { label: '성적', items: [['/done', '완료 물건 채점'], ['/market', '시세·시세 성적표']] },
  { label: '기준·관리', items: [['/rules', '판단 기준'], ['/admin', '관리자·자료 완성도']] },
];
const groupOf = (path) => NAV_GROUPS.find((g) => g.items.some(([to]) => (to === '/' ? path === '/' : path.startsWith(to)))) || (path.startsWith('/item') || path.startsWith('/report') ? NAV_GROUPS[0] : null);
function Nav() {
  const { pathname } = useLocation();
  const cur = groupOf(pathname);
  return (
    <div className="w-full sm:ml-auto sm:w-auto">
      <nav className="flex gap-1 overflow-x-auto text-sm">
        {NAV_GROUPS.map((g) => (
          <NavLink key={g.label} to={g.items[0][0]} end className={() => `whitespace-nowrap rounded-md px-3 py-1.5 ${cur === g ? 'bg-brand2 font-bold text-brand' : 'text-ink/70 hover:bg-paper'}`}>{g.label}</NavLink>
        ))}
      </nav>
      {cur && cur.items.length > 1 && (
        <nav className="mt-1 flex gap-1 overflow-x-auto text-xs">
          {cur.items.map(([to, l]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `whitespace-nowrap rounded px-2 py-1 ${isActive ? 'font-bold text-brand underline underline-offset-4' : 'text-ink/60 hover:text-ink'}`}>{l}</NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  useEffect(() => { let off = () => {}; onUser(setUser).then((f) => { off = f; }); return () => off(); }, []);
  const admin = isAdmin(user);
  return (
    <HashRouter>
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <a href="#/" title="정비경매 리포트 처음 화면"><JbsMark /></a>
            <span className="leading-tight">
              {DEMO ? <span className="block text-[11px] font-medium tracking-wider text-brand">JBS LAB</span>
                : <a href="/" className="block text-[11px] font-medium tracking-wider text-brand hover:underline" title="JBS LAB 정비사업 사업성 검토로 가기">JBS LAB ↗</a>}
              <a href="#/" className="block whitespace-nowrap text-base font-extrabold">정비경매 리포트</a>
            </span>
          </div>
          <Nav />
          <button className="whitespace-nowrap text-xs text-ink/50 hover:text-ink" title="이 브라우저에 보관해 둔 자료를 버리고 서버에서 새로 받습니다(평소엔 아침 7시 이후 한 번만 받음)" onClick={() => clearCache().then(() => window.location.reload())}>자료 새로 받기</button>
          {user && <button className="hidden text-xs text-ink/50 sm:block" onClick={() => signOut().then(() => setUser(null))}>로그아웃</button>}
        </div>
        {DEMO && <div className="bg-wait/10 px-4 py-1 text-center text-xs text-ink/80">데모 모드 — 샘플(가상) 물건과 시세로 동작합니다. Firebase를 연결하면 실제 수집 자료로 바뀝니다.</div>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/opportunity" element={<ListPage mode="opportunity" />} />
          <Route path="/done" element={<ListPage mode="done" />} />
          <Route path="/villa" element={<ListPage mode="villa" />} />
          <Route path="/schedule" element={<ListPage mode="schedule" />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/report/:id" element={<ReportPage admin={admin} />} />
          <Route path="/asking" element={<AskingPage admin={admin} />} />
          <Route path="/item/:id" element={<DetailPage admin={admin} />} />
          <Route path="/bankrupt" element={<BankruptPage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/admin" element={<AdminPage user={user} />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-ink/40">
        공개 자료(온비드·국토교통부 실거래가·브이월드·대법원 공고)를 정리한 분석 참고용입니다. 입찰 전 원문과 등기부를 반드시 확인하세요.
      </footer>
    </HashRouter>
  );
}
