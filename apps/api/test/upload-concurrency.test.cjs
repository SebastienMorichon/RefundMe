const assert = require("node:assert/strict");
const test = require("node:test");
const { Subject, of } = require("rxjs");
const {
  UploadConcurrencyInterceptor,
} = require("../dist/modules/documents/upload-concurrency.interceptor.js");

test("upload admission occurs per authenticated account and releases every slot", () => {
  const previousGlobal = process.env.DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL;
  const previousAccount = process.env.DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT;
  process.env.DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL = "2";
  process.env.DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT = "1";
  try {
    const interceptor = new UploadConcurrencyInterceptor();
    const first = new Subject();
    interceptor
      .intercept(contextFor("user-a"), { handle: () => first })
      .subscribe();

    const accountLimitedHeaders = new Map();
    assert.throws(
      () =>
        interceptor.intercept(contextFor("user-a", accountLimitedHeaders), {
          handle: () => of(null),
        }),
      (error) => error.getStatus() === 429,
    );
    assert.equal(accountLimitedHeaders.get("Retry-After"), "5");

    const second = new Subject();
    interceptor
      .intercept(contextFor("user-b"), { handle: () => second })
      .subscribe();
    assert.throws(
      () =>
        interceptor.intercept(contextFor("user-c"), {
          handle: () => of(null),
        }),
      (error) => error.getStatus() === 429,
    );

    first.complete();
    interceptor
      .intercept(contextFor("user-c"), { handle: () => of(null) })
      .subscribe();
    second.complete();
  } finally {
    restoreEnvironment(
      "DOCUMENT_UPLOAD_CONCURRENCY_GLOBAL",
      previousGlobal,
    );
    restoreEnvironment(
      "DOCUMENT_UPLOAD_CONCURRENCY_ACCOUNT",
      previousAccount,
    );
  }
});

test("unauthenticated requests cannot acquire an upload slot", () => {
  const interceptor = new UploadConcurrencyInterceptor();
  assert.throws(
    () =>
      interceptor.intercept(contextFor(null), {
        handle: () => of(null),
      }),
    (error) => error.getStatus() === 401,
  );
});

function contextFor(userId, headers = new Map()) {
  return {
    switchToHttp() {
      return {
        getRequest() {
          return { user: userId ? { id: userId } : undefined };
        },
        getResponse() {
          return {
            setHeader(name, value) {
              headers.set(name, value);
            },
          };
        },
      };
    },
  };
}

function restoreEnvironment(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
