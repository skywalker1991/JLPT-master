import asyncio
import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sse_starlette.sse import EventSourceResponse
from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import Analysis, async_session_factory, get_db
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
    FOLLOWUP_ASK,
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
    tracking to locate each closed `{...}` object at depth 1. Braces inside
    JSON strings are ignored.
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
    in_string = False
    escaped = False

    while pos < len(buffer):
        ch = buffer[pos]
        if in_string:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == '{':
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


def _build_free_text_prompt(sentences: dict[int, str]) -> str:
    """Prompt for analysing pre-split sentences, keyed by their index."""
    numbered = "\n".join(f"[{i}] {text}" for i, text in sentences.items())
    return FREE_TEXT_ANALYSIS.format(
        input_text=numbered,
        sentence_count=len(sentences),
        schema_json=json.dumps(_FREE_TEXT_SCHEMA, ensure_ascii=False),
    )


def _build_prompt(request: AnalyzeRequest) -> tuple[str, dict]:
    """Build the prompt and JSON schema based on analysis type."""
    input_text = request.text or ""

    if request.type == "image":
        prompt = IMAGE_ANALYSIS.format(
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
        sentences = dict(enumerate(preprocessor.split_sentences(input_text)))
        return _build_free_text_prompt(sentences), _FREE_TEXT_SCHEMA


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

class _Job:
    """
    An in-flight analysis. It runs as a background task, independent of any
    HTTP connection, so a client that disconnects (e.g. a phone putting the
    tab in the background) doesn't abort it; the client can re-attach later
    by polling GET /analyses/{id}, which sees progress saved per sentence.
    """

    def __init__(self, analysis_id: UUID, by_index: bool):
        self.analysis_id = analysis_id
        self.by_index = by_index  # text mode: sentences keyed by source index
        self.events: list[dict] = []
        self.done = False
        self._changed = asyncio.Event()

    def push(self, event: dict):
        self.events.append(event)
        self._wake()

    def finish(self):
        self.done = True
        self._wake()

    def _wake(self):
        self._changed.set()
        self._changed = asyncio.Event()

    async def wait_change(self):
        await self._changed.wait()


# Running jobs, keyed by analysis id. Single-process only (one uvicorn worker);
# jobs are lost on restart, and their records then read as "interrupted".
_jobs: dict[UUID, _Job] = {}
_background_tasks: set[asyncio.Task] = set()
_session_factory = async_session_factory


def _effective_status(analysis: Analysis) -> str:
    if analysis.status == "in_progress" and analysis.id not in _jobs:
        return "interrupted"
    return analysis.status


async def _run_job(job: _Job, request: AnalyzeRequest):
    progress: dict = {}
    try:
        async with _session_factory() as db:
            async for event in _build_event_stream(request, job.analysis_id, db):
                job.push(event)
                if event.get("event") != "sentence":
                    continue
                sentence = json.loads(event["data"])
                progress[sentence.get("index") if job.by_index else len(progress)] = sentence
                ordered = [progress[k] for k in sorted(progress)] if job.by_index else list(progress.values())
                await db.execute(
                    update(Analysis)
                    .where(Analysis.id == job.analysis_id, Analysis.status == "in_progress")
                    .values(session_data={"sentences": ordered})
                )
                await db.commit()
    except Exception as e:
        logger.exception("Analysis job %s failed", job.analysis_id)
        job.push({"event": "error", "data": json.dumps({"message": str(e)})})
    finally:
        job.finish()
        _jobs.pop(job.analysis_id, None)


async def _relay(job: _Job):
    """Stream a job's events to one client; disconnecting only ends this relay."""
    yield {"event": "start", "data": json.dumps({"analysis_id": str(job.analysis_id)})}
    sent = 0
    while True:
        while sent < len(job.events):
            yield job.events[sent]
            sent += 1
        if job.done:
            return
        await job.wait_change()


@router.post("/analyze")
async def analyze(request: AnalyzeRequest, db: AsyncSession = Depends(get_db)):
    """
    Create an analysis record, start the analysis as a background job and
    stream its events via SSE (first a "start" event carrying analysis_id,
    then one "sentence" event per SentenceAnalysis, then "done").
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

    job = _Job(analysis_id, by_index=request.type == "text")
    _jobs[analysis_id] = job
    task = asyncio.create_task(_run_job(job, request))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return EventSourceResponse(_relay(job))


def _build_event_stream(request: AnalyzeRequest, analysis_id: UUID, db: AsyncSession):
    """Event generator that performs the analysis and saves the final result."""
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

    async def _save_session(session_data: dict | None):
        try:
            await db.execute(
                update(Analysis)
                .where(Analysis.id == analysis_id)
                .values(status="completed", session_data=session_data)
            )
            await db.commit()
        except Exception as save_err:
            logger.error("Failed to save analysis %s: %s", analysis_id, save_err)

    async def text_event_generator():
        """
        Free-text mode: sentence segmentation is owned by the backend so every
        input sentence is guaranteed to come back exactly once, keyed by index.
        The LLM may still merge, skip or run out of output for some sentences;
        those are re-requested once, and anything still missing is emitted as
        text-only so the sentence is never silently dropped.
        """
        source = dict(enumerate(preprocessor.split_sentences(request.text or "")))
        results: dict[int, dict] = {}

        def accept(raw: dict) -> dict | None:
            # Exact text match wins (guards against off-by-one indexes);
            # otherwise trust the index the model reported.
            text = (raw.get("text") or "").strip()
            idx = next((i for i, t in source.items() if t == text and i not in results), None)
            if idx is None:
                idx = raw.get("index")
                if not isinstance(idx, int) or idx not in source or idx in results:
                    return None
            sentence = {
                **raw,
                "index": idx,
                "text": source[idx],
                "translation": raw.get("translation") or "",
                "vocab": raw.get("vocab") or [],
                "grammar": raw.get("grammar") or [],
            }
            results[idx] = sentence
            return sentence

        async def run_pass(targets: dict[int, str]):
            buffer = ""
            seen = 0
            async for chunk in llm.analyze_stream(_build_free_text_prompt(targets), _FREE_TEXT_SCHEMA):
                buffer += chunk
                new = _extract_completed_sentences(buffer, seen)
                seen += len(new)
                for raw in new:
                    sentence = accept(raw)
                    if sentence is not None:
                        yield sentence

        for attempt in range(2):
            missing = {i: t for i, t in source.items() if i not in results}
            if not missing:
                break
            if attempt > 0:
                logger.warning(
                    "Analysis %s: retrying %d missing sentences: %s",
                    analysis_id, len(missing), sorted(missing),
                )
            try:
                async for sentence in run_pass(missing):
                    yield {"event": "sentence", "data": json.dumps(sentence, ensure_ascii=False)}
            except Exception as e:
                logger.error("AI stream error for analysis %s: %s", analysis_id, e)

        for i, text in source.items():
            if i not in results:
                logger.warning("Analysis %s: sentence %d left unanalysed", analysis_id, i)
                sentence = {"index": i, "text": text, "translation": "", "vocab": [], "grammar": []}
                results[i] = sentence
                yield {"event": "sentence", "data": json.dumps(sentence, ensure_ascii=False)}

        await _save_session({"sentences": [results[i] for i in sorted(results)]})
        yield {"event": "done", "data": json.dumps({"analysis_id": str(analysis_id)})}

    if request.type == "text":
        return text_event_generator()

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

    return event_generator()


def _ask_targets(params: dict) -> list[dict]:
    """Referenced items of an ask: [{'kind': 'vocab'|'grammar', 'key': str}].
    Also reads the older single-target shape (kind/target)."""
    if isinstance(params.get("targets"), list):
        return [t for t in params["targets"] if isinstance(t, dict) and t.get("kind") in ("vocab", "grammar") and t.get("key")]
    if params.get("kind") in ("vocab", "grammar") and params.get("target"):
        return [{"kind": params["kind"], "key": params["target"]}]
    return []


# A question can be about the passage ("what does this term mean here?"),
# not just the sentence, so send surrounding text as context: the whole
# passage while it is short, otherwise a window around the sentence.
_CONTEXT_CHARS = 1200
_CONTEXT_WINDOW = 2


def _ask_context(session_data: dict, source_text: str, idx: int) -> str:
    text = (source_text or "").strip()
    if text and len(text) <= _CONTEXT_CHARS:
        return text
    sentences = session_data.get("sentences") or []
    lo, hi = max(0, idx - _CONTEXT_WINDOW), min(len(sentences), idx + _CONTEXT_WINDOW + 1)
    window = "".join(s.get("text", "") for s in sentences[lo:hi])
    if not window:
        return text[:_CONTEXT_CHARS]
    return ("…" if lo > 0 else "") + window + ("…" if hi < len(sentences) else "")


def _build_ask_prompt(session_data: dict, params: dict, source_text: str = "") -> str | None:
    """
    Prompt for a free follow-up question on one sentence. params:
    sentence_index, question, and optional targets — vocab/grammar items of
    that sentence the question is about (none = the sentence as a whole).
    The surrounding passage and the sentence's earlier Q&A are included, so
    questions about content or terminology work and follow-ups keep context.
    Returns None if the sentence or a referenced item isn't found.
    """
    sentences = session_data.get("sentences") or []
    idx = params.get("sentence_index")
    question = (params.get("question") or "").strip()
    if not isinstance(idx, int) or not 0 <= idx < len(sentences) or not question:
        return None
    sentence = sentences[idx]

    item_lines, names = [], []
    for t in _ask_targets(params):
        field, label = ("surface", "单词") if t["kind"] == "vocab" else ("pattern", "语法")
        item = next((it for it in sentence.get(t["kind"]) or [] if it.get(field) == t["key"]), None)
        if item is None:
            return None
        info_keys = (
            ("reading", "meaning", "part_of_speech", "usage", "nuance")
            if t["kind"] == "vocab" else ("meaning", "connection", "usage", "nuance")
        )
        info = "；".join(f"{item[k]}" for k in info_keys if item.get(k)) or "（无）"
        names.append(f"{label}「{t['key']}」")
        item_lines.append(f"{label}「{t['key']}」已有的解析：{info}")

    if names:
        subject = "其中的" + "、".join(names)
        focus = f"{'、'.join(names)}在这句话里的意思和用法"
    else:
        subject, focus = "这句话", "这句话的意思、结构和表达"

    earlier = [
        f for f in session_data.get("followups") or []
        if f.get("template") == "ask" and f.get("params", {}).get("sentence_index") == idx
    ][-4:]
    history = ""
    if earlier:
        history = "\n这句话之前的问答：\n" + "\n".join(
            f"问：{f['params'].get('question', '')}\n答：{(f.get('result') or {}).get('response', '')}" for f in earlier
        ) + "\n"

    context = _ask_context(session_data, source_text, idx)
    known = [v.get("surface") for v in sentence.get("vocab") or []] + [g.get("pattern") for g in sentence.get("grammar") or []]
    return FOLLOWUP_ASK.format(
        context=f"这段文字（上下文）：\n{context}\n\n" if context else "",
        subject=subject, focus=focus,
        item_line="".join(line + "\n" for line in item_lines), history=history,
        sentence=sentence.get("text", ""), translation=sentence.get("translation", ""),
        question=question, known_items="、".join(k for k in known if k) or "（无）",
    )


def _parse_ask_answer(raw: str, known: set[str]) -> dict:
    """{"answer", "new_items"} from the model; plain text if it isn't JSON."""
    text = raw.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0]
    try:
        data = json.loads(text)
        answer = str(data.get("answer") or "").strip()
    except (json.JSONDecodeError, AttributeError):
        return {"response": raw.strip(), "new_items": []}
    items = []
    for it in data.get("new_items") or []:
        if not isinstance(it, dict):
            continue
        kind, key, meaning = it.get("kind"), (it.get("key") or "").strip(), (it.get("meaning") or "").strip()
        if kind not in ("vocab", "grammar") or not key or not meaning or key in known:
            continue
        items.append({"kind": kind, "key": key, "reading": (it.get("reading") or "").strip() or None, "meaning": meaning})
    return {"response": answer or raw.strip(), "new_items": items[:3]}


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

    elif template == "ask":
        if analysis_id in _jobs:
            raise HTTPException(status_code=409, detail="Analysis still running; ask after it finishes")
        prompt = _build_ask_prompt(analysis.session_data or {}, params, analysis.input_content or "")
        if prompt is None:
            raise HTTPException(status_code=400, detail="Unknown sentence or item")
        raw = await llm.analyze(prompt, {})
        sentence = (analysis.session_data or {})["sentences"][params["sentence_index"]]
        known = {v.get("surface") for v in sentence.get("vocab") or []} | {g.get("pattern") for g in sentence.get("grammar") or []}
        result_data = _parse_ask_answer(raw, known)
        parsed_result = result_data

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
# GET /analyses
# ---------------------------------------------------------------------------

@router.get("/analyses")
async def list_analyses(
    status: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """
    List analyses with pagination and an optional comma-separated status
    filter. "in_progress" means a job is still running; "interrupted" is an
    in_progress record whose job is gone (e.g. lost in a restart).
    """
    query = select(Analysis).order_by(Analysis.created_at.desc())
    if status:
        running = list(_jobs)
        conditions = []
        for st in status.split(","):
            st = st.strip()
            if st == "in_progress":
                conditions.append(and_(Analysis.status == "in_progress", Analysis.id.in_(running)))
            elif st == "interrupted":
                conditions.append(and_(Analysis.status == "in_progress", Analysis.id.not_in(running)))
            elif st:
                conditions.append(Analysis.status == st)
        query = query.where(or_(*conditions))

    offset = (page - 1) * limit
    query = query.offset(offset).limit(limit)

    result = await db.execute(query)
    analyses = result.scalars().all()
    return [
        {
            "id": str(a.id),
            "input_type": a.input_type,
            "input_content": a.input_content[:200] if a.input_content else "",
            "status": _effective_status(a),
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
        "status": _effective_status(analysis),
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
