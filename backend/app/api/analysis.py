import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.db import Analysis, get_db
from app.schemas.analysis import (
    AnalyzeRequest,
    PreprocessRequest,
    PreprocessResponse,
    FollowupRequest,
    FreeTextResult,
    GrammarQuizResult,
    OrderingQuizResult,
    ReadingResult,
    ListeningResult,
    ComparisonResult,
    UsageResult,
    DerivativeResult,
    ExampleResult,
)
from app.services.preprocessor import preprocessor
from app.services.llm.factory import get_llm_client
from app.prompts.templates import (
    FREE_TEXT_ANALYSIS,
    IMAGE_ANALYSIS,
    JLPT_GRAMMAR_QUIZ,
    JLPT_ORDERING_QUIZ,
    JLPT_READING,
    JLPT_LISTENING,
    FOLLOWUP_COMPARISON,
    FOLLOWUP_USAGE,
    FOLLOWUP_DERIVATIVE,
    FOLLOWUP_EXAMPLE,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["analysis"])

# JSON schemas used as hints for the LLM structured output
_VOCAB_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "surface": {"type": "string"},
        "base": {"type": "string"},
        "reading": {"type": "string"},
        "meaning": {"type": "string"},
        "part_of_speech": {"type": "string", "description": "日文词性名称：名詞/動詞/形容詞/副詞/助詞/助動詞/接続詞 等"},
        "jlpt_level": {"type": "string"},
        "register": {"type": "string"},
        "usage": {"type": "string"},
        "nuance": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["surface", "base", "meaning", "part_of_speech", "example"],
}

_GRAMMAR_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "pattern": {"type": "string"},
        "meaning": {"type": "string"},
        "connection": {"type": "string", "description": "接续方式，如：動詞て形＋、名詞＋の＋"},
        "jlpt_level": {"type": "string"},
        "register": {"type": "string"},
        "usage": {"type": "string", "description": "详细用法说明，必填"},
        "nuance": {"type": "string", "description": "语感/细微差别"},
        "example": {"type": "string", "description": "完整例句（日语），必填"},
    },
    "required": ["pattern", "meaning", "usage", "example"],
}

_SENTENCE_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "index": {"type": "integer"},
        "text": {"type": "string"},
        "translation": {"type": "string"},
        "vocab": {"type": "array", "items": _VOCAB_ITEM_SCHEMA},
        "grammar": {"type": "array", "items": _GRAMMAR_ITEM_SCHEMA},
    },
    "required": ["index", "text", "translation"],
}

_FREE_TEXT_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": _SENTENCE_ANALYSIS_SCHEMA},
    },
    "required": ["sentences"],
}

_OPTION_ANALYSIS_SCHEMA = {
    "type": "object",
    "properties": {
        "option": {"type": "string"},
        "is_correct": {"type": "boolean"},
        "explanation": {"type": "string"},
        "grammar": _GRAMMAR_ITEM_SCHEMA,
    },
    "required": ["option", "is_correct", "explanation", "grammar"],
}

_GRAMMAR_QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "correct_answer": {"type": "string"},
        "completed_sentence": _SENTENCE_ANALYSIS_SCHEMA,
        "options_analysis": {"type": "array", "items": _OPTION_ANALYSIS_SCHEMA},
    },
    "required": ["question", "correct_answer", "completed_sentence", "options_analysis"],
}

_ORDERING_QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "question": {"type": "string"},
        "correct_order": {"type": "array", "items": {"type": "string"}},
        "explanation": {"type": "string"},
        "completed_sentence": _SENTENCE_ANALYSIS_SCHEMA,
    },
    "required": ["question", "correct_order", "explanation", "completed_sentence"],
}

_READING_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": _SENTENCE_ANALYSIS_SCHEMA},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "correct_answer": {"type": "string"},
                    "options_analysis": {"type": "array", "items": _OPTION_ANALYSIS_SCHEMA},
                },
                "required": ["question", "correct_answer", "options_analysis"],
            },
        },
    },
    "required": ["sentences", "questions"],
}

