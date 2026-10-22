import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listListings, getSettings, getDeals } from '../lib/store.js';
import { analyze, tradeTypeOf, eok, pct, SOURCE_LABEL, typeLabel, areaText } from '../lib/analyze.js';
import { lawdOf, SIDO } from '../data/defaults.js';
import { corpFit, propertyKind } from '../lib/tax.js';
import { Badge, VerdictBadge, Empty } from '../components/ui.jsx';

const SOURCES = [['all', '전체'], ['court', '법원경매'], ['public', '공매'], ['bankrupt', '파산자산']];
const VERDICTS = [['all', '전체 판정'], ['now', '지금 매력'], ['wait', '유찰 대기'], ['check', '권리 확인 후 판단'], ['special', '특수물건 전체'], ['hard', '가격 안 맞음'], ['unknown', '시세 부족']];

export default function ListPage({ mode }) {
  const opp = mode === 'opportunity';
  const [items, setItems] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dealsMap, setDealsMap] = useState({});
  const [f, setF] = useState({ source: 'all', sido: '', sgg: '', verdict: 'all', q: '', maxPrice: '', maxOwn: '', sort: 'verdict', corpOnly: false, showExcluded: false, onlyOpen: true });
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    Promise.all([listListings({ sido: f.sido || undefined }), getSettings()])
      .then(([list, s]) => { setItems(list); setSettings(s); })
      .catch((e) => setError(e.message));
  }, [f.sido]);

  // 물건이 있는 (종류·시군구)만 시세를 불러온다
  useEffect(() => {
    if (!items) return;
    const keys = new Set();
    items.forEach((it) => { const l = lawdOf(it.sido, it.sgg); if (l) keys.add(`${tradeTypeOf(it)}|${l}`); });
    const need = [...keys].filter((k) => !(k in dealsMap)).slice(0, 40);
    if (!need.length) return;
    Promise.all(need.map(async (k) => { const [t, l] = k.split('|'); return [k, await getDeals(t, l, 12)]; }))
      .then((pairs) => setDealsMap((m) => ({ ...m, ...Object.fromEntries(pairs) })));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!items || !settings) return [];
    return dedupeRounds(items).map((it) => {
      const l = lawdOf(it.sido, it.sgg);
      const a = analyze(it, { settings, deals: dealsMap[`${tradeTypeOf(it)}|${l}`] });
      return { it, a };
    }).filter(({ it, a }) => {
      const cat = it.source === 'court' ? 'court' : it.category;
      if (f.source !== 'all' && cat !== f.source) return false;
      if (f.verdict === 'special' ? !a.special : f.verdict !== 'all' && a.verdict !== f.verdict) return false;
      if (!f.showExcluded && a.excluded) return false;
      if (opp && !a.opportunity) return false;
      if (f.sgg && !(it.sgg || '').includes(f.sgg)) return false;
      if (f.maxPrice && (it.minBid || 0) > Number(f.maxPrice) * 1e4) return false;
      const ownOf = opp ? a.opportunity?.own : a.money?.own;
      if (f.maxOwn && (!ownOf || ownOf > Number(f.maxOwn) * 1e4)) return false;
      if (f.corpOnly && !['A', 'B'].includes(fitOf(it, a))) return false;
      if (f.onlyOpen && /(낙찰|취소|종결|매각)/.test(it.status || '') && !/진행/.test(it.status || '')) return false;
      if (f.q && !`${it.title} ${it.address} ${it.caseNo}`.includes(f.q)) return false;
      return true;
    }).sort((x, y) => (opp && f.sort === 'verdict' ? NUM(y.a.opportunity?.profit) - NUM(x.a.opportunity?.profit) : 0) || sorter(f.sort)(x, y) || rank(x.a) - rank(y.a) || (y.a.score?.total ?? -1) - (x.a.score?.total ?? -1) || String(x.it.bidEnd || '').localeCompare(String(y.it.bidEnd || '')));
  }, [items, settings, dealsMap, f, opp]);

  const counts = useMemo(() => {
    const c = { now: 0, wait: 0, check: 0, hard: 0, unknown: 0, special: 0 };
    rows.forEach(({ a }) => { c[a.verdict] = (c[a.verdict] || 0) + 1; if (a.special) c.special++; });
    return c;
  }, [rows]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-4">
      {opp && (
        <div className="card border-now/30 bg-now/5 text-sm">
          <div className="text-base font-extrabold">기회 찾기 — 지금 값보다 손을 대면 오르는 물건</div>
          <p className="mt-1 text-ink/70"><b>권리 풀기</b>: 도로·지분·법정지상권 등 권리가 복잡한 물건을 풀었을 때(가능성만큼 할인한 기대 가치) 남는 돈. <b>올수리</b>: 빌라·아파트를 올수리해서 팔 때 수리 안 할 때보다 1천만 원 이상 더 남는 물건. 기대 수익 큰 순입니다.</p>
        </div>
      )}
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map(([v, l]) => (
            <button key={v} onClick={() => setF({ ...f, source: v })} className={`btn ${f.source === v ? 'bg-ink text-white' : 'border border-line bg-white'}`}>{l}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          <select className="input" value={f.sido} onChange={set('sido')}>
            <option value="">수도권 전체</option>
            {SIDO.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className="input" placeholder="시군구 (예: 부평)" value={f.sgg} onChange={set('sgg')} />
          <select className="input" value={f.verdict} onChange={set('verdict')}>
            {VERDICTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input className="input" inputMode="numeric" placeholder="최저가 상한(만원)" value={f.maxPrice} onChange={set('maxPrice')} />
          <input className="input" inputMode="numeric" placeholder="내 돈 상한(만원)" value={f.maxOwn} onChange={set('maxOwn')} />
          <select className="input" value={f.sort} onChange={set('sort')}>
            <option value="verdict">정렬: 판정·매력도</option>
            <option value="profit">정렬: 예상 수익 큰 순</option>
            <option value="roi">정렬: 수익률 높은 순</option>
            <option value="own">정렬: 내 돈 적게 드는 순</option>
            <option value="certainty">정렬: 확실성 높은 순</option>
            <option value="end">정렬: 마감 빠른 순</option>
          </select>
          <input className="input col-span-2 sm:col-span-6" placeholder="주소·사건번호 검색" value={f.q} onChange={set('q')} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/70">
          <label className="flex items-center gap-1.5 font-bold text-brand"><input type="checkbox" checked={f.corpOnly} onChange={set('corpOnly')} /> 법인 단타 적합만(A·B)</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.onlyOpen} onChange={set('onlyOpen')} /> 진행 중만</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.showExcluded} onChange={set('showExcluded')} /> 관심 제외 물건도 보기</label>
          <span className="ml-auto flex gap-1.5">
            <Badge tone="now">지금 {counts.now}</Badge><Badge tone="wait">대기 {counts.wait}</Badge><Badge tone="cash">특수 {counts.special}</Badge><Badge tone="hard">가격 안 맞음 {counts.hard}</Badge>
          </span>
        </div>
      </div>

      {error && <div className="card text-sm text-hard">불러오기 실패: {error}</div>}
      {!items && !error && <div className="card text-sm text-ink/50">물건을 불러오는 중…</div>}
      {items && !rows.length && <Empty>조건에 맞는 물건이 없습니다.</Empty>}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map(({ it, a }) => (
          <Link key={it.id} to={`/item/${encodeURIComponent(it.id)}`} className="card block transition hover:border-brand/50 hover:shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <VerdictBadge verdict={a.verdict} />
              {fitOf(it, a) && <Badge tone={{ A: 'now', B: 'wait', X: 'hard' }[fitOf(it, a)] || 'muted'}>법인 {fitOf(it, a)}</Badge>}
              {a.score && <Badge tone={a.score.grade === 'A' ? 'now' : a.score.grade === 'B' ? 'wait' : 'muted'}>{a.score.grade} · {a.score.total}점</Badge>}
              <Badge tone={it.category === 'bankrupt' ? 'cash' : 'muted'}>{SOURCE_LABEL[it.source === 'court' ? 'court' : it.category]}</Badge>
              {a.special?.types.map((t) => <Badge key={t.key} tone="cash">{t.label}</Badge>)}
              {a.cashType && <Badge tone="cash">현금청산형</Badge>}
              {a.member.status === 'member' && a.member.rank >= 3 && <Badge tone="now">입주권형</Badge>}
              {a.member.status === 'check' && <Badge tone="wait">분양자격 확인</Badge>}
              {it.manual?.zone ? <Badge tone="brand">{it.manual.zone.stage || '정비구역'}</Badge> : a.redev.length > 0 && !a.cashType && <Badge tone="brand">정비구역</Badge>}
              {a.farm && <Badge tone="wait">농지</Badge>}
              {a.excluded && <Badge>관심 제외</Badge>}
              {it.otherRounds > 0 && <Badge>다른 회차 {it.otherRounds}건</Badge>}
              <span className="ml-auto text-xs text-ink/50">{it.caseNo}</span>
            </div>
            <div className="flex items-start gap-2">
              {thumbOf(it) && <img src={thumbOf(it)} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-md border border-line object-cover" />}
              <span className="mt-0.5 shrink-0 rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-white">{typeLabel(it)}</span>
              <div className="font-bold leading-snug">{it.title}</div>
            </div>
            <div className="mt-0.5 truncate text-xs text-ink/60">{it.address}</div>
            {areaText(it) && <div className="text-xs text-ink/60">{areaText(it)}</div>}
            {a.money && !a.money.upside && (
              <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-paper p-2 text-sm">
                <div><div className="text-xs text-ink/50">{a.special ? '최악일 때 수익' : a.money.owner === 'corp' ? '세후 수익' : '예상 수익'}</div><div className={`num font-bold ${a.money.profit < 0 ? 'text-hard' : 'text-now'}`}>{eok(a.money.profit)}</div></div>
                <div><div className="text-xs text-ink/50">수익률</div><div className="num font-bold">{a.money.roi === null ? '—' : `${Math.round(a.money.roi * 100)}%`}</div></div>
                <div><div className="text-xs text-ink/50">내 돈</div><div className="num font-bold">{eok(a.money.own)}</div>{a.money.later > 0 && <div className="text-[10px] text-wait">+분담금 {eok(a.money.later)}</div>}</div>
                <div><div className="text-xs text-ink/50">확실성</div><div className="font-bold">{a.certainty ? `${a.certainty.grade} (${a.certainty.value})` : '—'}</div></div>
              </div>
            )}
            {a.opportunity && (
              <div className="mt-2 rounded-lg border border-now/30 bg-now/5 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.opportunities.map((o) => <Badge key={o.kind} tone="now">기회 · {o.kind}</Badge>)}
                  <span className="ml-auto text-xs text-ink/50">{a.opportunity.months}개월 기준</span>
                </div>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <div><div className="text-xs text-ink/50">기대 수익</div><div className={`num font-bold ${a.opportunity.profit < 0 ? 'text-hard' : 'text-now'}`}>{eok(a.opportunity.profit)}</div></div>
                  <div><div className="text-xs text-ink/50">내 돈</div><div className="num font-bold">{eok(a.opportunity.own)}</div></div>
                  <div><div className="text-xs text-ink/50">수익률</div><div className="num font-bold">{a.opportunity.roi === null ? '—' : `${Math.round(a.opportunity.roi * 100)}%`}</div></div>
                </div>
                {a.opportunity.note && <div className="mt-0.5 truncate text-[11px] text-ink/60">{a.opportunity.note}</div>}
              </div>
            )}
            {a.special && (
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-cash/20 bg-cash/5 p-2 text-sm">
                <div><div className="text-xs text-ink/50">바닥 가치(최악)</div><div className="num font-bold">{a.special.floorKnown ? eok(a.special.floor) : a.full ? '인수액 확인' : '시세 부족'}</div></div>
                <div><div className="text-xs text-ink/50">잘 풀리면 ({a.special.scenarios.length}개 시나리오)</div><div className="num font-bold text-now">{a.upMoney ? `${eok(a.upMoney.profit)} 수익` : a.special.best ? eok(a.special.best.value) : '—'}</div>{a.special.best && <div className="truncate text-[11px] text-ink/50">{a.special.best.name}</div>}</div>
              </div>
            )}
            <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
              <div><div className="text-xs text-ink/50">최저가</div><div className="num font-bold">{eok(it.minBid)}</div><div className="text-xs text-ink/50">감정가의 {pct(a.ratio)}</div></div>
              <div><div className="text-xs text-ink/50">{a.special ? "매수상한(바닥 기준)" : "매수상한"}</div><div className="num font-bold">{eok(a.cap)}</div><div className="text-xs text-ink/50">유찰 {it.failCount ?? '—'}회</div></div>
              <div><div className="text-xs text-ink/50">진입 시점</div><div className="font-bold">{a.reasons.length || a.verdict === 'check' ? '—' : a.entry ? a.entry.label : '—'}</div><div className="text-xs text-ink/50">마감 {String(it.bidEnd || '').slice(5, 10) || '—'}</div></div>
            </div>
            {a.reasons.length > 0 && <div className="mt-2 text-xs text-hard">{a.reasons.join(' · ')}</div>}
          </Link>
        ))}
      </div>
    </div>
  );
}

// 목록 썸네일: 온비드 썸네일 → 상세 첫 사진(http 주소만 — 예전 상세의 깨진 값 제외)
const thumbOf = (it) => [it.thumbnail, ...(it.detail?.photos || [])].find((u) => /^https?:\/\//.test(String(u || ''))) || null;
const NUM = (v, dir = -1) => (v === null || v === undefined || Number.isNaN(v) ? (dir < 0 ? -Infinity : Infinity) : v);
function sorter(key) {
  if (key === 'profit') return (x, y) => NUM(y.a.money?.profit) - NUM(x.a.money?.profit);
  if (key === 'roi') return (x, y) => NUM(y.a.money?.roi) - NUM(x.a.money?.roi);
  if (key === 'own') return (x, y) => NUM(x.a.money?.own, 1) - NUM(y.a.money?.own, 1);
  if (key === 'certainty') return (x, y) => NUM(y.a.certainty?.value) - NUM(x.a.certainty?.value);
  if (key === 'end') return (x, y) => String(x.it.bidEnd || '9').localeCompare(String(y.it.bidEnd || '9'));
  return () => 0;
}

// 판정이 '해결 안 됨'이어도 법인 적합도는 물건 성격으로 정해진다
function fitOf(it, a) {
  if (a.money?.fit) return a.money.fit.grade;
  return corpFit(it, propertyKind(it, tradeTypeOf(it), a.farm)).grade;
}

// 특수물건은 같은 판정 안에서 일반 물건 뒤로(섞여서 위로 튀지 않게). 특수물건 필터에서는 자기들끼리 순위
function rank(a) { return order(a.verdict) + (a.special ? 0.5 : 0); }

// 공매는 같은 물건이 회차(공고)마다 따로 올라온다 → 물건번호·주소가 같으면 가장 가까운 진행 회차 하나만
function dedupeRounds(items) {
  const today = new Date().toISOString().slice(0, 10);
  const groups = new Map();
  items.forEach((it) => {
    const key = `${it.source}|${it.caseNo}|${it.address || it.title}`;
    const g = groups.get(key);
    if (g) g.push(it); else groups.set(key, [it]);
  });
  return [...groups.values()].map((g) => {
    if (g.length === 1) return g[0];
    const end = (x) => String(x.bidEnd || '');
    const upcoming = g.filter((x) => end(x) >= today).sort((p, q) => end(p).localeCompare(end(q)));
    const pick = upcoming[0] || g.sort((p, q) => end(q).localeCompare(end(p)))[0];
    return { ...pick, otherRounds: g.length - 1 };
  });
}

function order(v) { return { now: 0, wait: 1, check: 2, unknown: 3, hard: 4 }[v] ?? 5; }
