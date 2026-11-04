import json,sys
t=open(sys.argv[1]).read(); j=json.loads(t[t.index('{\n'):])
seen=set()
for s in j['samples']:
    key=json.dumps([[r['t'],r['over'],r['lines'],r['cut'],r['ell'],r['fs']] for r in s['rows']])
    if key in seen: continue
    seen.add(key); print('ulBottom',s['ulBottom'],'pager',s['pagerTop'],'corner',s['corner'],s['scene'])
    for r in s['rows']: print('   ',r)
print('corner wx min over samples',min(s['corner'] for s in j['samples'] if s['brief']['on']),'briefOn',sum(1 for s in j['samples'] if s['brief']['on']))
print('steps',j['steps'],'errs',j['errs'],'cerr',j['cerr'])
