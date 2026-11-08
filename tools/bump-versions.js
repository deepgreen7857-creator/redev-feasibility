// 버전 번호 자동 맞춤(2026-11-08): node tools/bump-versions.js        → 고친 파일의 ?v= 번호를 모든 페이지에서 새로 붙임
//                                    node tools/bump-versions.js --check → 맞지 않는 곳만 알려 줌(고치지 않음, 있으면 종료 코드 1)
// ?v= 번호는 브라우저가 옛 파일을 계속 쓰지 않게 하는 꼬리표다. 예전엔 손으로 올려서 페이지마다 번호가 달랐다(같은 파일이 4가지 번호로 불림).
// 이제 번호 = 파일 내용의 지문(앞 8자리)이라, 파일이 바뀌면 번호가 저절로 바뀌고 안 바뀌면 그대로다. push 전에 한 번 돌리면 됨.
// 대상: 모든 .html의 src/href, 그리고 .js 안 importScripts·new Worker·fetch 글자 중 이미 ?v= 가 붙은 이 저장소 파일(.js/.css/.json). 외부 주소·/auction 빌드 결과·tools는 건드리지 않음
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const CHECK = process.argv.includes('--check');
const skipDir = /^(node_modules|\.git|auction|_비공개)$/;
const htmls = [], jss = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!skipDir.test(e.name) && !(d === ROOT && e.name === 'tools')) walk(path.join(d, e.name)); }
    else if (/\.bak/.test(e.name)) continue;
    else if (e.name.endsWith('.html')) htmls.push(path.join(d, e.name));
    else if (e.name.endsWith('.js')) jss.push(path.join(d, e.name));
  }
})(ROOT);
const fp = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex').slice(0, 8);
// HTML: src/href="파일?v=…"  /  JS: 'importScripts·new Worker·fetch에 쓰인 '파일?v=…' 글자(작업 스레드·기준 json)
const RE_HTML = /((?:src|href)=")([^"?#]+\.(?:js|css))\?v=([^"#]*)(")/g;
const RE_JS = /(['"`])([^'"`?#\s]+\.(?:js|json))\?v=([0-9A-Za-z._-]+)(['"`])/g;
let stale = 0, missing = 0;
const missSeen = new Set();
function fix(file, re, cands) {
  const s = fs.readFileSync(file, 'utf8');
  let n = 0;
  const t = s.replace(re, (all, a, ref, v, z) => {
    if (/^(https?:)?\/\//.test(ref)) return all;
    const f = cands(ref).find(x => fs.existsSync(x));
    if (!f) { const k = file + ref; if (!missSeen.has(k)) { missSeen.add(k); missing++; console.log('  없는 파일을 부름:', path.relative(ROOT, file), ref); } return all; }
    const nv = fp(f);
    if (v === nv) return all;
    n++; if (CHECK) console.log('  번호 다름:', path.relative(ROOT, file), `${ref}?v=${v} → ${nv}`);
    return a + ref + '?v=' + nv + z;
  });
  if (!CHECK && t !== s) fs.writeFileSync(file, t);
  return n;
}
const rootRel = ref => ref.startsWith('/') ? [path.join(ROOT, ref)] : null;
// 작업 스레드 파일은 화면 주소 기준으로 찾으므로 파일 폴더 → 한 칸 위 폴더 순서로 찾음(urban/js/08-arch.js의 'archlay-worker.js'는 urban/)
const jsCands = file => ref => rootRel(ref) || [path.resolve(path.dirname(file), ref), path.resolve(path.dirname(file), '..', ref)];
const htmlCands = file => ref => rootRel(ref) || [path.resolve(path.dirname(file), ref)];
// 작업 스레드 번호가 바뀌면 그걸 부르는 파일 지문도 바뀌므로 더 바뀌는 게 없을 때까지 되풀이(검사 모드는 한 번만)
for (let pass = 0; pass < (CHECK ? 1 : 6); pass++) {
  let n = 0;
  for (const f of jss) n += fix(f, RE_JS, jsCands(f));
  for (const f of htmls) n += fix(f, RE_HTML, htmlCands(f));
  stale += n;
  if (!n) break;
}
if (CHECK) {
  console.log(stale ? `버전 번호 ${stale}곳이 파일 내용과 다름 — node tools/bump-versions.js 를 돌리세요` : '버전 번호 모두 맞음');
  process.exit(stale || missing ? 1 : 0);
}
console.log(`버전 번호 ${stale}곳을 새로 붙임${missing ? ` / 없는 파일 ${missing}곳(확인 필요)` : ''}`);
