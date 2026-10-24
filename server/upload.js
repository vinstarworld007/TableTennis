import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { UPLOAD_DIR } from './db.js';
import { bad } from './util.js';

const TYPES = {
  'image/jpeg': ['image', '.jpg'],
  'image/png': ['image', '.png'],
  'image/webp': ['image', '.webp'],
  'image/gif': ['image', '.gif'],
  'image/heic': ['image', '.heic'],
  'image/heif': ['image', '.heif'],
  'video/mp4': ['video', '.mp4'],
  'video/quicktime': ['video', '.mov'],
  'video/webm': ['video', '.webm'],
};
export const MAX_IMAGE = 15 * 1024 * 1024;
export const MAX_VIDEO = 200 * 1024 * 1024;

export function uploader({ imagesOnly = false } = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 7));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, crypto.randomBytes(12).toString('hex') + TYPES[file.mimetype][1]),
    }),
    limits: { fileSize: imagesOnly ? MAX_IMAGE : MAX_VIDEO, files: 1 },
    fileFilter: (req, file, cb) => {
      const t = TYPES[file.mimetype];
      if (!t || (imagesOnly && t[0] !== 'image')) return cb(bad('That file type is not supported.'));
      cb(null, true);
    },
  });
}

export function describe(file) {
  const [kind] = TYPES[file.mimetype];
  if (kind === 'image' && file.size > MAX_IMAGE) {
    fs.rmSync(file.path, { force: true });
    throw bad('Photos must be under 15 MB.');
  }
  return { kind, rel: path.relative(UPLOAD_DIR, file.path).split(path.sep).join('/') };
}

export function removeUpload(rel) {
  if (!rel) return;
  const full = path.resolve(UPLOAD_DIR, rel);
  if (full.startsWith(UPLOAD_DIR + path.sep)) fs.rmSync(full, { force: true });
}
