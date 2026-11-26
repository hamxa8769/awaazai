"""AwaazAI translation for dubbing — offline argos-translate, honest gaps.

Design (never fake a translation):
- Same source and target language -> passthrough, no translation needed.
- Otherwise translation needs argos-translate AND the matching language
  pair installed (`argos-translate-cli` downloads pairs as ~100-200 MB
  packages each). If either is missing, translate() raises
  TranslationUnavailable and the caller returns HTTP 501 WITH the
  transcript still included — the user keeps what STT actually heard,
  and the error says exactly which pair is missing and how to install it.
- argos-translate is intentionally NOT in requirements.txt yet: its
  pairs are large downloads and no pair has been verified on this VM.
  So in v0.4.0 the only dubbing pair that actually works end-to-end is
  same-language (e.g. English -> English, re-voiced in another voice),
  plus any pair the operator installs later. That is stated in the
  README/CHANGELOG, not hidden.
"""
from __future__ import annotations


class TranslationUnavailable(RuntimeError):
    """Translation for this language pair is not installed."""


def _argos_available() -> bool:
    try:
        import argos_translate  # noqa: F401
        return True
    except ImportError:
        return False


def available_pairs() -> list[dict]:
    """Installed argos-translate pairs, or [] when argos is not installed."""
    if not _argos_available():
        return []
    try:
        from argos_translate import package as pkg
        return [
            {"from": p.from_code, "to": p.to_code}
            for p in pkg.get_installed_packages()
        ]
    except Exception:
        return []


def translate(text: str, source_lang: str, target_lang: str) -> tuple[str, str]:
    """Translate `text` from source_lang to target_lang.

    Returns (translated_text, method) where method is "none"
    (same language), or "argos-translate". Raises
    TranslationUnavailable when the pair cannot be translated here.
    """
    source_lang = (source_lang or "").strip().lower()
    target_lang = (target_lang or "").strip().lower()
    text = (text or "").strip()
    if not text:
        return "", "none"
    if source_lang == target_lang:
        return text, "none"
    if not _argos_available():
        raise TranslationUnavailable(
            f"Translation {source_lang} -> {target_lang} is not installed yet: "
            "argos-translate is not installed on this server. Install it and "
            f"download the {source_lang}->{target_lang} language pair "
            "(see backend/translate.py), then try again. The transcript "
            "below is what was actually heard — it was NOT translated."
        )
    pairs = available_pairs()
    if not any(p["from"] == source_lang and p["to"] == target_lang for p in pairs):
        raise TranslationUnavailable(
            f"Translation {source_lang} -> {target_lang} is not installed yet: "
            f"the {source_lang}->{target_lang} argos-translate pair is not "
            "downloaded on this server. Install it with argos-translate-cli, "
            "then try again. The transcript below is what was actually "
            "heard — it was NOT translated."
        )
    from argos_translate import translate as argos_translate

    return argos_translate.translate(text, source_lang, target_lang), "argos-translate"
