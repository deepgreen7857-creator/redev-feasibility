import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import RulesPage from './pages/RulesPage.jsx';
import ListPage from './pages/ListPage.jsx';
import DetailPage from './pages/DetailPage.jsx';
import BankruptPage from './pages/BankruptPage.jsx';
import MarketPage from './pages/MarketPage.jsx';
import AdminPage from './pages/AdminPage.jsx';
import { JbsMark } from './components/ui.jsx';
import { DEMO, onUser, isAdmin, signOut } from './lib/store.js';

const NAV = [['/', '물건 찾기'], ['/opportunity', '기회 찾기'], ['/done', '완료 물건'], ['/rules', '판단 기준'], ['/bankrupt', '파산 공고'], ['/market', '시세'], ['/admin', '관리자']];

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
          <nav className="flex w-full gap-1 overflow-x-auto text-sm sm:ml-auto sm:w-auto">
            {NAV.map(([to, l]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `whitespace-nowrap rounded-md px-2.5 py-1.5 ${isActive ? 'bg-brand2 font-bold text-brand' : 'text-ink/70 hover:bg-paper'}`}>{l}</NavLink>
            ))}
          </nav>
          {user && <button className="hidden text-xs text-ink/50 sm:block" onClick={() => signOut().then(() => setUser(null))}>로그아웃</button>}
        </div>
        {DEMO && <div className="bg-wait/10 px-4 py-1 text-center text-xs text-ink/80">데모 모드 — 샘플(가상) 물건과 시세로 동작합니다. Firebase를 연결하면 실제 수집 자료로 바뀝니다.</div>}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-5">
        <Routes>
          <Route path="/" element={<ListPage />} />
          <Route path="/opportunity" element={<ListPage mode="opportunity" />} />
          <Route path="/done" element={<ListPage mode="done" />} />
          <Route path="/rules" element={<RulesPage />} />
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
