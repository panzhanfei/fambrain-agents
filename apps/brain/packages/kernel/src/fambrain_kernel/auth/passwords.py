from pwdlib import PasswordHash

_HASHER = PasswordHash.recommended()


def hash_password(plain: str) -> str:
    return _HASHER.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    if hashed.startswith("$2"):
        import bcrypt

        try:
            return bcrypt.checkpw(plain.encode(), hashed.encode())
        except ValueError:
            return False
    return _HASHER.verify(plain, hashed)
