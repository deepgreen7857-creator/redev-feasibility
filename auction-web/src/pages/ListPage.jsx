import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listListings, listPastResults, getSettings, getDeals } from '../lib/store.js';
import { analyze, tradeTypeOf, eok, pct, SOURCE_LABEL, typeLabel, areaText } from '../lib/analyze.js';
import { lawdOf, SIDO } from '../data/defaults.js';
import { corpFit, propertyKind } from '../lib/tax.js';
import { Badge, VerdictBadge, Empty } from '../components/ui.jsx';

const SOURCES = [['all', '전체'], ['court', '법원경매'], ['public', '공매'], ['bankrupt', '파산자산']];
const VERDICTS = [['all', '전체 판정'], ['now', '지금 매력'], ['wait', '유찰 대기'], ['check', '권리 확인 후 판단'], ['suspect', '오류 의심'], ['special', '특수물건 전체'], ['hard', '가격 안 맞음'], ['unknown', '시세 부족']];

export default function ListPage({ mode }) {
  const opp = mode === 'opportunity';
  const done = mode === 'done';
  const [items, setItems] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dealsMap, setDealsMap] = useState({});
  const [f, setF] = useState({ source: 'all', sido: '', sgg: '', verdict: 'all', q: '', maxPrice: '', maxOwn: '', sort: 'verdict', corpOnly: false, showExcluded: false, onlyOpen: true });
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(null);
    Promise.all([listListings({ sido: f.sido || undefined }), getSettings(), mode === 'done' ? listPastResults({ sido: f.sido || undefined }).catch(() => []) : Promise.resolve([])])
      .then(([list, s, past]) => { const ids = new Set(list.map((x) => x.id)); setItems([...list, ...past.filter((x) => !ids.has(x.id))]); setSettings(s); })
      .catch((e) => setError(e.message));
  }, [f.sido, mode]);

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
    return (done ? items : dedupeRounds(items)).map((it) => { // 완료 물건은 회차마다 따로 채점
      const l = lawdOf(it.sido, it.sgg);
      const a = analyze(it, { settings, deals: dealsMap[`${tradeTypeOf(it)}|${l}`] });
      return { it, a };
    }).filter(({ it, a }) => {
      const cat = it.source === 'court' ? 'court' : it.category;
      if (f.source !== 'all' && cat !== f.source) return false;
      if (f.verdict === 'special' ? !a.special : f.verdict !== 'all' && a.verdict !== f.verdict) return false;
      if (!f.showExcluded && a.excluded) return false;
      if (opp && !a.opportunity) return false;
      if (done !== isEnded(it)) return false;
      if (f.sgg && !(it.sgg || '').includes(f.sgg)) return false;
      if (f.maxPrice && (it.minBid || 0) > Number(f.maxPrice) * 1e4) return false;
      const ownOf = opp ? a.opportunity?.own : a.money?.own;
      if (f.maxOwn && (!ownOf || ownOf > Number(f.maxOwn) * 1e4)) return false;
      if (f.corpOnly && !['A', 'B'].includes(fitOf(it, a))) return false;
      if (!done && f.onlyOpen && /(낙찰|취소|종결|매각)/.test(it.status || '') && !/진행/.test(it.status || '')) return false;
      if (f.q && !`${it.title} ${it.address} ${it.caseNo}`.includes(f.q)) return false;
      return true;
    }).sort((x, y) => (done && f.sort === 'verdict' ? endOf(y.it).localeCompare(endOf(x.it)) : 0) || (opp && f.sort === 'verdict' ? NUM(y.a.opportunity?.profit) - NUM(x.a.opportunity?.profit) : 0) || sorter(f.sort)(x, y) || rank(x.a) - rank(y.a) || (y.a.score?.total ?? -1) - (x.a.score?.total ?? -1) || String(x.it.bidEnd || '').localeCompare(String(y.it.bidEnd || '')));
  }, [items, settings, dealsMap, f, opp, done]);

  const counts = useMemo(() => {
    const c = { now: 0, wait: 0, check: 0, hard: 0, unknown: 0, special: 0, suspect: 0 };
    rows.forEach(({ a }) => { c[a.verdict] = (c[a.verdict] || 0) + 1; if (a.special) c.special++; });
    return c;
  }, [rows]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-4">
      {done && <DoneSummary rows={rows} />}
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
          {!done && <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.onlyOpen} onChange={set('onlyOpen')} /> 진행 중만</label>}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.showExcluded} onChange={set('showExcluded')} /> 관심 제외 물건도 보기</label>
          <span className="ml-auto flex gap-1.5">
            <Badge tone="now">지금 {counts.now}</Badge><Badge tone="wait">대기 {counts.wait}</Badge><Badge tone="cash">특수 {counts.special}</Badge><Badge tone="hard">가격 안 맞음 {counts.hard}</Badge>{counts.suspect > 0 && <Badge tone="hard">오류 의심 {counts.suspect}</Badge>}
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
            {done && <ResultRow it={it} a={a} />}
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
            {a.anomalies?.length > 0 && <div className="mt-2 rounded-md bg-hard/5 p-2 text-xs text-hard">{a.anomalies.join(' · ')}</div>}
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

