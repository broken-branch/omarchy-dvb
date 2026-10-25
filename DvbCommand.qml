import QtQuick
import Quickshell.Io
import "status.js" as Status

Process {
  id: proc
  property bool pending: false
  property bool timedOut: false
  signal done(int exitCode, string out, string err)

  function run(path, args) {
    if (pending || running || path === "") return false
    pending = true
    timedOut = false
    command = [path].concat(args)
    watchdog.restart()
    running = true
    return true
  }

  function finish(exitCode, stdout, stderr) {
    if (!pending) return
    pending = false
    watchdog.stop()
    done(exitCode, stdout, stderr)
  }

  running: false
  onExited: function(exitCode) {
    finish(timedOut ? Status.TIMED_OUT : exitCode, out.text, err.text)
  }
  onRunningChanged: if (!running && pending) {
    // A failed start has no exited signal. Defer so a normal exit can deliver
    // its exit code and collectors before treating the executable as missing.
    Qt.callLater(function() {
      if (proc.pending && !proc.running) proc.finish(127, "", "")
    })
  }
  stdout: StdioCollector { id: out; waitForEnd: true }
  stderr: StdioCollector { id: err; waitForEnd: true }

  property Timer watchdog: Timer {
    interval: Status.WATCHDOG_SEC * 1000
    repeat: false
    onTriggered: if (proc.running) {
      proc.timedOut = true
      proc.running = false
    }
  }
}
