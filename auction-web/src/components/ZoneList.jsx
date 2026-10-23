// 관리자: 정비구역 목록(redevZones) — 서울·인천·경기 정비사업 추진현황 페이지·공보를 보고 사람이 확인한 구역.
// 물건 연결의 기준이다(브이월드 토지이용계획은 지정고시 후 구역 확인용 보조). 초기 입력은 매각 중 물건이 걸린 지역부터.
import { useEffect, useState } from 'react';
import { listRedevZones, saveRedevZone, deleteRedevZone, listAlerts, resolveAlert, callFn } from '../lib/store.js';
import { REDEV_STAGES, ZONE_TYPES, needsRecheck, RECHECK_DAYS, itemLot } from '../lib/zoneMatch.js';
import { SIDO } from '../data/defaults.js';
import { Card, Field, Badge } from './ui.jsx';

const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const EMPTY = {
  name: '', sido: '인천광역시', sgg: '', type: '재개발', stage: '후보지·사전검토',
  rightsDate: { announced: false, date: '', basis: '지정고시일' },
  permitZone: { yes: false, from: '', to: '' }, actRestriction: { yes: false },
  boundary: { lots: '', polygon: null }, sourceUrls: [], confirmedAt: today(), memo: '',
};

// '126.70,37.46' 줄 목록 또는 JSON [[경도,위도],…] → 다각형
function parsePolygon(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  try { const j = JSON.parse(t); if (Array.isArray(j) && j.length >= 3) return j.map(([x, y]) => [Number(x), Number(y)]); } catch { /* 줄 형식 */ }
  const pts = t.split(/\n/).map((l) => l.split(/[,\s]+/).map(Number)).filter((p) => p.length >= 2 && p.every(Number.isFinite));
  return pts.length >= 3 ? pts.map(([x, y]) => [x, y]) : null;
}

