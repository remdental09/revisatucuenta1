type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = typeof Promise & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<Awaited<T>>;
};

/**
 * PDF.js 6 uses Promise.withResolvers(), which is not available in older
 * Safari/iOS releases. Install the small equivalent before PDF.js is loaded.
 */
export function installPromiseWithResolversPolyfill() {
  const promiseConstructor = Promise as PromiseConstructorWithResolvers;
  if (typeof promiseConstructor.withResolvers !== "function") {
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

  if (typeof promiseConstructor.try !== "function") {
    promiseConstructor.try = function promiseTry<T>(callback: () => T | PromiseLike<T>) {
      return new Promise<Awaited<T>>((resolve) => resolve(callback() as Awaited<T>));
    };
  }
}
