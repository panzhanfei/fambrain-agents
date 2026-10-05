from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from fambrain_kernel.auth.national_id import is_valid_chinese_resident_id, normalize_national_id


class RegisterBody(BaseModel):
    username: str
    password: str
    national_id: str = Field(alias="nationalId")
    display_name: str = Field(alias="displayName")
    relation_to_principal: str = Field(alias="relationToPrincipal")

    model_config = {"populate_by_name": True}

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        cleaned = value.strip()
        if len(cleaned) < 2:
            raise ValueError("用户名至少 2 个字符")
        if len(cleaned) > 32:
            raise ValueError("用户名过长")
        return cleaned.lower()

    @field_validator("password")
    @classmethod
    def password_message(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("密码至少 8 位")
        return value

    @field_validator("national_id")
    @classmethod
    def check_national_id(cls, value: str) -> str:
        normalized = normalize_national_id(value)
        if len(normalized) != 18:
            raise ValueError("身份证号须为 18 位")
        if not is_valid_chinese_resident_id(normalized):
            raise ValueError("身份证号不合法（校验位或出生日期有误）")
        return normalized

    @field_validator("display_name")
    @classmethod
    def clean_display_name(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("请填写称呼")
        if len(cleaned) > 64:
            raise ValueError("称呼过长")
        return cleaned

    @field_validator("relation_to_principal")
    @classmethod
    def clean_relation(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("请填写与本人的关系")
        if len(cleaned) > 64:
            raise ValueError("关系说明过长")
        return cleaned


class LoginBody(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def clean_username(cls, value: str) -> str:
        cleaned = value.strip().lower()
        if not cleaned:
            raise ValueError("用户名或密码无效")
        return cleaned

    @field_validator("password")
    @classmethod
    def password_present(cls, value: str) -> str:
        if not value:
            raise ValueError("用户名或密码无效")
        return value
