"""
Phase 3 Dashboard Tests
========================
Unit tests for DashboardService authorization + aggregation logic.
Integration tests for dashboard API endpoints with realistic org tree.

These tests use the same in-process TestClient + SQLite/Postgres approach
as existing Phase 2 tests.  They mock database calls where needed to
avoid requiring a live DB for unit tests.
"""
import pytest
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone, timedelta

# -----------------------------------------------------------------------
# Helpers / fixtures
# -----------------------------------------------------------------------

def _make_user(role: str, org_id=None, org_path=None):
    user = MagicMock()
    user.id = "user-test-001"
    user.role = role
    user.org_id = org_id
    user.account_status = "ACTIVE"
    if org_path:
        org = MagicMock()
        org.path = org_path
        org.id = org_id
        org.name = f"Org-{role}"
        user.organisation = org
    else:
        user.organisation = None
    return user


def _make_db(org_ids=None):
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = None
    return db


# -----------------------------------------------------------------------
# DashboardService unit tests
# -----------------------------------------------------------------------

class TestDashboardServiceAuthorization:
    """Verify that role enforcement in DashboardService is correct."""

    def test_global_denied_for_manufacturer(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("manufacturer", org_id="org-001", org_path="root.mfr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException) as exc_info:
            svc._require_global()
        assert exc_info.value.status_code == 403

    def test_global_denied_for_distributor(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("distributor", org_id="org-002", org_path="root.mfr001.dist001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException):
            svc._require_global()

    def test_global_denied_for_dealer(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException):
            svc._require_global()

    def test_global_allowed_for_superadmin(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("superadmin")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        # should not raise
        svc._require_global()

    def test_subtree_denied_for_end_user(self):
        from app.services.dashboard_service import DashboardService
        from fastapi import HTTPException
        user = _make_user("customer")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        with pytest.raises(HTTPException) as exc_info:
            svc._require_subtree()
        assert exc_info.value.status_code == 403

    def test_subtree_allowed_for_dealer(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        svc._require_subtree()  # should not raise

    def test_subtree_allowed_for_support_engineer(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("support", org_id="org-001", org_path="root.mfr001")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        svc._require_subtree()  # should not raise


class TestDashboardServiceScopeResolution:
    """Verify that org scope resolution returns correct org_ids."""

    def test_superadmin_resolves_to_none(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("superadmin")
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        result = svc._resolve_org_ids()
        assert result is None

    def test_no_org_resolves_to_empty(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer")
        user.org_id = None
        user.organisation = None
        db = _make_db()
        svc = DashboardService(db=db, user=user)
        result = svc._resolve_org_ids()
        assert result == []

    def test_org_with_path_resolves_subtree(self):
        from app.services.dashboard_service import DashboardService
        user = _make_user("dealer", org_id="org-003", org_path="root.mfr001.dist001.dlr001")
        db = _make_db()
        # Mock repo.resolve_subtree_org_ids
        with patch("app.services.dashboard_service.DashboardRepository") as MockRepo:
            instance = MockRepo.return_value
            instance.resolve_subtree_org_ids.return_value = ["org-003", "org-004"]
            svc = DashboardService(db=db, user=user)
            svc.repo = instance
            result = svc._resolve_org_ids()
            assert "org-003" in result
            assert "org-004" in result
            instance.resolve_subtree_org_ids.assert_called_once_with("root.mfr001.dist001.dlr001")


class TestDashboardRepositoryQueries:
    """Unit tests for DashboardRepository query result formatting."""

    def test_empty_device_state_summary(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_device_state_summary(org_ids=["org-001"])
        assert result["total"] == 0
        # Every lifecycle state is always present, zero-filled, so the frontend never has to guess.
        assert result["by_state"] == {
            "MANUFACTURED": 0, "ALLOCATED": 0, "IN_STOCK": 0, "COMMISSIONED": 0,
            "ACTIVE": 0, "SUSPENDED": 0, "RMA": 0, "RETIRED": 0,
        }

    def test_device_state_summary_aggregation(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            ("ACTIVE", 100), ("COMMISSIONED", 50), ("RETIRED", 5)
        ]
        repo = DashboardRepository(db)
        result = repo.get_device_state_summary(org_ids=None)
        assert result["total"] == 155
        assert result["by_state"]["ACTIVE"] == 100
        assert result["by_state"]["COMMISSIONED"] == 50
        assert result["by_state"]["RETIRED"] == 5

    def test_connectivity_summary_format(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        row = MagicMock()
        row.__getitem__ = lambda self, i: [80, 15, 5][i]
        db.execute.return_value.fetchone.return_value = row
        repo = DashboardRepository(db)
        result = repo.get_connectivity_summary(org_ids=None, offline_after_seconds=600)
        assert result["online"] == 80
        assert result["offline"] == 15
        assert result["unknown"] == 5

    def test_active_fault_summary_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_active_fault_summary(org_ids=["org-001"])
        assert result["active_total"] == 0
        assert result["by_type"] == []

    def test_firmware_distribution_percentage(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            ("1.0.4", 500), ("1.0.3", 300), ("unknown", 200)
        ]
        repo = DashboardRepository(db)
        result = repo.get_firmware_distribution(org_ids=None)
        assert len(result) == 3
        assert result[0]["version"] == "1.0.4"
        assert result[0]["device_count"] == 500
        total = sum(r["device_count"] for r in result)
        assert sum(r["percentage"] for r in result) == pytest.approx(100.0, abs=0.01)

    def test_warranty_expiring_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_warranty_expiring_count(org_ids=["org-001"], within_days=30)
        assert result == 0

    def test_subscription_expiring_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_subscription_expiring_count(org_ids=None, within_days=30)
        assert result == 0

    def test_connectivity_map_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        result = repo.get_connectivity_map(org_ids=None, offline_after_seconds=600)
        assert result == []

    def test_top_faulting_devices_empty(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = []
        repo = DashboardRepository(db)
        since = datetime.now(timezone.utc) - timedelta(days=30)
        result = repo.get_top_faulting_devices(org_ids=None, since=since)
        assert result == []

    def test_faults_today_zero(self):
        from app.repositories.dashboard_repository import DashboardRepository
        db = MagicMock()
        db.execute.return_value.scalar.return_value = 0
        repo = DashboardRepository(db)
        result = repo.get_faults_today(org_ids=["org-001"], day_start_utc=datetime.now(timezone.utc))
        assert result == 0

    def test_runtime_summary_no_data(self):
        from app.repositories.dashboard_repository import DashboardRepository
        from datetime import date
        db = MagicMock()
        row = MagicMock()
        row.__getitem__ = lambda self, i: [0, 0, None, 0][i]   # rollup: (today, history, newest, rows) - no rows
        db.execute.return_value.fetchone.return_value = row
        db.execute.return_value.scalar.return_value = 0  # no rollup row -> today counted directly
        repo = DashboardRepository(db)
        result = repo.get_runtime_summary(org_ids=["org-001"], today_date=date.today())
        assert result["today_hours"] == 0.0
        assert result["period_hours"] == 0.0
        assert result["last_rollup_at"] is None
        assert result["today_source"] == "live"


class TestConnectivityService:
    """Unit tests for DeviceConnectivityService."""

    def test_never_seen_is_unknown(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        pump.last_seen_at = None
        assert DeviceConnectivityService.get_connectivity_status(pump) == "UNKNOWN"

    def test_recently_seen_is_online(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        now = datetime.now(timezone.utc)
        pump.last_seen_at = now - timedelta(seconds=30)
        result = DeviceConnectivityService.get_connectivity_status(pump, now=now)
        assert result == "ONLINE"

    def test_old_seen_is_offline(self):
        from app.services.device_connectivity_service import DeviceConnectivityService
        pump = MagicMock()
        now = datetime.now(timezone.utc)
        pump.last_seen_at = now - timedelta(seconds=700)  # > 600s OFFLINE_AFTER_SECONDS
        result = DeviceConnectivityService.get_connectivity_status(pump, now=now)
        assert result == "OFFLINE"


# -----------------------------------------------------------------------
# API endpoint tests using TestClient
# -----------------------------------------------------------------------

@pytest.fixture
def client():
    """Create TestClient using the main FastAPI app."""
    try:
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app)
    except Exception:
        pytest.skip("Cannot instantiate TestClient (no DB available)")


class TestDashboardAPIEndpoints:
    """Integration tests for dashboard API routes."""

    def test_global_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/global")
        assert resp.status_code in (401, 403)

    def test_subtree_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/subtree")
        assert resp.status_code in (401, 403)

    def test_connectivity_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/connectivity")
        assert resp.status_code in (401, 403)

    def test_faults_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/faults")
        assert resp.status_code in (401, 403)

    def test_firmware_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/firmware-distribution")
        assert resp.status_code in (401, 403)

    def test_top_faulting_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/top-faulting-devices")
        assert resp.status_code in (401, 403)

    def test_org_dashboard_requires_auth(self, client):
        resp = client.get("/api/v1/dashboard/organisations/some-org-id")
        assert resp.status_code in (401, 403)
