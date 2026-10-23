// 등기부 열람본 카드 — 관리자만. 미니PC 등기부 수집기가 마이옥션 열람본을 정리해 올린 것.
//  위: 말소되지 않은 사항(열람본 마지막 쪽 '주요 등기사항 요약') + 말소기준권리·인수 위험 표시
//  아래(펼치기): 갑구·을구 전체 기록(말소된 것은 줄 그음), 원문 글자
import { useEffect, useState } from 'react';
import { getRegistry } from '../lib/store.js';
import { Card, Badge } from './ui.jsx';

const won = (n) => (n ? `${Math.round(n / 1e4).toLocaleString('ko-KR')}만원` : '');

export default function RegistryCard({ item }) {
  const [docs, setDocs] = useState(null);
  const [open, setOpen] = useState({});
  useEffect(() => { getRegistry(item.id).then(setDocs).catch(() => setDocs([])); }, [item.id]);

  const head = (
    <span className="text-xs text-ink/50">
      관리자 전용 · 마이옥션 열람본{item.registryViewedAt ? ` · 열람 ${item.registryViewedAt}` : ''}
    </span>
  );
  if (docs === null) return <Card title="등기부(열람본)" right={head}><div className="text-sm text-ink/50">불러오는 중…</div></Card>;
  if (!docs.length) {
    return (
      <Card title="등기부(열람본)" right={head}>
        <div className="text-sm text-ink/60">
          {item.registryMissAt
            ? `마이옥션에서 열람본을 찾지 못함(${({ notFound: '사건 없음', court: '법원 불일치', noRegistry: '열람본 없음', caseNo: '사건번호 형식' })[item.registryMissReason] || item.registryMissReason || ''}) — 7일 뒤 다시 확인합니다.`
            : '아직 받지 않았습니다. 미니PC 등기부 수집기가 입찰일 가까운 물건부터 차례로 받습니다.'}
        </div>
      </Card>
    );
  }

  const f = item.registryFlags || {};
  return (
    <Card title="등기부(열람본)" right={head}>
      <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
        {f.baseRight && <Badge tone="muted">말소기준 후보: {f.baseRight.purpose} {f.baseRight.date}</Badge>}
        {f.senior?.length > 0 && <Badge tone="hard" className="whitespace-normal">기준보다 앞선 권리 {f.senior.map((x) => `${x.purpose}(${x.date})`).join(', ')} — 인수 여부 확인</Badge>}
        {f.injunction > 0 && <Badge tone="hard">가처분 {f.injunction}</Badge>}
        {f.provisionalReg > 0 && <Badge tone="wait">가등기 {f.provisionalReg}</Badge>}
        {f.trust && <Badge tone="wait">신탁</Badge>}
        {f.lease > 0 && <Badge tone="wait">전세권·임차권 {f.lease}</Badge>}
        {f.superficies > 0 && <Badge tone="wait">지상권 {f.superficies}</Badge>}
        {f.attachment > 0 && <Badge tone="muted">가압류 {f.attachment}</Badge>}
        {f.seizure > 0 && <Badge tone="muted">압류 {f.seizure}</Badge>}
        {f.mortgageMax > 0 && <Badge tone="muted">근저당 채권최고액 합 {won(f.mortgageMax)}</Badge>}
        {f.shareOwners && <Badge tone="wait">공유(지분) {f.owners}명</Badge>}
      </div>
      <div className="space-y-4">
        {docs.sort((a, b) => String(a.kind).localeCompare(String(b.kind))).map((d) => (
          <div key={d.id} className="rounded-lg border border-line p-3">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 text-sm">
              <b>{d.kind}</b>
              <span className="text-ink/60">{d.address}</span>
              <span className="text-xs text-ink/40">고유번호 {d.uniqueNo} · 열람 {d.viewedAt || '?'}</span>
            </div>
            {d.summary ? (
              <>
                {d.summary.owners?.length > 0 && (
                  <div className="mb-2 text-sm"><span className="text-ink/50">소유:</span> {d.summary.owners.map((o) => `${o.name}${o.share ? ` ${o.share}` : ''}`).join(' · ')}</div>
                )}
                <Live title="갑구(소유권 외, 말소 안 된 것)" list={d.summary.gap} />
                <Live title="을구(말소 안 된 것)" list={d.summary.eul} />
              </>
            ) : <div className="text-xs text-ink/50">요약 쪽이 없는 열람본 — 아래 전체 기록에서 말소 표시로 확인하세요.</div>}
            <button className="mt-2 text-xs text-brand underline" onClick={() => setOpen({ ...open, [d.id]: !open[d.id] })}>{open[d.id] ? '전체 기록 접기' : '갑구·을구 전체 기록 보기'}</button>
            {open[d.id] && (
              <div className="mt-2 space-y-3">
                <All title="갑구(소유권)" list={d.sections?.gap} />
                <All title="을구(소유권 외)" list={d.sections?.eul} />
                <details className="text-xs"><summary className="cursor-pointer text-ink/50">원문 글자</summary><pre className="mt-1 max-h-96 overflow-auto whitespace-pre-wrap rounded bg-ink/5 p-2">{d.text}</pre></details>
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function Live({ title, list }) {
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold text-ink/60">{title}</div>
      {!list?.length ? <div className="text-xs text-ink/40">기록 없음</div> : (
        <table className="mt-1 w-full text-xs">
          <tbody>
            {list.map((x, i) => (
              <tr key={i} className="border-t border-line align-top">
                <td className="w-10 py-1 text-ink/50">{x.rank}</td>
                <td className="py-1 font-medium">{x.purpose}</td>
                <td className="w-24 py-1 text-ink/60">{x.date}</td>
                <td className="py-1">{x.main}</td>
                <td className="py-1 text-ink/60">{x.owner}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function All({ title, list }) {
  return (
    <div>
      <div className="text-xs font-semibold text-ink/60">{title}</div>
      {!list?.length ? <div className="text-xs text-ink/40">기록 없음</div> : (
        <table className="mt-1 w-full text-xs">
          <tbody>
            {list.map((x, i) => (
              <tr key={i} className={`border-t border-line align-top ${x.canceled || x.cancelEntry ? 'text-ink/40 line-through' : ''}`}>
                <td className="w-10 py-1">{x.rank}</td>
                <td className="py-1 font-medium">{x.purpose}</td>
                <td className="w-24 py-1">{x.date}{x.receiptNo ? <div className="text-ink/40">제{x.receiptNo}호</div> : null}</td>
                <td className="py-1">{x.cause}</td>
                <td className="whitespace-pre-line py-1">{x.holder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
