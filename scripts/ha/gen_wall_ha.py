#!/usr/bin/env python3
"""Generate the Home Assistant side of the wall controls from the shared manifest
(bestlytech repo src/config/wall-controls.json). Same list the admin follows.

Outputs (in the current folder):
  bestly_wall_controls.yaml  -> HA package (rest sensor, rest_commands, template switches/selects/
                                numbers/buttons, helpers, write script)
  wall_views.json            -> {"wall": <main Wall view>, "wall_setup": <advanced subview>}
usage: python3 gen_wall_ha.py wall-controls.json
"""
import json, sys

M = json.load(open(sys.argv[1] if len(sys.argv) > 1 else "wall-controls.json"))
GROUPS = {g["id"]: g for g in M["groups"]}
C = M["controls"]
BY_ID = {c["id"]: c for c in C}
BY_PATH = {c["path"]: c for c in C if c.get("path")}
STATE = "sensor.wall_state"
J = json.dumps


def lit(v):
    """Python value -> Jinja literal."""
    if v is None:
        return "none"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, str):
        return J(v)
    if isinstance(v, list):
        return "[" + ", ".join(lit(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(J(k) + ": " + lit(x) for k, x in v.items()) + "}"
    raise TypeError(v)


def read(path, default):
    """Jinja that leaves the current value (default applied) in variable v."""
    parts = path.split(".")
    if len(parts) == 1:
        s = "{%% set v = state_attr(%s, %s) %%}" % (J(STATE), J(parts[0]))
    else:
        s = ("{%% set p = state_attr(%s, %s) %%}{%% set v = p.get(%s) if p is mapping else none %%}"
             % (J(STATE), J(parts[0]), J(parts[1])))
    return s + "{%% set v = v if v is not none else %s %%}" % lit(default)


def ent(c):
    k = c["kind"]
    if c.get("local"):
        return ("input_select." if k == "select" else "input_boolean.") + "wall_" + c["id"]
    if k == "text":
        return ("select." if c["id"] == "alarm_time" else "input_text.") + "wall_" + c["id"]
    return {"switch": "switch.", "select": "select.", "number": "number.", "button": "button."}[k] + "wall_" + c["id"]


def setter(patch_jinja_or_dict, inputs=None):
    d = {"patch": patch_jinja_or_dict}
    if inputs:
        d["inputs"] = inputs
    return [{"action": "script.bestly_wall_set", "data": d}]


# Per-control icons (SF-Symbol-like MDI picks) so rows read at a glance instead of repeating the group icon.
ICON = {
    "power_on": "mdi:power", "power_off": "mdi:power-off", "away": "mdi:bag-suitcase",
    "presence": "mdi:home-export-outline", "mode": "mdi:view-dashboard-outline", "left_date": "mdi:calendar-today",
    "dnd_on": "mdi:calendar-clock", "dnd_from": "mdi:weather-night", "dnd_to": "mdi:weather-sunset-up",
    "dnd_quiet_hour": "mdi:bell-off-outline", "dnd_quiet_morning": "mdi:bell-sleep-outline",
    "dnd_allow_hour": "mdi:bell-ring-outline", "dnd_allow_morning": "mdi:bell-ring-outline",
    "dnd_allow_tonight": "mdi:bell-ring-outline", "dnd_schedule": "mdi:calendar-refresh",
    "voice_on": "mdi:microphone", "voice_sensitivity": "mdi:ear-hearing",
    "widget_news": "mdi:newspaper-variant-outline", "widget_turo_usd": "mdi:car-key", "widget_air": "mdi:air-filter",
    "widget_energy": "mdi:lightning-bolt-outline", "widget_mail": "mdi:email-outline", "widget_habits": "mdi:run",
    "widget_leo": "mdi:zodiac-leo", "widget_appstore": "mdi:apple", "widget_devices": "mdi:devices",
    "show_play": "mdi:play-circle-outline", "show_party": "mdi:party-popper", "show_skit": "mdi:drama-masks",
    "show_stop": "mdi:stop-circle-outline", "show_hshow": "mdi:halloween", "show_hparty": "mdi:ghost-outline",
    "motivate": "mdi:arm-flex-outline", "sleep_start": "mdi:sheep", "sleep_stop": "mdi:stop-circle-outline",
    "alarm_on": "mdi:alarm", "alarm_time": "mdi:clock-outline", "alarm_days": "mdi:calendar-repeat",
    "alarm_stop": "mdi:alarm-off", "alarm_preview": "mdi:play-outline", "heads_dismiss": "mdi:close-circle-outline",
    "live_plane": "mdi:airplane", "live_sweep": "mdi:car-wash", "live_turo": "mdi:car-key",
    "live_show": "mdi:party-popper", "live_sleep": "mdi:sheep", "live_incident": "mdi:alert-outline",
    "theme": "mdi:palette-outline", "volume": "mdi:volume-high", "sound": "mdi:music-note-outline",
    "sound_pack": "mdi:piano", "radio_on": "mdi:radio", "airplay": "mdi:apple-airplay", "airplay_restart": "mdi:restart",
    "sign_show": "mdi:draw", "air_show": "mdi:airplane", "air_radius": "mdi:radius-outline",
    "atc": "mdi:radio-tower", "sky_home": "mdi:home-map-marker", "sky_landmarks": "mdi:city-variant-outline",
    "sky_roads": "mdi:road-variant", "sky_traffic": "mdi:traffic-light-outline", "iss_tag": "mdi:space-station",
    "air_card": "mdi:card-text-outline", "air_card_pin": "mdi:pin-outline", "air_card_heli": "mdi:helicopter",
    "air_labels": "mdi:tag-outline", "air_labels_small": "mdi:tag-multiple-outline",
    "sky_stars": "mdi:star-outline", "sky_star_labels": "mdi:star-four-points-outline", "sky_grid": "mdi:grid",
    "sky_moon": "mdi:moon-waning-crescent", "sky_sun": "mdi:white-balance-sunny", "sky_planets": "mdi:orbit",
    "air_key": "mdi:map-legend", "focus": "mdi:image-filter-center-focus", "relaunch": "mdi:restart",
    "focus_left": "mdi:chevron-left-circle-outline", "focus_right": "mdi:chevron-right-circle-outline",
    "auto_keystone": "mdi:crop-free", "air_bearing": "mdi:compass-outline", "test_sweep": "mdi:car-wash",
    "test_scout": "mdi:binoculars", "sign_near": "mdi:account-arrow-right-outline", "sound_test": "mdi:speaker-play",
    "fx_wake_sleep": "mdi:theme-light-dark", "cal_grid": "mdi:grid-large", "mapping": "mdi:vector-square",
    "neon_on": "mdi:led-strip-variant", "neon_look": "mdi:auto-fix", "neon_color": "mdi:palette-outline",
    "neon_notify": "mdi:bell-badge-outline", "neon_shield": "mdi:shield-outline",
    "neon_play_sign": "mdi:draw", "neon_play_turo": "mdi:car-key", "neon_play_motivate": "mdi:arm-flex-outline",
    "neon_play_scout": "mdi:binoculars", "neon_outline": "mdi:vector-square",
}
# Short labels where the admin's label is too long for a phone row.
SHORT = {"volume": "Volume", "air_labels_small": "Tags on small aircraft", "air_card_heli": "Helicopters in card",
         "left_date": "Today's date on the left", "presence": "Off when I leave", "dnd_on": "On a schedule"}
ACTION = {"show_stop": "Stop", "sleep_stop": "Stop", "alarm_stop": "Stop", "alarm_preview": "Play", "heads_dismiss": "Dismiss",
          "sleep_start": "Start", "show_play": "Play", "show_party": "Play", "show_skit": "Play", "show_hshow": "Play",
          "show_hparty": "Play", "motivate": "Play", "airplay_restart": "Restart", "relaunch": "Restart", "focus": "Focus",
          "focus_left": "Nudge", "focus_right": "Nudge", "sign_near": "Test", "sound_test": "Test", "fx_wake_sleep": "Test",
          "neon_play_sign": "Play", "neon_play_turo": "Play", "neon_play_motivate": "Play", "neon_play_scout": "Play",
          "dnd_schedule": "Reset"}

# ---- local helpers (sleep length / lullaby) feed $input: tokens ----
input_select, input_boolean, input_text = {}, {}, {}
INPUT_JINJA = {}
for c in C:
    if not c.get("local"):
        continue
    if c["kind"] == "select":
        labels = [o["label"] for o in c["options"]]
        dl = next(o["label"] for o in c["options"] if o["value"] == c.get("default"))
        input_select["wall_" + c["id"]] = {"name": "Wall: " + c["label"], "options": labels, "initial": dl,
                                           "icon": GROUPS[c["group"]]["icon"]}
        mp = J(c["options"]).replace("'", "\\'")
        INPUT_JINJA[c["id"]] = ("{%% set m = '%s' | from_json %%}{{ m | selectattr('label', 'eq', states('input_select.wall_%s')) "
                                "| map(attribute='value') | list | first }}" % (mp, c["id"]))
    else:
        input_boolean["wall_" + c["id"]] = {"name": "Wall: " + c["label"], "initial": bool(c.get("default")),
                                            "icon": GROUPS[c["group"]]["icon"]}
        INPUT_JINJA[c["id"]] = "{{ is_state('input_boolean.wall_%s', 'on') }}" % c["id"]

# ---- template entities ----
switches, selects, numbers, buttons = [], [], [], []
AVAIL = "{{ has_value('%s') }}" % STATE


def base(c, domain):
    return {"name": c["label"], "unique_id": "bestly_wall_" + c["id"], "default_entity_id": f"{domain}.wall_{c['id']}",
            "icon": ICON.get(c["id"], GROUPS[c["group"]]["icon"]), "availability": AVAIL}


for c in C:
    k, cid = c["kind"], c["id"]
    if c.get("local"):
        continue
    if k == "switch":
        on = {c["path"]: True, **c.get("also_set", {}), **c.get("also_set_when_on", {})}
        off = {c["path"]: False, **c.get("also_set", {})}
        e = base(c, "switch")
        e["state"] = read(c["path"], c.get("default")) + "{{ v is sameas true }}"
        e["turn_on"] = setter(on)
        e["turn_off"] = setter(off)
        switches.append(e)
    elif k == "select" or cid == "alarm_time":
        opts = c.get("options")
        if cid == "alarm_time":
            opts = []
            for h in range(24):
                for mi in (0, 15, 30, 45):
                    lab = f"{(h % 12) or 12}:{mi:02d} {'AM' if h < 12 else 'PM'}"
                    opts.append({"value": f"{h:02d}:{mi:02d}", "label": lab})
        mp = J(opts).replace("'", "\\'")
        dl = next((o["label"] for o in opts if o["value"] == c.get("default")), opts[0]["label"])
        e = base(c, "select")
        e["options"] = "{{ " + J([o["label"] for o in opts]) + " }}"
        cur = read(c["path"], c.get("default"))
        if cid == "alarm_time":   # stored "7:00" or "07:00"; normalize to HH:MM
            cur += "{% set v = ('%02d:%s' | format(v.split(':')[0] | int, v.split(':')[1])) if v is string and ':' in v else v %}"
        e["state"] = (cur + "{%% set m = '%s' | from_json %%}{%% set ns = namespace(l=%s) %%}"
                      "{%% for o in m %%}{%% if o.value == v %%}{%% set ns.l = o.label %%}{%% endif %%}{%% endfor %%}{{ ns.l }}"
                      % (mp, J(dl)))
        extra = c.get("also_set", {})
        pj = ("{%% set m = '%s' | from_json %%}{%% set val = m | selectattr('label', 'eq', option) "
              "| map(attribute='value') | list | first %%}{{ {%s: val%s} }}"
              % (mp, J(c["path"]), "".join(", %s: %s" % (J(k2), lit(v2)) for k2, v2 in extra.items())))
        e["select_option"] = setter(pj)
        selects.append(e)
    elif k == "number":
        e = base(c, "number")
        e.update({"min": c["min"], "max": c["max"], "step": c["step"]})
        if c.get("unit"):
            e["unit_of_measurement"] = c["unit"]
        e["state"] = read(c["path"], c.get("default")) + "{{ v }}"
        e["set_value"] = setter("{{ {%s: value | int} }}" % J(c["path"]))
        numbers.append(e)
    elif k == "button":
        e = base(c, "button")
        if "power" in c:
            e["press"] = [{"action": "rest_command.bestly_wall_power", "data": {"on": c["power"]}},
                          {"delay": 2}, {"action": "homeassistant.update_entity", "target": {"entity_id": STATE}}]
        elif "command" in c:
            e["press"] = [{"action": "rest_command.bestly_wall_command", "data": {"cmd": c["command"]}},
                          {"delay": 2}, {"action": "homeassistant.update_entity", "target": {"entity_id": STATE}}]
        else:
            raw = J(c["set"])
            ins = {i: INPUT_JINJA[i] for i in INPUT_JINJA if "$input:" + i in raw}
            e["press"] = setter(c["set"], ins or None)
        buttons.append(e)

# ---- demo text: three text boxes + one "Show it" button ----
DEMO = [c for c in C if c["kind"] == "text" and c["id"].startswith("demo_")]
for c in DEMO:
    input_text["wall_" + c["id"]] = {"name": c["label"].replace("Demo text: ", "Demo "), "max": c.get("max", 60),
                                     "icon": "mdi:format-text", "initial": c.get("default", "").replace("\n", " / ")}
buttons.append({"name": "Show demo text", "unique_id": "bestly_wall_demo_send", "default_entity_id": "button.wall_demo_send",
                "icon": "mdi:send", "availability": AVAIL,
                "press": setter("{{ {" + ", ".join("%s: states('input_text.wall_%s') | replace(' / ', '\\n')" % (J(c["path"]), c["id"])
                                                    for c in DEMO) + ", 'mode': 'demo'} }}")})

# ---- radio presets (the admin searches Radio Browser; HA gets one-tap favorites) ----
PRESETS = [("Dance Wave", "https://dancewave.online/dance.mp3", "mdi:music-circle"),
           ("Groove Salad", "https://ice1.somafm.com/groovesalad-128-mp3", "mdi:leaf")]
for name, url, icon in PRESETS:
    slug = name.lower().replace(" ", "_")
    buttons.append({"name": "Play " + name, "unique_id": "bestly_wall_radio_" + slug,
                    "default_entity_id": "button.wall_radio_" + slug, "icon": icon, "availability": AVAIL,
                    "press": setter({"radio": {"on": True, "name": name, "url": url, "favicon": None, "ts": "$now"}})})

# ---- state sensor: one call, every key the controls read ----
tops = sorted({c["path"].split(".")[0] for c in C if c.get("path")} |
              {"radio", "one", "motivate", "tour", "sleepShow", "alarm", "dnd", "voice", "widgets", "liveActs", "ledSign", "theme"})
rest = [{
    "resource": "!secret bestly_rpc_wall_ha_get", "method": "POST", "scan_interval": 20, "timeout": 15,
    "headers": {"apikey": "!secret bestly_publishable", "Authorization": "!secret bestly_publishable_bearer",
                "Content-Type": "application/json"},
    "payload": "!secret bestly_wall_ha_get_payload",
    "sensor": [
        {"name": "Wall", "unique_id": "bestly_wall_state", "icon": "mdi:projector-screen",
         "value_template": "{{ value_json.pi | default('unknown') }}",
         "json_attributes_path": "$.wall", "json_attributes": tops},
        {"name": "Wall issues", "unique_id": "bestly_wall_issues", "icon": "mdi:alert-circle-outline",
         "value_template": "{{ value_json.issues | int(0) }}"},
        {"name": "Wall one thing", "unique_id": "bestly_wall_one_thing", "icon": "mdi:star-four-points",
         "value_template": "{{ (value_json.wall.one or 'Nothing picked yet')[:250] }}"},
    ]}]

hdr = {"apikey": "!secret bestly_publishable", "Authorization": "!secret bestly_publishable_bearer"}
pkg = {
    "rest": rest,
    "rest_command": {
        n: {"url": f"!secret bestly_rpc_wall_ha_{n.split('_')[-1]}", "method": "POST", "headers": hdr,
            "content_type": "application/json", "timeout": 15, "payload": f"!secret bestly_wall_ha_{n.split('_')[-1]}_payload"}
        for n in ("bestly_wall_patch", "bestly_wall_power", "bestly_wall_command")},
    "script": {"bestly_wall_set": {
        "alias": "Wall: change a setting", "icon": "mdi:projector-screen", "mode": "queued", "max": 25,
        "fields": {"patch": {"description": "Wall keys to set (dotted keys merge into their parent)"},
                   "inputs": {"description": "Values for $input: tokens"}},
        "sequence": [
            {"action": "rest_command.bestly_wall_patch", "data": {"patch": "{{ patch }}", "inputs": "{{ inputs | default({}) }}"},
             "response_variable": "r", "continue_on_error": True},
            {"if": [{"condition": "template", "value_template": "{{ r is not defined or r.status != 200 }}"}],
             "then": [{"action": "persistent_notification.create",
                       "data": {"title": "The wall didn't take that",
                                "message": "{{ (r.content.message if r is defined and r.content is mapping else 'No answer from the wall service.') }}",
                                "notification_id": "bestly_wall_error"}}]},
            {"action": "homeassistant.update_entity", "target": {"entity_id": STATE}},
        ]}},
    "template": [{"switch": switches}, {"select": selects}, {"number": numbers}, {"button": buttons},
                 {"binary_sensor": [
                     {"name": "Wall quiet now", "unique_id": "bestly_wall_quiet_now", "default_entity_id": "binary_sensor.wall_quiet_now",
                      "icon": "mdi:bell-sleep",
                      "state": "{% set d = state_attr('sensor.wall_state', 'dnd') %}{% set d = d if d is mapping else {} %}"
                               "{% set o = d.get('override') %}{% set t = now().strftime('%H:%M') %}"
                               "{% if o is mapping and (o.get('until') or 0) / 1000 > as_timestamp(now()) %}{{ o.get('mode') == 'on' }}"
                               "{% elif d.get('on', true) %}{% set f = d.get('from', '22:00') %}{% set u = d.get('to', '07:00') %}"
                               "{{ (t >= f or t < u) if f > u else (f <= t < u) }}{% else %}false{% endif %}"},
                     {"name": "Wall quiet override", "unique_id": "bestly_wall_dnd_override", "default_entity_id": "binary_sensor.wall_dnd_override",
                      "icon": "mdi:bell-cog-outline",
                      "state": "{% set d = state_attr('sensor.wall_state', 'dnd') %}{% set o = d.get('override') if d is mapping else none %}"
                               "{{ o is mapping and (o.get('until') or 0) / 1000 > as_timestamp(now()) }}"}]},
                 {"sensor": [{"name": "Wall radio station", "unique_id": "bestly_wall_radio_station",
                              "default_entity_id": "sensor.wall_radio_station", "icon": "mdi:radio",
                              "state": "{% set r = state_attr('sensor.wall_state', 'radio') %}"
                                       "{{ (r.name if r is mapping and r.url else 'No station yet') or 'Station' }}"}]}],
    "input_select": input_select, "input_boolean": input_boolean, "input_text": input_text,
    "recorder": {"exclude": {"entities": [STATE]}},
}


# ---- YAML writer (JSON-flow values; "!secret x" strings become real tags) ----
def y(v, ind=0):
    sp = "  " * ind
    if isinstance(v, dict):
        if not v:
            return " {}"
        out = ""
        for k, x in v.items():
            if isinstance(x, (dict, list)) and x:
                out += f"\n{sp}{k}:" + y(x, ind + 1)
            else:
                out += f"\n{sp}{k}: " + y(x, ind + 1).lstrip()
        return out
    if isinstance(v, list):
        if not v:
            return " []"
        out = ""
        for x in v:
            if isinstance(x, dict) and x:
                body = y(x, ind + 1).lstrip("\n")
                out += f"\n{sp}- " + body[len("  " * (ind + 1)):]
            else:
                out += f"\n{sp}- " + y(x, ind + 1).lstrip()
        return out
    if isinstance(v, str) and v.startswith("!secret "):
        return v
    return J(v)


head = ("# GENERATED by gen_wall_ha.py from bestlytech src/config/wall-controls.json (v%s). Do not hand-edit:\n"
        "# change the manifest, then re-run the generator. Writes go to wall_ha_patch / wall_ha_power /\n"
        "# wall_ha_command (Home Hub agent key, in secrets.yaml) - the same cleaning chain the admin uses.\n" % M.get("version"))
open("bestly_wall_controls.yaml", "w").write(head + y(pkg).lstrip("\n") + "\n")

# ---- dashboard views ----
def cond_for(expr):
    out = []
    for part in [p.strip() for p in (expr or "").split("&&") if p.strip()]:
        if "==" in part:
            path, val = [x.strip() for x in part.split("==")]
            cc = BY_PATH.get(path)
            if cc:
                lab = next((o["label"] for o in cc["options"] if str(o["value"]) == val), val)
                out.append({"entity": ent(cc), "state": lab})
        else:
            cc = BY_PATH.get(part)
            if cc and cc["kind"] == "switch":
                out.append({"entity": ent(cc), "state": "on"})
    return out


def row(c):
    r = {"entity": ent(c), "name": SHORT.get(c["id"], c["label"].replace("Demo text: ", ""))}
    if c["kind"] == "button":
        r = {"type": "button", "entity": ent(c), "name": c["label"], "action_name": ACTION.get(c["id"], "Go"),
             "tap_action": {"action": "perform-action", "perform_action": "button.press", "target": {"entity_id": ent(c)}}}
    conds = cond_for(c.get("shown_if")) + cond_for(c.get("requires"))
    if conds:
        return {"type": "conditional", "conditions": conds, "row": r}
    return r


def card(title, icon, rows):
    return {"type": "entities", "state_color": True, "show_header_toggle": False, "entities": rows}


def header(title):
    return {"type": "heading", "heading": title, "heading_style": "subtitle"}


def section(cards, span=1):
    s = {"type": "grid", "cards": cards}
    if span > 1:
        s["column_span"] = span
    return s


def grp(gid):
    return [c for c in C if c["group"] == gid and not c["id"].startswith("demo_") and not c["id"].startswith("power_")]


SKY_MAIN = {"air_show", "air_radius", "atc", "air_card", "air_key"}
hero = section([
    {"type": "heading", "heading": "Bestly Wall", "icon": "mdi:projector-screen",
     "badges": [{"type": "entity", "entity": "sensor.wall_issues", "show_state": True, "show_icon": True,
                 "visibility": [{"condition": "numeric_state", "entity": "sensor.wall_issues", "above": 0}]}]},
    {"type": "tile", "entity": STATE, "name": "Projector", "grid_options": {"columns": 6}},
    {"type": "tile", "entity": "light.wall", "name": "Wall light", "grid_options": {"columns": 6}},
    {"type": "tile", "entity": "button.wall_power_on", "name": "Turn on", "icon": "mdi:power", "hide_state": True, "vertical": True,
     "grid_options": {"columns": 4}, "tap_action": {"action": "perform-action", "perform_action": "button.press",
                                                     "target": {"entity_id": "button.wall_power_on"}}},
    {"type": "tile", "entity": "button.wall_power_off", "name": "Turn off", "icon": "mdi:power-off", "hide_state": True, "vertical": True,
     "grid_options": {"columns": 4}, "tap_action": {"action": "perform-action", "perform_action": "button.press",
                                                     "target": {"entity_id": "button.wall_power_off"}}},
    {"type": "tile", "entity": "switch.wall_away", "name": "Away", "icon": "mdi:bag-suitcase", "vertical": True, "grid_options": {"columns": 4},
     "tap_action": {"action": "toggle"}},
    {"type": "tile", "entity": "sensor.wall_one_thing", "name": "Scout's one thing", "grid_options": {"columns": 12}},
], 2)

wall_rows = [row(c) for c in grp("wall")] + [
    {"type": "conditional", "conditions": [{"entity": "select.wall_mode", "state": "Demo"}],
     "row": {"entity": "input_text.wall_" + c["id"], "name": c["label"].replace("Demo text: ", "")}} for c in DEMO] + [
    {"type": "conditional", "conditions": [{"entity": "select.wall_mode", "state": "Demo"}],
     "row": {"type": "button", "entity": "button.wall_demo_send", "name": "Show demo text", "action_name": "Show",
             "tap_action": {"action": "perform-action", "perform_action": "button.press", "target": {"entity_id": "button.wall_demo_send"}}}}]

radio_rows = [row(c) for c in grp("radio")] + [{"entity": "sensor.wall_radio_station", "name": "Station"}] + [
    {"type": "button", "entity": "button.wall_radio_" + n.lower().replace(" ", "_"), "name": n, "action_name": "Play",
     "tap_action": {"action": "perform-action", "perform_action": "button.press",
                    "target": {"entity_id": "button.wall_radio_" + n.lower().replace(" ", "_")}}} for n, _, _ in PRESETS]

sleep_rows = [{"entity": "input_select.wall_sleep_length", "name": "Length"},
              {"entity": "input_boolean.wall_sleep_music", "name": "Lullaby music"}] + [row(c) for c in grp("sleep") if not c.get("local")]


def G(gid, rows=None, title=None):
    g = GROUPS[gid]
    return section([header(title or g["title"]), card(title or g["title"], g["icon"], rows if rows is not None else [row(c) for c in grp(gid)])])


def grp_rows(gid):
    if gid == "wall":
        return wall_rows
    if gid == "radio":
        return radio_rows
    if gid == "sleep":
        return sleep_rows
    if gid == "power":
        return [row(BY_ID["power_on"]), row(BY_ID["power_off"]), row(BY_ID["away"])]
    return [row(c) for c in grp(gid)]


def pane_sections(pane):
    out = []
    for gid in pane["groups"]:
        if gid == "sky":
            out.append(section([header("Sky"), card("Sky", "", [row(c) for c in grp("sky") if c["id"] in SKY_MAIN])]))
            out.append(section([header("Details"), card("Details", "", [row(c) for c in grp("sky") if c["id"] not in SKY_MAIN])]))
            continue
        out.append(section([header(GROUPS[gid]["title"]), card(GROUPS[gid]["title"], "", grp_rows(gid))]))
    return out


def btn_row(cid, name=None, action=None, conds=None):
    c = BY_ID[cid]
    r = {"type": "button", "entity": ent(c), "name": name or c["label"], "action_name": action or ACTION.get(cid, "Go"),
         "tap_action": {"action": "perform-action", "perform_action": "button.press", "target": {"entity_id": ent(c)}}}
    return {"type": "conditional", "conditions": conds, "row": r} if conds else r


QUIET = [{"entity": "binary_sensor.wall_quiet_now", "state": "on"}]
LOUD = [{"entity": "binary_sensor.wall_quiet_now", "state": "off"}]
OVR = [{"entity": "binary_sensor.wall_dnd_override", "state": "on"}]
quick = [row(BY_ID["mode"]), row(BY_ID["volume"]), row(BY_ID["sound"]), row(BY_ID["voice_on"]),
         {"entity": "binary_sensor.wall_quiet_now", "name": "Quiet right now"},
         btn_row("dnd_quiet_hour", action="Quiet", conds=LOUD), btn_row("dnd_quiet_morning", action="Quiet", conds=LOUD),
         btn_row("dnd_allow_hour", action="Allow", conds=QUIET), btn_row("dnd_allow_tonight", action="Allow", conds=QUIET),
         btn_row("dnd_schedule", conds=OVR)]
listen = [row(BY_ID["radio_on"]), {"entity": "sensor.wall_radio_station", "name": "Station"}] + radio_rows[2:]
moments = [btn_row("show_play", "Play the show"), btn_row("show_party"), btn_row("motivate"), btn_row("show_stop", "Stop the show"),
           btn_row("sleep_start", "Count sheep"), btn_row("sleep_stop", "Stop sheep")]
alarm_now = [row(BY_ID["alarm_on"]), row(BY_ID["alarm_time"])]
nav_rows = [{"type": "weblink", "name": p["title"], "icon": p["icon"], "url": "/bestly-home/wall-" + p["id"]} for p in M["panes"]]

main = {"title": "Wall", "path": "wall", "icon": "mdi:projector", "type": "sections", "max_columns": 3, "sections": [
    hero,
    section([header("Controls"), card("Controls", "", quick)]),
    section([header("Listen"), card("Listen", "", listen)]),
    section([header("Moments"), card("Moments", "", moments)]),
    section([header("Alarm"), card("Alarm", "", alarm_now)]),
    section([header("Settings"), card("Settings", "", nav_rows)], 2),
]}
panes = [{"title": p["title"], "path": "wall-" + p["id"], "icon": p["icon"], "type": "sections", "max_columns": 3,
          "subview": True, "back_path": "/bestly-home/wall", "sections": pane_sections(p)} for p in M["panes"]]
json.dump({"wall": main, "panes": panes}, open("wall_views.json", "w"))

ids = [e["default_entity_id"] for t in (switches, selects, numbers, buttons) for e in t]
print("switches", len(switches), "selects", len(selects), "numbers", len(numbers), "buttons", len(buttons),
      "helpers", len(input_select) + len(input_boolean) + len(input_text), "attrs", len(tops))
missing = [c["id"] for c in C if c["kind"] != "text" and not c.get("local") and ent(c) not in ids]
print("controls without an entity:", missing)
