import math
from typing import Optional
from datetime import datetime, timedelta, timezone

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


def extract_jlpt_level(tags: list[str]) -> Optional[str]:
    """从标签列表中提取 JLPT 等级（如 'N2'），无则返回 None。"""
    for tag in tags:
        if tag in JLPT_TAGS:
            return tag
    return None


# Leitner box review intervals indexed by target box level
_BOX_INTERVALS: dict = {
    0: timedelta(0),
    1: timedelta(hours=1),
    2: timedelta(days=1),
    3: timedelta(days=3),
    4: timedelta(days=7),
    5: timedelta(days=14),
}


def next_review_after_know(box_level: int) -> tuple:
    """Returns (new_box_level, next_review_at) after a 'know' swipe."""
    new_box = min(5, box_level + 1)
    return new_box, datetime.now(timezone.utc) + _BOX_INTERVALS[new_box]


def next_review_after_unknown(box_level: int) -> tuple:
    """Returns (new_box_level, next_review_at) after an 'unknown' swipe. Always Box 1, 10 min."""
    return 1, datetime.now(timezone.utc) + timedelta(minutes=10)
