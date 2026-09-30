"""The new shape of otp_challenges (purpose/channel/consumed_at) and the new phone_verifications ticket table.

No routes use `registration`/`password_reset` yet (planned, not built) — this only proves the schema itself
behaves: one unconsumed challenge per (phone, purpose), purpose/channel are restricted to known values, and a
verification ticket is single-use by construction (unique token_hash).

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models import OtpChallenge, PhoneVerification


class TestOtpChallengeShape(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.phone = f"+9198{uuid.uuid4().int % 10**8:08d}"

    def tearDown(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.phone).delete()
        self.db.query(PhoneVerification).filter(PhoneVerification.phone_number == self.phone).delete()
        self.db.commit()
        self.db.close()

    def _challenge(self, purpose="login", channel="sms", consumed=False):
        c = OtpChallenge(
            phone_number=self.phone, purpose=purpose, channel=channel, code_hash="x" * 64,
            expires_at=datetime.utcnow() + timedelta(minutes=5),
            consumed_at=datetime.utcnow() if consumed else None,
        )
        self.db.add(c)
        self.db.commit()
        return c

    def test_a_phone_can_have_one_pending_challenge_per_purpose_at_once(self):
        self._challenge(purpose="login")
        self._challenge(purpose="registration")  # different purpose: fine, both pending at once
        self.assertEqual(
            self.db.query(OtpChallenge).filter(OtpChallenge.phone_number == self.phone).count(), 2
        )

    def test_a_second_pending_challenge_for_the_same_purpose_is_rejected(self):
        self._challenge(purpose="password_reset")
        with self.assertRaises(IntegrityError):
            self._challenge(purpose="password_reset")
        self.db.rollback()

    def test_a_consumed_challenge_does_not_block_a_new_one_for_the_same_purpose(self):
        self._challenge(purpose="login", consumed=True)
        # Must not raise: the unique index only covers unconsumed rows.
        self._challenge(purpose="login", consumed=False)
        open_count = (
            self.db.query(OtpChallenge)
            .filter(OtpChallenge.phone_number == self.phone, OtpChallenge.purpose == "login",
                    OtpChallenge.consumed_at.is_(None))
            .count()
        )
        self.assertEqual(open_count, 1)

    def test_purpose_and_channel_are_restricted_to_known_values(self):
        for kwargs in ({"purpose": "carrier_pigeon"}, {"channel": "fax"}):
            with self.assertRaises(IntegrityError):
                self._challenge(**kwargs)
            self.db.rollback()

    def test_defaults_match_todays_login_only_behaviour(self):
        c = OtpChallenge(phone_number=self.phone, code_hash="y" * 64, expires_at=datetime.utcnow() + timedelta(minutes=5))
        self.db.add(c)
        self.db.commit()
        self.db.refresh(c)
        self.assertEqual((c.purpose, c.channel, c.consumed_at), ("login", "sms", None))


class TestPhoneVerificationShape(unittest.TestCase):
    def setUp(self):
        self.db = SessionLocal()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.phone = f"+9198{uuid.uuid4().int % 10**8:08d}"

    def tearDown(self):
        self.db.rollback()
        self.db.execute(text("SET app.bypass_rls = 'on';"))
        self.db.query(PhoneVerification).filter(PhoneVerification.phone_number == self.phone).delete()
        self.db.commit()
        self.db.close()

    def test_a_ticket_is_single_use_by_construction(self):
        token_hash = uuid.uuid4().hex
        self.db.add(PhoneVerification(phone_number=self.phone, purpose="registration", token_hash=token_hash,
                                       expires_at=datetime.utcnow() + timedelta(minutes=10)))
        self.db.commit()
        with self.assertRaises(IntegrityError):
            self.db.add(PhoneVerification(phone_number=self.phone, purpose="password_reset", token_hash=token_hash,
                                           expires_at=datetime.utcnow() + timedelta(minutes=10)))
            self.db.commit()
        self.db.rollback()

    def test_login_is_not_a_valid_purpose_for_a_ticket(self):
        with self.assertRaises(IntegrityError):
            self.db.add(PhoneVerification(phone_number=self.phone, purpose="login", token_hash=uuid.uuid4().hex,
                                           expires_at=datetime.utcnow() + timedelta(minutes=10)))
            self.db.commit()
        self.db.rollback()

    def test_can_be_marked_consumed(self):
        v = PhoneVerification(phone_number=self.phone, purpose="password_reset", token_hash=uuid.uuid4().hex,
                               expires_at=datetime.utcnow() + timedelta(minutes=10))
        self.db.add(v)
        self.db.commit()
        v.consumed_at = datetime.utcnow()
        self.db.commit()
        self.db.refresh(v)
        self.assertIsNotNone(v.consumed_at)


if __name__ == "__main__":
    unittest.main()
