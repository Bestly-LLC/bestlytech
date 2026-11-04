src = open('/tmp/p1_patch.py', encoding='utf-8').read()
head = src.split('# ---- server.py')[0]
wd = src.split('# ---- watchdog.py')[1].split('\n', 1)[1]
exec(head)
exec(wd)
