"""Every sitting the test has held, so the bank can show what it lacks.

A bank that lists only what it holds cannot be read for what is missing —
and what is missing is the thing worth knowing when the material has to be
found and uploaded one sitting at a time.

The list needs no data source. JLPT has run twice a year, in July and in
December, since the 2010 revision, and the one exception is a matter of
public record: July 2020 was called off worldwide.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

#: The format ran from here. Before it the test had four levels, numbered the
#: other way, and nothing about a 1級 paper maps onto N1.
FIRST_YEAR = 2010

#: The months it sits in.
MONTHS = (7, 12)

#: Held nowhere. Not missing material — there is no paper to find.
CANCELLED = {(2020, 7): "因疫情全球中止"}


@dataclass
class Sitting:
    year: int
    month: int
    cancelled: str | None = None

    @property
    def label(self) -> str:
        """As the papers name themselves: 2013年07月."""
        return f"{self.year}年{self.month:02d}月"


def sittings(today: date | None = None) -> list[Sitting]:
    """Every sitting that has happened, oldest first."""
    today = today or date.today()
    out: list[Sitting] = []
    for year in range(FIRST_YEAR, today.year + 1):
        for month in MONTHS:
            if (year, month) > (today.year, today.month):
                continue
            out.append(Sitting(year, month, CANCELLED.get((year, month))))
    return out
