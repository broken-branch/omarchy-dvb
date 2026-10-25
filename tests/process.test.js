const test = require("node:test")
const assert = require("node:assert/strict")
const { spawnSync } = require("node:child_process")
const { copyFileSync, mkdtempSync, rmSync, writeFileSync } = require("node:fs")
const { tmpdir } = require("node:os")
const path = require("node:path")

test("Quickshell: missing executables and the watchdog finish once and free the next call", (t) => {
  const probe = spawnSync("quickshell", ["--version"], { encoding: "utf8", timeout: 5000 })
  if (probe.error?.code === "ENOENT") return t.skip("quickshell is not installed")
  assert.equal(probe.status, 0, probe.stderr)
  const runtime = mkdtempSync(path.join(tmpdir(), "dvb-process-test-"))
  try {
    copyFileSync(path.join(__dirname, "process.qml"), path.join(runtime, "shell.qml"))
    for (const file of ["DvbCommand.qml", "status.js"]) {
      copyFileSync(path.join(__dirname, "..", file), path.join(runtime, file))
    }
    const binary = path.join(runtime, "dvb")
    writeFileSync(binary, '#!/bin/sh\nrm -- "$0"\nprintf status\nprintf diagnostic >&2\n', { mode: 0o700 })
    const result = spawnSync("quickshell", ["--no-color", "--path", runtime], {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, QT_QPA_PLATFORM: "offscreen", XDG_RUNTIME_DIR: runtime,
        DVB_TEST_BINARY: binary }
    })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /process lifecycle ok/)
  } finally {
    rmSync(runtime, { recursive: true, force: true })
  }
})
