import time, shutil
P = '/opt/bestly/wall/www/wall.html'
s = open(P).read()
blk = open('/tmp/brief_live.html').read()
assert 'BRIEF_20261103' not in s and 'id="briefP"' not in s and 'briefCss' not in s
bak = P + '.bak_brief_' + time.strftime('%H%M%S')
shutil.copy2(P, bak); print('backup', bak)
def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:60])
    s = s.replace(old, new)
rep('</body>', blk + '</body>')
rep("strip2:(window.W2B&&W2B.hb&&W2B.hb())||null,", "strip2:(window.W2B&&W2B.hb&&W2B.hb())||null,brief:(window.__brief?{on:window.__brief.on,errs:window.__brief.errs,err:window.__brief.err}:null),")
open(P, 'w').write(s); print('ok', len(s))
