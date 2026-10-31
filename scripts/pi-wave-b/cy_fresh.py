"""cy_fresh - weekly fresh corner graphics + name cards for Centering YOU (Spark-built, free: no Claude / paid AI).

  run.sh cy_fresh make  [--week 2026-W43] [--client centering-you] [--n 4] [--dry]
  run.sh cy_fresh watch [--week W] [--client C] [--selftest [--simulate-make-fail]] [--dry]

make:  draws N new parameter sets per component from the design space (seeded by client + ISO week, so a rerun is
       identical), rejects stale ones against the ledger, renders them, builds ONE preview sheet for Jared (staff side),
       records them in studio_design_ledger. The database refuses a stale design too.
watch: Scout's watchdog. Checks the week has a fresh batch and that every new video carried one. If the generator did not
       run it re-runs make ONCE; if still broken it alerts (signed Scout, monitor_issues/monitor_events). Resolves on recovery.
"""
import hashlib, json, os, sys, time, urllib.request

FRESH = '/opt/bestly/cy-kit/fresh'
sys.path.insert(0, FRESH)
import designs  # noqa: E402
import freshgate as fg  # noqa: E402

ALERT_KEY = 'scout.cy-fresh'

def _args(argv):
    a = {'client': 'centering-you', 'week': None, 'n': None, 'dry': '--dry' in argv, 'selftest': '--selftest' in argv,
         'sim_fail': '--simulate-make-fail' in argv}
    for i, x in enumerate(argv):
        if x in ('--client', '--week', '--n') and i + 1 < len(argv): a[x[2:]] = argv[i + 1]
    if a['selftest'] and a['client'] == 'centering-you': a['client'] = 'cy-selftest'
    return a

def _history(client, week):
    rows = fg.get('studio_design_ledger', f'client_slug=eq.{client}&status=neq.retired&select=component,fingerprint,family,palette,iso_week') or []
    return [(r['component'], r['fingerprint'], r['family'], r['palette'], designs.week_index(r['iso_week'])) for r in rows if r['iso_week'] != week]

def _upload(path, data, ctype='image/png'):
    req = urllib.request.Request(fg.URL + '/storage/v1/object/review/' + path, data=data, method='POST',
                                 headers={'apikey': fg.KEY, 'Authorization': 'Bearer ' + fg.KEY, 'Content-Type': ctype, 'x-upsert': 'true'})
    with urllib.request.urlopen(req, timeout=60) as r: r.read()
    return fg.URL + '/storage/v1/object/public/review/' + path

