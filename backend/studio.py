"""AwaazAI Studio — long-form synthesis: split text into chunks at
sentence boundaries, synthesize each with Kokoro, concatenate into one
WAV with chapter markers (chunk start times).

Kokoro's /api/tts limit is 1000 characters per call, so Studio chunks
at ~900 characters max, never splitting mid-sentence unless a single
sentence is longer than the limit (then it splits at word boundaries).
All chunks use the same voice/speed and the same 24 kHz sample rate,
so concatenation is a plain sample join — no resampling, no silence
inserted between chapters.
"""
from __future__ import annotations

import io
import re

import numpy as np
import soundfile as sf

from backend import tts_engine

MAX_CHUNK_CHARS = 900
MAX_TEXT_CHARS = 5000

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?।…])\s+|\n+")


def split_into_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split text into chunks at sentence boundaries (<= max_chars each)."""
    text = (text or "").strip()
    if not text:
        return []
    sentences = [s.strip() for s in _SENTENCE_SPLIT.split(text) if s.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        # A single over-long sentence: hard-split at word boundaries.
        while len(sentence) > max_chars:
            words = sentence.split(" ")
            part, rest = "", sentence
            for w in words:
                if part and len(part) + 1 + len(w) > max_chars:
                    break
                part = f"{part} {w}".strip()
            if not part:  # one word longer than the limit — hard cut
                part, rest = sentence[:max_chars], sentence[max_chars:]
            else:
                rest = sentence[len(part):].strip()
            if current:
                chunks.append(current)
                current = ""
            chunks.append(part)
            sentence = rest
        if not sentence:
            continue
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) <= max_chars:
            current = candidate
        else:
            if current:
                chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks


def synthesize_long(text: str, voice: str = "af_heart",
                    speed: float = 1.0) -> tuple[bytes, int, list[dict]]:
    """Long text -> (wav_bytes, sample_rate, chapters).

    Chapters: [{index, start_seconds, text}] — one per chunk.
    Raises ValueError / RuntimeError from tts_engine on bad input.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("Text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise ValueError(f"Text is too long for Studio (max {MAX_TEXT_CHARS} characters).")
    chunks = split_into_chunks(text)
    if not chunks:
        raise ValueError("Text is empty.")
    parts: list[np.ndarray] = []
    chapters: list[dict] = []
    sample_rate: int | None = None
    offset_seconds = 0.0
    for i, chunk in enumerate(chunks):
        samples, sr = tts_engine.synthesize_samples(chunk, voice, speed)
        if sample_rate is None:
            sample_rate = sr
        chapters.append({
            "index": i + 1,
            "start_seconds": round(offset_seconds, 2),
            "text": chunk[:120],
        })
        parts.append(np.asarray(samples, dtype=np.float32))
        offset_seconds += len(samples) / sr
    audio = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sample_rate or 24000, format="WAV")
    return buf.getvalue(), sample_rate or 24000, chapters
