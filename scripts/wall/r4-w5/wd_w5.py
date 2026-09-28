def w5_watch(mem, hb):
    """W5 round 4 (Claude 2026-09-28): live signatures + the Dyson purifier rule.
    Signatures: the page reports every 30 s (/api/w5beat). Signatures that fail to load (Pi can't read them for 10 min), or a page
    whose signature module switched itself off / shows nothing while there are signatures -> reload the page once (max every 2 h),
    then tell Scout. Purifier: Homebridge unreachable or Dyson readings older than 15 min -> restart Homebridge (max every 6 h), tell Scout."""
    w = hb.get("w5") or {}
    now = time.time()
    page_fresh = (hb.get("age_s") or 999) < 120
    beat, bage = w.get("beat") or {}, w.get("beat_age_s")
    sig = beat.get("sig") or {}
    why = None
    if w.get("signs_error"):
        mem["w5_signs_bad"] = mem.get("w5_signs_bad") or now
        if now - mem["w5_signs_bad"] >= 600:
            why = f"the Pi can't read signatures from bestly.tech ({str(w['signs_error'])[:120]})"
    else:
        mem.pop("w5_signs_bad", None)
    if not why and page_fresh:
        if bage is None or bage > 240:
            why = "the wall page stopped reporting its signature board"
        elif sig.get("on") is False:
            why = f"the signature board switched itself off after errors ({sig.get('err') or 'unknown'})"
        elif sig.get("wing") and (sig.get("n") or 0) > 0 and not sig.get("shown") and not sig.get("hero"):
            why = f"there are {sig.get('n')} signatures but the board shows none"
    if why:
        mem["w5_sig_bad"] = mem.get("w5_sig_bad") or now
        if now - mem["w5_sig_bad"] >= 300:
            if now - mem.get("w5_sig_reload", 0) > 7200 and "the Pi can't read" not in why:
                mem["w5_sig_reload"] = now
                launch_wall(fresh=False)
                log(f"signatures unhealthy ({why}), reloaded the page")
                report(mem, "wall.signatures", "problem", "warning", "Sign wall had a problem, so the Pi reloaded the page",
                       f"The sign wall reloaded itself because {why}. No action needed unless this keeps happening.")
            else:
                report(mem, "wall.signatures", "problem", "warning", "Sign wall signatures aren't showing",
                       f"{why[0].upper() + why[1:]}. Send this to Claude to look at.")
    else:
        mem.pop("w5_sig_bad", None)
        if page_fresh and bage is not None and bage < 120:
            report(mem, "wall.signatures", "resolved", "info", "Sign wall is healthy", f"{sig.get('shown') or 0} signatures on the board.")
    a = w.get("air") or {}
    if not a.get("configured"):
        return
    if a.get("found") is False:
        report(mem, "wall.purifier_setup", "problem", "info", "Dyson purifier isn't connected to Homebridge yet",
               "The Dyson plugin is installed but not signed in, so the wall can't read indoor air or turn the purifier on. "
               "One-time fix: Homebridge > Plugins > Dyson Pure Cool > Settings, sign in with your Dyson app email + password, "
               "type the code Dyson emails you, Save.")
        return
    report(mem, "wall.purifier_setup", "resolved", "info", "Dyson purifier is connected", "The wall can read the purifier.")
    age = a.get("age_s")
    if a.get("found") and (age is None or age > 900):
        mem["w5_air_bad"] = mem.get("w5_air_bad") or now
        if now - mem["w5_air_bad"] >= 900:
            healed = ""
            if now - mem.get("w5_hb_restart", 0) > 6 * 3600:
                mem["w5_hb_restart"] = now
                try:
                    subprocess.run(["docker", "restart", "homebridge"], capture_output=True, timeout=90)
                    healed = " The Pi restarted Homebridge to recover."
                    log("purifier stale, restarted homebridge")
                except Exception as e:
                    log(f"homebridge restart failed: {e}")
            report(mem, "wall.purifier", "problem", "warning", "Can't read the Dyson purifier",
                   f"No indoor-air reading for {'a while' if age is None else f'{age // 60} min'} ({a.get('error') or 'no error text'})."
                   f"{healed} The fresh-air rule is paused until it's back.")
    else:
        mem.pop("w5_air_bad", None)
        report(mem, "wall.purifier", "resolved", "info", "Dyson purifier readings are back", "Indoor air is being watched again.")
