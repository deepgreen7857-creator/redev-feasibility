// 경매 자료 보기 — 원본 보관 하드(D:\법원경매원본 등)를 읽기만 하는 내 PC 전용 화면
//  · 사건번호별 폴더(법원\연도\사건번호\)의 감정평가서·매각물건명세서·현황조사서 PDF, 사진, 글자 문서를 한 화면에서 본다
//  · 대법원 원본(…_날짜.pdf)과 제이옥션 자료(…_제이옥션.*)를 같이 보여 줌. 파일은 고치거나 지우지 않는다(읽기 전용)
//  · 기본은 이 PC에서만 열림(127.0.0.1). --lan 을 붙이면 집 안 네트워크(사설 IP)에서만 노트북으로도 열 수 있음
//
//  실행:  npm run viewer            → 브라우저에서 http://localhost:8787
//         npm run viewer-lan        → 같은 공유기에 붙은 노트북에서 http://<미니PC IP>:8787
//         node src/viewer.js --dir E:\법원경매원본_백업   (다른 폴더 보기)
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { findArchive } from './archive.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const LAN = args.includes('--lan');
const PORT = Number(arg('--port')) || 8787;
const env = Object.fromEntries((fs.existsSync(path.join(ROOT, '.env')) ? fs.readFileSync(path.join(ROOT, '.env'), 'utf8') : '')
  .split(/\r?\n/).filter((l) => l.includes('=') && !l.trim().startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));
const ARCHIVE = path.resolve(arg('--dir') || findArchive(env) || path.join(ROOT, 'state', 'originals'));

const TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.html': 'text/plain; charset=utf-8' };
const CASE_RE = /^\d{4}타경\d+$/;

// 사설망 주소만 허용(--lan 일 때). 바깥 인터넷에서 들어오는 건 막는다
const privateIp = (ip) => /^(::1|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|fe80:)/i.test(String(ip || ''));

// 보관 폴더 안쪽인지 확인(../ 로 밖을 못 보게)
function inside(rel) {
  const full = path.resolve(ARCHIVE, rel);
  const r = path.relative(ARCHIVE, full);
  if (r.startsWith('..') || path.isAbsolute(r)) return null;
  return full;
}
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };

// 제이옥션 목록(주소·용도·매각기일) — 사건 목록에 붙여 보여 줌
function loadMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(ARCHIVE, '_제이옥션_목록.json'), 'utf8')); } catch { return {}; }
}

/** 사건 폴더 모으기: <법원>\<연도>\<사건번호> */
function listCases() {
  const meta = loadMeta();
  const byKey = {};
  for (const r of Object.values(meta)) byKey[`${r.법원}_${r.사건번호}`] = r;
  const out = [];
  for (const c of ls(ARCHIVE)) {
    if (!c.isDirectory() || c.name.startsWith('_') || c.name.startsWith('.')) continue;
    for (const y of ls(path.join(ARCHIVE, c.name))) {
      if (!y.isDirectory() || !/^\d{4}$/.test(y.name)) continue;
      for (const k of ls(path.join(ARCHIVE, c.name, y.name))) {
        if (!k.isDirectory() || !CASE_RE.test(k.name)) continue;
        const dir = path.join(ARCHIVE, c.name, y.name, k.name);
        const files = walk(dir, dir);
        const m = byKey[`${c.name}_${k.name}`] || {};
        let mtime = 0; for (const f of files) mtime = Math.max(mtime, f.mtime);
        out.push({
          court: c.name, year: y.name, caseNo: k.name, rel: path.relative(ARCHIVE, dir).split(path.sep).join('/'),
          use: m.용도 || '', address: m.주소 || '', sale: m.다음매각기일 || '', itemNo: m.물건번호 || '',
          pdf: files.filter((f) => f.kind === 'pdf').length, img: files.filter((f) => f.kind === 'img').length, txt: files.filter((f) => f.kind === 'txt').length,
          hasAppraisal: files.some((f) => /감정평가서/.test(f.name)), hasSpec: files.some((f) => /매각물건명세서/.test(f.name)), hasStatus: files.some((f) => /현황조사서/.test(f.name)),
          updated: mtime,
        });
      }
    }
  }
  return out;
}