_ORAL_FEATURE_SCHEMA = {
    "type": "object",
    "properties": {
        "expression": {"type": "string"},
        "standard_form": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["expression", "standard_form", "explanation"],
}

_LISTENING_SCHEMA = {
    "type": "object",
    "properties": {
        "sentences": {"type": "array", "items": _SENTENCE_ANALYSIS_SCHEMA},
        "oral_features": {"type": "array", "items": _ORAL_FEATURE_SCHEMA},
    },
    "required": ["sentences", "oral_features"],
}

_COMPARISON_SCHEMA = {
    "type": "object",
    "properties": {
        "atom_a": {"type": "string"},
        "atom_b": {"type": "string"},
        "similarity": {"type": "string"},
        "difference": {"type": "string"},
        "example_a": {"type": "string"},
        "example_b": {"type": "string"},
        "relation_type": {"type": "string"},
    },
    "required": ["atom_a", "atom_b", "similarity", "difference", "example_a", "example_b", "relation_type"],
}

_USAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "atom_key": {"type": "string"},
        "usage": {"type": "string"},
        "register": {"type": "string"},
    },
    "required": ["atom_key", "usage"],
}

_DERIVATIVE_ITEM_SCHEMA = {
    "type": "object",
    "properties": {
        "form": {"type": "string"},
        "register": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["form", "register", "explanation"],
}

_DERIVATIVE_SCHEMA = {
    "type": "object",
    "properties": {
        "atom_key": {"type": "string"},
        "derivatives": {"type": "array", "items": _DERIVATIVE_ITEM_SCHEMA},
    },
    "required": ["atom_key", "derivatives"],
}

_EXAMPLE_SCHEMA = {
    "type": "object",
    "properties": {
        "atom_key": {"type": "string"},
        "examples": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["atom_key", "examples"],
}


def _extract_completed_sentences(buffer: str, already_emitted: int) -> list[dict]:
    """
    Scan *buffer* for complete JSON sentence objects inside a "sentences" array
    and return any that haven't been emitted yet (based on list position).

    Strategy: find the start of the sentences array, then use bracket-depth
    tracking to locate each closed `{...}` object at depth 1.
    """
    # Locate the opening of the sentences array
    marker = '"sentences"'
    marker_pos = buffer.find(marker)
    if marker_pos == -1:
        return []

    array_start = buffer.find('[', marker_pos)
    if array_start == -1:
        return []

    results: list[dict] = []
    pos = array_start + 1
    depth = 0
    obj_start = -1

    while pos < len(buffer):
        ch = buffer[pos]
        if ch == '{':
            if depth == 0:
                obj_start = pos
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and obj_start != -1:
                raw = buffer[obj_start:pos + 1]
                try:
                    obj = json.loads(raw)
                    results.append(obj)
                except json.JSONDecodeError:
                    pass
                obj_start = -1
        elif ch == ']' and depth == 0:
            break
        pos += 1

    return results[already_emitted:]


def _build_prompt(request: AnalyzeRequest) -> tuple[str, dict]:
    """Build the prompt and JSON schema based on analysis type."""
    settings = get_settings()
    input_text = request.text or ""

    if request.type == "image":
        prompt = IMAGE_ANALYSIS.format(
            schema_json=json.dumps(_FREE_TEXT_SCHEMA, ensure_ascii=False),
        )
        return prompt, _FREE_TEXT_SCHEMA

    if request.type in ("text", "image"):
        prompt = FREE_TEXT_ANALYSIS.format(
            input_text=input_text,
            schema_json=json.dumps(_FREE_TEXT_SCHEMA, ensure_ascii=False),
        )
        return prompt, _FREE_TEXT_SCHEMA

    elif request.type == "jlpt_grammar":
        prompt = JLPT_GRAMMAR_QUIZ.format(
            question_text=input_text,
            schema_json=json.dumps(_GRAMMAR_QUIZ_SCHEMA, ensure_ascii=False),
        )
        return prompt, _GRAMMAR_QUIZ_SCHEMA

    elif request.type == "jlpt_ordering":
        prompt = JLPT_ORDERING_QUIZ.format(
            question_text=input_text,
            schema_json=json.dumps(_ORDERING_QUIZ_SCHEMA, ensure_ascii=False),
        )
        return prompt, _ORDERING_QUIZ_SCHEMA

    elif request.type == "jlpt_reading":
        prompt = JLPT_READING.format(
            passage_text=input_text,
            questions="",
            schema_json=json.dumps(_READING_SCHEMA, ensure_ascii=False),
        )
        return prompt, _READING_SCHEMA

    elif request.type == "jlpt_listening":
        prompt = JLPT_LISTENING.format(
            transcript=input_text,
            schema_json=json.dumps(_LISTENING_SCHEMA, ensure_ascii=False),
        )
        return prompt, _LISTENING_SCHEMA

    else:
        # Default to free text
        prompt = FREE_TEXT_ANALYSIS.format(
            target_level=settings.TARGET_LEVEL,
            input_text=input_text,
            schema_json=json.dumps(_FREE_TEXT_SCHEMA, ensure_ascii=False),
        )
        return prompt, _FREE_TEXT_SCHEMA


# ---------------------------------------------------------------------------
# POST /preprocess
# ---------------------------------------------------------------------------

@router.post("/preprocess", response_model=PreprocessResponse)
async def preprocess_text(request: PreprocessRequest):
    """Local morphological analysis only — no DB, no AI."""
    return preprocessor.preprocess(request.text)


# ---------------------------------------------------------------------------
# POST /analyze  (SSE stream)
# ---------------------------------------------------------------------------

@router.post("/analyze")
async def analyze(request: AnalyzeRequest, db: AsyncSession = Depends(get_db)):
    """
    Create analysis record, stream AI response sentence-by-sentence via SSE.
    Each event carries a SentenceAnalysis JSON object.
    """
    input_content = request.text or request.image or ""
    analysis_record = Analysis(
        input_type=request.type,
        input_content=input_content,
        status="in_progress",
        session_data=None,
    )
    db.add(analysis_record)
    await db.flush()
    analysis_id = analysis_record.id
    await db.commit()

    prompt, schema = _build_prompt(request)
    llm = get_llm_client()

    def _strip_code_fence(text: str) -> str:
        """Remove optional ```json ... ``` wrapper that models sometimes add."""
        stripped = text.strip()
        if stripped.startswith("```"):
            stripped = stripped.split("\n", 1)[-1]  # drop first line (```json)
            if stripped.endswith("```"):
                stripped = stripped[: stripped.rfind("```")]
        return stripped.strip()

    async def event_generator():
        full_json = ""
        error_occurred = False
        emitted_sentences: list[dict] = []

        try:
            async for chunk in llm.analyze_stream(prompt, schema, image_base64=request.image):
                full_json += chunk
                yield {"event": "chunk", "data": chunk}

                # For free-text/image, extract and emit each sentence as it completes.
                # We scan the accumulated buffer for complete JSON objects inside
                # the "sentences" array using a bracket-depth tracker.
                if request.type in ("text", "image"):
                    new_sentences = _extract_completed_sentences(full_json, len(emitted_sentences))
                    for sentence in new_sentences:
                        emitted_sentences.append(sentence)
                        yield {"event": "sentence", "data": json.dumps(sentence, ensure_ascii=False)}

            # Stream complete — parse full JSON for final bookkeeping / non-text types
            try:
                parsed = json.loads(_strip_code_fence(full_json))

                if request.type in ("text", "image"):
                    # Emit any sentences not yet emitted (edge case: last sentence
                    # may have been missed if the closing bracket came in same chunk)
                    all_sentences = parsed.get("sentences", [])
                    emitted_indices = {s.get("index") for s in emitted_sentences}
                    for sentence in all_sentences:
                        if sentence.get("index") not in emitted_indices:
                            emitted_sentences.append(sentence)
                            yield {"event": "sentence", "data": json.dumps(sentence, ensure_ascii=False)}
                else:
                    # Non-free-text: the root object is the result
                    sentences = parsed.get("sentences", [])
                    if not sentences:
                        sentences = [parsed] if parsed else []
                    for sentence in sentences:
                        yield {"event": "sentence", "data": json.dumps(sentence, ensure_ascii=False)}

                async with db.begin():  # type: ignore[attr-defined]
                    await db.execute(
                        update(Analysis)
                        .where(Analysis.id == analysis_id)
                        .values(status="completed", session_data=parsed)
                    )

            except json.JSONDecodeError as parse_err:
                logger.error("Failed to parse AI result for analysis %s: %s", analysis_id, parse_err)
                if request.type in ("text", "image") and not emitted_sentences:
                    fallback_sentences = preprocessor.preprocess(request.text or "").sentences
                    for s in fallback_sentences:
                        data = s.model_dump()
                        data.setdefault("translation", "")
                        data.setdefault("vocab", [])
                        data.setdefault("grammar", [])
                        yield {"event": "sentence", "data": json.dumps(data, ensure_ascii=False)}
                elif not emitted_sentences:
                    yield {"event": "error", "data": json.dumps({"message": "AI response parse failed"})}
                error_occurred = True

        except Exception as e:
            logger.error("AI stream error for analysis %s: %s", analysis_id, e)
            if request.type in ("text", "image") and not emitted_sentences:
                try:
                    fallback_sentences = preprocessor.preprocess(request.text or "").sentences
                    for s in fallback_sentences:
                        data = s.model_dump()
                        data.setdefault("translation", "")
                        data.setdefault("vocab", [])
                        data.setdefault("grammar", [])
                        yield {"event": "sentence", "data": json.dumps(data, ensure_ascii=False)}
                except Exception as fallback_err:
                    logger.error("Fallback also failed: %s", fallback_err)
                    yield {"event": "error", "data": json.dumps({"message": str(e)})}
            else:
                yield {"event": "error", "data": json.dumps({"message": str(e)})}
            error_occurred = True

        if not error_occurred:
            yield {"event": "done", "data": json.dumps({"analysis_id": str(analysis_id)})}
        else:
            try:
                async with db:
                    await db.execute(
                        update(Analysis)
                        .where(Analysis.id == analysis_id)
                        .values(status="completed")
                    )
                    await db.commit()
            except Exception:
                pass

    return EventSourceResponse(event_generator())


# ---------------------------------------------------------------------------
# POST /analyses/{id}/followup
# ---------------------------------------------------------------------------

@router.post("/analyses/{analysis_id}/followup")
async def followup(
    analysis_id: UUID,
    request: FollowupRequest,
    db: AsyncSession = Depends(get_db),
):
    """Run a follow-up AI query against an existing analysis."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    template = request.template
    params = request.params
    llm = get_llm_client()

    if template == "comparison":
        schema_json = json.dumps(_COMPARISON_SCHEMA, ensure_ascii=False)
        prompt = FOLLOWUP_COMPARISON.format(
            atom_a=params.get("atom_a", ""),
            atom_b=params.get("atom_b", ""),
            schema_json=schema_json,
        )
        schema = _COMPARISON_SCHEMA
        result_data = await llm.analyze(prompt, schema)
        parsed_result = ComparisonResult(**result_data)

    elif template == "usage":
        schema_json = json.dumps(_USAGE_SCHEMA, ensure_ascii=False)
        prompt = FOLLOWUP_USAGE.format(
            atom_key=params.get("atom_key", ""),
            schema_json=schema_json,
        )
        schema = _USAGE_SCHEMA
        result_data = await llm.analyze(prompt, schema)
        parsed_result = UsageResult(**result_data)

    elif template == "derivative":
        schema_json = json.dumps(_DERIVATIVE_SCHEMA, ensure_ascii=False)
        prompt = FOLLOWUP_DERIVATIVE.format(
            atom_key=params.get("atom_key", ""),
            schema_json=schema_json,
        )
        schema = _DERIVATIVE_SCHEMA
        result_data = await llm.analyze(prompt, schema)
        parsed_result = DerivativeResult(**result_data)

    elif template == "example":
        schema_json = json.dumps(_EXAMPLE_SCHEMA, ensure_ascii=False)
        prompt = FOLLOWUP_EXAMPLE.format(
            atom_key=params.get("atom_key", ""),
            schema_json=schema_json,
        )
        schema = _EXAMPLE_SCHEMA
        result_data = await llm.analyze(prompt, schema)
        parsed_result = ExampleResult(**result_data)

    elif template == "free":
        free_prompt = params.get("prompt", "")
        raw = await llm.complete(free_prompt)
        result_data = {"response": raw}
        parsed_result = result_data  # plain dict for free template

    else:
        raise HTTPException(status_code=400, detail=f"Unknown followup template: {template}")

    # Append result to session_data
    existing_session = analysis.session_data or {}
    followups = existing_session.get("followups", [])
    followup_entry = {
        "template": template,
        "params": params,
        "result": result_data,
    }
    followups.append(followup_entry)
    existing_session["followups"] = followups

    await db.execute(
        update(Analysis)
        .where(Analysis.id == analysis_id)
        .values(session_data=existing_session)
    )
    await db.commit()

    if hasattr(parsed_result, "model_dump"):
        return parsed_result.model_dump()
    return parsed_result


# ---------------------------------------------------------------------------
# POST /analyses/{id}/complete
# ---------------------------------------------------------------------------

@router.post("/analyses/{analysis_id}/complete")
async def complete_analysis(analysis_id: UUID, db: AsyncSession = Depends(get_db)):
    """Mark analysis as completed and clear session_data."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    await db.execute(
        update(Analysis)
        .where(Analysis.id == analysis_id)
        .values(status="completed", session_data=None)
    )
    await db.commit()
    return {"status": "completed"}


# ---------------------------------------------------------------------------
# GET /analyses
# ---------------------------------------------------------------------------

@router.get("/analyses")
async def list_analyses(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List analyses with optional status filter and pagination."""
    query = select(Analysis).order_by(Analysis.created_at.desc())
    if status:
        query = query.where(Analysis.status == status)

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    analyses = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "input_type": a.input_type,
            "input_content": a.input_content[:200] if a.input_content else "",
            "status": a.status,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in analyses
    ]


# ---------------------------------------------------------------------------
# GET /analyses/{id}
# ---------------------------------------------------------------------------

@router.get("/analyses/{analysis_id}")
async def get_analysis(analysis_id: UUID, db: AsyncSession = Depends(get_db)):
    """Return full analysis record."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "id": str(analysis.id),
        "input_type": analysis.input_type,
        "input_content": analysis.input_content,
        "status": analysis.status,
        "session_data": analysis.session_data,
        "created_at": analysis.created_at.isoformat() if analysis.created_at else None,
    }


# ---------------------------------------------------------------------------
# DELETE /analyses/{id}
# ---------------------------------------------------------------------------

@router.delete("/analyses/{analysis_id}", status_code=204)
async def delete_analysis(analysis_id: UUID, db: AsyncSession = Depends(get_db)):
    """Delete an analysis and cascade to analysis_atoms."""
    result = await db.execute(select(Analysis).where(Analysis.id == analysis_id))
    analysis = result.scalar_one_or_none()
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")

    await db.delete(analysis)
    await db.commit()
