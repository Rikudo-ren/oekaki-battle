const sources = {
  turn: '/sounds/click1.wav',
  tick: '/sounds/make10-tick.mp3',
  go: '/sounds/make10-go.mp3',
  hint: '/sounds/notification-attention-soft.wav',
  correct: '/sounds/notification-success-sparkle.wav',
  timeout: '/sounds/notification-failure-pluck.wav',
};
let enabled = true;
try { enabled = localStorage.getItem('oekaki-sound') !== 'off'; } catch {}
let context;
const buffers = new Map();

// Browsers require an actual user gesture before sounds can play. Preload only
// after that gesture, and always treat audio as optional, never game-critical.
export function unlockAudio() {
  if (!enabled) return;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!context) context = new AudioContextClass();
    if (context.state === 'suspended') context.resume().catch(() => {});
    for (const [name, url] of Object.entries(sources)) {
      if (!buffers.has(name)) {
        const loading = fetch(url).then(response => {
          if (!response.ok) throw new Error('Audio unavailable');
          return response.arrayBuffer();
        }).then(data => context.decodeAudioData(data)).catch(() => null);
        buffers.set(name, loading);
      }
    }
  } catch { /* Sound is optional. */ }
}
export function playSound(name) {
  if (!enabled || !context || !buffers.has(name)) return;
  buffers.get(name).then(buffer => {
    if (!enabled || !buffer || context.state !== 'running') return;
    const source = context.createBufferSource(), gain = context.createGain();
    source.buffer = buffer; gain.gain.value = 0.28;
    source.connect(gain); gain.connect(context.destination); source.start();
  }).catch(() => {});
}
export function soundEnabled() { return enabled; }
export function setSoundEnabled(value) {
  enabled = value;
  try { localStorage.setItem('oekaki-sound', enabled ? 'on' : 'off'); } catch {}
  if (enabled) unlockAudio();
}

// A short two-tone whistle signals the end before the answer is revealed.
export function playWhistle() {
  if (!enabled || !context || context.state !== 'running') return;
  try {
    const now=context.currentTime;
    for (const [start,duration] of [[0,0.24],[0.31,0.46]]) {
      const osc=context.createOscillator(),gain=context.createGain(),t=now+start;
      osc.type='sine';osc.frequency.setValueAtTime(1880,t);osc.frequency.linearRampToValueAtTime(1980,t+duration);
      gain.gain.setValueAtTime(0.0001,t);gain.gain.linearRampToValueAtTime(0.12,t+0.025);gain.gain.setValueAtTime(0.12,t+duration-0.04);gain.gain.linearRampToValueAtTime(0.0001,t+duration);
      osc.connect(gain);gain.connect(context.destination);osc.start(t);osc.stop(t+duration);
    }
  } catch { /* Audio must never interrupt play. */ }
}
