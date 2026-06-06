"""Admin API — exam ingestion, draft management, media upload."""
import asyncio
import json
import logging
import uuid as _uuid
from pathlib import Path
from datetime import datetime

import aiofiles
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamDraft, get_db,
    async_session_factory,
)
from app.schemas.exam import DraftSummary, DraftDetail, MediaUploadResponse
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
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


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
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


# ── PDF Ingest ────────────────────────────────────────────────────────────────

@router.post("/drafts", response_model=DraftDetail)
async def create_draft_from_pdf(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload PDF → create draft immediately → parse async in background."""
    pdf_bytes = await file.read()
    if not pdf_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    draft = ExamDraft(
        filename=file.filename,
        markdown_raw=None,
        draft_json=None,
        status="processing",
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    settings = get_settings()
    asyncio.create_task(
        _process_draft_pdf(draft.id, pdf_bytes, file.filename, settings.LLM_API_KEY)
    )

    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


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

@router.post("/drafts/{draft_id}/confirm", response_model=DraftDetail)
async def confirm_draft(draft_id: _uuid.UUID, db: AsyncSession = Depends(get_db)):
    draft = await db.get(ExamDraft, draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    if not draft.draft_json:
        raise HTTPException(status_code=400, detail="Draft has no structured data")

    data = draft.draft_json
    level = data.get("level", "")
    source = data.get("source", "")
    if not level:
        raise HTTPException(status_code=400, detail="draft_json missing level")
    title = f"日本語能力試験{level}" + (f" {source}" if source else "")

    # Idempotent: delete existing paper with same level+source
    existing = (await db.execute(
        select(ExamPaper).where(ExamPaper.level == level, ExamPaper.source == source)
    )).scalar_one_or_none()
    if existing:
        await db.execute(delete(ExamPaper).where(ExamPaper.id == existing.id))
        await db.flush()

    paper = ExamPaper(title=title, level=level, source=source)
    db.add(paper)
    await db.flush()

    for sec_idx, sec_data in enumerate(data.get("sections", [])):
        section = ExamSection(
            paper_id=paper.id, name=sec_data["name"], seq=sec_idx + 1,
        )
        db.add(section)
        await db.flush()

        for prob_idx, prob_data in enumerate(sec_data.get("problems", [])):
            problem = ExamProblem(
                section_id=section.id,
                seq=prob_idx + 1,
                name=prob_data["name"],
                type=prob_data["type"],
                instruction=prob_data.get("instruction"),
                passage=prob_data.get("passage"),
                transcript=prob_data.get("transcript"),
            )
            db.add(problem)
            await db.flush()

            for item_idx, item_data in enumerate(prob_data.get("items", []), start=1):
                seq = item_data.get("seq") or item_idx
                is_listening = prob_data.get("type") == "listening"
                raw_stem = item_data.get("stem", "")
                stem = raw_stem or (f"{seq}番" if is_listening else "")
                raw_options = item_data.get("options", {})
                options = raw_options or ({"1": "", "2": "", "3": "", "4": ""} if is_listening else {})
                db.add(ExamItem(
                    problem_id=problem.id,
                    seq=seq,
                    num=item_data.get("num"),
                    stem=stem,
                    transcript=item_data.get("transcript"),
                    options=options,
                    correct_answer=item_data.get("correct_answer"),
                    meta=item_data.get("meta"),
                ))
            await db.flush()

    draft.paper_id = paper.id
    draft.status = "confirmed"
    draft.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(draft)

    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


# ── Import answers from answer PDF ───────────────────────────────────────────

_ANSWER_PROMPT = """这是 JLPT 试卷的答案页。格式说明：
- 主表按题号范围分组，每组是一串数字，每个数字对应一道题的答案（按题号顺序）
  例如：「36-40: 14243」→ Q36=1, Q37=4, Q38=2, Q39=4, Q40=3
- 排序题（文の組み立て）会在主表下方单独列出完整排列顺序，忽略该部分

请将所有答案提取为以下格式，每道题单独一行：
Q1: 2
Q2: 4
Q3: 1
...（按题号从小到大，不遗漏）

要求：
- 格式严格为 `Q{题号}: {单个数字}`，不加任何其他符号
- 数字必须与原PDF完全一致
- 聴解各题同样按题号列出
- 只输出 Q 行，不输出任何其他内容"""


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

    # Parse Q{n}: {d} lines
    answer_lines = "\n".join(
        line for line in response.text.splitlines()
        if re.match(r'^Q\d+:\s*\d', line.strip())
    )
    pseudo_md = f"## 答案\n{answer_lines}"
    answers = _parse_answers(pseudo_md)

    if not answers:
        raise HTTPException(status_code=422, detail="No answers could be extracted from the PDF")

    data = copy.deepcopy(draft.draft_json)
    _inject_answers(data, answers)
    draft.draft_json = data
    flag_modified(draft, "draft_json")
    draft.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(draft)

    logger.info("Imported %d answers into draft %s", len(answers), draft_id)
    return DraftDetail(
        id=draft.id, filename=draft.filename,
        markdown_raw=draft.markdown_raw, draft_json=draft.draft_json,
        status=draft.status, paper_id=draft.paper_id,
        created_at=draft.created_at, updated_at=draft.updated_at,
    )


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
