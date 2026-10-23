import httpx
from typing import Optional, Dict, Any
from app.config import settings
from app.services.brand_service import channel_setting, current_brand

def send_sms_otp(phone_number: str, otp_code: str) -> Dict[str, Any]:
    """
    Sends real SMS OTP via Twilio, Fast2SMS, or MSG91 if credentials are set in backend/.env.
    """
    # The code goes to the console on a developer machine only: anywhere else stdout ends up in shared logs, and a code in
    # a log is a sign-in for anyone who can read it.
    if settings.dev_codes_enabled:
        print(f"[AUTH OTP GENERATED] Phone: {phone_number} | OTP Code: {otp_code} (Expires in 5m)")

    clean_num = phone_number.strip().replace(" ", "")

    # Each manufacturer's app sends from its own account where it has one (BRAND_<KEY>_<SETTING>), else the platform's.
    brand = current_brand.get()
    product = brand.name if brand else "AgriPump SmartSpace"
    twilio_sid, twilio_token, twilio_from = (channel_setting(n) for n in ("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER"))
    fast2sms_key = channel_setting("FAST2SMS_API_KEY")
    msg91_key, msg91_flow = channel_setting("MSG91_AUTH_KEY"), channel_setting("MSG91_FLOW_ID")

    # 1. Twilio SMS Integration
    if twilio_sid and twilio_token and twilio_from:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
            with httpx.Client(timeout=8.0) as client:
                res = client.post(
                    url,
                    auth=(twilio_sid, twilio_token),
                    data={
                        "From": twilio_from,
                        "To": clean_num,
                        "Body": f"Your {product} OTP verification code is: {otp_code}. Valid for 5 minutes."
                    }
                )
                return res.json()
        except Exception as e:
            print(f"Twilio SMS Dispatch Error: {e}")

    # 2. Fast2SMS Integration (India)
    if fast2sms_key:
        try:
            num_10digit = clean_num.replace("+91", "").strip()
            url = "https://www.fast2sms.com/dev/bulkV2"
            headers = {
                "authorization": fast2sms_key,
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
    if msg91_key and msg91_flow:
        try:
            url = "https://control.msg91.com/api/v5/flow/"
            headers = {
                "authkey": msg91_key,
                "content-type": "application/json"
            }
            payload = {
                "flow_id": msg91_flow,
                "sender": channel_setting("SMS_SENDER_ID") or "AGRPMP",
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
    token, phone_id = channel_setting("WHATSAPP_API_TOKEN"), channel_setting("WHATSAPP_PHONE_ID")
    if not (token and phone_id):
        return {"status": "not_configured"}

    clean_num = phone_number.strip().replace(" ", "").replace("+", "")
    url = f"https://graph.facebook.com/v21.0/{phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": clean_num,
        "type": "template",
        "template": {
            "name": channel_setting("WHATSAPP_OTP_TEMPLATE"),
            "language": {"code": channel_setting("WHATSAPP_OTP_LANGUAGE")},
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
