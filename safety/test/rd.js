const pdfjs=require('pdfjs-dist/legacy/build/pdf.js');const fs=require('fs');
module.exports=async f=>{const doc=await pdfjs.getDocument({data:new Uint8Array(fs.readFileSync(f)),cMapUrl:__dirname+'/node_modules/pdfjs-dist/cmaps/',cMapPacked:true,verbosity:0}).promise;const pages=[];
for(let i=1;i<=doc.numPages;i++){const tc=await (await doc.getPage(i)).getTextContent();let lines=[],cur='',lastY=null,lastEnd=null;
tc.items.forEach(it=>{const x=it.transform[4],y=Math.round(it.transform[5]),fs=Math.abs(it.transform[0])||10;if(lastY!==null&&Math.abs(y-lastY)>fs*0.5){lines.push(cur);cur='';lastEnd=null}
if(cur&&lastEnd!==null&&x-lastEnd>fs*0.25&&!cur.endsWith(' '))cur+=' ';cur+=it.str;lastY=y;lastEnd=x+(it.width||0)});lines.push(cur);pages.push(lines.join('\n'))}return pages};
