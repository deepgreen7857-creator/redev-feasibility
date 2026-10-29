// 원본 하드 → jbslab.co.kr/data(관리자 전용) 올리기 — 미니PC 전용
//  · 원본폴더\<법원>\<연도>\<사건번호>\ 아래 PDF·사진·글자(txt) 중 새로 생기거나 바뀐 것만 올린다(state/datasync.json 에 기억)
//  · 올린 곳: Firebase 저장소 data/… , 열기 주소는 관리자만 읽는 dataCases 에만(일반 회원·검색엔진에는 안 보임)
//  · 21MB 넘는 파일은 올리지 않고 '하드에만 있음'으로 표시
//  실행: node src/datasync.js            (start-jauction.cmd 가 제이옥션 수집 뒤에 부름)
//        node src/datasync.js --dry      (올릴 목록만 보기)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findArchive } from './archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const ARCHIVE = findArchive(env);
const STATE = path.join(ROOT, 'state'); const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(STATE, { recursive: true }); fs.mkdirSync(LOGS, { recursive: true });
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const logFile = path.join(LOGS, `datasync-${kstDay()}.log`);
const log = (m) => { const line = `[${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}] ${m}`; console.log(line); fs.appendFileSync(logFile, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const doneFile = path.join(STATE, 'datasync.json');
const done = fs.existsSync(doneFile) ? JSON.parse(fs.readFileSync(doneFile, 'utf8')) : {}; // 상대경로 → "크기:수정시각"
const saveDone = () => fs.writeFileSync(doneFile, JSON.stringify(done));
const lockFile = path.join(STATE, 'datasync.lock');
const MAX = 21 * 1024 * 1024;
const OK_EXT = /\.(pdf|jpe?g|png|txt)$/i;
const CASE_RE = /^\d{4}타경\d+$/;
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

async function api(body) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(env.INGEST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INGEST_TOKEN}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(180e3) });
      const t = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${t.slice(0, 120)}`);
      return JSON.parse(t);
    } catch (e) {
      if (i >= 2) throw e;
      await sleep(5000 * (i + 1));
    }
  }
}

function walk(dir, base, depth = 0) {
  const out = [];
  for (const e of ls(dir)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 2) out.push(...walk(full, base, depth + 1)); continue; }
    if (!OK_EXT.test(e.name)) continue;
    out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

async function main() {
  if (!ARCHIVE) return log('원본 폴더(경매원본표식.txt 있는 외장하드)를 못 찾음 — 쉼');
  if (!env.INGEST_URL || !env.INGEST_TOKEN) return log('.env 에 INGEST_URL, INGEST_TOKEN 이 없음');
  if (fs.existsSync(lockFile)) { const pid = Number(fs.readFileSync(lockFile, 'utf8')); try { process.kill(pid, 0); return log('이미 올리는 중'); } catch { /* 죽은 잠금 */ } }
  fs.writeFileSync(lockFile, String(process.pid));
  const meta = {};
  try { for (const r of Object.values(JSON.parse(fs.readFileSync(path.join(ARCHIVE, '_제이옥션_목록.json'), 'utf8')))) meta[`${r.법원}_${r.사건번호}`] = r; } catch { /* 없음 */ }
  let files = 0; let bytes = 0; let cases = 0; let fail = 0;
  try {
    log(`시작 — ${ARCHIVE}${DRY ? ' (보기만)' : ''}`);
    for (const c of ls(ARCHIVE)) {
      if (!c.isDirectory() || /^[_.]/.test(c.name)) continue;
      for (const y of ls(path.join(ARCHIVE, c.name))) {
        if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
        for (const k of ls(path.join(ARCHIVE, c.name, y.name))) {
          if (!k.isDirectory() || !CASE_RE.test(k.name)) continue;
          const dir = path.join(ARCHIVE, c.name, y.name, k.name);
          const base = { court: c.name, year: y.name, caseNo: k.name };
          const m = meta[`${c.name}_${k.name}`] || {};
          const caseSig = `${m.용도 || ''}|${m.주소 || ''}|${m.다음매각기일 || ''}|${m.물건번호 || ''}`;
          const todo = [];
          for (const rel of walk(dir, dir)) {
            let st; try { st = fs.statSync(path.join(dir, rel)); } catch { continue; }
            const key = `${c.name}/${y.name}/${k.name}/${rel}`; const sig = `${st.size}:${Math.round(st.mtimeMs)}`;
            if (done[key] !== sig) todo.push({ rel, key, sig, size: st.size });
          }
          const caseKey = `${c.name}/${y.name}/${k.name}`;
          if (!todo.length && done[caseKey] === caseSig) continue;
          if (DRY) { log(`${k.name}: 올릴 파일 ${todo.length}개`); files += todo.length; continue; }
          try {
            const rc = await api({ action: 'dataCase', ...base, meta: { use: m.용도, address: m.주소, sale: m.다음매각기일, itemNo: m.물건번호 } });
            // 서버에 자료 보기 기능이 아직 반영 안 됐으면(모르는 동작) 헛걸음하지 말고 바로 멈춤
            if (!rc.ok) { if (/모르는 동작/.test(rc.error || '')) { log('서버에 자료 올리기 기능이 아직 반영되지 않음(firebase deploy 필요) — 멈춤'); return; } log(`${k.name}: 사건 정보 거절 ${rc.error}`); fail++; continue; }
            done[caseKey] = caseSig; cases++;
            for (const f of todo) {
              try {
                if (f.size > MAX) { await api({ action: 'dataLocal', ...base, path: f.rel, size: f.size }); }
                else {
                  const r = await api({ action: 'dataFile', ...base, path: f.rel, data: fs.readFileSync(path.join(dir, f.rel)).toString('base64') });
                  if (!r.ok) { log(`${k.name} ${f.rel}: 거절 ${r.error}`); fail++; continue; }
                  bytes += f.size;
                }
                done[f.key] = f.sig; files++;
                if (files % 20 === 0) saveDone();
              } catch (e) { log(`${k.name} ${f.rel}: 실패 ${e.message}`); fail++; }
            }
            saveDone();
          } catch (e) { log(`${k.name}: 실패 ${e.message}`); fail++; }
        }
      }
    }
  } finally {
    saveDone();
    try { fs.unlinkSync(lockFile); } catch { /* */ }
    log(`끝 — 사건 ${cases}건, 파일 ${files}개(${(bytes / 1048576).toFixed(1)}MB) 올림${fail ? `, 실패 ${fail}` : ''}`);
  }
}
await main();
