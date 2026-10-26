import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listListings, listPastResults, getSettings, getDeals } from '../lib/store.js';
import { analyze, tradeTypeOf, courtRate, eok, pct, SOURCE_LABEL, typeLabel, areaText, ANALYZER_VERSION } from '../lib/analyze.js';
import { lawdOf, SIDO } from '../data/defaults.js';
import { corpFit, propertyKind } from '../lib/tax.js';
import { Badge, VerdictBadge, Empty } from '../components/ui.jsx';
import { soldRateTable, roundPlan } from '../lib/roundPlan.js';
import { dedupeRounds } from '../lib/rounds.js';
import { premiumTable, predictPrice, isFirstRound, scoreErrors, evidenceGroup, EVIDENCE_LABEL, bidOutcome, soldOf } from '../lib/bidForecast.js';

const PAGE = 60;
const SOURCES = [['all', '전체'], ['court', '법원경매'], ['public', '공매'], ['bankrupt', '파산자산']];
const VERDICTS = [['all', '전체 판정'], ['now', '지금 매력'], ['wait', '유찰 대기'], ['check', '권리 확인 후 판단'], ['suspect', '오류 의심·계산 이상'], ['shareUnknown', '지분비율 미확인'], ['special', '특수물건 전체'], ['hard', '가격 안 맞음'], ['unknown', '시세 부족'], ['pending', '자료 수집 중']];

