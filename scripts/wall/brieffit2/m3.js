new Promise(res=>{window.__BRIEF_FORCE={};const out={samples:[]};
const B=[
["10 security problems need your attention","Jared's Google account needs to be reconnected for Meet invites","Talk TURN relay is failing","Tire warning on the Model 3"],
["9 MB backup of the Hestia database did not finish uploading to Bestly Cloud overnight","LAX tower radio feed dropped twice in the last hour and needs a restart soon","Gate camera offline","Mac mini disk is 91% full"],
["Backup of 12 GB archive to Bestly Cloud failed because the storage quota was exceeded again overnight","Supercalifragilisticexpialidocious-certificate-renewal-pending","3 Turo trips tomorrow still need a pickup photo from guests before 8 AM","Hestia Pi temperature 162 °F"],
["10 security problems need your attention","10 security problems need your attention","10 security problems need your attention","10 security problems need your attention"]];
const snap=(b)=>{const lis=[...document.querySelectorAll('#cScout #w2Sl li > span')];const pg=document.querySelector('.pager');const ul=lis[0]&&lis[0].closest('ul');
const cw=document.getElementById('cvWx');const cs=getComputedStyle(cw);
return{batch:b,scene:window.__bf2.cur(),corner:+cs.opacity,
rows:lis.map(s=>{const lh=parseFloat(getComputedStyle(s).lineHeight)||25;return{t:s.textContent,over:s.scrollWidth>s.clientWidth+1,lines:Math.round(s.offsetHeight/lh),cut:!!s._cut,ell:/(\.\.\.|…)\s*$/.test(s.textContent),fs:s.style.fontSize}}),
ulBottom:ul&&Math.round(ul.getBoundingClientRect().bottom),pagerTop:pg&&Math.round(pg.getBoundingClientRect().top),brief:window.__brief&&{on:window.__brief.on,over:window.__brief.over}}};
let b=0;
const put=i=>{const ul=document.querySelector('#cScout #w2Sl ul');ul.innerHTML=B[i].map(t=>'<li><i style="background:#ff0"></i><span>'+t.replace(/&/g,'&amp;')+'</span><b>You</b></li>').join('');};
setTimeout(()=>{put(0);const iv=setInterval(()=>{out.samples.push(snap(b));
 if(out.samples.length%3===0){b++; if(b>=B.length){clearInterval(iv);out.errs=window.__errs;out.cerr=window.__cerr;res(out);return;} put(b);} },1300);},14000)})
