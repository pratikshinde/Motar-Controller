"""Who may change a device's configuration and lifecycle, and who may see and use configuration templates.

The role matrix has always said the farmer cannot configure devices (Permission.CONFIGURE_DEVICE), but no route checked it:
a farmer could rewrite the protection settings of the pump he owns, lift a partner's SUSPENDED state, and every account
could list, change and delete every other tenant's templates. Applying a template also answered 500 for every request.

Runs against the local development database; every row created here is removed again.
"""
import os
import sys
import unittest
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient

from app.main import app
from app.models import ConfigTemplate, DeviceConfig, Pump
from test_web_portal_actions import Tree  # noqa: E402
from test_web_portal_users import _h  # noqa: E402

client = TestClient(app)


class TestConfigAndLifecyclePermissions(Tree):
    def setUp(self):
        super().setUp()
        self.templates = []
        self.pumps = []

    def tearDown(self):
        self.db.rollback()
        if self.templates:
            self.db.query(ConfigTemplate).filter(ConfigTemplate.id.in_(self.templates)).delete(synchronize_session=False)
        if self.pumps:
            self.db.query(DeviceConfig).filter(DeviceConfig.pump_id.in_(self.pumps)).delete(synchronize_session=False)
            self.db.query(Pump).filter(Pump.id.in_(self.pumps)).delete(synchronize_session=False)
        self.db.commit()

    def make_pump(self, owner, state="ACTIVE"):
        pid = self.pump(owner, state=state)
        self.pumps.append(pid)
        return pid

    def make_template(self, user, name="T", settings=None):
        r = client.post("/api/v1/config-templates", json={"name": f"{name} {uuid.uuid4().hex[:6]}", "desired_json": settings or {"ol": 20}}, headers=_h(user))
        self.assertEqual(r.status_code, 201, r.text)
        self.templates.append(uuid.UUID(r.json()["template"]["id"]))
        return r.json()["template"]["id"]

    def ids(self, user):
        r = client.get("/api/v1/config-templates", headers=_h(user))
        self.assertEqual(r.status_code, 200, r.text)
        return {t["id"] for t in r.json()["templates"]}

    # -- the pump owner is not an installer ---------------------------------------------------------------------------

    def test_the_farmer_cannot_change_protection_settings_or_claim_they_were_applied(self):
        pid = self.make_pump(self.farmer)
        farmer = _h(self.farmer)
        self.assertEqual(client.put(f"/api/v1/pumps/{pid}/config", json={"ol": 140, "ov": 600}, headers=farmer).status_code, 403)
        self.assertEqual(client.post(f"/api/v1/pumps/{pid}/config/report", json={"ol": 140}, headers=farmer).status_code, 403)
        self.assertEqual(client.get(f"/api/v1/pumps/{pid}/config", headers=farmer).status_code, 200, "reading is still allowed")

        # The dealer above him can: same pump, same request.
        saved = client.put(f"/api/v1/pumps/{pid}/config", json={"ol": 25, "ov": 480}, headers=_h(self.dealer))
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(client.get(f"/api/v1/pumps/{pid}/config", headers=_h(self.dealer)).json()["desired"], {"ol": 25, "ov": 480})

    def test_the_farmer_cannot_lift_a_suspension(self):
        pid = self.make_pump(self.farmer, state="SUSPENDED")
        refused = client.put(f"/api/v1/pumps/{pid}/lifecycle", json={"lifecycle_state": "ACTIVE"}, headers=_h(self.farmer))
        self.assertEqual(refused.status_code, 403, refused.text)
        self.db.expire_all()
        self.assertEqual(self.db.query(Pump).filter(Pump.id == pid).one().lifecycle_state, "SUSPENDED")

        lifted = client.put(f"/api/v1/pumps/{pid}/lifecycle", json={"lifecycle_state": "ACTIVE"}, headers=_h(self.dealer))
        self.assertEqual(lifted.status_code, 200, lifted.text)

    # -- templates ----------------------------------------------------------------------------------------------------

    def test_the_farmer_has_no_use_for_templates(self):
        mine = self.make_template(self.dealer)
        pid = self.make_pump(self.farmer)
        farmer = _h(self.farmer)
        self.assertEqual(client.get("/api/v1/config-templates", headers=farmer).status_code, 403)
        self.assertEqual(client.post("/api/v1/config-templates", json={"name": "x", "desired_json": {}}, headers=farmer).status_code, 403)
        self.assertEqual(client.post(f"/api/v1/config-templates/{mine}/apply", json={"pump_ids": [pid]}, headers=farmer).status_code, 403)

    def test_a_template_is_visible_to_its_owner_and_everyone_below_never_to_a_sibling(self):
        from_sa = self.make_template(self.sa, "from-sa")
        from_dealer = self.make_template(self.dealer, "from-dealer")

        self.assertTrue({from_sa, from_dealer} <= self.ids(self.sa))
        self.assertTrue({from_sa, from_dealer} <= self.ids(self.dealer))
        self.assertIn(from_dealer, self.ids(self.sub), "a dealer's template is there for the dealers below it")
        self.assertIn(from_sa, self.ids(self.other), "the platform's template is there for every dealer")
        self.assertNotIn(from_dealer, self.ids(self.other), "a sibling's template is invisible")

    def test_only_the_owner_or_someone_above_can_change_or_delete_it(self):
        mine = self.make_template(self.dealer)
        from_sa = self.make_template(self.sa)

        # Below the owner: sees it, cannot touch it.
        self.assertEqual(client.put(f"/api/v1/config-templates/{mine}", json={"name": "hijacked"}, headers=_h(self.sub)).status_code, 403)
        self.assertEqual(client.delete(f"/api/v1/config-templates/{mine}", headers=_h(self.sub)).status_code, 403)
        # Beside the owner: does not know it exists.
        self.assertEqual(client.put(f"/api/v1/config-templates/{mine}", json={"name": "hijacked"}, headers=_h(self.other)).status_code, 404)
        self.assertEqual(client.delete(f"/api/v1/config-templates/{mine}", headers=_h(self.other)).status_code, 404)
        # A dealer cannot remove the platform's template either.
        self.assertEqual(client.delete(f"/api/v1/config-templates/{from_sa}", headers=_h(self.dealer)).status_code, 403)

        self.assertEqual(client.put(f"/api/v1/config-templates/{mine}", json={"name": "renamed"}, headers=_h(self.dealer)).status_code, 200)
        self.assertEqual(client.delete(f"/api/v1/config-templates/{mine}", headers=_h(self.sa)).status_code, 200, "the platform admin manages all")
        self.assertNotIn(mine, self.ids(self.dealer))

    def test_a_bad_id_is_not_found_not_a_server_error(self):
        self.assertEqual(client.delete("/api/v1/config-templates/not-a-uuid", headers=_h(self.sa)).status_code, 404)

    def test_template_bodies_are_checked(self):
        bad = client.post("/api/v1/config-templates", json={"name": "x", "desired_json": [1, 2]}, headers=_h(self.dealer))
        self.assertEqual(bad.status_code, 422)
        self.assertEqual(client.post("/api/v1/config-templates", json={"name": "   "}, headers=_h(self.dealer)).status_code, 422)
        self.assertEqual(client.post("/api/v1/config-templates", json={"name": "x" * 101}, headers=_h(self.dealer)).status_code, 422)

    # -- applying -----------------------------------------------------------------------------------------------------

    def test_applying_merges_into_the_device_configuration_and_marks_it_pending(self):
        template = self.make_template(self.dealer, settings={"ol": 30, "dr": 2})
        mine = self.make_pump(self.farmer)
        foreign = self.make_pump(self.other_farmer)
        client.put(f"/api/v1/pumps/{mine}/config", json={"ov": 480, "ol": 25}, headers=_h(self.dealer))

        r = client.post(f"/api/v1/config-templates/{template}/apply", json={"pump_ids": [mine, foreign, mine]}, headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        outcome = {x["pump_id"]: x["success"] for x in r.json()["results"]}
        self.assertEqual(outcome, {mine: True, foreign: False}, "a pump outside the caller's scope is refused, not touched; duplicates once")

        cfg = client.get(f"/api/v1/pumps/{mine}/config", headers=_h(self.dealer)).json()
        self.assertEqual(cfg["desired"], {"ov": 480, "ol": 30, "dr": 2}, "the template's keys win, the others stay")
        self.assertEqual(cfg["status"], "PENDING")
        self.db.expire_all()
        self.assertIsNone(self.db.query(DeviceConfig).filter(DeviceConfig.pump_id == foreign).first(), "nothing was written for the foreign pump")

    def test_applying_to_a_pump_with_no_configuration_yet_creates_one(self):
        template = self.make_template(self.dealer, settings={"dr": 3})
        pid = self.make_pump(self.farmer)
        self.assertIsNone(self.db.query(DeviceConfig).filter(DeviceConfig.pump_id == pid).first())
        r = client.post(f"/api/v1/config-templates/{template}/apply", json={"pump_ids": [pid]}, headers=_h(self.dealer))
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(client.get(f"/api/v1/pumps/{pid}/config", headers=_h(self.dealer)).json()["desired"], {"dr": 3})

    def test_apply_requests_are_checked(self):
        template = self.make_template(self.dealer)
        apply = lambda body: client.post(f"/api/v1/config-templates/{template}/apply", json=body, headers=_h(self.dealer))  # noqa: E731
        self.assertEqual(apply({}).status_code, 422)
        self.assertEqual(apply({"pump_ids": "PUMP-1"}).status_code, 422)
        self.assertEqual(apply({"pump_ids": [1, 2]}).status_code, 422)
        self.assertEqual(apply({"pump_ids": [f"P{i}" for i in range(501)]}).status_code, 422)
        # A template that is not yours cannot be applied either.
        theirs = self.make_template(self.other)
        self.assertEqual(client.post(f"/api/v1/config-templates/{theirs}/apply", json={"pump_ids": ["x"]}, headers=_h(self.dealer)).status_code, 404)


if __name__ == "__main__":
    unittest.main()
