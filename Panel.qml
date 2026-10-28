import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons as Commons
import qs.Ui
import "status.js" as Status

Panel {
  id: root
  moduleName: "io.github.broken-branch.dvb"
  ipcTarget: "io.github.broken-branch.dvb"
  manageIpc: false

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color urgent: bar ? bar.urgent : Commons.Color.urgent
  readonly property color barBackground: bar ? bar.background : Commons.Color.bar.background
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Commons.Style.font.family
  readonly property string glyph: "󰘬"

  readonly property int refreshIntervalSec: Commons.Util.clamp(Number(setting("refreshIntervalSec", 30)), 10, 600)

  // The absolute path of `dvb`, found once through a login shell so the
  // session's PATH applies; polls then run it directly, so nothing a shell
  // profile prints can reach the JSON.
  property string dvbPath: ""
  // The state status.js changes; initialState() there says what each holds.
  property int needsYou: 0
  property var items: []
  property bool listRead: false
  property string lastLogged: ""
  property string updatedAt: ""
  property bool listAgain: false
  property bool notInstalled: false

  property var cursor: null
  readonly property int cursorIndex: Status.cursorIndex(items, cursor)

  function state() {
    return {
      needsYou: needsYou, items: items, listRead: listRead, lastLogged: lastLogged,
      notInstalled: notInstalled
    }
  }

  // Writes back the state a status.js function returned, logs its lines and
  // closes an open panel when it asks to.
  function apply(result) {
    var s = result.state
    if (result.missing) dvbPath = ""
    if (items !== s.items) items = s.items
    listRead = s.listRead
    lastLogged = s.lastLogged
    needsYou = s.needsYou
    notInstalled = s.notInstalled
    for (var i = 0; i < result.log.length; i++) console.warn("dvb", result.log[i])
    if (result.close && opened) close()
  }

  function refreshNow() {
    if (dvbPath === "") locate.find()
    else barRead.run(dvbPath, ["status", "--bar"])
  }

  function readList() {
    if (dvbPath === "") return
    if (!listCommand.run(dvbPath, ["status", "--json"])) listAgain = true
  }

  function openItem(item) {
    root.close()
    Commons.Util.execArgv(Status.appArgv(item))
  }

  function openCockpit() {
    root.close()
    Commons.Util.execArgv(["dvb", "app"])
  }

  function installDvb() {
    root.close()
    Commons.Util.execArgv(Status.installArgv())
  }

  function selectCursor(index) {
    cursor = Status.cursorAt(items, index)
  }

  function moveCursor(dy) {
    cursor = Status.moveCursor(items, cursor, dy)
    Qt.callLater(keepCursorInView)
  }

  function activateCursor() {
    var argv = Status.activateArgv(items, cursor, notInstalled)
    if (argv === null) return
    root.close()
    Commons.Util.execArgv(argv)
  }

  function keepCursorInView() {
    if (cursorIndex < 0) return
    var target = cursorIndex === items.length ? actionButton : rows.itemAt(cursorIndex)
    if (!target || !panelFlick) return
    var y = target.mapToItem(column, 0, 0).y
    if (y < panelFlick.contentY) panelFlick.contentY = y
    else if (y + target.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = y + target.height - panelFlick.height
  }

  // No bar space unless dvb is not installed, or something waits and the list
  // has been read since the last failure.
  visible: Status.visible(state())
  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onItemsChanged: if (cursorIndex >= 0) Qt.callLater(keepCursorInView)
  onOpenedChanged: if (opened) {
    cursor = null
    if (panelFlick) panelFlick.contentY = 0
    readList()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  Timer {
    interval: root.refreshIntervalSec * 1000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshNow()
  }

  // Finds dvbPath. While dvb is missing, each refresh asks again, so the
  // widget behaves as installed once dvb is on PATH.
  Process {
    id: locate
    running: false
    command: ["bash", "-lc", "command -v dvb"]
    stdout: StdioCollector { id: locateOut; waitForEnd: true }

    function find() { if (!running) running = true }

    onExited: function(exitCode) {
      var result = Status.located(root.state(), exitCode, locateOut.text)
      root.apply(result)
      root.dvbPath = result.path
      if (root.dvbPath !== "") root.refreshNow()
    }
  }

  DvbCommand {
    id: barRead
    onDone: function(exitCode, out, err) {
      var result = Status.barDone(root.state(), exitCode, out, err)
      root.apply(result)
      if (result.readList) root.readList()
    }
  }

  DvbCommand {
    id: listCommand
    onDone: function(exitCode, out, err) {
      var result = Status.listDone(root.state(), exitCode, out, err)
      root.apply(result)
      if (result.state.listRead) root.updatedAt = Qt.formatTime(new Date(), "hh:mm")
      if (root.listAgain) {
        root.listAgain = false
        root.readList()
      }
    }
  }

  IpcHandler {
    target: root.ipcTarget
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
    function toggle(): void { root.toggle() }
    function refresh(): string { root.refreshNow(); return "ok" }
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: root.notInstalled ? "dvb is not installed" : "dvb: " + root.needsYou + " need you"
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton && !root.notInstalled) Commons.Util.execArgv(["dvb", "app"])
      else if (buttonCode === Qt.MiddleButton) root.refreshNow()
      else root.toggle()
    }

    // The glyph stays in the bar's foreground, as the badge carries the
    // alert; the count badge sits on the glyph canvas's top-right corner and
    // is left out while dvb is not installed.
    iconComponent: Component {
      Item {
        OpticalGlyph {
          anchors.fill: parent
          text: root.glyph
          fontFamily: root.fontFamily
          fontSize: button.fontSize
          color: button.foreground
        }

        BorderSurface {
          id: badge
          visible: !root.notInstalled
          // Overlaps the canvas by a third of its width and height.
          anchors.left: parent.right
          anchors.leftMargin: -width / 3
          anchors.bottom: parent.top
          anchors.bottomMargin: -height / 3
          height: Math.max(Commons.Style.space(9), Math.round(parent.height * 0.6))
          width: Math.max(height, badgeText.implicitWidth + Commons.Style.spacing.xs * 2)
          radius: height / 2
          color: root.urgent
          borderSpec: Commons.Border.flat(root.barBackground, 1)

          Text {
            id: badgeText
            anchors.centerIn: parent
            textFormat: Text.PlainText
            text: Status.badgeText(root.needsYou)
            color: Commons.Color.background
            font.family: root.fontFamily
            font.pixelSize: Math.max(6, Math.round(badge.height * 0.72))
            font.bold: true
          }
        }
      }
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Commons.Style.space(380))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Commons.Style.space(640))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent

      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) { if (t === "r" || t === "R") root.refreshNow() }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: panelFlick.width
          spacing: Commons.Style.space(12)

          PanelHero {
            width: parent.width
            title: "dvb"
            meta: root.notInstalled ? "Not installed" : root.needsYou + " need you"
            foreground: root.foreground
            fontFamily: root.fontFamily

            iconComponent: Component {
              Text {
                textFormat: Text.PlainText
                text: root.glyph
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Commons.Style.font.display
              }
            }
          }

          PanelSeparator { foreground: root.foreground }

          Text {
            visible: root.notInstalled
            width: parent.width
            textFormat: Text.PlainText
            text: "dvb is not on your PATH. Install dvb opens a terminal that downloads dvb's installer and runs it with sudo, which asks for your password:"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Commons.Style.font.bodySmall
            wrapMode: Text.Wrap
          }

          Text {
            visible: root.notInstalled
            width: parent.width
            textFormat: Text.PlainText
            text: Status.INSTALL_STEPS.join("\n")
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Commons.Style.font.caption
            wrapMode: Text.WrapAnywhere
          }

          Column {
            visible: !root.notInstalled
            width: parent.width
            spacing: Commons.Style.spacing.xxs

            PanelSectionHeader {
              width: parent.width
              text: "WAITING"
              foreground: root.foreground
              fontFamily: root.fontFamily
            }

            Repeater {
              id: rows
              model: root.items

              WaitingRow {
                required property var modelData
                required property int index
                width: parent.width
                item: modelData
                hasCursor: root.cursorIndex === index
                onHoveredRow: root.selectCursor(index)
                onClicked: root.openItem(modelData)
              }
            }

            Text {
              visible: root.listRead && root.items.length === 0
              width: parent.width
              textFormat: Text.PlainText
              text: "Nothing waiting now."
              color: root.dim
              font.family: root.fontFamily
              font.pixelSize: Commons.Style.font.caption
            }
          }

          PanelSeparator { foreground: root.foreground }

          // "Open cockpit", or "Install dvb" while dvb is not installed.
          Button {
            id: actionButton
            width: parent.width
            bordered: true
            iconText: root.notInstalled ? "󰇚" : "󰏌"
            text: root.notInstalled ? "Install dvb" : "Open cockpit"
            hasCursor: root.cursorIndex === root.items.length
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Commons.Style.font.bodySmall
            verticalPadding: Commons.Style.spacing.controlPaddingY
            onClicked: root.notInstalled ? root.installDvb() : root.openCockpit()
            onHovered: function(isHovered) { if (isHovered) root.selectCursor(root.items.length) }
          }

          Text {
            visible: root.updatedAt !== "" && !root.notInstalled
            width: parent.width
            textFormat: Text.PlainText
            text: "Updated " + root.updatedAt
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Commons.Style.font.caption
            horizontalAlignment: Text.AlignHCenter
            elide: Text.ElideRight
          }
        }
      }
    }
  }

  // A waiting item: title and kind on the first line, project on the second.
  component WaitingRow: CursorSurface {
    id: row
    property var item: null
    readonly property var label: item ? Status.kindLabel(item) : ({ text: "", urgent: false })
    signal hoveredRow()
    signal clicked()

    foreground: root.foreground
    implicitHeight: rowLines.implicitHeight + Commons.Style.spacing.md * 2

    Column {
      id: rowLines
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Commons.Style.spacing.rowPaddingX
      anchors.rightMargin: Commons.Style.spacing.rowPaddingX

      Item {
        width: parent.width
        implicitHeight: Math.max(rowTitle.implicitHeight, rowKind.implicitHeight)

        Text {
          id: rowTitle
          textFormat: Text.PlainText
          text: row.item ? row.item.title : ""
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Commons.Style.font.body
          elide: Text.ElideRight
          anchors.left: parent.left
          anchors.right: rowKind.left
          anchors.rightMargin: Commons.Style.spacing.lg
          anchors.verticalCenter: parent.verticalCenter
        }

        Text {
          id: rowKind
          textFormat: Text.PlainText
          text: row.label.text
          color: row.label.urgent ? root.urgent : root.dim
          font.family: root.fontFamily
          font.pixelSize: Commons.Style.font.caption
          font.bold: true
          font.letterSpacing: 1.2
          anchors.right: parent.right
          anchors.verticalCenter: parent.verticalCenter
        }
      }

      Text {
        width: parent.width
        textFormat: Text.PlainText
        text: row.item ? Status.projectLabel(row.item) : ""
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Commons.Style.font.caption
        elide: Text.ElideRight
      }
    }

    MouseArea {
      id: rowMouse
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onContainsMouseChanged: if (containsMouse) row.hoveredRow()
      onClicked: row.clicked()
    }

    PanelToolTip {
      visible: rowMouse.containsMouse && !!row.item && row.item.reason !== ""
      text: row.item ? row.item.reason : ""
      fontFamily: root.fontFamily
    }
  }
}
