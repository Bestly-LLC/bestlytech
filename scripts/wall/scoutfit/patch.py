import sys
p='/opt/bestly/wall/www/wall.html'
s=open(p).read()
A='/* BRIEFFIT2_20261104: Scout row fit rewritten above (wrap, short forms, drop last) */\n'
assert s.count(A)==1 and 'SCOUTFIT_20261104' not in s
N=A+'''/* SCOUTFIT_20261104: never clip a row vertically. After the fit pass, measure each row against the card's content box and hide whole rows that do not fully fit (fewer rows, never a partial one). */
(function(){ try{ const orig=window.polScFit; if(typeof orig!=='function') return;
  const yOf=e=>{ let y=0; while(e){ y+=e.offsetTop; e=e.offsetParent; } return y; };
  window.polScFit=function(){ orig.apply(this,arguments);
    try{ const card=document.getElementById('cScout'), ul=card&&card.querySelector('#w2Sl ul'); if(!ul||!card.offsetHeight) return;
      const lis=[...ul.children]; lis.forEach(l=>{ if(l._sfh){ l.style.display=''; l._sfh=0; } });
      const cs=getComputedStyle(card), lim=yOf(card)+card.offsetHeight-(parseFloat(cs.paddingBottom)||0)-(parseFloat(cs.borderBottomWidth)||0)-2;
      const bot=l=>yOf(l)+l.offsetHeight;
      let n=lis.length; while(n>1&&bot(lis[n-1])>lim){ n--; lis[n]._sfh=1; lis[n].style.display='none'; }
      for(let i=n;i<lis.length;i++){ lis[i]._sfh=1; lis[i].style.display='none'; }
      /* hide from the end until the last visible row fits */
      let k=lis.length; while(k>1){ const v=lis.filter(l=>!l._sfh); const last=v[v.length-1]; if(last&&bot(last)>lim){ last._sfh=1; last.style.display='none'; k--; } else break; }
      ul._sfn=lis.filter(l=>!l._sfh).length;
    }catch(e){} };
}catch(e){} })();
'''
assert N.count('\n')>0
open(p,'w').write(s.replace(A,N))
