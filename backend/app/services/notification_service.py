import httpx
from typing import Optional, Dict, Any
from app.config import settings

async def send_sms_otp(phone_number: str, otp_code: str) -> Dict[str, Any]:
    """
    Sends real SMS OTP via Twilio, Fast2SMS, or MSG91 if credentials are set in backend/.env.
    """
    print(f"[AUTH OTP GENERATED] Phone: {phone_number} | OTP Code: {otp_code} (Expires in 5m)")

    clean_num = phone_number.strip().replace(" ", "")

    # 1. Twilio SMS Integration
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN and settings.TWILIO_PHONE_NUMBER:
        try:
            url = f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json"
            async with httpx.AsyncClient(timeout=8.0) as client:
                res = await client.post(
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
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, headers=headers, data=data)
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
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.post(url, headers=headers, json=payload)
                return resp.json()
        except Exception as e:
            print(f"MSG91 Dispatch Warning: {e}")

    return {"status": "mock_dispatched", "phone": phone_number, "otp": otp_code}
