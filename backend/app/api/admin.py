"""Admin API — exam ingestion, draft management, media upload."""
import asyncio
import json
import logging
import uuid as _uuid
from copy import deepcopy
from pathlib import Path
from datetime import datetime

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy import select, delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamItemRevision,
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamDraft, get_db,
    async_session_factory,
)
from app.schemas.exam import DraftSummary, DraftDetail, DraftSource, MediaUploadResponse
from app.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])

MEDIA_DIR = Path(__file__).parent.parent.parent / "media"
MEDIA_DIR.mkdir(exist_ok=True)


# ── Draft CRUD ────────────────────────────────────────────────────────────────

@router.get("/drafts", response_model=list[DraftSummary])
async def list_drafts(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ExamDraft).order_by(ExamDraft.created_at.desc())
    )).scalars().all()
    return [
        DraftSummary(
            id=d.id, filename=d.filename, status=d.status,
            paper_id=d.paper_id, created_at=d.created_at, updated_at=d.updated_at,
        )
        for d in rows
    ]


@router.get("/drafts/{draft_id}", response_model=DraftDetail)
async def get_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return await _draft_detail(db, draft)


@router.delete("/drafts/{draft_id}", status_code=204)
async def delete_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    await db.delete(draft)
    await db.commit()


@router.put("/drafts/{draft_id}", response_model=DraftDetail)
async def update_draft(draft_id: _uuid.UUID, body: dict, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if "draft_json" in body:
        from sqlalchemy.orm.attributes import flag_modified
        draft.draft_json = body["draft_json"]
        flag_modified(draft, "draft_json")
    draft.updated_at = datetime.utcnow()
    await db.commit()
    return await _draft_detail(db, draft)


# ── PDF Ingest ────────────────────────────────────────────────────────────────

async def _draft_detail(db: AsyncSession, draft) -> DraftDetail:
    from app.models.db import ExamDraftSource
    rows = (await db.execute(
        select(ExamDraftSource).where(ExamDraftSource.draft_id == draft.id)
        .order_by(ExamDraftSource.created_at)
    )).scalars().all()
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        canonical=draft.canonical, report=draft.report,
        sources=[
            DraftSource(filename=r.filename, role=r.role,
                        page_count=r.page_count, text_pages=r.text_pages)
            for r in rows
        ],
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


@router.post("/drafts", response_model=DraftDetail)
async def create_draft(
    files: list[UploadFile] = File(...),
    level: str | None = Form(None),
    source_label: str | None = Form(None),
    db: AsyncSession = Depends(get_db),
):
    """Upload a sitting's files and read it.

    A sitting is 試題 + 解析 + 答案表, not one PDF, and which is which is worked
    out from the files rather than asked for. None of them is required: a
    question paper alone imports fine and the report says what it cannot do.
    """
    uploads: list[tuple[str, bytes]] = []
    for upload in files:
        data = await upload.read()
        if data:
            uploads.append((upload.filename or "unnamed.pdf", data))
    if not uploads:
        raise HTTPException(status_code=400, detail="No readable files")

    draft = ExamDraft(
        filename=", ".join(name for name, _ in uploads),
        status="processing",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    asyncio.create_task(_run_ingest(draft.id, uploads, level, source_label))
    return await _draft_detail(db, draft)


async def _run_ingest(
    draft_id: _uuid.UUID,
    uploads: list[tuple[str, bytes]],
    level: str,
    source_label: str | None,
) -> None:
    """Read the sitting in the background and store what came of it."""
    from app.models.db import ExamDraftSource, async_session_factory
    from app.services.exam_canonical import from_dict
    from app.services.exam_ingest import baseline_for, ingest
    from app.services.exam_sources import Source, classify_all
    from app.services.exam_text import joined, read_pdf

    async with async_session_factory() as session:
        # What papers of this level have looked like so far, so a difference
        # can be queried instead of every paper looking unfamiliar.
        previous = (await session.execute(
            select(ExamDraft.canonical).where(
                ExamDraft.canonical.is_not(None), ExamDraft.status == "confirmed"
            )
        )).scalars().all()
        # Only papers of the same level are a baseline; without a level yet,
        # the first paper of a new level should not be judged against N1's.
        baseline = baseline_for([
            p for p in previous if not level or (p or {}).get("level") == level
        ]) if level else {}

    try:
        paper, report = await ingest(
            uploads, level=level, source_label=source_label, baseline=baseline,
        )
    except Exception as e:
        logger.error("Ingest failed for draft %s: %s", draft_id, e)
        async with async_session_factory() as session:
            await session.execute(
                update(ExamDraft).where(ExamDraft.id == draft_id)
                .values(status="failed", report={"notes": [f"读取失败：{e}"]})
            )
            await session.commit()
        return

    async with async_session_factory() as session:
        # Keep the text of each file: improving the extractor then means
        # re-running over these rows rather than asking for the PDFs again.
        for name, data in uploads:
            pages = read_pdf(data)
            session.add(ExamDraftSource(
                draft_id=draft_id, filename=name,
                page_count=len(pages),
                text_pages=sum(1 for p in pages if p.has_text_layer),
                text_raw=joined(pages),
                role=next(
                    (s["role"] for s in report.sources if s["filename"] == name),
                    "unknown",
                ),
            ))
        await session.execute(
            update(ExamDraft).where(ExamDraft.id == draft_id).values(
                canonical=paper.to_dict() if paper else None,
                report=report.to_dict(),
                status="pending" if paper else "failed",
            )
        )
        await session.commit()


async def _process_draft_pdf(draft_id: _uuid.UUID, pdf_bytes: bytes, filename: str, api_key: str) -> None:
    """Background task: run Gemini parsing and update draft when done."""
    import tempfile
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from scripts.convert_exam import _strip_answers

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_bytes)
            tmp_path = Path(tmp.name)

        markdown_raw = await _run_pdf_to_md(tmp_path, api_key)
        draft_json = await _run_convert_exam(markdown_raw, api_key)
        _strip_answers(draft_json)
        _inject_metadata_from_md(draft_json, markdown_raw)
        new_status = "pending"
    except Exception as e:
        logger.error("Ingestion failed for %s: %s", filename, e)
        markdown_raw = None
        draft_json = None
        new_status = "failed"
    finally:
        if tmp_path:
            tmp_path.unlink(missing_ok=True)

    async with async_session_factory() as session:
        draft = await session.get(ExamDraft, draft_id)
        if draft is None:
            return
        draft.markdown_raw = markdown_raw
        draft.draft_json = draft_json
        draft.status = new_status
        draft.updated_at = datetime.utcnow()
        await session.commit()


def _inject_metadata_from_md(draft_json: dict, markdown: str) -> None:
    """Parse level/source from the metadata block at the top of the markdown and inject."""
    import re
    level, source = "", ""
    for line in markdown.splitlines()[:15]:
        m = re.match(r'^level:\s*(N[1-5])\s*$', line.strip())
        if m:
            level = m.group(1)
            draft_json["level"] = level
        m = re.match(r'^source:\s*(\d{4}年\d{2}月)\s*$', line.strip())
        if m:
            source = m.group(1)
            draft_json["source"] = source
    if level:
        draft_json["title"] = f"日本語能力試験{level}" + (f" {source}" if source else "")


async def _run_pdf_to_md(pdf_path: Path, api_key: str) -> str:
    """Call Gemini to convert PDF → Markdown."""
    from google import genai
    from google.genai import types

    PROMPT = """請将这份 JLPT 试卷 PDF 的全部内容转换为 Markdown 文本。

首先，在 Markdown 最顶部输出以下元数据块（从封面或页眉提取，找不到就留空）：
```
level: N1
source: 2023年07月
```
level 只填 N1/N2/N3/N4/N5 之一，source 格式为「YYYY年MM月」。

要求：
- 元数据块之后，跳过封面正文、考试注意事项、页眉页脚的重复标题，从第一个大节直接开始
- 完整保留所有题目和选项文字，不遗漏
- 用 ## 标记大节（文字・語彙 / 文法・読解 / 聴解）
- 用 ### 标记每个問題（問題1、問題2 …）
- 题干中的下划线词用 __词__ 表示
- 选项保持 1234 编号（不要改成 ABCD）
- 遇到表格形式的内容，用 Markdown | 表格格式输出
- 不输出任何答案表

排序题（文の組み立て）：
- 4个空格用 [_1_] [_2_] [_3_] [_4_] 表示
- ★ 所在空格写成 [_N★_]，N 为该空格编号，必须从原文准确识别

聴解：
- 有文字选项的题目：正常输出文字
- 选项是图片的题目：写 [画像1] [画像2] [画像3] [画像4]
- 无印刷选项的题目：写 [音声のみ]

如果 PDF 包含答案表，放在末尾 ## 答案 节，格式：Q{题号}: {答案数字}，每行一题。

直接输出 Markdown，不要任何额外说明。"""

    client = genai.Client(api_key=api_key)
    pdf_bytes = pdf_path.read_bytes()
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=PROMPT),
        ],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=8000),
        ),
    )
    return response.text or ""


