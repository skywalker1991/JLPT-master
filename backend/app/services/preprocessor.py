import re
from janome.tokenizer import Tokenizer
from app.schemas.analysis import TokenInfo, PreprocessedSentence, PreprocessResponse

# Katakana to Hiragana conversion
_KATA_START = ord("ァ")
_KATA_END = ord("ン")
_HIRA_START = ord("ぁ")


def _kata_to_hira(text: str) -> str:
    """Convert katakana characters to hiragana."""
    result = []
    for ch in text:
        code = ord(ch)
        if _KATA_START <= code <= _KATA_END:
            result.append(chr(code - _KATA_START + _HIRA_START))
        else:
            result.append(ch)
    return "".join(result)


class Preprocessor:
    def __init__(self):
        self._tokenizer = None

    @property
    def tokenizer(self):
        if self._tokenizer is None:
            self._tokenizer = Tokenizer()
        return self._tokenizer

    def split_sentences(self, text: str) -> list[str]:
        """Split by sentence-ending punctuation and newlines, keep non-empty."""
        # Split on 。！？ keeping the delimiter attached, then on newlines
        parts = re.split(r"(?<=[。！？])", text)
        sentences = []
        for part in parts:
            # Further split on newlines
            for line in part.split("\n"):
                stripped = line.strip()
                if stripped:
                    sentences.append(stripped)
        return sentences

    def tokenize(self, sentence: str) -> list[TokenInfo]:
        """Tokenize a Japanese sentence with Janome, returning TokenInfo list."""
        tokens = []
        for token in self.tokenizer.tokenize(sentence):
            surface = token.surface
            base = token.base_form if token.base_form and token.base_form != "*" else surface
            pos_parts = token.part_of_speech.split(",")
            pos = pos_parts[0] if pos_parts else "unknown"
            reading_raw = token.reading if token.reading and token.reading != "*" else surface
            reading = _kata_to_hira(reading_raw)
            tokens.append(TokenInfo(surface=surface, base=base, pos=pos, reading=reading))
        return tokens

    def preprocess(self, text: str) -> PreprocessResponse:
        """Full preprocessing pipeline: split and tokenize."""
        sentences = self.split_sentences(text)
        result = [
            PreprocessedSentence(index=i, text=s, tokens=self.tokenize(s))
            for i, s in enumerate(sentences)
        ]
        return PreprocessResponse(sentences=result)


preprocessor = Preprocessor()  # singleton
