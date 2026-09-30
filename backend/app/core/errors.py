from typing import Optional, Dict, Any
from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse

class AppError(HTTPException):
    """
    Standardized application error (SRS FR-CLD-040).
    Envelopes errors as:
    {
      "error": {
        "code": "COOLDOWN_ACTIVE",
        "message_key": "errors.cooldown",
        "params": {"seconds": 32}
      },
      "detail": "Command cooldown active..."
    }
    """

    def __init__(
        self,
        code: str,
        message_key: str,
        status_code: int = status.HTTP_400_BAD_REQUEST,
        params: Optional[Dict[str, Any]] = None,
        detail: Optional[str] = None,
        headers: Optional[Dict[str, str]] = None
    ):
        self.code = code
        self.message_key = message_key
        self.params = params or {}
        msg = detail or message_key
        super().__init__(status_code=status_code, detail=msg, headers=headers)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "error": {
                "code": self.code,
                "message_key": self.message_key,
                "params": self.params
            },
            "detail": self.detail
        }

async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=exc.to_dict(),
        headers=exc.headers
    )
