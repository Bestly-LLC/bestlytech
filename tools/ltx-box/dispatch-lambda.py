"""bestly-ltx-dispatch: every minute (EventBridge), wake the LTX GPU box when a video job is waiting.
Hourly (minute 7) it also reports the AWS credit balance for the credit watchdog.
Reads only a count from Bestly (edge fn ltx-box ?op=waiting). Starts the box if it is stopped.
If AWS has no GPU capacity, it reports to Scout via ltx_report so the watchdog can tell Jared."""
import datetime, json, os, urllib.request
import boto3

IID = os.environ["IID"]
EDGE = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ltx-box?op=waiting"
ec2 = boto3.client("ec2")

def report(event, detail):
    sb, key = os.environ.get("SB_URL"), os.environ.get("SB_KEY")
    if not sb or not key:
        return
    body = json.dumps({"p_event": event, "p_detail": {"instance_id": IID, **detail}}).encode()
    req = urllib.request.Request(f"{sb}/rest/v1/rpc/ltx_report", body,
                                 {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=8).read()
    except Exception:
        pass

def credits():
    """Once an hour: AWS credit balance -> Bestly (ltx_report 'credits'), for the credit watchdog."""
    try:
        s = boto3.client("freetier", region_name="us-east-1").get_account_plan_state()
        amt = s.get("accountPlanRemainingCredits", {}).get("amount")
        report("credits", {"usd": amt, "plan": s.get("accountPlanType"), "status": s.get("accountPlanStatus")})
    except Exception as e:
        report("credits_failed", {"error": str(e)[:300]})

def handler(event, context):
    if datetime.datetime.utcnow().minute == 7 or (event or {}).get("credits"):
        credits()
    waiting = json.load(urllib.request.urlopen(EDGE, timeout=8)).get("waiting", 0)
    if not waiting:
        return {"waiting": 0}
    state = ec2.describe_instances(InstanceIds=[IID])["Reservations"][0]["Instances"][0]["State"]["Name"]
    if state != "stopped":
        return {"waiting": waiting, "state": state}
    try:
        ec2.start_instances(InstanceIds=[IID])
        report("start_requested", {"by": "dispatcher", "waiting": waiting})
        return {"waiting": waiting, "started": True}
    except Exception as e:
        report("start_failed", {"by": "dispatcher", "error": str(e)[:300]})
        return {"waiting": waiting, "started": False, "error": str(e)[:300]}
