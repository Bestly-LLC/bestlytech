// Turns the email's HTML into what the preview iframe shows: forced light or dark (the email carries its own
// prefers-color-scheme block, so the preview rewrites that query), and, when editing, a small script that makes the
// text tap-to-edit and reports taps to the page. Sent and downloaded HTML never goes through here.

export interface PreviewOpts { dark: boolean; editable: boolean; scrollY?: number }

const EDIT_STYLE = `<style>
[data-bid]{cursor:text;border-radius:6px;transition:box-shadow .15s ease,background-color .15s ease}
[data-bid]:hover{box-shadow:0 0 0 4px rgba(10,132,255,.18);background-color:rgba(10,132,255,.06)}
a[data-bid]{cursor:pointer}
.eb-edit{outline:none;box-shadow:0 0 0 4px rgba(10,132,255,.45)!important;background-color:rgba(10,132,255,.08)!important;white-space:pre-wrap;text-transform:none!important;letter-spacing:normal!important}
html{scroll-behavior:auto}
</style>`;

const EDIT_SCRIPT = (y: number) => `<script>(function(){
var P=function(m){m.src='email-builder';parent.postMessage(m,'*')};
var last=0;addEventListener('scroll',function(){var n=Date.now();if(n-last>120){last=n;P({t:'scroll',y:scrollY})}},{passive:true});
addEventListener('load',function(){if(${y}>0)scrollTo(0,${y})});
function caretEnd(el){var r=document.createRange();r.selectNodeContents(el);r.collapse(false);var s=getSelection();s.removeAllRanges();s.addRange(r)}
function begin(el){
  var raw=el.getAttribute('data-raw')||'';el.textContent=raw;
  try{el.contentEditable='plaintext-only'}catch(e){el.contentEditable='true'}
  el.classList.add('eb-edit');el.focus();caretEnd(el);
  var done=false,single=el.tagName==='H1'||el.tagName==='LI'||el.getAttribute('data-field')==='text'&&el.className.indexOf('eb')===0;
  function finish(save){if(done)return;done=true;el.contentEditable='false';el.classList.remove('eb-edit');
    var v=(el.innerText||el.textContent||'').replace(/\\u00a0/g,' ');
    if(save&&v.trim()!==raw.trim())P({t:'edit',bid:el.getAttribute('data-bid'),field:el.getAttribute('data-field'),text:v.trim()});
    else P({t:'cancel'});}
  el.addEventListener('blur',function(){finish(true)});
  el.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();el.textContent=raw;finish(false)}
    else if(e.key==='Enter'&&(single||e.metaKey||e.ctrlKey)){e.preventDefault();finish(true);el.blur()}
  });
}
document.addEventListener('click',function(e){
  var a=e.target.closest&&e.target.closest('a');if(a)e.preventDefault();
  var t=e.target.closest&&e.target.closest('[data-bid]');if(!t)return;
  if(t.getAttribute('data-kind')==='button'){P({t:'button',bid:t.getAttribute('data-bid')});return}
  if(t.isContentEditable)return;e.preventDefault();begin(t);
},true);
})();</script>`;

export function previewHtml(html: string, o: PreviewOpts): string {
  let h = html.split("@media (prefers-color-scheme: dark)").join(o.dark ? "@media all" : "@media not all");
  h = h.replace("<head>", `<head><base target="_blank">`);
  if (o.editable) h = h.replace("</head>", EDIT_STYLE + "</head>").replace("</body>", EDIT_SCRIPT(o.scrollY ?? 0) + "</body>");
  return h;
}
