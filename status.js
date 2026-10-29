// The dvb bar widget's logic: parsing `dvb status` output, the state changes
// each finished call makes, failures, kind labels, routes and the keyboard
// cursor. Plain JavaScript so Panel.qml imports it and `node --test` runs it
// without Qt.

// An id that can go in a `dvb app --route` path: letters, digits, `-` and `_`.
var ROUTE_ID = /^[A-Za-z0-9_-]+$/

function parseJson(text) {
  var raw = String(text || "").trim()
  if (raw === "") return null
  try {
    var value = JSON.parse(raw)
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : null
  } catch (e) {
    return null
  }
}

// dvb's documented install, as its README gives it: the panel lists these
// steps, and Install dvb runs them in a new temporary directory. The subshell
// traces each command before it runs, so the terminal shows exactly what runs;
// sudo asks for the user's password there.
var INSTALL_STEPS = [
  "curl -fsSL https://github.com/broken-branch/dvb/releases/latest/download/install.sh -o install.sh",
  "sudo sh install.sh --engine --cockpit"
]
var INSTALL_COMMAND = '(cd "$(mktemp -d)" && set -x && ' + INSTALL_STEPS.join(" && ") + ")"

// "Install dvb" opens Omarchy's floating terminal, the one its own update and
// install actions use, running INSTALL_COMMAND.
function installArgv() {
  return ["omarchy-launch-floating-terminal-with-presentation", INSTALL_COMMAND]
}

// "Update dvb" opens the same terminal running `dvb update`, which asks the
// engine to update; the trace shows the command before it runs.
var UPDATE_COMMAND = "(set -x && dvb update)"

function updateArgv() {
  return ["omarchy-launch-floating-terminal-with-presentation", UPDATE_COMMAND]
}

// How often Panel.qml runs `dvb update --check`, besides once at start.
var UPDATE_CHECK_HOURS = 6

// The exit code Panel.qml reports for a call its watchdog stopped.
var TIMED_OUT = -1
// How long a `dvb` call may run before Panel.qml stops it.
var WATCHDOG_SEC = 15

function count(value) {
  return typeof value === "number" && isFinite(value) && value >= 0 ? Math.floor(value) : -1
}

// `dvb status --bar`: the need-you count, or null when the output is not the
// status shape.
function parseBar(text) {
  var status = parseJson(text)
  if (!status) return null
  var n = count(status.needs_you)
  return n < 0 ? null : n
}

function text(value) {
  return typeof value === "string" ? value : ""
}

// `dvb status --json`: the waiting items in dvb's order, or null when the
// output is not the status shape. Items without a kind and an id are skipped.
function parseList(output) {
  var status = parseJson(output)
  if (!status || !Array.isArray(status.needs_you_items)) return null
  var items = []
  for (var i = 0; i < status.needs_you_items.length; i++) {
    var entry = status.needs_you_items[i]
    if (!entry || typeof entry !== "object") continue
    var kind = text(entry.kind)
    var id = text(entry.id)
    if (kind === "" || id === "") continue
    items.push({
      kind: kind,
      id: id,
      project: text(entry.project),
      projectName: text(entry.project_name),
      title: text(entry.title),
      state: text(entry.state),
      reason: text(entry.reason)
    })
  }
  return items
}

// `dvb update --check`: the newer version, "" when the installed one is the
// newest, or null when the output is neither of the check's two lines.
var NEWEST = /^dvb \S+ is the newest release$/
var AVAILABLE = /^dvb \S+ is installed; (\S+) is available\. Install it with: dvb update$/

function parseUpdate(output) {
  var line = String(output || "").trim()
  if (NEWEST.test(line)) return ""
  var available = AVAILABLE.exec(line)
  return available ? available[1] : null
}

// The login shell's `command -v dvb` output: the last line that is an
// absolute path, so anything the profile prints first is skipped.
function parseWhich(output) {
  var lines = String(output || "").split("\n")
  for (var i = lines.length - 1; i >= 0; i--) {
    var line = lines[i].trim()
    if (line.charAt(0) === "/") return line
  }
  return ""
}

// The row's second line: the project's name, or its id when dvb gave none.
function projectLabel(item) {
  return item.projectName || item.project
}

