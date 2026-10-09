#!/usr/bin/env python3
import os, sys, json, datetime, time, requests
from zoneinfo import ZoneInfo

SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://rcqfqhguwpmaarseifqg.supabase.co')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY')
if not SUPABASE_SERVICE_KEY:
    print('ERROR: SUPABASE_SERVICE_KEY not set', file=sys.stderr)
    sys.exit(1)

HEADERS = {
    'apikey': SUPABASE_SERVICE_KEY,
    'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
    'Content-Type': 'application/json',
}

def fetch_one(table, select, order='desc', limit=1):
    url = f'{SUPABASE_URL}/rest/v1/{table}?select={select}&order={order}.{limit}&limit={limit}'
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        return data[0] if data else None
    except Exception as e:
        print(f'Error fetching {table}: {e}', file=sys.stderr)
        return None

now = datetime.datetime.now(tz=ZoneInfo('America/Los_Angeles'))
stale = False
reason = []

# Check vehicle state
veh = fetch_one('turo_vehicle_state', 'observed_at', 'desc', 1)
if veh and veh.get('observed_at'):
    obs = datetime.datetime.fromisoformat(veh['observed_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/Los_Angeles'))
    age = (now - obs).total_seconds() / 60
    if age > 15:
        stale = True
        reason.append(f'vehicle state {age:.0f} min old')
else:
    stale = True
    reason.append('no vehicle state')

# Check trips
Trip = fetch_one('turo_trips', 'ends_at', 'desc', 1)
if Trip and Trip.get('ends_at'):
    ends = datetime.datetime.fromisoformat(Trip['ends_at'].replace('Z', '+00:00')).astimezone(ZoneInfo('America/Los_Angeles'))
    age = (now - ends).total_seconds() / 60
    if age > 15:
        stale = True
        reason.append(f'trip ends {age:.0f} min old')
else:
    stale = True
    reason.append('no trips')

if stale:
    # Insert notification
    notif = {
        'title': 'Wall data stale',
        'body': f'Wall data may be stale: {', '.join(reason)}.',
        'kind': 'warning',
        'severity': 'warning',
        'created_at': now.isoformat(),
    }
    url = f'{SUPABASE_URL}/rest/v1/admin_notifications'
    try:
        resp = requests.post(url, headers=HEADERS, json=notif, timeout=10)
        resp.raise_for_status()
        print('Inserted notification for stale wall data')
    except Exception as e:
        print(f'Failed to insert notification: {e}', file=sys.stderr)
else:
    print('Wall data is fresh')
