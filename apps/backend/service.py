from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Generator, Optional

from pydantic import ValidationError

from schemas import BatchAnalysis, SentenceAnalysis
from segmenter import split_sentences, make_overlapped_chunks
from prompt import build_prompt
from llm.base import LLMClient


@dataclass
class AnalyzerResult:
    sentences: List[str]
    analyses: List[SentenceAnalysis]
    extracted_text: str = ""  # 从图片提取的文本


@dataclass
class StreamEvent:
    """流式输出事件"""
    event_type: str  # "init" | "sentence" | "complete" | "error"
    data: dict


class JapaneseArticleAnalyzer:
    def __init__(
        self,
        llm: LLMClient,
        chunk_size: int = 6,
        overlap: int = 2,
        target_level: str = "N2",
        max_retries: int = 2,
    ):
        self.llm = llm
        self.chunk_size = chunk_size
        self.overlap = overlap
        self.target_level = target_level
        self.max_retries = max_retries

    def analyze(self, text: str, image_base64: str = None) -> AnalyzerResult:
        # 如果有图片但没有文本，先从图片中提取文本
        extracted_from_image = False
        extracted_text = ""
        if image_base64 and not text.strip():
            print("Extracting text from image...")
            text = self.llm.extract_text_from_image(image_base64)
            print(f"Extracted text: {text}")
            extracted_from_image = True
            extracted_text = text
        
        sentences = split_sentences(text)
        print(f"Total sentences: {len(sentences)}")
        if not sentences:
            return AnalyzerResult(sentences=[], analyses=[], extracted_text=extracted_text)

        chunks = make_overlapped_chunks(sentences, self.chunk_size, self.overlap)

        print(f"Total chunks: {len(chunks)}")
        # 用全局 index 合并（重叠 chunk 会产生重复 index）
        merged: Dict[int, SentenceAnalysis] = {}

        for ch in chunks:
            prompt = build_prompt(ch.items, target_level=self.target_level)
            print(f"Analyzing chunk {ch.chunk_id} with {len(ch.items)} sentences...")

            last_err: Exception | None = None
            for _ in range(self.max_retries + 1):
                try:
                    # 如果文本是从图片提取的，就不需要再传图片了
                    batch = self.llm.generate_structured(
                        prompt, 
                        BatchAnalysis, 
                        image_base64=None if extracted_from_image else image_base64
                    )
                    for item in batch.sentences:
                        # 优先保留“更完整”的那条：简单策略（字段更多者胜）
                        prev = merged.get(item.index)
                        if prev is None:
                            merged[item.index] = item
                        else:
                            prev_score = len(prev.vocab) + len(prev.grammar)
                            new_score = len(item.vocab) + len(item.grammar)
                            if new_score > prev_score:
                                merged[item.index] = item
                    last_err = None
                    break
                except (ValidationError, ValueError) as e:
                    last_err = e
                    # 这里可以做更强的“带错误原因重试”提示词增强
                    # 但最小版本先简单重试
                    continue

            if last_err is not None:
                raise RuntimeError(f"Chunk {ch.chunk_id} failed: {last_err}") from last_err

        # 按 index 排序输出
        analyses = [merged[i] for i in sorted(merged.keys())]
        print(f"Total analyzed sentences: {len(analyses)}")
        return AnalyzerResult(sentences=sentences, analyses=analyses, extracted_text=extracted_text)

    def analyze_stream(
        self, text: str, image_base64: str = None
    ) -> Generator[StreamEvent, None, None]:
        """
        流式分析：逐句返回分析结果
        通过 Generator 逐个 yield StreamEvent
        """
        # 如果有图片但没有文本，先从图片中提取文本
        extracted_text = ""
        if image_base64 and not text.strip():
            print("Extracting text from image...")
            text = self.llm.extract_text_from_image(image_base64)
            print(f"Extracted text: {text}")
            extracted_text = text

        sentences = split_sentences(text)
        print(f"[Stream] Total sentences: {len(sentences)}")

        if not sentences:
            yield StreamEvent(
                event_type="init",
                data={"total": 0, "sentences": [], "extracted_text": extracted_text}
            )
            yield StreamEvent(event_type="complete", data={"total": 0})
            return

        # 发送初始化事件：句子总数和列表
        yield StreamEvent(
            event_type="init",
            data={
                "total": len(sentences),
                "sentences": sentences,
                "extracted_text": extracted_text
            }
        )

        chunks = make_overlapped_chunks(sentences, self.chunk_size, self.overlap)
        print(f"[Stream] Total chunks: {len(chunks)}")

        # 用于去重和跟踪已发送的句子
        sent_indices: set = set()
        merged: Dict[int, SentenceAnalysis] = {}

        for ch in chunks:
            prompt = build_prompt(ch.items, target_level=self.target_level)
            print(f"[Stream] Analyzing chunk {ch.chunk_id} with {len(ch.items)} sentences...")

            last_err: Optional[Exception] = None
            batch: Optional[BatchAnalysis] = None

            for _ in range(self.max_retries + 1):
                try:
                    batch = self.llm.generate_structured(
                        prompt,
                        BatchAnalysis,
                        image_base64=None  # 流式模式下不传图片
                    )
                    last_err = None
                    break
                except (ValidationError, ValueError) as e:
                    last_err = e
                    continue

            if last_err is not None:
                yield StreamEvent(
                    event_type="error",
                    data={"chunk_id": ch.chunk_id, "error": str(last_err)}
                )
                continue

            if batch:
                for item in batch.sentences:
                    # 去重逻辑：如果已发送过该句子，检查是否需要更新
                    prev = merged.get(item.index)
                    if prev is None:
                        merged[item.index] = item
                    else:
                        prev_score = len(prev.vocab) + len(prev.grammar)
                        new_score = len(item.vocab) + len(item.grammar)
                        if new_score > prev_score:
                            merged[item.index] = item

                # 发送本 chunk 中尚未发送过的句子
                for item in batch.sentences:
                    if item.index not in sent_indices:
                        sent_indices.add(item.index)
                        # 使用 merged 中的版本（可能是更完整的）
                        final_item = merged[item.index]
                        yield StreamEvent(
                            event_type="sentence",
                            data={"analysis": final_item.model_dump()}
                        )

        # 发送完成事件
        yield StreamEvent(
            event_type="complete",
            data={"total": len(sent_indices)}
        )