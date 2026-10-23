"""The super admin looking at one manufacturer's portal.

The platform owner sits above every manufacturer. To check how Ajanta's (or Swati's) dashboard looks and what is wrong in
it, the web portal sends `X-View-Manufacturer: <brand key>` and the request is then served as that manufacturer's own
account: the same pumps, farmers, alerts and numbers, and nothing of any other manufacturer.

* Only the super admin can do this; for anyone else the header is ignored (they are already limited to their own tree).
* It is read-only. A write made while viewing is refused, so looking can never change a manufacturer's data. Changes are
  made from the platform's own screens (no header) or by the manufacturer.
* The identity borrowed is the brand's `owner_user_id` account; its scope (hierarchy path / organisation) is what is used.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.models import AppBrand, User

HEADER = "X-View-Manufacturer"

READ_ONLY_METHODS = ("GET", "HEAD", "OPTIONS")

# The platform's own admin endpoints and the sign-in flow always run as the real caller, never as a manufacturer.
_PLATFORM_PATH_PARTS = ("/auth/", "/brands")


def applies_to(path: str) -> bool:
    """False for the paths that must always be answered as the real caller."""
    return not any(part in path for part in _PLATFORM_PATH_PARTS)


def principal_for(db: Session, key: str) -> User:
    """The manufacturer's own account for the brand with this key: the one its `owner_user_id` points at. Never a guess."""
    brand = db.query(AppBrand).filter(AppBrand.key == (key or "").strip().lower()).first()
    if brand is None:
        raise AppError(code="MANUFACTURER_UNKNOWN", message_key="errors.manufacturerUnknown", status_code=404,
                       detail="There is no manufacturer with that key.")
    principal: Optional[User] = db.query(User).filter(User.id == brand.owner_user_id).first() if brand.owner_user_id else None
    if principal is None:
        raise AppError(code="MANUFACTURER_HAS_NO_ACCOUNT", message_key="errors.manufacturerHasNoAccount", status_code=404,
                       detail="This manufacturer has no account yet, so there is no dashboard to show.")
    return principal


def refuse_write(method: str, brand_name: Optional[str] = None) -> None:
    if method.upper() not in READ_ONLY_METHODS:
        raise AppError(code="VIEW_ONLY", message_key="errors.viewOnly", status_code=403,
                       detail="You are viewing a manufacturer's portal as the platform owner, which is read-only. "
                              "Switch back to the platform to make changes.")
