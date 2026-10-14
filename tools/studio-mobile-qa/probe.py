import sys, json, subprocess, struct, urllib.request, concurrent.futures as cf
B="https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/"
def rng(u,a,b):
    r=urllib.request.Request(u,headers={"Range":f"bytes={a}-{b}"})
    with urllib.request.urlopen(r,timeout=60) as x: return x.status, dict(x.headers), x.read()
def atoms(u,size):
    off=0; out=[]
    while off<size and len(out)<12:
        st,h,d=rng(u,off,off+15)
        sz,t=struct.unpack(">I4s",d[:8])
        if sz==1: sz=struct.unpack(">Q",d[8:16])[0]
        out.append((t.decode('latin1'),off)); 
        if sz==0: break
        off+=sz
    return out
def one(p):
    u=B+p; res={"p":p}
    try:
        st,h,d=rng(u,0,1023); res["status"]=st; res["ctype"]=h.get("Content-Type"); cr=h.get("Content-Range","")
        size=int(cr.split("/")[-1]) if "/" in cr else 0; res["size_mb"]=round(size/1e6,2); res["accept"]=h.get("Accept-Ranges"); res["cache"]=h.get("Cache-Control")
        a=atoms(u,size); names=[x[0] for x in a]; res["atoms"]=",".join(names)
        res["faststart"]= names.index("moov")<names.index("mdat") if "moov" in names and "mdat" in names else None
        j=json.loads(subprocess.run(["ffprobe","-v","error","-print_format","json","-show_streams","-show_format",u],capture_output=True,text=True,timeout=120).stdout)
        for s in j["streams"]:
            if s["codec_type"]=="video":
                res["v"]=f'{s["codec_name"]} {s.get("profile")} L{s.get("level")} {s.get("pix_fmt")} {s.get("width")}x{s.get("height")} {s.get("r_frame_rate")} range={s.get("color_range")} cs={s.get("color_space")} prim={s.get("color_primaries")} trc={s.get("color_transfer")} br={round(int(s.get("bit_rate",0))/1e6,2)}M'
            if s["codec_type"]=="audio": res["a"]=f'{s["codec_name"]} {s.get("sample_rate")}Hz ch={s.get("channels")}'
        res["dur"]=round(float(j["format"]["duration"]),1)
    except Exception as e: res["err"]=str(e)[:120]
    return res
ps=[l.strip() for l in open(sys.argv[1]) if l.strip()]
with cf.ThreadPoolExecutor(6) as ex: rs=list(ex.map(one,ps))
json.dump(rs,open(sys.argv[2],"w"),indent=1)
for r in rs: print(r["p"].split("/",1)[1][:60].ljust(60), r.get("status"),r.get("ctype"),r.get("size_mb"),"fs=",r.get("faststart"),"|",r.get("v"),"|",r.get("a"),r.get("dur"),r.get("err",""))
