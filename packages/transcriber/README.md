# Market Bubble — Transcription Worker

Top-quality live speech-to-text for the streams you watch. Pulls a stream's
**audio-only HLS** (via `streamlink`), decodes with `ffmpeg`, segments into
utterances with WebRTC VAD, and transcribes each with **faster-whisper
(`large-v3`)**. Each finalized caption is POSTed back to the Node server, which
ingests it as a `kind:'caption'` message — so transcripts are searchable and
feed the Performance Lab ("what was said when the room reacted").

It's a **separate Python service** on purpose: the entire mature STT stack
(faster-whisper, CTranslate2, VAD, optional diarization) lives in Python.

## Pipeline

```
streamlink (audio_only,worst)  →  ffmpeg (16kHz mono s16le)
   →  WebRTC VAD utterance segmenter  →  faster-whisper large-v3
   →  POST {channel, text, start, end, conf}  →  Node /api/captions
```

## Requirements

- Python 3.10+
- `ffmpeg` and `streamlink` on PATH (`brew install ffmpeg streamlink`)
- GPU strongly recommended for `large-v3` real-time (NVIDIA + CUDA). On CPU, set
  `WHISPER_MODEL=large-v3-turbo` or `medium.en` and `FORCE_CPU=1`.

```bash
cd packages/transcriber
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
export TRANSCRIBE_SECRET="<same value as the Node server>"
# optional: WHISPER_MODEL=large-v3  WHISPER_LANG=en  CAPTION_LAG_MS=4000  FORCE_CPU=1
uvicorn app:app --host 127.0.0.1 --port 8799
```

Then on the Node server set `TRANSCRIBER_URL=http://127.0.0.1:8799` and the same
`TRANSCRIBE_SECRET`. Start/stop transcription per stream from the app
(Live → a stream's ⓣ toggle, or `POST /api/transcribe {connector}`).

## Quality knobs

- `WHISPER_MODEL` — `large-v3` (best), `large-v3-turbo` (fast+good), `medium.en`.
- `CAPTION_LAG_MS` — subtract the HLS buffer delay so caption timestamps line up
  with live chat (try 3000–6000 for Twitch). Important for moment attribution.
- VAD aggressiveness / silence window live in `vad.py`.
- Diarization ("who said it") is a natural next step via `pyannote` / WhisperX.

## Notes

Pulling third-party stream audio is for your own analysis; review each
platform's ToS. Your **own** broadcast (OBS audio tap) is the cleanest source
and avoids this entirely — same `/api/captions` ingest, different audio front-end.
