#!/usr/bin/env python3
"""Cut dead space from a talking-head video and burn in word-grouped captions.

Usage:
  autoedit.py INPUT [-o OUTPUT] [--aspect 9:16|1:1|16:9|keep]
              [--noise -32dB] [--min-silence 0.45] [--pad 0.12]
              [--no-captions] [--model small] [--words 3] [--language en]

Outputs OUTPUT (default INPUT_edited.mp4), plus OUTPUT.srt and OUTPUT.txt
(transcript) when captions are on. Needs ffmpeg with libass. Captions need
faster-whisper (pip install faster-whisper); without it the cut still runs.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile


def run(cmd, capture=False):
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{res.stderr[-2000:]}")
    return res


def probe(path):
    out = run(["ffprobe", "-v", "error", "-print_format", "json",
               "-show_format", "-show_streams", path]).stdout
    data = json.loads(out)
    video = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    audio = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    return float(data["format"]["duration"]), video, audio


def detect_silences(path, noise, min_silence):
    res = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
         f"silencedetect=noise={noise}:d={min_silence}", "-f", "null", "-"],
        capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", res.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", res.stderr)]
    return list(zip(starts, ends + [None] * (len(starts) - len(ends))))


def keep_segments(duration, silences, pad):
    # speech = the gaps between silences; pad each span, then merge overlaps
    speech, cursor = [], 0.0
    for start, end in silences:
        if start - cursor > 0.05:
            speech.append((cursor, start))
        cursor = duration if end is None else end
    if duration - cursor > 0.05:
        speech.append((cursor, duration))
    merged = []
    for a, b in speech:
        a, b = max(0.0, a - pad), min(duration, b + pad)
        if merged and a <= merged[-1][1]:
            merged[-1] = (merged[-1][0], b)
        else:
            merged.append((a, b))
    return merged


def crop_filter(aspect, video):
    if aspect == "keep" or video is None:
        return None
    w, h = (int(x) for x in aspect.split(":"))
    # centre crop to target ratio, then scale to a standard delivery size
    target = {(9, 16): "1080:1920", (1, 1): "1080:1080", (16, 9): "1920:1080"}.get((w, h))
    crop = (f"crop='if(gt(iw/ih,{w}/{h}),ih*{w}/{h},iw)':"
            f"'if(gt(iw/ih,{w}/{h}),ih,iw*{h}/{w})'")
    return crop + (f",scale={target}" if target else "")


def cut(src, dst, segments, video, audio, aspect):
    expr = "+".join(f"between(t,{a:.3f},{b:.3f})" for a, b in segments)
    vf = [f"select='{expr}'", "setpts=N/FRAME_RATE/TB"]
    extra = crop_filter(aspect, video)
    if extra:
        vf.append(extra)
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src]
    with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as fh:
        script = fh.name
        fh.write(f"[0:v]{','.join(vf)}[v]")
        if audio:
            fh.write(f";[0:a]aselect='{expr}',asetpts=N/SR/TB[a]")
    cmd += ["-filter_complex_script", script, "-map", "[v]"]
    if audio:
        cmd += ["-map", "[a]", "-c:a", "aac", "-b:a", "160k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart", dst]
    try:
        run(cmd)
    finally:
        os.unlink(script)


def transcribe(path, model_name, language):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper not installed; skipping captions "
              "(pip install faster-whisper)", file=sys.stderr)
        return None
    import numpy as np
    # decode with ffmpeg rather than PyAV, which breaks across versions
    pcm = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-i", path,
                          "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    samples = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    model = WhisperModel(model_name, device="auto", compute_type="int8")
    segments, _ = model.transcribe(samples, word_timestamps=True,
                                   language=language, vad_filter=True)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append((w.start, w.end, text))
    return words


def chunk_words(words, per_chunk):
    chunks, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1][2] if i + 1 < len(words) else ""
        # pull a trailing punctuated word in rather than leave it alone on screen
        if len(cur) >= per_chunk and nxt[-1:] in ".?!," and len(cur) == per_chunk:
            continue
        if len(cur) >= per_chunk or (w[2][-1:] in ".?!," and len(cur) > 1):
            chunks.append(cur)
            cur = []
    if cur:
        chunks.append(cur)
    return [(c[0][0], c[-1][1], " ".join(x[2] for x in c)) for c in chunks]


def ts(t, sep):
    h, rem = divmod(max(t, 0), 3600)
    m, s = divmod(rem, 60)
    if sep == ",":
        return f"{int(h):02}:{int(m):02}:{s:06.3f}".replace(".", ",")
    return f"{int(h)}:{int(m):02}:{s:05.2f}"


def write_srt(chunks, path):
    with open(path, "w") as fh:
        for i, (a, b, text) in enumerate(chunks, 1):
            fh.write(f"{i}\n{ts(a, ',')} --> {ts(b, ',')}\n{text}\n\n")


def write_ass(chunks, path, width, height):
    size = round(min(width, height) * 0.075)
    margin = round(height * (0.28 if height > width else 0.12))
    with open(path, "w") as fh:
        fh.write(
            "[Script Info]\nScriptType: v4.00+\n"
            f"PlayResX: {width}\nPlayResY: {height}\n\n"
            "[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, "
            "SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, "
            "StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
            "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
            f"Style: Cap,DejaVu Sans,{size},&H00FFFFFF,&H0000FFFF,&H00000000,"
            f"&H80000000,-1,0,0,0,100,100,0,0,1,{max(2, size // 12)},2,2,60,60,"
            f"{margin},1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, "
            "MarginL, MarginR, MarginV, Effect, Text\n")
        for a, b, text in chunks:
            text = text.upper().replace("{", "(").replace("}", ")")
            fh.write(f"Dialogue: 0,{ts(a, '.')},{ts(b, '.')},Cap,,0,0,0,,{text}\n")


def burn(src, ass, dst):
    esc = ass.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src,
         "-vf", f"ass='{esc}'", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "copy",
         "-movflags", "+faststart", dst])


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("input")
    p.add_argument("-o", "--output")
    p.add_argument("--aspect", default="keep", choices=["keep", "9:16", "1:1", "16:9"])
    p.add_argument("--noise", default="-32dB", help="silence threshold")
    p.add_argument("--min-silence", type=float, default=0.45, help="seconds")
    p.add_argument("--pad", type=float, default=0.12, help="seconds kept around speech")
    p.add_argument("--no-captions", action="store_true")
    p.add_argument("--model", default="small", help="whisper model size")
    p.add_argument("--words", type=int, default=3, help="words per caption")
    p.add_argument("--language", default=None)
    args = p.parse_args()

    src = args.input
    dst = args.output or os.path.splitext(src)[0] + "_edited.mp4"
    duration, video, audio = probe(src)
    if video is None:
        sys.exit("no video stream found")

    if audio:
        silences = detect_silences(src, args.noise, args.min_silence)
        segments = keep_segments(duration, silences, args.pad)
    else:
        segments = [(0.0, duration)]
    if not segments:
        sys.exit("everything was detected as silence; raise --noise (e.g. -40dB)")
    kept = sum(b - a for a, b in segments)

    cut_path = dst if args.no_captions else os.path.splitext(dst)[0] + "_cut.mp4"
    cut(src, cut_path, segments, video, audio, args.aspect)

    report = {"input": src, "output": dst, "original_s": round(duration, 2),
              "edited_s": round(kept, 2), "removed_s": round(duration - kept, 2),
              "cuts": max(0, len(segments) - 1), "captions": False}

    if not args.no_captions and audio:
        words = transcribe(cut_path, args.model, args.language)
        if words:
            base = os.path.splitext(dst)[0]
            chunks = chunk_words(words, args.words)
            write_srt(chunks, base + ".srt")
            with open(base + ".txt", "w") as fh:
                fh.write(" ".join(w[2] for w in words) + "\n")
            _, v2, _ = probe(cut_path)
            ass = base + ".ass"
            write_ass(chunks, ass, int(v2["width"]), int(v2["height"]))
            burn(cut_path, ass, dst)
            os.unlink(ass)
            os.unlink(cut_path)
            report.update(captions=True, srt=base + ".srt", transcript=base + ".txt")
        else:
            os.replace(cut_path, dst)
    elif cut_path != dst:
        os.replace(cut_path, dst)

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
