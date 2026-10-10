from __future__ import annotations

import enum


class UserRole(enum.StrEnum):
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class UserStatus(enum.StrEnum):
    PENDING = "PENDING"
    ACTIVE = "ACTIVE"
    REJECTED = "REJECTED"
