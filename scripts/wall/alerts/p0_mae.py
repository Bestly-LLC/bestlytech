import sys, shutil, time
P = '/opt/bestly/wall/www/wall.html'
s = open(P, encoding='utf-8').read()
bak = P + '.bak_alerts_' + time.strftime('%Y%m%d-%H%M%S')
shutil.copy(P, bak)
def sub(old, new):
    global s
    assert s.count(old) == 1, (old[:60], s.count(old))
    s = s.replace(old, new)
# bus card: drop the signature span, collapse the footer when there is no alert text
sub('<div class="w1-ft"><span class="w1-dt"></span><span class="w1-sg">Mae</span></div>',
    '<div class="w1-ft"><span class="w1-dt"></span></div>')
sub("#wingBus .w1-sg{flex:none;margin-left:auto;font:700 22px/1 var(--sf);letter-spacing:.03em;color:#fff}`;",
    "#wingBus .w1-sg{flex:none;margin-left:auto;font:700 22px/1 var(--sf);letter-spacing:.03em;color:#fff}\n"
    "#wingBus .w1-ft:not(:has(.w1-dt:not(:empty))){display:none} /* ALERTS_20261103: no signature text, no empty gap */`;")
# cars card: drop the signature span
sub('<span>Blake charger · ${esc(free)}</span><span class="sg">Mae</span>`;',
    '<span>Blake charger · ${esc(free)}</span>`; /* ALERTS_20261103 */')
open(P, 'w', encoding='utf-8').write(s)
print('ok', bak)
