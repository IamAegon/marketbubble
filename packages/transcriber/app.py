"""Market Bubble transcription worker.

A small control service the Node server drives. POST /jobs starts transcribing a
live stream: streamlink → ffmpeg → VAD utterances → faster-whisper → each final
segment is POSTed back to the Node callback as a caption. One background thread
per job; the Whisper model is shared and loaded once.

Run:  uvicorn app:app --host 127.0.0.1 --port 8799
Env:  WHISPER_MODEL=large-v3  WHISPER_LANG=en  FORCE_CPU=1  TRANSCRIBE_SECRET=...
"""
from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from typing import Dict, Optional

import requests
from fastapi import FastAPI
from pydantic import BaseModel

from audio import AudioSource
from stt import Transcriber
from vad import Segmenter

SECRET = os.getenv("TRANSCRIBE_SECRET", "")
LAG_MS = int(os.getenv("CAPTION_LAG_MS", "0"))  # subtract HLS buffer delay to align with chat

app = FastAPI(title="MarketBubble Transcriber")
_model: Optional[Transcriber] = None
_model_lock = threading.Lock()


def model() -> Transcriber:
    global _model
    with _model_lock:
        if _model is None:
            _model = Transcriber()
    return _model


@dataclass
class Job:
    channel: str
    url: str
    callback: str
    stop: threading.Event = field(default_factory=threading.Event)
    thread: Optional[threading.Thread] = None
    started: float = field(default_factory=time.time)
    segments: int = 0
    src: Optional[AudioSource] = None


JOBS: Dict[str, Job] = {}
JOBS_LOCK = threading.Lock()


def _run(job: Job) -> None:
    t0 = time.time() * 1000.0  # epoch ms at stream open
    src = AudioSource(job.url, job.stop)
    job.src = src  # so stop_job can kill the subprocesses directly
    seg = Segmenter()
    tr = model()
    try:
        for utt in seg.run(src.frames()):
            if job.stop.is_set():
                break
            text, conf = tr.transcribe(utt.pcm)
            if not text:
                continue
            job.segments += 1
            payload = {
                "channel": job.channel,
                "text": text,
                "conf": conf,
                "start": int(t0 + utt.start_ms - LAG_MS),
                "end": int(t0 + utt.end_ms - LAG_MS),
                "secret": SECRET,
            }
            try:
                requests.post(job.callback, json=payload, timeout=5)
            except Exception:
                pass  # transient — keep transcribing
    finally:
        src.close()
        # pop by identity so we never delete a newer job that reused the channel key
        with JOBS_LOCK:
            if JOBS.get(job.channel) is job:
                JOBS.pop(job.channel, None)


class JobReq(BaseModel):
    channel: str
    url: str
    callback: str


@app.get("/health")
def health():
    m = _model
    with JOBS_LOCK:
        jobs = list(JOBS.values())  # snapshot under lock — avoid "dict changed size"
    return {
        "ok": True,
        "model": m.model_name if m else os.getenv("WHISPER_MODEL", "large-v3"),
        "device": m.device if m else "unloaded",
        "jobs": [{"channel": j.channel, "segments": j.segments, "uptime": int(time.time() - j.started)} for j in jobs],
    }


@app.post("/jobs")
def start_job(req: JobReq):
    with JOBS_LOCK:  # check-then-insert must be atomic or two starts spawn duplicate jobs
        if req.channel in JOBS:
            return {"ok": True, "already": True}
        job = Job(channel=req.channel, url=req.url, callback=req.callback)
        JOBS[req.channel] = job
    job.thread = threading.Thread(target=_run, args=(job,), daemon=True)
    job.thread.start()
    return {"ok": True, "channel": req.channel}


@app.delete("/jobs/{channel:path}")
def stop_job(channel: str):
    # pop immediately so /health reflects the stop at once.
    with JOBS_LOCK:
        job = JOBS.pop(channel, None)
    if not job:
        return {"ok": False, "error": "no such job"}
    job.stop.set()
    # kill the subprocesses now so a thread blocked in a stalled read unblocks
    # immediately rather than waiting for the OS to tear down the pipe.
    if job.src:
        try:
            job.src.close()
        except Exception:
            pass
    return {"ok": True}
