from __future__ import annotations


import re
from dataclasses import dataclass
from typing import Iterable, List, Tuple

# 朴素分句：按 。！？ 及其英文对应符号切分，并保留句末标点
_SENT_END = re.compile(r"(?<=[。！？!?])\s*")


def split_sentences(text: str) -> list[str]:
    text = (text or "").strip()
    if not text:
        return []
    parts = _SENT_END.split(text)
    sents = [p.strip() for p in parts if p and p.strip()]
    return sents


@dataclass(frozen=True)
class Chunk:
    chunk_id: int
    items: List[Tuple[int, str]]  # (sentence_index, sentence_text)


def make_overlapped_chunks(
    sentences: List[str],
    chunk_size: int = 6,
    overlap: int = 1,
) -> List[Chunk]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive.")
    if overlap < 0:
        raise ValueError("overlap must be non-negative.")
    if overlap >= chunk_size:
        raise ValueError("overlap must be less than chunk_size.")

    chunks: List[Chunk] = []
    n = len(sentences)
    start = 0
    chunk_id = 1
    step = chunk_size - overlap

    while start < n:
        end = min(start + chunk_size, n)
        chunk_items = [(i + 1, sentences[i]) for i in range(start, end)]
        chunks.append(Chunk(chunk_id=chunk_id, items=chunk_items))
        chunk_id += 1
        start += step

    return chunks


if __name__ == "__main__":
    # 简单测试
    test_text = """先月28日、北海道小樽市にあるスキー場のエスカレーターで事故がありました。
        5歳の男の子が、降りる時に転んで、腕が機械の間に入ってしまいました。男の子は亡くなりました。
このエスカレーターは、駐車場からスキーをするところまで動いています。エスカレーターは、靴などが入ると止まることになっていますが、このときは止まりませんでした。近くに安全かどうか見ている人もいませんでした。
警察は6日、スキー場の会社に関係する場所を調べました。スキー場がどのような安全のチェックをしていたか、よく調べる予定です。"""
    # sentences = split_sentences(test_text)
    # for i, s in enumerate(sentences):
    #     print(f"Sentence {i+1}: {s}")
    sentences = split_sentences(test_text)
    chunks = make_overlapped_chunks(sentences, chunk_size=6, overlap=2)
    for chunk in chunks:
        print(f"Chunk {chunk.chunk_id}:")
        for idx, sent in chunk.items:
            print(f"  Sentence {idx}: {sent}")

