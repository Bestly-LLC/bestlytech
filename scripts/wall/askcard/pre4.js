window.__E=[];addEventListener('error',e=>__E.push(String(e.message)+' @'+e.lineno));addEventListener('unhandledrejection',e=>__E.push('rej '+String(e.reason)));
window.__NR=1;
(()=>{ const f=window.fetch; window.__S3L=null;
  window.fetch=async function(u,o){ const r=await f.apply(this,arguments); try{ if(window.__S3L&&String(u).indexOf('/api/aircraft/live')>=0){ const j=await r.clone().json(); (j.aircraft||[]).forEach(a=>{ a.label=window.__S3L[0]; a.operator=window.__S3L[1]; a.tier='ga'; a.type_name=window.__S3L[2]||'Cessna 172 Skyhawk'; a.photo=null; if(window.__NR){ delete a.route; a.route=null; } if(window.__S3NT) a.notable=['police']; if(window.__S3RT) a.route={from:'BUR',to:'SJC',from_city:'Burbank',to_city:'San Jose'}; });
      return new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}}); } }catch(e){} return r; }; })();
