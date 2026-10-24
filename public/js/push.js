// Web push: "you're up next on table 2", night reminders, lost-top-spot alerts.
// Works on Android/desktop browsers, and on iPhone once the app is added to the Home Screen.
import { api } from './api.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration() {
  return navigator.serviceWorker.ready;
}

export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await registration();
  return !!(await reg.pushManager.getSubscription());
}

const toBytes = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export async function enablePush() {
  if (!pushSupported()) throw new Error('This browser does not support notifications. On iPhone, add the app to your Home Screen first.');
  if (!window.isSecureContext) throw new Error('Notifications need the secure (https) address of the club app.');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications are blocked. Allow them in your browser settings.');
  const { key } = await api.get('/push/key');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });
  await api.post('/push/subscribe', sub.toJSON());
  await api.post('/push/test');
}

export async function disablePush() {
  const reg = await registration();
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  }
}
