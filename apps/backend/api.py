from __future__ import annotations

from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional
import base64
import json

from config import Settings
from llm.gemini_client import GeminiClient
from service import JapaneseArticleAnalyzer
from janome.tokenizer import Tokenizer
import re


class AnalyzeRequest(BaseModel):
    text: str
    image_base64: Optional[str] = None


class SegmentReq(BaseModel):
    text: str


app = FastAPI()

# 配置 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],  # 允许前端开发服务器
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有方法（GET, POST, OPTIONS 等）
    allow_headers=["*"],  # 允许所有请求头
)

# 初始化配置与分析器（导入时会加载 .env）
settings = Settings.from_env()
llm = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
analyzer = JapaneseArticleAnalyzer(
    llm=llm,
    chunk_size=settings.chunk_size,
    overlap=settings.overlap,
    target_level=settings.target_level,
)


@app.post("/analyze")
def analyze(req: AnalyzeRequest):
    try:
        result = analyzer.analyze(req.text, image_base64=req.image_base64)
    except Exception as e:
        import traceback
        error_details = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc()
        }
        print(f"❌ 分析失败: {error_details}")
        raise HTTPException(status_code=500, detail=str(e))

    return {
        "sentences": result.sentences,
        "analyses": [s.model_dump() for s in result.analyses],
        "extracted_text": result.extracted_text
    }


def generate_sse_events(req: AnalyzeRequest):
    """生成 SSE 事件流"""
    try:
        for event in analyzer.analyze_stream(req.text, image_base64=req.image_base64):
            # SSE 格式: event: <type>\ndata: <json>\n\n
            yield f"event: {event.event_type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"
    except Exception as e:
        import traceback
        error_data = {
            "error": str(e),
            "type": type(e).__name__,
            "traceback": traceback.format_exc()
        }
        print(f"❌ 流式分析失败: {error_data}")
        yield f"event: error\ndata: {json.dumps(error_data, ensure_ascii=False)}\n\n"


@app.post("/analyze-stream")
def analyze_stream(req: AnalyzeRequest):
    """
    流式分析端点 - 使用 Server-Sent Events (SSE) 逐句推送分析结果

    事件类型:
    - init: 初始化，包含句子总数和列表
    - sentence: 单个句子的分析结果
    - complete: 分析完成
    - error: 分析出错
    """
    return StreamingResponse(
        generate_sse_events(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # 禁用 nginx 缓冲
        }
    )


# --- segment endpoint from words_api.py merged here ---
tokenizer = Tokenizer()


def split_sentences_simple(text: str) -> list[str]:
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
    sentences = split_sentences_simple(req.text)
    out = []
    for i, s in enumerate(sentences):
        tokens = []
        for t in tokenizer.tokenize(s):
            pos_major = t.part_of_speech.split(",")[0]
            tokens.append({
                "surface": t.surface,
                "pos": pos_major,
                "base": t.base_form,
                "reading": t.reading if hasattr(t, "reading") else None,
            })
        out.append({"id": i, "text": s, "tokens": tokens})
    return {"sentences": out}