// The row's right-hand word, upper case, and whether it is drawn urgent.
function kindLabel(item) {
  if (item.kind === "question") return { text: "QUESTION", urgent: false }
  if (item.kind === "task" && item.state === "failed") return { text: "FAILED", urgent: true }
  if (item.kind === "task" && item.state === "stopped") return { text: "STOPPED", urgent: false }
  return { text: item.kind.toUpperCase(), urgent: false }
}

// The cockpit page for an item, or "" when there is none.
function route(item) {
  if (!item || !ROUTE_ID.test(item.id)) return ""
  if (item.kind === "question") return "/decision/" + item.id
  if (item.kind === "task") return "/task/" + item.id
  return ""
}

// The argv a click runs: `dvb app`, with `--route` when the item has one.
function appArgv(item) {
  var path = route(item)
  return path === "" ? ["dvb", "app"] : ["dvb", "app", "--route", path]
}

function badgeText(n) {
  return n > 9 ? "9+" : String(n)
}

// A failed or unusable read of `call` ("dvb status" unless given): which state
// it is and the line to log. 127 also represents a direct call whose
// executable could not be started.
function failure(exitCode, stderr, call) {
  call = call || "dvb status"
  if (exitCode === 127) return { state: "missing", message: "dvb not found on PATH; the widget offers Install dvb" }
  if (exitCode === TIMED_OUT) return { state: "timeout", message: call + " did not finish in " + WATCHDOG_SEC + " s; stopped it" }
  var lines = String(stderr || "").split("\n")
  var first = ""
  for (var i = 0; i < lines.length && first === ""; i++) first = lines[i].trim()
  if (first === "") first = exitCode === 0 ? "unexpected output" : "exit code " + exitCode
  return { state: "failed", message: call + " failed: " + first }
}

// Each failure state logs once: again only after a success ("") or a change
// to another state.
function shouldLog(lastLogged, state) {
  return state !== "" && state !== lastLogged
}

// The widget's state, as Panel.qml holds it in its properties:
//   needsYou     the badge count from `dvb status --bar`
//   items        the last good list from `dvb status --json`
//   listRead     the list has succeeded since the last failure
//   lastLogged   the failure state last logged, "" after a good list read or
//                a count of 0
//   notInstalled the login shell found no `dvb`: the icon shows, without a
//                badge, and the panel offers Install dvb
//   updateTo     the newer release the last `dvb update --check` found, or "":
//                the icon shows and the panel offers Update dvb
//   updateLogged the update check's failure state last logged, "" after a
//                good check
function initialState() {
  return {
    needsYou: 0, items: [], listRead: false, lastLogged: "", notInstalled: false,
    updateTo: "", updateLogged: ""
  }
}

// An offered update shows only while the status reads work, as `dvb update`
// needs the same engine.
function visible(state) {
  return state.notInstalled || (state.needsYou > 0 && state.listRead) ||
    (state.updateTo !== "" && state.lastLogged === "")
}

function update(state, changes) {
  var next = {}
  for (var key in state) next[key] = state[key]
  for (key in changes) next[key] = changes[key]
  return next
}

// A failed status read hides the widget until a list read succeeds again,
// keeps the last good list and logs the failure once.
function statusFailed(state, exitCode, stderr) {
  var f = failure(exitCode, stderr)
  return {
    state: update(state, { needsYou: 0, listRead: false, lastLogged: f.state }),
    log: shouldLog(state.lastLogged, f.state) ? [f.message] : [],
    close: true,
    missing: exitCode === 127
  }
}

// The login shell's `command -v dvb` finished: the path to run, or "". The
// panel closes when the widget changes between not installed and installed,
// and stays open while each refresh still finds no `dvb`.
function located(state, exitCode, output) {
  var path = exitCode === 0 ? parseWhich(output) : ""
  if (path === "") {
    var failed = statusFailed(state, 127, "")
    return update(failed, {
      state: update(failed.state, { items: [], notInstalled: true, updateTo: "" }),
      close: !state.notInstalled,
      path: ""
    })
  }
  return { state: update(state, { notInstalled: false }), log: [], close: state.notInstalled, path: path }
}

