if (typeof Promise.withResolvers !== "function") {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };
}

// Some older module workers do not support top-level await. Queue incoming
// PDF.js messages until the worker module has finished loading so those
// browsers do not silently remain in a permanent "Procesando" state.
const pendingMessages = [];
let workerReady = false;
const nativeAddEventListener = self.addEventListener.bind(self);
self.addEventListener = function addEventListener(type, listener, options) {
  if (type !== "message" || workerReady) {
    return nativeAddEventListener(type, listener, options);
  }
  return nativeAddEventListener(type, (event) => {
    if (workerReady) listener.call(self, event);
    else pendingMessages.push({ listener, event });
  }, options);
};

import("/pdf.worker.min.mjs").then(() => {
  workerReady = true;
  for (const { listener, event } of pendingMessages.splice(0)) listener.call(self, event);
}).catch((reason) => {
  setTimeout(() => { throw reason; }, 0);
});
