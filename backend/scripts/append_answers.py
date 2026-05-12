#!/usr/bin/env python3
"""
从答案 PDF（第一页）提取答案表，追加到 exam.md 末尾。
Usage:
  python scripts/append_answers.py data/JLPT/N1/201507/   # 自动找 answer.pdf 和 exam.md
  python scripts/append_answers.py answer.pdf exam.md     # 直接指定文件
"""
import re
import sys
import asyncio
import pathlib
import fitz
from google import genai
from google.genai import types

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-2.5-flash"

PROMPT = """这是 JLPT 试卷的答案页。格式说明：
- 主表按题号范围分组，每组是一串数字，每个数字对应一道题的答案（按题号顺序）
  例如：「36-40: 14243」→ Q36=1, Q37=4, Q38=2, Q39=4, Q40=3
- 排序题（文の組み立て）会在主表下方单独列出完整排列顺序，忽略该部分

请将所有答案提取为以下格式，每道题单独一行：
Q1: 2
Q2: 4
Q3: 1
...（按题号从小到大，不遗漏）

要求：
- 格式严格为 `Q{题号}: {单个数字}`，不加任何其他符号（不加★、不加顺序）
- 数字必须与原PDF完全一致
- 聴解各题同样按题号列出
- 只输出 Q 行，不输出任何其他内容"""


def find_files(directory: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    answer_pdf = next(
        (p for p in sorted(directory.iterdir())
         if p.suffix == ".pdf" and p.stem.lower() == "answer"),
        None,
    )
    if not answer_pdf:
        raise FileNotFoundError(f"未找到 answer.pdf in {directory}（先运行 extract_answer_page.py）")
    exam_md = next(
        (p for p in sorted(directory.iterdir()) if p.suffix == ".md" and "exam" in p.name.lower()),
        None,
    )
    if not exam_md:
        raise FileNotFoundError(f"未找到 exam.md in {directory}（先运行 pdf_to_md.py）")
    return answer_pdf, exam_md


async def append_answers(answer_pdf: pathlib.Path, exam_md: pathlib.Path) -> None:
    client = genai.Client(api_key=API_KEY)

    print(f"答案 PDF：{answer_pdf.name} ({answer_pdf.stat().st_size // 1024} KB)")
    answer_bytes = answer_pdf.read_bytes()

    doc = fitz.open(str(answer_pdf))
    raw_text = "\n".join(page.get_text() for page in doc)
    doc.close()

    print("发送给 Gemini 提取答案（稍等）...")
    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=answer_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=f"以下是该PDF的提取文本，供参考：\n\n{raw_text}\n\n---\n\n{PROMPT}"),
        ],
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=8000),
        ),
    )

    SENTINEL = "<!-- ANSWERS -->"
    existing = exam_md.read_text(encoding="utf-8")
    if SENTINEL in existing:
        existing = existing[:existing.index(SENTINEL)].rstrip()

    answer_lines = "\n".join(
        line for line in response.text.splitlines()
        if re.match(r'^Q\d+:\s*\d', line.strip())
    )
    exam_md.write_text(
        existing + f"\n\n{SENTINEL}\n## 答案\n\n" + answer_lines + "\n",
        encoding="utf-8",
    )
    print(f"已追加到：{exam_md}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("Usage:")
        print("  python scripts/append_answers.py <directory>")
        print("  python scripts/append_answers.py answer.pdf exam.md")
        sys.exit(1)

    first = pathlib.Path(args[0])
    if first.is_dir():
        answer_pdf, exam_md = find_files(first)
    else:
        answer_pdf = first
        if len(args) < 2:
            print("请同时指定 exam.md 路径")
            sys.exit(1)
        exam_md = pathlib.Path(args[1])

    asyncio.run(append_answers(answer_pdf, exam_md))
