from __future__ import annotations

from typing import List, Tuple


def build_prompt(
    chunk_items: List[Tuple[int, str]],
    target_level: str = "N2",
) -> str:
    """
    chunk_items: [(global_sentence_index, sentence_text), ...]
    要点：
    - 要求输出 JSON 且严格遵守 schema（Gemini 通过 response_json_schema 强约束）
    - 强调 index 必须是"全局序号"，以便我们后面合并去重
    - 输出 structure 包含短语结构和读音
    - vocab/grammar 提取更全面，标注重要性
    - vocab 的 surface/base 只写单词本体，不要带后续助词/接续
    """
    lines = []
    for idx, sent in chunk_items:
        lines.append(f"{idx}. {sent}")

    return (
        "你是专业日语老师。请对以下编号句子逐句进行深度解析，输出严格符合给定 JSON Schema 的 JSON。\n"
        f"\n## 目标学习者\n"
        f"面向 {target_level} 学习者，输出用于理解句子结构和制作 Anki 卡片。\n"
        "\n## 基本要求\n"
        "- sentences 数组里每一项对应一个句子；index 必须使用题面提供的编号（全局序号）。\n"
        "- jp 必须与输入句子完全一致（逐字一致）。\n"
        "\n## 句子结构分析 (structure)\n"
        "为每个句子提供短语结构分析，帮助学习者理解句子成分：\n"
        "- phrases: 将句子拆分为有意义的短语单元，按原句顺序排列\n"
        "- 每个短语包含：\n"
        "  - text: 短语原文（包含助词，如『彼は』『本を』）\n"
        "  - reading: 整个短语的平假名读音\n"
        "  - role: 语法角色（subject/predicate/object/modifier/adverbial/complement/topic）\n"
        "  - role_label: 中文标签（主语/谓语/宾语/修饰语/状语/补语/话题）\n"
        "  - words: 组成短语的词列表\n"
        "  - children: 对于包含修饰节的短语，嵌套子结构\n"
        "- 示例：『彼は昨日買った本を読んでいる』\n"
        "  → [『彼は』(话题), 『昨日買った本を』(宾语, 内含『昨日』(状语)+『買った』(修饰语)), 『読んでいる』(谓语)]\n"
        "\n## 词汇提取 (vocab)\n"
        "务必提取所有对理解句意重要的词汇（最多10个）：\n"
        "- 核心词汇 (importance: 'core'): 句子的核心动词、形容词、关键名词\n"
        "- 补充词汇 (importance: 'supplementary'): 副词、接续词、其他有学习价值的词\n"
        "- surface/base 只写单词本体，不包含助词/接续\n"
        "- reading 填写单词基本形的平假名读音\n"
        "\n## 语法提取 (grammar)\n"
        "务必提取句中出现的所有语法点（最多5个）：\n"
        "- 句型结构（如『〜ている』『〜てしまう』『〜ようにする』）\n"
        "- 接续表达（如『〜ながら』『〜つつ』『〜にあたり』）\n"
        "- 敬语/谦语形式\n"
        "- 助词的特殊用法\n"
        "- 每个 grammar 必须给出 connection_jp（接续形式）\n"
        "- 每个 grammar 最多给 2 条 example_sentences\n"
        "\n## 输出格式\n"
        "- vocab/grammar/structure 可为空数组/null，但不要省略字段\n"
        "- 字段必须与 JSON Schema 完全一致\n"
        "\n## 待分析句子\n"
        + "\n".join(lines)
    )