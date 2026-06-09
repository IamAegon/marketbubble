"""Voice-activity segmentation: turns a stream of 20ms PCM frames into complete
spoken utterances bounded by silence. Feeding Whisper whole utterances (rather
than fixed windows) gives clean boundaries and noticeably better accuracy."""
from __future__ import annotations

import collections
from typing import Iterator, Optional

import webrtcvad

from audio import FRAME_BYTES, FRAME_MS, SAMPLE_RATE


class Utterance:
    __slots__ = ("pcm", "start_ms", "end_ms")

    def __init__(self, pcm: bytes, start_ms: int, end_ms: int):
        self.pcm = pcm
        self.start_ms = start_ms
        self.end_ms = end_ms


class Segmenter:
    """Classic webrtcvad collector with hangover. Emits an Utterance when speech
    is followed by `silence_ms` of quiet, or when it hits `max_ms` (safety flush)."""

    def __init__(self, aggressiveness: int = 2, silence_ms: int = 700, max_ms: int = 24000, pad_ms: int = 120):
        self.vad = webrtcvad.Vad(aggressiveness)
        self.silence_frames = silence_ms // FRAME_MS
        self.max_frames = max_ms // FRAME_MS
        self.pad_frames = pad_ms // FRAME_MS
        self.elapsed_ms = 0

    def run(self, frames: Iterator[bytes]) -> Iterator[Utterance]:
        triggered = False
        ring: collections.deque = collections.deque(maxlen=self.pad_frames)
        voiced: list[bytes] = []
        start_ms = 0
        silence_run = 0

        for frame in frames:
            if len(frame) != FRAME_BYTES:
                continue
            is_speech = self.vad.is_speech(frame, SAMPLE_RATE)
            self.elapsed_ms += FRAME_MS

            if not triggered:
                ring.append((frame, is_speech, self.elapsed_ms))
                if sum(1 for _, s, _ in ring if s) > 0.8 * ring.maxlen:
                    triggered = True
                    start_ms = ring[0][2]
                    voiced = [f for f, _, _ in ring]
                    ring.clear()
                    silence_run = 0
            else:
                voiced.append(frame)
                silence_run = silence_run + 1 if not is_speech else 0
                if silence_run >= self.silence_frames or len(voiced) >= self.max_frames:
                    end_ms = self.elapsed_ms
                    yield Utterance(b"".join(voiced), start_ms, end_ms)
                    triggered = False
                    voiced = []
                    ring.clear()

        if triggered and voiced:
            yield Utterance(b"".join(voiced), start_ms, self.elapsed_ms)
