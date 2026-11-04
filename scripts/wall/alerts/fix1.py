p = '/Users/jaredbest/tmp/alerts/alerts_batch.py'
L = open(p).read().split('\n')
i = [n for n, l in enumerate(L) if l.startswith('        over[hx] = {"t": phrase[len(')]
assert len(i) == 1
n = i[0]
L[n:n + 2] = ['        over[hx] = {"line": phrase + " \\u00b7 " + miles_txt(dist), "d": round(dist, 1), "at": now}']
s = '\n'.join(L)
a = '''                st = jload(STATE_FILE, {})
                if wall_off_step(st, c):
                    jsave(STATE_FILE, st)
                else:
                    jsave(STATE_FILE, st) if st.get("_dirty") else None
'''
assert s.count(a) == 1
s = s.replace(a, '''                st = jload(STATE_FILE, {})
                before = json.dumps(st, sort_keys=True)
                wall_off_step(st, c)
                if json.dumps(st, sort_keys=True) != before:
                    jsave(STATE_FILE, st)
''')
open(p, 'w').write(s)
print('ok')
