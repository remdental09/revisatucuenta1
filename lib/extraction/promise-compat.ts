type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = typeof Promise & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
};

/**
 * PDF.js 6 uses Promise.withResolvers(), which is not available in older
 * Safari/iOS releases. Install the small equivalent before PDF.js is loaded.
 */
export function installPromiseWithResolversPolyfill() {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers === "function") return;

  promiseConstructor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    return { promise, resolve, reject };
  };
}
