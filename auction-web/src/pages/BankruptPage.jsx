import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listBankrupt, listListings, getBankruptText } from '../lib/store.js';
import { parseNotice } from '../lib/bankruptParse.js';
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
        <p className="mb-3 text-sm text-ink/60">온비드에 안 올라오고 공고문(PDF·HWP)으로만 나오는 매각입니다. 서버가 대법원 첨부를 받아 글자를 뽑고, 소재지·면적·매각가·감정가·마감을 찾아 정리합니다(새벽 수집 때 자동, 관리자 화면 버튼으로 바로). 못 찾은 칸은 비워 둡니다 — 입찰 전에는 반드시 원문을 보세요.</p>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.realOnly} onChange={set('realOnly')} /> 부동산 포함만</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.capitalOnly} onChange={set('capitalOnly')} /> 수도권 법원만</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={f.hideExpired} onChange={set('hideExpired')} /> 만료 공고 숨김</label>
          <input className="input max-w-xs" placeholder="검색" value={f.q} onChange={set('q')} />
        </div>
        {!notices && <div className="text-sm text-ink/50">불러오는 중…</div>}
        {notices && !rows.length && <Empty>조건에 맞는 공고가 없습니다.</Empty>}
        <div className="divide-y divide-line">
          {rows.map((n) => <Notice key={n.id} n={n} today={today} />)}
        </div>
      </Card>
    </div>
  );
}

const DOC_STATUS = { ok: ['원문 읽음', 'now'], noText: ['스캔본 — 원문 직접 확인', 'wait'], error: ['첨부 받기 실패', 'hard'] };
function Notice({ n, today }) {
  const [full, setFull] = useState(null); const [open, setOpen] = useState(false);
  const p = useMemo(() => parseNotice(full || n.docHead), [full, n.docHead]);
  const toggle = async () => { if (!open && full === null && n.docChars) setFull(await getBankruptText(n.id).catch(() => '') || ''); setOpen(!open); };
  const st = n.docStatus ? DOC_STATUS[n.docStatus] : null;
  return (
    <div className="py-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={n.realEstate ? 'brand' : 'muted'}>{n.kind}</Badge>
        <Badge>{n.court}</Badge>
        {st ? <Badge tone={st[1]}>{st[0]}</Badge> : n.realEstate && <Badge>원문 받기 대기</Badge>}
        {p?.method && <Badge>{p.method}</Badge>}
        {n.expiresAt && <span className={`text-xs ${n.expiresAt < today ? 'text-ink/40' : 'text-wait'}`}>공고 만료 {n.expiresAt}</span>}
      </div>
      <a href={n.url} target="_blank" rel="noreferrer" className="mt-1 block font-medium underline-offset-2 hover:underline">{n.title} ↗</a>
      <div className="text-xs text-ink/60">{n.seller} {n.postedAt ? `· 게시 ${n.postedAt}` : ''}</div>
      {p && p.found > 0 && (
        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-line p-2 text-sm sm:grid-cols-4">
          <div><div className="text-xs text-ink/50">감정가</div><div className="num font-bold">{p.appraisal ? eok(p.appraisal) : '—'}</div></div>
          <div><div className="text-xs text-ink/50">매각(최저)가</div><div className="num font-bold text-brand">{p.minPrice ? eok(p.minPrice) : '—'}</div>{p.ratio && <div className="text-xs text-ink/50">감정가의 {Math.round(p.ratio * 100)}%</div>}</div>
          <div><div className="text-xs text-ink/50">마감</div><div className="font-bold">{p.due?.date ? `${p.due.date.slice(5)}${p.due.time ? ` ${p.due.time}` : ''}` : '—'}</div>{p.open && <div className="text-xs text-ink/50">개찰 {p.open.slice(5)}</div>}</div>
          <div><div className="text-xs text-ink/50">보증금</div><div className="font-bold">{typeof p.deposit === 'number' ? eok(p.deposit) : p.deposit || '—'}</div></div>
          {p.addrs.length > 0 && <div className="col-span-2 sm:col-span-4"><span className="text-xs text-ink/50">소재지 </span>{p.addrs.join(' / ')}{p.areas.length ? <span className="text-xs text-ink/60"> · {p.areas.slice(0, 3).map((a) => `${a.toLocaleString('ko-KR')}㎡`).join(', ')}</span> : null}{p.kinds.length ? <span className="text-xs text-ink/60"> · {p.kinds.join('·')}</span> : null}</div>}
          {(p.trustee || p.phone) && <div className="col-span-2 text-xs text-ink/60 sm:col-span-4">관재인 {p.trustee || ''} {p.phone || ''}</div>}
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
        {(n.docs || n.attachments || []).map((x, i) => <span key={i} className="text-ink/55">📎 {x.name}{x.status && x.status !== 'ok' ? ` (${x.note || x.status})` : ''}</span>)}
        {n.docChars > 0 && <button className="text-brand underline" onClick={toggle}>{open ? '원문 글자 닫기' : `원문 글자 보기(${n.docChars.toLocaleString('ko-KR')}자)`}</button>}
      </div>
      {open && <pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded border border-line bg-white p-2 text-xs leading-relaxed">{full || n.docHead}</pre>}
    </div>
  );
}
