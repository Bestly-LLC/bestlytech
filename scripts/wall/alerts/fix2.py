p = '/Users/jaredbest/tmp/alerts/alerts_batch.py'
s = open(p).read()
def sub(a, b):
    global s
    assert s.count(a) == 1, (a[:60], s.count(a))
    s = s.replace(a, b)
sub('''        m = max(1, int(round(mins)))
        return "%s passing %s %s in %d%smin" % (name, miles_txt(dist), word, m, NB), m''',
    '''        m = max(1, int(round(mins)))
        if dist < 0.3:
            return "%s passing right over home in %d%smin" % (name, m, NB), m
        return "%s passing %s %s in %d%smin" % (name, miles_txt(dist), word, m, NB), m''')
sub('''    t = text.replace(NB, " ")
    t = re.sub(r"\\b(\\d+)\\b", lambda m: say_num(m.group(1)), t)''',
    '''    t = text.replace(NB, " ")
    t = re.sub(r"\\b(\\d+)\\.(\\d)\\b", lambda m: say_num(m.group(1)) + " point " + say_num(m.group(2)), t)
    t = re.sub(r"\\b(\\d+)\\b", lambda m: say_num(m.group(1)), t)''')
open(p, 'w').write(s)
print('ok')
