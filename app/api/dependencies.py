import secrets
from typing import Annotated
from fastapi import Depends, HTTPException, Security, Request, status
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.utils.connection import rate_limiter

settings = get_settings()

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_auth = HTTPBearer(auto_error=False)


def _extract_supplied_key(
    header_key: Annotated[str | None, Security(api_key_header)] = None,
    bearer: Annotated[HTTPAuthorizationCredentials | None, Security(bearer_auth)] = None,
) -> str | None:
    if header_key:
        return header_key
    if bearer:
        return bearer.credentials
    return None


async def require_api_key(supplied_key: Annotated[str | None, Depends(_extract_supplied_key)] = None) -> None:
    try:
        expected_key = settings.require_api_key()
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
    if not supplied_key or not secrets.compare_digest(supplied_key, expected_key):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or missing API key")


async def rate_limit_check(request: Request) -> None:
    client_id = request.headers.get("X-API-Key") or request.client.host if request.client else "unknown"
    if not await rate_limiter.is_allowed(client_id):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded.")
