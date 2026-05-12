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
以下の日本語能力試験の Markdown ファイルを読み込み、指定の JSON 形式に変換してください。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【題型の判定ルール（問題番号ではなく内容で判断）】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
kanji_reading  : 問題文に __対象語__ があり、選択肢がひらがな読み
kanji_writing  : 問題文に __ひらがな__ があり、選択肢が漢字表記
word_formation : （　）に接辞1文字を補う問題（選択肢が接頭辞・接尾辞）
vocab_fill     : 文中の（　）に適切な語を選ぶ（選択肢が単語・フレーズ）
synonym        : 問題文に __対象語__ があり、「最も近い意味」を選ぶ
usage          : 対象語の正しい使い方の文を4つの完全な文から選ぶ
grammar_fill   : 文中の（　）に文法形式を補う（文法・機能語の選択）
sentence_order : [_1_][_2_][_N★_][_4_] のマークアップがある並び替え問題
passage_fill   : 長文中に (41)(42)… のような番号付き空欄が複数ある問題
reading_comp   : 長文を読んで設問に答える読解問題
listening      : 聴解セクションの問題

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【フィールドのルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
■ num
  Markdown 中の問題番号（試験全体での通し番号）。整数。

■ options
  選択肢番号は 1・2・3・4 のまま使用。
  例: {"1": "うんしん", "2": "うんちん", "3": "うんにん", "4": "うんりん"}
  [音声のみ] の聴解問題は {}.

■ stem
  kanji_reading/kanji_writing/synonym: __対象語__ のマークアップを保持した文。
  word_formation/vocab_fill/grammar_fill: （　）プレースホルダーを含む文。
  usage: 対象語そのもの（例: "早期"）。
  sentence_order: [_1_][_2_][_N★_][_4_] マークアップを保持した完全な文。
  passage_fill/reading_comp: 問いの文（例: "筆者の考えに合うのはどれか。"）。
  listening（選択肢あり）: 番号のみ（例: "1番"）。
  listening（音声のみ）: ""。

■ passage
  passage_fill と reading_comp にのみ設定。同じ文章を共有する複数問には同一テキストを格納。
  その他は null。

■ meta
  kanji_reading / kanji_writing / synonym: {"target": "対象語"}  ← __word__ から抽出
  sentence_order: {"star_position": N}  ← [_N★_] の N（整数）
  passage_fill / reading_comp: {"passage_group": "一意の文字列"}  ← 同文章を共有する問題に同じ値
  その他は null。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【出力 JSON 構造】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{
  "title": "試験タイトル",
  "level": "N1",
  "source": "出典",
  "sections": [
    {"name": "言語知識（文字・語彙）", "questions": [...]},
    {"name": "言語知識（文法）",       "questions": [...]},
    {"name": "読解",                  "questions": [...]},
    {"name": "聴解",                  "questions": [...]}
  ]
}

各 question のフィールド: num, seq, type, stem, options, passage, meta

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
【セクション分割ルール】
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
必ず 4 セクションに分割（実際の冊子構成に関わらず）：
1. 言語知識（文字・語彙）: kanji_reading/kanji_writing/word_formation/vocab_fill/synonym/usage
2. 言語知識（文法）:       grammar_fill/sentence_order/passage_fill
3. 読解:                  reading_comp
4. 聴解:                  listening

注意:
- seq は各 section 内での連番（1始まり）
- [音声のみ] と明記された聴解問題は stem="" options={}
- JSON のみ出力。説明文・コードブロック不要。

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


def _inject_answers(data: dict, answers: dict[int, str]) -> None:
    """Assign correct_answer to each question using the num field."""
    for section in data.get("sections", []):
        for q in section.get("questions", []):
            num = q.get("num")
            if num is not None and num in answers:
                q["correct_answer"] = answers[num]


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
        data["title"] = f"日本語能力試験{level}"
        data["level"] = level
    if source:
        data["source"] = source

    total = sum(len(s["questions"]) for s in data["sections"])
    answered = sum(
        1 for s in data["sections"] for q in s["questions"] if q.get("correct_answer")
    )
    Path(out_path).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Done. {len(data['sections'])} sections, {total} questions, {answered} with answers → {out_path}")


def _validate(data: dict) -> None:
    assert "title" in data, "missing title"
    assert "level" in data, "missing level"
    assert "sections" in data, "missing sections"
    for s in data["sections"]:
        assert "name" in s, f"section missing name: {s}"
        for q in s.get("questions", []):
            assert "type" in q, f"question missing type: {q}"
            assert "options" in q, f"question missing options: {q}"


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python scripts/convert_exam.py <exam.md> <output.json>")
        sys.exit(1)
    asyncio.run(convert(sys.argv[1], sys.argv[2]))
