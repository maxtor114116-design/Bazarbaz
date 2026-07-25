// نسخه رو عوض کردیم تا مرورگر مجبور بشه کش قدیمی رو دور بریزه و نسخه تازه نصب کنه
const CACHE = 'bazarbaz-v2';
const ASSETS = ['./index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// استراتژی جدید: اول از اینترنت بگیر (همیشه تازه‌ترین نسخه)؛ فقط اگه آفلاین
// بودی یا اینترنت نبود، برو سراغ نسخه ذخیره‌شده. قبلاً برعکس بود (اول کش، بعد
// اینترنت) که باعث می‌شد آپدیت‌های جدید هیچ‌وقت دیده نشن.
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
