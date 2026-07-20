import { describeCombatCue, weaponSoundProfile } from './audio_cues.js';

const AUDIO_ENABLED_KEY = 'kagariai_audio_enabled';
const AUDIO_VOLUME_KEY = 'kagariai_audio_volume';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export class CombatAudio {
  constructor(host = globalThis) {
    this.host = host;
    const storage = host?.localStorage;
    this.enabled = storage?.getItem(AUDIO_ENABLED_KEY) !== 'false';
    const storedVolume = storage?.getItem(AUDIO_VOLUME_KEY);
    const savedVolume = storedVolume === null || storedVolume === undefined ? Number.NaN : Number(storedVolume);
    this.volume = Number.isFinite(savedVolume) ? clamp(savedVolume, 0, 1) : 0.72;
    this.context = null;
    this.master = null;
    this.noiseBuffer = null;
    this.lastLocalShotAt = -Infinity;
    this.lastLocalWeaponId = null;
    this.localPredictedShots = [];
    this.recentAttackIds = new Map();
    this.coalescedShots = 0;
    this.predictedShotConfirms = 0;
    this.activeVoices = new Set();
    this.normalVoiceLimit = 40;
    this.maxVoices = 48;
    this.droppedVoices = 0;
  }

  async ensureStarted() {
    if (!this.enabled) return false;
    if (!this.context) {
      const AudioContextClass = this.host?.AudioContext || this.host?.webkitAudioContext;
      if (!AudioContextClass) return false;
      this.context = new AudioContextClass({ latencyHint: 'interactive' });
      const compressor = this.context.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.knee.value = 18;
      compressor.ratio.value = 6;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(compressor);
      compressor.connect(this.context.destination);
      this.noiseBuffer = this._makeNoiseBuffer();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    return this.context.state === 'running';
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.host?.localStorage?.setItem(AUDIO_ENABLED_KEY, String(this.enabled));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.025);
    }
    if (this.enabled) this.ensureStarted().catch(() => {});
    return this.enabled;
  }

  setVolume(value) {
    this.volume = clamp(value, 0, 1);
    this.host?.localStorage?.setItem(AUDIO_VOLUME_KEY, String(this.volume));
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.025);
    }
    return this.volume;
  }

  setListener(pose) {
    if (!this.context || !pose?.pos) return;
    const listener = this.context.listener;
    const [x, y, z] = pose.pos.map(Number);
    const yaw = Number(pose.yaw) || 0;
    const pitch = Number(pose.pitch) || 0;
    const cp = Math.cos(pitch);
    const forward = [Math.cos(yaw) * cp, Math.sin(pitch), -Math.sin(yaw) * cp];
    const at = this.context.currentTime;
    if (listener.positionX) {
      listener.positionX.setValueAtTime(x, at);
      listener.positionY.setValueAtTime(z, at);
      listener.positionZ.setValueAtTime(-y, at);
      listener.forwardX.setValueAtTime(forward[0], at);
      listener.forwardY.setValueAtTime(forward[1], at);
      listener.forwardZ.setValueAtTime(forward[2], at);
      listener.upX.setValueAtTime(0, at);
      listener.upY.setValueAtTime(1, at);
      listener.upZ.setValueAtTime(0, at);
    }
  }

  handleEvent(event, context = {}) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    if (event?.type === 'shot' && this._suppressConfirmedShot(event, context)) return;
    const cue = describeCombatCue(event, context);
    if (cue) this._play(cue);
  }

  playLocalShot(weaponId, predictionId = null) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    this.lastLocalShotAt = this.context.currentTime;
    this.lastLocalWeaponId = weaponId;
    this.localPredictedShots.push({
      weaponId: String(weaponId || ''),
      predictionId: predictionId === null ? null : String(predictionId),
      at: this.context.currentTime,
    });
    if (this.localPredictedShots.length > 32) this.localPredictedShots.splice(0, this.localPredictedShots.length - 32);
    this._play({
      kind: 'weapon', priority: 'high', spatial: false, position: null,
      gain: 0.74, pitch: 1, profile: weaponSoundProfile(weaponId),
    });
  }

  _suppressConfirmedShot(event, context) {
    const now = this.context.currentTime;
    for (const [key, expiresAt] of this.recentAttackIds) {
      if (expiresAt <= now) this.recentAttackIds.delete(key);
    }
    if (event.attackId !== undefined && event.attackId !== null) {
      const key = `${String(event.source ?? '')}:${String(event.attackId)}`;
      if (this.recentAttackIds.has(key)) {
        this.coalescedShots++;
        return true;
      }
      this.recentAttackIds.set(key, now + 2);
    }

    this.localPredictedShots = this.localPredictedShots.filter(predicted => now - predicted.at <= 1.5);
    if (event.source !== context.myId) return false;
    const rttSec = Math.max(0, Number(context.rttMs) || 0) / 1000;
    const interpSec = Math.max(0, Number(context.interpMs) || 0) / 1000;
    const confirmationWindow = Math.max(0.45, Math.min(1.2, rttSec + interpSec + 0.15));
    const index = this.localPredictedShots.findIndex(predicted => (
      predicted.weaponId === String(event.weaponId || '')
      && now - predicted.at >= 0
      && now - predicted.at <= confirmationWindow
    ));
    if (index < 0) return false;
    this.localPredictedShots.splice(index, 1);
    this.predictedShotConfirms++;
    return true;
  }

  _trackVoice(node, priority = 'normal') {
    const limit = priority === 'critical' ? this.maxVoices : this.normalVoiceLimit;
    if (!node || this.activeVoices.size >= limit) {
      this.droppedVoices++;
      return false;
    }
    const previous = node.onended;
    node.onended = (...args) => {
      this.activeVoices.delete(node);
      if (typeof previous === 'function') previous.apply(node, args);
    };
    this.activeVoices.add(node);
    return true;
  }

  diagnostics() {
    return {
      voices: {
        active: this.activeVoices.size,
        normalLimit: this.normalVoiceLimit,
        hardLimit: this.maxVoices,
        dropped: this.droppedVoices,
      },
      coalescedShots: this.coalescedShots,
      predictedShotConfirms: this.predictedShotConfirms,
      recentAttacks: this.recentAttackIds.size,
      pendingPredictedShots: this.localPredictedShots.length,
    };
  }

  _makeNoiseBuffer() {
    const length = Math.max(1, Math.floor(this.context.sampleRate * 0.5));
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const channel = buffer.getChannelData(0);
    let state = 0x6d2b79f5;
    for (let index = 0; index < length; index++) {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      channel[index] = (((state ^ (state >>> 14)) >>> 0) / 2147483648) - 1;
    }
    return buffer;
  }

  _output(cue) {
    if (!cue.spatial || !cue.position) return this.master;
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 3;
    panner.maxDistance = 90;
    panner.rolloffFactor = 1.1;
    const [x, y, z] = cue.position;
    panner.positionX.value = x;
    panner.positionY.value = z;
    panner.positionZ.value = -y;
    panner.connect(this.master);
    return panner;
  }

  _play(cue) {
    const output = this._output(cue);
    if (cue.kind === 'weapon') this._weapon(cue, output);
    else if (cue.kind === 'ultimate') this._chord([82, 123, 196, 294], 0.9, cue, output);
    else if (cue.kind === 'hit_confirm') this._chord(cue.pitch > 1.2 ? [880, 1320] : [660, 990], 0.08, cue, output);
    else if (cue.kind === 'damaged' || cue.kind === 'eliminated') this._thump(54, 0.32, cue, output);
    else if (cue.kind === 'healed' || cue.kind === 'pickup') this._chord([440, 660, 880], 0.26, cue, output);
    else if (cue.kind === 'objective') this._chord([196, 294, 392], 0.46, cue, output);
    else if (cue.kind === 'cast_warning') this._sweep(520, 118, 0.42, cue, output);
    else if (cue.kind === 'ability_ready') this._sweep(240, 560, 0.2, cue, output);
    else if (cue.kind === 'elimination') this._chord([392, 587, 784], 0.34, cue, output);
    else if (cue.kind === 'distant_elimination') this._thump(78, 0.18, cue, output);
    else if (cue.kind === 'barrier_hit') this._sweep(150, 90, 0.12, cue, output);
    else if (cue.kind === 'break') this._noise(0.22, cue.gain, 1500, output, cue.priority);
  }

  _weapon(cue, output) {
    const profile = cue.profile || weaponSoundProfile('');
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    if (!this._trackVoice(osc, cue.priority)) return;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, cue.gain * 0.72), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + profile.duration);
    gain.connect(output);
    osc.type = profile.wave;
    osc.frequency.setValueAtTime(profile.crackHz, now);
    osc.frequency.exponentialRampToValueAtTime(profile.bodyHz, now + profile.duration * 0.5);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + profile.duration);
    this._noise(profile.duration, cue.gain * profile.noise, profile.family === 'shotgun' ? 900 : 2200, output, cue.priority);
  }

  _noise(duration, gainValue, cutoff, output, priority = 'normal') {
    if (!this.noiseBuffer) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    if (!this._trackVoice(source, priority)) return;
    source.buffer = this.noiseBuffer;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    source.start(now);
    source.stop(now + duration);
  }

  _chord(frequencies, duration, cue, output) {
    const now = this.context.currentTime;
    frequencies.forEach((frequency, index) => {
      const osc = this.context.createOscillator();
      if (!this._trackVoice(osc, cue.priority)) return;
      const gain = this.context.createGain();
      osc.type = index % 2 ? 'triangle' : 'sine';
      osc.frequency.value = frequency * (cue.pitch || 1);
      gain.gain.setValueAtTime(Math.max(0.0001, cue.gain / frequencies.length), now + index * 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      osc.connect(gain);
      gain.connect(output);
      osc.start(now + index * 0.012);
      osc.stop(now + duration);
    });
  }

  _thump(frequency, duration, cue, output) {
    this._sweep(frequency * 1.8, frequency, duration, cue, output);
    this._noise(duration * 0.7, cue.gain * 0.35, 400, output, cue.priority);
  }

  _sweep(fromHz, toHz, duration, cue, output) {
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    if (!this._trackVoice(osc, cue.priority)) return;
    const gain = this.context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(fromHz * (cue.pitch || 1), now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, toHz * (cue.pitch || 1)), now + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, cue.gain), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(output);
    osc.start(now);
    osc.stop(now + duration);
  }
}