async def _run_convert_exam(markdown: str, api_key: str) -> dict:
    """Call Gemini to parse Markdown → structured 4-layer JSON."""
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from scripts.convert_exam import PROMPT_HEADER, _parse_answers, _inject_answers, _strip_answers, _validate

    from google import genai
    from google.genai import types

    answers = _parse_answers(markdown)
    client = genai.Client(api_key=api_key)
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=PROMPT_HEADER + markdown,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=65536,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    data = json.loads(response.text or "{}")
    _validate(data)
    _inject_answers(data, answers)
    return data


# ── Confirm: Draft → ExamPaper tree ──────────────────────────────────────────

@router.patch("/drafts/{draft_id}/items", response_model=DraftDetail)
async def edit_draft_item(
    draft_id: _uuid.UUID, body: dict, db: AsyncSession = Depends(get_db),
):
    """Correct a question before the paper is imported.

    Cheaper than importing and fixing afterwards, and it keeps a known-wrong
    answer from ever being attempted. Addressed by 問題 and item number rather
    than by index, so it survives a re-extraction reordering things.
    """
    draft = await db.get(ExamDraft, draft_id)
    if draft is None or not draft.canonical:
        raise HTTPException(status_code=404, detail="Draft not found or not read yet")

    problem_name = body.get("problem")
    seq = body.get("seq")
    changes = {
        k: v for k, v in body.items()
        if k in {"stem", "options", "correct_answer", "answer_order", "transcript"}
    }
    if not problem_name or seq is None or not changes:
        raise HTTPException(status_code=400, detail="Need problem, seq and at least one field")

    canonical = deepcopy(draft.canonical)
    found = False
    for section in canonical.get("sections", []):
        for problem in section.get("problems", []):
            if problem.get("name") != problem_name:
                continue
            for item in problem.get("items", []):
                if item.get("seq") == seq:
                    item.update(changes)
                    found = True
    if not found:
        raise HTTPException(status_code=404, detail="Item not found in draft")

    # The report is about the paper as it was read; it no longer describes this.
    report = deepcopy(draft.report or {})
    report.setdefault("notes", []).append(
        f"{problem_name} 第{seq}题已人工修改：{'、'.join(changes)}"
    )

    draft.canonical = canonical
    draft.report = report
    await db.commit()
    await db.refresh(draft)
    return await _draft_detail(db, draft)


