# dvb for the Omarchy bar

A bar widget for [Omarchy](https://omarchy.org) that shows when
[dvb](https://github.com/broken-branch/dvb#readme) needs you.

![An Omarchy-style desktop in Tokyo Night: the bar's dvb icon with a badge of 3, the widget's panel open on the same three waiting items, and the dvb cockpit's Now screen showing 3 need you](preview.png)

*Rendered from dvb's demo data, not a screenshot of a real desktop: the bar and
panel are drawn to match the widget, and the cockpit is dvb's own app. On your
machine the colours and sizes follow your Omarchy theme.*

## What it shows

- **One bar icon with a count badge**, only while something waits for you: a
  plan to approve or an open question, or a failed or stopped task (dvb's
  "need you" count). When nothing waits, the icon takes no space in the bar.
- **A panel** (left click) listing each waiting item: the question's subject
  or the task's title, its kind (`QUESTION`, `FAILED` or `STOPPED`) and the
  project. Hover a failed task to read why it failed.
- **An "Install dvb" action while dvb is not installed**: the icon shows
  without a badge, and its panel lists the installer's commands and offers
  **Install dvb** (see [Install](#install)).
- **Clicks open dvb's cockpit**: an item opens its page with
  `dvb app --route`, and "Open cockpit" (or a right click on the icon) runs
  `dvb app`. A middle click, or `r` in the panel, refreshes now.

It reads `dvb status --bar` for the count and `dvb status --json` for the list,
every 30 seconds by default (set **Refresh interval** in the widget's settings,
10 to 600 seconds). When dvb's engine is not reachable or a call does not
finish within 15 seconds, the widget stays hidden and writes one line to the
shell log.

## Install

```sh
omarchy plugin add https://github.com/broken-branch/omarchy-dvb --enable
```

Plugins are added disabled; `--enable` turns this one on and puts the widget
in the bar's right section. If you added it without `--enable`, run
`omarchy plugin enable io.github.broken-branch.dvb`. To put it somewhere else
in the bar, use `omarchy bar move`, for example
`omarchy bar move io.github.broken-branch.dvb --section left`.

If `dvb` is not on your `PATH` yet, the bar shows the dvb icon without a
badge. Click it and choose **Install dvb**: a terminal opens and runs dvb's
installer as its [README](https://github.com/broken-branch/dvb#readme)
describes, showing each command before it runs:

```sh
curl -fsSL https://github.com/broken-branch/dvb/releases/latest/download/install.sh -o install.sh
sudo sh install.sh --engine --cockpit
```

Continue with the README's next steps from there. Once `dvb` is on your
`PATH`, the widget shows only when dvb needs you. If you install dvb yourself
first, the widget never offers Install dvb.

The Install dvb action runs dvb's installer in a terminal, which asks for your
password through `sudo`; the widget itself runs nothing else with privileges.

## Remove

```sh
omarchy plugin remove io.github.broken-branch.dvb
```

## License

[MIT](LICENSE)
