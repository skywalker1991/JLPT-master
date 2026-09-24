import json
import logging
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from sqlalchemy import delete, distinct, select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamMedia,
    QuestionAnalysis, ProblemAnalysis, ExamAttempt, AttemptAnswer,
    ExamItemRevision, ExamItemReport, get_db,
)
from app.schemas.exam import (
    ExamPaperList, ExamPaperDetail, SectionDetail, ProblemDetail,
    ItemSchema, ExamMediaItem,
    StartAttemptRequest, StartAttemptResponse, SubmitAnswerRequest, SubmitAnswerResponse,
    SectionScore, SectionAnswerDetail, SubmitSectionResponse,
    AttemptStatus, RelationSuggestion, QuestionAnalysisResponse, AccuracyStats,
    AttemptSummary, AttemptReview, ReviewSection, ReviewProblem, ReviewItem,
    MistakeItem,
)
from app.services.llm.factory import get_llm_client
from app.services import exam_edit
from app.services.tts import TTSUnavailable, speak

logger = logging.getLogger(__name__)
router = APIRouter(tags=["exam"])

# ── 分析 JSON Schema（定义来自 prompts/atoms.py）────────────────────────────

from app.prompts.atoms import (
    ATOM_ITEM as _ATOM_ITEM,
    RELATION_ITEM as _RELATION_ITEM,
    STEM_NOTE_ITEM as _STEM_NOTE_ITEM,
    WORD_DETAIL as _WORD_DETAIL,
    GRAMMAR_DETAIL as _GRAMMAR_DETAIL,
    ATOM_RULES as _ATOM_RULES,
)

# ── 10 种题型 Schema ──────────────────────────────────────────────────────────

_VOCAB_FILL_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "word": _WORD_DETAIL,
            },
            "required": ["option", "is_correct", "explanation", "word"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "options_analysis", "atoms", "relations"],
}

_SYNONYM_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "target_word": {"type": "object", "properties": {
            "surface": {"type": "string"}, "reading": {"type": "string"}, "meaning": {"type": "string"},
        }, "required": ["surface", "reading", "meaning"]},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "word": {"type": "object", "properties": {
                    "surface": {"type": "string"}, "reading": {"type": "string"},
                    "meaning": {"type": "string"}, "synonym_note": {"type": "string"},
                }, "required": ["surface", "reading", "meaning"]},
            },
            "required": ["option", "is_correct", "explanation", "word"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "target_word", "options_analysis", "atoms", "relations"],
}

_USAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "target_word": {"type": "object", "properties": {
            "surface": {"type": "string"}, "reading": {"type": "string"},
            "meaning": {"type": "string"}, "usage_conditions": {"type": "string"},
        }, "required": ["surface", "reading", "meaning", "usage_conditions"]},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "violation": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "target_word", "options_analysis", "atoms", "relations"],
}

_WORD_FORMATION_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "word": _WORD_DETAIL,
                "formation": {"type": "object", "properties": {
                    "components": {"type": "array", "items": {"type": "object", "properties": {
                        "part": {"type": "string"}, "meaning": {"type": "string"},
                    }, "required": ["part", "meaning"]}},
                    "pattern": {"type": "string"},
                }, "required": ["components", "pattern"]},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "options_analysis", "atoms", "relations"],
}

_KANJI_READING_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "target_word": {"type": "string"},
        "confusion_points": {"type": "string"},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "target_word", "options_analysis", "atoms", "relations"],
}

_KANJI_WRITING_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "target_reading": {"type": "string"},
        "confusion_points": {"type": "string"},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "kanji_note": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "target_reading", "options_analysis", "atoms", "relations"],
}

_GRAMMAR_FILL_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "grammar": _GRAMMAR_DETAIL,
            },
            "required": ["option", "is_correct", "explanation", "grammar"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "options_analysis", "atoms", "relations"],
}

_SENTENCE_ORDER_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "correct_sequence": {"type": "string"},
        "correct_order": {"type": "string"},
        "translation": {"type": "string"},
        "grammar": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "pattern": {"type": "string"},
                "meaning": {"type": "string"},
                "example": {"type": "string"},
            },
            "required": ["pattern", "meaning"],
        }},
        "vocabulary": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "word": {"type": "string"},
                "reading": {"type": "string"},
                "meaning": {"type": "string"},
                "part_of_speech": {"type": "string"},
            },
            "required": ["word", "reading", "meaning", "part_of_speech"],
        }},
    },
    "required": ["analysis_type", "correct_sequence", "correct_order", "translation", "grammar", "vocabulary"],
}

_PASSAGE_FILL_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "context_reason": {"type": "string"},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
                "grammar": _GRAMMAR_DETAIL,
                "context_note": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation", "grammar"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "context_reason", "options_analysis", "atoms", "relations"],
}

_READING_COMP_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "summary": {"type": "string"},
        "key_sentence": {"type": "string"},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "key_sentence", "options_analysis", "atoms", "relations"],
}

_LISTENING_VOCAB_ITEM = {
    "type": "object",
    "properties": {
        "surface": {"type": "string"},
        "base": {"type": "string"},
        "reading": {"type": "string"},
        "meaning": {"type": "string"},
        "part_of_speech": {"type": "string"},
        "jlpt_level": {"type": "string"},
        "register": {"type": "string"},
        "usage": {"type": "string"},
        "nuance": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["surface", "base", "meaning", "part_of_speech", "example"],
}

_LISTENING_GRAMMAR_ITEM = {
    "type": "object",
    "properties": {
        "pattern": {"type": "string"},
        "meaning": {"type": "string"},
        "connection": {"type": "string"},
        "jlpt_level": {"type": "string"},
        "register": {"type": "string"},
        "usage": {"type": "string"},
        "nuance": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["pattern", "meaning", "usage", "example"],
}

_LISTENING_SENTENCE_ITEM = {
    "type": "object",
    "properties": {
        "index": {"type": "integer"},
        "text": {"type": "string"},
        "translation": {"type": "string"},
        "vocab": {"type": "array", "items": _LISTENING_VOCAB_ITEM},
        "grammar": {"type": "array", "items": _LISTENING_GRAMMAR_ITEM},
    },
    "required": ["index", "text", "translation"],
}

_LISTENING_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "is_correct": {"type": "boolean"},
                "explanation": {"type": "string"},
            },
            "required": ["option", "is_correct", "explanation"],
        }},
        "sentences": {"type": "array", "items": _LISTENING_SENTENCE_ITEM},
    },
    "required": ["analysis_type", "options_analysis", "sentences"],
}


