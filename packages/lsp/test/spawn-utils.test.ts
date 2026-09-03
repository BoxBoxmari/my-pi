import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizedLspEnvironment } from "@my-pi/lsp";

test("LSP child environment excludes common credential and code-injection variables", () => {
  const previous = {
    TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    PATH: process.env.PATH ?? process.env.Path,
  };
  try {
    process.env.TWILIO_AUTH_TOKEN = "synthetic-token";
    process.env.AWS_SECRET_ACCESS_KEY = "synthetic-secret";
    process.env.NODE_OPTIONS = "--require hostile-loader";
    const env = sanitizedLspEnvironment();
    assert.equal(env.TWILIO_AUTH_TOKEN, undefined);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.PATH ?? env.Path, previous.PATH);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
