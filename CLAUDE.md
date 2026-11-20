# Working in this repo

One-page event site. Plain HTML, CSS, vanilla JS. No framework, no build step. Deploys to GitHub Pages from `main`, root.

## The event
Lights Up '28, the customer conference of Tarnell (fictional ops software company). Free for Tarnell customers. Idea: customers run the show. Every main-stage keynote is a customer, and the visitor calls the cues on the keynote wall.
- Tue Apr 11 to Wed Apr 12, 2028. Time zone America/Guayaquil, labelled "ECT". Doors 8:00 AM both days.
- Nave Carolina (fictional), Iñaquito, Quito, Ecuador. No street address.
- Date and place line, used everywhere: "Apr 11-12, 2028 · Nave Carolina, Quito" (`meta.dateLine`).
- Everything is fictional except the Getting there facts (Metro, payment, airport, altitude), which are verified. Add no other transit facts, times or fares.
- No prices or "$" anywhere. No countdown, "today" logic or past-event state. Keep Spanish place names exactly, accents included.

## Where things live
- `data/event.json` - all content. Change copy here, not in the markup.
  - `meta` - name, host (`Tarnell`, the header and footer wordmark), timezone, `tzLabel` ("ECT"), `dateLine`, page title, description, `icsStamp` (fixed DTSTAMP for .ics files).
  - `sections` sets order and on/off for every section. Nav and footer follow it. Sponsors is off. The matrix section's nav label is "Access".
  - `header.cta` - the Register button in the bar.
  - `wall` - keynote wall strings: label ("LIGHTS UP"), caption, GO text, live/standby words, link and save labels.
  - `hero` - the band under the wall: event name, one line, Register button.
  - `tracks` are the rooms and drive schedule colors (track-1 Main Stage, track-2 The Booth, track-3 Lab, in the order listed). Sessions with `"track": null` are whole-venue items (doors, lunch, evening) and get the neutral style.
  - Schedule sessions carry `tiers` (registration type ids), which the matrix computed row and calendar downloads use. A session with `"cue": "Q1"` .. `"Q6"` is a main-stage keynote: it goes on the wall in cue order and renders as a full color block in the agenda. Only those six carry a cue.
  - `speakers.items` - name, role, company, photo (bare images.unsplash.com URL; `img()` in app.js adds size params). Speakers whose session has a `cue` render as the keynote cue sheet (6 even cards in cue order, Q number on each, photos duotoned ink to host). The rest render as a smaller row of The Booth cards (duotoned ink to booth). Each card has one "See in agenda" link to the speaker's first session. No featured card.
  - Current speakers: Q1 Elena Vásquez, Q2 Arjun Mehta, Q3 Adaeze Nwosu, Q4 Lars Ekholm, Q5 Siobhan Kerr, Q6 Callum Reid; The Booth: Lucía Vera, Andrés Saltos, Greta Vogel, Daniel Cho. Do not reuse names or photos from Justin's other sites (list in the Prompt B brief); look at every new photo before using it.
  - `tickets` - the three registration types (`customer`, `lab`, `team`) and matrix rows. Rows with `from` (`day:<id>`, `track:<id>`, `session:<id>`) build their preview from the schedule. Rows without `from` show `detail`. `footnote` sits under the matrix.
  - `schedule.liveTag` - the "LIVE" tag on the session lit by "See in agenda".
  - `venue.feature` - the recommended option (Tarnell shuttle) as one big block; `items` - the verified facts.
  - `registration` - form labels, team size range, walk-up `card` strings, `shotDefaults` for `?shot=1&n=`.
  - `[PLACEHOLDER]` in any string shows a visible Placeholder tag. There are none now; keep it that way.
- `styles.css` - design tokens at the top of `:root`. Change tokens first, then section styles.
  - Direction: "calling the show in daylight". Colors, one meaning each: `--host` #1B3BFF (the wall, Main Stage, keynote speakers, the selected registration type, the Register section), `--on-host` white, `--host-tint` (the big cue numeral only), `--paper` (page), `--ink` (text, Register buttons, dark blocks), `--booth` (The Booth, matrix preview), `--lab` (the Lab), `--standby` red (standby lamp only), `--go` green (GO lamp only). Red and green appear nowhere else: errors are ink with a "!" icon and bold text.
  - Fonts: Anybody 800 (display, variable width; wall names at wdth 110, narrowed in JS by `fitName` to stay on one line, never shrunk), Atkinson Hyperlegible 400/700 (body), DM Mono 500 (cue labels, times, Q numbers). No other fonts.
  - Duotone = grayscale photo multiplied onto a color, with an ink layer screened on top (`.duo`, `.stage-photo`).
- `app.js` - one renderer per section in the `R` object. To add a section: add a renderer `R.<id>`, then add `{ "id": "<id>", "label": "...", "on": true }` to `sections`.
- `#hero-moment` in `index.html` holds the keynote wall. `#hero` holds the band under it.

