import json
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.db import (
    ExamPaper, ExamSection, ExamProblem, ExamItem, ExamMedia,
    QuestionAnalysis, ExamAttempt, AttemptAnswer, get_db,
)
from app.schemas.exam import (
    ExamPaperList, ExamPaperDetail, SectionDetail, ProblemDetail,
    ItemSchema, ExamMediaItem,
    StartAttemptResponse, SubmitAnswerRequest, SubmitAnswerResponse,
    SectionScore, SectionAnswerDetail, SubmitSectionResponse,
    AttemptStatus, RelationSuggestion, QuestionAnalysisResponse, AccuracyStats,
    AttemptSummary, AttemptReview, ReviewSection, ReviewProblem, ReviewItem,
)
from app.services.llm.factory import get_llm_client

logger = logging.getLogger(__name__)
router = APIRouter(tags=["exam"])

# ── 分析 JSON Schema ──────────────────────────────────────────────────────────

_ATOM_ITEM = {
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
        "example": {"type": "string"},        # 日语例句
    },
    "required": ["type", "key", "meaning", "part_of_speech"],
}

# relation_type 枚举与 atom_service.VALID_RELATION_TYPES 保持一致
_RELATION_ITEM = {
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

_STEM_NOTE_ITEM = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": ["grammar", "vocabulary"]},
        "key": {"type": "string"},
        "reading": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["type", "key", "note"],
}

_WORD_DETAIL = {
    "type": "object",
    "properties": {
        "surface": {"type": "string"},
        "reading": {"type": "string"},
        "meaning": {"type": "string"},
        "usage_condition": {"type": "string"},
    },
    "required": ["surface", "reading", "meaning"],
}

_GRAMMAR_DETAIL = {
    "type": "object",
    "properties": {
        "pattern": {"type": "string"},
        "meaning": {"type": "string"},
        "connection": {"type": "string"},
        "example": {"type": "string"},
    },
    "required": ["pattern", "meaning"],
}

_RELATION_GUIDE = (
    "relation_type 枚举（只能用这6种）：\n"
    "  synonym=同义  formal_casual=语体差异  derivative=派生形式\n"
    "  contrast=对比/反义  nuance=细微语义差别  confusable=易混淆（汉字音近/形近）"
)

_ATOM_RULES = """\
atoms/relations 规则（所有题型共用）：
- atom.type 只能是 "vocabulary"（词汇，基本形）或 "grammar"（语法，key 以〜开头）
- 只提取核心被考查项 + 最相似干扰项，最多4个；普通词不入
- 若词/语法在日语中不存在，不入 atoms
- relations 只在已提取的 atoms 之间建立（from_key/to_key 必须在 atoms 列表中）
- part_of_speech 必填：vocabulary 类型填日语词性（名詞/動詞/形容詞/副詞 等），grammar 类型填 "-"
- atom 字段填写要求（尽量完整，能填的都填）：
  · vocabulary 类型：key=基本形、reading=假名读音、meaning=中文含义（精炼）、part_of_speech=词性（必填）、jlpt_level=JLPT级别（若已知）、register=语体（书面/口语/正式/随意，有明显倾向时填）、usage=使用条件（可选）、nuance=语感特点（可选）、example=日语例句（可选）
  · grammar 类型：key=以〜开头的形式、meaning=中文含义、part_of_speech="-"、connection=接续方式、jlpt_level=JLPT级别（若已知）、register=语体（若有明显倾向）、usage=使用条件（可选）、nuance=语感特点（可选）、example=日语例句（可选）
- """ + _RELATION_GUIDE

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
        "summary": {"type": "string"},
        "correct_order": {"type": "string"},
        "star_answer": {"type": "string"},
        "order_logic": {"type": "string"},
        "stem_notes": {"type": "array", "items": _STEM_NOTE_ITEM},
        "options_analysis": {"type": "array", "items": {
            "type": "object",
            "properties": {
                "option": {"type": "string"},
                "role": {"type": "string"},
                "explanation": {"type": "string"},
            },
            "required": ["option", "role", "explanation"],
        }},
        "atoms": {"type": "array", "items": _ATOM_ITEM},
        "relations": {"type": "array", "items": _RELATION_ITEM},
    },
    "required": ["analysis_type", "summary", "correct_order", "star_answer",
                 "order_logic", "options_analysis", "atoms", "relations"],
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
你是日语语法专家。分析JLPT整序题，说明各词组的排列逻辑及★位置。

题目（含★位置标记）：{stem}
词组：
{options}
正确答案（★处词组编号）：{correct}

{atom_rules}

要求：
- analysis_type = "sentence_order"
- summary：解题关键——哪个语法/接续关系决定了词序
- correct_order：完整正确句子
- star_answer：★位置的词组内容
- order_logic：逐步说明各词组间的接续关系及排列理由
- stem_notes：题干基础句中值得注意的词/语法（≤2个）
- options_analysis 每项：option（词组内容）、role（语法角色）、explanation（为何在此位置）
- atoms：决定词序的关键语法形式（≤2个，type="grammar"）
- relations：语法接续关系

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
}


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
async def start_attempt(paper_id: UUID, db: AsyncSession = Depends(get_db)):
    if not await db.get(ExamPaper, paper_id):
        raise HTTPException(status_code=404, detail="Exam paper not found")
    attempt = ExamAttempt(paper_id=paper_id)
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
    attempt_id: UUID, section_id: UUID, db: AsyncSession = Depends(get_db),
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

    schema = _SCHEMAS.get(problem.type)
    prompt_tpl = _PROMPTS.get(problem.type)
    if schema is None or prompt_tpl is None:
        return QuestionAnalysisResponse(
            item_id=item_id, session_data=None, relations_suggested=[], cached=False,
        )

    opts_text = "\n".join(f"{k}. {v}" for k, v in sorted(item.options.items()))
    correct = item.correct_answer or "不明"
    target = (item.meta or {}).get("target", item.stem or "")

    _LANG = "重要：所有 explanation、summary、meaning、connection、usage、example 等文字字段必须使用中文输出。\n\n"
    prompt = _LANG + prompt_tpl.format(
        stem=item.stem or "",
        passage=problem.passage or "",
        options=opts_text,
        correct=correct,
        target=target,
        atom_rules=_ATOM_RULES,
        schema_json=json.dumps(schema, ensure_ascii=False),
    )

    llm = get_llm_client()
    try:
        raw = await llm.analyze(prompt, schema)
        result_data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception as e:
        logger.error("LLM analysis failed for item %s: %s", item_id, e)
        raise HTTPException(status_code=502, detail="AI analysis failed")

    if cached:
        cached.session_data = result_data
        cached.relations_suggested = []
    else:
        db.add(QuestionAnalysis(
            item_id=item_id,
            session_data=result_data,
            relations_suggested=[],
        ))
    await db.commit()

    return QuestionAnalysisResponse(
        item_id=item_id, session_data=result_data,
        relations_suggested=[], cached=False,
    )


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
            section_names=sec_map.get(r.id, []),
        )
        for r in rows
    ]


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
                    options=i.options, meta=i.meta,
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
