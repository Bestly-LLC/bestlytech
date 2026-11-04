set -e
TOK=$(grep '^HA_TOKEN=' /home/pi/scripts/.env | cut -d= -f2- | tr -d "\"'")
H="Authorization: Bearer $TOK"
curl -s -H "$H" localhost:8123/api/states > /tmp/ha_states.json
python3 - <<'EOF'
import json,re
st=json.load(open('/tmp/ha_states.json'))
print(len(st),'entities')
for s in st:
    e=s['entity_id']; n=(s['attributes'].get('friendly_name') or '')
    if re.search(r'sexy|private|intim|romance|mood|night_in|date', e+' '+n, re.I):
        print('MATCH', e, '|', n, '|', s['state'])
print('--- scenes')
for s in st:
    if s['entity_id'].startswith('scene.'): print(s['entity_id'], '|', s['attributes'].get('friendly_name'), '|', s['state'])
print('--- input_boolean')
for s in st:
    if s['entity_id'].startswith('input_boolean.'): print(s['entity_id'], '|', s['attributes'].get('friendly_name'), '|', s['state'])
print('--- automations w/ wall')
for s in st:
    if s['entity_id'].startswith('automation.') and re.search(r'wall|projector|sexy|private|scene', s['entity_id']+(s['attributes'].get('friendly_name') or ''), re.I): print(s['entity_id'], '|', s['attributes'].get('friendly_name'), '|', s['state'], s['attributes'].get('last_triggered'))
print('--- media_player')
for s in st:
    if s['entity_id'].startswith('media_player.'): print(s['entity_id'], '|', s['attributes'].get('friendly_name'), '|', s['state'])
print('--- wall')
for s in st:
    if re.search(r'wall', s['entity_id']): print(s['entity_id'], '|', s['attributes'].get('friendly_name'), '|', s['state'][:40])
EOF
