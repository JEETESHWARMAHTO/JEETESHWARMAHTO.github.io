"""Pydantic request/response models for the Contact Book API."""
from typing import Optional

from pydantic import BaseModel, Field


class ContactBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, examples=["Aarav Sharma"])
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=120)
    company: str = Field(default="", max_length=120)
    address: str = Field(default="", max_length=240)
    notes: str = Field(default="", max_length=1000)
    # Avatar photo stored as a data-URL (phase 1). Later: Supabase Storage URL.
    avatar: str = Field(default="", max_length=2_000_000)
    favorite: bool = False
    group: str = Field(default="", max_length=60)


class ContactCreate(ContactBase):
    """Payload used when adding a new contact."""


class ContactUpdate(BaseModel):
    """Partial update payload - only sent fields are changed."""
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    phone: Optional[str] = Field(default=None, max_length=40)
    email: Optional[str] = Field(default=None, max_length=120)
    company: Optional[str] = Field(default=None, max_length=120)
    address: Optional[str] = Field(default=None, max_length=240)
    notes: Optional[str] = Field(default=None, max_length=1000)
    avatar: Optional[str] = Field(default=None, max_length=2_000_000)
    favorite: Optional[bool] = None
    group: Optional[str] = Field(default=None, max_length=60)


class ContactOut(ContactBase):
    id: int
    created_at: str
    updated_at: str
    # Owner of the row (null = shared dev row); set from the auth token only.
    user_id: Optional[str] = None

    model_config = {"from_attributes": True}


# --------------------------------------------------------------------- auth
class AuthCredentials(BaseModel):
    """Signup / login payload: email + password (validated in app.py)."""
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)


class AuthRefresh(BaseModel):
    """Refresh payload: the refresh_token issued at login/signup."""
    refresh_token: str = Field(..., max_length=512)
