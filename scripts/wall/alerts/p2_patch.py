import re, shutil, time
src = open('/tmp/p1_patch.py', encoding='utf-8').read()
# reuse p1's watchdog block verbatim, redo the wall.html block with count==2 for the card line
head = src.split('# ---- server.py')[0]
wd = src.split('# ---- watchdog.py')[1]
exec(head)
R = '/opt/bestly/wall/'
T = time.strftime('%Y%m%d-%H%M%S')
P = R + 'www/wall.html'
s = open(P, encoding='utf-8').read()
shutil.copy(P, P + '.bak_alerts_' + T)
a1 = "  const logoOk=APX.logo[ic]==='ok', lgOn="
assert s.count(a1) == 1
s = s.replace(a1, "  if(!em&&!ph&&o.a&&o.a.over) l2='Over '+o.a.over;   /* ALERTS_20261103 */\n" + a1)
a2 = "a.area?'Over '+a.area:''"
assert s.count(a2) == 2
s = s.replace(a2, "a.over?'Over '+a.over:(a.area?'Over '+a.area:'')")
open(P, 'w', encoding='utf-8').write(s)
print('patched wall.html', T)
exec(wd)
