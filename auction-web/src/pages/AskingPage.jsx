// 오늘의 호가 확인 — 매일 매력도 상위 물건을 골라 두고(자동), 링크로 네이버 등을 열어
// 북마크(호가 가져오기) 한 번 누르면 화면의 매매 호가가 읽혀 자동 입력·저장된다. 복사한 글로도 자동 입력 가능.
// 우리 서버는 네이버·호갱노노 등에 접속하지 않는다(정민 님 브라우저 화면 글만 읽음). 넣은 호가는 가치 검토 기준으로 다시 계산된다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { parseAskingRows, pickByArea, summarize, bookmarkletCode } from '../lib/askingParse.js';
import { listListings, getSettings, getDeals, saveListing } from '../lib/store.js';
import { analyze, tradeTypeOf, eok, typeLabel, VERDICT } from '../lib/analyze.js';
import { lawdOf } from '../data/defaults.js';
import { Badge, Empty } from '../components/ui.jsx';
import { dedupeRounds } from '../lib/rounds.js';
import { useChunkedMap } from '../lib/chunked.js';

const DAY = 86400e3;
const ACTIVE_KEY = 'jbslab_asking_active';
const getActive = () => { try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; } };
const setActive = (id) => { try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* 저장 불가 */ } };
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const endOf = (it) => String(it.bidEnd || '').replace(/\./g, '-').slice(0, 10);

// 검색어: 단지·건물 이름이 있으면 그것, 없으면 읍면동 + 지번
function queryOf(it) {
  const name = it.ledger?.titles?.[0]?.bldNm || (String(it.title || '').match(/[가-힣A-Za-z0-9]+(아파트|빌라|맨션|타운|하이츠|캐슬|자이|푸르지오|래미안|힐스테이트|아이파크|e편한세상|더샵|롯데캐슬|오피스텔|팰리스)/) || [])[0];
  const place = `${it.sgg || ''} ${it.emd || ''}`.trim();
  return name ? `${place} ${name}` : String(it.address || it.title || '').split(/\s+/).slice(0, 5).join(' ');
}
// 호가를 볼 곳: 네이버·디스코·호갱노노·직방·다방·네이버 지도를 모든 물건에 띄우고 종류별로 순서만 바꾼다
//  디스코·직방·다방은 주소로 바로 여는 주소가 없어 첫 화면을 열고, 누를 때 검색어를 클립보드에 복사해 둔다(검색창에 Ctrl+V)
function links(it) {
  const q = queryOf(it);
  const e = encodeURIComponent;
  const t = tradeTypeOf(it);
  const naver = ['네이버 매물', `https://search.naver.com/search.naver?query=${e(`${q} 매매`)}`];
  const map = ['네이버 지도', `https://map.naver.com/p/search/${e(q)}`];
  const hogang = ['호갱노노(아래 이 단지 매물)', `https://hogangnono.com/search?q=${e(q)}`];
  const disco = ['디스코(매물 탭)', 'https://www.disco.re/', true];
  const zig = ['직방 빌라(매매로)', 'https://www.zigbang.com/home/villa/map', true];
  const zigApt = ['직방', 'https://www.zigbang.com/home/apt/map', true];
  const dabang = ['다방', 'https://www.dabangapp.com/', true];
  // 모든 물건에 모든 사이트를 띄운다(어디에 매물이 있는지는 물건마다 열어 봐야 안다). 종류에 따라 순서만 바꾼다
  const zigAll = t === 'apt' || t === 'offi' ? zigApt : t === 'rh' || t === 'sh' ? zig : ['직방 상가·사무실(매매로)', 'https://www.zigbang.com/', true];
  if (t === 'apt') return [naver, hogang, disco, zigAll, dabang, map];
  if (t === 'offi') return [naver, dabang, zigAll, disco, hogang, map];
  if (t === 'rh' || t === 'sh') return [naver, disco, zigAll, dabang, hogang, map];
  return [disco, naver, zigAll, dabang, hogang, map];
}

