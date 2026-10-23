// 오늘의 호가 확인 — 매일 매력도 상위 물건을 골라 두고(자동), 호가는 정민 님이 링크를 눌러 직접 보고 넣는다.
// 우리 서버는 네이버·호갱노노 등에 접속하지 않는다(링크만). 넣은 호가는 가치 검토의 기준 하나로 들어가 다시 계산된다.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listListings, getSettings, getDeals, saveListing } from '../lib/store.js';
import { analyze, tradeTypeOf, eok, typeLabel, VERDICT } from '../lib/analyze.js';
import { lawdOf } from '../data/defaults.js';
import { Badge, Empty } from '../components/ui.jsx';

const DAY = 86400e3;
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const endOf = (it) => String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10);

// 검색어: 단지·건물 이름이 있으면 그것, 없으면 읍면동 + 지번
function queryOf(it) {
  const name = it.ledger?.titles?.[0]?.bldNm || (String(it.title || '').match(/[가-힣A-Za-z0-9]+(아파트|빌라|맨션|타운|하이츠|캐슬|자이|푸르지오|래미안|힐스테이트|아이파크|e편한세상|더샵|롯데캐슬|오피스텔|팰리스)/) || [])[0];
  const place = `${it.sgg || ''} ${it.emd || ''}`.trim();
  return name ? `${place} ${name}` : String(it.address || it.title || '').split(/\s+/).slice(0, 5).join(' ');
}
function links(it) {
  const q = queryOf(it);
  const e = encodeURIComponent;
  return [
    ['네이버 매물', `https://search.naver.com/search.naver?query=${e(`${q} 매매`)}`],
    ['네이버 지도', `https://map.naver.com/p/search/${e(q)}`],
    ['호갱노노', `https://hogangnono.com/search?q=${e(q)}`],
    ['다음 검색', `https://search.daum.net/search?q=${e(`${q} 매물 호가`)}`],
  ];
}