_SCHEMAS: dict[str, dict] = {
    "vocab_fill":     _VOCAB_FILL_SCHEMA,
    "synonym":        _SYNONYM_SCHEMA,
    "usage":          _USAGE_SCHEMA,
    "word_formation": _WORD_FORMATION_SCHEMA,
    "kanji_reading":  _KANJI_READING_SCHEMA,
    "kanji_writing":  _KANJI_WRITING_SCHEMA,
    "grammar_fill":   _GRAMMAR_FILL_SCHEMA,
    "sentence_order": _SENTENCE_ORDER_SCHEMA,
    "passage_fill":   _PASSAGE_FILL_SCHEMA,
    "reading_comp":   _READING_COMP_SCHEMA,
    "listening":      _LISTENING_SCHEMA,
}

# ── 10 种题型 Prompt ──────────────────────────────────────────────────────────

_PROMPTS: dict[str, str] = {

"vocab_fill": """\
你是日语词汇专家。分析JLPT词汇填空题，说明各选项在该语境下为何适合或不适合。

题目：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "vocab_fill"
- summary：本题语境对词义的核心要求（1-2句）
- stem_notes：题干中有学习价值的词/语法（≤2个，排除选项本身）
- options_analysis 每项：word.surface/reading/meaning（基本形）、word.usage_condition（使用条件）、explanation（在本语境适合/不适合的理由）；若该词不存在，meaning="此词不存在"，不入atoms
- atoms：正确选项词 + 最相似干扰词（≤3个）
- relations：选项词之间的语义/搭配关系（若有混淆点）

直接输出JSON：
{schema_json}""",

"synonym": """\
你是日语词汇专家。分析JLPT同义词题，说明各选项与目标词的含义关系。

题目（目标词/句）：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "synonym"
- summary：目标词的核心含义及本题考查的语义细节
- target_word：题干中被考查词的surface/reading/meaning
- stem_notes：通常为[]
- options_analysis 每项：word.surface/reading/meaning、word.synonym_note（与目标词的含义关系）、explanation
- atoms：目标词 + 正确同义词 + 最接近的干扰词（≤3个）
- relations：同义/近义/语义差异等关系

直接输出JSON：
{schema_json}""",

"usage": """\
你是日语词汇专家。分析JLPT词汇用法题，指出各句中该词的用法是否正确及原因。

被考查词：{stem}
各句选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "usage"
- summary：被考查词的使用条件精要（1-2句）
- target_word：surface/reading/meaning/usage_conditions（详细描述使用条件）
- options_analysis 每项：explanation（用法正确/错误的理由）、violation（错误句违反了哪条规则，正确句为null）
- atoms：仅被考查词本身（1个，type="vocabulary"）
- relations：[]

直接输出JSON：
{schema_json}""",

"word_formation": """\
你是日语词汇专家。分析JLPT词汇构成题，说明各选项的构词方式及正误原因。

题目：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "word_formation"
- summary：本题考查的构词规律（1-2句）
- stem_notes：题干中有价值的词/语法（≤2个）
- options_analysis 每项：word.surface/reading/meaning、formation.components（各成分及含义）、formation.pattern（构成规律）、explanation；若该词不存在，明确注明，不入atoms
- atoms：正确词 + 最相似干扰词（≤3个，真实存在的）
- relations：构词关系或语义关系

直接输出JSON：
{schema_json}""",

"kanji_reading": """\
你是汉字专家。分析JLPT汉字读音题，说明目标词正确读音及各选项的判断依据。

题目：{stem}
目标词（汉字）：{target}
选项（读音）：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "kanji_reading"
- summary：目标词正确读音的记忆要点
- target_word：目标词的汉字形式
- confusion_points：易混淆的读音规律（同音字/特殊读音/音训混淆等）
- options_analysis 每项：explanation（该读音正确/错误的原因，若读音不存在请明确说明）
- atoms：目标词 + 形近/音近的易混词（≤3个，type="vocabulary"）
- relations：confusable 关系（音近/形近）

直接输出JSON：
{schema_json}""",

"kanji_writing": """\
你是汉字专家。分析JLPT汉字写法题，说明正确汉字的判断依据及各选项的对比。

题目：{stem}
目标读音：{target}
选项（汉字写法）：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "kanji_writing"
- summary：正确汉字的记忆要点（字形/字义/区分点）
- target_reading：被考查的读音
- confusion_points：易混淆的形近字/同音字说明
- options_analysis 每项：kanji_note（该汉字的含义及在本语境是否合适）、explanation（综合判断）
- atoms：正确词 + 最易混淆的形近/同音词（≤3个，type="vocabulary"）
- relations：confusable 关系（形近/同音异义）

直接输出JSON：
{schema_json}""",

"grammar_fill": """\
你是日语语法专家。分析JLPT语法填空题，说明各语法形式的含义差异及正误原因。

题目：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "grammar_fill"
- summary：本题语法核心区别（1-2句）
- stem_notes：题干中值得注意的词/语法（≤2个，排除选项语法）
- options_analysis 每项：grammar.pattern（〜开头，不含具体词汇）、grammar.meaning、grammar.connection（接续方式）、grammar.example、explanation；若该语法不存在，explanation中注明，不入atoms
- atoms：正确语法 + 最相似干扰语法（≤3个，type="grammar"）
- relations：语法点之间的关系（nuance/contrast/synonym等）

直接输出JSON：
{schema_json}""",

"sentence_order": """\
你是日语语法专家。分析JLPT整序题，给出排列后的完整句子及语言解析。

题目：{stem}
词组选项：
{options}
★位置：第{star_position}格
★处正确词组（选项{correct}）：{star_word}

要求：
- analysis_type = "sentence_order"
- correct_sequence：四个词组的正确排列顺序，格式如"1-3-2-4"（验证：第{star_position}位必须是选项{correct}）
- correct_order：将四个词组按 correct_sequence 填入题干空格后的完整句子
- translation：完整句子的中文翻译
- grammar：句中值得学习的语法点（pattern 以〜开头，meaning 中文含义，example 日语例句）
- vocabulary：句中值得学习的词汇（word 基本形，reading 假名读音，meaning 中文含义，part_of_speech 日语词性）

直接输出JSON：
{schema_json}""",

"passage_fill": """\
你是日语语法专家。分析JLPT段落填空题，说明上下文如何决定正确语法及各选项的对比。

段落：
{passage}

填空位置：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "passage_fill"
- summary：本题的上下文判断依据（逻辑关系/前后呼应等）
- context_reason：段落上下文如何决定了正确选项（具体指出前后文线索）
- stem_notes：段落中值得注意的词/语法（≤2个，排除选项语法）
- options_analysis 每项：grammar.pattern/meaning/connection、context_note（该语法在本段落语境中是否合适）、explanation；若语法不存在，注明
- atoms：正确语法 + 最相似干扰语法（≤3个，type="grammar"）
- relations：语法点之间的关系

直接输出JSON：
{schema_json}""",

"reading_comp": """\
你是日语阅读理解专家。分析JLPT阅读理解题的选项，指出答题依据及各选项的判断理由。

文章：
{passage}

问题：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "reading_comp"
- summary：本题考查的阅读要点（细节/主旨/推断/作者意图等）
- key_sentence：文中支持正确答案的关键句（直接引用原文）
- options_analysis 每项：explanation（正确选项说明文中依据；错误选项指出与原文哪里矛盾或无法推断）
- atoms：[]
- relations：[]

直接输出JSON：
{schema_json}""",

"listening": """\
你是日语听力理解专家。根据听力文字稿和题目，分析各选项并逐句解析文字稿。

文字稿：
{transcript}

问题：{stem}
选项：
{options}
正确答案：{correct}

{atom_rules}

要求：
- analysis_type = "listening"
- options_analysis 每项：explanation（正确选项说明音声依据；错误选项指出与音声内容哪里矛盾或未提及）
- sentences：将文字稿分割为句子，对每句提供中文翻译及词汇/语法解析。词汇和语法点尽可能全面，宁多勿少，包含口语特有表达

直接输出JSON：
{schema_json}""",
}