// ── 완료 물건 ──────────────────────────────────────────────
const VERDICT_LABEL = { now: '지금 매력', wait: '유찰 대기', check: '권리 확인 후 판단', suspect: '오류 의심', hard: '가격 안 맞음', unknown: '시세 부족' };
// 입찰(매각)기일이 지났거나 상태가 낙찰·매각·유찰·종결·취소인 물건
const endOf = (it) => String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10);
function isEnded(it) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (it.result) return true;
  if (/(낙찰|매각|유찰|종결|취소|기각|변경|마감)/.test(it.status || '') && !/진행/.test(it.status || '')) return true;
  const e = endOf(it);
  return Boolean(e) && e < today;
}
function resultOf(it) {
  const r = it.result || {};
  if (r.soldPrice) return { kind: 'sold', label: '낙찰', price: r.soldPrice, rate: it.appraisal ? r.soldPrice / it.appraisal : null, bidders: r.bidders, second: r.second };
  if (/유찰/.test(r.status || it.status || '')) return { kind: 'fail', label: '유찰 — 이 가격에 아무도 안 삼' };
  if (/(낙찰|매각)/.test(r.status || it.status || '')) return { kind: 'sold', label: '낙찰 — 최저가 이상에 팔림(금액 미확인)' };
  if (/(취소|기각|변경|종결)/.test(r.status || it.status || '')) return { kind: 'other', label: r.status || it.status };
  return { kind: 'unknown', label: '결과 확인 전' };
}
function ResultRow({ it, a }) {
  const r = resultOf(it);
  const fc = it.forecast; // 입찰 전에 서버가 기록해 둔 우리 예측
  const cap = fc ? fc.cap : a?.cap;
  const vs = r.price && cap ? (r.price <= cap ? `우리 매수상한 ${eok(cap)} 안에서 낙찰 — 우리 기준으로도 살 만했음` : `우리 매수상한 ${eok(cap)}보다 ${eok(r.price - cap)} 높게 낙찰 — 시장이 더 높게 봄`) : null;
  return (
    <>
    <div className="mt-2 rounded-md border border-line px-2 py-1 text-xs">
      {fc ? <><b>입찰 전 예측</b>({fc.at}): {VERDICT_LABEL[fc.verdict] || fc.verdict}{fc.grade ? ` · ${fc.grade} ${fc.score}점` : ''}{fc.cap ? ` · 매수상한 ${eok(fc.cap)}` : ''}{fc.opportunity ? ` · 기회(${fc.opportunity.kind}) ${eok(fc.opportunity.profit)}` : ''}</>
        : <span className="text-ink/50">입찰 전 예측 기록 없음 — 아래는 지금 규칙으로 다시 판정한 값</span>}
    </div>
    {vs && <div className={`mt-1 text-xs font-bold ${r.price <= cap ? 'text-now' : 'text-wait'}`}>{vs}</div>}
    <div className={`mt-2 grid grid-cols-4 gap-2 rounded-lg p-2 text-sm ${r.kind === 'sold' ? 'bg-now/5' : r.kind === 'fail' ? 'bg-wait/5' : 'bg-ink/5'}`}>
      <div><div className="text-xs text-ink/50">결과</div><div className="font-bold">{r.label}</div></div>
      <div><div className="text-xs text-ink/50">낙찰가</div><div className="num font-bold">{r.price ? eok(r.price) : '—'}</div></div>
      <div><div className="text-xs text-ink/50">감정가 대비</div><div className="num font-bold">{r.rate ? pct(r.rate) : '—'}</div></div>
      <div><div className="text-xs text-ink/50">응찰자</div><div className="num font-bold">{r.bidders ? `${r.bidders}명` : '—'}</div></div>
    </div>
    </>
  );
}
// 우리 판정별로 실제 결과가 어땠는지(채점)
function DoneSummary({ rows }) {
  const by = {};
  let recorded = 0;
  rows.forEach(({ it, a }) => {
    if (it.forecast) recorded++;
    const k = it.forecast ? it.forecast.verdict : `now:${a.verdict}`; const r = resultOf(it);
    by[k] ||= { n: 0, sold: 0, fail: 0, unknown: 0, rates: [] };
    by[k].n++;
    if (r.kind === 'sold') { by[k].sold++; if (r.rate) by[k].rates.push(r.rate); } else if (r.kind === 'fail') by[k].fail++; else by[k].unknown++;
  });
  const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  // 우리 매수상한 vs 그 회차 최저가 → '샀을까' / 실제로 팔렸나
  const m = { agreeBuy: 0, agreePass: 0, weOptimistic: 0, marketOptimistic: 0 };
  rows.forEach(({ it, a }) => {
    const r = resultOf(it); const cap = it.forecast ? it.forecast.cap : a.cap; const price = it.minBid;
    if (!cap || !price || !['sold', 'fail'].includes(r.kind)) return;
    const buy = cap >= price;
    if (buy && r.kind === 'sold') m.agreeBuy++; else if (!buy && r.kind === 'fail') m.agreePass++;
    else if (buy) m.weOptimistic++; else m.marketOptimistic++;
  });
  const judged = m.agreeBuy + m.agreePass + m.weOptimistic + m.marketOptimistic;
  const LABEL = (k) => (k.startsWith('now:') ? `${VERDICT_LABEL[k.slice(4)] || k.slice(4)} (예측 기록 없음·지금 규칙)` : VERDICT_LABEL[k] || k);
  return (
    <div className="card text-sm">
      <div className="text-base font-extrabold">완료 물건 — 시장이 내린 답으로 우리 판단을 채점합니다</div>
      <p className="mt-1 text-ink/70">서버가 매일 밤 진행 물건을 판정해 <b>입찰 전 예측</b>을 기록하고, 기일이 되면 그 예측을 굳혀 실제 결과와 맞춰 봅니다(결과를 보고 예측을 고치지 않음). 예측 기록이 있는 물건 {recorded}건 / 전체 {rows.length}건. 낙찰가는 법원은 수집기가 기일 지난 사건을 다시 읽을 때, 공매는 온비드 입찰결과 연결 뒤 채워집니다.</p>
      <table className="mt-3 w-full text-xs">
        <thead className="text-ink/50"><tr><th className="text-left">우리 판정</th><th className="text-right">물건</th><th className="text-right">낙찰</th><th className="text-right">유찰</th><th className="text-right">결과 확인 전</th><th className="text-right">평균 낙찰가율</th></tr></thead>
        <tbody>{Object.entries(by).map(([k, v]) => (
          <tr key={k} className="border-t border-line/50"><td>{LABEL(k)}</td><td className="text-right">{v.n}</td><td className="text-right">{v.sold}</td><td className="text-right">{v.fail}</td><td className="text-right">{v.unknown}</td><td className="text-right">{v.rates.length ? `${pct(avg(v.rates))} (${v.rates.length}건)` : '—'}</td></tr>
        ))}</tbody>
      </table>
      <div className="mt-3 rounded-md bg-paper p-2 text-xs">
        <b>우리 매수상한 vs 그 회차 최저가</b> (결과가 낙찰·유찰로 나온 {judged}건)
        <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-4">
          <div>✔ 산다 → 팔림 <b>{m.agreeBuy}</b></div>
          <div>✔ 안 산다 → 유찰 <b>{m.agreePass}</b></div>
          <div className="text-wait">✘ 산다 → 유찰(우리가 낙관) <b>{m.weOptimistic}</b></div>
          <div className="text-wait">✘ 안 산다 → 팔림(시장이 낙관) <b>{m.marketOptimistic}</b></div>
        </div>
        {judged > 0 && <div className="mt-1">일치율 <b>{pct((m.agreeBuy + m.agreePass) / judged)}</b> — 틀린 쪽 물건을 열어 왜 어긋났는지 보면 규칙을 고칠 곳이 보입니다.</div>}
      </div>
      <ScoreBreakdown rows={rows} />
    </div>
  );
}

