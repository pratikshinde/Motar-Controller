"""A farmer's address becomes a pin on the map. Nothing here reaches the real address service: the lookup itself is replaced. Runs against the local
development database for the parts that save a position."""
import os
import sys
import unittest
import uuid
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import settings
from app.models import Pump
from app.services import geocode
from test_farmer_registration import Base, client, digits  # noqa: E402  (the helpers of the farmer-registration tests)


class TestWiderAddresses(unittest.TestCase):
    def test_the_address_then_each_wider_version_of_it(self):
        self.assertEqual(list(geocode.candidates("Plot 12, Hadapsar, Pune 411028")), ["Plot 12, Hadapsar, Pune 411028", "Hadapsar, Pune 411028", "Pune 411028"])

    def test_at_most_three_tries_and_none_for_an_empty_address(self):
        self.assertEqual(len(list(geocode.candidates("a, b, c, d, e"))), 3)
        self.assertEqual(list(geocode.candidates("  ,  ")), [])
        self.assertEqual(list(geocode.candidates("")), [])


class TestLookup(unittest.TestCase):
    def setUp(self):
        geocode.geocode_address.cache_clear()
        self.enabled = mock.patch.object(settings, "GEOCODE_ENABLED", True)
        self.enabled.start()
        self.nap = mock.patch.object(geocode.time, "sleep")
        self.nap.start()

    def tearDown(self):
        self.enabled.stop()
        self.nap.stop()
        geocode.geocode_address.cache_clear()

    def test_a_found_address_gives_its_place(self):
        with mock.patch.object(geocode, "_ask", return_value=(18.5, 73.9)) as ask:
            self.assertEqual(geocode.geocode_address("Hadapsar, Pune"), (18.5, 73.9))
        ask.assert_called_once_with("Hadapsar, Pune")

    def test_an_address_that_is_not_found_falls_back_to_a_wider_one(self):
        answers = {"Plot 12, Hadapsar, Pune": None, "Hadapsar, Pune": None, "Pune": (18.52, 73.86)}
        with mock.patch.object(geocode, "_ask", side_effect=lambda q: answers[q]) as ask:
            self.assertEqual(geocode.geocode_address("Plot 12, Hadapsar, Pune"), (18.52, 73.86))
        self.assertEqual(ask.call_count, 3)

    def test_nothing_found_at_all_is_none(self):
        with mock.patch.object(geocode, "_ask", return_value=None):
            self.assertIsNone(geocode.geocode_address("Nowhere, Nothing"))

    def test_the_service_being_down_is_none_and_not_an_error(self):
        with mock.patch.object(geocode, "_ask", side_effect=OSError("down")) as ask:
            self.assertIsNone(geocode.geocode_address("Pune"))
        ask.assert_called_once()

    def test_switched_off_means_no_lookup_at_all(self):
        with mock.patch.object(settings, "GEOCODE_ENABLED", False), mock.patch.object(geocode, "_ask") as ask:
            self.assertIsNone(geocode.geocode_address("Pune"))
        ask.assert_not_called()

    def test_the_same_address_is_looked_up_once(self):
        with mock.patch.object(geocode, "_ask", return_value=(18.5, 73.9)) as ask:
            geocode.geocode_address("Hadapsar, Pune")
            geocode.geocode_address("Hadapsar, Pune")
        ask.assert_called_once()

    def test_a_hit_outside_india_is_not_taken(self):
        class Reply:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return b'[{"lat": "51.5", "lon": "-0.12"}]'

        with mock.patch.object(geocode.urllib.request, "urlopen", return_value=Reply()):
            self.assertIsNone(geocode._ask("London"))

    def test_only_the_address_is_sent(self):
        seen = {}

        class Reply:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return b"[]"

        def fake(req, timeout=None):
            seen["url"], seen["headers"] = req.full_url, dict(req.header_items())
            return Reply()

        with mock.patch.object(geocode.urllib.request, "urlopen", side_effect=fake):
            geocode._ask("Hadapsar, Pune")
        self.assertIn("q=Hadapsar%2C+Pune", seen["url"])
        self.assertIn("countrycodes=in", seen["url"])
        self.assertEqual(set(k.lower() for k in seen["headers"]), {"user-agent", "accept"})