// `dvb status --bar` finished. `readList` asks for the list when something
// waits; `close` closes an open panel when nothing does and no update is
// offered. A count of 0 is the whole status, so it is a good read.
function barDone(state, exitCode, out, err) {
  var n = exitCode === 0 ? parseBar(out) : null
  if (n === null) return update(statusFailed(state, exitCode, err), { readList: false })
  var next = n === 0 ? update(state, { needsYou: 0, items: [], listRead: true, lastLogged: "" }) : update(state, { needsYou: n })
  return { state: next, log: [], close: n === 0 && !visible(next), readList: n > 0 }
}

// `dvb status --json` finished.
function listDone(state, exitCode, out, err) {
  var list = exitCode === 0 ? parseList(out) : null
  if (list === null) return statusFailed(state, exitCode, err)
  return { state: update(state, { items: list, listRead: true, lastLogged: "" }), log: [], close: false }
}

// `dvb update --check` finished. A failed or unreadable check offers no
// update and logs once until a check succeeds; the panel closes when the
// offer was all it showed.
function updateDone(state, exitCode, out, err) {
  var to = exitCode === 0 ? parseUpdate(out) : null
  if (to === null) {
    var f = failure(exitCode, err, "dvb update --check")
    var failed = update(state, { updateTo: "", updateLogged: f.state })
    return {
      state: failed,
      log: shouldLog(state.updateLogged, f.state) ? [f.message] : [],
      close: visible(state) && !visible(failed)
    }
  }
  var next = update(state, { updateTo: to, updateLogged: "" })
  return { state: next, log: [], close: visible(state) && !visible(next) }
}

// The keyboard cursor runs over the rows, "Update dvb" while `offered`, and
// then "Open cockpit". It is null (hidden), { update: true },
// { cockpit: true }, or the { kind, id } of the selected item, so selection
// follows the item when the list changes.
function cursorIndex(items, cursor, offered) {
  if (!cursor) return -1
  if (cursor.update) return offered ? items.length : -1
  if (cursor.cockpit) return offered ? items.length + 1 : items.length
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === cursor.kind && items[i].id === cursor.id) return i
  }
  return -1
}

function cursorAt(items, index, offered) {
  if (index < items.length) return { kind: items[index].kind, id: items[index].id }
  return offered && index === items.length ? { update: true } : { cockpit: true }
}

// Up or Down without wrapping; a hidden cursor shows on the first row (Down)
// or on "Open cockpit" (Up).
function moveCursor(items, cursor, dy, offered) {
  var last = offered ? items.length + 1 : items.length
  var index = cursorIndex(items, cursor, offered)
  if (index < 0) return cursorAt(items, dy > 0 ? 0 : last, offered)
  return cursorAt(items, Math.min(last, Math.max(0, index + dy)), offered)
}

// The argv Enter runs, or null when the selected item or update has gone:
// Enter then does nothing until the user picks another row. With no cursor it
// opens the first item, or the cockpit when none waits, never Update dvb.
// While dvb is not installed, Enter runs Install dvb.
function activateArgv(items, cursor, notInstalled, offered) {
  if (notInstalled) return installArgv()
  var index = cursor ? cursorIndex(items, cursor, offered) : 0
  if (index < 0) return null
  if (index < items.length) return appArgv(items[index])
  return cursor && cursor.update ? updateArgv() : ["dvb", "app"]
}

if (typeof module !== "undefined") {
  module.exports = {
    parseBar: parseBar,
    parseList: parseList,
    parseWhich: parseWhich,
    projectLabel: projectLabel,
    kindLabel: kindLabel,
    route: route,
    appArgv: appArgv,
    INSTALL_STEPS: INSTALL_STEPS,
    INSTALL_COMMAND: INSTALL_COMMAND,
    installArgv: installArgv,
    UPDATE_COMMAND: UPDATE_COMMAND,
    updateArgv: updateArgv,
    parseUpdate: parseUpdate,
    updateDone: updateDone,
    badgeText: badgeText,
    failure: failure,
    shouldLog: shouldLog,
    TIMED_OUT: TIMED_OUT,
    initialState: initialState,
    visible: visible,
    located: located,
    barDone: barDone,
    listDone: listDone,
    cursorIndex: cursorIndex,
    cursorAt: cursorAt,
    moveCursor: moveCursor,
    activateArgv: activateArgv
  }
}
