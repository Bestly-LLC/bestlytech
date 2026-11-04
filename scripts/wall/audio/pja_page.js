  /* AUDIO_20261103 (projector audio path, Q38/Q42): invisible listener, draws nothing. Polls the Pi (GET /api/sound/next) once a second; the Pi has already
     enforced every gate (private-time, quiet hours, wall asleep, rate limit), so a claimed sound simply plays through the page's own sound engine
     (SND.master), which the Mac tab capture / the Fully page sends out of the projector speaker. Self-heals: a stalled poll loop restarts itself, and
     a page that has not heard the Pi for 3 minutes (while the Pi answers /api/health) reloads once per 30 minutes. */
  const PJA={cid:Math.random().toString(36).slice(2,8),last:0,busy:false,okAt:Date.now(),bufs:{},reloaded:0};
  function pjaAck(seq,st,d){ try{ fetch('/api/sound/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seq:seq,cid:PJA.cid,state:st,detail:d||''})}).catch(()=>{}); }catch(e){} }
  async function pjaLoad(url){ if(PJA.bufs[url]) return PJA.bufs[url]; const r=await fetch(url,{cache:'force-cache'}); if(!r.ok) throw new Error('http '+r.status);
    const ab=await r.arrayBuffer(); const b=await new Promise((ok,no)=>{ const p=SND.ctx.decodeAudioData(ab,ok,no); if(p&&p.catch) p.catch(no); }); PJA.bufs[url]=b; return b; }
  async function pjaTick(){ if(PJA.busy&&Date.now()-PJA.busy<8000) return; PJA.busy=Date.now();
    try{ const r=await fetch('/api/sound/next?cid='+PJA.cid+'&after='+PJA.last+'&ctx='+encodeURIComponent(sndState()),{cache:'no-store'});
      const j=await r.json(); PJA.okAt=Date.now();
      if(j&&j.seq&&j.sound){ PJA.last=j.seq;
        if(!SND.ctx||!sndRunning()){ try{ audioInit(); }catch(e){} fetch('/api/tap',{method:'POST'}).catch(()=>{}); pjaAck(j.seq,'locked','sound engine not running'); }
        else { const b=await pjaLoad(j.url), s=SND.ctx.createBufferSource(), g=SND.ctx.createGain(); s.buffer=b; g.gain.value=j.gain||1.6; s.connect(g); g.connect(SND.master);
          s.start(); pjaAck(j.seq,'played',j.sound+' '+Math.round(b.duration*100)/100+'s ctx '+SND.ctx.state); } }
    }catch(e){ }
    PJA.busy=0; }
  setInterval(()=>{ try{ pjaTick(); }catch(e){} },1000);
  setInterval(()=>{ try{ if(Date.now()-PJA.okAt>180000){ let t=0; try{ t=+sessionStorage.getItem('pjaReload')||0; }catch(e){}
      if(Date.now()-t>1800000){ fetch('/api/health',{cache:'no-store'}).then(r=>{ if(r.ok){ try{ sessionStorage.setItem('pjaReload',String(Date.now())); }catch(e){} location.reload(); } }).catch(()=>{}); } } }catch(e){} },30000);
