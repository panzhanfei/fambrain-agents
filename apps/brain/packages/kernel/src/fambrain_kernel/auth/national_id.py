from __future__ import annotations

import re

_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
_CHECK_CHARS = ("1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2")
_ID_RE = re.compile(r"^[1-9]\d{16}[\dX]$")


def normalize_national_id(raw: str) -> str:
    return re.sub(r"\s+", "", raw.strip().upper())


def _expected_checksum(first17: str) -> str:
    total = 0
    for index, char in enumerate(first17):
        total += (ord(char) - 48) * _WEIGHTS[index]
    return _CHECK_CHARS[total % 11]


def _reasonable_birth(year: int, month: int, day: int) -> bool:
    from datetime import date

    this_year = date.today().year
    if not (1850 <= year <= this_year and 1 <= month <= 12 and 1 <= day <= 31):
        return False
    try:
        born = date(year, month, day)
    except ValueError:
        return False
    return (born.year, born.month, born.day) == (year, month, day)


def is_valid_chinese_resident_id(normalized_upper: str) -> bool:
    if _ID_RE.fullmatch(normalized_upper) is None:
        return False
    first17 = normalized_upper[:17]
    if _expected_checksum(first17) != normalized_upper[17]:
        return False
    admin = normalized_upper[:6]
    if admin == "000000" or re.fullmatch(r"[1-9]\d{5}", admin) is None:
        return False
    ymd = normalized_upper[6:14]
    year = int(ymd[0:4])
    month = int(ymd[4:6])
    day = int(ymd[6:8])
    return _reasonable_birth(year, month, day)