# ── 段落填空题——问题级分析 Schema 和 Prompt ───────────────────────────────────────

_PASSAGE_FILL_PROBLEM_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "num": {"type": "integer"},
                    "options_analysis": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "option": {"type": "string"},
                                "is_correct": {"type": "boolean"},
                                "explanation": {"type": "string"},
                            },
                            "required": ["option", "is_correct", "explanation"],
                        },
                    },
                },
                "required": ["num", "options_analysis"],
            },
        },
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "translation": {"type": "string"},
                    "vocab": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "surface": {"type": "string"},
                                "base": {"type": "string"},
                                "reading": {"type": "string"},
                                "meaning": {"type": "string"},
                                "part_of_speech": {"type": "string"},
                                "jlpt_level": {"type": "string"},
                                "example": {"type": "string"},
                            },
                            "required": ["surface", "base", "reading", "meaning", "part_of_speech"],
                        },
                    },
                    "grammar": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "pattern": {"type": "string"},
                                "meaning": {"type": "string"},
                                "connection": {"type": "string"},
                                "example": {"type": "string"},
                            },
                            "required": ["pattern", "meaning"],
                        },
                    },
                },
                "required": ["text", "translation", "vocab", "grammar"],
            },
        },
    },
    "required": ["analysis_type", "items", "sentences"],
}

# ── 阅读理解——问题级 Schema 和 Prompt ─────────────────────────────────────────

_READING_COMP_PROBLEM_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis_type": {"type": "string"},
        "sentences": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "translation": {"type": "string"},
                    "vocab": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "surface": {"type": "string"},
                                "base": {"type": "string"},
                                "reading": {"type": "string"},
                                "meaning": {"type": "string"},
                                "part_of_speech": {"type": "string"},
                                "jlpt_level": {"type": "string"},
                                "example": {"type": "string"},
                            },
                            "required": ["surface", "base", "reading", "meaning", "part_of_speech"],
                        },
                    },
                    "grammar": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "pattern": {"type": "string"},
                                "meaning": {"type": "string"},
                                "connection": {"type": "string"},
                                "example": {"type": "string"},
                            },
                            "required": ["pattern", "meaning"],
                        },
                    },
                },
                "required": ["text", "translation", "vocab", "grammar"],
            },
        },
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "num": {"type": "integer"},
                    "stem_translation": {"type": "string"},
                    "options": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "option": {"type": "string"},
                                "text": {"type": "string"},
                                "translation": {"type": "string"},
                                "is_correct": {"type": "boolean"},
                            },
                            "required": ["option", "text", "translation", "is_correct"],
                        },
                    },
                },
                "required": ["num", "stem_translation", "options"],
            },
        },
    },
    "required": ["analysis_type", "sentences", "questions"],
}

_READING_COMP_PROBLEM_PROMPT = """\
你是日语阅读理解专家。请对以下JLPT阅读文章进行逐句语料分析，并翻译题目。所有解释、说明、翻译均使用中文输出，不得使用英文。

文章：
{passage}

题目：
{questions_info}

请按照以下要求输出：
1. sentences：将文章分割为句子，对每个句子提供中文翻译。
2. 尽可能全面地提取每个句子中所有值得学习的词汇（vocabulary）和语法点（grammar），不限等级，宁多勿少。
3. 语法点必须覆盖：助词用法、助动词（て形/た形/ている/てしまう 等）、句末表达（ね/よ/でしょう 等）、接续表达、敬语形式、条件句、被动/使役等——即使是"简单句"也一定存在可标注的语法点，grammar 数组不能为空。
4. 每个词汇和语法点都必须标注 jlpt_level（N1/N2/N3/N4/N5），如果不确定则填 null。
5. questions：每道题编号（num）、stem_translation（题干中文翻译）、options（每个选项的 option字母、text原文、translation中文翻译、is_correct是否正确答案）

直接输出JSON：
{schema_json}"""

_PASSAGE_FILL_PROBLEM_PROMPT = """\
你是日语语法专家。请对以下JLPT补全文章题进行逐句语料分析，并对比各填空选项。所有解释、说明、翻译均使用中文输出，不得使用英文。

文章：
{passage}

填空明细：
{items_info}

请按照以下要求输出：
1. sentences：将文章分割为句子，对每个句子提供中文翻译。
2. 尽可能全面地提取每个句子中所有值得学习的词汇（vocabulary）和语法点（grammar），不限等级，宁多勿少。
3. 语法点必须覆盖：助词用法、助动词（て形/た形/ている/てしまう 等）、句末表达（ね/よ/でしょう 等）、接续表达、敬语形式、条件句、被动/使役等——即使是"简单句"也一定存在可标注的语法点，grammar 数组不能为空。
4. 每个词汇和语法点都必须标注 jlpt_level（N1/N2/N3/N4/N5），如果不确定则填 null。
5. items：每处填空编号（num）对应的 options_analysis（每个选项的 is_correct + explanation 说明在该语境中适合或不适合的理由，正确选项需说明上下文线索）

直接输出JSON：
{schema_json}"""


# ── 试卷列表 ──────────────────────────────────────────────────────────────────

