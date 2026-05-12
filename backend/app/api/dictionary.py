from fastapi import APIRouter, HTTPException
from app.services.dictionary import dictionary_service

router = APIRouter(tags=["dictionary"])


@router.get("/dictionary/{word}")
async def lookup_word(word: str):
    """Look up a word in JMdict. Returns entry dict or 404."""
    entry = dictionary_service.lookup(word)
    if entry is None:
        raise HTTPException(status_code=404, detail=f"Word '{word}' not found in dictionary")
    return entry
