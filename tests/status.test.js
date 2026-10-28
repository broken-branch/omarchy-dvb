const test = require("node:test")
const assert = require("node:assert/strict")
const status = require("../status.js")

const list = JSON.stringify({
  running: 1,
  needs_you: 3,
  warnings: [],
  only: null,
  questions: [],
  needs_you_items: [
    { kind: "task", id: "t-1", project: "p1", project_name: "dvb", title: "Add the status parser", state: "failed", reason: "tests failed", question: null, command: "dvb retry t-1" },
    { kind: "task", id: "t-2", project: "p2", project_name: "notes", title: "Write the release notes", state: "stopped", reason: null, command: "dvb resume t-2" },
    { kind: "question", id: "q-1", project: "p1", project_name: "dvb", title: "Approve the plan?", command: "dvb answer q-1 <n>" }
  ]
})

test("count: --bar gives the need-you number", () => {
  assert.equal(status.parseBar('{"running":2,"needs_you":3}\n'), 3)
  assert.equal(status.parseBar('{"running":0,"needs_you":0,"warnings":["cache_isolation_missing"]}'), 0)
})

test("count: the badge caps at 9+", () => {
  assert.equal(status.badgeText(1), "1")
  assert.equal(status.badgeText(9), "9")
  assert.equal(status.badgeText(10), "9+")
})

test("list: items in dvb's order with the fields the panel uses", () => {
  assert.deepEqual(status.parseList(list), [
    { kind: "task", id: "t-1", project: "p1", projectName: "dvb", title: "Add the status parser", state: "failed", reason: "tests failed" },
    { kind: "task", id: "t-2", project: "p2", projectName: "notes", title: "Write the release notes", state: "stopped", reason: "" },
    { kind: "question", id: "q-1", project: "p1", projectName: "dvb", title: "Approve the plan?", state: "", reason: "" }
  ])
})

test("list: an item without a kind or an id is skipped", () => {
  const out = status.parseList(JSON.stringify({ needs_you: 2, needs_you_items: [{ kind: "task", title: "x" }, { id: "q" }, null, 4, { kind: "question", id: "q-2" }] }))
  assert.deepEqual(out.map((i) => i.id), ["q-2"])
})

test("list: labels, urgency and routes", () => {
  const [failed, stopped, question] = status.parseList(list)
  assert.deepEqual(status.kindLabel(failed), { text: "FAILED", urgent: true })
  assert.deepEqual(status.kindLabel(stopped), { text: "STOPPED", urgent: false })
  assert.deepEqual(status.kindLabel(question), { text: "QUESTION", urgent: false })
  assert.deepEqual(status.appArgv(failed), ["dvb", "app", "--route", "/task/t-1"])
  assert.deepEqual(status.appArgv(question), ["dvb", "app", "--route", "/decision/q-1"])
})

test("list: no route for an unknown kind or an id that is not a plain path", () => {
  assert.deepEqual(status.appArgv({ kind: "goal", id: "g-1" }), ["dvb", "app"])
  assert.deepEqual(status.appArgv({ kind: "task", id: "../setup" }), ["dvb", "app"])
  assert.deepEqual(status.appArgv({ kind: "task", id: "a?b=1" }), ["dvb", "app"])
  assert.deepEqual(status.appArgv(null), ["dvb", "app"])
})

test("list: each row names its project from the item, or shows its id without a name", () => {
  assert.deepEqual(status.parseList(list).map(status.projectLabel), ["dvb", "notes", "dvb"])
  const [unnamed] = status.parseList(JSON.stringify({ needs_you_items: [{ kind: "task", id: "t-3", project: "p3", project_name: null }] }))
  assert.equal(status.projectLabel(unnamed), "p3")
})

test("empty: nothing waiting", () => {
  assert.equal(status.parseBar('{"running":0,"needs_you":0}'), 0)
  assert.deepEqual(status.parseList('{"running":0,"needs_you":0,"needs_you_items":[]}'), [])
})

