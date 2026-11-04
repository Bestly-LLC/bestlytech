new Promise(res=>{window.__BRIEF_FORCE={};const out={samples:[],steps:[]};
const R=e=>{const r=e.getBoundingClientRect();return[Math.round(r.left),Math.round(r.top),Math.round(r.right),Math.round(r.bottom)]};
const snap=()=>{const lis=[...document.querySelectorAll('#cScout #w2Sl li > span')];const pg=document.querySelector('.pager');const ul=lis[0]&&lis[0].closest('ul');
const cw=document.getElementById('cvWx'),co=document.getElementById('corner');const cs=getComputedStyle(cw),cc=getComputedStyle(co);
return{scene:window.__bf2&&window.__bf2.cur(),corner:{op:+cc.opacity,wx:+cs.opacity,vis:cs.visibility,txt:cw.innerText.replace(/\s+/g,' ').slice(0,40)},
rows:lis.map(s=>{const lh=parseFloat(getComputedStyle(s).lineHeight)||25;return{t:s.textContent,over:s.scrollWidth>s.clientWidth+1,lines:Math.round(s.offsetHeight/lh),cut:!!s._cut,ell:/(\.\.\.|…)\s*$/.test(s.textContent),fs:s.style.fontSize}}),
ulBottom:ul&&Math.round(ul.getBoundingClientRect().bottom),pagerTop:pg&&Math.round(pg.getBoundingClientRect().top),brief:window.__brief&&{on:window.__brief.on,over:window.__brief.over}}};
let n=0;const iv=setInterval(()=>{if(n%8===0)window.__SL=Math.floor(n/8)%3;out.samples.push(snap());n++;
 if(n===6||n===12||n===18){const b=window.__bf2;const before=b.cur();b.step();setTimeout(()=>{out.steps.push({before,after:b.cur(),pi:b.pi()})},700);}
 if(n>=24){clearInterval(iv);out.errs=window.__errs;out.cerr=window.__cerr;res(out)}},1300)})
