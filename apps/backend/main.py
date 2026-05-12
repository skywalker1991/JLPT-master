from __future__ import annotations

import json

from config import Settings
from llm.gemini_client import GeminiClient
from service import JapaneseArticleAnalyzer


def main() -> None:
    settings = Settings.from_env()

    llm = GeminiClient(api_key=settings.gemini_api_key, model=settings.gemini_model)
    analyzer = JapaneseArticleAnalyzer(
        llm=llm,
        chunk_size=settings.chunk_size,
        overlap=settings.overlap,
        target_level=settings.target_level,
    )

    text = """
先月28日、北海道小樽市にあるスキー場のエスカレーターで事故がありました。

5歳の男の子が、降りる時に転んで、腕が機械の間に入ってしまいました。男の子は亡くなりました。

このエスカレーターは、駐車場からスキーをするところまで動いています。エスカレーターは、靴などが入ると止まることになっていますが、このときは止まりませんでした。近くに安全かどうか見ている人もいませんでした。

警察は6日、スキー場の会社に関係する場所を調べました。スキー場がどのような安全のチェックをしていたか、よく調べる予定です。
""".strip()

    result = analyzer.analyze(text)

    # 输出最终合并后的结构化 JSON
    payload = {
        "sentences": result.sentences,
        "analyses": [a.model_dump() for a in result.analyses],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()