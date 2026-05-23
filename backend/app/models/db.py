import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, ForeignKey, UniqueConstraint,
    CheckConstraint, Index, Integer, Boolean, text
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, relationship
from app.config import get_settings


class Base(DeclarativeBase):
    pass


class Atom(Base):
    __tablename__ = "atoms"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    type = Column(String(20), nullable=False)
    key = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    properties = relationship("AtomProperty", back_populates="atom", cascade="all, delete-orphan")
    tags = relationship("AtomTag", back_populates="atom", cascade="all, delete-orphan")
    traces = relationship("Trace", back_populates="atom", cascade="all, delete-orphan")
    relations_from = relationship("AtomRelation", foreign_keys="AtomRelation.from_id", back_populates="from_atom", cascade="all, delete-orphan")
    relations_to = relationship("AtomRelation", foreign_keys="AtomRelation.to_id", back_populates="to_atom", cascade="all, delete-orphan")
    analysis_atoms = relationship("AnalysisAtom", back_populates="atom", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("type", "key", name="uq_atoms_type_key"),
        Index("ix_atoms_type", "type"),
        Index("ix_atoms_key", "key"),
        Index("ix_atoms_created_at", "created_at"),
    )


class AtomProperty(Base):
    __tablename__ = "atom_properties"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    atom_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(50), nullable=False)
    value = Column(Text, nullable=False)
    source_type = Column(String(20), nullable=False)  # 'dictionary' | 'ai' | 'user'
    source_ref = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    atom = relationship("Atom", back_populates="properties")

    __table_args__ = (
        Index("ix_atom_properties_atom_id", "atom_id"),
        Index("ix_atom_properties_kind", "kind"),
    )


