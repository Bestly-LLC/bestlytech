window.__errs=[];addEventListener('error',e=>window.__errs.push(String(e.message)));addEventListener('unhandledrejection',e=>window.__errs.push('rej '+e.reason));
window.__cerr=[];const _ce=console.error;console.error=function(){window.__cerr.push([].slice.call(arguments).map(String).join(' ').slice(0,200));return _ce.apply(console,arguments)};
/* test only: long Scout titles so every fit step is exercised */
(()=>{const f=window.fetch;window.fetch=async function(u,o){const r=await f.apply(this,arguments);try{if(/\/api\/data(\?|$)/.test(String(u))&&window.__TESTITEMS!==false){const j=await r.clone().json();const ALL=[
{title:'10 security problems need your attention',severity:'error',needs_you:true},
{title:"Jared's Google account needs to be reconnected for Meet invites",severity:'warning',needs_you:true},
{title:'Talk TURN relay is failing',severity:'warning',needs_you:false},
{title:'Tire warning on the Model 3',severity:'info',needs_you:true},
{title:'9 MB backup of the Hestia database did not finish uploading to Bestly Cloud overnight',severity:'warning',needs_you:false},
{title:'LAX tower radio feed dropped twice in the last hour and needs a restart soon',severity:'info',needs_you:true},
{title:'Gate camera offline',severity:'error',needs_you:true},
{title:'Mac mini disk is 91% full',severity:'warning',needs_you:false},{title:'Backup of 12 GB archive to Bestly Cloud failed because the storage quota was exceeded again overnight',severity:'error',needs_you:true},{title:'Supercalifragilisticexpialidocious-certificate-renewal-pending',severity:'warning',needs_you:true},{title:'3 Turo trips tomorrow still need a pickup photo from guests before 8 AM',severity:'info',needs_you:true},{title:'Hestia Pi temperature 162 °F',severity:'warning',needs_you:false}];const sl=(window.__SL||0)*4;j.scout_items=ALL.slice(sl,sl+4);j.scout_open=51;
return new Response(JSON.stringify(j),{status:200,headers:{'Content-Type':'application/json'}});}}catch(e){}return r;};})();
