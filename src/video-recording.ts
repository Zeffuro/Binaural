import type { AudioCaptureLease } from './audio/engine';
import type { WavWriter } from './audio/export-types';

export interface VideoFormat {
  mimeType: string;
  extension: 'webm' | 'mp4';
  label: string;
}
export interface VideoProgress {
  seconds: number;
  bytes: number;
  fraction: number;
  stage: 'recording' | 'finishing' | 'saving';
}
export type VideoStopReason = 'duration' | 'finished' | 'audio-stopped' | 'hidden' | 'track-ended' | 'size-limit';
export interface VideoResult {
  blob?: Blob;
  mimeType: string;
  extension: 'webm' | 'mp4';
  seconds: number;
  bytes: number;
  reason: VideoStopReason;
}
export interface VideoRecordingOptions {
  canvas: HTMLCanvasElement;
  draw: () => void;
  audio: AudioCaptureLease;
  seconds: number;
  fps: 24 | 30;
  mimeType?: string;
  writer?: WavWriter;
  signal?: AbortSignal;
  onProgress?: (progress: VideoProgress) => void;
}
export interface VideoRecording {
  done: Promise<VideoResult>;
  finish(): void;
  cancel(): void;
}

const formats: VideoFormat[] = [
  { mimeType: 'video/webm;codecs=vp9,opus', extension: 'webm', label: 'WebM (VP9 + Opus)' },
  { mimeType: 'video/webm;codecs=vp8,opus', extension: 'webm', label: 'WebM (VP8 + Opus)' },
  { mimeType: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', extension: 'mp4', label: 'MP4 (H.264 + AAC)' },
];
const MIB = 1024 * 1024;
const MAX_QUEUE = 32 * MIB;
export const maxVideoSeconds = 3600;
export const maxVideoDownloadBytes = 512 * MIB;
export const maxVideoDirectBytes = 2048 * MIB;

export function videoBitrates(width: number, height: number, fps: 24 | 30) {
  const hd = width * height > 1280 * 720;
  return { audioBitsPerSecond: hd ? 192000 : 128000,
    videoBitsPerSecond: Math.round((hd ? 8000000 : 5000000) * fps / 30) };
}

export function supportedVideoFormats(): VideoFormat[] {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function'
      || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return [];
  return formats.filter(format => MediaRecorder.isTypeSupported(format.mimeType)).map(format => ({ ...format }));
}

export function recordVideo(options: VideoRecordingOptions): VideoRecording {
  const { canvas, audio, writer, signal } = options;
  let recorder: MediaRecorder | undefined;
  let canvasStream: MediaStream | undefined;
  let stream: MediaStream | undefined;
  let raf = 0, timer: ReturnType<typeof setInterval> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  let bytes = 0, queued = 0, seconds = 0, origin = 0, nextDraw = 0;
  let started = false;
  let stopped = false, finalizing = false, settled = false, committing = false, cleaned = false;
  let failure: unknown;
  let reason: VideoStopReason = 'finished';
  let stage: VideoProgress['stage'] = 'recording';
  let format: VideoFormat | undefined;
  let mimeType = '';
  let writes = Promise.resolve();
  const chunks: Blob[] = [];
  const endedTracks: MediaStreamTrack[] = [];
  let resolveDone!: (result: VideoResult) => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<VideoResult>((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Setup can fail before the caller receives the controller.
  void done.catch(() => {});

  const readTime = () => {
    const now = audio.time();
    if (!Number.isFinite(now)) throw new Error('The playback clock is unavailable.');
    if (started) seconds = Math.min(options.seconds, Math.max(seconds, now - origin));
    return now;
  };
  const progress = () => {
    options.onProgress?.({ seconds, bytes, fraction: seconds / options.seconds, stage });
  };
  const haltDrawing = () => {
    cancelAnimationFrame(raf);
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    haltDrawing();
    clearTimeout(stopTimer);
    clearTimeout(startupTimer);
    document.removeEventListener('visibilitychange', visibility);
    endedTracks.forEach(track => track.removeEventListener('ended', trackEnded));
    stream?.getTracks().forEach(track => track.stop());
    canvasStream?.getTracks().forEach(track => track.stop());
    audio.dispose();
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      recorder.onstop = null;
    }
  };
  const finalize = async () => {
    if (finalizing || settled) return;
    finalizing = true;
    haltDrawing();
    try {
      cleanup();
      stage = 'finishing';
      if (!failure) progress();
      await writes;
      if (failure) throw failure;
      if (!bytes) throw new Error('The browser produced no video data. Try a longer recording.');
      let blob: Blob | undefined;
      if (writer) {
        stage = 'saving';
        progress();
        if (failure) throw failure;
        committing = true;
        await writer.close();
      } else blob = new Blob(chunks, { type: mimeType });
      settled = true;
      chunks.length = 0;
      resolveDone({ blob, mimeType, extension: format!.extension, seconds, bytes, reason });
    } catch (error) {
      failure = error;
      try { await writes; } catch { /* The original write error is retained. */ }
      try { await writer?.abort(error); } catch { /* Preserve the original recording failure. */ }
      settled = true;
      chunks.length = 0;
      rejectDone(error);
    } finally {
      signal?.removeEventListener('abort', cancel);
      cleanup();
    }
  };
  const stop = (nextReason: VideoStopReason) => {
    if (stopped || settled || committing) return;
    stopped = true;
    reason = nextReason;
    try { readTime(); } catch (error) { failure ??= error; }
    haltDrawing();
    if (recorder && recorder.state !== 'inactive') {
      try {
        stopTimer = setTimeout(() => {
          failure ??= new Error('The browser did not finish the video recording.');
          void finalize();
        }, 5000);
        recorder.stop();
      }
      catch (error) { failure ??= error; void finalize(); }
    } else void finalize();
  };
  const fail = (error: unknown) => {
    if (settled || committing) return;
    failure ??= error ?? new Error('Video recording failed.');
    if (!stopped) stop(reason);
  };
  function cancel() {
    fail(new DOMException('Video recording cancelled.', 'AbortError'));
  }
  function visibility() {
    if (document.hidden) stop('hidden');
  }
  function trackEnded() {
    stop(audio.state() === 'stopped' ? 'audio-stopped' : 'track-ended');
  }
  const draw = (timestamp: number) => {
    if (stopped) return;
    if (timestamp + .1 >= nextDraw) {
      try { options.draw(); }
      catch (error) { fail(error); return; }
      const interval = 1000 / options.fps;
      nextDraw = nextDraw ? nextDraw + (Math.floor(Math.max(0, timestamp - nextDraw) / interval) + 1) * interval : timestamp + interval;
    }
    raf = requestAnimationFrame(draw);
  };
  const tick = () => {
    if (stopped || !recorder) return;
    try {
      const now = readTime();
      const state = audio.state();
      if (state === 'stopped') { stop('audio-stopped'); return; }
      if (!started) {
        if (state === 'playing' && now > origin) {
          // A running AudioContext can stall while its output device starts.
          origin = now;
          options.draw();
          recorder.start(1000);
          started = true;
          clearTimeout(startupTimer);
          raf = requestAnimationFrame(draw);
        }
        progress();
        return;
      }
      if (seconds >= options.seconds) { stop('duration'); return; }
      if (state === 'paused' && recorder.state === 'recording') recorder.pause();
      else if (state === 'playing' && recorder.state === 'paused') recorder.resume();
      progress();
    } catch (error) { fail(error); }
  };

  try {
    if (!Number.isFinite(options.seconds) || options.seconds <= 0 || options.seconds > maxVideoSeconds) {
      throw new RangeError('Video duration must be between zero and one hour.');
    }
    if (options.fps !== 24 && options.fps !== 30) throw new RangeError('Video frame rate must be 24 or 30 fps.');
    if (!canvas.width || !canvas.height || canvas.width > 3840 || canvas.height > 2160) {
      throw new RangeError('Video canvas dimensions must be between 1 × 1 and 3840 × 2160.');
    }
    if (signal?.aborted) throw new DOMException('Video recording cancelled.', 'AbortError');
    if (document.hidden) throw new Error('Keep this tab visible while recording video.');
    if (audio.state() !== 'playing') throw new Error('Start playback before recording video.');
    const supported = supportedVideoFormats();
    format = options.mimeType ? supported.find(item => item.mimeType === options.mimeType) : supported[0];
    if (!format) throw new Error('This browser cannot record the selected video format.');
    origin = audio.time();
    if (!Number.isFinite(origin)) throw new Error('The playback clock is unavailable.');
    options.draw();
    canvasStream = canvas.captureStream(options.fps);
    const audioTracks = audio.stream.getAudioTracks();
    const videoTracks = canvasStream.getVideoTracks();
    if (audioTracks.length !== 1 || videoTracks.length !== 1 || audioTracks[0].readyState === 'ended'
        || videoTracks[0].readyState === 'ended') throw new Error('Video recording needs live audio and canvas tracks.');
    stream = new MediaStream([...videoTracks, audioTracks[0].clone()]);
    recorder = new MediaRecorder(stream, { mimeType: format.mimeType,
      ...videoBitrates(canvas.width, canvas.height, options.fps) });
    mimeType = recorder.mimeType || format.mimeType;
    const limit = writer ? maxVideoDirectBytes : maxVideoDownloadBytes;
    recorder.ondataavailable = event => {
      if (failure || settled || !event.data.size) return;
      const data = event.data;
      if (bytes + data.size > limit) { fail(new Error('Video recording exceeded its safe output size limit.')); return; }
      if (writer && queued + data.size > MAX_QUEUE) {
        fail(new Error('The video file destination is too slow; the recording buffer reached its limit.')); return;
      }
      bytes += data.size;
      if (writer) {
        queued += data.size;
        writes = writes.then(async () => {
          try {
            if (failure) return;
            const buffer = await data.arrayBuffer();
            if (!failure) await writer.write(buffer);
          } finally { queued -= data.size; }
        }).catch(error => { fail(error); });
      } else chunks.push(data);
      if (bytes >= limit - MAX_QUEUE) stop('size-limit');
    };
    recorder.onerror = event => fail('error' in event ? event.error : new Error('Video recording failed.'));
    recorder.onstop = () => {
      try { readTime(); } catch (error) { failure ??= error; }
      void finalize();
    };
    for (const track of [...stream.getTracks(), ...audioTracks]) {
      track.addEventListener('ended', trackEnded);
      endedTracks.push(track);
    }
    document.addEventListener('visibilitychange', visibility);
    signal?.addEventListener('abort', cancel, { once: true });
    progress();
    if (!stopped) {
      startupTimer = setTimeout(() => fail(new Error('The playback clock did not start. Try restarting playback.')), 10000);
      timer = setInterval(tick, 50);
    }
  } catch (error) {
    fail(error);
  }
  return { done, finish: () => stop('finished'), cancel };
}
