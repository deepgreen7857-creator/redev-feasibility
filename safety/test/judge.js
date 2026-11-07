// 안전관리계획서 판독 시험 도구 (node) — 사이트(safety/index.html)의 onFiles를 jsdom에서 그대로 돌림
// 설치: cd safety/test && npm i jsdom@31 pdfjs-dist@3.11.174 xlsx@0.18.5
// 실행: node judge.js <사례.json 또는 -> <CSI 의뢰개요.xlsx 또는 -> "<파일경로>::<원래 파일 이름>" ...
//   - 사례.json: 사례 탭에서 내보낸 파일(앞 차수 사례를 불러온 상태에서 보완·변경 차수 판독)
//   - 첨부가 '1794…_____.pdf'처럼 이름이 깨져 오면 ::뒤에 원래 이름을 붙여야 공종을 이름으로 알아봄
// 개인정보가 든 자료(명부·사전조사 보고서 등)는 저장소에 넣지 말 것
const {JSDOM}=require('jsdom');const fs=require('fs');const path=require('path');const rd=require('./rd.js');
let h=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8').replace(/<script src=[^>]*><\/script>/g,'');
const d=new JSDOM(h,{runScripts:'dangerously',url:'https://jbslab.co.kr/safety/'});const w=d.window,$=s=>w.document.querySelector(s);
w.XLSX=require('xlsx');w.addEventListener('error',e=>console.log('오류',e.message));w.alert=()=>{};w.confirm=()=>true;
const cache={};const RA=w.readAny;w.readAny=async f=>{if(!f.path)return RA(f);if(!cache[f.path])cache[f.path]=(await rd(f.path)).map(w.fixHan);return {pages:cache[f.path],unit:'쪽',paged:true}};
(async()=>{const [cs,x,...rest]=process.argv.slice(2);
 if(cs&&cs!=='-'){const c=JSON.parse(fs.readFileSync(cs,'utf8')).cases[0].data;w.eval('S='+JSON.stringify(c)+';save();render()');}
 if(x&&x!=='-'){const buf=fs.readFileSync(x);await w.onFiles([{name:'의뢰개요.xlsx',arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length)}]);console.log('##',$('#upStat').textContent);if($('#csiOvApply'))$('#csiOvApply').click();}
 const files=rest.map(s=>{const [p,n]=s.split('::');return {path:p,name:n||p.split('/').pop()}});
 const t0=Date.now();await w.onFiles(files);
 console.log('## 판독',((Date.now()-t0)/1000|0)+'초',$('#upStat').textContent);
 [...w.document.querySelectorAll('#upDiag tr, #upDiag li')].forEach(r=>console.log(r.textContent.replace(/\s+/g,' ').replace(/글자가 없는\(그림\) 쪽.*$/,'').slice(0,900)));
})();