export default function ListPage({ mode }) {
  const opp = mode === 'opportunity';
  const done = mode === 'done';
  const villa = mode === 'villa';
  const schedule = mode === 'schedule';
  const [items, setItems] = useState(null);
  const [past, setPast] = useState([]); // 낙찰 결과(예상 낙찰가 기준표용) — 낙찰가는 이제 pastResults 에만 있다
  const [settings, setSettings] = useState(null);
  const [dealsMap, setDealsMap] = useState({});
  const [f, setF] = useState({ source: 'all', sido: '', sgg: '', verdict: 'all', q: '', maxPrice: '', maxOwn: '', sort: mode ? 'verdict' : 'end', corpOnly: false, under1: false, showExcluded: false, onlyOpen: true });
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState(null); // 거리 기준 위치
  useEffect(() => { setF((x) => ({ ...x, sort: mode ? 'verdict' : 'end' })); }, [mode]);
  useEffect(() => {
    if (f.sort !== 'near' || origin) return;
    setOrigin({ ...HOME, label: '미추홀구청(위치 확인 중)' });
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => setOrigin({ lat: p.coords.latitude, lng: p.coords.longitude, label: '내 위치' }),
        () => setOrigin(HOME), { timeout: 8000, maximumAge: 600000 },
      );
    } catch { setOrigin(HOME); }
  }, [f.sort]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setItems(null);
    Promise.all([listListings({ sido: f.sido || undefined, scope: mode === 'done' ? 'recent' : 'open' }), getSettings(), listPastResults({ sido: f.sido || undefined }).catch(() => [])])
      .then(([list, s, past]) => { const ids = new Set(list.map((x) => x.id)); setItems(mode === 'done' ? [...list, ...past.filter((x) => !ids.has(x.id))] : list); setPast(past); setSettings(s); })
      .catch((e) => setError(e.message));
  }, [f.sido, mode]);

  // 물건이 있는 (종류·시군구)만 시세를 불러온다.
  //  전에는 40개 받을 때마다 화면 상태를 바꿔, 받을 때마다 물건 2만 건 판정을 처음부터 다시 했다(느림의 큰 원인).
  //  이제 40개씩 나눠 받되(서버 부담) 모두 받은 뒤 한 번만 바꾼다. 브라우저에 보관된 시세는 거의 바로 나온다.
  const [dealsProg, setDealsProg] = useState(null); // { done, total } — 받는 중일 때만
  const needKeys = useMemo(() => {
    if (!items) return [];
    const keys = new Set();
    items.forEach((it) => { const l = lawdOf(it.sido, it.sgg); if (!l) return; const t = tradeTypeOf(it); if (villa && t !== 'rh') return; keys.add(`${t}|${l}`); if (villa) keys.add(`${t}Rent|${l}`); });
    return [...keys];
  }, [items, villa]);
  const dealsReady = Boolean(items) && needKeys.every((k) => k in dealsMap);
  useEffect(() => {
    const need = needKeys.filter((k) => !(k in dealsMap));
    if (!need.length) return;
    let stop = false;
    (async () => {
      const got = {};
      setDealsProg({ done: 0, total: need.length });
      for (let i = 0; i < need.length && !stop; i += 40) {
        const part = await Promise.all(need.slice(i, i + 40).map(async (k) => { const [t, l] = k.split('|'); return [k, await getDeals(t, l, 12).catch(() => [])]; }));
        part.forEach(([k, v]) => { got[k] = v; });
        if (!stop) setDealsProg({ done: Math.min(need.length, i + 40), total: need.length });
      }
      if (!stop) { setDealsMap((m) => ({ ...m, ...got })); setDealsProg(null); }
    })();
    return () => { stop = true; };
  }, [needKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  // 판정은 물건 수천~수만 건이라 한 번에 돌리면 브라우저가 멈춘다 → 400건씩 나눠 계산하고 사이사이 화면을 그린다
  const premTable = useMemo(() => (items ? premiumTable([...items, ...past]) : null), [items, past]);
  const [analyzed, setAnalyzed] = useState(null);
  const [anaProg, setAnaProg] = useState(null);
  useEffect(() => {
    setAnalyzed(null);
    if (!items || !settings || !dealsReady) return;
    const list = done ? items : dedupeRounds(items); // 완료 물건은 회차마다 따로 채점
    const out = []; let i = 0; let stop = false;
    const step = () => {
      if (stop) return;
      const end = Math.min(list.length, i + 400);
      for (; i < end; i++) {
        const it = list[i]; const l = lawdOf(it.sido, it.sgg);
        out.push({ it, a: analyze(it, { settings, deals: dealsMap[`${tradeTypeOf(it)}|${l}`], rentDeals: villa ? dealsMap[`${tradeTypeOf(it)}Rent|${l}`] : undefined, bidPremium: done ? undefined : predictPrice(it, premTable)?.premium }) });
      }
      if (i < list.length) { setAnaProg({ done: i, total: list.length }); setTimeout(step, 0); } else { setAnaProg(null); setAnalyzed(out); }
    };
    step();
    return () => { stop = true; };
  }, [items, settings, dealsMap, dealsReady, done, villa, premTable]);

  // 카드는 처음 60개만 그린다(전에는 수천 개를 한 번에 그려 브라우저가 1분 넘게 멈췄다) — '더 보기'로 이어서
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { setShown(PAGE); }, [f, mode]);
  const rows = useMemo(() => {
    if (!analyzed) return [];
    return analyzed.filter(({ it, a }) => {
      const cat = it.source === 'court' ? 'court' : it.category;
      if (f.source !== 'all' && cat !== f.source) return false;
      if (f.verdict === 'special' ? !a.special : f.verdict !== 'all' && a.verdict !== f.verdict) return false;
      if (!f.showExcluded && a.excluded) return false;
      if (opp && !a.opportunity) return false;
      if (villa && (tradeTypeOf(it) !== 'rh' || notVilla(it))) return false;
      if (done !== isEnded(it)) return false;
      if (f.sgg && !(it.sgg || '').includes(f.sgg)) return false;
      if (f.maxPrice && (it.minBid || 0) > Number(f.maxPrice) * 1e4) return false;
      const ownOf = opp ? a.opportunity?.own : a.money?.own;
      if (f.maxOwn && (!ownOf || ownOf > Number(f.maxOwn) * 1e4)) return false;
      if (f.corpOnly && !['A', 'B'].includes(fitOf(it, a))) return false;
      // 공시가격 1억 이하 주택(법인 취득세 중과 제외, 정비구역 밖) — 공시가격을 모르면 빼지 않고 최저가 1억 5천 이하만 남겨 '확인 필요'로 둔다
      if (f.under1 && !under1(it, a)) return false;
      if (!done && f.onlyOpen && /(낙찰|취소|종결|매각)/.test(it.status || '') && !/진행/.test(it.status || '')) return false;
      if (f.q && !`${it.title} ${it.address} ${it.caseNo}`.includes(f.q)) return false;
      return true;
    }).sort((x, y) => (villa && f.sort === 'verdict' ? NUM(y.a.renoMoney?.profit ?? y.a.money?.profit) - NUM(x.a.renoMoney?.profit ?? x.a.money?.profit) : 0) || (done && f.sort === 'verdict' ? endOf(y.it).localeCompare(endOf(x.it)) : 0) || (opp && f.sort === 'verdict' ? NUM(y.a.opportunity?.profit) - NUM(x.a.opportunity?.profit) : 0) || sorter(f.sort, origin)(x, y) || rank(x.a) - rank(y.a) || (y.a.score?.total ?? -1) - (x.a.score?.total ?? -1) || String(x.it.bidEnd || '').localeCompare(String(y.it.bidEnd || '')));
  }, [analyzed, f, opp, done, villa, origin]);

  // 예상 낙찰가(=우리 입찰가) 기준표: 불러온 물건 중 낙찰가가 있는 완료 물건으로 만든다
  const table = premTable;
  const rates = useMemo(() => (items ? soldRateTable([...items, ...past]) : null), [items, past]);

  const counts = useMemo(() => {
    const c = { now: 0, wait: 0, check: 0, hard: 0, unknown: 0, special: 0, suspect: 0 };
    rows.forEach(({ a }) => { c[a.verdict] = (c[a.verdict] || 0) + 1; if (a.special) c.special++; });
    return c;
  }, [rows]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-4">
      {done && <DoneSummary rows={rows} table={table} />}
      {schedule && <Schedule rows={rows} table={table} rates={rates} settings={settings} />}
      {villa && (
        <div className="card border-brand/30 text-sm">
          <div className="text-base font-extrabold">빌라 단타 — 땅값 수준에 사서 올수리 후 매도</div>
          <p className="mt-1 text-ink/70">다세대·연립만 모았습니다. 올수리 후 세후 수익 큰 순입니다. 기준: <b>최저가가 땅값(대지지분 가치) 이하인가</b>, <b>올수리 후 500만 원 이상 남나</b>, 그리고 <b>물렸을 때 버틸 수 있나</b>(같은 동 거래가 충분한가, 전세로 돌리면 묶이는 돈이 내 돈 안인가, 월세가 이자를 넘나).</p>
          <p className="mt-1 text-xs text-ink/50">한 달에 2건씩 팔려면 동시에 8~12건이 돌아가야 합니다. 출구가 둘 다 막힌 물건은 한 건만 물려도 연쇄로 막힙니다.</p>
        </div>
      )}
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
            <option value="end">정렬: 입찰일 가까운 순(남은 기간)</option>
            <option value="near">정렬: 거리 가까운 순</option>
            <option value="roi">정렬: 수익률 높은 순</option>
            <option value="verdict">정렬: 판정·매력도</option>
            <option value="profit">정렬: 예상 수익 큰 순</option>
            <option value="own">정렬: 내 돈 적게 드는 순</option>
            <option value="certainty">정렬: 확실성 높은 순</option>
          </select>
          <input className="input col-span-2 sm:col-span-6" placeholder="주소·사건번호 검색" value={f.q} onChange={set('q')} />
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink/70">
          <label className="flex items-center gap-1.5 font-bold text-brand"><input type="checkbox" checked={f.corpOnly} onChange={set('corpOnly')} /> 법인 단타 적합만(A·B)</label>
          <label className="flex items-center gap-1.5 font-bold text-brand" title="수도권 공시가격 1억 이하 주택은 법인도 취득세 중과(12%) 제외 — 정비구역 안은 예외 없음"><input type="checkbox" checked={f.under1} onChange={set('under1')} /> 공시가격 1억 이하 주택만</label>
          {!done && <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.onlyOpen} onChange={set('onlyOpen')} /> 진행 중만</label>}
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.showExcluded} onChange={set('showExcluded')} /> 관심 제외 물건도 보기</label>
          {f.sort === 'near' && origin && <span className="text-xs text-ink/60">거리 기준: <b>{origin.label}</b> · 물건 위치는 법정동 중심(대략) — 위치가 아직 없는 물건은 맨 뒤</span>}
          <span className="ml-auto flex gap-1.5">
            <Badge tone="now">지금 {counts.now}</Badge><Badge tone="wait">대기 {counts.wait}</Badge><Badge tone="cash">특수 {counts.special}</Badge><Badge tone="hard">가격 안 맞음 {counts.hard}</Badge>{counts.suspect > 0 && <Badge tone="hard">오류 의심 {counts.suspect}</Badge>}{counts.pending > 0 && <Badge>자료 수집 중 {counts.pending}</Badge>}
          </span>
        </div>
      </div>

      {error && <div className="card text-sm text-hard">불러오기 실패: {error}</div>}
      {!items && !error && <div className="card text-sm text-ink/50">물건을 불러오는 중…</div>}
      {items && !dealsReady && <div className="card text-sm text-ink/50">물건 {items.length.toLocaleString('ko-KR')}건 · 시세 받는 중 {dealsProg ? `${dealsProg.done}/${dealsProg.total}` : ''}… (한 번 받으면 이 브라우저에 보관돼 다음부터 빠릅니다)</div>}
      {items && dealsReady && !analyzed && <div className="card text-sm text-ink/50">판정 계산 중 {anaProg ? `${anaProg.done.toLocaleString('ko-KR')}/${anaProg.total.toLocaleString('ko-KR')}` : ''}…</div>}
      {analyzed && !rows.length && <Empty>조건에 맞는 물건이 없습니다.</Empty>}

      {!schedule && <div className="grid gap-3 md:grid-cols-2">
        {rows.slice(0, shown).map(({ it, a }) => (
          <Link key={it.id} to={`/item/${encodeURIComponent(it.id)}`} className="card block transition hover:border-brand/50 hover:shadow-sm">
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <VerdictBadge verdict={a.verdict} />
              {a.calcAnomaly && <Badge tone="hard">계산 이상</Badge>}
              {fitOf(it, a) && <Badge tone={{ A: 'now', B: 'wait', X: 'hard' }[fitOf(it, a)] || 'muted'}>법인 {fitOf(it, a)}</Badge>}
              {a.score && <Badge tone={a.score.grade === 'A' ? 'now' : a.score.grade === 'B' ? 'wait' : 'muted'}>{a.score.grade} · {a.score.total}점</Badge>}
              <Badge tone={it.category === 'bankrupt' ? 'cash' : 'muted'}>{SOURCE_LABEL[it.source === 'court' ? 'court' : it.category]}</Badge>
              {a.special?.types.map((t) => <Badge key={t.key} tone="cash">{t.label}</Badge>)}
              {a.cashType && <Badge tone="cash">현금청산형</Badge>}
              {a.member.status === 'member' && a.member.rank >= 3 && <Badge tone="now">입주권형</Badge>}
              {a.member.status === 'check' && <Badge tone="wait">분양자격 확인</Badge>}
              {it.manual?.zone ? <Badge tone="brand">{it.manual.zone.stage || '정비구역'}</Badge>
                : it.redevMatch?.status === 'listed' ? <Badge tone="brand">{it.redevMatch.name} · {it.redevMatch.stage}</Badge>
                  : it.redevMatch?.status === 'unlisted' ? <Badge tone="wait">정비구역(목록 미등록)</Badge>
                    : a.redev.length > 0 && !a.cashType && <Badge tone="brand">정비구역</Badge>}
              {a.farm && <Badge tone="wait">농지</Badge>}
              {notVilla(it) === '지하층' && <Badge tone="hard">지하·반지하</Badge>}
              {typeof it.failCount === 'number' && it.failCount >= 8 && <Badge tone="hard">유찰 {it.failCount}회 — 이유 확인</Badge>}
              {a.excluded && <Badge>관심 제외</Badge>}
              {it.otherRounds > 0 && <Badge>다른 회차 {it.otherRounds}건</Badge>}
              {docsLabel(it) && <Badge tone="brand">📎 {docsLabel(it)}</Badge>}
              <span className="ml-auto text-xs text-ink/50">{it.caseNo}</span>
            </div>
            <div className="flex items-start gap-2">
              {thumbOf(it) && <img src={thumbOf(it)} alt="" loading="lazy" className="h-14 w-20 shrink-0 rounded-md border border-line object-cover" />}
              <span className="mt-0.5 shrink-0 rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-white">{typeLabel(it)}</span>
              <div className="font-bold leading-snug">{it.title}</div>
            </div>
            <div className="mt-0.5 truncate text-xs text-ink/60">{it.address}</div>
            {areaText(it) && <div className="text-xs text-ink/60">{areaText(it)}</div>}
            {a.estimateBasis && <div className="text-xs text-wait">{a.estimateBasis}</div>}
            {/* 가격부터: 감정가 → 최저가 → 유찰·마감 (10-25 '감정가·최저가를 먼저 써 줘야지') */}
            <div className="mt-2 grid grid-cols-4 gap-2 rounded-lg border border-line p-2 text-sm">
              <div><div className="text-xs text-ink/50">감정가</div><div className="num font-bold">{eok(it.appraisal)}</div></div>
              <div><div className="text-xs text-ink/50">최저가</div><div className="num font-bold text-brand">{eok(it.minBid)}</div><div className="text-xs text-ink/50">감정가의 {pct(a.ratio)}</div></div>
              <div><div className="text-xs text-ink/50">유찰</div><div className="font-bold">{it.failCount ?? '—'}회</div>{it.roundList?.length > 1 && <div className="truncate text-xs text-ink/50">다음 {eok(it.roundList[1].minBid)}</div>}</div>
              <div><div className="text-xs text-ink/50">마감</div><div className="font-bold">{endOf(it).slice(5) || '—'}{daysLeft(it) !== null && <span className={`ml-1 text-xs ${daysLeft(it) <= 7 ? 'text-hard' : 'text-ink/50'}`}>D-{daysLeft(it)}</span>}</div>{origin && it.geo && <div className="text-xs text-ink/50">약 {Math.round(distKm(origin, it.geo) * 10) / 10}km</div>}</div>
            </div>
            {a.verdict !== 'pending' && (
              <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
                <div><div className="text-xs text-ink/50">우리가 본 가치</div><div className="num font-bold">{eok(a.value)}</div></div>
                <div><div className="text-xs text-ink/50">{a.special ? '매수상한(바닥 기준)' : '매수상한'}</div><div className="num font-bold">{eok(a.cap)}</div></div>
                <div><div className="text-xs text-ink/50">진입 시점</div><div className="font-bold">{a.reasons.length || a.verdict === 'check' ? '—' : a.entry ? a.entry.label : '—'}</div></div>
              </div>
            )}
            {it.aiReview && <div className={`mt-1 rounded px-2 py-1 text-xs ${/제외|보류/.test(it.aiReview.verdict) ? 'bg-hard/10 text-hard' : 'bg-now/10 text-now'}`}><b>Claude 검토 [{it.aiReview.verdict}]</b> {String(it.aiReview.conclusion || '').slice(0, 90)}</div>}
            {!it.aiReview && it.source === 'court' && a.rightsReview && <div className="mt-1 text-xs text-wait">명세서 미확인 — Claude 검토 대기</div>}
            {a.verdict === 'pending' && <div className="mt-2 rounded-md bg-ink/5 p-2 text-xs text-ink/70"><b>자료 수집 중 — 판정 안 함</b>: {a.gaps.required.join(' · ')} 이(가) 아직 없습니다. 모이면 자동으로 판정합니다.</div>}
            {a.verdict !== 'pending' && a.money && !a.money.upside && (
              <div className="mt-3 grid grid-cols-4 gap-2 rounded-lg bg-paper p-2 text-sm">
                <div><div className="text-xs text-ink/50">{a.special ? '최악일 때 수익' : a.money.owner === 'corp' ? '세후 수익' : '예상 수익'}</div><div className={`num font-bold ${a.money.profit < 0 ? 'text-hard' : 'text-now'}`}>{eok(a.money.profit)}</div></div>
                <div><div className="text-xs text-ink/50">수익률</div><div className="num font-bold">{a.money.roi === null ? '—' : `${Math.round(a.money.roi * 100)}%`}</div></div>
                <div><div className="text-xs text-ink/50">내 돈</div><div className="num font-bold">{eok(a.money.own)}</div>{a.money.later > 0 && <div className="text-[10px] text-wait">+분담금 {eok(a.money.later)}</div>}</div>
                <div><div className="text-xs text-ink/50">확실성</div><div className="font-bold">{a.certainty ? `${a.certainty.grade} (${a.certainty.value})` : '—'}</div></div>
              </div>
            )}
            {done && <ResultRow it={it} a={a} table={table} />}
            {!done && a.verdict !== 'pending' && <BidRow it={it} a={a} table={table} />}
            {!done && <RoundLine it={it} a={a} table={table} rates={rates} settings={settings} />}
            {villa && <VillaRow it={it} a={a} />}
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
            {a.reasons.length > 0 && <div className="mt-2 text-xs text-hard">{a.reasons.join(' · ')}</div>}
            {a.anomalies?.length > 0 && <div className="mt-2 rounded-md bg-hard/5 p-2 text-xs text-hard">{a.anomalies.join(' · ')}</div>}
            {a.calcAnomaly && <div className="mt-2 rounded-md bg-hard/5 p-2 text-xs text-hard"><b>계산 이상</b> — {a.calcAnomaly.join(' · ')} (지금 매력·A등급에서 제외)</div>}
          </Link>
        ))}
      </div>}
      {!schedule && rows.length > shown && <button className="btn w-full border border-line bg-white" onClick={() => setShown((n) => n + PAGE)}>더 보기 ({shown.toLocaleString('ko-KR')} / {rows.length.toLocaleString('ko-KR')}건)</button>}
    </div>
  );
}