export default function ZoneList() {
  const [zones, setZones] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [edit, setEdit] = useState(null);
  const [polyText, setPolyText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const load = () => { listRedevZones().then(setZones).catch((e) => setMsg(e.message)); listAlerts().then(setAlerts).catch(() => setAlerts([])); };
  useEffect(load, []);

  const open = (z) => { setEdit({ ...EMPTY, ...z, rightsDate: { ...EMPTY.rightsDate, ...(z.rightsDate || {}) }, permitZone: { ...EMPTY.permitZone, ...(z.permitZone || {}) }, actRestriction: { ...EMPTY.actRestriction, ...(z.actRestriction || {}) }, boundary: { ...EMPTY.boundary, ...(z.boundary || {}) } }); setPolyText(z.boundary?.polygon ? JSON.stringify(z.boundary.polygon) : ''); };
  const set = (patch) => setEdit({ ...edit, ...patch });
  const save = async () => {
    if (!edit.name || !edit.sido || !edit.sgg) { setMsg('구역명·시도·시군구는 꼭 넣어 주세요.'); return; }
    if (!edit.sourceUrls?.length) { setMsg('근거 URL(추진현황 페이지·공보)을 하나 이상 넣어 주세요.'); return; }
    const polygon = parsePolygon(polyText);
    if (polyText.trim() && !polygon) { setMsg('경계 다각형 형식이 맞지 않습니다(줄마다 "경도,위도" 3점 이상).'); return; }
    if (edit.rightsDate.announced && !edit.rightsDate.date) { setMsg('권리산정기준일을 고시했다면 날짜를 넣어 주세요.'); return; }
    await saveRedevZone({ ...edit, boundary: { lots: edit.boundary.lots || '', polygon } });
    setMsg(`저장했습니다: ${edit.name} — '물건 다시 연결'을 누르면 바로 반영됩니다(아니면 새벽 수집 때).`); setEdit(null); load();
  };
  const remove = async (z) => { if (!window.confirm(`${z.name}을(를) 목록에서 지울까요? (해제된 구역이면 지우지 말고 단계를 '해제'로)`)) return; await deleteRedevZone(z.id); load(); };
  const rematch = async () => { setBusy(true); setMsg(''); try { const r = await callFn('zoneMatchNow', {}); setMsg(`다시 연결: 구역 ${r.zones ?? '—'}개 · 물건 ${r.listings ?? '—'}건 → 목록 구역 ${r.listed ?? 0} · 목록 미등록 ${r.unlisted ?? 0} · 아님 ${r.none ?? 0} · 확인 전 ${r.unchecked ?? 0} (바뀜 ${r.changed ?? 0})`); } catch (e) { setMsg(e.message); } setBusy(false); load(); };
  const fromAlert = (a) => {
    const lot = itemLot({ title: a.title, pnu: a.pnu });
    open({ ...EMPTY, name: a.vworld?.[0] || '', sido: a.sido || EMPTY.sido, sgg: a.sgg || '', stage: '지정고시', boundary: { lots: lot ? `${lot.dong} ${lot.mountain ? '산' : ''}${lot.bon}${lot.bu ? `-${lot.bu}` : ''}` : '', polygon: null }, memo: `브이월드 토지이용계획: ${(a.vworld || []).join(', ')} (물건 ${a.listingId})` });
  };

  const unlisted = alerts.filter((a) => a.type === 'zoneUnlisted');
  const calc = alerts.filter((a) => a.type === 'calcAnomaly');
  const shown = (zones || []).filter((z) => !q || `${z.name} ${z.sido} ${z.sgg}`.includes(q)).sort((a, b) => `${a.sido}${a.sgg}${a.name}`.localeCompare(`${b.sido}${b.sgg}${b.name}`));
  const stale = (zones || []).filter((z) => needsRecheck(z)).length;

  return (
    <>
      <Card title={`정비구역 목록 (${zones?.length ?? '…'}곳${stale ? ` · 재확인 필요 ${stale}` : ''})`} right={<span className="flex gap-2"><button className="btn-ghost" disabled={busy} onClick={rematch}>{busy ? '연결 중…' : '물건 다시 연결'}</button><button className="btn-primary" onClick={() => open(EMPTY)}>+ 구역 등록</button></span>}>
        <p className="mb-2 text-xs text-ink/60">단계 판단의 기준입니다. 서울·인천·경기 <b>정비사업 추진현황 페이지·시도 공보</b>를 보고 확인한 값만 넣으세요(다른 경매 사이트 자료 금지). 브이월드 토지이용계획은 지정고시 뒤 구역 확인용 보조이며, <b>지정 전 구역(후보지·입안제안 등)은 여기 목록으로만 잡힙니다</b>. 한 번에 많이 넣지 말고 현재 매각 중 물건이 걸린 지역부터 넣으세요. 확인일이 {RECHECK_DAYS}일 지나면 '재확인 필요'.</p>
        {msg && <p className="mb-2 text-sm text-brand">{msg}</p>}
        <input className="input mb-2" placeholder="구역명·시군구 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {zones && !zones.length && <p className="text-sm text-ink/50">아직 등록한 구역이 없습니다. 아래 '목록 미등록 구역' 알림부터 등록하세요.</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-ink/50"><tr><th>구역</th><th>유형</th><th>단계</th><th>권리산정기준일</th><th>토허·행위제한</th><th>경계</th><th>확인일</th><th /></tr></thead>
            <tbody>
              {shown.map((z) => (
                <tr key={z.id} className="border-t border-line/50 align-top">
                  <td><b>{z.name}</b><div className="text-ink/50">{z.sido} {z.sgg}</div></td>
                  <td>{z.type}</td>
                  <td>{z.stage === '해제' ? <Badge>해제</Badge> : z.stage}</td>
                  <td>{z.rightsDate?.announced ? `${z.rightsDate.date} (${z.rightsDate.basis || '—'})` : '미고시'}</td>
                  <td>{z.permitZone?.yes ? `토허 ${z.permitZone.from || ''}~${z.permitZone.to || ''}` : '—'}{z.actRestriction?.yes ? ' · 행위제한' : ''}</td>
                  <td>{z.boundary?.polygon ? '다각형' : ''}{z.boundary?.lots ? `${z.boundary?.polygon ? ' + ' : ''}지번 ${String(z.boundary.lots).split(/[\n,]+/).filter((x) => x.trim()).length}` : z.boundary?.polygon ? '' : <span className="text-hard">없음</span>}</td>
                  <td>{z.confirmedAt || '—'}{needsRecheck(z) && <div><Badge tone="wait">재확인 필요</Badge></div>}</td>
                  <td className="whitespace-nowrap"><button className="text-brand underline" onClick={() => open(z)}>수정</button> <button className="text-hard underline" onClick={() => remove(z)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {edit && (
          <div className="mt-4 rounded-lg border border-brand/30 p-3">
            <div className="mb-2 font-bold">{edit.id ? `수정: ${edit.name}` : '새 구역'}</div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Field label="구역명"><input className="input" value={edit.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="시도"><select className="input" value={edit.sido} onChange={(e) => set({ sido: e.target.value })}>{SIDO.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="시군구"><input className="input" value={edit.sgg} placeholder="부평구 / 용인시 처인구" onChange={(e) => set({ sgg: e.target.value })} /></Field>
              <Field label="사업유형"><select className="input" value={edit.type} onChange={(e) => set({ type: e.target.value })}>{ZONE_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
              <Field label="단계"><select className="input" value={edit.stage} onChange={(e) => set({ stage: e.target.value })}>{REDEV_STAGES.map((x) => <option key={x.key}>{x.key}</option>)}</select></Field>
              <Field label="권리산정기준일 고시" hint="지정고시일 또는 시·도 공보에 따로 고시한 날">
                <label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={edit.rightsDate.announced} onChange={(e) => set({ rightsDate: { ...edit.rightsDate, announced: e.target.checked } })} /> 고시됨</label>
              </Field>
              <Field label="기준일"><input className="input" type="date" disabled={!edit.rightsDate.announced} value={edit.rightsDate.date || ''} onChange={(e) => set({ rightsDate: { ...edit.rightsDate, date: e.target.value } })} /></Field>
              <Field label="기준일 근거"><select className="input" disabled={!edit.rightsDate.announced} value={edit.rightsDate.basis} onChange={(e) => set({ rightsDate: { ...edit.rightsDate, basis: e.target.value } })}><option>지정고시일</option><option>시·도 공보 고시</option></select></Field>
              <Field label="토지거래허가구역"><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={edit.permitZone.yes} onChange={(e) => set({ permitZone: { ...edit.permitZone, yes: e.target.checked } })} /> 지정</label></Field>
              <Field label="허가 기간 시작"><input className="input" type="date" disabled={!edit.permitZone.yes} value={edit.permitZone.from || ''} onChange={(e) => set({ permitZone: { ...edit.permitZone, from: e.target.value } })} /></Field>
              <Field label="허가 기간 끝"><input className="input" type="date" disabled={!edit.permitZone.yes} value={edit.permitZone.to || ''} onChange={(e) => set({ permitZone: { ...edit.permitZone, to: e.target.value } })} /></Field>
              <Field label="행위제한 고시"><label className="flex items-center gap-2 pt-2 text-sm"><input type="checkbox" checked={edit.actRestriction.yes} onChange={(e) => set({ actRestriction: { ...edit.actRestriction, yes: e.target.checked } })} /> 고시됨</label></Field>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <Field label="경계 — 포함 지번 목록" hint="줄·쉼표로 구분. '십정동 123-4, 125' 처럼 동을 이어 쓰거나 19자리 PNU">
                <textarea className="input h-28 font-mono text-xs" value={edit.boundary.lots || ''} onChange={(e) => set({ boundary: { ...edit.boundary, lots: e.target.value } })} />
              </Field>
              <Field label="경계 — 대략 다각형(선택)" hint="줄마다 '경도,위도' 3점 이상 또는 JSON [[경도,위도],…]">
                <textarea className="input h-28 font-mono text-xs" value={polyText} onChange={(e) => setPolyText(e.target.value)} />
              </Field>
              <Field label="근거 URL(줄마다 하나)" hint="추진현황 페이지·시도 공보 원문">
                <textarea className="input h-20 text-xs" value={(edit.sourceUrls || []).join('\n')} onChange={(e) => set({ sourceUrls: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
              </Field>
              <div className="grid gap-2">
                <Field label="확인일"><input className="input" type="date" value={edit.confirmedAt || ''} onChange={(e) => set({ confirmedAt: e.target.value })} /></Field>
                <Field label="메모(관리자만)"><input className="input" value={edit.memo || ''} onChange={(e) => set({ memo: e.target.value })} /></Field>
              </div>
            </div>
            <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={save}>저장</button><button className="btn-ghost" onClick={() => setEdit(null)}>취소</button></div>
          </div>
        )}
      </Card>

      <Card title={`목록 미등록 정비구역 알림 (${unlisted.length})`}>
        <p className="mb-2 text-xs text-ink/60">브이월드 토지이용계획에는 정비구역이 찍히는데 위 목록에 없는 진행 물건입니다. 추진현황 페이지에서 확인한 뒤 등록하세요.</p>
        {!unlisted.length ? <p className="text-sm text-ink/50">없음</p> : (
          <ul className="space-y-1 text-sm">
            {unlisted.sort((a, b) => String(a.sgg).localeCompare(String(b.sgg))).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 border-b border-line/50 py-1">
                <a className="text-brand underline" href={`#/item/${encodeURIComponent(a.listingId)}`}>{a.title}</a>
                <span className="text-xs text-ink/60">{a.sgg} · {(a.vworld || []).join(', ')}</span>
                <span className="ml-auto flex gap-2 text-xs"><button className="text-brand underline" onClick={() => fromAlert(a)}>이 구역 등록</button><button className="text-ink/50 underline" onClick={() => resolveAlert(a.id).then(load)}>닫기</button></span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`계산 이상 물건 (${calc.length})`}>
        <p className="mb-2 text-xs text-ink/60">수익률 1,000% 초과 또는 가치가 최저가의 100배 초과 — '지금 매력'·A등급에서 뺐습니다. 매일 밤 예측 기록 때 갱신됩니다. 지분비율·면적·단가를 원문과 대조하세요.</p>
        {!calc.length ? <p className="text-sm text-ink/50">없음</p> : (
          <ul className="space-y-1 text-sm">
            {calc.map((a) => (
              <li key={a.id} className="border-b border-line/50 py-1">
                <a className="text-brand underline" href={`#/item/${encodeURIComponent(a.listingId)}`}>{a.title}</a>
                <div className="text-xs text-hard">{(a.reasons || []).join(' · ')}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
