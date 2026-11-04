new Promise(res=>{window.__BRIEF_FORCE={};const out=[];let n=0;
const f=()=>{const lis=[...document.querySelectorAll('#cScout #w2Sl li > span')];const pg=document.querySelector('.pager');const ul=lis[0]&&lis[0].closest('ul');
let y=0,e=ul;while(e&&e!==pg.offsetParent){y+=e.offsetTop;e=e.offsetParent;}
return {on:document.getElementById('cScout').classList.contains('on'),ulB:y+ul.offsetHeight,pgT:pg.offsetTop,rows:lis.map(s=>[s.textContent.slice(0,22),s.clientWidth,Math.round(s.offsetHeight),s.className,s.style.fontSize])}};
const iv=setInterval(()=>{out.push(f());if(++n>=130){clearInterval(iv);const seen=new Set();res(out.filter(o=>{const k=JSON.stringify([o.on,o.ulB,o.rows]);if(seen.has(k))return false;seen.add(k);return true}))}},700)})
