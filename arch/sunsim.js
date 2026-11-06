(function(){
let D;try{D=JSON.parse(localStorage.getItem('jbs-sunsim-cache')||'null');}catch(e){D=null;}
if(!D){document.body.insertAdjacentHTML('beforeend','<div style="position:fixed;inset:40% 10% auto;background:#fff;border:1px solid #ccc;border-radius:10px;padding:16px">건축계획(/arch) 화면에서 [일조 시뮬레이터] 버튼으로 여세요.</div>');return;}
const G=window.ArchGeom,K=window.JbsCheck,LAT=D.lat||37.46,fh=D.assume.floorHeight_m,Hf=f=>f*fh+D.assume.groundExtra_m;
const $=s=>document.querySelector(s),svg=$('#map');
let B=[],sel=null,nid=1,full=null,MODE='now';
const clone=o=>JSON.parse(JSON.stringify(o));
const prep=b=>{b.cores=b.cores||[];b.walls=b.walls||[];b.parts=b.parts||[b.poly];b.units=b.units||[];b.n=b.n||Math.max(1,b.units.length);b.mixT=b.mixT||{[b.t||'84']:b.n};return b;};
const load=arr=>{B=clone(arr).map(b=>Object.assign(prep(b),{id:nid++}));sel=null;full=null;draw();};
// 좌표
const P=D.site.pts,xs=P.map(p=>p[0]),ys=P.map(p=>p[1]),X0=Math.min(...xs)-60,X1=Math.max(...xs)+60,Y0=Math.min(...ys)-60,Y1=Math.max(...ys)+60;
const P0x=Math.min(...xs),P1x=Math.max(...xs),P0y=Math.min(...ys),P1y=Math.max(...ys);let VB=[P0x-25,-(P1y+45),P1x-P0x+50,P1y-P0y+80];svg.setAttribute('preserveAspectRatio','xMidYMid meet');const setVB=()=>svg.setAttribute('viewBox',VB.join(' '));setVB();
svg.addEventListener('wheel',e=>{e.preventDefault();const k=e.deltaY>0?1.15:1/1.15,w=toW(e),mx=w[0],my=-w[1];VB=[mx-(mx-VB[0])*k,my-(my-VB[1])*k,VB[2]*k,VB[3]*k];setVB();},{passive:false});
const pp=q=>q.map(p=>p[0].toFixed(2)+','+(-p[1]).toFixed(2)).join(' ');
const cen=b=>{const q=b.parts.flat();return [q.reduce((a,p)=>a+p[0],0)/q.length,q.reduce((a,p)=>a+p[1],0)/q.length];};
const xf=(b,dx,dy,da)=>{const c=cen(b),r=da*Math.PI/180,T=p=>{const q=G.rot([p[0]-c[0],p[1]-c[1]],r);return [q[0]+c[0]+dx,q[1]+c[1]+dy];};
  b.parts=b.parts.map(q=>q.map(T));b.cores=b.cores.map(q=>q.map(T));b.units=b.units.map(rs=>rs.map(q=>q.map(T)));b.walls=b.walls.map(w=>Object.assign(w,{a:T(w.a),b:T(w.b),n:G.rot(w.n,r)}));b.poly=G.hull(b.parts.flat());b.angle=(b.angle||0)+da;full=null;};
// 세대 창 점(세대마다 가장 남쪽을 향한 바깥 변 가운데)
const ptsOf=b=>{const parts=b.parts,inA=(x,y)=>parts.some(q=>G.inside(x,y,q)),out=[];
  if(!b.units.length){// 세대 조각이 없는 동(올린 도면 등): 남쪽 반을 향한 바깥 벽을 층당 세대 수만큼 고르게 나눈 점
    const es=[];parts.forEach(q=>q.forEach((p,i)=>{const r=q[(i+1)%q.length],dx=r[0]-p[0],dy=r[1]-p[1],L=Math.hypot(dx,dy);if(L<1.5)return;let n=[dy/L,-dx/L];const m=[(p[0]+r[0])/2,(p[1]+r[1])/2];const A1=inA(m[0]+n[0]*.4,m[1]+n[1]*.4),A2=inA(m[0]-n[0]*.4,m[1]-n[1]*.4);if(A1&&A2)return;if(A1)n=[-n[0],-n[1]];if(n[1]<-0.2)es.push({p,r,n,L});}));
    const tot=es.reduce((a,e)=>a+e.L,0),k=Math.max(1,b.n||1);let acc=0,j=0;es.forEach(e=>{while(j<k&&(j+.5)*tot/k<=acc+e.L+1e-6){const t=((j+.5)*tot/k-acc)/e.L;out.push({b,k:j,p:[e.p[0]+(e.r[0]-e.p[0])*t+e.n[0]*.6,e.p[1]+(e.r[1]-e.p[1])*t+e.n[1]*.6]});j++;}acc+=e.L;});return out;}

  b.units.forEach((rs,k)=>{let best=null;rs.forEach(q=>q.forEach((p,i)=>{const r=q[(i+1)%q.length],dx=r[0]-p[0],dy=r[1]-p[1],L=Math.hypot(dx,dy);if(L<2)return;let n=[dy/L,-dx/L];const m=[(p[0]+r[0])/2,(p[1]+r[1])/2];const A1=inA(m[0]+n[0]*.4,m[1]+n[1]*.4),A2=inA(m[0]-n[0]*.4,m[1]-n[1]*.4);if(A1&&A2)return;if(A1)n=[-n[0],-n[1]];if(!best||n[1]<best.n[1])best={m,n};}));
    if(best)out.push({b,k,p:[best.m[0]+best.n[0]*.6,best.m[1]+best.n[1]*.6]});});return out;};
const shadows=(t,z)=>{const s=G.sun(LAT,t);return B.flatMap(b=>b.parts.map(q=>G.shadow(q,Math.max(0,Hf(b.floors)-z),s))).filter(Boolean);};
const litAt=(pt,S)=>!S.some(q=>G.inside(pt[0],pt[1],q));
function contHours(pts,z){const S=[];for(let t=9;t<15-1e-9;t+=1/6)S.push(shadows(t,z));return pts.map(q=>{let run=0,best=0;S.forEach(s=>{if(litAt(q.p,s)){run+=1/6;best=Math.max(best,run);}else run=0;});return best;});}
// 검사: 대지 밖·공원 겹침, 동 사이 10m 미만
const test=G.buildableTest(D.site.pts,D.site.setbacks);
const outOf=b=>!b.parts.flat().every(p=>test(p[0],p[1])&&!(D.exclude||[]).some(q=>G.inside(p[0],p[1],q)));
const gap=(a,b)=>{let d=1e9;a.poly.forEach(p=>{for(let i=0;i<b.poly.length;i++)d=Math.min(d,G.segDist(p,b.poly[i],b.poly[(i+1)%b.poly.length]));});b.poly.forEach(p=>{for(let i=0;i<a.poly.length;i++)d=Math.min(d,G.segDist(p,a.poly[i],a.poly[(i+1)%a.poly.length]));});return d;};
const sup=t=>(D.supply||{})[t]||(+t||84)*D.assume.supplyFactor;
function draw(){
  const t=+$('#time').value,fl=+$('#floor').value,z=(fl-1)*fh,mode=MODE;
  $('#tlab').textContent=`${Math.floor(t)}:${String(Math.round((t%1)*60)).padStart(2,'0')}`;$('#flab').textContent=fl+'층';
  const s=G.sun(LAT,t),azd=s.az*180/Math.PI;$('#sunlab').textContent=`해 높이 ${(s.alt*180/Math.PI).toFixed(0)}° · ${Math.abs(azd)<2?'정남':(azd>0?'남서 ':'남동 ')+Math.abs(azd).toFixed(0)+'°'}`;
  let o=`<polygon points="${pp(P)}" fill="#f6f7f2" stroke="#c33" stroke-width=".8" stroke-dasharray="4 3"/>`;
  (D.exclude||[]).forEach(q=>{o+=`<polygon points="${pp(q)}" fill="#dcebcd" stroke="#8a8" stroke-width=".5"/>`;});
  const pts=B.flatMap(b=>b.floors>=fl?ptsOf(b):[]);
  if(mode==='now'){shadows(t,z).forEach(q=>o+=`<polygon points="${pp(q)}" fill="#1f2a44" fill-opacity=".18"/>`);}
  // 동 사이 가까움
  const warn=[];for(let i=0;i<B.length;i++)for(let j=i+1;j<B.length;j++){const d=gap(B[i],B[j]);if(d<10)warn.push([B[i],B[j],d]);}
  warn.forEach(([a,b,d])=>{const ca=cen(a),cb=cen(b);o+=`<line x1="${ca[0]}" y1="${-ca[1]}" x2="${cb[0]}" y2="${-cb[1]}" stroke="#d00" stroke-width=".8" stroke-dasharray="2 2"/>`;});
  B.forEach(b=>{const bad=outOf(b),low=b.floors<fl,lost=full&&full.per[b.id]?full.per[b.id].lost:0;
    b.parts.forEach(q=>o+=`<polygon data-id="${b.id}" points="${pp(q)}" fill="${low?'#eee':'#cfe0f5'}" stroke="${b===sel?'#0a58ca':bad?'#d00':'#334'}" stroke-width="${b===sel?1.6:.5}" class="bd"/>`);
    b.cores.forEach(q=>o+=`<polygon points="${pp(q)}" fill="#555" pointer-events="none"/>`);
    const c=cen(b);o+=`<text x="${c[0]}" y="${-c[1]+2}" font-size="7" text-anchor="middle" font-weight="bold" stroke="#fff" stroke-width="2" paint-order="stroke" pointer-events="none">${b.floors}층${lost?` <tspan fill="#d00">−${lost}</tspan>`:''}</text>`;});
  let bad=0;
  if(mode==='now'){const S=shadows(t,z);pts.forEach(q=>{const l=litAt(q.p,S);o+=`<circle cx="${q.p[0]}" cy="${-q.p[1]}" r="1.8" fill="${l?'#f5b800':'#555'}" stroke="#fff" stroke-width=".4" pointer-events="none"/>`;});}
  else{const h=contHours(pts,z);pts.forEach((q,i)=>{const ok=h[i]>=2-1e-6;if(!ok)bad++;o+=`<circle cx="${q.p[0]}" cy="${-q.p[1]}" r="2.4" fill="${ok?'#1a7f37':'#d00'}" stroke="#fff" stroke-width=".4" pointer-events="none"/><text x="${q.p[0]}" y="${-q.p[1]-3}" font-size="4.2" text-anchor="middle" fill="#222" pointer-events="none">${h[i].toFixed(1)}</text>`;});}
  // 해 방향 표시
  const sx=P1x+10,sy=-(P1y+20),L=14;o+=`<line x1="${sx}" y1="${sy}" x2="${sx-Math.sin(s.az)*L}" y2="${sy+Math.cos(s.az)*L}" stroke="#f5b800" stroke-width="2"/><circle cx="${sx-Math.sin(s.az)*L}" cy="${sy+Math.cos(s.az)*L}" r="4" fill="#f5b800"/><text x="${sx}" y="${sy-8}" font-size="7" text-anchor="middle">해</text><text x="${P0x-15}" y="${-(P1y+25)}" font-size="8">↑ 북</text>`;
  svg.innerHTML=o;
  // 요약
  const units=B.reduce((a,b)=>a+b.n*b.floors,0),gfa=B.reduce((a,b)=>a+Object.keys(b.mixT).reduce((c,k)=>c+b.mixT[k]*b.floors*sup(k),0),0);
  $('#sum').innerHTML=`<b>${B.length}동 ${units.toLocaleString()}세대 · ${(gfa/D.lot*100).toFixed(0)}%</b>`+
    (mode==='day'?` · ${fl}층 미달 <b style="color:#d00">${bad}</b>/${pts.length}`:'')+
    (full?` · 전 층 미달 <b style="color:#d00">${full.lost}</b> → 순 <b>${(units-full.lost).toLocaleString()}</b>`:'')+(warn.length||B.some(outOf)?` · <span style="color:#d00">경고 ${warn.length+B.filter(outOf).length}</span>`:'');
  $('#selbar').style.display=sel?'flex':'none';if(sel)$('#selname').innerHTML=`<b>${sel.dname||'동'}</b> ${sel.n}호 × ${sel.floors}층`;
}
// 끌기
let drag=null;const toW=e=>{const pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;const q=pt.matrixTransform(svg.getScreenCTM().inverse());return [q.x,-q.y];};
svg.addEventListener('pointerdown',e=>{const id=e.target.getAttribute&&e.target.getAttribute('data-id');if(id){sel=B.find(b=>b.id==id);drag=toW(e);svg.setPointerCapture(e.pointerId);}else{sel=null;pan=[e.clientX,e.clientY];svg.setPointerCapture(e.pointerId);}draw();});
let pan=null;svg.addEventListener('pointermove',e=>{if(pan){const r=svg.getBoundingClientRect(),k=VB[2]/r.width;VB[0]-=(e.clientX-pan[0])*k;VB[1]-=(e.clientY-pan[1])*k;pan=[e.clientX,e.clientY];setVB();return;}if(!drag||!sel)return;const w=toW(e);xf(sel,w[0]-drag[0],w[1]-drag[1],0);drag=w;draw();});
svg.addEventListener('pointerup',()=>{drag=null;pan=null;});
const act={rotL:()=>xf(sel,0,0,5),rotR:()=>xf(sel,0,0,-5),rotl:()=>xf(sel,0,0,1),rotr:()=>xf(sel,0,0,-1),fUp:()=>{sel.floors=Math.min(49,sel.floors+1);full=null;},fDn:()=>{sel.floors=Math.max(1,sel.floors-1);full=null;},fUp5:()=>{sel.floors=Math.min(49,sel.floors+5);full=null;},fDn5:()=>{sel.floors=Math.max(1,sel.floors-5);full=null;},
  del:()=>{B=B.filter(b=>b!==sel);sel=null;full=null;},dup:()=>{const c=clone(sel);c.id=nid++;B.push(c);xf(c,15,-15,0);sel=c;}};
document.querySelectorAll('[data-act]').forEach(el=>el.addEventListener('click',()=>{if(!sel)return;act[el.dataset.act]();draw();}));
window.addEventListener('keydown',e=>{if(!sel||e.target.tagName==='INPUT')return;const st=e.shiftKey?5:1;const m={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,st],ArrowDown:[0,-st]}[e.key];
  if(m){xf(sel,m[0],m[1],0);e.preventDefault();}else if(e.key==='q'||e.key==='Q')xf(sel,0,0,5);else if(e.key==='e'||e.key==='E')xf(sel,0,0,-5);else if(e.key==='+'||e.key==='=')act.fUp();else if(e.key==='-')act.fDn();else if(e.key==='Delete'||e.key==='Backspace')act.del();else return;draw();});
// 보태기
const pal=$('#pal');
async function templates(){const [C,DT]=await Promise.all([fetch('../shared/criteria/arch.json').then(r=>r.json()),fetch('../shared/criteria/dong-types.json').then(r=>r.json())]);
  JbsDong.init({units:C.평면,lib:C.평면_라이브러리,types:DT});const D2R=Math.PI/180,mk=(id,seq)=>JbsDong.build(id,seq);
  const slab=m=>{const T=p=>[p[0]-m.L/2,p[1]-m.D/2];return {form:'slab',n:m.n,mixT:m.mixT,parts:m.parts.map(q=>q.map(T)),cores:m.cores.map(q=>q.map(T)),units:(m.units||[]).map(rs=>rs.map(q=>q.map(T))),walls:G.wallsTo(G.wallsOf(m),T,0)};};
  // V자 꼭짓점 2세대형: 꼭짓점 남쪽, 날개 북서·북동, 꼭짓점 세모 코어
  const V=(m1,m2)=>{const D=m1.D,R1=-45*D2R,R2=45*D2R,e1=G.rot([m1.L,D],R1),e2=G.rot([0,D],R2),T1=p=>{const q=G.rot(p,R1);return [q[0]-e1[0],q[1]-e1[1]];},T2=p=>{const q=G.rot(p,R2);return [q[0]-e2[0],q[1]-e2[1]];};
    const tri=[[0,0],T1([m1.L,0]),T2([0,0])],mixT={};[m1,m2].forEach(m=>Object.keys(m.mixT).forEach(t=>mixT[t]=(mixT[t]||0)+m.mixT[t]));
    const b={form:'L',n:m1.n+m2.n,mixT,parts:[...m1.parts.map(q=>q.map(T1)),...m2.parts.map(q=>q.map(T2)),tri],cores:[...m1.cores.map(q=>q.map(T1)),...m2.cores.map(q=>q.map(T2)),tri],units:[...(m1.units||[]).map(rs=>rs.map(q=>q.map(T1))),...(m2.units||[]).map(rs=>rs.map(q=>q.map(T2)))],walls:[...G.wallsTo(G.wallsOf(m1),T1,R1),...G.wallsTo(G.wallsOf(m2),T2,R2)]};
    const c=b.parts.flat().reduce((a,p,_,A)=>[a[0]+p[0]/A.length,a[1]+p[1]/A.length],[0,0]),Tc=p=>[p[0]-c[0],p[1]-c[1]];b.parts=b.parts.map(q=>q.map(Tc));b.cores=b.cores.map(q=>q.map(Tc));b.units=b.units.map(rs=>rs.map(q=>q.map(Tc)));b.walls=b.walls.map(w=>Object.assign(w,{a:Tc(w.a),b:Tc(w.b)}));return b;};
  const p2=mk('P2',['59','74']),p4=mk('P4',['74','59','59','74']),p6=mk('P6',['84','74','59','59','74','84']);
  return [['V자 2+2호',V(p2,p2)],['V자 4+2호',V(p4,p2)],['V자 4+4호',V(p4,p4)],['일자 2호',slab(p2)],['일자 4호',slab(p4)],['일자 6호',slab(p6)]].map(([nm,b])=>Object.assign(b,{dname:nm,poly:G.hull(b.parts.flat()),angle:0}));}
templates().then(T=>T.forEach(tpl=>{const bt=document.createElement('button');bt.textContent='+ '+tpl.dname;bt.onclick=()=>{const c=clone(tpl);c.id=nid++;c.floors=30;const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;xf(c,cx,cy,0);c.angle=0;B.push(c);sel=c;full=null;$('#menu').style.display='none';draw();};pal.appendChild(bt);})).catch(e=>{pal.textContent='동 틀을 못 불러왔습니다';console.warn(e);});
$('#time').oninput=draw;$('#floor').oninput=draw;$('#mNow').onclick=()=>{MODE='now';$('#mNow').classList.add('on');$('#mDay').classList.remove('on');draw();};$('#mDay').onclick=()=>{MODE='day';$('#mDay').classList.add('on');$('#mNow').classList.remove('on');draw();};
const tog=id=>{const el=$(id),o=el.style.display==='block';$('#menu').style.display='none';$('#help').style.display='none';el.style.display=o?'none':'block';};$('#mBtn').onclick=()=>tog('#menu');$('#hBtn').onclick=()=>tog('#help');
let timer=null;$('#play').onclick=()=>{if(timer){clearInterval(timer);timer=null;$('#play').textContent='▶';return;}$('#play').textContent='■';timer=setInterval(()=>{let v=+$('#time').value+1/6;if(v>15)v=9;$('#time').value=v;draw();},350);};
$('#full').onclick=()=>{$('#full').textContent='검사 중…';setTimeout(()=>{full=K.unitSun(D.site,B,{units:D.units||{},assume:D.assume,lat:LAT,sunWin:'any'});$('#full').textContent='전 층 검사';draw();},30);};
$('#ldStart').onclick=()=>load(D.start);$('#ldEmpty').onclick=()=>load([]);
$('#ldBack').onclick=()=>{try{localStorage.setItem('jbs-sunsim-back-cache',JSON.stringify({at:Date.now(),buildings:B.map(b=>({id:b.id,dname:b.dname,form:b.form,floors:b.floors,n:b.n,mixT:b.mixT,poly:b.poly,parts:b.parts,cores:b.cores,units:b.units,walls:b.walls,angle:b.angle||0}))}));$('#ldBack').textContent='넘김 — 건축계획 화면에서 [시뮬레이터 배치 받기]';}catch(e){$('#ldBack').textContent='넘기기 실패(저장 공간)';}};
load(D.start);
})();