export default function AskingPage({ admin }) {
  const [items, setItems] = useState(null);
  const [settings, setSettings] = useState(null);
  const [dealsMap, setDealsMap] = useState({});
  const [saved, setSaved] = useState({});
  const [notice, setNotice] = useState(null); // 자동 입력 결과 안내
  const [pending, setPending] = useState(null); // 어느 물건 것인지 모를 때 고르게 할 호가
  const loc = useLocation(); const nav = useNavigate();
  const handled = useRef('');
  const bm = useMemo(() => bookmarkletCode(`${window.location.origin}${import.meta.env.BASE_URL}`), []);
  useEffect(() => { window.name = 'jbslab_asking'; }, []); // 북마크가 이 탭으로 호가를 보낸다
  useEffect(() => { Promise.all([listListings({}), getSettings()]).then(([l, s]) => { setItems(l); setSettings(s); }); }, []);
  // 후보만 먼저 추린다(전에는 2만 건 전부를 판정했고, 시세는 첫 40개 지역만 받아 나머지는 시세 없이 판정됐다)
  //  · 같은 물건의 회차는 하나로 합친다(공매는 회차마다 공고 번호가 따로라 같은 집이 두 줄로 나왔다)
  //  · 마감 안 지난 것, 토지 아닌 것만
  const cands = useMemo(() => {
    if (!items) return null;
    const t = today();
    return dedupeRounds(items).filter((it) => endOf(it) >= t && tradeTypeOf(it) !== 'land');
  }, [items]);
  const needKeys = useMemo(() => (cands ? [...new Set(cands.map((it) => { const l = lawdOf(it.sido, it.sgg); return l ? `${tradeTypeOf(it)}|${l}` : null; }).filter(Boolean))] : []), [cands]);
  const dealsReady = Boolean(cands) && needKeys.every((k) => k in dealsMap);
  useEffect(() => {
    const need = needKeys.filter((k) => !(k in dealsMap));
    if (!need.length) return;
    let stop = false;
    (async () => {
      const got = {};
      for (let i = 0; i < need.length && !stop; i += 40) {
        const part = await Promise.all(need.slice(i, i + 40).map(async (k) => { const [tt, l] = k.split('|'); return [k, await getDeals(tt, l, 12).catch(() => [])]; }));
        part.forEach(([k, v]) => { got[k] = v; });
      }
      if (!stop) setDealsMap((m) => ({ ...m, ...got }));
    })();
    return () => { stop = true; };
  }, [needKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const limit = settings?.askingDaily ?? 10;
  const minScore = settings?.askingMinScore ?? 70;
  const [analyzed, anaProg] = useChunkedMap(cands && settings && dealsReady ? cands : null, (it) => ({ it, a: analyze(it, { settings, deals: dealsMap[`${tradeTypeOf(it)}|${lawdOf(it.sido, it.sgg)}`] }) }), [cands, settings, dealsMap, dealsReady]);
  const rows = useMemo(() => {
    if (!analyzed) return [];
    return analyzed
      // 판정이 '지금 매력'·'유찰 대기'인 것만 — 오류 의심·계산 이상·자료 수집 중·권리 확인 후 판단은 호가를 볼 단계가 아니다
      //  (전에는 점수만 보고 골라, 계산 이상으로 '오류 의심'이 된 물건도 B등급 점수로 남아 목록에 섞였다)
      .filter(({ a }) => ['now', 'wait'].includes(a.verdict) && a.score && !a.anomalies?.length && !a.calcAnomaly?.length && !a.excluded)
      .filter(({ a }) => a.score.total >= minScore || a.opportunity)
      .map((r) => {
        const asked = r.it.manual?.asking;
        const fresh = asked?.at && Date.now() - new Date(asked.at).getTime() < 14 * DAY;
        return { ...r, fresh };
      })
      .filter((r) => !r.fresh) // 2주 안에 확인한 건 빼고(어느 회차에 넣었든)
      .sort((x, y) => (endOf(x.it) <= addDays(14) ? 0 : 1) - (endOf(y.it) <= addDays(14) ? 0 : 1) || (y.a.score.total - x.a.score.total))
      .slice(0, limit);
  }, [analyzed, minScore, limit]);

  const save = async (it, low, high, memo, auto) => {
    const asking = { low: Number(low) * 1e4 || null, high: Number(high) * 1e4 || Number(low) * 1e4 || null, memo: memo || '', at: new Date().toISOString(), ...(auto ? { auto } : {}) };
    await saveListing({ id: it.id, manual: { ...(it.manual || {}), asking } });
    setSaved((s) => ({ ...s, [it.id]: asking }));
  };

  // 읽어 온 호가({price 만원, area ㎡})를 물건 전용면적과 같은 것만 골라 넣고 바로 저장
  const applyPrices = async (it, all, src) => {
    const area = Number(it.ledger?.unit?.exclusiveArea || it.buildingArea) || null;
    const { rows: byArea, mixed, noSame } = pickByArea(all, area);
    // 지하 물건은 지하 매물만, 지상 물건은 지하 매물을 뺀다(지하·반지하는 같은 면적이라도 값이 크게 낮음)
    const under = /지하/.test(`${it.title || ''} ${it.address || ''}`);
    const sameFloor = byArea.filter((r) => !!r.basement === under);
    const picked = sameFloor.length ? sameFloor : byArea;
    const floorNote = under ? (sameFloor.length ? ` · 지하 매물 ${sameFloor.length}건만` : ' · ⚠ 지하 매물이 없어 지상 매물 기준(실제보다 높음)') : (sameFloor.length < byArea.length ? ` · 지하 매물 ${byArea.length - sameFloor.length}건 뺌` : '');
    const sm = summarize(picked.map((r) => r.price));
    // 집 상태별 호가(매물 설명에 '올수리'·'급매'·'기본'이 적힌 것) — 실거래엔 없는 상태 정보
    const byCond = {}; ['top', 'basic', 'urgent'].forEach((c) => { const sc = summarize(picked.filter((r) => r.cond === c).map((r) => r.price)); if (sc) byCond[c] = { low: sc.low * 1e4, high: sc.high * 1e4, n: sc.n }; });
    if (!all.length) { setNotice({ bad: true, text: '매매 호가를 찾지 못했습니다. 단지를 눌러 매물 목록이 보이는 화면에서 다시 해 주세요.' }); return; }
    if (!sm) { setNotice({ bad: true, text: `매매 호가 ${all.length}건을 읽었지만 이 물건(전용 ${area}㎡)과 같은 면적 매물이 없어 저장하지 않았습니다.` }); return; }
    if (!admin) { setNotice({ bad: true, text: `호가 ${sm.n}건을 읽었지만 관리자 로그인이 안 돼 있어 저장하지 못했습니다.` }); return; }
    const areaNote = (area ? `전용 ${area}㎡ ±10% ${sm.n}건/전체 ${all.length}건` : `${sm.n}건${mixed ? ', 면적 섞임 주의' : ''}`) + floorNote;
    await save(it, sm.low, sm.high, `자동 입력(${src || '화면'} · ${areaNote}${Object.keys(byCond).length ? ` · 상태 표시 ${Object.entries(byCond).map(([c, v]) => `${{ top: '수리', basic: '기본', urgent: '급매' }[c]} ${v.n}`).join(', ')}` : ''})`, { src: src || '', n: sm.n, total: all.length, area, rows: all.slice(0, 50), byCond });
    setNotice({ bad: mixed || (under && !sameFloor.length), text: `${it.title}: ${areaNote} → 호가 ${eok(sm.low * 1e4)}~${eok(sm.high * 1e4)} 저장${noSame ? ` (면적 다른 ${noSame}건 뺌)` : ''}${mixed ? ' — 물건 면적을 몰라 여러 면적이 섞였을 수 있습니다' : ''}` });
  };

  // 북마크가 보낸 #/asking?prices=… 받기
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const raw = q.get('prices');
    if (!raw || !items || handled.current === loc.key) return;
    handled.current = loc.key;
    const prices = raw.split(',').map((x) => { const bs = x.endsWith('!'); const [pa, c] = x.replace(/!$/, '').split('~'); const [p, a] = pa.split('@'); return { price: Number(p), area: a ? Number(a) : null, cond: { t: 'top', b: 'basic', u: 'urgent' }[c] || null, basement: bs }; }).filter((r) => r.price > 0);
    const src = q.get('src') || '';
    nav('/asking', { replace: true });
    const it = items.find((x) => x.id === getActive());
    if (it) applyPrices(it, prices, src);
    else setPending({ prices, src });
  }, [loc, items]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="card text-sm">
        <div className="text-base font-extrabold">오늘의 호가 확인 {rows.length}건</div>
        <p className="mt-1 text-ink/70">매력도 {minScore}점 이상(또는 기회) 물건 중 입찰 마감 2주 안의 것부터 하루 {limit}건을 고릅니다. <b>링크를 눌러 매물 화면을 연 뒤, 북마크바의 "호가 가져오기"를 한 번 누르면</b> 화면의 매매 호가가 읽혀 <b>이 물건과 같은 면적(전용 ±10%)</b>만으로 최저·최고가 자동 저장됩니다. 호갱노노는 검색 목록에서 단지를 한 번 누르고, 아래 "이 단지 매물"까지 내려 매물이 보일 때 누르세요. 📋 표시(디스코·직방·다방)는 누를 때 주소가 복사되니 열린 화면 검색창에 Ctrl+V 하세요. 디스코는 왼쪽 "매물" 탭, 직방은 거래 유형을 "매매"로 바꿔야 매매 호가가 보입니다. (화면 글을 전체 복사한 뒤 "복사한 글로 자동 입력"을 눌러도 됩니다.) 넣은 호가는 가치 검토에 <b>"현재 호가(직접 확인)" × 95%</b>로 들어가 점수·매수상한이 다시 계산됩니다. 확인한 물건은 2주 동안 이 목록에서 빠집니다.</p>
        <p className="mt-1 text-xs text-ink/50">이 화면은 링크만 만들고 남의 사이트에 접속하지 않습니다. 직접 보기 번거로운 날은 대화창에서 "오늘 호가 10건 봐 줘"라고 시키시면 됩니다.</p>
      </div>
      <div className="card text-sm">
        <div className="font-bold">처음 한 번만: 북마크 만들기</div>
        <p className="mt-1 text-ink/70">아래 버튼을 마우스로 끌어 크롬 북마크바에 놓으세요(북마크바가 안 보이면 Ctrl+Shift+B). 그다음부터는 <b>매매 매물 목록이 보이는 화면</b>(네이버 부동산 · 호갱노노 단지 아래 "이 단지 매물" · 디스코 매물 탭 · 직방/다방 매매)에서 그 북마크만 누르면 됩니다. 빌라·상가는 디스코·직방이 PC에서 매물이 보입니다.</p>
        <a href={bm} onClick={(e) => { e.preventDefault(); alert('이 버튼은 누르는 게 아니라 북마크바로 끌어다 놓는 버튼입니다.'); }} className="btn mt-2 inline-block bg-now text-white">⭐ 호가 가져오기</a>
      </div>
      {notice && <div className={`card text-sm ${notice.bad ? 'text-hard' : 'text-now'}`}>{notice.text}</div>}
      {pending && (
        <div className="card text-sm">
          <div className="font-bold">호가 {pending.prices.length}건을 읽었습니다 — 어느 물건 것인가요?</div>
          <div className="mt-2 flex flex-wrap gap-2">{rows.map(({ it }) => <button key={it.id} className="btn border border-line bg-white" onClick={() => { setPending(null); applyPrices(it, pending.prices, pending.src); }}>{it.title}</button>)}
            <button className="btn text-ink/50" onClick={() => setPending(null)}>버리기</button></div>
        </div>
      )}
      {!analyzed && <div className="card text-sm text-ink/50">고르는 중…{items && !dealsReady ? ' (시세 받는 중 — 한 번 받으면 이 브라우저에 보관됩니다)' : ''}{anaProg ? ` (판정 ${anaProg.done.toLocaleString('ko-KR')}/${anaProg.total.toLocaleString('ko-KR')})` : ''}</div>}
      {analyzed && !rows.length && <Empty>오늘 확인할 물건이 없습니다.</Empty>}
      {rows.map(({ it, a }) => <Row key={it.id} it={it} a={a} admin={admin} onSave={save} onPrices={applyPrices} saved={saved[it.id]} />)}
    </div>
  );
}

