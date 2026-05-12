import logging
import xml.etree.ElementTree as ET
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)


class DictionaryService:
    def __init__(self):
        self._index: dict[str, list[dict]] = {}  # key -> list of entries
        self._loaded = False

    def _ensure_loaded(self) -> None:
        if not self._loaded:
            self._load()

    def _load(self) -> None:
        """Parse JMdict XML and build an in-memory index keyed by kanji and kana forms."""
        path = Path(get_settings().JMDICT_PATH)
        if not path.exists():
            logger.warning("JMdict file not found at %s; dictionary lookups will return None", path)
            self._loaded = True
            return

        logger.info("Loading JMdict from %s …", path)
        try:
            tree = ET.parse(str(path))
            root = tree.getroot()
            for entry in root.findall("entry"):
                parsed = self._parse_entry(entry)
                if parsed is None:
                    continue
                # Index by all kanji and kana forms
                for form in parsed.get("kanji_forms", []):
                    self._index.setdefault(form, []).append(parsed)
                for form in parsed.get("readings", []):
                    self._index.setdefault(form, []).append(parsed)
            logger.info("JMdict loaded: %d index entries", len(self._index))
        except Exception as e:
            logger.error("Failed to load JMdict: %s", e)
        finally:
            self._loaded = True

    @staticmethod
    def _parse_entry(entry: ET.Element) -> dict | None:
        """Parse a single JMdict <entry> element into a dict."""
        ent_seq_el = entry.find("ent_seq")
        ent_seq = ent_seq_el.text if ent_seq_el is not None else None

        # Kanji forms (k_ele)
        kanji_forms: list[str] = []
        for k_ele in entry.findall("k_ele"):
            keb = k_ele.find("keb")
            if keb is not None and keb.text:
                kanji_forms.append(keb.text)

        # Reading forms (r_ele)
        readings: list[str] = []
        for r_ele in entry.findall("r_ele"):
            reb = r_ele.find("reb")
            if reb is not None and reb.text:
                readings.append(reb.text)

        if not kanji_forms and not readings:
            return None

        # Senses — prefer Chinese (zhs), fallback to English
        _XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
        senses: list[dict] = []
        for sense in entry.findall("sense"):
            pos_list  = [pos.text for pos in sense.findall("pos") if pos.text]
            misc_list = [m.text  for m   in sense.findall("misc") if m.text]

            zh_glosses  = [g.text for g in sense.findall("gloss") if g.get(_XML_LANG) == "zhs" and g.text]
            eng_glosses = [g.text for g in sense.findall("gloss") if g.get(_XML_LANG, "eng") == "eng" and g.text]
            gloss_list  = zh_glosses if zh_glosses else eng_glosses

            if gloss_list:
                senses.append({
                    "pos":  pos_list,
                    "gloss": gloss_list,
                    "misc": misc_list,
                    "lang": "zhs" if zh_glosses else "eng",
                })

        # JLPT level — not natively in JMdict_e.xml but check for custom tag
        jlpt_level: str | None = None

        return {
            "ent_seq": ent_seq,
            "kanji_forms": kanji_forms,
            "readings": readings,
            "senses": senses,
            "jlpt_level": jlpt_level,
        }

    def lookup(self, word: str) -> dict | None:
        """Return the first matching JMdict entry for a kanji or kana form, or None."""
        self._ensure_loaded()
        entries = self._index.get(word)
        if not entries:
            return None
        return entries[0]

    def lookup_all(self, word: str) -> list[dict]:
        """Return all matching JMdict entries for a word."""
        self._ensure_loaded()
        return self._index.get(word, [])


dictionary_service = DictionaryService()
