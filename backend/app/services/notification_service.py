import httpx
from typing import Optional, Dict, Any
from app.config import settings

def send_sms_otp(phone_number: str, otp_code: str) -> Dict[str, Any]:
    """
    Sends real SMS OTP via Twilio, Fast2SMS, or MSG91 if credentials are set in backend/.env.
    """
    # The code goes to the console on a developer machine only: anywhere else stdout ends up in shared logs, and a code in
    # a log is a sign-in for anyone who can read it.
    if settings.dev_codes_enabled:
        print(f"[AUTH OTP GENERATED] Phone: {phone_number} | OTP Code: {otp_code} (Expires in 5m)")

    clean_num = phone_number.strip().replace(" ", "")

    # 1. Twilio SMS Integration
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
            with httpx.Client(timeout=8.0) as client:
                res = client.post(
                    url,
                    auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                    data={
                        "From": settings.TWILIO_PHONE_NUMBER,
                        "To": clean_num,
                        "Body": f"Your AgriPump SmartSpace OTP verification code is: {otp_code}. Valid for 5 minutes."
                    }
                )
                return res.json()
        except Exception as e:
            print(f"Twilio SMS Dispatch Error: {e}")

    # 2. Fast2SMS Integration (India)
    if settings.FAST2SMS_API_KEY:
        try:
            num_10digit = clean_num.replace("+91", "").strip()
            url = "https://www.fast2sms.com/dev/bulkV2"
            headers = {
                "authorization": settings.FAST2SMS_API_KEY,
                "Content-Type": "application/x-www-form-urlencoded"
            }
            data = {
                "variables_values": otp_code,
                "route": "otp",
                "numbers": num_10digit
            }
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(url, headers=headers, data=data)
                return resp.json()
        except Exception as e:
            print(f"Fast2SMS Dispatch Warning: {e}")

    # 3. MSG91 DLT Integration (India)
    if settings.MSG91_AUTH_KEY and settings.MSG91_FLOW_ID:
        try:
            url = "https://control.msg91.com/api/v5/flow/"
            headers = {
                "authkey": settings.MSG91_AUTH_KEY,
                "content-type": "application/json"
            }
            payload = {
                "flow_id": settings.MSG91_FLOW_ID,
                "sender": "AGRPMP",
                "recipients": [
                    {
                        "mobiles": clean_num.replace("+", ""),
                        "otp": otp_code
                    }
                ]
            }
            with httpx.Client(timeout=5.0) as client:
                resp = client.post(url, headers=headers, json=payload)
                return resp.json()
        except Exception as e:
            print(f"MSG91 Dispatch Warning: {e}")

    return {"status": "mock_dispatched", "phone": phone_number, "otp": otp_code}


def send_whatsapp_otp(phone_number: str, otp_code: str) -> Dict[str, Any]:
    """Sends an OTP over WhatsApp via the Meta Cloud API — only for phone-verification at registration and a
    partner's forgot-password, never the everyday farmer login OTP (that stays `send_sms_otp`, unchanged).

    Unlike `send_sms_otp`, there is no chain of alternate gateways to fall back through: if
    `WHATSAPP_API_TOKEN`/`WHATSAPP_PHONE_ID` are not set, this simply reports itself unconfigured so the
    caller can refuse cleanly (never invent a "sent" result for a message that was not sent) — the route
    calling this is what decides whether that is fatal (production) or fine (development, via dev_otp).

    Requires an Authentication-category template pre-approved by Meta (`WHATSAPP_OTP_TEMPLATE`) whose one
    body variable is the code; Meta does not accept free-text business-initiated messages.
    """
    if not (settings.WHATSAPP_API_TOKEN and settings.WHATSAPP_PHONE_ID):
        return {"status": "not_configured"}

    clean_num = phone_number.strip().replace(" ", "").replace("+", "")
    url = f"https://graph.facebook.com/v21.0/{settings.WHATSAPP_PHONE_ID}/messages"
    headers = {
        "Authorization": f"Bearer {settings.WHATSAPP_API_TOKEN}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": clean_num,
        "type": "template",
        "template": {
            "name": settings.WHATSAPP_OTP_TEMPLATE,
            "language": {"code": settings.WHATSAPP_OTP_LANGUAGE},
            "components": [
                {"type": "body", "parameters": [{"type": "text", "text": otp_code}]},
            ],
        },
    }
    try:
        with httpx.Client(timeout=8.0) as client:
            res = client.post(url, headers=headers, json=payload)
            body = res.json()
            if res.status_code >= 400:
                print(f"WhatsApp OTP dispatch failed ({res.status_code}): {body}")
                return {"status": "send_failed", "detail": body}
            return {"status": "dispatched", "detail": body}
    except Exception as e:
        print(f"WhatsApp OTP Dispatch Error: {e}")
        return {"status": "send_failed", "detail": str(e)}