test("malformed output is not a status", () => {
  for (const out of ["", "  \n", "not json", "[]", "null", "3", '{"running":1}', '{"needs_you":"3"}', '{"needs_you":-1}', "error: engine unreachable"]) {
    assert.equal(status.parseBar(out), null, out)
  }
  for (const out of ["", "not json", '{"needs_you":1}', '{"needs_you_items":{}}', "[]"]) {
    assert.equal(status.parseList(out), null, out)
  }
})

test("dvb missing: exit 127 is its own state", () => {
  assert.deepEqual(status.failure(127, "bash: line 1: exec: dvb: not found\n"), {
    state: "missing",
    message: "dvb not found on PATH; the widget offers Install dvb"
  })
})

test("engine unreachable: the first line of stderr is logged", () => {
  assert.deepEqual(status.failure(1, "\nerror: the engine is not reachable\nmore\n"), {
    state: "failed",
    message: "dvb status failed: error: the engine is not reachable"
  })
  assert.equal(status.failure(2, "").message, "dvb status failed: exit code 2")
  assert.equal(status.failure(0, "").message, "dvb status failed: unexpected output")
})

test("dvb path: the last absolute path the login shell prints", () => {
  assert.equal(status.parseWhich("/usr/local/bin/dvb\n"), "/usr/local/bin/dvb")
  assert.equal(status.parseWhich("Welcome back!\n/usr/bin/dvb\n"), "/usr/bin/dvb")
  assert.equal(status.parseWhich(""), "")
  assert.equal(status.parseWhich("dvb: aliased to something"), "")
})

test("a call the watchdog stopped is its own failure", () => {
  assert.deepEqual(status.failure(status.TIMED_OUT, ""), {
    state: "timeout",
    message: "dvb status did not finish in 15 s; stopped it"
  })
})

test("each failure state logs once", () => {
  assert.equal(status.shouldLog("", "missing"), true)
  assert.equal(status.shouldLog("missing", "missing"), false)
  assert.equal(status.shouldLog("missing", "failed"), true)
  assert.equal(status.shouldLog("failed", ""), false)
})

// The panel's state changes, driven the way Panel.qml's handlers drive them.
function widget() {
  const w = {
    state: status.initialState(),
    logged: [],
    opened: false,
    apply(result) {
      w.state = result.state
      w.logged.push(...result.log)
      if (result.close) w.opened = false
      return result
    },
    count(n) { return w.apply(status.barDone(w.state, 0, JSON.stringify({ needs_you: n }), "")) },
    failCount(code = 1, err = "engine unreachable") { return w.apply(status.barDone(w.state, code, "", err)) },
    refresh(items) { return w.apply(status.listDone(w.state, 0, JSON.stringify({ needs_you_items: items }), "")) },
    fail(code = 1, err = "engine unreachable") { return w.apply(status.listDone(w.state, code, "", err)) },
    get visible() { return status.visible(w.state) }
  }
  return w
}

const question = { kind: "question", id: "q1", project: "p1", title: "Approve plan?" }
const task1 = { kind: "task", id: "t1", project: "p1", title: "First task" }
const task2 = { kind: "task", id: "t2", project: "p2", title: "Second task" }

test("dvb found: polls run that path and the widget hides while nothing waits", () => {
  const w = widget()
  assert.equal(w.apply(status.located(w.state, 0, "/usr/bin/dvb\n")).path, "/usr/bin/dvb")
  assert.deepEqual(w.logged, [])
  assert.equal(w.state.notInstalled, false)
  assert.equal(w.visible, false)
})

test("dvb not installed: the icon shows without a count, logs once, and the panel stays open", () => {
  const w = widget()
  assert.equal(w.apply(status.located(w.state, 1, "")).path, "")
  assert.equal(w.state.notInstalled, true)
  assert.equal(w.state.needsYou, 0)
  assert.equal(w.visible, true)
  w.opened = true
  for (let i = 0; i < 3; i++) {
    assert.equal(w.apply(status.located(w.state, 1, "")).path, "")
    assert.equal(w.opened, true)
    assert.equal(w.visible, true)
  }
  assert.deepEqual(w.logged, ["dvb not found on PATH; the widget offers Install dvb"])
  assert.deepEqual(status.activateArgv(w.state.items, null, true), status.installArgv())
  assert.deepEqual(status.activateArgv(w.state.items, { cockpit: true }, true), status.installArgv())
})