/** 사건 폴더 안 파일(하위 폴더 포함, 2단계까지) */
function walk(base, dir, depth = 0) {
  const out = [];
  for (const e of ls(dir)) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (depth < 2) out.push(...walk(base, full, depth + 1)); continue; }
    const ext = path.extname(e.name).toLowerCase();
    const kind = ext === '.pdf' ? 'pdf' : ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? 'img' : ext === '.txt' ? 'txt' : 'other';
    let st; try { st = fs.statSync(full); } catch { continue; }
    out.push({ name: e.name, rel: path.relative(ARCHIVE, full).split(path.sep).join('/'), sub: path.relative(base, dir).split(path.sep).join('/'), kind, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (LAN ? !privateIp(req.socket.remoteAddress) : false) return send(res, 403, '집 안 네트워크에서만 열 수 있습니다.');
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '읽기 전용입니다.');
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/') return send(res, 200, PAGE, 'text/html; charset=utf-8');
    if (u.pathname === '/api/cases') return send(res, 200, JSON.stringify({ archive: ARCHIVE, cases: listCases() }), 'application/json; charset=utf-8');
    if (u.pathname === '/api/case') {
      const dir = inside(u.searchParams.get('rel') || '');
      if (!dir || !fs.existsSync(dir)) return send(res, 404, '사건 폴더가 없습니다.');
      let info = null;
      for (const f of walk(dir, dir)) if (/물건정보_제이옥션\.json$/.test(f.name) && !info) { try { const j = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f.rel), 'utf8')); delete j.화면글자; info = j; } catch { /* */ } }
      return send(res, 200, JSON.stringify({ files: walk(dir, dir), info }), 'application/json; charset=utf-8');
    }
    if (u.pathname.startsWith('/f/')) {
      const rel = decodeURIComponent(u.pathname.slice(3));
      const full = inside(rel);
      if (!full) return send(res, 403, '보관 폴더 밖은 볼 수 없습니다.');
      let st; try { st = fs.statSync(full); } catch { return send(res, 404, '파일이 없습니다.'); }
      if (!st.isFile()) return send(res, 404, '파일이 없습니다.');
      const type = TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
      const name = encodeURIComponent(path.basename(full));
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=600', 'Content-Disposition': `inline; filename*=UTF-8''${name}`, 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(full).pipe(res);
    }
    send(res, 404, '없는 주소입니다.');
  } catch (e) { send(res, 500, `오류: ${e.message}`); }
});

server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`경매 자료 보기 — 보관 폴더 ${ARCHIVE}`);
  console.log(`  이 PC:  http://localhost:${PORT}`);
  if (LAN) {
    const ips = Object.values(os.networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal && privateIp(n.address)).map((n) => n.address);
    for (const ip of ips) console.log(`  노트북: http://${ip}:${PORT}   (같은 공유기에 연결돼 있어야 함)`);
  }
  console.log('  끝내려면 이 창을 닫으세요.');
});

