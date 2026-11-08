// /urban 파일 순서 검사(2026-11-08): node tools/check-urban-order.js
// urban/js/01~12 파일은 모두 한 전역을 함께 쓴다. 한 파일 안에서는 함수가 아래에 있어도 불렀지만(끌어올림),
// 파일이 나뉘면 '불러오는 순간 바로 실행되는 코드'가 아직 안 불러온 뒤 파일의 이름을 쓰면 오류가 난다.
// 이 검사는 각 파일에서 불러오는 순간 실행되는 코드(바로 실행 함수·최상위 호출, 그 안에서 부르는 함수까지 따라감)가
// 쓰는 이름이 같은 파일이나 앞 파일에 있는지 본다. 이벤트 처리 함수 안처럼 나중에 실행되는 곳은 상관없다.
// 같은 이름을 두 파일에서 만들어도 오류가 나므로 그것도 본다.
const fs = require('fs'), path = require('path');
const req = m => { for (const p of [m, path.join(process.env.HOME || '', 'tools/node_modules', m), '/opt/npm-tools/node_modules/' + m]) { try { return require(p); } catch (e) { /* 다음 */ } } throw new Error(`${m}가 없습니다: npm i -g ${m} 또는 npm i ${m}`); };
const acorn = req('acorn');
const DIR = path.join(__dirname, '../urban/js');
const html = fs.readFileSync(path.join(__dirname, '../urban/index.html'), 'utf8');
const files = [...html.matchAll(/<script src="(js\/[^"?]+)/g)].map(m => m[1].replace(/^js\//, ''));
const fsFiles = fs.readdirSync(DIR).filter(f => f.endsWith('.js')).sort();
let bad = 0;
const fail = m => { bad++; console.log('✘', m); };
if (JSON.stringify(files) !== JSON.stringify(fsFiles)) fail(`index.html이 불러오는 파일 ${files.join(',')} ≠ 폴더의 파일 ${fsFiles.join(',')} (순서·빠짐 확인)`);

const P = files.map(f => ({ f, ast: acorn.parse(fs.readFileSync(path.join(DIR, f), 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' }) }));
const owner = new Map(), fnBody = new Map(), objInit = new Map();
const declNames = id => id.type === 'Identifier' ? [id.name] : id.type === 'ObjectPattern' ? id.properties.flatMap(p => declNames(p.value || p.argument)) : id.type === 'ArrayPattern' ? id.elements.filter(Boolean).flatMap(declNames) : id.type === 'AssignmentPattern' ? declNames(id.left) : id.type === 'RestElement' ? declNames(id.argument) : [];
P.forEach((p, i) => {
  for (const n of p.ast.body) {
    let names = [];
    if (n.type === 'FunctionDeclaration' || n.type === 'ClassDeclaration') { names = [n.id.name]; if (n.type === 'FunctionDeclaration') fnBody.set(n.id.name, n); }
    if (n.type === 'VariableDeclaration') for (const d of n.declarations) {
      const ns = declNames(d.id); names.push(...ns);
      if (d.init && ns.length === 1) { if (/Function|Arrow/.test(d.init.type)) fnBody.set(ns[0], d.init); if (d.init.type === 'ObjectExpression') objInit.set(ns[0], d.init); }
    }
    for (const nm of names) { if (owner.has(nm)) fail(`'${nm}'을(를) ${files[owner.get(nm)]}와 ${p.f} 두 곳에서 만듦`); else owner.set(nm, i); }
  }
});

const isFn = n => n && /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression)$/.test(n.type);
// node 안에서 지금 실행되는 이름 모으기. 함수는 바로 불리는 것만 들어감
function scan(node, out, seen) {
  if (!node || typeof node.type !== 'string') return;
  if (isFn(node)) return;   // 만들기만 하고 실행 안 함
  if (node.type === 'Identifier') { out.add(node.name); return; }
  if (node.type === 'CallExpression' || node.type === 'NewExpression') {
    const c = node.callee;
    if (isFn(c)) { scanParams(c, out, seen); scan(c.body, out, seen); }   // 바로 실행 함수
    else if (c.type === 'Identifier') { out.add(c.name); follow(c.name, out, seen); }
    else if (c.type === 'MemberExpression' && c.object.type === 'Identifier' && !c.computed) { out.add(c.object.name); followMember(c.object.name, c.property.name, out, seen); scan(c.object, out, seen); }
    else scan(c, out, seen);
    node.arguments.forEach(a => scan(a, out, seen));
    return;
  }
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end') continue;
    if ((node.type === 'MemberExpression' && k === 'property' && !node.computed) || ((node.type === 'Property' || node.type === 'MethodDefinition' || node.type === 'PropertyDefinition') && k === 'key' && !node.computed)) continue;
    if (node.type === 'LabeledStatement' && k === 'label') continue;
    if ((node.type === 'BreakStatement' || node.type === 'ContinueStatement') && k === 'label') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach(x => scan(x, out, seen)); else if (v && typeof v.type === 'string') scan(v, out, seen);
  }
}
function scanParams(fn, out, seen) { fn.params.forEach(p => { if (p.type === 'AssignmentPattern') scan(p.right, out, seen); }); }
function follow(name, out, seen) {
  if (seen.has(name) || !fnBody.has(name)) return; seen.add(name);
  const f = fnBody.get(name); scanParams(f, out, seen); scan(f.body, out, seen);
}
function followMember(obj, prop, out, seen) {
  const o = objInit.get(obj); if (!o) return;
  const key = obj + '.' + prop; if (seen.has(key)) return; seen.add(key);
  const pr = o.properties.find(p => p.key && (p.key.name === prop || p.key.value === prop));
  if (pr && isFn(pr.value)) { scanParams(pr.value, out, seen); scan(pr.value.body, out, seen); }
}

P.forEach((p, i) => {
  const used = new Set(), seen = new Set();
  for (const n of p.ast.body) {
    if (n.type === 'FunctionDeclaration') continue;
    if (n.type === 'ClassDeclaration') { if (n.superClass) scan(n.superClass, used, seen); continue; }
    scan(n, used, seen);
  }
  const later = [...used].filter(nm => owner.has(nm) && owner.get(nm) > i);
  later.forEach(nm => fail(`${p.f}: 불러오는 순간 '${nm}'을(를) 씀 — 그런데 '${nm}'은(는) 뒤 파일 ${files[owner.get(nm)]}에 있음`));
});
console.log(bad ? `\n문제 ${bad}건` : `/urban 파일 ${files.length}개 순서 검사 통과(불러오는 순간 뒤 파일 이름을 쓰는 곳 없음, 이름 겹침 없음)`);
process.exit(bad ? 1 : 0);