test("dvb installed later: the panel closes and the widget behaves as before", () => {
  const w = widget()
  w.count(1)
  w.refresh([question])
  w.apply(status.located(w.state, 0, ""))
  assert.equal(w.state.notInstalled, true)
  assert.deepEqual(w.state.items, [])
  w.opened = true
  assert.equal(w.apply(status.located(w.state, 0, "/usr/local/bin/dvb\n")).path, "/usr/local/bin/dvb")
  assert.equal(w.opened, false)
  assert.equal(w.state.notInstalled, false)
  assert.equal(w.visible, false)
  w.count(1)
  w.refresh([question])
  assert.equal(w.visible, true)
  assert.deepEqual(status.activateArgv(w.state.items, null, w.state.notInstalled), ["dvb", "app", "--route", "/decision/q1"])
})

test("Install dvb opens Omarchy's terminal running dvb's documented installer", () => {
  assert.deepEqual(status.INSTALL_STEPS, [
    "curl -fsSL https://github.com/broken-branch/dvb/releases/latest/download/install.sh -o install.sh",
    "sudo sh install.sh --engine --cockpit"
  ])
  assert.deepEqual(status.installArgv(), [
    "omarchy-launch-floating-terminal-with-presentation",
    '(cd "$(mktemp -d)" && set -x && ' +
      "curl -fsSL https://github.com/broken-branch/dvb/releases/latest/download/install.sh -o install.sh && " +
      "sudo sh install.sh --engine --cockpit)"
  ])
})

test("a failed list read closes a panel opened before any successful count", () => {
  const w = widget()
  w.opened = true
  w.fail()
  assert.equal(w.opened, false)
})

test("a count of 0 closes the panel; a count above 0 asks for the list", () => {
  const w = widget()
  assert.equal(w.count(2).readList, true)
  w.refresh([question, task1])
  w.opened = true
  assert.equal(w.count(0).readList, false)
  assert.equal(w.opened, false)
  assert.equal(w.visible, false)
})

for (const code of [1, 127, 0]) {
  test(`bar success alternating with list failure (${code}) stays hidden and logs once until recovery`, () => {
    const w = widget()
    for (let refresh = 0; refresh < 3; refresh++) {
      w.count(3)
      assert.equal(w.visible, false)
      w.fail(code)
      assert.equal(w.visible, false)
      assert.equal(w.logged.length, 1)
    }
    w.count(2)
    assert.equal(w.visible, false)
    w.refresh([question, task1])
    assert.equal(w.visible, true)
    assert.equal(w.state.needsYou, 2)
    assert.equal(w.state.lastLogged, "")
    w.count(2)
    w.fail(code)
    assert.equal(w.visible, false)
    assert.equal(w.logged.length, 2)
    w.count(2)
    w.fail(code)
    assert.equal(w.logged.length, 2)
  })

  test(`list failure (${code}) hides and closes the widget, keeps cached rows and logs once`, () => {
    const w = widget()
    w.count(3)
    w.refresh([question, task1, task2])
    const cached = w.state.items
    w.opened = true
    w.fail(code)
    w.fail(code)
    assert.equal(w.state.needsYou, 0)
    assert.equal(w.visible, false)
    assert.equal(w.opened, false)
    assert.equal(w.state.items, cached)
    assert.equal(w.logged.length, 1)
    w.refresh([task2])
    assert.equal(w.state.items[0].id, "t2")
    assert.equal(w.state.lastLogged, "")
  })
}

test("bar failure invalidates list visibility until both status reads recover", () => {
  const w = widget()
  w.count(1)
  w.refresh([question])
  assert.equal(w.visible, true)
  w.failCount()
  assert.equal(w.visible, false)
  w.count(1)
  assert.equal(w.visible, false)
  assert.equal(w.state.lastLogged, "failed")
  w.refresh([question])
  assert.equal(w.visible, true)
  assert.equal(w.state.lastLogged, "")
})

