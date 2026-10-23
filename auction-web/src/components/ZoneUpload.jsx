import { useEffect, useState } from 'react';
import { saveZones, getZones } from '../lib/store.js';
import { parseZones, kindOfFile } from '../lib/redevZones.js';
import { SIDO } from '../data/defaults.js';
import { Card, Field, Badge } from './ui.jsx';

const LABEL = { name: '구역명', sgg: '시군구', location: '위치', type: '유형', stage: '단계', designated: '구역지정', committee: '추진위', union: '조합설립', implementation: '사업시행', management: '관리처분', construction: '착공', completion: '준공', transfer: '이전고시', area: '면적', households: '세대수' };

function thisQuarter() { const d = new Date(); return `${d.getFullYear()}년 ${Math.floor(d.getMonth() / 3) + 1}분기`; }

export default function ZoneUpload() {
  const [sido, setSido] = useState('인천광역시');
  const [quarter, setQuarter] = useState(thisQuarter());
  const [saved, setSaved] = useState({});
  const [preview, setPreview] = useState(null);
  const [msg, setMsg] = useState('');

  const loadSaved = () => Promise.all(SIDO.map(async (s) => [s, await getZones(s)])).then((p) => setSaved(Object.fromEntries(p)));
  useEffect(() => { loadSaved(); }, []);

  const onFile = async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setMsg('읽는 중…'); setPreview(null);
    try {
      const XLSX = await import('xlsx');
      const zones = []; const parts = []; let header = null;
      for (const file of files) {
        const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
        // 시트가 여러 개면(총괄표·세부내역 등) 구역이 가장 많이 읽히는 시트를 고른다
        let best = null;
        for (const name of wb.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
          const r = parseZones(rows, { sido, quarter, kind: kindOfFile(file.name) });
          if (!best || r.zones.length > best.zones.length) best = { ...r, sheet: name };
        }
        zones.push(...best.zones);
        parts.push({ file: file.name, sheet: best.sheet, count: best.zones.length, error: best.zones.length ? null : best.error });
        if (!header && best.zones.length) header = best.header;
      }
      setPreview({ zones, parts, header: header || { map: {}, index: -1 }, fileName: files.map((f) => f.name).join(', ') });
      setMsg(zones.length ? '' : '구역을 읽지 못했습니다.');
    } catch (err) { setMsg(`읽기 실패: ${err.message}`); }
    e.target.value = '';
  };

  const save = async () => {
    await saveZones(sido, { zones: preview.zones, quarter, fileName: preview.fileName });
    setMsg(`${sido} ${preview.zones.length}개 구역 저장했습니다.`); setPreview(null); loadSaved();
  };

  const stageCount = (zones) => { const c = {}; zones.forEach((z) => { c[z.stage || '단계 미상'] = (c[z.stage || '단계 미상'] || 0) + 1; }); return c; };

  return (
    <Card title="정비사업 현황 엑셀 올리기 (참고 자료 — 판정 기준은 위 정비구역 목록)">
      <p className="mb-3 text-xs text-ink/60">서울·경기는 분기 엑셀을 올려 주세요(경기는 정비사업·재정비촉진 두 파일을 한 번에). 인천은 추정분담금 정보시스템 자료실에서 매달 자동으로 받아옵니다. 엑셀을 올리면, 물건과 같은 동의 구역을 찾아 단계(조합설립·사업시행·관리처분)를 붙입니다. 새 분기 파일을 올리면 그 시도 자료가 통째로 바뀝니다.</p>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        {SIDO.map((s) => <Badge key={s} tone={saved[s]?.zones?.length ? 'brand' : 'muted'}>{s}: {saved[s]?.zones?.length ? `${saved[s].zones.length}개 · ${saved[s].quarter || ''}` : '없음'}</Badge>)}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label="시도"><select className="input" value={sido} onChange={(e) => setSido(e.target.value)}>{SIDO.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="기준 분기"><input className="input" value={quarter} onChange={(e) => setQuarter(e.target.value)} /></Field>
        <Field label="엑셀 파일 (여러 개 한 번에 선택 가능)"><input className="input py-1.5" type="file" multiple accept=".xlsx,.xls,.csv" onChange={onFile} /></Field>
      </div>
      {msg && <p className="mt-2 text-sm text-wait">{msg}</p>}
      {preview && preview.zones.length > 0 && (
        <div className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-2 text-sm"><b>{preview.zones.length}개 구역</b> 읽음</div>
          <ul className="mb-2 text-xs text-ink/70">{preview.parts.map((p) => <li key={p.file}>• {p.file} → 시트 「{p.sheet}」 {p.count}개{p.error ? ` (${p.error})` : ''}</li>)}</ul>
          <div className="mb-2 flex flex-wrap gap-1 text-xs">
            <span className="text-ink/60">찾은 열:</span>
            {Object.keys(preview.header.map).map((k) => <Badge key={k} tone="brand">{LABEL[k] || k}</Badge>)}
          </div>
          <div className="mb-2 flex flex-wrap gap-1 text-xs">{Object.entries(stageCount(preview.zones)).map(([k, v]) => <Badge key={k}>{k} {v}</Badge>)}</div>
          <div className="max-h-56 overflow-auto text-xs">
            <table className="w-full">
              <thead className="text-left text-ink/50"><tr><th>구역</th><th>위치(동)</th><th>단계</th><th>최근 날짜</th></tr></thead>
              <tbody>{preview.zones.slice(0, 30).map((z, i) => <tr key={i} className="border-t border-line/50"><td>{z.name}</td><td>{z.location} {z.emd ? `(${z.emd})` : ''}</td><td>{z.stage || '—'}</td><td>{Object.values(z.dates).sort().pop() || '—'}</td></tr>)}</tbody>
            </table>
          </div>
          <div className="mt-3 flex gap-2"><button className="btn-primary" onClick={save}>{sido}로 저장</button><button className="btn-ghost" onClick={() => setPreview(null)}>취소</button></div>
          <p className="mt-2 text-xs text-ink/50">열이 잘못 잡혔으면 저장하지 말고 파일을 보내 주세요. 그 시도 양식에 맞춰 고치겠습니다.</p>
        </div>
      )}
    </Card>
  );
}