// 목록 썸네일: 온비드 썸네일 → 상세 첫 사진(http 주소만 — 예전 상세의 깨진 값 제외)
const thumbOf = (it) => [it.thumbnail, ...(it.detail?.photos || [])].find((u) => /^https?:\/\//.test(String(u || ''))) || null;
const NUM = (v, dir = -1) => (v === null || v === undefined || Number.isNaN(v) ? (dir < 0 ? -Infinity : Infinity) : v);
// 거리: 기준 위치(내 위치 → 허용 안 하면 미추홀구청)에서 물건의 법정동 중심까지(직선, km)
export const HOME = { lat: 37.4638, lng: 126.6503, label: '미추홀구청' };
export function distKm(o, g) {
  if (!o || !g?.lat) return null;
  const R = 6371; const r = (d) => (d * Math.PI) / 180;
  const a = Math.sin(r(g.lat - o.lat) / 2) ** 2 + Math.cos(r(o.lat)) * Math.cos(r(g.lat)) * Math.sin(r(g.lng - o.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function daysLeft(it) {
  const e = endOf(it); if (!e) return null;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return Math.round((new Date(e) - new Date(today)) / 86400e3);
}
function sorter(key, origin) {
  if (key === 'near') return (x, y) => NUM(distKm(origin, x.it.geo), 1) - NUM(distKm(origin, y.it.geo), 1);
  if (key === 'profit') return (x, y) => NUM(y.a.money?.profit) - NUM(x.a.money?.profit);
  if (key === 'roi') return (x, y) => NUM(y.a.money?.roi) - NUM(x.a.money?.roi);
  if (key === 'own') return (x, y) => NUM(x.a.money?.own, 1) - NUM(y.a.money?.own, 1);
  if (key === 'certainty') return (x, y) => NUM(y.a.certainty?.value) - NUM(x.a.certainty?.value);
  // 법원 '2026.10.28'과 공매 '2026-10-28 17:00' 형식이 섞여 글자 그대로 비교하면 순서가 틀렸다 → 날짜로 맞춰 비교
  if (key === 'end') return (x, y) => (endOf(x.it) || '9').localeCompare(endOf(y.it) || '9');
  return () => 0;
}

// 빌라 단타 목록에서 뺄 것: 지하층, 건물 200㎡ 초과(통건물·복합건물), 상가·업무·숙박 용도가 섞인 것
// (온비드·법원 분류가 '다세대·연립'이라도 실제로는 오피스 지하 호실이나 통건물인 경우가 있음)
export function notVilla(it) {
  const text = `${it.title || ''} ${it.address || ''} ${it.detail?.addressFull || ''}`;
  if (/지하\s?\d*층|제?지층|지하\d|\bB\d+층/.test(text)) return '지하층';
  if (it.buildingArea && it.buildingArea > 200) return '건물 200㎡ 초과';
  if (/(기타용도|복합건물|근린|상가|사무소|오피스|업무시설|숙박|공장|창고)/.test(`${text} ${it.usage || ''}`)) return '주거 외 용도';
  return null;
}

// 공시가격 1억 이하 주택: 아파트·빌라·단독·오피스텔(주거) 중 공시가격 1억 이하(정비구역 밖).
// 공시가격을 아직 못 받은 물건은 최저가 1억 5천 이하일 때만 '확인 필요'로 남긴다.
function under1(it, a) {
  if (!['apt', 'rh', 'sh', 'offi'].includes(tradeTypeOf(it))) return false;
  if (a.redev?.length || it.manual?.zone) return false;
  const hp = it.housePrice?.matched ? it.housePrice.price : null;
  if (hp !== null && hp !== undefined) return hp <= 1e8;
  return (it.minBid || Infinity) <= 1.5e8;
}

// 판정이 '해결 안 됨'이어도 법인 적합도는 물건 성격으로 정해진다
function fitOf(it, a) {
  if (a.money?.fit) return a.money.fit.grade;
  return corpFit(it, propertyKind(it, tradeTypeOf(it), a.farm)).grade;
}

// 빌라 단타 줄: 땅값 대비 · 올수리 수익 · 회전율 · 두 번째 출구
function VillaRow({ it, a }) {
  const lv = a.landValue; const rm = a.renoMoney || a.money; const lq = a.liquidity; const ex = a.exit2;
  const good = (b) => (b === true ? 'text-now' : b === false ? 'text-hard' : 'text-ink/50');
  return (
    <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-brand/20 bg-brand2/40 p-2 text-sm sm:grid-cols-4">
      <div><div className="text-xs text-ink/50">땅값 대비 최저가</div><div className={`num font-bold ${good(lv?.ratio ? lv.ratio <= 1 : null)}`}>{lv?.ratio ? pct(lv.ratio) : '땅값 확인 전'}</div><div className="text-[11px] text-ink/50">{lv ? `땅값 ${eok(lv.value)}` : '공시지가·대지권 필요'}</div></div>
      <div><div className="text-xs text-ink/50">{a.renoMoney ? '올수리 후 세후' : '세후 수익'}</div><div className={`num font-bold ${good(rm ? rm.profit >= 5000000 : null)}`}>{rm && !rm.upside ? eok(rm.profit) : '—'}</div><div className="text-[11px] text-ink/50">{rm && !rm.upside ? `내 돈 ${eok(rm.own)} · ${rm.months}개월` : ''}</div></div>
      <div><div className="text-xs text-ink/50">회전율</div><div className={`font-bold ${good(lq ? lq.level !== '낮음' : null)}`}>{lq ? lq.level : '—'}</div><div className="text-[11px] text-ink/50">{lq ? `같은 동 1년 ${lq.sameDong}건` : ''}</div></div>
      <div><div className="text-xs text-ink/50">물렸을 때</div><div className={`font-bold ${good(ex ? ex.ok : null)}`}>{ex ? (ex.ok === null ? '전월세 자료 없음' : ex.ok ? '버틸 수 있음' : '출구 막힘') : '—'}</div>
        <div className="text-[11px] text-ink/50">{ex?.jeonse ? `전세 ${eok(ex.jeonse)}→묶임 ${eok(ex.lockedAfterJeonse)}` : '전세 자료 없음'}{ex?.rent ? ` · 월세 ${eok(ex.rent.monthly)}/이자 ${eok(ex.monthlyInterest)}` : ''}</div></div>
    </div>
  );
}

// ── 완료 물건 ──────────────────────────────────────────────
const VERDICT_LABEL = { now: '지금 매력', wait: '유찰 대기', check: '권리 확인 후 판단', suspect: '오류 의심', hard: '가격 안 맞음', unknown: '시세 부족', shareUnknown: '지분비율 미확인', pending: '자료 수집 중' };
// 입찰(매각)기일이 지났거나 상태가 낙찰·매각·유찰·종결·취소인 물건
const endOf = (it) => String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10);
function isEnded(it) {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const e = endOf(it);
  // 다음 기일이 내일 이후인데 확정 낙찰이 없으면 진행 중 — 법원 상태 '유찰'은 지난 회차 결과라서 종료로 보면 안 됨
  if (e && e > today && !it.result?.soldPrice) return false;
  if (it.result) return true;
  if (/(낙찰|매각|유찰|종결|취소|기각|변경|마감)/.test(it.status || '') && !/진행/.test(it.status || '')) return true;
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
function ResultRow({ it, a, table }) {
  const r = resultOf(it);
  const pred = it.forecast?.bid ? { price: it.forecast.bid, scope: `입찰 전 기록(${it.forecast.at})` } : predictPrice(it, table, { self: true });
  const out = pred ? bidOutcome(it, pred.price, it.forecast ? it.forecast.cap : a?.cap, r.kind) : null;
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
    {pred && <div className="mt-1 text-xs"><b>우리 입찰가(예상 낙찰가) {eok(pred.price)}</b> <span className="text-ink/50">— {pred.scope}{it.forecast?.bid ? '' : ' · 사후 계산'}</span>{out && <span className={`ml-1 font-bold ${out.kind === 'win' || out.kind === 'alone' ? 'text-now' : out.kind === 'lose' ? 'text-wait' : 'text-ink/50'}`}>→ {out.label}</span>}</div>}
    <div className={`mt-2 grid grid-cols-4 gap-2 rounded-lg p-2 text-sm ${r.kind === 'sold' ? 'bg-now/5' : r.kind === 'fail' ? 'bg-wait/5' : 'bg-ink/5'}`}>
      <div><div className="text-xs text-ink/50">결과</div><div className="font-bold">{r.label}</div></div>
      <div><div className="text-xs text-ink/50">낙찰가</div><div className="num font-bold">{r.price ? eok(r.price) : '—'}</div></div>
      <div><div className="text-xs text-ink/50">감정가 대비</div><div className="num font-bold">{r.rate ? pct(r.rate) : '—'}</div></div>
      <div><div className="text-xs text-ink/50">응찰자</div><div className="num font-bold">{r.bidders ? `${r.bidders}명` : '—'}</div></div>
    </div>
    </>
  );
}
// 물건 단위 채점: 공매는 같은 물건이 매주 회차마다 다시 올라와 유찰 10번이면 '틀림'이 10번 세진다.
// 같은 물건의 회차를 묶어 한 번만 센다 — 우리가 처음 '산다'(상한 ≥ 최저가)였던 회차, 없으면 마지막 회차의 결과로.
const itemKey = (it) => `${it.source}|${it.cltrMngNo || it.caseNo || ''}|${it.itemNo || ''}|${it.address || it.title || ''}`;
function perItem(rows) {
  const g = new Map();
  rows.forEach((x) => { const k = itemKey(x.it); (g.get(k) || g.set(k, []).get(k)).push(x); });
  return [...g.values()].map((list) => {
    if (list.length === 1) return list[0];
    const done = list.filter(({ it }) => ['sold', 'fail'].includes(resultOf(it).kind))
      .sort((p, q) => endOf(p.it).localeCompare(endOf(q.it)) || Number(p.it.round || 0) - Number(q.it.round || 0));
    if (!done.length) return { ...list[0], rounds: list.length };
    const buyAt = done.find(({ it, a }) => { const cap = it.forecast ? it.forecast.cap : a.cap; return cap && it.minBid && cap >= it.minBid; });
    return { ...(buyAt || done[done.length - 1]), rounds: list.length };
  });
}

// 우리 판정별로 실제 결과가 어땠는지(채점)
function DoneSummary({ rows: roundRows, table }) {
  const [unit, setUnit] = useState('item');
  const items = useMemo(() => perItem(roundRows), [roundRows]);
  const rows = unit === 'item' ? items : roundRows;
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-ink/60">세는 단위</span>
        {[['item', `물건 단위 ${items.length}건`], ['round', `회차 단위 ${roundRows.length}건`]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setUnit(k)} className={`rounded-full border px-2.5 py-1 ${unit === k ? 'border-brand bg-brand text-white' : 'border-line bg-white'}`}>{l}</button>
        ))}
        <span className="text-ink/50">물건 단위: 같은 물건의 여러 회차를 한 번만(처음 '산다'였던 회차, 없으면 마지막 회차) — 유찰이 반복된 물건이 점수를 부풀리지 않게</span>
      </div>
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
      <RoundScore rows={rows} />
      <AnalyzerScore rows={rows} table={table} />
      <ScoreBreakdown rows={rows} />
    </div>
  );
}