class AtomRelation(Base):
    __tablename__ = "atom_relations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    from_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    to_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(30), nullable=False)
    note = Column(JSONB, nullable=True)
    source_type = Column(String(20), nullable=False)  # 'ai' | 'user'
    source_ref = Column(UUID(as_uuid=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    from_atom = relationship("Atom", foreign_keys=[from_id], back_populates="relations_from")
    to_atom = relationship("Atom", foreign_keys=[to_id], back_populates="relations_to")

    __table_args__ = (
        UniqueConstraint("from_id", "to_id", "type", name="uq_atom_relations_from_to_type"),
        CheckConstraint("from_id != to_id", name="ck_atom_relations_no_self"),
        Index("ix_atom_relations_from_id", "from_id"),
        Index("ix_atom_relations_to_id", "to_id"),
        Index("ix_atom_relations_type", "type"),
    )


class AtomTag(Base):
    __tablename__ = "atom_tags"

    atom_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), primary_key=True)
    tag = Column(String(100), primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    atom = relationship("Atom", back_populates="tags")

    __table_args__ = (
        Index("ix_atom_tags_tag", "tag"),
    )


class Trace(Base):
    __tablename__ = "traces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    atom_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), nullable=False)
    action = Column(String(30), nullable=False)
    detail = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    atom = relationship("Atom", back_populates="traces")

    __table_args__ = (
        Index("ix_traces_atom_id", "atom_id"),
        Index("ix_traces_action", "action"),
        Index("ix_traces_created_at", "created_at"),
    )


class Analysis(Base):
    __tablename__ = "analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    input_type = Column(String(20), nullable=False)
    # 'text'|'image'|'jlpt_grammar'|'jlpt_reading'|'jlpt_ordering'|'jlpt_listening'
    input_content = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'in_progress'"))
    # 'in_progress'|'completed'
    session_data = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    analysis_atoms = relationship("AnalysisAtom", back_populates="analysis", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_analyses_status", "status"),
        Index("ix_analyses_input_type", "input_type"),
        Index("ix_analyses_created_at", "created_at"),
    )


class AnalysisAtom(Base):
    __tablename__ = "analysis_atoms"

    analysis_id = Column(UUID(as_uuid=True), ForeignKey("analyses.id", ondelete="CASCADE"), primary_key=True)
    atom_id = Column(UUID(as_uuid=True), ForeignKey("atoms.id", ondelete="CASCADE"), primary_key=True)

    analysis = relationship("Analysis", back_populates="analysis_atoms")
    atom = relationship("Atom", back_populates="analysis_atoms")

    __table_args__ = (
        Index("ix_analysis_atoms_analysis_id", "analysis_id"),
        Index("ix_analysis_atoms_atom_id", "atom_id"),
    )


class ExamPaper(Base):
    __tablename__ = "exam_papers"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title = Column(Text, nullable=False)
    level = Column(String(5), nullable=False)
    source = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    sections = relationship("ExamSection", back_populates="paper", cascade="all, delete-orphan",
                            order_by="ExamSection.seq")

    __table_args__ = (
        UniqueConstraint("title", "level", name="uq_exam_papers_title_level"),
        Index("ix_exam_papers_level", "level"),
    )


class ExamSection(Base):
    __tablename__ = "exam_sections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(50), nullable=False)
    seq = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    paper = relationship("ExamPaper", back_populates="sections")
    problems = relationship("ExamProblem", back_populates="section", cascade="all, delete-orphan",
                            order_by="ExamProblem.seq")

    __table_args__ = (
        Index("ix_exam_sections_paper_id", "paper_id"),
    )


class ExamProblem(Base):
    """問題N — a named group of items sharing one type, instruction, and optional passage."""
    __tablename__ = "exam_problems"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    section_id = Column(UUID(as_uuid=True), ForeignKey("exam_sections.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    name = Column(String(20), nullable=False)
    type = Column(String(30), nullable=False)
    instruction = Column(Text, nullable=True)
    passage = Column(Text, nullable=True)
    transcript = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    section = relationship("ExamSection", back_populates="problems")
    items = relationship("ExamItem", back_populates="problem", cascade="all, delete-orphan",
                         order_by="ExamItem.seq")
    media = relationship("ExamMedia", back_populates="problem", cascade="all, delete-orphan",
                         order_by="ExamMedia.seq")

    __table_args__ = (
        Index("ix_exam_problems_section_id", "section_id"),
        Index("ix_exam_problems_type", "type"),
    )


class ExamItem(Base):
    """Single question within a Problem."""
    __tablename__ = "exam_items"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    problem_id = Column(UUID(as_uuid=True), ForeignKey("exam_problems.id", ondelete="CASCADE"), nullable=False)
    seq = Column(Integer, nullable=False)
    num = Column(Integer, nullable=True)
    stem = Column(Text, nullable=False, server_default=text("''"))
    options = Column(JSONB, nullable=False, server_default=text("'{}'"))
    correct_answer = Column(String(1), nullable=True)
    meta = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    problem = relationship("ExamProblem", back_populates="items")
    analysis = relationship("QuestionAnalysis", back_populates="item", uselist=False,
                            cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_exam_items_problem_id", "problem_id"),
    )


class ExamMedia(Base):
    """Image attachments for a Problem."""
    __tablename__ = "exam_media"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    problem_id = Column(UUID(as_uuid=True), ForeignKey("exam_problems.id", ondelete="CASCADE"), nullable=False)
    media_type = Column(String(10), nullable=False, server_default=text("'image'"))
    url = Column(Text, nullable=False)
    caption = Column(Text, nullable=True)
    seq = Column(Integer, nullable=False, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    problem = relationship("ExamProblem", back_populates="media")

    __table_args__ = (
        Index("ix_exam_media_problem_id", "problem_id"),
    )


class ExamDraft(Base):
    """Temporary ingestion state: AI-generated draft pending human review."""
    __tablename__ = "exam_drafts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    filename = Column(Text, nullable=True)
    markdown_raw = Column(Text, nullable=True)
    draft_json = Column(JSONB, nullable=True)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="SET NULL"),
                      nullable=True)
    status = Column(String(20), nullable=False, server_default=text("'pending'"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    __table_args__ = (
        Index("ix_exam_drafts_status", "status"),
    )


class QuestionAnalysis(Base):
    __tablename__ = "question_analyses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    item_id = Column(UUID(as_uuid=True), ForeignKey("exam_items.id", ondelete="CASCADE"),
                     nullable=False, unique=True)
    session_data = Column(JSONB, nullable=True)
    relations_suggested = Column(JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))

    item = relationship("ExamItem", back_populates="analysis")


class ExamAttempt(Base):
    __tablename__ = "exam_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    paper_id = Column(UUID(as_uuid=True), ForeignKey("exam_papers.id", ondelete="CASCADE"), nullable=False)
    status = Column(String(20), nullable=False, server_default=text("'in_progress'"))
    score = Column(JSONB, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=False, server_default=text("now()"))
    completed_at = Column(DateTime(timezone=True), nullable=True)

    paper = relationship("ExamPaper")
    answers = relationship("AttemptAnswer", back_populates="attempt", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_exam_attempts_paper_id", "paper_id"),
        Index("ix_exam_attempts_status", "status"),
    )


class AttemptAnswer(Base):
    __tablename__ = "attempt_answers"

    attempt_id = Column(UUID(as_uuid=True), ForeignKey("exam_attempts.id", ondelete="CASCADE"),
                        primary_key=True)
    item_id = Column(UUID(as_uuid=True), ForeignKey("exam_items.id", ondelete="CASCADE"),
                     primary_key=True)
    user_answer = Column(String(1), nullable=False)
    is_correct = Column(Boolean, nullable=False)

    attempt = relationship("ExamAttempt", back_populates="answers")
    item = relationship("ExamItem")

    __table_args__ = (
        Index("ix_attempt_answers_attempt_id", "attempt_id"),
    )


# Engine and session factory
def _create_engine():
    settings = get_settings()
    return create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


async_engine = _create_engine()

async_session_factory = async_sessionmaker(
    async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db():
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
