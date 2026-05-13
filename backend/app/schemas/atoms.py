from uuid import UUID
from datetime import datetime
from pydantic import BaseModel, field_validator


class PropertyInput(BaseModel):
    kind: str
    value: str


class CreateAtomRequest(BaseModel):
    type: str  # 'vocabulary' | 'grammar'
    key: str
    properties: list[PropertyInput] = []
    analysis_id: UUID | None = None
    force_create: bool = False  # skip similarity check when user confirms "not the same"

    @field_validator("type", mode="before")
    @classmethod
    def normalise_type(cls, v: str) -> str:
        if v == "word":
            return "vocabulary"
        if v not in ("vocabulary", "grammar"):
            raise ValueError(f"atom type must be 'vocabulary' or 'grammar', got {v!r}")
        return v


class AddPropertiesRequest(BaseModel):
    properties: list[PropertyInput]
    analysis_id: UUID | None = None


class CreateRelationRequest(BaseModel):
    target_atom_id: UUID
    type: str
    note: dict | None = None


class PropertyResponse(BaseModel):
    id: UUID
    kind: str
    value: str
    source_type: str
    source_ref: UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class RelationResponse(BaseModel):
    id: UUID
    target: dict  # {id, type, key}
    type: str
    note: dict | None
    direction: str  # 'from' | 'to'
    created_at: datetime

    model_config = {"from_attributes": True}


class AtomListItem(BaseModel):
    id: UUID
    type: str
    key: str
    property_count: int
    relation_count: int
    maturity: float
    created_at: datetime

    model_config = {"from_attributes": True}


class AtomDetail(BaseModel):
    atom: dict
    properties: list[PropertyResponse]
    relations: list[RelationResponse]
    analyses: list[dict]
    traces_summary: dict


class SimilarCandidate(BaseModel):
    atom_id: UUID
    key: str
    meaning: str | None
    score: float


class CreateAtomResponse(BaseModel):
    atom_id: UUID | None
    status: str  # 'created' | 'exists' | 'similar'
    existing_properties: list[PropertyResponse] | None = None
    candidates: list[SimilarCandidate] | None = None
