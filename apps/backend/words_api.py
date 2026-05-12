from fastapi import FastAPI
from pydantic import BaseModel
from janome.tokenizer import Tokenizer
import re

app = FastAPI()
tokenizer = Tokenizer()

class SegmentReq(BaseModel):
    text: str

def split_sentences(text: str) -> list[str]:
    # 朴素分句：按 。！？ 及其英文对应符号切分，并保留句末标点
    text = text.strip()
    if not text:
        return []
    parts = re.split(r'([。！？!?])', text)
    sentences = []
    buf = ""
    for p in parts:
        if p in ["。", "！", "？", "!", "?"]:
            buf += p
            if buf.strip():
                sentences.append(buf.strip())
            buf = ""
        else:
            buf += p
    if buf.strip():
        sentences.append(buf.strip())
    return sentences

@app.post("/segment")
def segment(req: SegmentReq):
    sentences = split_sentences(req.text)
    out = []
    for i, s in enumerate(sentences):
        tokens = []
        for t in tokenizer.tokenize(s):
            # janome 的 part_of_speech 形如 "名詞,一般,*,*..."
            pos_major = t.part_of_speech.split(",")[0]
            tokens.append({
                "surface": t.surface,
                "pos": pos_major,
                # 预留：以后你想做字典形、读音、base_form
                "base": t.base_form,
                "reading": t.reading if hasattr(t, "reading") else None,
            })
        out.append({"id": i, "text": s, "tokens": tokens})
    return {"sentences": out}