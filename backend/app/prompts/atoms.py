"""
Single source of truth for atom structure: JSON schemas and prompt rules.
Used by both exam.py (exam analysis) and templates.py (free-text analysis).
"""

# ── JSON Schemas ──────────────────────────────────────────────────────────────

ATOM_ITEM = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["grammar", "vocabulary"]},
        "key": {"type": "string"},
        "reading": {"type": "string"},        # vocabulary: 假名读音
        "meaning": {"type": "string"},        # 中文含义（必填）
        "part_of_speech": {"type": "string", "description": "vocabulary 类型必填（名詞/動詞/形容詞/副詞等）；grammar 类型填 \"-\""},
        "jlpt_level": {"type": "string", "enum": ["N5", "N4", "N3", "N2", "N1"]},
        "register": {"type": "string"},       # 语体（书面/口语/正式/随意）
        "connection": {"type": "string"},     # grammar: 接续方式
        "usage": {"type": "string"},          # 使用条件/场合
        "nuance": {"type": "string"},         # 语感特点
        "example": {"type": "string"},        # 日语例句（必填）
    },
    "required": ["type", "key", "meaning", "part_of_speech", "example"],
}

RELATION_ITEM = {
    "type": "object",
    "properties": {
        "from_key": {"type": "string"},
        "to_key": {"type": "string"},
        "relation_type": {
            "type": "string",
            "enum": ["synonym", "formal_casual", "derivative", "contrast", "nuance", "confusable"],
        },
        "note": {"type": "string"},
    },
    "required": ["from_key", "to_key", "relation_type"],
}

STEM_NOTE_ITEM = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["grammar", "vocabulary"]},
        "key": {"type": "string"},
        "reading": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["type", "key", "note"],
}

WORD_DETAIL = {
    "type": "object",
    "properties": {
        "surface": {"type": "string"},
        "reading": {"type": "string"},
        "meaning": {"type": "string"},
        "usage_condition": {"type": "string"},
    },
    "required": ["surface", "reading", "meaning"],
}

GRAMMAR_DETAIL = {
    "type": "object",
    "properties": {
        "pattern": {"type": "string"},
        "meaning": {"type": "string"},
        "connection": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["pattern", "meaning"],
}

# ── Prompt text ───────────────────────────────────────────────────────────────

RELATION_GUIDE = (
    "relation_type 枚举（只能用这6种）：\n"
    "  synonym=同义  formal_casual=语体差异  derivative=派生形式\n"
    "  contrast=对比/反义  nuance=细微语义差别  confusable=易混淆（汉字音近/形近）"
)

# Injected into exam prompts via {atom_rules}
ATOM_RULES = (
    "atoms/relations 规则（所有题型共用）：\n"
    "- atom.type 只能是 \"vocabulary\"（词汇，基本形）或 \"grammar\"（语法，key 以〜开头）\n"
    "- 只提取核心被考查项 + 最相似干扰项，最多4个；普通词不入\n"
    "- 若词/语法在日语中不存在，不入 atoms\n"
    "- relations 只在已提取的 atoms 之间建立（from_key/to_key 必须在 atoms 列表中）\n"
    "- part_of_speech 必填：vocabulary 类型填日语词性（名詞/動詞/形容詞/副詞 等），grammar 类型填 \"-\"\n"
    "- atom 字段填写要求（尽量完整，能填的都填）：\n"
    "  · vocabulary 类型：key=基本形、reading=key辞書形的平假名读音（必须与key一一对应，不能是句中活用形）、meaning=中文含义（精炼）、"
    "part_of_speech=词性（必填）、jlpt_level=JLPT级别（若已知）、register=语体（书面/口语/正式/随意，有明显倾向时填）、"
    "usage=使用条件（可选）、nuance=语感特点（可选）、example=地道日语例句（必填）\n"
    "  · grammar 类型：key=以〜开头的形式、meaning=中文含义、part_of_speech=\"-\"、connection=接续方式、"
    "jlpt_level=JLPT级别（若已知）、register=语体（若有明显倾向）、usage=使用条件（可选）、"
    "nuance=语感特点（可选）、example=日语例句（必填，格式：「例句」→中文翻译）\n"
    "- " + RELATION_GUIDE
)

# Repeated format block in analysis prompts (templates.py)
ATOM_FORMAT_RULES = """\
词汇 key/reading 格式要求：
- key 必须是辞書形（基本形），不能是句中出现的活用形
- reading 是 key 辞書形的平假名读音，必须与 key 一一对应，不能是句中活用形的读音

语法 pattern 格式要求：
- 以「〜」开头（使用全角波浪线）
- 动词部分用基本形表示
- 不包含具体词汇

词汇 part_of_speech 格式要求：
- 使用日文词性名称：名詞／動詞／形容詞／副詞／助詞／助動詞／接続詞／感動詞 等"""
