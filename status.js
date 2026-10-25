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

// A failed or unusable read: which state it is and the line to log.
// 127 also represents a direct call whose executable could not be started.
function failure(exitCode, stderr) {
  if (exitCode === 127) return { state: "missing", message: "dvb not found on PATH; the widget stays hidden" }
  if (exitCode === TIMED_OUT) return { state: "timeout", message: "dvb status did not finish in " + WATCHDOG_SEC + " s; stopped it" }
  var lines = String(stderr || "").split("\n")
  var first = ""
  for (var i = 0; i < lines.length && first === ""; i++) first = lines[i].trim()
  if (first === "") first = exitCode === 0 ? "unexpected output" : "exit code " + exitCode
  return { state: "failed", message: "dvb status failed: " + first }
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
//   lastLogged   the failure state last logged, "" after a good list read
function initialState() {
  return { needsYou: 0, items: [], listRead: false, lastLogged: "" }
}

function visible(state) {
  return state.needsYou > 0 && state.listRead
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

// The login shell's `command -v dvb` finished: the path to run, or "".
function located(state, exitCode, output) {
  var path = exitCode === 0 ? parseWhich(output) : ""
  if (path === "") return update(statusFailed(state, 127, ""), { path: "" })
  return { state: state, log: [], close: false, path: path }
}

// `dvb status --bar` finished. `readList` asks for the list when something
// waits; `close` closes an open panel when nothing does.
function barDone(state, exitCode, out, err) {
  var n = exitCode === 0 ? parseBar(out) : null
  if (n === null) return update(statusFailed(state, exitCode, err), { readList: false })
  return { state: update(state, { needsYou: n }), log: [], close: n === 0, readList: n > 0 }
}

// `dvb status --json` finished.
function listDone(state, exitCode, out, err) {
  var list = exitCode === 0 ? parseList(out) : null
  if (list === null) return statusFailed(state, exitCode, err)
  return { state: update(state, { items: list, listRead: true, lastLogged: "" }), log: [], close: false }
}

// The keyboard cursor runs over the rows and then "Open cockpit". It is null
// (hidden), { cockpit: true }, or the { kind, id } of the selected item, so
// selection follows the item when the list changes.
function cursorIndex(items, cursor) {
  if (!cursor) return -1
  if (cursor.cockpit) return items.length
  for (var i = 0; i < items.length; i++) {
    if (items[i].kind === cursor.kind && items[i].id === cursor.id) return i
  }
  return -1
}

function cursorAt(items, index) {
  return index === items.length ? { cockpit: true } : { kind: items[index].kind, id: items[index].id }
}

// Up or Down without wrapping; a hidden cursor shows on the first row (Down)
// or on "Open cockpit" (Up).
function moveCursor(items, cursor, dy) {
  var index = cursorIndex(items, cursor)
  if (index < 0) return cursorAt(items, dy > 0 ? 0 : items.length)
  return cursorAt(items, Math.min(items.length, Math.max(0, index + dy)))
}

// The argv Enter runs, or null when the selected item has gone: Enter then
// does nothing until the user picks another row. With no cursor it opens the
// first row.
function activateArgv(items, cursor) {
  var index = cursor ? cursorIndex(items, cursor) : 0
  if (index < 0) return null
  return index < items.length ? appArgv(items[index]) : ["dvb", "app"]
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
