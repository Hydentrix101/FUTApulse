const test = require("node:test");
const assert = require("node:assert/strict");

const authApiPromise = import("../client/src/utils/authApi.js");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

test("login and signup requests use the strict ten-second default timeout", async () => {
  const { authRequest, CREDENTIAL_REQUEST_TIMEOUT_MS } = await authApiPromise;
  assert.equal(CREDENTIAL_REQUEST_TIMEOUT_MS, 10_000);
  for (const endpoint of ["/api/auth/login", "/api/auth/signup"]) {
    let requestOptions;
    await authRequest(endpoint, {}, "", async (_url, options) => {
      requestOptions = options;
      return response(200, {});
    });
    assert.ok(requestOptions.signal instanceof AbortSignal);
  }
});

test("auth request errors distinguish invalid credentials, server rejection, and server failure", async () => {
  const { authRequest } = await authApiPromise;
  await assert.rejects(
    authRequest("/api/auth/login", {}, "", async () => response(401, { error: "Backend detail" })),
    { status: 401, message: "Invalid username or password. Check your details and try again." }
  );
  await assert.rejects(
    authRequest("/api/auth/signup", {}, "", async () => response(409, { error: "That username is already taken." })),
    { status: 409, message: "That username is already taken." }
  );
  await assert.rejects(
    authRequest("/api/auth/login", {}, "", async () => response(500, { error: "Internal detail" })),
    { status: 500, message: "FUTApulse is temporarily unavailable. Please try again shortly." }
  );
});

test("auth request errors identify network outages and timeouts", async () => {
  const { authRequest } = await authApiPromise;
  await assert.rejects(
    authRequest("/api/auth/login", {}, "", async () => {
      throw new TypeError("fetch failed");
    }),
    { message: "Could not connect to FUTApulse. Check your internet connection and try again." }
  );
  await assert.rejects(
    authRequest("/api/auth/signup", { timeoutMs: 5 }, "", (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    })),
    { message: "Network timeout. Check your connection and try again." }
  );
});
