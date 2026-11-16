"""Things the server image installs from requirements.txt that the code needs at run time. A developer machine often has them by chance, a clean image does not."""
import base64
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

REQUIREMENTS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "requirements.txt")


class TestRuntimeRequirements(unittest.TestCase):
    def test_the_qr_code_for_the_authenticator_can_be_drawn_and_its_picture_library_is_installed_by_requirements(self):
        text = open(REQUIREMENTS, encoding="utf-8").read().lower()
        self.assertTrue("qrcode[pil]" in text or "pillow" in text, "requirements.txt must install Pillow (qrcode[pil]): without it the authenticator setup fails with a 500")
        from app.services import totp_service

        data = totp_service.generate_qr_base64(totp_service.build_otpauth_url(totp_service.generate_secret(), "owner@example.com"))
        self.assertTrue(data.startswith("data:image/png;base64,"))
        self.assertEqual(base64.b64decode(data.split(",", 1)[1])[:8], b"\x89PNG\r\n\x1a\n")


if __name__ == "__main__":
    unittest.main()
