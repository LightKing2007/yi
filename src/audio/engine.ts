/**
 * WebAudio 播放：音效每次新开一个声源（可变速、可声像），背景音乐两段同时循环，按所在界面交叉淡入淡出；
 * 终局音效响起时音乐立刻压低，2 秒后用 3 秒慢慢回来。浏览器要求第一次点击或按键之后才能出声
 */
import { settings } from '../app/settings';
import { screen, Screen } from '../app/state';
import { now } from '../core/clock';
import { setAudioImpl, type SfxId } from './index';
import type { SynthOut } from './synth.worker';
import { logError } from '../app/native';

let ctx: AudioContext | null = null;
const buffers = new Map<string, AudioBuffer>();
let sfxBus: GainNode, musicBus: GainNode;
const music: { gain: GainNode; started: boolean }[] = [];
let duckT = -100;
let pendingRaw: SynthOut[] = [];

function toBuffer(o: SynthOut) {
  const b = ctx!.createBuffer(o.r ? 2 : 1, o.l.length, o.sr);
  b.copyToChannel(o.l as Float32Array<ArrayBuffer>, 0);
  if (o.r) b.copyToChannel(o.r as Float32Array<ArrayBuffer>, 1);
  buffers.set(o.id, b);
  if (o.id.startsWith('music-')) startMusic(o.id === 'music-menu' ? 0 : 1);
}

function ensureCtx() {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  sfxBus = ctx.createGain(); sfxBus.connect(ctx.destination);
  musicBus = ctx.createGain(); musicBus.gain.value = 0; musicBus.connect(ctx.destination);
  for (let i = 0; i < 2; i++) {
    const g = ctx.createGain();
    g.gain.value = i === 0 ? 1 : 0;
    g.connect(musicBus);
    music.push({ gain: g, started: false });
  }
  for (const o of pendingRaw) toBuffer(o);
  pendingRaw = [];
  return ctx;
}

function startMusic(i: number) {
  const b = buffers.get(i === 0 ? 'music-menu' : 'music-game');
  if (!ctx || !b || music[i].started) return;
  const src = ctx.createBufferSource();
  src.buffer = b; src.loop = true;
  src.connect(music[i].gain);
  src.start();
  music[i].started = true;
}

function play(id: SfxId, vol = 1, rate = 1, pan = 0) {
  const s = settings.value;
  if (!ctx || !s.sound || ctx.state !== 'running') return;
  const b = buffers.get(id);
  if (!b) return;
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol * s.volume;
  let node: AudioNode = src;
  node.connect(g); node = g;
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); node = p; }
  node.connect(sfxBus);
  src.start();
}

/** 每帧：选曲（菜单 / 对局）、音量、终局时压低 */
function updateMusic() {
  if (!ctx) return;
  const t = now(), inGame = screen.value === Screen.Game, s = settings.value, at = ctx.currentTime;
  music[0].gain.gain.setTargetAtTime(inGame ? 0 : 1, at, 1.25);
  music[1].gain.gain.setTargetAtTime(inGame ? 1 : 0, at, 1.25);
  const since = t - duckT;
  const duck = 1 - 0.75 * (since < 0 ? 0 : since < 2 ? 1 : Math.max(0, 1 - (since - 2) / 3));
  musicBus.gain.setTargetAtTime(s.music ? s.musicVol * duck * 0.9 : 0, at, since < 0.1 ? 0.03 : 0.25);
}

export function initAudio() {
  const worker = new Worker(new URL('./synth.worker.ts', import.meta.url), { type: 'module' });
  worker.onerror = e => logError('合成声音', e.message);
  worker.onmessage = (e: MessageEvent<SynthOut>) => { if (ctx) toBuffer(e.data); else pendingRaw.push(e.data); };
  worker.postMessage('go');
  // 浏览器的自动播放限制：第一次点击 / 按键时才开声音
  const unlock = () => { ensureCtx().resume(); };
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  setInterval(updateMusic, 100);
  setAudioImpl({
    play,
    clack: (strength: number) => play('clack', strength, 0.94 + 0.12 * Math.random()),
    duck: () => { duckT = now(); updateMusic(); },
  });
}