@router.get("/exams", response_model=list[ExamPaperList])
async def list_exams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            ExamPaper,
            func.count(ExamSection.id.distinct()).label("section_count"),
            func.count(ExamItem.id).label("item_count"),
        )
        .outerjoin(ExamSection, ExamSection.paper_id == ExamPaper.id)
        .outerjoin(ExamProblem, ExamProblem.section_id == ExamSection.id)
        .outerjoin(ExamItem, ExamItem.problem_id == ExamProblem.id)
        .group_by(ExamPaper.id)
        .order_by(ExamPaper.created_at.desc())
    )
    rows = result.all()
    return [
        ExamPaperList(
            id=paper.id, title=paper.title, level=paper.level,
            source=paper.source, section_count=sc, item_count=ic,
            created_at=paper.created_at,
        )
        for paper, sc, ic in rows
    ]


# ── 试卷详情（题目不含正解） ──────────────────────────────────────────────────

@router.get("/exams/{paper_id}", response_model=ExamPaperDetail)
async def get_exam(paper_id: UUID, db: AsyncSession = Depends(get_db)):
    paper = await db.get(ExamPaper, paper_id)
    if paper is None:
        raise HTTPException(status_code=404, detail="Exam paper not found")

    sections = (await db.execute(
        select(ExamSection).where(ExamSection.paper_id == paper_id).order_by(ExamSection.seq)
    )).scalars().all()

    section_details = []
    for sec in sections:
        problems = (await db.execute(
            select(ExamProblem).where(ExamProblem.section_id == sec.id).order_by(ExamProblem.seq)
        )).scalars().all()

        problem_details = []
        for prob in problems:
            items = (await db.execute(
                select(ExamItem).where(ExamItem.problem_id == prob.id).order_by(ExamItem.seq)
            )).scalars().all()
            media = (await db.execute(
                select(ExamMedia).where(ExamMedia.problem_id == prob.id).order_by(ExamMedia.seq)
            )).scalars().all()
            problem_details.append(ProblemDetail(
                id=prob.id, seq=prob.seq, name=prob.name, type=prob.type,
                instruction=prob.instruction, passage=prob.passage, transcript=prob.transcript,
                media=[ExamMediaItem(id=m.id, url=m.url, caption=m.caption, seq=m.seq) for m in media],
                items=[ItemSchema(id=i.id, seq=i.seq, num=i.num, stem=i.stem,
                                  transcript=i.transcript, passage=i.passage,
                                  options=i.options, meta=i.meta) for i in items],
            ))

        section_details.append(SectionDetail(
            id=sec.id, name=sec.name, seq=sec.seq, problems=problem_details,
        ))

    return ExamPaperDetail(
        id=paper.id, title=paper.title, level=paper.level,
        source=paper.source, sections=section_details, created_at=paper.created_at,
    )


# ── 开始答题 ──────────────────────────────────────────────────────────────────

