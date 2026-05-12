import warnings
warnings.filterwarnings("ignore", message=".*shadows an attribute.*", category=UserWarning)

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# AI Output schemas
# ---------------------------------------------------------------------------

class VocabItem(BaseModel):
    surface: str
    base: str
    reading: str | None = None
    meaning: str
    part_of_speech: str | None = None
    jlpt_level: str | None = None
    register: str | None = None
    usage: str | None = None
    nuance: str | None = None
    example: str | None = None


class GrammarItem(BaseModel):
    pattern: str
    meaning: str
    connection: str | None = None
    jlpt_level: str | None = None
    register: str | None = None
    usage: str | None = None
    nuance: str | None = None
    example: str | None = None


class SentenceAnalysis(BaseModel):
    index: int
    text: str
    translation: str
    vocab: list[VocabItem] = []
    grammar: list[GrammarItem] = []


class FreeTextResult(BaseModel):
    sentences: list[SentenceAnalysis]


# ---------------------------------------------------------------------------
# JLPT schemas
# ---------------------------------------------------------------------------

class OptionAnalysis(BaseModel):
    option: str
    is_correct: bool
    explanation: str
    grammar: GrammarItem


class GrammarQuizResult(BaseModel):
    question: str
    correct_answer: str
    completed_sentence: SentenceAnalysis
    options_analysis: list[OptionAnalysis]


class OrderingQuizResult(BaseModel):
    question: str
    correct_order: list[str]
    explanation: str
    completed_sentence: SentenceAnalysis


class ReadingQuestion(BaseModel):
    question: str
    correct_answer: str
    options_analysis: list[OptionAnalysis]


class ReadingResult(BaseModel):
    sentences: list[SentenceAnalysis]
    questions: list[ReadingQuestion]


class OralFeature(BaseModel):
    expression: str
    standard_form: str
    explanation: str


class ListeningResult(BaseModel):
    sentences: list[SentenceAnalysis]
    oral_features: list[OralFeature]


# ---------------------------------------------------------------------------
# Followup schemas
# ---------------------------------------------------------------------------

class ComparisonResult(BaseModel):
    atom_a: str
    atom_b: str
    similarity: str
    difference: str
    example_a: str
    example_b: str
    relation_type: str  # synonym|formal_casual|derivative|contrast|nuance


class UsageResult(BaseModel):
    atom_key: str
    usage: str
    register: str | None = None


class DerivativeItem(BaseModel):
    form: str
    register: str
    explanation: str


class DerivativeResult(BaseModel):
    atom_key: str
    derivatives: list[DerivativeItem]


class ExampleResult(BaseModel):
    atom_key: str
    examples: list[str]


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    text: str | None = None
    image: str | None = None  # base64
    type: str = "text"  # text|image|jlpt_grammar|jlpt_reading|jlpt_ordering|jlpt_listening


class PreprocessRequest(BaseModel):
    text: str


class FollowupRequest(BaseModel):
    template: str  # comparison|usage|derivative|example|free
    params: dict


class TokenInfo(BaseModel):
    surface: str
    base: str
    pos: str
    reading: str


class PreprocessedSentence(BaseModel):
    index: int
    text: str
    tokens: list[TokenInfo]


class PreprocessResponse(BaseModel):
    sentences: list[PreprocessedSentence]
