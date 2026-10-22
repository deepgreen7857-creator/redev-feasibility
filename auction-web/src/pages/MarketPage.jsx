import { useEffect, useMemo, useState } from 'react';
import { getDeals } from '../lib/store.js';
import { SGG_CODES, SIDO } from '../data/defaults.js';
import { Card, Empty } from '../components/ui.jsx';
import { eok, won } from '../lib/analyze.js';

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
    </div>
  );
}
