#!/usr/bin/env python3
"""
从答案解析 PDF 中提取第一页（答案表），另存为新文件。
Usage:
  python scripts/extract_answer_page.py data/JLPT/201507/     # 目录：自动找【2】
  python scripts/extract_answer_page.py answer.pdf             # 直接指定文件
输出：原文件名加 _p1 后缀，保存在同目录。
"""
import sys
import pathlib
import fitz


def extract_first_page(src_path: pathlib.Path, out_name: str) -> pathlib.Path:
    out_path = src_path.parent / f"{out_name}.pdf"
    src = fitz.open(str(src_path))
    out = fitz.open()
    out.insert_pdf(src, from_page=0, to_page=0)
    out.save(str(out_path))
    src.close()
    out.close()
    print(f"已保存：{out_path}")
    return out_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/extract_answer_page.py <directory|pdf>")
        sys.exit(1)

    target = pathlib.Path(sys.argv[1])
    if target.is_dir():
        pdf = next(
            (p for p in sorted(target.iterdir())
             if p.suffix == ".pdf" and ("analysis" in p.name.lower() or "解析" in p.name or "答案" in p.name)),
            None,
        )
        if not pdf:
            print(f"未找到答案解析 PDF in {target}")
            sys.exit(1)
        out_name = "answer"
    else:
        pdf = target
        out_name = "answer"

    extract_first_page(pdf, out_name)