function addDays(n) { return new Date(Date.now() + 9 * 3600e3 + n * DAY).toISOString().slice(0, 10); }

function Row({ it, a, admin, onSave, onPrices, saved }) {
  const [low, setLow] = useState(''); const [high, setHigh] = useState(''); const [memo, setMemo] = useState('');
  return (
    <div className="card text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="now">{VERDICT[a.verdict]?.label}</Badge><Badge>{a.score.grade} · {a.score.total}점</Badge>
        <span className="rounded bg-ink px-1.5 py-0.5 text-xs font-bold text-white">{typeLabel(it)}</span>
        <Link to={`/report/${encodeURIComponent(it.id)}`} className="font-bold underline">{it.title}</Link>
        {it.otherRounds > 0 && <Badge>다른 회차 {it.otherRounds}건</Badge>}
        <span className="ml-auto text-xs text-ink/50">마감 {endOf(it)}</span>
      </div>
      <div className="mt-1 text-xs text-ink/60">{it.address} · 최저가 {eok(it.minBid)}{it.roundList?.length > 1 ? ` (다음 회차 ${it.roundList.slice(1, 3).map((r) => `${endOf(r)} ${eok(r.minBid)}`).join(' · ')})` : ''} · 판단용 가치 {eok(a.value)}{a.valuation ? ` (${a.valuation.low ? `${eok(a.valuation.low)}~${eok(a.valuation.high)}` : ''}, 신뢰도 ${a.valuation.confidence})` : ''}</div>
      <div className="mt-2 flex flex-wrap gap-2">{links(it).map(([n, u, copy]) => <a key={n} href={u} target="_blank" rel="opener" title={copy ? '주소가 복사됩니다 — 열린 화면 검색창에 Ctrl+V' : ''} onClick={() => { setActive(it.id); if (copy) { try { navigator.clipboard.writeText(queryOf(it)); } catch { /* 복사 불가 */ } } }} className="btn border border-line bg-white">{n}{copy ? ' 📋' : ''} ↗</a>)}
        {admin && !saved && <button className="btn border border-now text-now" onClick={async () => {
          setActive(it.id);
          let t = '';
          try { t = await navigator.clipboard.readText(); } catch { t = window.prompt('복사한 글을 여기에 붙여 넣으세요') || ''; }
          onPrices(it, parseAskingRows(t), '복사');
        }}>복사한 글로 자동 입력</button>}</div>
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