def make(argv):
    a = _args(argv); client = a['client']
    week = a['week'] or fg.rpc('studio_design_iso_week')
    if a['sim_fail']: raise RuntimeError('simulated generator failure (selftest)')
    cool = fg.rpc('studio_design_setting', p_client=client, p_key='cooldown_weeks', p_default=6)
    fam_cool = fg.rpc('studio_design_setting', p_client=client, p_key='family_cooldown_weeks', p_default=2)
    n = int(a['n'] or fg.rpc('studio_design_setting', p_client=client, p_key='picks_per_week', p_default=4))
    batch = designs.pick_batch(week, client, n, history=_history(client, week), cooldown=cool, family_cooldown=fam_cool)
    out = os.path.join(FRESH, 'out', client, week); os.makedirs(out, exist_ok=True)
    # render + measure every design before it is recorded: top edge, side edge, nothing below y 353, deck inside the picture
    for p in batch['corner_graphic']:
        img, x, y, meta = designs.render_corner(p, p['side']); x0, y0, x1, y1 = designs.corner_extent(img, x, y)
        assert y0 == 0 and y1 <= 353, f'corner {p["fingerprint"]} breaks the top rail ({y0}..{y1})'
        assert (x0 == 0) if p['side'] == 'L' else (x1 == designs.W), f'corner {p["fingerprint"]} not flush to its side'
        db = meta['deck_box']; assert db[0] >= 0 and db[2] <= img.width and db[3] + y <= 346, 'deck not fully inside the corner'
        img.save(os.path.join(out, f'corner-{p["fingerprint"]}-{p["side"]}.png'))
    for p in batch['name_tag']:
        img, meta = designs.render_tag(p)
        assert meta['h'] <= 150 and meta['w'] <= 880, 'name card out of bounds'
        img.save(os.path.join(out, f'tag-{p["fingerprint"]}.png'))
    sheet = designs.preview_sheet(week, client, batch, os.path.join(out, 'sheet.png'))
    json.dump(batch, open(os.path.join(out, 'batch.json'), 'w'), indent=1)
    summary = f'week {week}: {len(batch["corner_graphic"])} corner graphics + {len(batch["name_tag"])} name cards drawn, all fresh (cooldown {cool} weeks, family cooldown {fam_cool} weeks)'
    if a['dry']: return 'ok (dry, nothing recorded) ' + summary
    data = open(sheet, 'rb').read(); sha = hashlib.sha256(data).hexdigest()[:10]
    spath = f'design-preview/{client}/{week}/sheet.{sha}.png'
    url = 'selftest-no-upload' if a['selftest'] else _upload(spath, data)
    for comp in ('corner_graphic', 'name_tag'):
        for p in batch[comp]:
            fg.rpc('studio_design_record', p_client=client, p_component=comp, p_fingerprint=p['fingerprint'], p_family=p['family'],
                   p_palette=p['palette'], p_params={k: v for k, v in p.items() if k != 'fingerprint'}, p_week=week, p_preview_path=spath)
    wk = fg.rpc('studio_design_week_check', p_client=client, p_week=week)
    if not wk.get('ok'): raise RuntimeError('batch fails the 3-new-designs rule: ' + json.dumps(wk.get('problems')))
    fg._req('POST', '/rest/v1/studio_design_sheets?on_conflict=client_slug,iso_week', {'client_slug': client, 'iso_week': week, 'path': spath, 'designs': 2 * n})
    if not a['selftest']:
        fg.rpc('scout_notify', p_title=f'Scout: new Centering YOU corner graphics and name cards for {week} are ready to look at',
               p_body=f'{n} new corner graphics and {n} new name cards, none repeated for {cool} weeks. Staff preview only, nothing is on her board. Tap to open the sheet.',
               p_severity='info', p_push=False, p_url=url, p_dedupe=f'cy-fresh-sheet-{week}')
    return 'ok ' + summary + ' ; sheet ' + url

def watch(argv):
    a = _args(argv); client = a['client']; week = a['week']
    dry = a['dry'] or a['selftest']
    def look(): return fg.rpc('studio_design_watch', p_client=client, p_week=week)
    r = look()
    if r.get('ok'):
        fg.alert(ALERT_KEY, 'Centering YOU weekly designs are fresh', f'week {r["week"]}: generator ran, {r["planned"]} designs in the ledger, every new video carried one.',
                 problem=False, dry=dry, severity='info')
        return f'ok week {r["week"]} fresh ({r["planned"]} designs)'
    needs_gen = (not r.get('generator_ran')) or any(str(p).startswith('batch:') for p in r.get('problems', []))
    healed_note = ''
    if needs_gen:
        try:
            mk = ['--client', client] + (['--week', week] if week else []) + (['--selftest'] if a['selftest'] else []) + (['--simulate-make-fail'] if a['sim_fail'] else [])
            healed_note = make(mk)
        except Exception as e:  # one retry only
            healed_note = f'generator retry failed: {type(e).__name__}: {e}'
        r = look()
        if r.get('ok'):
            fg.alert(ALERT_KEY, 'Centering YOU weekly designs were missing, Scout re-ran the generator and fixed it',
                     healed_note[:400], problem=False, dry=dry, severity='info')
            return 'ok recovered: ' + healed_note[:200]
    why = '; '.join(r.get('problems', [])) or 'unknown'
    fg.alert(ALERT_KEY, 'Centering YOU weekly designs are not fresh', f'{why}. {healed_note[:300]}'.strip(), problem=True, dry=dry, severity='warning',
             needs='Check the Pi job cy_fresh (run.sh cy_fresh make) and the preview sheet; new renders fail closed until this is fixed.')
    return 'alerted: ' + why[:300]

def main(argv):
    cmd = argv[0] if argv else 'make'
    return {'make': make, 'watch': watch}[cmd](argv[1:])
