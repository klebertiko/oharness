/**
 * The Node runtime that ships with the plugin host is pinned by version and SHA256 (ADR 0071).
 * No network here: the download itself is not exercised, only what decides whether its bytes are trusted.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { NODE_VERSION, NODE_TARGETS, archiveUrl, targetFor, verifySha256 } from "./build-cordis-host.mjs";

describe("pinned Node runtime for the plugin host", () => {
  it("is the version of .nvmrc and of the host's engines floor", () => {
    assert.equal(NODE_VERSION, readFileSync(new URL("../.nvmrc", import.meta.url), "utf8").trim());
    const engines = JSON.parse(readFileSync(new URL("../cordis-host/package.json", import.meta.url), "utf8")).engines.node;
    assert.equal(engines, `>=${NODE_VERSION}`);
  });

  it("pins a full sha256 for every target it can build", () => {
    assert.deepEqual(Object.keys(NODE_TARGETS).sort(), ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"]);
    for (const target of Object.values(NODE_TARGETS)) {
      assert.match(target.sha256, /^[0-9a-f]{64}$/);
      assert.ok(target.file.startsWith(`node-v${NODE_VERSION}-`));
    }
  });

  it("downloads only from nodejs.org over https", () => {
    for (const key of Object.keys(NODE_TARGETS)) {
      assert.ok(archiveUrl(NODE_TARGETS[key]).startsWith(`https://nodejs.org/dist/v${NODE_VERSION}/`));
    }
  });

  it("refuses an archive whose sha256 is not the pinned one", () => {
    const bytes = Buffer.from("not node");
    assert.throws(() => verifySha256(bytes, "0".repeat(64)), /sha256/i);
    assert.doesNotThrow(() => verifySha256(bytes, createHash("sha256").update(bytes).digest("hex")));
  });

  it("refuses a platform it has no pin for, instead of guessing", () => {
    assert.throws(() => targetFor("freebsd", "x64"), /unsupported/i);
    assert.throws(() => targetFor("win32", "arm64"), /unsupported/i);
    assert.equal(targetFor("win32", "x64").out, "node.exe");
  });
});
