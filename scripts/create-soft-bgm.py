#!/usr/bin/env python3
"""Create the original, gently looping oekaki melodies as PCM for MP3 encoding.

Usage: python scripts/create-soft-bgm.py /tmp/room.wav /tmp/play.wav
No third-party samples are used.  Encode with ffmpeg using -af volume=10dB -b:a 96k.
"""
import array
import math
import sys
import wave

RATE = 24000
BEAT = 0.75
DURATION = BEAT * 32
SIZE = round(DURATION * RATE)
CHORDS = [(48, 52, 55, 59), (43, 47, 50, 55), (45, 48, 52, 55), (41, 45, 48, 52)]
ROOM = [72, 76, 79, 76, 74, 71, 67, 71, 72, 76, 79, 81, 77, 76, 72, 69,
        72, 76, 79, 83, 79, 76, 74, 71, 72, 76, 81, 79, 77, 76, 74, 72]
PLAY = [76, 79, 72, 79, 74, 79, 71, 79, 76, 81, 72, 81, 77, 81, 72, 81,
        79, 76, 72, 76, 79, 74, 71, 74, 81, 76, 72, 76, 77, 72, 69, 72]

def generate(path, melody):
    audio = array.array('f', [0.0]) * SIZE
    def note(midi, start, length, volume, pad=False):
        freq = 440 * 2 ** ((midi - 69) / 12)
        samples = int(length * RATE)
        for i in range(samples):
            t = i / RATE
            attack = min(1, t / (0.32 if pad else 0.035))
            release = min(1, (length - t) / (0.55 if pad else 0.25))
            decay = 1 if pad else math.exp(-2.7 * t / length)
            phase = 2 * math.pi * freq * t
            wavelet = math.sin(phase) + (0.09 if pad else 0.16) * math.sin(phase * 2) + (0.025 if pad else 0.035) * math.sin(phase * 3)
            idx = (round(start * RATE) + i) % SIZE
            audio[idx] += volume * attack * release * decay * wavelet
    for bar in range(8):
        chord = CHORDS[bar % 4]
        for pitch in chord[:3]:
            note(pitch, bar * 4 * BEAT, 4 * BEAT + .5, .025, True)
        for beat in range(4):
            pitch = melody[bar * 4 + beat]
            note(pitch, (bar * 4 + beat) * BEAT, 1.15, .115)
            note(pitch, (bar * 4 + beat) * BEAT + .18, 1.0, .022)
        note(chord[0] - 12, bar * 4 * BEAT, 2.1, .035, True)
    pcm = array.array('h', (int(max(-1, min(1, sample)) * 30000) for sample in audio))
    if sys.byteorder != 'little':
        pcm.byteswap()
    with wave.open(path, 'wb') as out:
        out.setnchannels(1); out.setsampwidth(2); out.setframerate(RATE); out.writeframes(pcm.tobytes())

generate(sys.argv[1], ROOM)
generate(sys.argv[2], PLAY)
