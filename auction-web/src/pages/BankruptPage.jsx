import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBankrupt, listListings } from '../lib/store.js';
import { Badge, Card, Empty } from '../components/ui.jsx';
import { eok } from '../lib/analyze.js';

export default function BankruptPage() {
  const [notices, setNotices] = useState(null);
  const [assets, setAssets] = useState([]);
  const [f, setF] = useState({ realOnly: true, capitalOnly: false, hideExpired: true, q: '' });

  useEffect(() => {
    listBankrupt().then(setNotices).catch(() => setNotices([]));
    listListings().then((l) => setAssets(l.filter((x) => x.category === 'bankrupt'))).catch(() => {});
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const rows = useMemo(() => (notices || []).filter((n) => {
    if (f.realOnly && !n.realEstate) return false;
    if (f.capitalOnly && !['서울특별시', '인천광역시', '경기도'].includes(n.sido)) return false;
    if (f.hideExpired && n.expiresAt && n.expiresAt < today) return false;
    if (f.q && !`${n.title} ${n.court} ${n.seller}`.includes(f.q)) return false;
    return true;
  }), [notices, f, today]);

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  return (
    <div className="space-y-4">
      <Card title={`온비드 파산자산 (전국) ${assets.length}건`} right={<Link to="/" className="text-sm text-brand">목록에서 보기 →</Link>}>
        <p className="mb-3 text-sm text-ink/60">파산관재인이 온비드에 올린 물건은 API로 바로 받아 판정까지 합니다(재산유형 0013 파산자산).</p>
        {assets.length ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {assets.slice(0, 8).map((x) => (
              <Link key={x.id} to={`/item/${encodeURIComponent(x.id)}`} className="rounded-lg border border-line p-3 text-sm hover:border-brand/50">
                <div className="font-medium">{x.title}</div>
                <div className="text-xs text-ink/60">{x.sido} {x.sgg} · 최저 {eok(x.minBid)} · 유찰 {x.failCount ?? '—'}회</div>
              </Link>
            ))}
          </div>
        ) : <Empty>아직 수집된 파산자산이 없습니다.</Empty>}
      </Card>

      <Card title="법원 회생·파산 자산매각 공고 (전국)" right={<a className="text-sm text-brand" href="https://www.scourt.go.kr/portal/notice/realestate/RealNoticeList.work" target="_blank" rel="noreferrer">대법원 게시판</a>}>
        <p className="mb-3 text-sm text-ink/60">온비드에 안 올라오고 공고문(PDF)으로만 나오는 매각입니다. 제목·첨부 이름으로 부동산 여부를 먼저 걸렀으니, 관심 가는 건 원문을 열어 확인하세요.</p>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.realOnly} onChange={set('realOnly')} /> 부동산 포함만</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.capitalOnly} onChange={set('capitalOnly')} /> 수도권 법원만</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.hideExpired} onChange={set('hideExpired')} /> 만료 공고 숨김</label>
          <input className="input max-w-xs" placeholder="검색" value={f.q} onChange={set('q')} />
        </div>
        {!notices && <div className="text-sm text-ink/50">불러오는 중…</div>}
        {notices && !rows.length && <Empty>조건에 맞는 공고가 없습니다.</Empty>}
        <div className="divide-y divide-line">
          {rows.map((n) => (
            <a key={n.id} href={n.url} target="_blank" rel="noreferrer" className="block py-3 hover:bg-paper/60">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone={n.realEstate ? 'brand' : 'muted'}>{n.kind}</Badge>
                <Badge>{n.court}</Badge>
                {n.expiresAt && <span className={`text-xs ${n.expiresAt < today ? 'text-ink/40' : 'text-wait'}`}>만료 {n.expiresAt}</span>}
              </div>
              <div className="mt-1 font-medium">{n.title}</div>
              <div className="text-xs text-ink/60">{n.seller} {n.postedAt ? `· 게시 ${n.postedAt}` : ''} {n.attachments?.length ? `· 첨부 ${n.attachments.map((x) => x.name).join(', ')}` : ''}</div>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
