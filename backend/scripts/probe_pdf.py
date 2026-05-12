#!/usr/bin/env python3
"""
探针脚本：验证 Gemini 能否从 JLPT PDF 中正确读出题目文字。
Usage: python scripts/probe_pdf.py data/JLPT/2023年07月日语N2真题试卷.pdf
"""
import sys
import asyncio
import pathlib
from google import genai
from google.genai import types

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-2.5-flash"

PROMPT = """这是一份 JLPT N2 真题试卷 PDF。

请找到第一个問題（問題1），抽取其中的前3道小题，按以下格式输出：

問題编号：問題X（X 是数字）
題型描述：一句话说明这个問題在考什么

每题：
- 题号：
- 题干：（完整文字，包括括号和下划线处）
- 选项1：
- 选项2：
- 选项3：
- 选项4：

只输出文字，不要额外解释。"""


async def probe(pdf_path: str):
    client = genai.Client(api_key=API_KEY)
    path = pathlib.Path(pdf_path)

    size_kb = path.stat().st_size // 1024
    print(f"读取 PDF: {path.name} ({size_kb} KB)")
    pdf_bytes = path.read_bytes()

    print("发送给 Gemini...\n")
    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=[
            types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf"),
            types.Part.from_text(text=PROMPT),
        ],
    )
    print(response.text)


if __name__ == "__main__":
    pdf = sys.argv[1] if len(sys.argv) > 1 else "data/JLPT/2023年07月日语N2真题试卷.pdf"
    asyncio.run(probe(pdf))
