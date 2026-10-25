import QtQuick
import Quickshell
import "."
import "status.js" as Status

ShellRoot {
  id: test
  property int stage: 0

  function check(ok, message) {
    if (!ok) {
      console.error(message)
      Qt.exit(1)
    }
  }

  DvbCommand {
    id: call
    onDone: function(code, out, err) {
      test.check(!call.pending && !call.watchdog.running, "call was not released")
      if (test.stage === 0) {
        test.check(code === 0 && out === "status" && err === "diagnostic", "collectors or exit code lost")
        test.stage = 1
        test.check(call.run(Quickshell.env("DVB_TEST_BINARY"), []), "missing call refused")
      } else if (test.stage === 1) {
        test.check(code === 127 && out === "" && err === "", "missing executable was not reported")
        test.stage = 2
        test.check(call.run("/bin/sleep", ["60"]), "next call after missing binary refused")
        test.check(!call.run("/bin/true", []), "overlapping call accepted")
        test.check(call.watchdog.interval === 15000 && !call.watchdog.repeat, "watchdog configuration changed")
        Qt.callLater(function() { call.watchdog.triggered() })
      } else if (test.stage === 2) {
        test.check(code === Status.TIMED_OUT, "watchdog did not report timeout")
        test.stage = 3
        test.check(call.run("/bin/true", []), "next poll after watchdog refused")
      } else if (test.stage === 3) {
        test.check(code === 0 && out === "" && err === "", "poll after watchdog failed")
        test.stage = 4
        // Let any deferred stopped handler run before checking for double completion.
        Qt.callLater(function() {
          test.check(test.stage === 4, "call completed twice")
          console.log("process lifecycle ok")
          Qt.quit()
        })
      } else {
        test.check(false, "call completed twice")
      }
    }
  }

  Component.onCompleted: check(call.run(Quickshell.env("DVB_TEST_BINARY"), []), "first call refused")
}
