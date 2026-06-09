"""Stream audio acquisition: streamlink resolves the live HLS, ffmpeg decodes it
to 16 kHz mono PCM. We only ever pull the audio-only / lowest rendition, so this
stays light on bandwidth and CPU."""
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import threading
from typing import Iterator, Optional

SAMPLE_RATE = 16000
FRAME_MS = 20
# bytes per 20ms frame of 16-bit mono PCM
FRAME_BYTES = SAMPLE_RATE * FRAME_MS // 1000 * 2


def _which(name: str) -> str:
    path = shutil.which(name)
    if not path:
        raise RuntimeError(f"`{name}` not found on PATH — install it (brew/apt) before transcribing")
    return path


class AudioSource:
    """Yields fixed 20ms PCM frames from a live stream URL until stopped.

    streamlink (audio_only,worst) → stdout → ffmpeg → s16le 16k mono → stdout.
    """

    def __init__(self, url: str, stop: threading.Event):
        self.url = url
        self.stop = stop
        self._sl: Optional[subprocess.Popen] = None
        self._ff: Optional[subprocess.Popen] = None

    def _spawn(self) -> None:
        streamlink = _which("streamlink")
        ffmpeg = _which("ffmpeg")
        # start_new_session=True puts each child in its own process group so we can
        # kill the WHOLE tree (streamlink spawns its own children) on teardown.
        # prefer an audio-only rendition (Twitch), fall back to the worst video rendition
        self._sl = subprocess.Popen(
            [streamlink, "--stdout", "--quiet", "--retry-streams", "5", "--retry-max", "8", self.url, "audio_only,worst,480p,360p"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        try:
            self._ff = subprocess.Popen(
                [
                    ffmpeg, "-hide_banner", "-loglevel", "error",
                    "-i", "pipe:0",
                    "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1",
                ],
                stdin=self._sl.stdout,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
        except Exception:
            self.close()  # ffmpeg failed to start — don't leave streamlink running
            raise
        finally:
            # parent closes its copy so ffmpeg gets EOF when streamlink exits
            if self._sl.stdout:
                self._sl.stdout.close()

    def frames(self) -> Iterator[bytes]:
        self._spawn()
        assert self._ff and self._ff.stdout
        buf = b""
        while not self.stop.is_set():
            chunk = self._ff.stdout.read(FRAME_BYTES)
            if not chunk:
                break  # stream ended / process died
            buf += chunk
            while len(buf) >= FRAME_BYTES:
                yield buf[:FRAME_BYTES]
                buf = buf[FRAME_BYTES:]

    def close(self) -> None:
        for p in (self._ff, self._sl):
            if p is None:
                continue
            try:
                if p.poll() is None:
                    # kill the whole process group (streamlink + its grandchildren)
                    os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                try:
                    p.kill()
                except Exception:
                    pass
            try:
                p.wait(timeout=5)  # reap so we don't leave zombies
            except Exception:
                pass
