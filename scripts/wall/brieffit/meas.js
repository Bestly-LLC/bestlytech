(()=>{const R=c=>{const r=c.getBoundingClientRect();return[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]};
const p=document.getElementById('briefP'); const out={errs:window.__errs,brief:window.__brief&&{on:window.__brief.on,errs:window.__brief.errs,err:window.__brief.err,over:window.__brief.over},bodycls:document.body.className.slice(0,120)};
if(!p) return out;
const b=document.getElementById('board'); const pr=p.getBoundingClientRect();
out.p={local:[p.offsetLeft,p.offsetTop,p.offsetWidth,p.offsetHeight],scr:R(p),op:getComputedStyle(p).opacity,bg:getComputedStyle(p).backgroundImage.slice(0,60)};
const vis=e=>{const s=getComputedStyle(e);return s.visibility!=='hidden'&&s.display!=='none'&&+s.opacity>0.01};
const hits=[];for(const e of b.querySelectorAll('.card,.pick,.lalt,.lcube,.scene,.w2-list,.dv-tile')){ if(p.contains(e))continue; let a=e,hid=false;while(a&&a!==b){if(!vis(a)){hid=true;break;}a=a.parentElement;} if(hid)continue; const r=e.getBoundingClientRect(); if(r.width<2)continue; if(!(r.right<=pr.left||r.left>=pr.right||r.bottom<=pr.top||r.top>=pr.bottom)) hits.push((e.id||e.className.toString().slice(0,30))+JSON.stringify(R(e)));}
out.visibleOverlaps=hits;
out.state=['.left','#picks','#sHourly','#sDaily','#cScout'].map(q=>{const e=document.querySelector(q);return e?q+' op='+getComputedStyle(e).opacity+' vis='+getComputedStyle(e).visibility:q+' none'});
out.over=[...p.querySelectorAll('.btime,.bsm,.bone,.btm,.btx,.bwide,.bsm span')].map(e=>({c:e.className,t:e.textContent.slice(0,70),sw:e.scrollWidth,cw:e.clientWidth,sh:e.scrollHeight,ch:e.clientHeight,bad:e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1,h:Math.round(e.getBoundingClientRect().height)}));
out.ellipsis=[...p.querySelectorAll('*')].filter(e=>getComputedStyle(e).textOverflow==='ellipsis').length+(/\.\.\.|…/.test(p.textContent)?1:0);
out.local=[p.offsetLeft,p.offsetTop,p.offsetLeft+p.offsetWidth,p.offsetTop+p.offsetHeight];
const sc=document.querySelector('#cards');out.scoutLocalLeft=sc?sc.offsetLeft+sc.offsetParent.offsetLeft:null;
out.colBottom=(()=>{const c=p.querySelector('.bR');const z=c.lastElementChild,a=c.firstElementChild;return[a.offsetTop,z.offsetTop+z.offsetHeight]})();
out.text=p.innerText;
return out})()
