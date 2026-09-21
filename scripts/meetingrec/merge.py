import sys, difflib
rows=[]
for f,lab in ((sys.argv[1],'THEM'),(sys.argv[2],'JARED')):
    try:
        for line in open(f):
            p=line.rstrip('\n').split('\t')
            if len(p)>=3 and p[2].strip(): rows.append((float(p[0]),lab,p[2].strip()))
    except FileNotFoundError: pass
rows.sort(key=lambda r:r[0])
out=[]
for t,lab,txt in rows:
    # drop speaker-bleed: same text as a THEM line within 3s
    if lab=='JARED' and any(o[1]=='THEM' and abs(o[0]-t)<3.0 and
        difflib.SequenceMatcher(None,o[2].lower(),txt.lower()).ratio()>0.75 for o in rows):
        continue
    out.append(f"[{int(t//60):02d}:{int(t%60):02d}] {lab}: {txt}")
print("\n".join(out))
