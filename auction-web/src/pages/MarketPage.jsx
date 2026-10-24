import { useEffect, useMemo, useState } from 'react';
import { getDeals } from '../lib/store.js';
import { SGG_CODES, SIDO } from '../data/defaults.js';
import { Card, Empty } from '../components/ui.jsx';
import { eok, won } from '../lib/analyze.js';
import { backtest } from '../lib/marketBacktest.js';

const TYPES = [['apt', '아파트'], ['rh', '연립·다세대'], ['sh', '단독·다가구'], ['offi', '오피스텔'], ['land', '토지']];

export default function MarketPage() {
  const [sido, setSido] = useState('인천광역시');
  const [sgg, setSgg] = useState('부평구');
  const [type, setType] = useState('apt');
  const [deals, setDeals] = useState(null);
  const [dong, setDong] = useState('');

  const lawd = (SGG_CODES[sido] || {})[sgg];
  useEffect(() => { setDeals(null); getDeals(type, lawd, 12).then(setDeals); }, [type, lawd]);

  const dongs = useMemo(() => [...new Set((deals || []).map((d) => d[9]).filter(Boolean))].sort(), [deals]);
  const months = useMemo(() => {
    const m = {};
    (deals || []).filter((d) => !d[7] && d[0] && d[1] && (!dong || d[9] === dong)).forEach((d) => { (m[d[11]] ||= []).push(d[0] / d[1]); });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([ym, arr]) => {
      const s = [...arr].sort((x, y) => x - y);
      return { ym, count: arr.length, median: s[Math.floor(s.length / 2)] };
    });
  }, [deals, dong]);
  const max = Math.max(1, ...months.map((x) => x.median));

  return (
    <div className="space-y-4">
      <Card title="실거래 시세 (해제 거래 제외)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <select className="input" value={sido} onChange={(e) => { setSido(e.target.value); setSgg(Object.keys(SGG_CODES[e.target.value])[0]); setDong(''); }}>{SIDO.map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" value={sgg} onChange={(e) => { setSgg(e.target.value); setDong(''); }}>{Object.keys(SGG_CODES[sido] || {}).map((s) => <option key={s}>{s}</option>)}</select>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select className="input" value={dong} onChange={(e) => setDong(e.target.value)}><option value="">동 전체</option>{dongs.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
      </Card>
      <Card title="월별 ㎡당 중앙값">
        {!deals && <div className="text-sm text-ink/50">불러오는 중…</div>}
        {deals && !months.length && <Empty>아직 수집된 거래가 없습니다. (첫 수집은 며칠에 나눠 진행됩니다)</Empty>}
        <div className="space-y-1.5">
          {months.map((m) => (
            <div key={m.ym} className="grid grid-cols-[64px_1fr_150px] items-center gap-2 text-sm">
              <span className="text-ink/60">{m.ym.slice(0, 4)}.{m.ym.slice(4)}</span>
              <div className="h-5 rounded bg-paper"><div className="h-5 rounded bg-brand/70" style={{ width: `${(m.median / max) * 100}%` }} /></div>
              <span className="num text-right">{won(Math.round(m.median))} · {m.count}건</span>
            </div>
          ))}
        </div>
        {months.length > 0 && type !== 'land' && <p className="mt-3 text-xs text-ink/50">84㎡ 환산 최근값: {eok(months[months.length - 1].median * 84)}</p>}
      </Card>
      {type !== 'land' && <MarketScore type={type} deals={deals} sgg={sgg} />}
    </div>
  );
}

