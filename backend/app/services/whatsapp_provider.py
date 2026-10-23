"""
WhatsApp OTP Provider Abstraction
Supports 'mock' (development testing) and 'whatsapp' (Meta Cloud API production gateway).
"""
import abc
import logging
from typing import Dict, Any, Optional
import httpx
from app.config import settings
from app.services.brand_service import channel_setting

logger = logging.getLogger("agripump.auth.whatsapp")

class WhatsAppOtpProvider(abc.ABC):
    @abc.abstractmethod
    def send_otp(self, phone_number: str, otp_code: str) -> Dict[str, Any]:
        """Send an OTP code to a normalized phone number via WhatsApp."""
        pass


class MockWhatsAppOtpProvider(WhatsAppOtpProvider):
    """
    Safe development/test WhatsApp provider.
    Logs delivery safely to the console and returns dispatch success
    without leaking secrets in production environments.
    """
    def send_otp(self, phone_number: str, otp_code: str) -> Dict[str, Any]:
        logger.info(f"[DEV MOCK WHATSAPP OTP] Phone: {phone_number} | Code: {otp_code} (Valid for 5 minutes)")
        return {
            "status": "mock_dispatched",
            "provider": "mock",
            "phone_number": phone_number,
            "channel": "whatsapp"
        }


class RealWhatsAppOtpProvider(WhatsAppOtpProvider):
    """
    Production WhatsApp Cloud API (Meta Graph API) provider.
    Uses pre-approved authentication template.
    """
    def __init__(self, api_token: Optional[str] = None, phone_id: Optional[str] = None, template_name: Optional[str] = None, language_code: Optional[str] = None):
        # The calling app's own WhatsApp account when its brand has one, else the platform's (brand_service.channel_setting).
        self.api_token = api_token or channel_setting("WHATSAPP_API_TOKEN")
        self.phone_id = phone_id or channel_setting("WHATSAPP_PHONE_ID")
        self.template_name = template_name or channel_setting("WHATSAPP_OTP_TEMPLATE") or "otp_verification"
        self.language_code = language_code or channel_setting("WHATSAPP_OTP_LANGUAGE") or "en_US"

    def send_otp(self, phone_number: str, otp_code: str) -> Dict[str, Any]:
        if not self.api_token or not self.phone_id:
            logger.warning("Real WhatsApp provider invoked without WHATSAPP_API_TOKEN or WHATSAPP_PHONE_ID configured.")
            return {
                "status": "not_configured",
                "provider": "whatsapp",
                "error": "WhatsApp provider credentials not configured on server."
            }

        clean_num = phone_number.strip().replace(" ", "").replace("+", "")
        url = f"https://graph.facebook.com/v21.0/{self.phone_id}/messages"
        headers = {
            "Authorization": f"Bearer {self.api_token}",
            "Content-Type": "application/json",
        }
        payload = {
            "messaging_product": "whatsapp",
            "to": clean_num,
            "type": "template",
            "template": {
                "name": self.template_name,
                "language": {"code": self.language_code},
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
                    logger.error(f"WhatsApp API delivery error ({res.status_code}): {body}")
                    return {"status": "send_failed", "provider": "whatsapp", "detail": body}
                return {"status": "dispatched", "provider": "whatsapp", "detail": body}
        except Exception as exc:
            logger.error(f"WhatsApp dispatch exception: {exc}")
            return {"status": "send_failed", "provider": "whatsapp", "detail": str(exc)}


def get_whatsapp_provider() -> WhatsAppOtpProvider:
    """
    Factory resolving the active WhatsApp provider according to environment configuration.
    """
    # Environment switch: AUTH_PROVIDER=mock | whatsapp
    provider_type = getattr(settings, "AUTH_PROVIDER", None)
    if not provider_type:
        provider_type = "mock" if settings.ENV == "development" else "whatsapp"

    provider_type = provider_type.strip().lower()

    # Only an explicit "mock" selects the console logger (config.py refuses that value outside ENV=development). A
    # misspelt value must not silently become "log every code and send nothing".
    if provider_type == "mock":
        return MockWhatsAppOtpProvider()

    if channel_setting("WHATSAPP_API_TOKEN") and channel_setting("WHATSAPP_PHONE_ID"):
        return RealWhatsAppOtpProvider()
    if settings.ENV == "development":
        logger.info("Real WhatsApp credentials absent; falling back to MockWhatsAppOtpProvider in development.")
        return MockWhatsAppOtpProvider()
    return RealWhatsAppOtpProvider()