const PAGE = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>경매 자료 보기</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--ink:#1d2330;--sub:#6b7280;--line:#e3e6eb;--acc:#1f6f5c;--accbg:#e7f3ef;--warn:#b45309;--warnbg:#fdf2e3}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 "Malgun Gothic","Apple SD Gothic Neo",sans-serif;background:var(--bg);color:var(--ink)}
header{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--card);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
header h1{font-size:17px;margin:0;white-space:nowrap}header .path{color:var(--sub);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#q{flex:1;max-width:420px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;font:inherit}
.wrap{display:grid;grid-template-columns:380px 1fr;height:calc(100vh - 55px)}
#list{overflow:auto;border-right:1px solid var(--line);background:var(--card)}
.row{padding:10px 14px;border-bottom:1px solid var(--line);cursor:pointer}.row:hover{background:#fafbfc}.row.on{background:var(--accbg)}
.row b{font-size:15px}.row .addr{color:var(--sub);font-size:13px;margin:2px 0}.tags{display:flex;gap:4px;flex-wrap:wrap}
.tag{font-size:11px;padding:1px 6px;border-radius:10px;background:#eef0f3;color:#4b5563}.tag.ok{background:var(--accbg);color:var(--acc)}.tag.no{background:var(--warnbg);color:var(--warn)}
#main{overflow:auto;padding:16px 20px}
.empty{color:var(--sub);padding:40px;text-align:center}
h2{margin:0 0 4px;font-size:20px}.meta{color:var(--sub);font-size:13px;margin-bottom:14px}
.sec{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:14px}.sec h3{margin:0 0 10px;font-size:15px}
.docs{display:flex;gap:8px;flex-wrap:wrap}.doc{padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer;font:inherit;font-size:14px}
.doc.on{border-color:var(--acc);background:var(--accbg);color:var(--acc)}.doc small{color:var(--sub)}
#pdf{width:100%;height:78vh;border:1px solid var(--line);border-radius:8px;margin-top:10px;display:none;background:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.grid img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:6px;cursor:zoom-in;background:#eee}
pre{white-space:pre-wrap;word-break:break-all;font:13px/1.6 "Malgun Gothic",monospace;background:#fafbfc;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:420px;overflow:auto;margin:8px 0 0}
details{margin-bottom:6px}summary{cursor:pointer;font-size:14px}
#big{position:fixed;inset:0;background:rgba(0,0,0,.85);display:none;align-items:center;justify-content:center;z-index:10;cursor:zoom-out}#big img{max-width:95vw;max-height:92vh}
.count{color:var(--sub);font-size:12px;padding:8px 14px;border-bottom:1px solid var(--line)}
@media (max-width:800px){.wrap{grid-template-columns:1fr;height:auto}#list{max-height:40vh}}
</style></head><body>
<header><h1>경매 자료 보기</h1><input id="q" placeholder="사건번호·주소·법원으로 찾기 (예: 가좌동, 503672)"><span class="path" id="path"></span></header>
<div class="wrap"><div id="list"></div><div id="main"><div class="empty">왼쪽에서 사건을 고르세요.</div></div></div>
<div id="big" onclick="this.style.display='none'"><img id="bigimg" alt=""></div>
<script>
let cases=[];const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fu=rel=>'/f/'+rel.split('/').map(encodeURIComponent).join('/');
const kb=n=>n>1048576?(n/1048576).toFixed(1)+'MB':Math.max(1,Math.round(n/1024))+'KB';
async function load(){const r=await fetch('/api/cases');const j=await r.json();cases=j.cases;$('#path').textContent='보관 폴더: '+j.archive;
 cases.sort((a,b)=>(a.sale||'9999').localeCompare(b.sale||'9999')||b.updated-a.updated);draw();}
function draw(){const q=$('#q').value.trim().toLowerCase();const L=cases.filter(c=>!q||(c.caseNo+' '+c.court+' '+c.address+' '+c.use).toLowerCase().includes(q));
 const t=(ok,l)=>'<span class="tag '+(ok?'ok':'no')+'">'+l+'</span>';
 $('#list').innerHTML='<div class="count">'+L.length+'건 / 전체 '+cases.length+'건</div>'+L.map(c=>'<div class="row" data-rel="'+esc(c.rel)+'"><b>'+esc(c.caseNo)+'</b> <span class="tag">'+esc(c.court.replace('지방법원','지법'))+'</span>'+(c.use?' <span class="tag">'+esc(c.use)+'</span>':'')+
 '<div class="addr">'+esc(c.address||'주소 정보 없음')+(c.sale?' · 매각기일 '+esc(c.sale):'')+'</div><div class="tags">'+t(c.hasAppraisal,'감정평가서')+t(c.hasSpec,'명세서')+t(c.hasStatus,'현황조사서')+'<span class="tag">사진 '+c.img+'</span></div></div>').join('');
 document.querySelectorAll('.row').forEach(r=>r.onclick=()=>open(r.dataset.rel));}
async function open(rel){document.querySelectorAll('.row').forEach(r=>r.classList.toggle('on',r.dataset.rel===rel));history.replaceState(null,'','#'+encodeURIComponent(rel));
 const c=cases.find(x=>x.rel===rel)||{};const j=await (await fetch('/api/case?rel='+encodeURIComponent(rel))).json();
 const F=j.files;const pdf=F.filter(f=>f.kind==='pdf').sort((a,b)=>rank(a.name)-rank(b.name)||a.name.localeCompare(b.name));
 const img=F.filter(f=>f.kind==='img').sort((a,b)=>a.rel.localeCompare(b.rel));const txt=F.filter(f=>f.kind==='txt');
 const label=f=>esc(f.name.replace(/\\.pdf$/i,'').replace(/_/g,' '))+(f.sub&&/^\\d+$/.test(f.sub)?' (물건'+esc(f.sub)+')':'');
 const i=j.info||{};
 $('#main').innerHTML='<h2>'+esc(c.caseNo||rel)+'</h2><div class="meta">'+esc(c.court||'')+(c.use?' · '+esc(c.use):'')+(c.address?' · '+esc(c.address):'')+(c.sale?' · 다음 매각기일 '+esc(c.sale):'')+'<br>폴더: '+esc(rel)+'</div>'+
 '<div class="sec"><h3>문서 (PDF '+pdf.length+'개)</h3>'+(pdf.length?'<div class="docs">'+pdf.map(f=>'<button class="doc" data-rel="'+esc(f.rel)+'">'+label(f)+' <small>'+kb(f.size)+'</small></button>').join('')+'</div><iframe id="pdf" title="문서 보기"></iframe>':'<div class="meta">받은 PDF가 없습니다.</div>')+'</div>'+
 '<div class="sec"><h3>현장사진 ('+img.length+'장)</h3>'+(img.length?'<div class="grid">'+img.map(f=>'<img loading="lazy" src="'+fu(f.rel)+'" alt="'+esc(f.name)+'">').join('')+'</div>':'<div class="meta">받은 사진이 없습니다.</div>')+'</div>'+
 '<div class="sec"><h3>글자 문서 ('+txt.length+'개)</h3>'+(txt.length?txt.map(f=>'<details data-rel="'+esc(f.rel)+'"><summary>'+esc(f.name)+'</summary><pre>불러오는 중…</pre></details>').join(''):'<div class="meta">없음</div>')+'</div>';
 document.querySelectorAll('.doc').forEach(b=>b.onclick=()=>{document.querySelectorAll('.doc').forEach(x=>x.classList.toggle('on',x===b));const fr=$('#pdf');fr.style.display='block';fr.src=fu(b.dataset.rel);});
 const first=document.querySelector('.doc');if(first)first.click();
 document.querySelectorAll('.grid img').forEach(im=>im.onclick=()=>{$('#bigimg').src=im.src;$('#big').style.display='flex';});
 document.querySelectorAll('details').forEach(d=>d.addEventListener('toggle',async()=>{if(!d.open||d.dataset.done)return;d.dataset.done=1;d.querySelector('pre').textContent=await (await fetch(fu(d.dataset.rel))).text();}));}
function rank(n){return /감정평가서/.test(n)?0:/매각물건명세서/.test(n)?1:/현황조사서/.test(n)?2:/등기/.test(n)?3:9;}
$('#q').oninput=draw;
document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#big').style.display='none';});
load().then(()=>{const h=decodeURIComponent(location.hash.slice(1));if(h)open(h);});
</script></body></html>`;
