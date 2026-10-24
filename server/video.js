// Optional video processing with ffmpeg: converts phone videos (e.g. iPhone .mov/HEVC) to web-friendly
// H.264 MP4 at up to 720p and grabs a poster frame. Skipped quietly when ffmpeg is not installed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSettings, UPLOAD_DIR } from './db.js';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
let available = null;
export function ffmpegAvailable() {
  if (available === null) {
    try { available = spawnSync(FFMPEG, ['-version'], { timeout: 5000 }).status === 0; } catch { available = false; }
  }
  return available;
}

const run = (args) => new Promise((resolve, reject) => {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('error', reject);
  p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-500) || `ffmpeg exited ${code}`))));
});

const queue = [];
let busy = false;

export function queueVideo(mediaId) {
  if (getSettings().transcode_videos !== '1' || !ffmpegAvailable()) return false;
  db.prepare('UPDATE media SET processing = 1 WHERE id = ?').run(mediaId);
  queue.push(mediaId);
  drain();
  return true;
}

async function drain() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const id = queue.shift();
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
    if (!m) continue;
    const src = path.join(UPLOAD_DIR, m.file);
    const base = m.file.replace(/\.\w+$/, '');
    const outRel = `${base}-web.mp4`;
    const posterRel = `${base}-poster.jpg`;
    try {
      await run(['-i', src, '-vf', "scale='min(1280,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(UPLOAD_DIR, outRel)]);
      await run(['-ss', '1', '-i', path.join(UPLOAD_DIR, outRel), '-frames:v', '1', '-vf', "scale='min(720,iw)':-2", path.join(UPLOAD_DIR, posterRel)])
        .catch(() => run(['-i', path.join(UPLOAD_DIR, outRel), '-frames:v', '1', path.join(UPLOAD_DIR, posterRel)]));
      const size = fs.statSync(path.join(UPLOAD_DIR, outRel)).size;
      db.prepare("UPDATE media SET file = ?, mime = 'video/mp4', size = ?, poster = ?, processing = 0 WHERE id = ?")
        .run(outRel, size, fs.existsSync(path.join(UPLOAD_DIR, posterRel)) ? posterRel : null, id);
      if (outRel !== m.file) fs.rmSync(src, { force: true });
    } catch (e) {
      console.warn(`Video ${id} could not be converted, keeping the original:`, e.message);
      db.prepare('UPDATE media SET processing = 0 WHERE id = ?').run(id);
    }
  }
  busy = false;
}