// 성적표: 규칙은 고정(판단 기준 2026-10-23판)한 채로, 종류·지역·개찰월별 적중률과 '낙찰가 ÷ 우리 판단 가치'
function ScoreBreakdown({ rows: allRows }) {
  const [ev, setEv] = useState('all'); // 실거래 근거별로 나눠 보기 — 규칙은 그대로, 보기만 나눈다
  const evCount = { all: 0, ab: 0, cd: 0, none: 0 };
  allRows.forEach(({ it, a }) => { const k = resultOf(it).kind; if (k !== 'sold' && k !== 'fail') return; evCount.all++; evCount[evidenceGroup(a)]++; });
  const rows = ev === 'all' ? allRows : allRows.filter(({ a }) => evidenceGroup(a) === ev);
  const med = (xs) => { if (!xs.length) return null; const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };
  const group = (keyOf) => {
    const g = {};
    rows.forEach(({ it, a }) => {
      const r = resultOf(it); if (!['sold', 'fail'].includes(r.kind)) return;
      const k = keyOf(it); const cap = it.forecast ? it.forecast.cap : a.cap; const value = it.forecast ? it.forecast.value : a.value;
      const x = (g[k] ||= { n: 0, hit: 0, judged: 0, sold: 0, ratio: [] });
      x.n++; if (r.kind === 'sold') { x.sold++; if (r.rate && r.rate > 1) x.over = (x.over || 0) + 1; }
      // 첫 회차(유찰 없이) 바로 팔린 것 — 시장이 감정가 근처 이상으로 본 물건. 우리가 '안 산다'였으면 놓친 기회
      const first = isFirstRound(it); // 유찰 0회 또는 최저가 = 감정가. 알 수 없으면 따로 센다
      if (first === null) x.firstUnknown = (x.firstUnknown || 0) + 1;
      if (first) { x.firstN = (x.firstN || 0) + 1; if (r.kind === 'sold') { x.firstSold = (x.firstSold || 0) + 1; if (cap && it.minBid && cap < it.minBid) x.missed = (x.missed || 0) + 1; } }
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
        <thead className="text-ink/50"><tr><th className="text-left">구분</th><th className="text-right">결과</th><th className="text-right">낙찰률</th><th className="text-right">감정가 초과 낙찰</th><th className="text-right">1회차 바로 낙찰</th><th className="text-right">채점</th><th className="text-right">적중률</th><th className="text-right">낙찰가÷우리 가치</th></tr></thead>
        <tbody>{data.map(([k, v]) => {
          const ratio = med(v.ratio);
          return (<tr key={k} className="border-t border-line/50"><td>{k}</td><td className="text-right">{v.n}</td><td className="text-right">{pct(v.sold / v.n)}</td><td className="text-right">{v.sold ? `${pct((v.over || 0) / v.sold)}` : '—'}</td><td className="text-right">{v.firstN ? `${v.firstSold || 0}/${v.firstN}건` : '—'}{v.missed ? <span className="ml-1 font-bold text-wait">놓침 {v.missed}</span> : null}{v.firstUnknown ? <span className="ml-1 text-ink/40" title="유찰 횟수·감정가가 없어 첫 회차인지 알 수 없음">?{v.firstUnknown}</span> : null}</td><td className="text-right">{v.judged}</td>
            <td className={`text-right font-bold ${v.judged >= 10 ? (v.hit / v.judged >= 0.7 ? 'text-now' : v.hit / v.judged < 0.6 ? 'text-hard' : '') : 'text-ink/40'}`}>{v.judged ? pct(v.hit / v.judged) : '—'}</td>
            <td className={`text-right ${ratio && (ratio < 0.85 || ratio > 1.15) ? 'font-bold text-wait' : ''}`}>{ratio ? `${Math.round(ratio * 100)}% (${v.ratio.length})` : '—'}{v.odd ? <span className="ml-1 text-ink/40">이상 {v.odd}</span> : null}</td></tr>);
        })}</tbody>
      </table>
    </div>
  );
  const month = (it) => String(it.result?.openAt || it.bidEnd || '').replace(/\./g, '-').slice(0, 7) || '날짜 없음';
  return (
    <div className="mt-4 rounded-md border border-line p-2 text-sm">
      <div className="font-extrabold">성적표 — 규칙 고정(분석기 {ANALYZER_VERSION}) 상태의 채점</div>
      <p className="text-xs text-ink/60">규칙은 고치지 않고 성적부터 봅니다. 적중률은 10건 이상일 때만 색을 칠합니다(70%↑ 초록, 60%↓ 빨강). <b>1회차 바로 낙찰</b>은 첫 회차(유찰 0회, 또는 최저가 = 감정가) 물건 중 팔린 건수이고(?는 유찰 횟수·감정가가 없어 판단 불가), <b>놓침</b>은 그중 우리가 '안 산다'(상한 &lt; 최저가)였던 건수 — 시장이 우리보다 높게 본 기회입니다. 낙찰가는 과열·실수·특수 사정으로 어이없게 나오는 경우가 많아, 평균이 아니라 <b>중앙값</b>을 쓰고 감정가 150% 초과·우리 가치의 2배 초과나 30% 미만 낙찰은 <b>"이상"으로 따로 세어 뺍니다</b>. <b>낙찰가÷우리 가치</b>가 100%보다 많이 낮으면 우리가 가치를 높게 본 것, 많이 높으면 낮게 본 것입니다(85~115% 밖은 노란색).</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {Object.keys(EVIDENCE_LABEL).map((k) => (
          <button key={k} type="button" onClick={() => setEv(k)} className={`rounded-full border px-2.5 py-1 ${ev === k ? 'border-brand bg-brand text-white' : 'border-line bg-white'}`}>{EVIDENCE_LABEL[k]} {evCount[k]}</button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-ink/50">근거가 다른 물건을 섞어 채점하면 규칙이 맞은 건지 운이었는지 구분이 안 됩니다. A·B는 같은 단지 실거래, C·D는 같은 동·시군구 실거래, '없음'은 감정가·공시가격만으로 판단한 물건입니다.</p>
      <Table title="물건 종류별" data={group((it) => typeLabel(it))} />
      <Table title="지역별" data={group((it) => `${it.sido || ''} ${it.sgg || ''}`.trim() || '지역 없음')} />
      <Table title="개찰 월별" data={group(month).sort((p, q) => q[0].localeCompare(p[0]))} />
    </div>
  );
}

// 유찰 예측 성적표: 처음 봤을 때 '몇 회 더 유찰된 뒤 팔릴 것'이라고 기록한 예측 vs 실제로 몇 회 더 유찰된 뒤 팔렸나
//  + '매력 전환 회차까지 남아 있을 확률'이 실제로 맞았나(그 회차 전에 팔려 버린 비율)
function RoundScore({ rows }) {
  const xs = [];
  rows.forEach(({ it }) => {
    const r = resultOf(it); if (r.kind !== 'sold') return;
    const f = it.forecastFirst?.rounds || it.forecast?.rounds; if (!f) return;
    const actual = typeof it.failCount === 'number' && typeof f.failCount === 'number' ? it.failCount - f.failCount : null;
    xs.push({ it, f, actual });
  });
  const scored = xs.filter((x) => x.actual !== null && x.f.expectSale);
  const exact = scored.filter((x) => x.actual === x.f.expectSale.k).length;
  const near = scored.filter((x) => Math.abs(x.actual - x.f.expectSale.k) <= 1).length;
  const early = scored.filter((x) => x.f.expectSale.k > x.actual).length; // 우리가 예상한 것보다 빨리 팔림(시장이 더 적극적)
  const ok = xs.filter((x) => x.f.firstOk && x.actual !== null);
  const goneBefore = ok.filter((x) => x.actual < x.f.firstOk.k).length; // 매력 회차 오기 전에 팔려 버림
  const predSurvive = ok.length ? ok.reduce((s, x) => s + (x.f.firstOk.survive ?? 0), 0) / ok.length : null;
  const P = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${Math.round(v * 100)}%`);
  return (
    <div className="mt-4 rounded-md border border-line p-2 text-sm">
      <div className="font-extrabold">유찰 예측 성적표 — "몇 번 더 유찰된 뒤 팔린다"가 맞았나</div>
      <p className="text-xs text-ink/60">처음 본 날 기록한 예측(예상 낙찰 회차·매력 전환 회차·그때까지 남아 있을 확률)을 실제 결과와 맞춥니다. 예측은 매일 밤 기록되고 결과를 보고 고치지 않습니다. 법원은 유찰 횟수가 바로 비교되고, 공매는 회차별 결과가 붙는 대로 채점됩니다.</p>
      {scored.length + ok.length === 0 ? <div className="mt-2 text-xs text-ink/50">아직 채점할 물건이 없습니다(예측 기록 {xs.length}건 — 기일이 지나 낙찰 결과가 붙으면 쌓입니다).</div> : (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-paper p-2 text-xs sm:grid-cols-5">
          <div><div className="text-ink/50">예상 낙찰 회차 정확히 맞힘</div><div className="num font-bold">{P(scored.length ? exact / scored.length : null)} <span className="text-ink/40">({scored.length})</span></div></div>
          <div><div className="text-ink/50">±1회 안</div><div className="num font-bold">{P(scored.length ? near / scored.length : null)}</div></div>
          <div><div className="text-ink/50">예상보다 빨리 팔림</div><div className="num font-bold">{P(scored.length ? early / scored.length : null)}</div></div>
          <div><div className="text-ink/50">매력 회차까지 남아 있을 확률(예측)</div><div className="num font-bold">{P(predSurvive)}</div></div>
          <div><div className="text-ink/50">실제로 남아 있던 비율</div><div className="num font-bold">{P(ok.length ? 1 - goneBefore / ok.length : null)} <span className="text-ink/40">({ok.length})</span></div></div>
        </div>
      )}
    </div>
  );
}

// 분석기 성적표: 예상 낙찰가를 그대로 입찰가로 썼다면(가산 폭 0%) — 오차 폭으로 등급을 매긴다
function AnalyzerScore({ rows, table }) {
  const [open, setOpen] = useState(false);
  if (!table || !table.n) return null;
  const items = [];
  const outcome = { alone: 0, win: 0, lose: 0, skip: 0 };
  rows.forEach(({ it, a }) => {
    const r = resultOf(it);
    if (r.kind !== 'sold' && r.kind !== 'fail') return;
    const pred = it.forecast?.bid ? { price: it.forecast.bid } : predictPrice(it, table, { self: true });
    if (!pred) return;
    const o = bidOutcome(it, pred.price, it.forecast ? it.forecast.cap : a.cap, r.kind);
    if (o) outcome[o.kind]++;
    const p = soldOf(it);
    if (r.kind === 'sold' && p) items.push({ it, a, e: p / pred.price - 1, frozen: Boolean(it.forecast?.bid) });
  });
  if (!items.length) return null;
  const grp = (keyOf) => {
    const g = {};
    items.forEach((x) => { const k = keyOf(x); (g[k] ||= []).push(x.e); });
    return Object.entries(g).map(([k, es]) => [k, scoreErrors(es)]).sort((p, q) => q[1].n - p[1].n);
  };
  const all = scoreErrors(items.map((x) => x.e));
  const frozen = items.filter((x) => x.frozen).length;
  const P = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);
  const tone = (g) => (/^A|^B/.test(g) ? 'text-now' : /^D|^F/.test(g) ? 'text-hard' : '');
  const T = ({ title, data, limit = 12 }) => (
    <div>
      <div className="mt-3 font-bold">{title}</div>
      <table className="w-full text-xs">
        <thead className="text-ink/50"><tr><th className="text-left">구분</th><th className="text-right">낙찰</th><th className="text-right">오차</th><th className="text-right">치우침</th><th className="text-right">승률(가산 0%)</th><th className="text-right">승률 70%에 필요한 가산 폭</th><th className="text-right">등급</th></tr></thead>
        <tbody>{data.slice(0, limit).map(([k, v]) => (
          <tr key={k} className="border-t border-line/50"><td>{k}</td><td className="text-right">{v.n}</td><td className="text-right">{P(v.error)}</td><td className="text-right">{v.bias > 0 ? '+' : ''}{P(v.bias)}</td><td className="text-right">{P(v.win0)}</td><td className="text-right">{P(v.margin70)}</td><td className={`text-right font-bold ${v.n >= 10 ? tone(v.grade) : 'text-ink/40'}`}>{v.grade}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <div className="mt-4 rounded-md border-2 border-brand/40 p-2 text-sm">
      <div className="font-extrabold">분석기 성적표 — 예상 낙찰가를 그대로 써냈다면 (가산 폭 0%)</div>
      <p className="text-xs text-ink/60">물건마다 <b>예상 낙찰가 = 그 회차 최저가 × 같은 종류 완료 물건의 '낙찰가÷최저가' 중앙값</b>을 우리 입찰가로 씁니다. 가산 폭은 일부러 0% — <b>가산 폭이 필요할수록 분석기가 틀린 것</b>이라, 필요한 가산 폭을 결과로 계산해 보여 줍니다. 오차 등급: A ≤2% · B ≤4% · C ≤7% · D ≤10% · F &gt;10% (10건 미만은 표본 부족). 치우침이 +면 시장이 우리 예상보다 높게 썼다는 뜻입니다.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-paper p-2 sm:grid-cols-5">
        <div><div className="text-xs text-ink/50">등급</div><div className={`text-lg font-extrabold ${tone(all.grade)}`}>{all.grade}</div></div>
        <div><div className="text-xs text-ink/50">오차(중앙값)</div><div className="num font-bold">{P(all.error)}</div></div>
        <div><div className="text-xs text-ink/50">치우침</div><div className="num font-bold">{all.bias > 0 ? '+' : ''}{P(all.bias)}</div></div>
        <div><div className="text-xs text-ink/50">승률(가산 0%)</div><div className="num font-bold">{P(all.win0)}</div></div>
        <div><div className="text-xs text-ink/50">승률 70%에 필요한 가산 폭</div><div className="num font-bold">{P(all.margin70)}</div></div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1 text-xs sm:grid-cols-4">
        <div className="text-now">유찰 회차 단독 낙찰 <b>{outcome.alone}</b></div>
        <div className="text-now">경쟁해서 이김 <b>{outcome.win}</b></div>
        <div className="text-wait">짐 <b>{outcome.lose}</b></div>
        <div className="text-ink/50">입찰 안 함(예상가 &gt; 매수상한) <b>{outcome.skip}</b></div>
      </div>
      <p className="mt-1 text-[11px] text-ink/50">낙찰가가 있는 {items.length}건 기준. 입찰 전에 굳혀 둔 입찰가로 채점한 물건 {frozen}건, 나머지는 <b>사후 계산</b>(그 물건 자신은 빼고 계산해 답을 보고 맞히지 않게 함). 법원경매는 낙찰가가 들어오면 함께 채점됩니다.</p>
      <T title="응찰 형태별" data={grp((x) => ((x.it.result?.bidders || 0) <= 1 ? '단독 응찰' : '경쟁(2명 이상)'))} />
      <T title="물건 종류별" data={grp((x) => typeLabel(x.it))} />
      <T title="실거래 근거별" data={grp((x) => EVIDENCE_LABEL[evidenceGroup(x.a)])} />
      <T title="시도별" data={grp((x) => x.it.sido || '지역 없음')} />
      <button type="button" className="mt-2 text-xs text-brand underline" onClick={() => setOpen(!open)}>{open ? '시군구별 접기' : '시군구별 보기'}</button>
      {open && <T title="시군구별" data={grp((x) => `${x.it.sido || ''} ${x.it.sgg || ''}`.trim() || '지역 없음')} limit={60} />}
    </div>
  );
}

// 일정표: 물건마다 '매력으로 바뀌는 회차'의 날짜(공매는 공고상 실제 날짜, 법원은 다음 기일 약 5주 간격 추정)와
// 세부 검토를 시작할 날(입찰 7일 전, 법원은 명세서·현장 확인 때문에 10일 전)을 모아 주 단위로 보여 준다.
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00+09:00`); d.setDate(d.getDate() + n); return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
const weekOf = (ymd) => { const d = new Date(`${ymd}T00:00:00+09:00`); const day = (d.getDay() + 6) % 7; d.setDate(d.getDate() - day); return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
function Schedule({ rows, table, rates, settings }) {
  const [only, setOnly] = useState('best');
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const list = useMemo(() => {
    const out = [];
    rows.forEach(({ it, a }) => {
      if (!a.cap || a.special || ['suspect', 'shareUnknown', 'pending'].includes(a.verdict) || a.calcAnomaly) return;
      const plan = roundPlan(it, a, { premium: table, rates, courtRate: courtRate(it, settings).rate });
      const t = plan && (only === 'best' ? plan.best || plan.firstOk : plan.firstOk);
      if (!t || !t.date) return;
      const review = addDays(t.date, it.source === 'court' ? -10 : -7);
      if (t.date < today) return;
      out.push({ it, a, t, review: review < today ? today : review });
    });
    return out.sort((x, y) => x.review.localeCompare(y.review) || y.t.ev - x.t.ev);
  }, [rows, table, rates, settings, only]);
  const weeks = {}; list.forEach((x) => { (weeks[weekOf(x.review)] ||= []).push(x); });
  const P = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  const ics = () => {
    const ev = (d, title, desc) => `BEGIN:VEVENT\r\nUID:${d}-${Math.random().toString(36).slice(2)}@jbslab\r\nDTSTART;VALUE=DATE:${d.replace(/-/g, '')}\r\nSUMMARY:${title}\r\nDESCRIPTION:${desc}\r\nEND:VEVENT\r\n`;
    const body = list.map((x) => ev(x.review, `[검토] ${x.it.title}`.slice(0, 70), `${x.t.label} 입찰 ${x.t.date} · 최저가 ${eok(x.t.price)} · 예상 낙찰가 ${eok(x.t.bid)}`) + ev(x.t.date, `[입찰] ${x.it.title}`.slice(0, 70), `최저가 ${eok(x.t.price)} · 우리 입찰가 ${eok(x.t.bid)} · 상한 ${eok(x.a.cap)}`)).join('');
    const blob = new Blob([`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//jbslab//auction//KO\r\n${body}END:VCALENDAR\r\n`], { type: 'text/calendar' });
    const u = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = u; el.download = `경매일정_${today}.ics`; el.click(); URL.revokeObjectURL(u);
  };
  return (
    <div className="card text-sm">
      <div className="text-base font-extrabold">일정표 — 언제 매력으로 바뀌고, 언제 검토를 시작할지</div>
      <p className="mt-1 text-xs text-ink/60">물건마다 앞으로 회차별 최저가 → 예상 낙찰가 → 우리 매수상한 대비 남는 돈과 <b>그 회차까지 안 팔리고 남아 있을 확률</b>(완료 물건 낙찰률)을 따져 들어갈 회차를 고릅니다. 공매는 공고에 나온 <b>실제 회차 날짜</b>, 법원은 다음 기일을 약 5주 간격으로 <b>추정</b>합니다. 세부 검토(권리분석·등기부·현장·중개사 확인)는 입찰 7일 전(법원 10일 전)부터.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => setOnly('best')} className={`rounded-full border px-2.5 py-1 ${only === 'best' ? 'border-brand bg-brand text-white' : 'border-line'}`}>기대값 최대 회차</button>
        <button type="button" onClick={() => setOnly('first')} className={`rounded-full border px-2.5 py-1 ${only === 'first' ? 'border-brand bg-brand text-white' : 'border-line'}`}>처음 매력 되는 회차</button>
        <span className="text-ink/50">{list.length}건</span>
        <button type="button" className="btn ml-auto" onClick={ics} disabled={!list.length}>캘린더 파일 받기(.ics)</button>
      </div>
      {Object.entries(weeks).map(([w, xs]) => (
        <div key={w} className="mt-3">
          <div className="font-bold">{w} 주 — 검토 시작 {xs.length}건</div>
          <table className="w-full text-xs">
            <thead className="text-ink/50"><tr><th className="text-left">검토 시작</th><th className="text-left">입찰일</th><th className="text-left">물건</th><th className="text-right">회차</th><th className="text-right">최저가</th><th className="text-right">예상 낙찰가</th><th className="text-right">남는 돈</th><th className="text-right">남아 있을 확률</th></tr></thead>
            <tbody>{xs.map(({ it, a, t, review }) => (
              <tr key={it.id} className="border-t border-line/50">
                <td>{review}</td>
                <td>{t.date}{t.actual ? '' : <span className="text-ink/40"> 추정</span>}</td>
                <td><Link className="text-brand underline" to={`/item/${encodeURIComponent(it.id)}`}>{typeLabel(it)} · {String(it.title || '').slice(0, 34)}</Link> <span className="text-ink/40">{SOURCE_LABEL[it.source === 'court' ? 'court' : it.category]}</span></td>
                <td className="text-right">{t.label}</td>
                <td className="text-right">{eok(t.price)}</td>
                <td className="text-right">{eok(t.bid)}</td>
                <td className="text-right text-now">{eok(t.room)}</td>
                <td className="text-right">{P(t.survive)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ))}
      {!list.length && <div className="mt-3 text-ink/50">앞으로 매력으로 바뀌는 회차가 있는 물건이 없습니다.</div>}
    </div>
  );
}

// 진행 물건 카드: 몇 회 더 유찰되면 살 만해지나 + 그때까지 남아 있을 확률(기대값이 가장 큰 회차)
function RoundLine({ it, a, table, rates, settings }) {
  if (!a.cap || a.special || a.verdict === 'pending') return null;
  const plan = roundPlan(it, a, { premium: table, rates, courtRate: courtRate(it, settings).rate });
  if (!plan) return null;
  const P = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  const b = plan.best; const f = plan.firstOk;
  if (!f) return <div className="mt-1 text-xs text-hard">앞으로 {plan.rows.length}회차 안에는 예상 낙찰가가 우리 매수상한 아래로 안 내려옴 — 매력 전환 없음</div>;
  return (
    <div className="mt-1 text-xs">
      <b>매력 전환</b>: {f.label}{f.date ? ` ${f.date.slice(5)}${f.actual ? '' : '(추정)'}` : ''}(최저가 {eok(f.price)}, 예상 낙찰가 {eok(f.bid)}){f.k > 0 ? ` · 그때까지 남아 있을 확률 ${P(f.survive)}` : ''}
      {b && b.k !== f.k && <span className="ml-1 font-bold text-brand">→ 기대값 최대: {b.label}{b.date ? ` ${b.date.slice(5)}` : ''}(남아 있을 확률 {P(b.survive)}, 남는 돈 {eok(b.room)})</span>}
    </div>
  );
}

// 진행 물건 카드: 예상 낙찰가(=우리 입찰가)
function BidRow({ it, a, table }) {
  const pred = predictPrice(it, table);
  if (!pred) return null;
  const over = a.cap && pred.price > a.cap;
  return (
    <div className="mt-2 flex flex-wrap items-baseline gap-x-2 rounded-md border border-brand/30 px-2 py-1 text-xs">
      <span>우리 입찰가(예상 낙찰가)</span><b className="num text-sm">{eok(pred.price)}</b>
      <span className="text-ink/50">최저가의 {Math.round(pred.premium * 1000) / 10}% · {pred.scope}</span>
      {over && <span className="font-bold text-wait">매수상한보다 높음 — 이 회차는 입찰 안 함</span>}
    </div>
  );
}

// 특수물건은 같은 판정 안에서 일반 물건 뒤로(섞여서 위로 튀지 않게). 특수물건 필터에서는 자기들끼리 순위
function rank(a) { return order(a.verdict) + (a.special ? 0.5 : 0); }

// 공매는 같은 물건이 회차(공고)마다 따로 올라온다 → 물건번호·주소가 같으면 가장 가까운 진행 회차 하나만
// 카드에 '어떤 원본이 들어와 있나' 표시 — 누르면 상세 화면에서 열린다(법원 원본·등기부는 관리자 로그인에서만)
function docsLabel(it) {
  const out = [];
  const cd = it.courtDocs || {};
  if (cd['감정평가서'] || it.detail?.appraisalFile) out.push('감정평가서');
  if (cd['현황조사서']) out.push('현황조사서');
  if (cd['매각물건명세서']) out.push('명세서');
  if (it.registryAt) out.push('등기부');
  return out.join('·');
}

function order(v) { return { now: 0, wait: 1, check: 2, unknown: 3, hard: 4, suspect: 5 }[v] ?? 6; }
