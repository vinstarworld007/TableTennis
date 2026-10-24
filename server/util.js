export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const bad = (msg) => new HttpError(400, msg);
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (msg = 'Not allowed.') => new HttpError(403, msg);

export function str(v, max = 200) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

export function int(v) {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

// Phone numbers are stored as +<digits>. Local numbers starting with 0 get the club's country code.
export function normalisePhone(v, countryCode = '+44') {
  if (!v) return null;
  let s = String(v).trim().replace(/[\s().-]/g, '');
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) {
    const cc = (countryCode || '').replace(/[^\d+]/g, '');
    s = cc ? cc.replace(/^\+?/, '+') + s.replace(/^0+/, '') : '+' + s;
  }
  return /^\+\d{7,15}$/.test(s) ? s : undefined; // undefined = invalid
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
