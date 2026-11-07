// 이어 하기 되는 PDF 글자 추출(미니 PC 장치 셸은 한 번에 3분까지만 돌아서 만듦) — rd.js와 같은 줄 맞춤
// 사용: node ext.js <목록.txt(PDF 경로 한 줄씩)> [캐시폴더=cache]  → 다 될 때까지 되풀이(‘전체완료’ 나오면 끝)
// 그 뒤 RD_CACHE=<캐시폴더> node judge.js ... 로 돌리면 PDF를 다시 읽지 않음
const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');const fs=require('fs'),cr=require('crypto'),path=require('path');
const [list,dir='cache']=process.argv.slice(2);const T0=Date.now(),BUD=+process.env.BUD||150000;fs.mkdirSync(dir,{recursive:true});
const key=f=>path.join(dir,cr.createHash('md5').update(path.resolve(f)).digest('hex')+'.json');
(async()=>{for(const f of fs.readFileSync(list,'utf8').split('\n').filter(Boolean)){const k=key(f);let c=fs.existsSync(k)?JSON.parse(fs.readFileSync(k)):{pages:[],n:null};if(c.n!==null&&c.pages.length>=c.n)continue;
const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(f)),cMapUrl:__dirname+'/node_modules/pdfjs-dist/cmaps/',cMapPacked:true,verbosity:0}).promise;c.n=doc.numPages;
for(let i=c.pages.length+1;i<=doc.numPages;i++){const tc=await (await doc.getPage(i)).getTextContent();let lines=[],cur='',lastY=null,lastEnd=null;
tc.items.forEach(it=>{const x=it.transform[4],y=Math.round(it.transform[5]),fs=Math.abs(it.transform[0])||10;if(lastY!==null&&Math.abs(y-lastY)>fs*0.5){lines.push(cur);cur='';lastEnd=null}
if(cur&&lastEnd!==null&&x-lastEnd>fs*0.25&&!cur.endsWith(' '))cur+=' ';cur+=it.str;lastY=y;lastEnd=x+(it.width||0)});lines.push(cur);c.pages.push(lines.join('\n'));
if(Date.now()-T0>BUD){fs.writeFileSync(k,JSON.stringify(c));console.log('중단',path.basename(f),c.pages.length+'/'+c.n);return}}
fs.writeFileSync(k,JSON.stringify(c));await doc.destroy();console.log('완료',path.basename(f),c.n+'쪽')}console.log('전체완료')})();
