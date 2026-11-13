// 판단 자료 잠그기(2026-11-13): node tools/seal-data.js <배포 폴더>
// 배포 폴더 안의 경매 판단 자료(.json)를 비밀번호(환경변수 JBS_DATA_KEY)로 AES-GCM 잠금 → 같은 이름으로 덮어씀.
// 브라우저는 shared/privdata.js(JbsPriv.json)가 푼다. 비밀번호가 없으면 아무것도 내보내지 않도록 실패로 끝낸다.
// 잠글 파일: judge/·review/ 바로 아래 .json 전부(.bak 파일은 배포 전에 이미 빠짐)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const ITER = 250000;
const root = process.argv[2];
const pass = process.env.JBS_DATA_KEY || '';
if (!root) { console.error('사용법: node tools/seal-data.js <배포 폴더>'); process.exit(2); }
if (pass.length < 8) { console.error('JBS_DATA_KEY(8자 이상)가 없어 잠글 수 없습니다 — 판단 자료를 그대로 내보내지 않으려고 멈춥니다.'); process.exit(1); }
function seal(obj) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(pass, salt, ITER, 32, 'sha256');
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(Buffer.from(JSON.stringify(obj), 'utf8')), c.final(), c.getAuthTag()]);
  return { jbsEnc: 1, alg: 'AES-GCM', kdf: 'PBKDF2-SHA256', iter: ITER, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') };
}
let n = 0;
for (const dir of ['judge', 'review']) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(d, f);
    const raw = fs.readFileSync(p, 'utf8');
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { fs.unlinkSync(p); console.log('  JSON이 아니어서 뺌:', dir + '/' + f); continue; }
    if (obj && obj.jbsEnc === 1) continue;
    fs.writeFileSync(p, JSON.stringify(seal(obj)));
    n++; console.log('  잠금:', dir + '/' + f);
  }
}
console.log(`판단 자료 ${n}개 잠금`);
module.exports = { seal };
