#!/bin/bash
# round trip test on Hestia. usage: rt.sh step
cd /opt/bestly/wall
T=$(grep ^HA_TOKEN= /home/pi/scripts/.env | cut -d= -f2- | tr -d "\"'")
H="Authorization: Bearer $T"
st(){ curl -s -m 5 -H "$H" localhost:8123/api/states/$1 | python3 -c "import json,sys;d=json.load(sys.stdin);print('$1',d['state'],d['attributes'].get('last_triggered',''))"; }
case "$1" in
 testyaml)  # literal (no-op) dismiss value for the dry run
  docker exec homeassistant sed -i 's/briefDismiss: "\$now"/briefDismiss: 1793806186674/' /config/packages/bestly_morning_brief.yaml
  docker exec homeassistant grep -n briefDismiss /config/packages/bestly_morning_brief.yaml
  curl -s -m 30 -X POST -H "$H" -H "Content-Type: application/json" -d '{}' localhost:8123/api/services/automation/reload; echo;;
 realyaml)
  docker cp /tmp/bestly_morning_brief.yaml homeassistant:/config/packages/bestly_morning_brief.yaml
  docker exec homeassistant grep -n briefDismiss /config/packages/bestly_morning_brief.yaml
  curl -s -m 30 -X POST -H "$H" -H "Content-Type: application/json" -d '{}' localhost:8123/api/services/automation/reload; echo;;
 forceon) python3 -c "import json,time;json.dump({'show':True,'until':time.time()+900},open('brief_ha_test.json','w'))";;
 forceoff) rm -f brief_ha_test.json;;
 person_off) curl -s -m 8 -X POST -H "$H" -H "Content-Type: application/json" -d '{"entity_id":"input_boolean.wall_morning_brief"}' localhost:8123/api/services/input_boolean/turn_off >/dev/null; echo person_off sent;;
 show) st input_boolean.wall_morning_brief; st sensor.wall_brief_show; st automation.wall_morning_brief_turned_off_dismiss; cat brief_ha.json; echo;;
esac
