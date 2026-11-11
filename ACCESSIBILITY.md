# Accessibility

MyFinances is a tool for managing your own money, and it should work for everyone
who manages theirs. This page states what we aim for, how we check it, what we
know still falls short, and how to tell us about a barrier.

## Our commitment

We aim to meet **[WCAG 2.1](https://www.w3.org/TR/WCAG21/) Level AA** across the
whole app (every page, modal and sign-in screen) and the user guide (`guide.html`).
A change that introduces a new barrier is treated as a bug.

## How we check

Most of these checks run in CI on every pull request, so a regression fails the
build instead of reaching a release.

| Check | What it covers |
|---|---|
| `tests/a11y/` | Site-wide audit of every page, in light and dark themes |
| `tests/ui/test_accessibility.py` | Landmarks, headings, labels, keyboard access, focus handling |
| `tests/ui/test_aria_labels.py` | Every button, tab and toggle has an accessible name and state |
| `tests/ui/test_contrast_fixes.py` | Rendered text contrast, measured from computed styles |
| `tests/ui/test_chart_accessibility.py` | Every chart has a screen-reader data table |
| `tests/ui/test_mobile_no_card_clipping.py` | Content reflows on a 390 px phone without being cut off |

On top of the automated checks, we run a periodic manual audit with axe-core,
keyboard walks and the Chrome accessibility tree. The reports are in
[docs/audit/a11y/](docs/audit/a11y/).

## What the app supports

- **Keyboard:** every action works from the keyboard, with a skip link, visible
  focus, a command palette (Ctrl/Cmd+K) and a keyboard-shortcuts panel.
- **Screen readers:** names, roles and states on controls, live regions for
  errors and status, and a data-table equivalent for every chart.
- **Themes:** light, dark and high contrast.
- **Motion:** `prefers-reduced-motion` turns off chart and CSS animation.
- **Zoom and small screens:** layouts reflow down to 320 px wide.
- **Language:** English, Spanish and Polish, with `<html lang>` kept in step
  with the chosen language.

## Supported environments

| Environment | Status |
|---|---|
| Current Chromium-based browsers (Chrome, Edge) on desktop and Android | Tested in CI |
| Current Firefox and Safari (desktop and iOS) | Expected to work; not tested automatically |
| Screen readers (NVDA, JAWS, VoiceOver, TalkBack) | Supported by design; not yet tested by hand, so reports are especially welcome |

## Known limitations

These are open and tracked. The
[`accessibility` label](https://github.com/jasonkryst/MyFinances/labels/accessibility)
always has the current list.

- **Focus containment:** the full-screen sign-in and "Can't reach your server"
  screens, the legacy-data modal and the Settings modal don't yet keep Tab
  inside themselves (#464, #495).
- **Focus after closing:** focus isn't returned to the right place after a
  mid-session sign-in or after dismissing the save-error banner (#491, #492).
- **Account menu:** it uses menu roles without arrow-key navigation (#494).
- **Error messages:** some aren't linked to their fields or are announced twice
  (#499, #502, #503).
- **Names:** some accessible names don't contain the visible label (#496, #501).
- **Small target:** the save-error banner's dismiss button is 19 px (#493).
- **Untranslated text:** parts of the global chrome, such as the account menu
  and the command palette, are still English only (#498, #505, #517).

## Report a barrier

If something in MyFinances is hard or impossible to use with your setup, please
tell us. You don't need to know which WCAG rule it breaks.

- **[Report an accessibility barrier](https://github.com/jasonkryst/MyFinances/issues/new?template=accessibility.yml)**
  using the issue form. It asks what you were trying to do, what got in the way,
  and which browser and assistive technology you use.
- If you'd rather not post publicly, email **jasonkryst+github@gmail.com**.

Barriers that block a task entirely are treated as high priority.
