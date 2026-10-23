from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.services import brand_service

HEADER = "X-App-Brand"


class BrandMiddleware(BaseHTTPMiddleware):
    """Reads X-App-Brand and keeps the brand for the rest of the request (brand_service.current_brand).

    * No header: nothing changes. That is the web portal, the devices, and any app built before brands existed.
    * A brand that does not exist: 404 BRAND_UNKNOWN. One that was suspended: 403 BRAND_DISABLED, for every request its
      app makes (stopping a manufacturer's app is one switch).
    """

    async def dispatch(self, request: Request, call_next):
        key = request.headers.get(HEADER)
        if not key or request.method == "OPTIONS":
            return await call_next(request)

        brand = brand_service.resolve(key)
        if brand is None:
            return _refuse(404, "BRAND_UNKNOWN", "errors.brand_unknown", "This app is not registered with the server.")
        if not brand.active:
            return _refuse(403, "BRAND_DISABLED", "errors.brand_disabled", "This app has been switched off. Please contact your dealer.")

        request.state.brand = brand
        token = brand_service.current_brand.set(brand)
        try:
            return await call_next(request)
        finally:
            brand_service.current_brand.reset(token)


def _refuse(status: int, code: str, message_key: str, detail: str) -> JSONResponse:
    # Same envelope as AppError: the apps already know how to read it.
    return JSONResponse(
        status_code=status,
        content={"error": {"code": code, "message_key": message_key, "params": {}}, "detail": detail},
    )
