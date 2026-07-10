"""
Pumps registry — returns the pumps owned by a user.

Route:   GET /pumps?userId=+919876543210
         (userId = the customer's phone number in E.164, as verified by
          Firebase phone-OTP login in the app)

Backing store: DynamoDB table "PumpOwners"
  - Partition key: userId (String)  e.g. "+919876543210"
  - Attribute:     pumps  (List of Maps)

Example item (create via console or CLI when provisioning a customer):
{
  "userId": "+919876543210",
  "pumps": [
    {"thingName": "WaterPump01", "name": "Borewell Pump", "location": "North field"},
    {"thingName": "WaterPump02", "name": "Open Well Pump", "location": "Near house"}
  ]
}

Deploy: Python 3.12 Lambda, role with dynamodb:GetItem on the table,
API Gateway HTTP API route GET /pumps -> this Lambda (same API as /history).

Response shape (what the app's BackendApi.getPumps expects):
  {"pumps": [{"thingName": "...", "name": "...", "location": "..."}]}
"""

import json
import os

import boto3

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(os.environ.get("TABLE_NAME", "PumpOwners"))


def lambda_handler(event, context):
    params = event.get("queryStringParameters") or {}
    user_id = (params.get("userId") or "").strip()

    if not user_id:
        return _response(400, {"error": "userId query parameter is required"})

    item = table.get_item(Key={"userId": user_id}).get("Item") or {}
    pumps = item.get("pumps", [])

    # Only expose the fields the app needs.
    cleaned = [
        {
            "thingName": p.get("thingName", ""),
            "name": p.get("name", p.get("thingName", "Pump")),
            "location": p.get("location", ""),
        }
        for p in pumps
        if p.get("thingName")
    ]

    return _response(200, {"pumps": cleaned})


def _response(status, body):
    return {
        "statusCode": status,
        "headers": {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
        },
        "body": json.dumps(body),
    }
