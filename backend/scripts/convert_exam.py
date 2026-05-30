#!/usr/bin/env python3
"""
Convert a JLPT markdown exam file to structured seed JSON using Gemini.

Usage:
    python scripts/convert_exam.py path/to/exam.md path/to/output.json

The output JSON can be reviewed/edited before importing with seed_exam.py.
"""
import asyncio
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from google import genai
from google.genai import types
from app.config import get_settings

PROMPT_HEADER = """\
あなたは JLPT 試験の構造化パーサーです。
以下の Markdown 化された試験を読み込み、指定の JSON 形式に変換してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力 JSON 構造】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "title": "試験タイトル",
  "level": "N1",
  "source": "出典",
  "sections": [
    {
      "name": "言語知識（文字・語彙）",
      "problems": [
        {
          "name": "問題1",
          "type": "kanji_reading",
          "instruction": "次の言葉の読み方として...",
          "passage": null,
          "transcript": null,
          "items": [
            {
              "num": 1,
              "seq": 1,
              "stem": "__運賃__を払う",
              "options": {"1": "うんちん", "2": "うんどう", "3": "うんにん", "4": "うんりん"},
              "correct_answer": "2",
              "meta": {"target": "運賃"}
            }
          ]
        }
      ]
    }
  ]
}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【セクション分割ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
必ず 4 セクションに分割：
1. 言語知識（文字・語彙）: kanji_reading/kanji_writing/word_formation/vocab_fill/synonym/usage
2. 言語知識（文法）: grammar_fill/sentence_order/passage_fill
3. 読解: reading_comp
4. 聴解: listening

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【Problem（問題N）のルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ name: Markdown の ### 見出し（"問題1"、"問題2"…）
■ type: 問題グループ全体の題型（問題番号ではなく内容で判断）
  kanji_reading  : __対象語__ あり、選択肢がひらがな
  kanji_writing  : __ひらがな__ あり、選択肢が漢字
  word_formation : （　）に接辞1文字を補う
  vocab_fill     : 文中（　）に語を選ぶ
  synonym        : __対象語__ あり、最も近い意味を選ぶ
  usage          : 対象語の正しい使い方を選ぶ
  grammar_fill   : 文中（　）に文法形式を補う
  sentence_order : [_1_][_2_][_N★_][_4_] マークアップがある
  passage_fill   : 長文中に複数の番号付き空欄
  reading_comp   : 長文を読んで設問に答える
  listening      : 聴解セクション
■ instruction: 問題冒頭の指示語（例：「次の文の（　）に入れるのに最もよいものを…」）
■ passage: reading_comp / passage_fill の場合のみ設定（同じ文章を共有する items はこの problem にまとめる）
■ transcript: listening の場合のみ設定。PDF に実際に印刷されているスクリプト文のみ入力すること。
  絶対に生成・推測・補完しないこと。PDF にスクリプトが印刷されていない場合は null にする。
  ★ 聴解の分割ルール：
    - 原則として番号ごと（1番・2番…）に独立した problem に分割する（1音声1problem）
    - 同じ音声に対して設問が複数ある場合（例：最後の問題で2問1音声）は、
      同一 problem にまとめ、その problem の items に複数の設問を入れる
    - PDF にスクリプトがあればその番号のスクリプトを transcript に、なければ null を設定する

同一 ### 見出し内に複数の独立した文章がある場合（例：問題13 に短文が3つ、または聴解の各番号）は、
同じ name を持つ複数の problem に分割してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【Item（各設問）のルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ num: 試験全体での通し番号（整数）
■ seq: problem 内での連番（1始まり）
■ stem:
  kanji_reading/kanji_writing/synonym: __対象語__ マークアップを保持した文
  word_formation/vocab_fill/grammar_fill: （　）プレースホルダーを含む文
  usage: 対象語そのもの（例: "早期"）
  sentence_order: 必ず4つの空欄すべてを [_1_][_2_][_N★_][_4_] 形式で記述する完全な文。
    ★ は必ず [_N★_]（N は空欄番号）の形式で、番号なしの [_★_] は絶対に使わない。
    例：「昔の [_1_] [_2_] [_3★_] [_4_] 不思議な感覚だった。」
  passage_fill/reading_comp: 設問の文（例: "筆者の考えに合うのはどれか。"）
  listening（選択肢あり）: 番号のみ（例: "1番"）
  listening（音声のみ）: ""
■ options:
  通常: {"1":…,"2":…,"3":…,"4":…}
  sentence_order: 並べ替える4つの語句を {"1":…,"2":…,"3":…,"4":…} に設定する（★位置に入る語句を選ぶための選択肢）
  [音声のみ]: {}
■ correct_answer: 常に null（答案は別途インポートする）
■ meta:
  kanji_reading/kanji_writing/synonym: {"target": "対象語"}
  sentence_order: {"star_position": N}（[_N★_] の N、整数）
  その他: null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【試験 Markdown】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"""


