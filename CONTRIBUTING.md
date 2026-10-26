# Contributing

Bug reports and ideas are welcome as
[issues](https://github.com/broken-branch/omarchy-dvb/issues).

This repository is a copy of the widget's folder in dvb's development
repository. The maintainers read pull requests from outside contributors and,
if they want the change, re-make it there; outside pull requests are not merged
as they are.

Run `./check` before you send a change. Report security problems privately, as
[SECURITY.md](SECURITY.md) describes.

## Check

`./check` checks required files and the manifest's keys and types, runs
`omarchy plugin validate` when Omarchy is installed, runs `qmllint` as a QML
syntax check when Qt's tools are installed (Omarchy's own modules only resolve
inside the shell, so it cannot check types) and runs the unit tests
(`node --test`). When Quickshell is
installed, it also tests process completion and recovery offscreen. It needs
`jq` and Node.js.