// 시세 성적표 — 경매에서 시세가 틀리면 입찰가·수익·내 돈이 다 같이 틀린다. 그래서 시세 계산부터 따로 채점한다.
function MarketScore({ type, deals, sgg }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setRes(null); }, [type, deals]);
  const run = () => { setBusy(true); setTimeout(() => { setRes(backtest(type, deals || [])); setBusy(false); }, 30); };
  const P = (v) => (v === null || v === undefined ? '—' : `${Math.round(v * 1000) / 10}%`);
  const tone = (g) => (/^A|^B/.test(g) ? 'text-now' : /^D|^F/.test(g) ? 'text-hard' : '');
  const T = ({ title, data }) => (
    <div className="mt-3">
      <div className="font-bold">{title}</div>
      <table className="w-full text-xs">
        <thead className="text-ink/50"><tr><th className="text-left">구분</th><th className="text-right">건수</th><th className="text-right">오차</th><th className="text-right">치우침</th><th className="text-right">±5% 안</th><th className="text-right">±10% 안</th><th className="text-right">기본~수리 범위 안</th><th className="text-right">등급</th></tr></thead>
        <tbody>{data.slice(0, 15).map(([k, v]) => (
          <tr key={k} className="border-t border-line/50"><td>{k}</td><td className="text-right">{v.n}</td><td className="text-right">{P(v.error)}</td><td className="text-right">{v.bias > 0 ? '+' : ''}{P(v.bias)}</td><td className="text-right">{P(v.within5)}</td><td className="text-right">{P(v.within10)}</td><td className="text-right">{P(v.inBand)}</td><td className={`text-right font-bold ${tone(v.grade)}`}>{v.grade}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
  return (
    <Card title="시세 성적표 — 우리 시세 계산이 실제 거래를 얼마나 맞히나">
      <p className="text-xs text-ink/60">최근 2개월 거래를 하나씩 '맞힐 문제'로 놓고, <b>그 전 달까지의 거래만</b> 써서 사이트와 같은 방식(닮은 거래 비교)으로 시세를 계산한 뒤 실제 거래가와 비교합니다. 오차 등급: A ≤3% · B ≤5% · C ≤8% · D ≤12% · F &gt;12%(20건 미만은 표본 부족). 치우침이 +면 실제가 우리 시세보다 높게 팔린 것. '기본~수리 범위 안'은 실제 거래가가 우리가 본 기본 상태~수리된 상태 가격 사이에 들어온 비율입니다.</p>
      <button type="button" className="btn mt-2" disabled={!deals || busy} onClick={run}>{busy ? '채점 중…' : `${sgg} 채점하기`}</button>
      {res && (
        <div className="mt-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-paper p-2 sm:grid-cols-5">
            <div><div className="text-xs text-ink/50">등급</div><div className={`text-lg font-extrabold ${tone(res.all.grade)}`}>{res.all.grade}</div></div>
            <div><div className="text-xs text-ink/50">오차(중앙값)</div><div className="num font-bold">{P(res.all.error)}</div></div>
            <div><div className="text-xs text-ink/50">±5% 안에 맞힘</div><div className="num font-bold">{P(res.all.within5)}</div></div>
            <div><div className="text-xs text-ink/50">기본~수리 범위 안</div><div className="num font-bold">{P(res.all.inBand)}</div></div>
            <div><div className="text-xs text-ink/50">시세를 낼 수 있었던 비율</div><div className="num font-bold">{P(res.coverage)}</div><div className="text-[11px] text-ink/50">{res.covered}/{res.total}건</div></div>
          </div>
          <T title="근거 등급별 (같은 단지일수록 잘 맞아야 정상)" data={res.byGrade} />
          <T title="층별" data={res.byFloor} />
          <T title="동별" data={res.byDong} />
          {res.worst.length > 0 && (
            <div className="mt-3">
              <div className="font-bold">가장 크게 빗나간 거래 — 실거래에 안 적힌 사정(수리·급매·로열층 등)을 짐작해 볼 곳</div>
              <table className="w-full text-xs"><thead className="text-ink/50"><tr><th className="text-left">계약</th><th className="text-left">이름·동</th><th className="text-right">면적·층</th><th className="text-right">실제</th><th className="text-right">우리 시세</th><th className="text-right">차이</th></tr></thead>
                <tbody>{res.worst.map((r, i) => <tr key={i} className="border-t border-line/50"><td>{r.d[11]}</td><td>{r.d[5]} {r.d[9]}</td><td className="text-right">{r.d[1]}㎡ · {r.d[2]}층</td><td className="text-right">{eok(r.d[0])}</td><td className="text-right">{eok(r.pred)}</td><td className="text-right">{r.err > 0 ? '+' : ''}{P(r.err)}</td></tr>)}</tbody></table>
            </div>
          )}
          {res.misses.length > 0 && <p className="mt-2 text-[11px] text-ink/50">시세를 못 낸 이유 예: {res.misses.join(' / ')}</p>}
        </div>
      )}
    </Card>
  );
}
