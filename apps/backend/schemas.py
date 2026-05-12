from __future__ import annotations

from typing import List, Optional, Literal
from pydantic import BaseModel, Field, validator, ConfigDict
# pydantic 是 FastAPI 默认使用的数据验证和设置管理库

# 1 句里最多抽取多少个重点（硬上限；配合 prompt 使用，避免 LLM 输出发散）
MAX_VOCAB_PER_SENTENCE = 10  # 从 6 提升到 10
MAX_GRAMMAR_PER_SENTENCE = 5  # 从 3 提升到 5

# 每个语法点最多给多少个例句（用于背诵/Anki）
MAX_EXAMPLES_PER_GRAMMAR = 2

# 短语成分角色类型
PhraseRole = Literal["subject", "predicate", "object", "modifier", "adverbial", "complement", "topic"]

class ExampleSentence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    jp: str = Field(..., description="日文例句")
    zh: Optional[str] = Field(None, description="例句中文翻译（可选）")

class VocabItem(BaseModel):
    model_config = ConfigDict(extra="forbid") # 禁止额外字段
    surface: str = Field(..., description="原句中出现的表记，只取单词本身，不包括后面的接续") # ... 表示必填字段
    base: str = Field(..., description="单词的基本形（辞书形）")
    reading: str = Field(..., description="单词的读音（平假名表记，如：たいさく、げんいん）")
    meaning_zh: str = Field(..., description="中文释义（一句话概括）")
    importance: Literal["core", "supplementary"] = Field(
        default="supplementary",
        description="重要性：core=对理解句意至关重要，supplementary=补充词汇"
    )


class GrammarItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pattern: str = Field(..., description="语法点的句型结构")
    connection_jp: str = Field(
        ...,
        description="接续/用法（必填：如『Vる＋にあたり』『N＋に際して』等，尽量简洁）",
    )
    meaning_zh: str = Field(..., description="中文释义（一句话概括）")
    explanation_zh: Optional[str] = Field(
        None,
        description="用法说明（可选：尽量简短，写出注意点/语感/常见限制）",
    )
    example_sentences: List[ExampleSentence] = Field(
        default_factory=list,
        description="例句列表（最多2条，优先使用原句或最典型例句）",
    )

    @validator("example_sentences", pre=True, always=True)
    def _limit_examples(cls, v):
        if v is None:
            return []
        return v[:MAX_EXAMPLES_PER_GRAMMAR]


class PhraseItem(BaseModel):
    """短语单元，用于句子结构分析"""
    model_config = ConfigDict(extra="forbid")

    text: str = Field(..., description="短语文本（如：『昨日買った本を』）")
    reading: str = Field(..., description="短语的平假名读音（如：『きのうかったほんを』）")
    role: PhraseRole = Field(..., description="语法成分角色")
    role_label: str = Field(..., description="中文角色标签（如：主语、谓语、宾语、修饰语、状语）")
    words: List[str] = Field(default_factory=list, description="组成短语的词列表，用于细粒度标注")
    children: Optional[List["PhraseItem"]] = Field(
        default=None,
        description="嵌套的子短语（用于修饰节等复杂结构）"
    )


class SentenceStructure(BaseModel):
    """句子的短语结构分析"""
    model_config = ConfigDict(extra="forbid")

    phrases: List[PhraseItem] = Field(..., description="短语列表，按句子顺序排列")


class SentenceAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    index: int = Field(..., description="句子序号，从1开始（全局序号）")
    jp: str = Field(..., description="日文原句")
    zh: str = Field(..., description="中文翻译")
    structure: Optional[SentenceStructure] = Field(
        default=None,
        description="句子的短语结构分析（包含读音和语法成分标注）"
    )
    vocab: List[VocabItem] = Field(default_factory=list, description="句中单词列表（最多10个重点词）")
    grammar: List[GrammarItem] = Field(default_factory=list, description="句中语法点列表（最多5个重点语法）")


class BatchAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sentences: List[SentenceAnalysis] = Field(..., min_length=1, description="句子分析列表")
