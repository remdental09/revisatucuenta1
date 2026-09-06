type PromiseWithResolvers<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type PromiseConstructorWithResolvers = typeof Promise & {
  withResolvers?: <T>() => PromiseWithResolvers<T>;
  try?: <T>(callback: () => T | PromiseLike<T>) => Promise<Awaited<T>>;
};

type ReadableStreamWithAsyncIterator<T> = ReadableStream<T> & {
  [Symbol.asyncIterator]?: () => AsyncIterator<T>;
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

  // PDF.js 6 reads page text with `for await ... of` over a ReadableStream.
  // Older iOS Safari exposes ReadableStream but omits its async iterator,
  // producing the opaque `undefined is not a function (near ...of...)` error.
  // Adapt the standard reader API before PDF.js is imported.
  const streamConstructor = (globalThis as typeof globalThis & {
    ReadableStream?: { prototype: ReadableStreamWithAsyncIterator<unknown> };
  }).ReadableStream;
  const asyncIterator = typeof Symbol !== "undefined" ? Symbol.asyncIterator : undefined;
  const streamPrototype = streamConstructor?.prototype;
  if (streamPrototype && asyncIterator && typeof streamPrototype[asyncIterator] !== "function") {
    Object.defineProperty(streamPrototype, asyncIterator, {
      configurable: true,
      writable: true,
      value(this: ReadableStream<unknown>) {
        const reader = this.getReader();
        return {
          next: () => reader.read(),
          return: () => reader.cancel().then(() => ({ done: true, value: undefined })),
          [asyncIterator]() { return this; },
        } satisfies AsyncIterator<unknown>;
      },
    });
  }
}