@router.post("/drafts/{draft_id}/confirm", response_model=DraftDetail)
async def confirm_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    """Import the reviewed paper.

    Reads the canonical paper rather than the old draft_json, so everything the
    sources carry actually lands: 並べ替え orderings, the form each item was
    printed in, and which file it came from.
    """
    from app.services.exam_canonical import from_dict

    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.canonical:
        raise HTTPException(status_code=400, detail="Draft has not been read yet")

    paper_data = from_dict(draft.canonical)
    if not paper_data.level:
        raise HTTPException(status_code=400, detail="Paper has no level")

    # Re-importing a sitting replaces it, so a corrected draft does not leave
    # two copies of the same paper behind.
    existing = (await db.execute(
        select(ExamPaper).where(
            ExamPaper.level == paper_data.level,
            ExamPaper.source == (paper_data.source or ""),
        )
    )).scalar_one_or_none()
    if existing:
        await db.execute(delete(ExamPaper).where(ExamPaper.id == existing.id))
        await db.flush()

    paper = ExamPaper(
        title=paper_data.title, level=paper_data.level, source=paper_data.source or "",
    )
    db.add(paper)
    await db.flush()

    for section_data in paper_data.sections:
        section = ExamSection(
            paper_id=paper.id, name=section_data.name, seq=section_data.seq,
        )
        db.add(section)
        await db.flush()

        for problem_data in section_data.problems:
            problem = ExamProblem(
                section_id=section.id, seq=problem_data.seq,
                name=problem_data.name, type=problem_data.type,
                instruction=problem_data.instruction,
                passage=problem_data.passage,
                passage_translation=problem_data.passage_translation,
                transcript=problem_data.transcript,
            )
            db.add(problem)
            await db.flush()

            for item_data in problem_data.items:
                item = ExamItem(
                    problem_id=problem.id, seq=item_data.seq, num=item_data.num,
                    stem=item_data.stem, options=item_data.options or {},
                    correct_answer=item_data.correct_answer,
                    answer_order=item_data.answer_order,
                    transcript=item_data.transcript,
                    meta=item_data.meta or None,
                )
                db.add(item)
                await db.flush()
                # Where it came from, recorded as the first revision, so a
                # question that is later corrected shows what it started as.
                db.add(ExamItemRevision(
                    item_id=item.id, field="imported",
                    new_value=item_data.provenance.extractor or "ingest",
                    source="ingest",
                    note=f"来源：{item_data.provenance.source or '未知'}",
                ))

    draft.paper_id = paper.id
    draft.status = "confirmed"
    await db.commit()
    await db.refresh(draft)
    return await _draft_detail(db, draft)


