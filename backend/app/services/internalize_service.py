import math

JLPT_TAGS = {"N1", "N2", "N3", "N4", "N5"}


def priority_score(fail_count: int, review_count: int, days_since: float) -> float:
    """
    优先级分数 approximately [0, 1]，值越高越优先复习。
    - fail_rate: 历史失败率（0~1）
    - days_decay: 距上次复习的时间衰减（14天半衰期）
    从未复习的原子：days_since=999，接近最高优先级。
    """
    fail_rate = fail_count / max(review_count, 1)
    days_decay = 1 - math.exp(-days_since / 14.0)
    return fail_rate * 0.6 + days_decay * 0.4


def extract_jlpt_level(tags: list[str]) -> str | None:
    """从标签列表中提取 JLPT 等级（如 'N2'），无则返回 None。"""
    for tag in tags:
        if tag in JLPT_TAGS:
            return tag
    return None