## Built-in features (keep them working)
- Keynote wall: loads on Q1 with photo, name and title, never empty, never auto-advances. GO cuts to the next cue (Q6 wraps to Q1), cue buttons cut straight to a cue. Hard cuts only: no fade, no slide. All six photos sit in the DOM, eager, so a cut never shows a blank. `aria-live` announces "Q3. Adaeze Nwosu. Load-in, load-out, 212 times a year." GO's label names the next cue. Cue strip: called cues at 45% opacity, the live cue solid white, the next cue "STBY" with a red lamp. The live cue number sits huge behind the name in `--host-tint`, cut off by the floor line, and changes with the cut. On phones (under 720px) the photo is a block at the top right and the text has its own area: text never sits on a face.
- Shared stage component (`stageCopy`, `.stage`): the wall and the walk-up card use the same markup and name style.
- "See in agenda" (wall and speaker cards, via `goToSession`): switches the day tab, scrolls the session under the sticky header, lights only that session (clears any other) and moves focus to it.
- Speakers: keynote cue sheet of 6 plus a Booth row of 4, even cards. Speaker names in the agenda (with 32px photos) link back to cards.
- Schedule day tabs (arrow keys work), room colors, keynote blocks, "show my time" toggle (Intl API), per-day .ics download. Times always carry a zone label (ECT in event time).
- Registration type matrix (Access): pick a column to choose a type (the selected column turns solid host), hover or focus a row for a side preview on desktop (on booth, not sticky), tap a row to open it inline on phones. No sideways scroll on phones. Synced both ways with the form's type select.
- Demo registration: first, last, work email, company, type, team size (only for Bring your team). Errors next to fields, the first one scrolled into view. A valid submit cuts in the WALK-UP title card, with "Demo only. Nothing was sent." Nothing is sent anywhere.
- Save card: exports the walk-up card or the current wall cue as a 1200x630 PNG via canvas, in the wall's look (ink-to-host duotone done per pixel, cue numeral, Anybody, DM Mono; needs the Unsplash CORS header).
- Skip link, visible focus, motion tiers (see Motion).

## URL switches
- `?shot=1` - set up for a still without changing layout: wall on Q1 (`&q=3` puts Q3 live, Q4 on standby), every transition and animation off, every image eager, header static, no hover or focus styling, no "show my time" toggle (event zone only), page hidden until fonts load, then `<html data-shot-ready="1">` once fonts and images are done.
- `?shot=1&n=Full%20Name` - registration renders already confirmed: walk-up card for that name, type Customer, company Northline Transit.
- `?n=Full%20Name` (no shot) - prefills first and last name (split on the last space). Does not submit.
- `?motion=full` - full version of every effect, whatever the reduced-motion setting. `index.html` sets `data-motion="full"` and `data-shot="1"` on `<html>` before first paint; `app.js` reads `MOTION_FULL` and `SHOT`.

## Motion
Every motion effect has exactly one tier. Add new effects to the list below with their tier.
- Tier 1: plays for everyone, including under `prefers-reduced-motion`. Plays once, finishes in under 5 seconds, never flashes (no more than one fade in and out, nothing blinking). Needs no reduced-motion rule.
- Tier 2: full version by default. A softer version (instant, a fade instead of a move, or shorter) under `prefers-reduced-motion: reduce`. Write the soft rule inside the reduced-motion block in `styles.css`, scoped to `:root:not([data-motion="full"])`. In JS, check `matchMedia("(prefers-reduced-motion: reduce)")` and `MOTION_FULL` (helper: `smoothOK()`).
- Tier 3: sustained or looping. Runs for everyone, with a visible on/off toggle (a button with `aria-pressed`) next to the effect. Save the choice in localStorage under `motion:<effect-id>`, every read and write in try/catch, and default to on when storage fails.
- `?motion=full` in the URL forces the full version of every effect: tier 2 ignores reduced motion, tier 3 starts on whatever the saved toggle says (without overwriting it).
- Nothing flashes more than 3 times a second. `?shot=1` turns every effect off.

Current effects:
- Smooth scrolling for nav links, "See in agenda" links, speaker links, the jump to the walk-up card and to the first form error, and hash links on load - tier 2 (instant jump under reduced motion).
- GO lamp: on press the ring lights solid `--go` and fades back over 400ms. At most one flash every 340ms (never more than 3 a second) - tier 1.
- Button hover: color fade and arrow nudge, 120ms - tier 1.
- Tier 3: none. This site should have none.

Instant state changes (wall cuts, cue button states, the cue numeral, name width fitting, the lit session's ink outline and LIVE tag, the walk-up card cutting in, button press offset, plus/cross icon rotation in the matrix and FAQ) are not motion and need no tier.

## Rules
- No em dashes anywhere, in code comments or copy. Use a hyphen.
- Left-align text. No eyebrow labels over headings. No decorative numbering. No gradients. No drop shadows at rest.
- Every color means one thing (see the token list). Keep at least one big field of color or one large object per section, and vary section layouts so no two in a row share a template.
- Header bar 64px desktop, 56px phone. Wall about 1440x500 at 1440x800 and 393x380 at 393x852. Date, place and Register stay in the first screen at both.
- No run of more than 8 agenda rows that look the same. No sticky column.
- Check 360, 393, 768, 1280 and 1440 px wide: no sideways scroll, no clipped headings.
- Commit and push after every finished change.