// 성적표: 규칙은 고정(판단 기준 2026-10-23판)한 채로, 종류·지역·개찰월별 적중률과 '낙찰가 ÷ 우리 판단 가치'
function ScoreBreakdown({ rows }) {
  const med = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const group = (keyOf) => {
    const g = {};
    rows.forEach(({ it, a }) => {
      const r = resultOf(it); if (!['sold', 'fail'].includes(r.kind)) return;
      const k = keyOf(it); const cap = it.forecast ? it.forecast.cap : a.cap; const value = it.forecast ? it.forecast.value : a.value;
      const x = (g[k] ||= { n: 0, hit: 0, judged: 0, sold: 0, ratio: [] });
      x.n++; if (r.kind === 'sold') { x.sold++; if (r.rate && r.rate > 1) x.over = (x.over || 0) + 1; }
      if (cap && it.minBid) { x.judged++; const buy = cap >= it.minBid; if ((buy && r.kind === 'sold') || (!buy && r.kind === 'fail')) x.hit++; }
      // 어이없는 낙찰(감정가의 150% 초과, 또는 우리 가치의 2배 초과·30% 미만)은 따로 세고 중앙값에서 뺀다
      if (r.kind === 'sold' && r.price && value) {
        const q = r.price / value;
        if (q > 2 || q < 0.3 || (r.rate && r.rate > 1.5)) x.odd = (x.odd || 0) + 1; else x.ratio.push(q);
      }
    });
    return Object.entries(g).sort((p, q) => q[1].n - p[1].n).slice(0, 12);
  };
  const Table = ({ title, data }) => (
    <div>
      <div className="mt-3 font-bold">{title}</div>
      <table className="w-full text-xs">
        <thead className="text-ink/50"><tr><th className="text-left">구분</th><th className="text-right">결과</th><th className="text-right">낙찰률</th><th className="text-right">감정가 초과 낙찰</th><th className="text-right">채점</th><th className="text-right">적중률</th><th className="text-right">낙찰가÷우리 가치</th></tr></thead>
        <tbody>{data.map(([k, v]) => {
          const ratio = med(v.ratio);
          return (<tr key={k} className="border-t border-line/50"><td>{k}</td><td className="text-right">{v.n}</td><td className="text-right">{pct(v.sold / v.n)}</td><td className="text-right">{v.sold ? `${pct((v.over || 0) / v.sold)}` : '—'}</td><td className="text-right">{v.judged}</td>
            <td className={`text-right font-bold ${v.judged >= 10 ? (v.hit / v.judged >= 0.7 ? 'text-now' : v.hit / v.judged < 0.6 ? 'text-hard' : '') : 'text-ink/40'}`}>{v.judged ? pct(v.hit / v.judged) : '—'}</td>
            <td className={`text-right ${ratio && (ratio < 0.85 || ratio > 1.15) ? 'font-bold text-wait' : ''}`}>{ratio ? `${Math.round(ratio * 100)}% (${v.ratio.length})` : '—'}{v.odd ? <span className="ml-1 text-ink/40">이상 {v.odd}</span> : null}</td></tr>);
        })}</tbody>
      </table>
    </div>
  );
  const month = (it) => String(it.result?.openAt || it.bidEnd || '').replace(/\./g, '-').slice(0, 7) || '날짜 없음';
  return (
    <div className="mt-4 rounded-md border border-line p-2 text-sm">
      <div className="font-extrabold">성적표 — 규칙 고정(판단 기준 2026-10-23판) 상태의 채점</div>
      <p className="text-xs text-ink/60">규칙은 고치지 않고 성적부터 봅니다. 적중률은 10건 이상일 때만 색을 칠합니다(70%↑ 초록, 60%↓ 빨강). 낙찰가는 과열·실수·특수 사정으로 어이없게 나오는 경우가 많아, 평균이 아니라 <b>중앙값</b>을 쓰고 감정가 150% 초과·우리 가치의 2배 초과나 30% 미만 낙찰은 <b>"이상"으로 따로 세어 뺍니다</b>. <b>낙찰가÷우리 가치</b>가 100%보다 많이 낮으면 우리가 가치를 높게 본 것, 많이 높으면 낮게 본 것입니다(85~115% 밖은 노란색).</p>
      <Table title="물건 종류별" data={group((it) => typeLabel(it))} />
      <Table title="지역별" data={group((it) => `${it.sido || ''} ${it.sgg || ''}`.trim() || '지역 없음')} />
      <Table title="개찰 월별" data={group(month).sort((p, q) => q[0].localeCompare(p[0]))} />
    </div>
  );
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

function order(v) { return { now: 0, wait: 1, check: 2, unknown: 3, hard: 4, suspect: 5 }[v] ?? 6; }
