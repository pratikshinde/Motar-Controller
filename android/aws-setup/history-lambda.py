"""
GET /history?pumpId=WaterPump01&metric=flowLpm&hours=24
Reads pump telemetry from Amazon Timestream and returns:
{ "metric": "flowLpm", "points": [ { "ts": 1720000000000, "value": 42.5 }, ... ] }

Attach behind API Gateway (HTTP API, Lambda proxy integration).
Lambda role needs timestream:Select + timestream:DescribeEndpoints.
"""
import json
import boto3

DATABASE = "PumpTelemetry"
TABLE = "readings"
ALLOWED_METRICS = {"vRY", "vYB", "vBR", "iR", "iY", "iB", "totalRunSec"}

query_client = boto3.client("timestream-query")


def handler(event, context):
    params = event.get("queryStringParameters") or {}
    pump_id = params.get("pumpId", "WaterPump01")
    metric = params.get("metric", "vRY")
    hours = min(int(params.get("hours", 24)), 24 * 30)

    if metric not in ALLOWED_METRICS:
        return _resp(400, {"error": f"metric must be one of {sorted(ALLOWED_METRICS)}"})

    # Bin to keep the payload small: ~200 points regardless of window.
    bin_minutes = max(1, (hours * 60) // 200)

    query = f"""
        SELECT bin(time, {bin_minutes}m) AS ts,
               avg(measure_value::double) AS value
        FROM "{DATABASE}"."{TABLE}"
        WHERE measure_name = '{metric}'
          AND pumpId = '{pump_id}'
          AND time > ago({hours}h)
        GROUP BY bin(time, {bin_minutes}m)
        ORDER BY ts ASC
    """

    rows = query_client.query(QueryString=query)["Rows"]
    points = []
    for row in rows:
        ts_str, val_str = (d.get("ScalarValue") for d in row["Data"])
        if ts_str and val_str:
            # Timestream returns "2026-07-08 10:00:00.000000000"
            from datetime import datetime
            ts = int(datetime.fromisoformat(ts_str.split(".")[0]).timestamp() * 1000)
            points.append({"ts": ts, "value": float(val_str)})

    return _resp(200, {"metric": metric, "points": points})


def _resp(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json",
                    "Access-Control-Allow-Origin": "*"},
        "body": json.dumps(body),
    }