test("a vanished binary hides stale status and asks to discard its cached path", () => {
  const w = widget()
  w.count(1)
  w.refresh([question])
  w.opened = true
  assert.equal(w.failCount(127, "").missing, true)
  assert.equal(w.visible, false)
  assert.equal(w.opened, false)
  assert.equal(w.fail(127, "").missing, true)
  assert.deepEqual(w.logged, ["dvb not found on PATH; the widget offers Install dvb"])
  w.apply(status.located(w.state, 0, "/new/bin/dvb\n"))
  w.count(1)
  w.refresh([question])
  assert.equal(w.visible, true)
})

test("a stuck call the watchdog stops hides the widget, logs once, and the next poll recovers", () => {
  const w = widget()
  w.count(1)
  w.refresh([question])
  for (let poll = 0; poll < 3; poll++) {
    w.failCount(status.TIMED_OUT, "")
    assert.equal(w.visible, false)
  }
  assert.deepEqual(w.logged, ["dvb status did not finish in 15 s; stopped it"])
  assert.equal(w.count(1).readList, true)
  w.refresh([question])
  assert.equal(w.visible, true)
  w.failCount(status.TIMED_OUT, "")
  assert.equal(w.logged.length, 2)
})

test("keyboard selection follows the same item after removal, insertion and reorder", () => {
  let cursor = null
  cursor = status.moveCursor([question, task1, task2], cursor, 1)
  cursor = status.moveCursor([question, task1, task2], cursor, 1)
  assert.equal(status.cursorIndex([task1, task2], cursor), 0)
  const reordered = [task2, question, task1]
  assert.equal(status.cursorIndex(reordered, cursor), 2)
  assert.deepEqual(status.activateArgv(reordered, cursor), ["dvb", "app", "--route", "/task/t1"])
})

test("pointer selection shares the keyboard cursor's row and cockpit identities", () => {
  assert.deepEqual(status.cursorAt([question, task1], 1), { kind: "task", id: "t1" })
  assert.deepEqual(status.cursorAt([question, task1], 2), { cockpit: true })
  assert.deepEqual(status.cursorAt([], 0), { cockpit: true })
})

test("Open cockpit stays selected when rows are inserted or removed", () => {
  const cursor = status.moveCursor([task1], null, -1)
  assert.equal(status.cursorIndex([question, task1, task2], cursor), 3)
  assert.equal(status.cursorIndex([], cursor), 0)
  assert.deepEqual(status.activateArgv([], cursor), ["dvb", "app"])
})

test("the cursor stops at the first row and at Open cockpit", () => {
  const items = [question, task1]
  let cursor = status.moveCursor(items, null, 1)
  cursor = status.moveCursor(items, cursor, -1)
  assert.equal(status.cursorIndex(items, cursor), 0)
  for (let i = 0; i < 4; i++) cursor = status.moveCursor(items, cursor, 1)
  assert.equal(status.cursorIndex(items, cursor), 2)
})

test("removing the selected item leaves Enter inactive until deliberate navigation", () => {
  let cursor = status.moveCursor([question, task1, task2], null, 1)
  cursor = status.moveCursor([question, task1, task2], cursor, 1)
  const after = [question, task2]
  assert.equal(status.cursorIndex(after, cursor), -1)
  assert.equal(status.activateArgv(after, cursor), null)
  cursor = status.moveCursor(after, cursor, 1)
  assert.deepEqual(status.activateArgv(after, cursor), ["dvb", "app", "--route", "/decision/q1"])
})

test("selection distinguishes task and question ids; fresh Enter opens the first row", () => {
  const sameId = { ...question, id: "t1" }
  const cursor = status.moveCursor([task1, sameId], null, 1)
  assert.deepEqual(status.activateArgv([sameId, task1], cursor), ["dvb", "app", "--route", "/task/t1"])
  assert.deepEqual(status.activateArgv([question], null), ["dvb", "app", "--route", "/decision/q1"])
  assert.deepEqual(status.activateArgv([], null), ["dvb", "app"])
})
