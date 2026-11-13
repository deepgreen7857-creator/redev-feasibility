// 사이트 폴더 만들기(2026-11-13): node tools/build-site.js <만들 폴더>
// 저장소에서 홈페이지에 올릴 것만 복사한다. 올리지 않는 것: 백업(.bak)·인계 문서·규칙 메모·서버/수집기 코드·시험 도구·개인정보 폴더.
// 경매 판단 자료(judge·review .json)는 복사한 뒤 tools/seal-data.js가 잠근다(.github/workflows/pages.yml).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || '_site');
const SKIP_TOP = new Set(['.git', '.github', '_site', '_비공개', 'docs', 'court-collector', 'auction-server', 'auction-web', 'tools',
  'CLAUDE.md', 'README.md', 'serve.ps1']);
const skip = (rel, name, isDir) => {
  const top = rel.split('/')[0];
  if (SKIP_TOP.has(top)) return true;
  if (name === 'node_modules' || name === '.DS_Store') return true;
  if (/\.bak/.test(name)) return true;                       // picks.bak-….json, HANDOFF.md.bak_1029b, index.bak-….html
  if (!isDir && /^(review|judge)\/[^/]+\.md$/.test(rel)) return true;   // 인계(HANDOFF)·규칙 메모
  if (isDir && rel === 'safety/test') return true;
  return false;
};
let files = 0, bytes = 0;
(function walk(rel) {
  const abs = path.join(ROOT, rel);
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const r = rel ? rel + '/' + e.name : e.name;
    if (path.join(ROOT, r) === out) continue;
    if (skip(r, e.name, e.isDirectory())) continue;
    if (e.isDirectory()) { fs.mkdirSync(path.join(out, r), { recursive: true }); walk(r); }
    else if (e.isFile()) { fs.mkdirSync(path.dirname(path.join(out, r)), { recursive: true }); fs.copyFileSync(path.join(ROOT, r), path.join(out, r)); files++; bytes += fs.statSync(path.join(ROOT, r)).size; }
  }
})('');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
console.log(`사이트 폴더: 파일 ${files}개, ${(bytes / 1048576).toFixed(1)}MB → ${out}`);
