#!/usr/bin/env python3
"""cards.json の各カードに発音 mp3 を作る（edge-tts）。既にあるファイルはスキップ。
使い方: python3 tools/gen-audio.py [--force]
声: en-US-AnaNeural（子どもっぽい声）/ ja-JP-NanamiNeural / zh-TW-HsiaoChenNeural（Shortと同じ）
"""
import json, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOICES = {"en": "en-US-AnaNeural", "ja": "ja-JP-NanamiNeural", "zh": "zh-TW-HsiaoChenNeural"}
RATE = {"en": "-10%", "ja": "-5%", "zh": "-10%"}
force = "--force" in sys.argv
data = json.loads((ROOT / "cards.json").read_text(encoding="utf-8"))
changed = False
for c in data["cards"]:
    audio = c.setdefault("audio", {})
    for lang, voice in VOICES.items():
        text = c.get(lang)
        if not text:
            continue
        rel = audio.get(lang) or f"media/audio/{c['id']}.{lang}.mp3"
        out = ROOT / rel
        if out.exists() and not force:
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["edge-tts", "--voice", voice, f"--rate={RATE[lang]}", "--text", text, "--write-media", str(out)], check=True)
        if audio.get(lang) != rel:
            audio[lang] = rel; changed = True
        print("wrote", rel)
if changed:
    (ROOT / "cards.json").write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