@router.post("/exams/{paper_id}/attempts", response_model=StartAttemptResponse)
async def start_attempt(
    paper_id: UUID,
    body: StartAttemptRequest | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Begin a sitting over the 問題 chosen for it.

    `problem_ids` is what this run set out to cover. Omitted, the run covers
    the whole paper — which is what starting one used to mean.
    """
    if not await db.get(ExamPaper, paper_id):
        raise HTTPException(status_code=404, detail="Exam paper not found")
    scope = [str(p) for p in (body.problem_ids if body else None) or []] or None
    attempt = ExamAttempt(paper_id=paper_id, scope=scope)
    db.add(attempt)
    await db.flush()
    await db.commit()
    return StartAttemptResponse(attempt_id=attempt.id, paper_id=paper_id, status=attempt.status)


# ── 答题进度 ──────────────────────────────────────────────────────────────────

@router.get("/attempts/{attempt_id}", response_model=AttemptStatus)
async def get_attempt(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    answered = (await db.execute(
        select(AttemptAnswer.item_id).where(AttemptAnswer.attempt_id == attempt_id)
    )).scalars().all()
    return AttemptStatus(
        attempt_id=attempt.id, paper_id=attempt.paper_id,
        status=attempt.status, score=attempt.score, answered_item_ids=list(answered),
    )


# ── 提交单题答案 ──────────────────────────────────────────────────────────────

@router.put("/attempts/{attempt_id}/answers", response_model=SubmitAnswerResponse)
async def submit_answer(
    attempt_id: UUID, req: SubmitAnswerRequest, db: AsyncSession = Depends(get_db),
):
    if not await db.get(ExamAttempt, attempt_id):
        raise HTTPException(status_code=404, detail="Attempt not found")

    item = await db.get(ExamItem, req.item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    is_correct = (item.correct_answer == req.answer) if item.correct_answer else None

    existing = (await db.execute(
        select(AttemptAnswer).where(
            AttemptAnswer.attempt_id == attempt_id,
            AttemptAnswer.item_id == req.item_id,
        )
    )).scalar_one_or_none()

    if existing:
        existing.user_answer = req.answer
        existing.is_correct = bool(is_correct)
    else:
        db.add(AttemptAnswer(
            attempt_id=attempt_id, item_id=req.item_id,
            user_answer=req.answer, is_correct=bool(is_correct),
        ))

    await db.commit()
    return SubmitAnswerResponse(item_id=req.item_id, is_correct=is_correct)


# ── 提交本节并算分 ────────────────────────────────────────────────────────────

@router.post("/attempts/{attempt_id}/sections/{section_id}/submit",
             response_model=SubmitSectionResponse)
async def submit_section(
    attempt_id: UUID, section_id: UUID,
    background: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")
    section = await db.get(ExamSection, section_id)
    if section is None:
        raise HTTPException(status_code=404, detail="Section not found")

    problems = (await db.execute(
        select(ExamProblem).where(ExamProblem.section_id == section_id)
    )).scalars().all()
    prob_ids = [p.id for p in problems]

    items = (await db.execute(
        select(ExamItem).where(ExamItem.problem_id.in_(prob_ids)).order_by(ExamItem.seq)
    )).scalars().all()
    item_ids = [i.id for i in items]

    answers = {
        a.item_id: a
        for a in (await db.execute(
            select(AttemptAnswer).where(
                AttemptAnswer.attempt_id == attempt_id,
                AttemptAnswer.item_id.in_(item_ids),
            )
        )).scalars().all()
    }

    correct_count = sum(1 for a in answers.values() if a.is_correct)
    total = len([i for i in items if i.options])

    score = attempt.score or {}
    score[section.name] = {"correct": correct_count, "total": total}
    score["total"] = {
        "correct": sum(v["correct"] for k, v in score.items() if k != "total"),
        "total":   sum(v["total"]   for k, v in score.items() if k != "total"),
    }

    await db.execute(
        update(ExamAttempt).where(ExamAttempt.id == attempt_id).values(score=score)
    )
    await db.commit()

    # Explain what went wrong while the score is being read, rather than making
    # the explanation something to wait for when it is asked for.
    wrong = [i.id for i in items if i.id in answers and not answers[i.id].is_correct]
    if wrong:
        background.add_task(prepare_analyses, wrong)

    answer_details = [
        SectionAnswerDetail(
            item_id=str(i.id),
            user_answer=answers[i.id].user_answer if i.id in answers else None,
            is_correct=answers[i.id].is_correct if i.id in answers else False,
            correct_answer=i.correct_answer,
        )
        for i in items
    ]

    return SubmitSectionResponse(
        section_name=section.name,
        score=SectionScore(correct=correct_count, total=total),
        answers=answer_details,
    )


# ── AI 分析（懒生成+缓存）────────────────────────────────────────────────────

@router.get("/items/{item_id}/analysis", response_model=QuestionAnalysisResponse)
async def get_item_analysis(item_id: UUID, db: AsyncSession = Depends(get_db)):
    item = await db.get(ExamItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    problem = await db.get(ExamProblem, item.problem_id)

    cached = (await db.execute(
        select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id)
    )).scalar_one_or_none()
    if cached and cached.session_data:
        return QuestionAnalysisResponse(
            item_id=item_id, session_data=cached.session_data,
            relations_suggested=[], cached=True,
        )

    result_data = await _analyse_item(item, problem, db)
    if result_data is None:
        return QuestionAnalysisResponse(
            item_id=item_id, session_data=None, relations_suggested=[], cached=False,
        )

    return QuestionAnalysisResponse(
        item_id=item_id, session_data=result_data,
        relations_suggested=[], cached=False,
    )


# ── 段落填空题——问题级 AI 分析 ─────────────────────────────────────────────────

@router.get("/problems/{problem_id}/analysis")
async def get_problem_analysis(problem_id: UUID, db: AsyncSession = Depends(get_db)):
    problem = await db.get(ExamProblem, problem_id)
    if problem is None:
        raise HTTPException(status_code=404, detail="Problem not found")

    if problem.type not in ("passage_fill", "reading_comp"):
        raise HTTPException(status_code=400, detail="Problem-level analysis only supported for passage_fill and reading_comp")

    cached = (await db.execute(
        select(ProblemAnalysis).where(ProblemAnalysis.problem_id == problem_id)
    )).scalar_one_or_none()
    if cached and cached.session_data:
        return {"problem_id": str(problem_id), "session_data": cached.session_data, "cached": True}

    # Load all items eagerly
    items_result = await db.execute(
        select(ExamItem).where(ExamItem.problem_id == problem_id).order_by(ExamItem.seq)
    )
    items = items_result.scalars().all()
    if not items:
        raise HTTPException(status_code=404, detail="No items found for problem")

    # This analyses the whole 問題, so it wants every text in it. Where the
    # texts were split onto the items, the 問題 still holds them all together.
    passage = problem.passage or "\n\n".join(
        dict.fromkeys(i.passage for i in items if i.passage)
    )

    prompt = "重要：所有 explanation、translation、meaning、connection、usage、example 等文字字段必须使用中文输出。\n\n"

    if problem.type == "reading_comp":
        questions_lines = []
        for it in items:
            opts_text = "\n".join(f"  {k}. {v}" for k, v in sorted(it.options.items()))
            questions_lines.append(
                f"第{it.num}题：{it.stem or ''}\n选项：\n{opts_text}\n正确答案：{it.correct_answer or '不明'}"
            )
        questions_info = "\n\n".join(questions_lines)
        prompt += _READING_COMP_PROBLEM_PROMPT.format(
            passage=passage,
            questions_info=questions_info,
            schema_json=json.dumps(_READING_COMP_PROBLEM_SCHEMA, ensure_ascii=False),
        )
        schema = _READING_COMP_PROBLEM_SCHEMA
    else:
        items_lines = []
        for it in items:
            opts_text = "\n".join(f"  {k}. {v}" for k, v in sorted(it.options.items()))
            items_lines.append(
                f"第{it.num}空\n选项：\n{opts_text}\n正确答案：{it.correct_answer or '不明'}"
            )
        items_info = "\n\n".join(items_lines)
        prompt += _PASSAGE_FILL_PROBLEM_PROMPT.format(
            passage=passage,
            items_info=items_info,
            schema_json=json.dumps(_PASSAGE_FILL_PROBLEM_SCHEMA, ensure_ascii=False),
        )
        schema = _PASSAGE_FILL_PROBLEM_SCHEMA

    llm = get_llm_client()
    try:
        raw = await llm.analyze(prompt, schema)
        result_data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("LLM problem analysis failed for problem %s: %s", problem_id, e)
        raise HTTPException(status_code=502, detail="AI analysis failed")

    if cached:
        cached.session_data = result_data
    else:
        db.add(ProblemAnalysis(problem_id=problem_id, session_data=result_data))
    await db.commit()

    return {"problem_id": str(problem_id), "session_data": result_data, "cached": False}


# ── 追问 ──────────────────────────────────────────────────────────────────────

@router.post("/items/{item_id}/analysis/followup")
async def followup_analysis(item_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    cached = (await db.execute(
        select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id)
    )).scalar_one_or_none()
    if cached is None:
        raise HTTPException(status_code=404, detail="No analysis yet. Call GET first.")

    free_prompt = body.get("prompt", "").strip()
    if not free_prompt:
        raise HTTPException(status_code=400, detail="prompt is required")

    llm = get_llm_client()
    response_text = await llm.complete(free_prompt)

    session = cached.session_data or {}
    followups = session.get("followups", [])
    followups.append({"prompt": free_prompt, "response": response_text})
    session["followups"] = followups

    await db.execute(
        update(QuestionAnalysis)
        .where(QuestionAnalysis.item_id == item_id)
        .values(session_data=session)
    )
    await db.commit()
    return {"response": response_text}


# ── 正确率统计 ────────────────────────────────────────────────────────────────

_VOCAB_TYPES = {"kanji_reading", "kanji_writing", "word_formation", "vocab_fill", "synonym", "usage"}
_GRAMMAR_TYPES = {"grammar_fill", "sentence_order", "passage_fill"}
_READING_TYPES = {"reading_comp"}
_LISTENING_TYPES = {"listening"}


@router.get("/stats/accuracy", response_model=AccuracyStats)
async def get_accuracy_stats(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(AttemptAnswer.is_correct, ExamProblem.type)
        .join(ExamItem, AttemptAnswer.item_id == ExamItem.id)
        .join(ExamProblem, ExamItem.problem_id == ExamProblem.id)
    )).all()

    counts: dict[str, dict[str, int]] = {
        k: {"correct": 0, "total": 0}
        for k in ("vocab", "grammar", "reading", "listening")
    }

    for is_correct, q_type in rows:
        if q_type in _VOCAB_TYPES:
            cat = "vocab"
        elif q_type in _GRAMMAR_TYPES:
            cat = "grammar"
        elif q_type in _READING_TYPES:
            cat = "reading"
        elif q_type in _LISTENING_TYPES:
            cat = "listening"
        else:
            continue
        counts[cat]["total"] += 1
        if is_correct:
            counts[cat]["correct"] += 1

    return AccuracyStats(**{k: v for k, v in counts.items()})


# ── 考试记录列表 ──────────────────────────────────────────────────────────────

@router.get("/exams/{paper_id}/attempts", response_model=list[AttemptSummary])
async def list_paper_attempts(paper_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(ExamPaper, paper_id):
        raise HTTPException(status_code=404, detail="Exam paper not found")
    rows = (await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.paper_id == paper_id)
        .order_by(ExamAttempt.started_at.desc())
    )).scalars().all()
    if not rows:
        return []

    # What each run covers. A run says so itself now; runs recorded before it
    # did are read backwards from the answers, which is all they can offer.
    scoped = {str(pid) for r in rows for pid in (r.scope or [])}

    # How far through its own range each run got. Counted against the range it
    # chose, not the paper: a run over 文字・語彙 is finished at 25 of 25.
    answered_counts = dict((await db.execute(
        select(AttemptAnswer.attempt_id, func.count())
        .where(AttemptAnswer.attempt_id.in_([r.id for r in rows]))
        .group_by(AttemptAnswer.attempt_id)
    )).all())
    in_scope_totals: dict[str, int] = {}
    if scoped:
        in_scope_totals = dict((await db.execute(
            select(ExamItem.problem_id, func.count())
            .where(ExamItem.problem_id.in_(scoped), ExamItem.options != {})
            .group_by(ExamItem.problem_id)
        )).all())
        in_scope_totals = {str(k): v for k, v in in_scope_totals.items()}
    problem_names: dict[str, tuple[str, int]] = {}
    scope_parts: dict[str, tuple[str, int]] = {}
    if scoped:
        for pid, name, seq, part, part_seq in (await db.execute(
            select(ExamProblem.id, ExamProblem.name, ExamProblem.seq,
                   ExamSection.name, ExamSection.seq)
            .join(ExamSection, ExamProblem.section_id == ExamSection.id)
            .where(ExamProblem.id.in_(scoped))
        )).all():
            problem_names[str(pid)] = (name, seq)
            scope_parts[str(pid)] = (part, part_seq)

    # Fetch section names per attempt (ordered by section seq)
    attempt_ids = [r.id for r in rows]
    sec_rows = (await db.execute(
        select(AttemptAnswer.attempt_id, ExamSection.name, ExamSection.seq)
        .join(ExamItem, AttemptAnswer.item_id == ExamItem.id)
        .join(ExamProblem, ExamItem.problem_id == ExamProblem.id)
        .join(ExamSection, ExamProblem.section_id == ExamSection.id)
        .where(AttemptAnswer.attempt_id.in_(attempt_ids))
        .distinct()
        .order_by(ExamSection.seq)
    )).all()
    from collections import defaultdict
    sec_map: dict = defaultdict(list)
    seen: set = set()
    for aid, name, _ in sec_rows:
        if (aid, name) not in seen:
            seen.add((aid, name))
            sec_map[aid].append(name)

    return [
        AttemptSummary(
            attempt_id=r.id, paper_id=r.paper_id, status=r.status,
            score=r.score, started_at=r.started_at, completed_at=r.completed_at,
            # From the range the run chose, so a run left untouched still says
            # what it was for; from the answers only for runs recorded before
            # a run stated its range.
            section_names=(
                [n for n, _ in sorted(
                    {scope_parts[str(p)] for p in (r.scope or []) if str(p) in scope_parts},
                    key=lambda x: x[1],
                )]
                or sec_map.get(r.id, [])
            ),
            answered=answered_counts.get(r.id, 0),
            in_scope=sum(in_scope_totals.get(str(p), 0) for p in (r.scope or [])) or None,
            problem_names=[
                problem_names[str(pid)][0]
                for pid in sorted(
                    r.scope or [], key=lambda x: problem_names.get(str(x), ("", 0))[1],
                )
                if str(pid) in problem_names
            ],
        )
        for r in rows
    ]



async def _analyse_item(item, problem, db) -> dict | None:
    """Explain one question and store it against the question.

    Shared by the endpoint and the background pass that runs after a section is
    submitted, so an explanation asked for by hand and one prepared in advance
    are the same work and land in the same place.

    Returns None where the question's type has no prompt for it.
    """
    schema = _SCHEMAS.get(problem.type)
    prompt_tpl = _PROMPTS.get(problem.type)
    if schema is None or prompt_tpl is None:
        return None

    opts_text = "\n".join(f"{k}. {v}" for k, v in sorted(item.options.items()))
    correct = item.correct_answer or "不明"
    target = (item.meta or {}).get("target", item.stem or "")
    star_position = (item.meta or {}).get("star_position", "")
    star_word = (item.options or {}).get(str(correct), "") if item.options else ""

    transcript = item.transcript or problem.transcript or ""
    # Where a 問題 holds several texts, the question is about one of them.
    # Handing the analyser all four is handing it three red herrings.
    passage = item.passage or problem.passage or ""
    prompt = (
        "重要：所有 explanation、summary、meaning、connection、usage、example 等文字字段必须使用中文输出。\n\n"
        + prompt_tpl.format(
            stem=item.stem or "", passage=passage, transcript=transcript,
            options=opts_text, correct=correct, target=target,
            atom_rules=_ATOM_RULES,
            schema_json=json.dumps(schema, ensure_ascii=False),
            star_position=star_position, star_word=star_word,
        )
    )

    llm = get_llm_client()
    try:
        raw = await llm.analyze(prompt, schema)
        result_data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as exc:
        logger.error("LLM analysis failed for item %s: %s", item.id, exc)
        raise HTTPException(status_code=502, detail="AI analysis failed") from exc

    cached = (await db.execute(
        select(QuestionAnalysis).where(QuestionAnalysis.item_id == item.id)
    )).scalar_one_or_none()
    if cached:
        cached.session_data = result_data
        cached.relations_suggested = []
    else:
        db.add(QuestionAnalysis(
            item_id=item.id, session_data=result_data, relations_suggested=[],
        ))
    await db.commit()
    return result_data


async def prepare_analyses(item_ids: list[UUID]) -> None:
    """Explain a set of questions in the background.

    Run after a section is submitted, over the ones answered wrongly. The wait
    for an explanation then happens while the score is being read rather than
    when the explanation is asked for — and a question explained once keeps it,
    so the second time it is instant either way.

    Failures are swallowed: this is preparation, and the explanation can still
    be asked for by hand.
    """
    from app.models.db import async_session_factory

    for item_id in item_ids:
        try:
            async with async_session_factory() as db:
                if (await db.execute(
                    select(QuestionAnalysis).where(QuestionAnalysis.item_id == item_id)
                )).scalar_one_or_none() is not None:
                    continue
                item = await db.get(ExamItem, item_id)
                if item is None:
                    continue
                problem = await db.get(ExamProblem, item.problem_id)
                if problem is None:
                    continue
                await _analyse_item(item, problem, db)
        except Exception as exc:
            logger.info("prepare analysis for %s skipped: %s", item_id, exc)


# ── 聴解音频 ───────────────────────────────────────────────────────────────

@router.post("/items/{item_id}/audio")
async def make_audio(item_id: UUID, db: AsyncSession = Depends(get_db)):
    """Speak this question's dialogue, and keep the clip.

    Synthesised once and stored: a listening question is met again — in review,
    in the mistakes list, on a second sitting — and re-reading it aloud each
    time would cost a call and give a slightly different recording every time.
    """
    item = await db.get(ExamItem, item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")

    existing = (await db.execute(
        select(ExamMedia).where(ExamMedia.item_id == item_id, ExamMedia.media_type == "audio")
    )).scalars().first()
    if existing is not None:
        return {"media_id": str(existing.id), "cached": True}

    text = item.transcript or (item.problem.transcript if item.problem else None)
    if not text:
        raise HTTPException(status_code=400, detail="这道题没有听力原文，无法合成")

    try:
        audio = await speak(text)
    except TTSUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    media = ExamMedia(item_id=item_id, media_type="audio", data=audio, seq=0)
    db.add(media)
    await db.flush()
    await db.commit()
    return {"media_id": str(media.id), "cached": False}


@router.get("/media/{media_id}")
async def get_media(media_id: UUID, db: AsyncSession = Depends(get_db)):
    media = await db.get(ExamMedia, media_id)
    if media is None or media.data is None:
        raise HTTPException(status_code=404, detail="Media not found")
    kind = "audio/wav" if media.media_type == "audio" else "image/png"
    # Immutable once written, so it is worth caching in the browser.
    return Response(
        content=media.data, media_type=kind,
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


# ── 错题 ────────────────────────────────────────────────────────────────────

@router.get("/mistakes", response_model=list[MistakeItem])
async def list_mistakes(
    category: str | None = None,
    paper_id: UUID | None = None,
    db: AsyncSession = Depends(get_db),
):
    """Every question answered wrongly, worst first.

    Gathered across records rather than inside one. A mistake made once is
    worth another look; the same mistake three times is the thing to work on,
    and that only shows when the records are read together.

    The explanation is not fetched here — it hangs off the question, so a
    question met again brings the one already generated with it.
    """
    rows = (await db.execute(
        select(
            ExamItem, ExamProblem, ExamPaper,
            func.count().filter(AttemptAnswer.is_correct.is_(False)).label("wrong"),
            func.count().label("seen"),
            func.max(ExamAttempt.started_at).label("last_seen"),
            func.count(QuestionAnalysis.id).label("analyses"),
            # Which wrong option was picked. Distinct across records, because
            # picking 2 twice and picking 3 once are different mistakes.
            func.array_agg(distinct(AttemptAnswer.user_answer))
                .filter(AttemptAnswer.is_correct.is_(False)).label("picked"),
        )
        .join(AttemptAnswer, AttemptAnswer.item_id == ExamItem.id)
        .join(ExamAttempt, AttemptAnswer.attempt_id == ExamAttempt.id)
        .join(ExamProblem, ExamItem.problem_id == ExamProblem.id)
        .join(ExamSection, ExamProblem.section_id == ExamSection.id)
        .join(ExamPaper, ExamSection.paper_id == ExamPaper.id)
        .outerjoin(QuestionAnalysis, QuestionAnalysis.item_id == ExamItem.id)
        .group_by(ExamItem.id, ExamProblem.id, ExamPaper.id)
        .having(func.count().filter(AttemptAnswer.is_correct.is_(False)) > 0)
    )).all()

    out = []
    for item, problem, paper, wrong, seen, last_seen, analyses, picked in rows:
        cat = _category_of(problem.type)
        if category and cat != category:
            continue
        if paper_id and paper.id != paper_id:
            continue
        out.append(MistakeItem(
            item_id=item.id, problem_id=problem.id,
            paper_title=paper.title, problem_name=problem.name,
            problem_type=problem.type, category=cat,
            num=item.num, stem=item.stem, options=item.options or {},
            correct_answer=item.correct_answer,
            wrong_count=wrong, seen_count=seen, last_seen=last_seen,
            has_analysis=analyses > 0,
            wrong_answers=sorted(picked or []),
        ))
    # Worst first: the same mistake three times is the thing to work on.
    out.sort(key=lambda m: (-m.wrong_count, m.last_seen), reverse=False)
    return out


def _category_of(problem_type: str) -> str:
    if problem_type in _VOCAB_TYPES:
        return "vocab"
    if problem_type in _GRAMMAR_TYPES:
        return "grammar"
    if problem_type in _READING_TYPES:
        return "reading"
    if problem_type in _LISTENING_TYPES:
        return "listening"
    return "other"


# ── 完成考试 ──────────────────────────────────────────────────────────────────

@router.post("/attempts/{attempt_id}/complete")
async def complete_attempt(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(ExamAttempt, attempt_id):
        raise HTTPException(status_code=404, detail="Attempt not found")
    await db.execute(
        update(ExamAttempt).where(ExamAttempt.id == attempt_id)
        .values(status="completed", completed_at=func.now())
    )
    await db.commit()
    return {"status": "completed"}


# ── 删除考试记录 ─────────────────────────────────────────────────────────────

@router.delete("/attempts/{attempt_id}", status_code=204)
async def delete_attempt(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(ExamAttempt, attempt_id):
        raise HTTPException(status_code=404, detail="Attempt not found")
    await db.execute(delete(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt_id))
    await db.execute(delete(ExamAttempt).where(ExamAttempt.id == attempt_id))
    await db.commit()


# ── 考试复习（答案+解析入口） ─────────────────────────────────────────────────

@router.get("/attempts/{attempt_id}/review", response_model=AttemptReview)
async def get_attempt_review(attempt_id: UUID, db: AsyncSession = Depends(get_db)):
    attempt = await db.get(ExamAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(status_code=404, detail="Attempt not found")

    sections = (await db.execute(
        select(ExamSection)
        .where(ExamSection.paper_id == attempt.paper_id)
        .order_by(ExamSection.seq)
    )).scalars().all()

    score_names = set((attempt.score or {}).keys()) - {"total"}
    submitted_section_ids = {s.id for s in sections if s.name in score_names}

    answers_rows = (await db.execute(
        select(AttemptAnswer).where(AttemptAnswer.attempt_id == attempt_id)
    )).scalars().all()
    answers = {a.item_id: a for a in answers_rows}
    active_item_ids = set(answers.keys())

    result_sections = []
    for sec in sections:
        problems = (await db.execute(
            select(ExamProblem).where(ExamProblem.section_id == sec.id).order_by(ExamProblem.seq)
        )).scalars().all()

        review_problems = []
        sec_has_activity = False
        for prob in problems:
            items = (await db.execute(
                select(ExamItem).where(ExamItem.problem_id == prob.id).order_by(ExamItem.seq)
            )).scalars().all()
            media = (await db.execute(
                select(ExamMedia).where(ExamMedia.problem_id == prob.id).order_by(ExamMedia.seq)
            )).scalars().all()

            reveal = sec.id in submitted_section_ids
            review_items = [
                ReviewItem(
                    id=i.id, seq=i.seq, num=i.num, stem=i.stem,
                    transcript=i.transcript, passage=i.passage, options=i.options, meta=i.meta,
                    user_answer=answers[i.id].user_answer if i.id in answers else None,
                    correct_answer=i.correct_answer if reveal else None,
                    is_correct=answers[i.id].is_correct if i.id in answers and reveal else None,
                )
                for i in items
            ]
            if any(i.id in active_item_ids for i in items) or sec.id in submitted_section_ids:
                sec_has_activity = True
            review_problems.append(ReviewProblem(
                id=prob.id, seq=prob.seq, name=prob.name, type=prob.type,
                instruction=prob.instruction, passage=prob.passage, transcript=prob.transcript,
                media=[ExamMediaItem(id=m.id, url=m.url, caption=m.caption, seq=m.seq) for m in media],
                items=review_items,
            ))

        if sec_has_activity:
            result_sections.append(ReviewSection(
                id=sec.id, name=sec.name, seq=sec.seq, problems=review_problems,
            ))

    return AttemptReview(
        attempt_id=attempt.id, paper_id=attempt.paper_id,
        status=attempt.status, score=attempt.score,
        started_at=attempt.started_at, completed_at=attempt.completed_at,
        sections=result_sections,
    )


# ---------------------------------------------------------------------------
# Correcting an imported question
#
# Importing used to be one-way, so a question found to be wrong could only be
# fixed by deleting its paper and losing the attempts recorded against it.
# ---------------------------------------------------------------------------

@router.patch("/exam/items/{item_id}")
async def edit_item(item_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    """Correct one question. Scoped to the item so the paper is not rebuilt
    and attempt history keeps pointing at the same rows."""
    note = body.pop("note", None)
    item, revisions = await exam_edit.apply_item_edit(db, item_id, body, note=note)
    await db.commit()
    return {
        "id": str(item.id),
        "changed": [r.field for r in revisions],
        "stem": item.stem,
        "options": item.options,
        "correct_answer": item.correct_answer,
        "answer_order": item.answer_order,
    }


@router.patch("/exam/problems/{problem_id}")
async def edit_problem(problem_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    problem = await exam_edit.apply_problem_edit(db, problem_id, body)
    await db.commit()
    return {
        "id": str(problem.id),
        "passage": problem.passage,
        "passage_translation": problem.passage_translation,
        "instruction": problem.instruction,
    }


@router.get("/exam/items/{item_id}/revisions")
async def list_revisions(item_id: UUID, db: AsyncSession = Depends(get_db)):
    """What has been changed on this question. A past attempt was answered
    against the wording as it stood, so the history is worth being able to see."""
    rows = (await db.execute(
        select(ExamItemRevision)
        .where(ExamItemRevision.item_id == item_id)
        .order_by(ExamItemRevision.created_at.desc())
    )).scalars().all()
    return [
        {
            "id": str(r.id), "field": r.field,
            "old_value": r.old_value, "new_value": r.new_value,
            "source": r.source, "note": r.note,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/exam/items/{item_id}/report", status_code=201)
async def report_item(item_id: UUID, body: dict, db: AsyncSession = Depends(get_db)):
    """Flag a question while answering — the moment a defect is actually
    noticed, rather than when someone next reviews an import."""
    attempt_id = body.get("attempt_id")
    report = await exam_edit.report_item(
        db, item_id, body.get("kind", "other"),
        note=body.get("note"),
        attempt_id=UUID(attempt_id) if attempt_id else None,
    )
    await db.commit()
    return {"id": str(report.id), "status": report.status, "kind": report.kind}


@router.get("/exam/reports")
async def list_reports(status: str = "open", db: AsyncSession = Depends(get_db)):
    """Flagged questions waiting to be dealt with, with enough of each to act
    on without opening the paper."""
    rows = (await db.execute(
        select(ExamItemReport, ExamItem, ExamProblem, ExamPaper)
        .join(ExamItem, ExamItem.id == ExamItemReport.item_id)
        .join(ExamProblem, ExamProblem.id == ExamItem.problem_id)
        .join(ExamSection, ExamSection.id == ExamProblem.section_id)
        .join(ExamPaper, ExamPaper.id == ExamSection.paper_id)
        .where(ExamItemReport.status == status)
        .order_by(ExamItemReport.created_at.desc())
    )).all()
    return [
        {
            "id": str(report.id), "kind": report.kind, "note": report.note,
            "created_at": report.created_at.isoformat() if report.created_at else None,
            "item": {
                "id": str(item.id), "num": item.num, "stem": item.stem,
                "options": item.options, "correct_answer": item.correct_answer,
                "answer_order": item.answer_order,
            },
            "problem": {"id": str(problem.id), "name": problem.name, "type": problem.type},
            "paper": {"id": str(paper.id), "title": paper.title},
        }
        for report, item, problem, paper in rows
    ]


@router.post("/exam/reports/{report_id}/resolve")
async def resolve_report(report_id: UUID, db: AsyncSession = Depends(get_db)):
    report = await exam_edit.resolve_report(db, report_id)
    await db.commit()
    return {"id": str(report.id), "status": report.status}