def _parse_answers(markdown: str) -> dict[int, str]:
    """Extract {question_number: answer_digit} from the ## 答案 section."""
    answers: dict[int, str] = {}
    in_answers = False
    for line in markdown.splitlines():
        if line.strip() == "## 答案":
            in_answers = True
            continue
        if in_answers:
            m = re.match(r'^Q(\d+):\s*(\d)', line.strip())
            if m:
                answers[int(m.group(1))] = m.group(2)
    return answers


def _strip_answers(data: dict) -> None:
    """Set all correct_answer to null — answers must be imported separately."""
    for section in data.get("sections", []):
        for problem in section.get("problems", []):
            for item in problem.get("items", []):
                item["correct_answer"] = None


def _inject_answers(data: dict, answers: dict[int, str]) -> None:
    """Assign correct_answer to each item using the num field. Overwrites any existing value."""
    for section in data.get("sections", []):
        for problem in section.get("problems", []):
            for item in problem.get("items", []):
                num = item.get("num")
                if num is not None and num in answers:
                    item["correct_answer"] = answers[num]


def _validate(data: dict) -> None:
    assert "title" in data, "missing title"
    assert "level" in data, "missing level"
    assert isinstance(data.get("sections"), list), "sections must be a list"
    for s in data["sections"]:
        assert "name" in s, f"section missing name: {s}"
        assert isinstance(s.get("problems"), list), f"section missing problems list: {s}"
        for p in s["problems"]:
            assert "name" in p, f"problem missing name: {p}"
            assert "type" in p, f"problem missing type: {p}"
            assert isinstance(p.get("items"), list), f"items must be a list in problem: {p}"


def _infer_level_source(md_path: str) -> tuple[str, str]:
    """Derive level (e.g. 'N1') and source (e.g. '2015年07月') from path like .../N1/201507/exam.md"""
    parts = Path(md_path).parts
    level, source = "", ""
    for i, p in enumerate(parts):
        if p.upper() in ("N1", "N2", "N3", "N4", "N5"):
            level = p.upper()
            if i + 1 < len(parts) and parts[i + 1].isdigit() and len(parts[i + 1]) == 6:
                ym = parts[i + 1]
                source = f"{ym[:4]}年{ym[4:]}月"
            break
    return level, source


async def convert(md_path: str, out_path: str) -> None:
    markdown = Path(md_path).read_text(encoding="utf-8")
    answers = _parse_answers(markdown)
    print(f"Found {len(answers)} answers in MD.")

    level, source = _infer_level_source(md_path)
    print(f"Level: {level}, Source: {source}")

    settings = get_settings()
    client = genai.Client(api_key=settings.LLM_API_KEY)

    print(f"Parsing {md_path} with LLM …")
    response = await client.aio.models.generate_content(
        model="gemini-2.5-flash",
        contents=PROMPT_HEADER + markdown,
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            max_output_tokens=65536,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )
    raw = response.text or ""

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"LLM returned invalid JSON: {e}")
        print("Raw output saved to output.raw.txt for inspection.")
        Path(out_path).with_suffix(".raw.txt").write_text(raw, encoding="utf-8")
        sys.exit(1)

    _validate(data)
    _inject_answers(data, answers)

    # Override title/level/source with path-derived values
    if level:
        data["level"] = level
        data["title"] = f"日本語能力試験{level}" + (f" {source}" if source else "")
    if source:
        data["source"] = source

    total = sum(
        len(p["items"])
        for s in data["sections"]
        for p in s["problems"]
    )
    answered = sum(
        1
        for s in data["sections"]
        for p in s["problems"]
        for item in p["items"]
        if item.get("correct_answer")
    )
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. {len(data['sections'])} sections, {total} items, {answered} with answers → {out_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python scripts/convert_exam.py <exam.md> <output.json>")
        sys.exit(1)
    asyncio.run(convert(sys.argv[1], sys.argv[2]))