export default function AskingPage({ admin }) {
  const [items, setItems] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dealsMap, setDealsMap] = useState({});
  const [saved, setSaved] = useState({});
  useEffect(() => { Promise.all([listListings({}), getSettings()]).then(([l, s]) => { setItems(l); setSettings(s); }); }, []);
  useEffect(() => {
    if (!items) return;
    const keys = [...new Set(items.map((it) => { const l = lawdOf(it.sido, it.sgg); return l ? `${tradeTypeOf(it)}|${l}` : null; }).filter(Boolean))].filter((k) => !(k in dealsMap)).slice(0, 40);
    if (!keys.length) return;
    Promise.all(keys.map(async (k) => { const [t, l] = k.split('|'); return [k, await getDeals(t, l, 12)]; })).then((p) => setDealsMap((m) => ({ ...m, ...Object.fromEntries(p) })));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  const limit = settings?.askingDaily ?? 10;
  const minScore = settings?.askingMinScore ?? 70;
  const rows = useMemo(() => {
    if (!items || !settings) return [];
    const t = today();
    return items.map((it) => ({ it, a: analyze(it, { settings, deals: dealsMap[`${tradeTypeOf(it)}|${lawdOf(it.sido, it.sgg)}`] }) }))
      .filter(({ it, a }) => a.score && !a.anomalies?.length && !a.excluded && endOf(it) >= t && !['land'].includes(tradeTypeOf(it)))
      .filter(({ a }) => a.score.total >= minScore || a.opportunity)
      .map((r) => {
        const asked = r.it.manual?.asking;
        const fresh = asked?.at && Date.now() - new Date(asked.at).getTime() < 14 * DAY;
        return { ...r, fresh };
      })
      .filter((r) => !r.fresh) // 2주 안에 확인한 건 빼고
      .sort((x, y) => (endOf(x.it) <= addDays(14) ? 0 : 1) - (endOf(y.it) <= addDays(14) ? 0 : 1) || (y.a.score.total - x.a.score.total))
      .slice(0, limit);
  }, [items, settings, dealsMap, minScore, limit]);

  const save = async (it, low, high, memo) => {
    const asking = { low: Number(low) * 1e4 || null, high: Number(high) * 1e4 || Number(low) * 1e4 || null, memo: memo || '', at: new Date().toISOString() };
    await saveListing({ id: it.id, manual: { ...(it.manual || {}), asking } });
    setSaved((s) => ({ ...s, [it.id]: asking }));
  };

  return (
    <div className="space-y-4">
      <div className="card text-sm">
        <div className="text-base font-extrabold">오늘의 호가 확인 {rows.length}건</div>
        <p className="mt-1 text-ink/70">매력도 {minScore}점 이상(또는 기회) 물건 중 입찰 마감 2주 안의 것부터 하루 {limit}건을 고릅니다. 링크를 눌러 호가를 보고 최저·최고만 넣으세요. 넣은 호가는 가치 검토에 <b>"현재 호가(직접 확인)" × 95%</b>로 들어가 점수·매수상한이 다시 계산됩니다. 확인한 물건은 2주 동안 이 목록에서 빠집니다.</p>
        <p className="mt-1 text-xs text-ink/50">이 화면은 링크만 만들고 남의 사이트에 접속하지 않습니다. 직접 보기 번거로운 날은 대화창에서 "오늘 호가 10건 봐 줘"라고 시키시면 됩니다.</p>
      </div>
      {!items && <div className="card text-sm text-ink/50">고르는 중…</div>}
      {items && !rows.length && <Empty>오늘 확인할 물건이 없습니다.</Empty>}
      {rows.map(({ it, a }) => <Row key={it.id} it={it} a={a} admin={admin} onSave={save} saved={saved[it.id]} />)}
    </div>
  );
}

function addDays(n) { return new Date(Date.now() + 9 * 3600e3 + n * DAY).toISOString().slice(0, 10); }

function Row({ it, a, admin, onSave, saved }) {
  const [low, setLow] = useState(''); const [high, setHigh] = useState(''); const [memo, setMemo] = useState('');
  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="now">{VERDICT[a.verdict]?.label}</Badge><Badge>{a.score.grade} · {a.score.total}점</Badge>
        <span className="rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-white">{typeLabel(it)}</span>
        <Link to={`/report/${encodeURIComponent(it.id)}`} className="font-bold underline">{it.title}</Link>
        <span className="ml-auto text-xs text-ink/50">마감 {endOf(it)}</span>
      </div>
      <div className="mt-1 text-xs text-ink/60">{it.address} · 최저가 {eok(it.minBid)} · 판단용 가치 {eok(a.value)}{a.valuation ? ` (${a.valuation.low ? `${eok(a.valuation.low)}~${eok(a.valuation.high)}` : ''}, 신뢰도 ${a.valuation.confidence})` : ''}</div>
      <div className="mt-2 flex flex-wrap gap-2">{links(it).map(([n, u]) => <a key={n} href={u} target="_blank" rel="noreferrer" className="btn border border-line bg-white">{n} ↗</a>)}</div>
      {saved ? <div className="mt-2 text-now">저장됨: 호가 {eok(saved.low)}~{eok(saved.high)} — 새로고침하면 다시 계산된 값이 보입니다.</div> : admin ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <input className="input" inputMode="numeric" placeholder="호가 최저(만원)" value={low} onChange={(e) => setLow(e.target.value.replace(/\D/g, ''))} />
          <input className="input" inputMode="numeric" placeholder="호가 최고(만원)" value={high} onChange={(e) => setHigh(e.target.value.replace(/\D/g, ''))} />
          <input className="input" placeholder="메모(층·상태 등)" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <button className="btn bg-ink text-white" disabled={!low} onClick={() => onSave(it, low, high, memo)}>저장</button>
        </div>
      ) : <div className="mt-2 text-xs text-ink/50">호가 입력은 관리자 로그인 후 가능합니다.</div>}
    </div>
  );
}
