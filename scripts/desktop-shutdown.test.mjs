/**
 * Nightwolf lessons: numeric port equality only — never substring match.
 * Port 51730 must NOT match a watch for 5173.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALLOWED_IMAGES,
  parseListeningPorts,
  portsEqual,
  shouldKillProcess,
} from "./desktop-shutdown.mjs";

describe("portsEqual — numeric only", () => {
  it("5173 equals 5173", () => {
    assert.equal(portsEqual(5173, 5173), true);
  });

  it("51730 does NOT equal 5173 (no substring)", () => {
    assert.equal(portsEqual(51730, 5173), false);
  });

  it("string forms still compare numerically", () => {
    assert.equal(portsEqual("5173", 5173), true);
    assert.equal(portsEqual("05173", 5173), true);
    assert.equal(portsEqual("51730", "5173"), false);
  });
});

describe("parseListeningPorts", () => {
  it("extracts ports from netstat-like lines with numeric equality helpers", () => {
    const sample = `
  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       1234
  TCP    127.0.0.1:51730        0.0.0.0:0              LISTENING       5678
  TCP    0.0.0.0:8000           0.0.0.0:0              LISTENING       9012
`;
    const rows = parseListeningPorts(sample);
    assert.deepEqual(
      rows.map((r) => r.port).sort((a, b) => a - b),
      [5173, 8000, 51730]
    );
    const watching = 5173;
    const hits = rows.filter((r) => portsEqual(r.port, watching));
    assert.equal(hits.length, 1);
    assert.equal(hits[0].pid, 1234);
  });
});

describe("shouldKillProcess — allowlisted images only", () => {
  it("allows known sidecar / tooling images", () => {
    for (const name of ["oharness-sidecar.exe", "python.exe", "uvicorn.exe"]) {
      assert.equal(shouldKillProcess(name, ALLOWED_IMAGES), true);
    }
  });

  it("refuses everything else", () => {
    assert.equal(shouldKillProcess("chrome.exe", ALLOWED_IMAGES), false);
    assert.equal(shouldKillProcess("node.exe", ALLOWED_IMAGES), false);
    assert.equal(shouldKillProcess("", ALLOWED_IMAGES), false);
  });

  it("is case-insensitive on Windows image names", () => {
    assert.equal(shouldKillProcess("Python.EXE", ALLOWED_IMAGES), true);
  });
});
