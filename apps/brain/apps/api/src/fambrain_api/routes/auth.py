from __future__ import annotations

from fambrain_kernel.auth.service import AuthError, AuthOk, login_user, register_user
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from fambrain_api.deps import client_ip, require_actor

router = APIRouter(prefix="/auth")


def _apply_cookie(response: JSONResponse, request: Request, token: str) -> None:
    settings = request.app.state.settings
    response.set_cookie(
        key=settings.auth_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.token_max_age_sec,
        path="/",
        secure=settings.cookie_secure,
    )


@router.post("/register")
async def register(request: Request) -> JSONResponse:
    raw = await request.json()
    result = await register_user(request.app.state.settings, raw, client_ip(request))
    return _auth_response(request, result)


@router.post("/login")
async def login(request: Request) -> JSONResponse:
    raw = await request.json()
    result = await login_user(request.app.state.settings, raw, client_ip(request))
    return _auth_response(request, result)


@router.get("/me")
async def me(request: Request) -> JSONResponse:
    user = await require_actor(request)
    return JSONResponse(
        {
            "id": str(user.id),
            "username": user.username,
            "displayName": user.display_name,
            "role": user.role.value,
            "status": user.status.value,
            "corpusUserId": str(user.corpus_user_id) if user.corpus_user_id else None,
        }
    )


@router.post("/logout")
async def logout(request: Request) -> JSONResponse:
    settings = request.app.state.settings
    response = JSONResponse({"ok": True})
    response.delete_cookie(settings.auth_cookie_name, path="/")
    return response


def _auth_response(request: Request, result: AuthOk | AuthError) -> JSONResponse:
    if isinstance(result, AuthError):
        headers = {}
        if result.retry_after_sec is not None:
            headers["Retry-After"] = str(result.retry_after_sec)
        return JSONResponse(
            {"error": result.error},
            status_code=result.status,
            headers=headers,
        )
    response = JSONResponse(
        {"ok": True, "redirect": result.redirect, "bootstrap": result.bootstrap}
    )
    _apply_cookie(response, request, result.token)
    return response