class TestPlacingPumps(Base):
    def pump_row(self, owner, lat=None, lng=None):
        return self.db.query(Pump).filter(Pump.id == self.stock_with(owner, lat, lng)).one()

    def stock_with(self, owner, lat, lng):
        pid = self.stock(owner)
        self.db.query(Pump).filter(Pump.id == pid).update({"latitude": lat, "longitude": lng})
        self.db.commit()
        return pid

    def test_a_pump_with_no_position_gets_the_place_and_one_that_has_one_keeps_it(self):
        owner = self.dealer()
        bare, placed = self.stock_with(owner, None, None), self.stock_with(owner, 10.0, 70.0)
        with mock.patch.object(geocode, "geocode_address", return_value=(18.5, 73.9)):
            self.assertEqual(geocode.place_pumps_for_address([bare, placed], "Hadapsar, Pune"), 1)
        self.db.expire_all()
        rows = {p.id: (float(p.latitude), float(p.longitude)) for p in self.db.query(Pump).filter(Pump.id.in_([bare, placed]))}
        self.assertEqual(rows[bare], (18.5, 73.9))
        self.assertEqual(rows[placed], (10.0, 70.0))

    def test_a_corrected_address_moves_the_pin(self):
        owner = self.dealer()
        pid = self.stock_with(owner, 10.0, 70.0)
        with mock.patch.object(geocode, "geocode_address", return_value=(18.5, 73.9)):
            self.assertEqual(geocode.place_pumps_for_address([pid], "Pune", overwrite=True), 1)
        self.db.expire_all()
        self.assertEqual(float(self.db.query(Pump).filter(Pump.id == pid).one().latitude), 18.5)

    def test_an_address_that_cannot_be_found_leaves_the_pump_without_a_pin(self):
        owner = self.dealer()
        pid = self.stock_with(owner, None, None)
        with mock.patch.object(geocode, "geocode_address", return_value=None):
            self.assertEqual(geocode.place_pumps_for_address([pid], "Nowhere"), 0)
        self.db.expire_all()
        self.assertIsNone(self.db.query(Pump).filter(Pump.id == pid).one().latitude)


class TestRegistrationPlacesThePump(Base):
    def test_registering_a_farmer_looks_the_address_up_for_the_pump_without_slowing_the_answer(self):
        admin = self.dealer()
        starter = self.stock(admin)
        with mock.patch("app.api.farmers.place_pumps_for_address") as place:
            r = self.register(admin, self.form(starter, address="Plot 4, Hadapsar, Pune"))
        self.assertEqual(r.status_code, 201, r.text)
        place.assert_called_once_with([starter], "Plot 4, Hadapsar, Pune")

    def test_correcting_the_address_looks_the_new_one_up_and_moves_the_pins(self):
        admin = self.dealer()
        starter = self.stock(admin)
        made = self.register(admin, self.form(starter)).json()
        with mock.patch("app.api.farmers.place_pumps_for_address") as place:
            r = client.patch(f"/api/v1/farmers/{made['farmer']['id']}", json={"address": "Tumkur, Karnataka"}, headers=self.headers(admin))
        self.assertEqual(r.status_code, 200, r.text)
        place.assert_called_once_with([starter], "Tumkur, Karnataka", True)

    def test_changing_only_the_name_does_not_look_anything_up(self):
        admin = self.dealer()
        made = self.register(admin, self.form(self.stock(admin))).json()
        with mock.patch("app.api.farmers.place_pumps_for_address") as place:
            client.patch(f"/api/v1/farmers/{made['farmer']['id']}", json={"full_name": "Ramesh S. Patil"}, headers=self.headers(admin))
        place.assert_not_called()


if __name__ == "__main__":
    unittest.main()
