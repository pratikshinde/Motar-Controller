import io
import base64
import pyotp
import qrcode
from typing import Tuple

def generate_secret() -> str:
    return pyotp.random_base32()

def build_otpauth_url(secret: str, phone_number: str, issuer: str = "AgriPump SmartSpace") -> str:
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=phone_number, issuer_name=issuer)

def generate_qr_base64(otpauth_url: str) -> str:
    qr = qrcode.QRCode(version=1, box_size=5, border=2)
    qr.add_data(otpauth_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    b64_str = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64_str}"

def verify_totp(secret: str, token: str) -> bool:
    if not secret or not token:
        return False
    totp = pyotp.TOTP(secret)
    # valid_window=1 allows 1 step before/after (30s drift)
    return bool(totp.verify(token.strip(), valid_window=1))