@router.post("/drafts/{draft_id}/import-answers", response_model=DraftDetail)
async def import_answers(
    draft_id: _uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload answer PDF → extract first page → Gemini parse → inject into draft_json."""
    import re
    import sys
    import copy
    import tempfile
    import fitz  # PyMuPDF
    from google import genai
    from google.genai import types
    from sqlalchemy.orm.attributes import flag_modified
    sys.path.insert(0, str(Path(__file__).parent.parent.parent))
    from scripts.convert_exam import _parse_answers, _inject_answers

    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.draft_json:
        raise HTTPException(status_code=400, detail="Draft has no structured data yet")

    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Extract first page only
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(pdf_bytes)
        tmp_path = Path(tmp.name)

    try:
        doc = fitz.open(str(tmp_path))
        first_page_text = doc[0].get_text() if len(doc) > 0 else ""
        first_page_doc = fitz.open()
        first_page_doc.insert_pdf(doc, from_page=0, to_page=0)
        first_page_bytes = first_page_doc.tobytes()
        doc.close()
        first_page_doc.close()
    finally:
        tmp_path.unlink(missing_ok=True)

    settings = get_settings()
    client = genai.Client(api_key=settings.LLM_API_KEY)
    try:
        response = await client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=first_page_bytes, mime_type="application/pdf"),
                types.Part.from_text(text=f"以下是该PDF的提取文本，供参考：\n\n{first_page_text}\n\n---\n\n{_ANSWER_PROMPT}"),
            ],
            config=types.GenerateContentConfig(
                thinking_config=types.ThinkingConfig(thinking_budget=8000),
            ),
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gemini failed: {e}")

    # Parse Q{n} (言語知識) and C{g}Q{n} (聴解) lines
    regular_answers: dict[int, str] = {}
    listening_answers: dict[tuple, str] = {}
    for line in response.text.splitlines():
        line = line.strip()
        m = re.match(r'^C(\d+)Q(\d+):\s*(\d)', line)
        if m:
            listening_answers[(int(m.group(1)), int(m.group(2)))] = m.group(3)
            continue
        m = re.match(r'^Q(\d+):\s*(\d)', line)
        if m:
            regular_answers[int(m.group(1))] = m.group(2)

    if not regular_answers and not listening_answers:
        raise HTTPException(status_code=422, detail="No answers could be extracted from the PDF")

    data = copy.deepcopy(draft.draft_json)
    # Inject 言語知識 answers by global num
    _inject_answers(data, regular_answers)
    # Inject 聴解 answers by (group_index, num)
    for section in data.get("sections", []):
        if "聴" not in section.get("name", ""):
            continue
        for prob_idx, problem in enumerate(section.get("problems", []), 1):
            for item in problem.get("items", []):
                key = (prob_idx, item.get("num"))
                if key in listening_answers:
                    item["correct_answer"] = listening_answers[key]
    draft.draft_json = data
    flag_modified(draft, "draft_json")
    draft.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(draft)

    logger.info("Imported %d answers into draft %s", len(answers), draft_id)
    return await _draft_detail(db, draft)


# ── Media Upload ──────────────────────────────────────────────────────────────

@router.post("/media/upload", response_model=MediaUploadResponse)
async def upload_media(file: UploadFile = File(...)):
    """Save uploaded image, return its static URL."""
    ext = Path(file.filename or "img.png").suffix or ".png"
    filename = f"{_uuid.uuid4().hex}{ext}"
    dest = MEDIA_DIR / filename

    async with aiofiles.open(dest, "wb") as f:
        content = await file.read()
        await f.write(content)

    return MediaUploadResponse(url=f"/media/{filename}")
