"""faster-whisper wrapper tuned for top-quality near-real-time transcription of
financial/crypto stream chatter, with hallucination filtering and rolling
context so phrasing carries across utterances."""
from __future__ import annotations

import os

import numpy as np
from faster_whisper import WhisperModel


def _pick_device() -> tuple[str, str]:
    # float16 on CUDA, int8 on CPU — both are the accuracy/speed sweet spot
    try:
        import ctranslate2  # noqa: F401

        if int(os.getenv("FORCE_CPU", "0")) == 0:
            import torch  # type: ignore

            if torch.cuda.is_available():
                return "cuda", "float16"
    except Exception:
        pass
    return "cpu", os.getenv("CPU_COMPUTE", "int8")


class Transcriber:
    def __init__(self) -> None:
        model = os.getenv("WHISPER_MODEL", "large-v3")
        device, compute = _pick_device()
        self.lang = os.getenv("WHISPER_LANG", "en") or None
        self.model = WhisperModel(model, device=device, compute_type=compute)
        self.device = device
        self.model_name = model
        self._context = ""  # rolling prompt for continuity

    def transcribe(self, pcm: bytes) -> tuple[str, float]:
        """Returns (text, confidence 0..1). Empty text when nothing usable."""
        audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        if audio.size < 16000 // 4:  # < 0.25s — skip noise blips
            return "", 0.0
        segments, _ = self.model.transcribe(
            audio,
            language=self.lang,
            beam_size=5,
            vad_filter=False,  # already segmented upstream
            condition_on_previous_text=False,
            initial_prompt=self._context or None,
            temperature=0.0,
        )
        parts: list[str] = []
        logprobs: list[float] = []
        no_speech: list[float] = []
        for s in segments:
            parts.append(s.text)
            logprobs.append(s.avg_logprob)
            no_speech.append(s.no_speech_prob)
        text = " ".join(p.strip() for p in parts).strip()
        if not text or len(text) < 2:
            return "", 0.0
        avg_lp = sum(logprobs) / len(logprobs) if logprobs else -5.0
        avg_ns = sum(no_speech) / len(no_speech) if no_speech else 1.0
        # drop likely hallucinations / non-speech
        if avg_ns > 0.6 or avg_lp < -1.0:
            return "", 0.0
        # keep a short rolling context for the next utterance
        self._context = (self._context + " " + text)[-220:]
        conf = max(0.0, min(1.0, 1.0 + avg_lp))  # avg_logprob ~[-1,0] → ~[0,1]
        return text, round(conf, 2)
