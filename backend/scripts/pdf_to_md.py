#!/usr/bin/env python3
"""
PDF → Markdown 转换。
Usage:
  python scripts/pdf_to_md.py data/JLPT/201507/     # 目录：自动找【1】试卷和【2】答案
  python scripts/pdf_to_md.py exam.pdf [answer.pdf]  # 直接指定文件
输出：与试卷 PDF 同目录的 .md 文件。
"""
import sys
import asyncio
import pathlib
import fitz  # PyMuPDF
from google import genai
from google.genai import types

API_KEY = "REDACTED_API_KEY"
MODEL = "gemini-2.5-flash"

PROMPT_EXAM_ONLY = """请将这份 JLPT 试卷 PDF 的全部内容转换为 Markdown 文本。

要求：
- 跳过封面、考试注意事项、页眉页脚的重复标题，从第一个大节直接开始
- 完整保留所有题目和选项文字，不遗漏
- 用 ## 标记大节（文字・語彙 / 文法・読解 / 聴解）
- 用 ### 标记每个問題（問題1、問題2 …）
- 题干中的下划线词用 __词__ 表示
- 选项保持 1234 编号（不要改成 ABCD）
- 遇到表格形式的内容（如课程表、价格表），用 Markdown | 表格格式输出
- 不输出任何答案表

排序题（文の組み立て）特殊规则：
- 句子中有 4 个空格，用 [_1_] [_2_] [_3_] [_4_] 表示
- 其中一个空格旁印有 ★，将该空格写成 [_N★_]（N 为该空格的编号，1/2/3/4 之一）
- ★ 的位置每道题不同，必须从 PDF 原文准确识别，不可假设固定在某个位置
- 示例：若 ★ 在第 3 格 → [_1_] [_2_] [_3★_] [_4_]；若在第 1 格 → [_1★_] [_2_] [_3_] [_4_]

聴解特殊规则：
- 选项是文字的题目：正常输出 1 2 3 4 各选项文字
- 选项是图片/插图的题目（无法用文字表达）：写 [画像1] [画像2] [画像3] [画像4] 占位
- 问题用纸上完全没有印刷选项的题目（只听音频作答）：写 [音声のみ] 占位
- 注意区分：有文字选项的要写出文字，不能用 [画像] 代替

直接输出 Markdown，不要任何额外说明。"""

PROMPT_WITH_ANSWER = """你收到两份 PDF：
- 第一份：JLPT 试卷（题目和选项）
- 第二份：答案解析（第一页是答案表）

任务：将试卷转换为 Markdown，答案从第二份 PDF 的第一页提取，放在末尾 ## 答案 节。

试卷转换要求：
- 跳过封面、考试注意事项、页眉页脚的重复标题，从第一个大节直接开始
- 完整保留所有题目和选项文字，不遗漏
- 用 ## 标记大节（文字・語彙 / 文法・読解 / 聴解）
- 用 ### 标记每个問題（問題1、問題2 …）
- 题干中的下划线词用 __词__ 表示
- 选项保持 1234 编号（不要改成 ABCD）
- 遇到表格形式的内容（如课程表、价格表），用 Markdown | 表格格式输出

答案表要求：
- 放在最后单独一节 ## 答案
- 每行的列数必须与该問題的实际题目数完全一致，不可省略任何一格
- 数字必须与答案 PDF 完全一致，特别注意 1、2、3、4 的准确识别

排序题（文の組み立て）特殊规则：
- 句子中有 4 个空格，用 [_1_] [_2_] [_3_] [_4_] 表示
- 其中一个空格旁印有 ★，将该空格写成 [_N★_]（N 为该空格的编号，1/2/3/4 之一）
- ★ 的位置每道题不同，必须从 PDF 原文准确识别，不可假设固定在某个位置
- 示例：若 ★ 在第 3 格 → [_1_] [_2_] [_3★_] [_4_]；若在第 1 格 → [_1★_] [_2_] [_3_] [_4_]

聴解特殊规则：
- 选项是文字的题目：正常输出 1 2 3 4 各选项文字
- 选项是图片/插图的题目（无法用文字表达）：写 [画像1] [画像2] [画像3] [画像4] 占位
- 问题用纸上完全没有印刷选项的题目（只听音频作答）：写 [音声のみ] 占位
- 注意区分：有文字选项的要写出文字，不能用 [画像] 代替

直接输出 Markdown，不要任何额外说明。"""


def find_pdfs(directory: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path | None]:
    """在目录中找试卷（真题）和答案解析 PDF。"""
    pdfs = sorted(p for p in directory.iterdir() if p.suffix == ".pdf")
    exam_pdf = next((p for p in pdfs if "exam" in p.name.lower() or "真题" in p.name), None)
    answer_pdf = (
        next((p for p in pdfs if p.stem.lower() == "answer"), None)
        or next((p for p in pdfs if "analysis" in p.name.lower() or "解析" in p.name or "答案" in p.name), None)
    )
    if not exam_pdf:
        raise FileNotFoundError(f"未找到试卷 PDF in {directory}")
    return exam_pdf, answer_pdf


async def convert(exam_path: pathlib.Path, answer_path: pathlib.Path | None) -> None:
    client = genai.Client(api_key=API_KEY)

    print(f"试卷：{exam_path.name} ({exam_path.stat().st_size // 1024} KB)")
    exam_bytes = exam_path.read_bytes()

    contents = [
        types.Part.from_bytes(data=exam_bytes, mime_type="application/pdf"),
        types.Part.from_text(text=PROMPT_EXAM_ONLY),
    ]
    print("发送给 Gemini（稍等）...")

    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=contents,
        config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_budget=8000),
        ),
    )

    out_path = exam_path.with_suffix(".md")
    out_path.write_text(response.text, encoding="utf-8")
    print(f"已保存：{out_path}")
    print(f"字符数：{len(response.text):,}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print("Usage:")
        print("  python scripts/pdf_to_md.py <directory>           # 自动找【1】和【2】")
        print("  python scripts/pdf_to_md.py exam.pdf [answer.pdf] # 直接指定文件")
        sys.exit(1)

    first = pathlib.Path(args[0])
    if first.is_dir():
        exam_pdf, answer_pdf = find_pdfs(first)
    else:
        exam_pdf = first
        answer_pdf = pathlib.Path(args[1]) if len(args) > 1 else None

    asyncio.run(convert(exam_pdf, answer_pdf))
