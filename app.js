/* Event kit - renders every section from data/event.json. Vanilla JS, no build step.
   Sections render in the order listed in data.sections; set "on": false to hide one. */
(function () {
  "use strict";

  var D = null;              // event data
  var Q = new URLSearchParams(location.search);
  // ?motion=full forces the full version of every motion effect (see Motion in CLAUDE.md).
  var MOTION_FULL = Q.get("motion") === "full";
  // ?shot=1 sets the page up for a still (see URL switches in CLAUDE.md).
  var SHOT = Q.get("shot") === "1";
  var NAME_PARAM = (Q.get("n") || "").trim();
  var root = document.documentElement;
  if (MOTION_FULL) root.setAttribute("data-motion", "full");
  if (SHOT) root.setAttribute("data-shot", "1");
  var REDUCED = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  function smoothOK() { return !SHOT && (MOTION_FULL || !REDUCED.matches); }
  var state = { tzMode: "event", tier: null, cue: 0 };
  var USER_TZ = (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { return ""; } })();
  var CUES = [];             // keynotes in cue order, built from the schedule

  // ---------- helpers ----------
  function esc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // [PLACEHOLDER] markers get a visible tag so draft copy is obvious on the page.
  function copy(v) { return esc(v).replace(/\[PLACEHOLDER\]\s?/g, '<span class="ph">Placeholder</span> '); }
  function $(id) { return document.getElementById(id); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function trackIndex(id) { for (var i = 0; i < D.tracks.length; i++) if (D.tracks[i].id === id) return i + 1; return 0; }
  function splitName(full) {
    var s = String(full || "").trim().replace(/\s+/g, " "), i = s.lastIndexOf(" ");
    return i < 0 ? { first: s, last: "" } : { first: s.slice(0, i), last: s.slice(i + 1) };
  }
  // Unsplash sizing: photos are stored as bare URLs in the data and sized here.
  // facearea + crop=faces centers the face in every crop; facepad sets how much head and shoulders show.
  function img(url, w, h, pad) {
    return url ? url + "?w=" + w + "&h=" + h + "&fit=facearea&facepad=" + (pad || 2.6) + "&crop=faces&auto=format&q=70" : "";
  }
  // Wall photos: a little more zoomed out than the cards, so the CSS framing has headroom to work with.
  var WALL_W = 760, WALL_H = 900, EYE = 0.465, EYE_AT = 0.38;
  function wallPhoto(url) { return img(url, WALL_W, WALL_H, 4.6); }
  // Box for a wall photo inside a W x H frame: eyes at 38% of the frame, frame fully covered.
  function wallFrame(W, H) {
    var ar = WALL_H / WALL_W;
    var ih = Math.max(W * ar, (EYE_AT * H) / EYE, ((1 - EYE_AT) * H) / (1 - EYE));
    var iw = ih / ar;
    return { w: iw, h: ih, x: (W - iw) / 2, y: EYE_AT * H - EYE * ih };
  }
  function frameWallPhotos() {
    var box = document.querySelector("#wall .stage-photo");
    if (!box) return;
    var f = wallFrame(box.clientWidth, box.clientHeight);
    Array.prototype.forEach.call(box.querySelectorAll("img.wall-shot"), function (im) {
      im.style.width = f.w + "px"; im.style.height = f.h + "px"; im.style.left = f.x + "px"; im.style.top = f.y + "px";
    });
  }
  function imgLoading(eager) { return SHOT || eager ? "eager" : "lazy"; }

  // ---------- time zones ----------
  function tzOffsetMs(date, tz) {
    var p = {};
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date).forEach(function (x) { p[x.type] = x.value; });
    var asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(date.getTime() / 1000) * 1000;
  }
  // "2028-04-11" + "09:00" in the event time zone -> a real Date.
  function zoned(dateStr, timeStr) {
    var d = dateStr.split("-"), t = timeStr.split(":");
    var guess = Date.UTC(+d[0], +d[1] - 1, +d[2], +t[0], +t[1]);
    var off = tzOffsetMs(new Date(guess), D.meta.timezone);
    var res = guess - off;
    var off2 = tzOffsetMs(new Date(res), D.meta.timezone);
    if (off2 !== off) res = guess - off2;
    return new Date(res);
  }
  function viewTz() { return state.tzMode === "local" && USER_TZ ? USER_TZ : D.meta.timezone; }
  function fmtTime(date, tz) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz || viewTz() });
  }
  function tzShort(tz, date) {
    if (tz === D.meta.timezone && D.meta.tzLabel) return D.meta.tzLabel;
    try {
      var part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(date)
        .filter(function (x) { return x.type === "timeZoneName"; })[0];
      return part ? part.value : tz;
    } catch (e) { return tz; }
  }
  function sessionTimes(day, s) {
    var a = zoned(day.date, s.start), b = zoned(day.date, s.end);
    // "9:00 - 9:40 AM ECT" when both ends share AM/PM, so every agenda row fits on one line.
    var fa = fmtTime(a), fb = fmtTime(b), ma = fa.slice(-2), mb = fb.slice(-2);
    var label = (ma === mb ? fa.slice(0, -3) : fa) + " - " + fb + " " + tzShort(viewTz(), a);
    return { start: a, end: b, label: label };
  }

  // ---------- calendar (.ics) ----------
  function icsStamp(d) { return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, ""); }
  function icsText(v) { return String(v || "").replace(/\[PLACEHOLDER\]\s?/g, "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  function downloadIcs(days, filename) {
    var loc = [D.meta.venue, D.meta.city].filter(Boolean).join(", ");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Event Kit//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        var t = sessionTimes(day, s), tr = s.track ? byId(D.tracks, s.track) : null;
        lines.push("BEGIN:VEVENT", "UID:" + s.id + "-" + D.meta.year + "@event-kit", "DTSTAMP:" + D.meta.icsStamp,
          "DTSTART:" + icsStamp(t.start), "DTEND:" + icsStamp(t.end), "SUMMARY:" + icsText(D.meta.name + ": " + s.title),
          "DESCRIPTION:" + icsText(s.detail), "LOCATION:" + icsText((tr ? tr.name + ", " : "") + loc), "END:VEVENT");
      });
    });
    lines.push("END:VCALENDAR");
    saveBlob(new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }), filename);
  }
  function saveBlob(blob, filename) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ---------- shared bits ----------
  function sectionShell(id, title, inner, extraClass) {
    return '<section class="section sec-' + id + (extraClass ? " " + extraClass : "") + '" id="' + id + '" aria-labelledby="' + id + '-title">' +
      '<div class="wrap"><h2 class="section-title" id="' + id + '-title">' + copy(title) + "</h2>" + inner + "</div></section>";
  }
  function initials(name) { return name.split(/\s+/).map(function (w) { return w.charAt(0); }).join("").slice(0, 2).toUpperCase(); }
  function speakerSessions() {
    var map = {};
    D.schedule.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        (s.speakers || []).forEach(function (sp) { (map[sp] = map[sp] || []).push({ day: day, s: s }); });
      });
    });
    return map;
  }
  function buildCues() {
    CUES = [];
    D.schedule.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        if (s.cue) CUES.push({ cue: s.cue, day: day, s: s, sp: byId(D.speakers.items, (s.speakers || [])[0]) });
      });
    });
    CUES.sort(function (a, b) { return parseInt(a.cue.slice(1), 10) - parseInt(b.cue.slice(1), 10); });
  }
  function cueLine(c) {
    var t = zoned(c.day.date, c.s.start), tr = byId(D.tracks, c.s.track);
    return c.cue + " · " + c.day.short + " " + fmtTime(t, D.meta.timezone) + " " + D.meta.tzLabel + (tr ? " · " + tr.name : "");
  }

  // ---------- stage: the wall and the walk-up card share this ----------
  function nameHtml(full) {
    var n = splitName(full);
    return '<span class="nm">' + esc(n.first) + "</span>" + (n.last ? ' <span class="nm">' + esc(n.last) + "</span>" : "");
  }
  // A flat standing figure for scale. Plain shapes, filled with the wall's text color.
  var FIGURE = '<svg class="stage-figure" viewBox="0 0 20 56" aria-hidden="true" focusable="false">' +
    '<circle cx="10" cy="5" r="4.5"/><path d="M5 12h10l1.5 20h-3L13 54H10.8L10 36l-.8 18H7l-.5-22h-3z"/></svg>';
  function stageCopy(o) {
    return '<p class="stage-label">' + esc(o.label) + "</p>" +
      '<p class="stage-name"' + (o.nameId ? ' id="' + o.nameId + '"' : "") + ">" + nameHtml(o.name) + "</p>" +
      '<p class="stage-title"' + (o.titleId ? ' id="' + o.titleId + '"' : "") + ">" + esc(o.title) + "</p>" +
      '<p class="stage-cue"><span' + (o.cueId ? ' id="' + o.cueId + '"' : "") + ">" + esc(o.cue) + "</span>" + (o.after || "") + "</p>";
  }

  // ---------- hero: the keynote wall + band ----------
  function renderHero() {
    var h = D.hero, m = D.meta, w = D.wall;
    var c = CUES[state.cue];
    var photos = CUES.map(function (x, i) {
      // All six photos are in the DOM and loaded eagerly, so a cut never shows a blank.
      return '<img src="' + esc(wallPhoto(x.sp.photo)) + '" alt="" class="wall-shot" width="760" height="900" loading="eager" decoding="sync" data-cue="' + i + '"' + (i === state.cue ? "" : " hidden") + ">";
    }).join("");
    var strip = CUES.map(function (x, i) {
      return '<li><button type="button" class="cue-btn" data-cue="' + i + '"><span class="cue-q">' + esc(x.cue) + '</span><span class="cue-state" aria-hidden="true"></span></button></li>';
    }).join("");
    $("hero-moment").innerHTML =
      '<div class="stage wall" id="wall" role="region" aria-label="Keynote wall">' +
        '<div class="stage-body">' +
          '<p class="stage-numeral" id="wall-numeral" aria-hidden="true">' + esc(c.cue) + "</p>" +
          '<div class="stage-copy">' + stageCopy({ label: w.label, name: c.sp.name, title: c.s.title, cue: cueLine(c),
            nameId: "wall-name", titleId: "wall-title", cueId: "wall-cue",
            after: ' <a class="stage-link" id="wall-link" href="#session-' + esc(c.s.id) + '">' + esc(w.agendaLink) + "</a>" }) + "</div>" +
          '<div class="stage-photo" aria-hidden="true">' + photos + '<span class="scanline" hidden></span></div>' +
          '<div class="queue" id="queue" aria-hidden="true">' + CUES.map(function (x, k) { return queueFigure(k); }).join("") + "</div>" +
        "</div>" +
        '<div class="stage-floor" aria-hidden="true"></div>' +
        '<div class="wall-controls">' +
          '<ol class="cue-strip" aria-label="Cues">' + strip + "</ol>" +
          '<button type="button" class="go-btn" id="go-btn"><span class="go-ring" aria-hidden="true"></span><span class="go-text">' + esc(w.goText) + "</span></button>" +
          '<p class="wall-caption">' + esc(w.caption) + "</p>" +
        "</div>" +
        '<p class="sr" aria-live="polite" id="wall-live"></p>' +
      "</div>";
    $("hero").innerHTML =
      '<div class="band">' +
        '<div class="band-text"><h1 id="hero-title">' + esc(h.title) + "</h1>" +
        '<p class="band-when">' + esc(m.dateLine) + "</p>" +
        '<p class="band-sub">' + copy(h.sub) + "</p></div>" +
        '<a class="btn btn-primary band-cta" href="' + esc(h.cta.href) + '">' + esc(h.cta.label) + ' <span class="arrow" aria-hidden="true">&rarr;</span></a>' +
      "</div>";
    cutTo(state.cue, false);
  }

  // ---------- the queue: one flat figure per keynote, waiting on the floor line ----------
  // Same shapes as the standing figure, each a little different so they read as people.
  // They face the photo (right). Accessory lines are cut out in the wall color.
  var FIG_VARIANTS = [
    { h: 58, extra: "" },
    { h: 62, extra: '<path class="cut" d="M17 15L8 33"/><rect x="2" y="31" width="6" height="7" rx="1"/>' },                 // bag strap
    { h: 53, extra: '<path class="cut" d="M8.5 14l3.5 9 3.5-9"/><rect class="cutfill" x="10" y="23" width="4" height="5"/>' }, // lanyard
    { h: 57, extra: '<path d="M17 17l6 6-1.6 1.4L16 19z"/><rect x="20.5" y="19.5" width="5" height="6" rx="1"/>' },           // coffee
    { h: 55, extra: '<circle cx="7" cy="4" r="2.6"/>' },                                                                           // hair bun
    { h: 60, extra: '<rect x="2" y="15" width="5" height="13" rx="1.5"/>' }                                                     // backpack
  ];
  function queueFigure(k) {
    var v = FIG_VARIANTS[k % FIG_VARIANTS.length];
    return '<svg class="qf" data-k="' + k + '" viewBox="0 0 28 60" style="--h:' + v.h + 'px" focusable="false">' +
      '<circle cx="12" cy="6" r="5"/><path d="M6 13h12l2 22h-3.2L15.4 60h-3L12 39l-.4 21h-3L7.2 35H4z"/>' + v.extra + "</svg>";
  }
  var Qs = { busy: false, timers: [], anims: [], lastBand: -1000 };
  function figs() { return Array.prototype.slice.call(document.querySelectorAll("#queue .qf")); }
  function figK(k) { return document.querySelector('#queue .qf[data-k="' + k + '"]'); }
  function qGeom() {
    var lane = $("queue"), photo = document.querySelector("#wall .stage-photo");
    var wide = window.matchMedia("(min-width: 720px)").matches;
    var lr = lane.getBoundingClientRect(), pr = photo.getBoundingClientRect();
    var figW = wide ? 23 : 13, sp = wide ? 38 : 21;
    // The walker stops at the photo: its left edge on desktop, the right end of the floor on phones.
    var photoX = wide ? pr.left - lr.left - figW - 4 : lr.width - figW - 2;
    var front = photoX - (wide ? 72 : 40);
    return { photoX: photoX, front: front, sp: sp, enter: -figW - 12 };
  }
  function slotX(g, slot) { return g.front - slot * g.sp; }
  function setX(f, x) { f._x = x; f.style.transform = "translateX(" + x + "px)"; }
  // Two-step bob: the figure lifts on each step, never slides flat.
  function walkKF(x0, x1, steps, lift) {
    var kf = [], n = steps * 2;
    for (var s2 = 0; s2 <= n; s2++) kf.push({ transform: "translate(" + (x0 + (x1 - x0) * s2 / n) + "px," + (s2 % 2 ? -lift : 0) + "px)" });
    return kf;
  }
  function move(f, x0, x1, steps, dur, delay) {
    setX(f, x0);
    if (!f.animate) { setX(f, x1); return; }
    var a = f.animate(walkKF(x0, x1, steps, steps > 1 ? 3 : 2), { duration: dur, delay: delay || 0, easing: "linear", fill: "both" });
    Qs.anims.push(a);
    a.onfinish = function () { setX(f, x1); a.cancel(); };
  }
  function later(ms, fn) { Qs.timers.push(setTimeout(fn, ms)); }
  function placeQueue(i) {
    if (!$("queue")) return;
    var g = qGeom();
    figs().forEach(function (f) {
      var k = +f.getAttribute("data-k");
      f.style.visibility = k > i ? "visible" : "hidden";
      setX(f, k > i ? slotX(g, k - i - 1) : g.enter);
    });
  }
  function stopQueue() {
    Qs.timers.forEach(clearTimeout); Qs.timers = [];
    Qs.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* already done */ } }); Qs.anims = [];
    var sl = document.querySelector("#wall .scanline");
    if (sl) sl.hidden = true;
    Qs.busy = false;
  }
  // A screen turning on: a thin paper line across the middle, then the photo opens from it to full
  // height (380ms, ease-out cubic) while settling from scale 1.06 and brightness 1.35. About 450ms.
  // Restarted at most once every 340ms, so it can't flicker.
  function photoReveal() {
    var box = document.querySelector("#wall .stage-photo"), now = performance.now();
    if (!box || SHOT || now - Qs.lastBand < 340) return;
    var shot = box.querySelector("[data-cue]:not([hidden])"), line = box.querySelector(".scanline");
    if (!shot || !shot.animate) return;
    Qs.lastBand = now;
    var base = getComputedStyle(shot).filter, bright = base && base !== "none" ? base + " brightness(1.35)" : "brightness(1.35)";
    var ease = "cubic-bezier(0.33, 1, 0.68, 1)";
    // Open from the frame's middle line, even when the photo box is taller than the frame.
    var mid = box.clientHeight / 2 - shot.offsetTop, h = shot.offsetHeight || 1, top = Math.max(0, Math.min(100, (mid / h) * 100));
    shot.style.transformOrigin = "50% " + mid + "px";
    Qs.anims.push(shot.animate([
      { clipPath: "inset(" + top + "% 0 " + (100 - top) + "% 0)", transform: "scale(1.06)", filter: bright },
      { clipPath: "inset(0% 0 0% 0)", transform: "scale(1)", filter: base && base !== "none" ? base : "none" }
    ], { duration: 380, delay: 70, easing: ease, fill: "backwards" }));
    if (line) {
      line.hidden = false;
      var la = line.animate([{ opacity: 1, transform: "scaleY(1)" }, { opacity: 1, offset: 0.16 }, { opacity: 0, transform: "scaleY(1)" }], { duration: 450, easing: "linear" });
      Qs.anims.push(la);
      la.onfinish = function () { line.hidden = true; };
    }
  }
  // GO: the front figure walks to the photo (600ms), the text cuts and the photo powers on (about 450ms),
  // the rest shuffle forward (300ms). From Q6, everyone runs back in from the left (1.5s max).
  function goNext() {
    if (Qs.busy) return;
    fireGo();
    var n = CUES.length, i = state.cue, j = (i + 1) % n;
    if (SHOT || !$("queue")) { cutTo(j, true); placeQueue(j); return; }
    Qs.busy = true;
    var g = qGeom();
    if (j > 0) {
      var walker = figK(j);
      move(walker, slotX(g, 0), g.photoX, 2, 600);
      later(600, function () {
        walker.style.visibility = "hidden";
        cutTo(j, true);
        photoReveal();
      });
      later(900, function () {
        figs().forEach(function (f) {
          var k = +f.getAttribute("data-k");
          if (k > j) move(f, slotX(g, k - j), slotX(g, k - j - 1), 1, 300);
        });
      });
      later(1210, function () { Qs.busy = false; });
    } else {
      figs().forEach(function (f) {
        var k = +f.getAttribute("data-k");
        f.style.visibility = "visible";
        if (k === 0) move(f, g.enter, g.photoX, 5, 900);
        else move(f, g.enter, slotX(g, k - 1), 4, 760, 60 * k);
      });
      later(900, function () {
        figK(0).style.visibility = "hidden";
        cutTo(0, true);
        photoReveal();
      });
      later(1220, function () { Qs.busy = false; placeQueue(0); });
    }
  }
  // A cue button cuts straight there: the queue rearranges with one 300ms shuffle.
  function jumpTo(j) {
    stopQueue();
    var from = state.cue;
    cutTo(j, true);
    if (SHOT || !$("queue")) { placeQueue(j); return; }
    photoReveal();
    var g = qGeom();
    figs().forEach(function (f) {
      var k = +f.getAttribute("data-k");
      if (k <= j) { f.style.visibility = "hidden"; setX(f, g.enter); return; }
      var x1 = slotX(g, k - j - 1);
      var x0 = k > from && f.style.visibility !== "hidden" ? f._x : x1 - g.sp;
      f.style.visibility = "visible";
      if (x0 === x1) setX(f, x1); else move(f, x0, x1, 1, 300);
    });
  }

  // Hard cut: everything swaps in the same frame. No fade, no slide.
  function cutTo(i, announce) {
    var n = CUES.length;
    i = ((i % n) + n) % n;
    state.cue = i;
    var c = CUES[i], next = CUES[(i + 1) % n];
    $("wall-name").innerHTML = nameHtml(c.sp.name);
    $("wall-numeral").textContent = c.cue;
    $("wall-title").textContent = c.s.title;
    $("wall-cue").textContent = cueLine(c);
    $("wall-link").setAttribute("href", "#session-" + c.s.id);
    Array.prototype.forEach.call(document.querySelectorAll("#wall .stage-photo img"), function (im) {
      im.hidden = +im.getAttribute("data-cue") !== i;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#wall .cue-btn"), function (b) {
      var k = +b.getAttribute("data-cue"), live = k === i, sb = k === (i + 1) % n, called = k < i;
      var x = CUES[k];
      b.classList.toggle("is-live", live);
      b.classList.toggle("is-standby", sb);
      b.classList.toggle("is-called", called);
      if (live) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      b.querySelector(".cue-state").innerHTML = sb ? '<span class="lamp"></span>' + esc(D.wall.standby) : "";
      b.setAttribute("aria-label", x.cue + ", " + x.sp.name + (live ? ", " + D.wall.live : sb ? ", " + D.wall.standbyLong : called ? ", " + D.wall.called : ""));
    });
    $("go-btn").setAttribute("aria-label", D.wall.goText + ": call " + next.cue + ", " + next.sp.name);
    fitNames();
    if (announce) {
      var live = $("wall-live");
      live.textContent = "";
      setTimeout(function () { live.textContent = c.cue + ". " + c.sp.name + ". " + c.s.title + (/[.!?]$/.test(c.s.title) ? "" : "."); }, 30);
    }
  }

  // Names fit by narrowing the Anybody width axis, never by shrinking the size.
  // Desktop: one line. Phone: each word on its own line. Instant, not motion.
  var WDTH_MAX = 110, WDTH_MIN = 60;
  function fitName(el) {
    if (!el) return;
    var w = WDTH_MAX;
    el.style.fontStretch = w + "%";
    var box = el.clientWidth;
    function over() {
      var parts = el.querySelectorAll(".nm"), wide = el.scrollWidth > box + 1;
      for (var k = 0; k < parts.length && !wide; k++) if (parts[k].getBoundingClientRect().width > box + 1) wide = true;
      return wide;
    }
    while (over() && w > WDTH_MIN) { w -= 5; el.style.fontStretch = w + "%"; }
  }
  function fitNames() { Array.prototype.forEach.call(document.querySelectorAll(".stage-name"), fitName); }

  // GO lamp: the ring lights solid on press and fades back over 400ms (tier 1).
  // At most one flash every 340ms, so never more than 3 a second.
  var lastFire = 0;
  function fireGo() {
    var b = $("go-btn"), now = performance.now();
    if (SHOT || now - lastFire < 340) return;
    lastFire = now;
    b.classList.add("is-fired");
    void b.offsetWidth;
    requestAnimationFrame(function () { requestAnimationFrame(function () { b.classList.remove("is-fired"); }); });
  }

  function wireWall() {
    var wall = $("wall");
    if (!wall) return;
    $("go-btn").addEventListener("click", goNext);
    Array.prototype.forEach.call(wall.querySelectorAll(".cue-btn"), function (b) {
      b.addEventListener("click", function () { jumpTo(+b.getAttribute("data-cue")); });
    });
    placeQueue(state.cue);
    frameWallPhotos();
    window.addEventListener("resize", function () { frameWallPhotos(); if (!Qs.busy) placeQueue(state.cue); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!Qs.busy) placeQueue(state.cue); });
  }

  // ---------- sections ----------
  var R = {};

  R.about = function () {
    var a = D.about;
    return sectionShell("about", a.heading,
      '<div class="about-copy">' + a.paragraphs.map(function (p) { return "<p>" + copy(p) + "</p>"; }).join("") + "</div>");
  };

  // Equator block: one huge latitude, a line for the equator, a dot for the hall, one sentence.
  R.equator = function () {
    var e = D.equator;
    return '<section class="section sec-equator" id="equator" aria-labelledby="equator-title"><div class="wrap">' +
      '<h2 class="eq-lat" id="equator-title" aria-label="' + esc(e.headingLabel) + '">' + esc(e.heading) + "</h2>" +
      '<div class="eq-map" aria-hidden="true"><p class="eq-line"><span>' + esc(e.lineLabel) + '</span></p>' +
      '<p class="eq-dot"><span class="dot"></span>' + esc(e.dotLabel) + "</p></div>" +
      '<p class="eq-text">' + copy(e.sentence) + "</p></div></section>";
  };

  R.speakers = function () {
    var sp = D.speakers, map = speakerSessions();
    function first(id) { return (map[id] || [])[0]; }
    // Photos get alt="": the name is the heading right next to them.
    function photo(p, w, h) {
      return '<div class="sp-photo duo">' + (p.photo
        ? '<img src="' + esc(img(p.photo, w, h)) + '" alt="" width="' + w + '" height="' + h + '" loading="' + imgLoading(false) + '">'
        : '<span class="sp-initials" aria-hidden="true">' + esc(initials(p.name)) + "</span>") + "</div>";
    }
    function link(p) {
      var f = first(p.id);
      return f ? '<a class="sp-agenda" href="#session-' + esc(f.s.id) + '" aria-label="' + esc(sp.agendaLink + ": " + p.name) + '">' + esc(sp.agendaLink) + "</a>" : "";
    }
    function card(p) {
      var f = first(p.id);
      return '<li class="sp-card" id="speaker-' + p.id + '">' +
        (f && f.s.cue ? '<p class="sp-cue">' + esc(f.s.cue) + "</p>" : "") + photo(p, 480, 600) +
        '<h3 class="sp-name">' + esc(p.name) + '</h3><p class="sp-role">' + esc(p.role) + '</p><p class="sp-company">' + esc(p.company) + "</p>" + link(p) + "</li>";
    }
    function row(p) {
      return '<li class="sp-row" id="speaker-' + p.id + '">' + photo(p, 160, 160) +
        '<div class="sp-row-text"><h3 class="sp-name">' + esc(p.name) + '</h3><p class="sp-role">' + esc(p.role) + ' <span class="sp-company">' + esc(p.company) + "</span></p></div>" + link(p) + "</li>";
    }
    var keynote = sp.items.filter(function (p) { var f = first(p.id); return f && f.s.cue; });
    keynote.sort(function (a, b) { return parseInt(first(a.id).s.cue.slice(1), 10) - parseInt(first(b.id).s.cue.slice(1), 10); });
    var others = sp.items.filter(function (p) { return keynote.indexOf(p) < 0; });
    return sectionShell("speakers", sp.heading,
      (sp.intro ? '<p class="lede">' + copy(sp.intro) + "</p>" : "") +
      '<h3 class="sp-group">' + esc(sp.keynoteHeading) + '</h3><ul class="sp-grid sp-keynotes">' + keynote.map(card).join("") + "</ul>" +
      '<h3 class="sp-group">' + esc(sp.boothHeading) + '</h3><ul class="sp-booth">' + others.map(row).join("") + "</ul>");
  };

  R.schedule = function () {
    var s = D.schedule;
    var showTz = !SHOT && USER_TZ && USER_TZ !== D.meta.timezone;
    var refDate = zoned(s.days[0].date, "12:00");
    var tzBar = '<div class="tz-bar"><p class="tz-label" id="tz-label">Times in ' + esc(tzShort(viewTz(), refDate)) + "</p>" +
      (showTz ? '<button type="button" class="btn btn-small" id="tz-toggle" aria-pressed="' + (state.tzMode === "local") + '">' +
        (state.tzMode === "local" ? "Show event time (" + esc(tzShort(D.meta.timezone, refDate)) + ")" : "Show my time (" + esc(tzShort(USER_TZ, refDate)) + ")") + "</button>" : "") +
      "</div>";
    var legend = '<ul class="track-legend" aria-label="Rooms">' + D.tracks.map(function (t, i) {
      return '<li class="track-' + (i + 1) + '"><span class="swatch" aria-hidden="true"></span>' + esc(t.name) + "</li>";
    }).join("") + "</ul>";
    var single = s.days.length === 1;
    var tabs = single ? "" : '<div class="day-tabs" role="tablist" aria-label="Event days">' + s.days.map(function (day, i) {
      return '<button class="day-tab" role="tab" type="button" id="tab-' + day.id + '" aria-controls="panel-' + day.id +
        '" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '"><span class="dt-label">' + esc(day.label) +
        '</span><span class="dt-title">' + esc(day.title) + "</span></button>";
    }).join("") + "</div>";
    var panels = s.days.map(function (day, i) {
      var sorted = day.sessions.slice().sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; });
      return (single ? '<div class="day-panel" id="panel-' + day.id + '"><h3 class="day-single">' + esc(day.title) + "</h3>"
        : '<div class="day-panel" role="tabpanel" id="panel-' + day.id + '" aria-labelledby="tab-' + day.id + '"' + (i ? " hidden" : "") + ' tabindex="0">') +
        '<ol class="sessions">' + sorted.map(function (x) {
          var t = sessionTimes(day, x), tr = x.track ? byId(D.tracks, x.track) : null;
          var spk = (x.speakers || []).map(function (id) {
            var p = byId(D.speakers.items, id);
            if (!p) return "";
            return '<a class="s-sp" href="#speaker-' + id + '">' +
              (p.photo ? '<img src="' + esc(img(p.photo, 64, 64, 2)) + '" alt="" width="32" height="32" loading="' + imgLoading(false) + '">' : "") +
              '<span class="s-sp-name">' + esc(p.name) + "</span></a>";
          }).filter(Boolean).join("");
          var cls = "session track-" + trackIndex(x.track) + (x.cue ? " is-keynote" : "") + (tr ? "" : " is-common");
          return '<li class="' + cls + '" id="session-' + x.id + '">' +
            '<span class="s-time"><time datetime="' + t.start.toISOString() + '">' + esc(t.label) + "</time>" +
              (x.cue ? '<span class="s-cue">' + esc(x.cue) + "</span>" : "") + "</span>" +
            '<div class="s-body"><h3 class="s-title">' + esc(x.title) + "</h3>" +
              '<div class="s-speakers">' + spk + "</div>" +
              (x.detail ? '<p class="s-detail">' + copy(x.detail) + "</p>" : "") + "</div>" +
            (tr ? '<span class="s-track">' + esc(tr.name) + "</span>" : "") +
          "</li>";
        }).join("") + "</ol>" +
        '<button type="button" class="btn btn-small ics-btn" data-ics-day="' + day.id + '">Add ' + esc(day.title) + " to calendar</button>" +
      "</div>";
    }).join("");
    var strip = '<div class="ag-strip">' + tzBar + legend + (s.note ? '<p class="note">' + copy(s.note) + "</p>" : "") + "</div>";
    return sectionShell("schedule", s.heading, strip + tabs + panels);
  };

  function rowPreviewItems(row) {
    if (!row.from) return null;
    var parts = row.from.split(":"), kind = parts[0], key = parts[1], out = [];
    D.schedule.days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        if ((kind === "day" && day.id === key) || (kind === "track" && s.track === key) || (kind === "session" && s.id === key)) out.push({ day: day, s: s });
      });
    });
    return out;
  }
  function rowPreviewHtml(row) {
    var t = D.tickets, items = rowPreviewItems(row);
    var incl = t.tiers.filter(function (tier) { var v = row.tiers[tier.id]; return v && v !== "no"; }).map(function (x) { return x.name; });
    var body = items && items.length
      ? '<ul class="pv-list">' + items.map(function (x) {
          var tm = sessionTimes(x.day, x.s);
          return '<li><span class="t">' + esc(x.day.short) + ", " + esc(fmtTime(tm.start)) + " " + esc(tzShort(viewTz(), tm.start)) + "</span> " + esc(x.s.title) + "</li>";
        }).join("") + "</ul>"
      : '<p>' + copy(row.detail || "") + "</p>";
    return '<p class="pv-title">' + esc(row.label) + "</p>" + body +
      '<p class="pv-incl">Included in: ' + (incl.length ? esc(incl.join(", ")) : "none") + "</p>";
  }
  function cell(v) {
    if (v === "yes") return '<span class="yes"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2.2"/></svg><span class="sr">Included</span></span>';
    if (!v || v === "no") return '<span class="no" aria-hidden="true">-</span><span class="sr">Not included</span>';
    return '<span class="val">' + esc(v) + "</span>";
  }
  R.tickets = function () {
    var t = D.tickets;
    state.tier = state.tier || t.recommended || t.tiers[0].id;
    var head = '<thead><tr><td class="m-corner"></td>' + t.tiers.map(function (tier) {
      return '<th scope="col" class="m-col c-' + tier.id + '"><label class="m-pick">' +
        '<input type="radio" name="tier" value="' + tier.id + '"' + (tier.id === state.tier ? " checked" : "") + ">" +
        '<span class="m-name">' + esc(tier.name) + '</span><span class="m-note">' + esc(tier.note || "") + "</span></label></th>";
    }).join("") + "</tr></thead>";
    var lastGroup = null, body = "";
    t.rows.forEach(function (row) {
      if (row.group && row.group !== lastGroup) {
        body += '<tr class="m-group"><th scope="rowgroup" colspan="' + (t.tiers.length + 1) + '">' + esc(row.group) + "</th></tr>";
        lastGroup = row.group;
      }
      body += '<tr class="m-row" data-row="' + row.id + '"><th scope="row"><button type="button" class="m-label" aria-expanded="false" aria-controls="detail-' + row.id + '">' +
        esc(row.label) + '<span class="m-more" aria-hidden="true">+</span></button></th>' +
        t.tiers.map(function (tier) { return '<td class="c-' + tier.id + '" data-tier="' + esc(tier.name) + '">' + cell(row.tiers[tier.id]) + "</td>"; }).join("") + "</tr>" +
        '<tr class="m-detail" id="detail-' + row.id + '" hidden><td colspan="' + (t.tiers.length + 1) + '"><div class="pv">' + rowPreviewHtml(row) + "</div></td></tr>";
    });
    var table = '<table class="matrix" id="matrix" style="--tiers:' + t.tiers.length + '"><caption class="sr">What each registration type includes</caption>' + head + "<tbody>" + body + "</tbody></table>";
    var preview = '<aside class="preview" id="preview" aria-live="polite" aria-label="Row preview"><p class="pv-empty">Hover or focus a row to see exactly what it covers.</p></aside>';
    return sectionShell("tickets", t.heading,
      (t.intro ? '<p class="lede">' + copy(t.intro) + "</p>" : "") +
      '<fieldset class="matrix-wrap"><legend class="sr">Choose a registration type</legend><div class="matrix-layout">' + table + preview + "</div></fieldset>" +
      '<div class="matrix-cta"><a class="btn btn-primary" href="#register" id="tier-cta"></a>' +
      (t.footnote ? '<p class="note matrix-foot">' + copy(t.footnote) + "</p>" : "") + "</div>");
  };

  R.sponsors = function () {
    var s = D.sponsors;
    return sectionShell("sponsors", s.heading, s.tiers.map(function (tier, i) {
      return '<div class="sponsor-tier' + (i === 0 ? " is-top" : "") + '"><h3 class="tier-name">' + esc(tier.name) + '</h3><ul class="sponsor-list">' +
        tier.items.map(function (x) {
          var inner = x.logo ? '<img src="' + esc(x.logo) + '" alt="' + esc(x.name) + '" loading="' + imgLoading(false) + '">' : '<span class="wordmark">' + esc(x.name) + "</span>";
          return "<li>" + (x.link ? '<a href="' + esc(x.link) + '">' + inner + "</a>" : inner) + "</li>";
        }).join("") + "</ul></div>";
    }).join(""));
  };

  R.venue = function () {
    var v = D.venue, f = v.feature;
    return sectionShell("venue", v.heading,
      (v.intro ? '<p class="lede">' + copy(v.intro) + "</p>" : "") +
      '<div class="venue-layout">' +
      (f ? '<div class="venue-feature">' + '<h3>' + esc(f.title) + (f.tag ? ' <span class="venue-tag">' + esc(f.tag) + "</span>" : "") + "</h3><p>" + copy(f.body) + "</p></div>" : "") +
      '<dl class="ruled">' + v.items.map(function (x) { return "<div><dt>" + esc(x.title) + "</dt><dd>" + copy(x.body) + "</dd></div>"; }).join("") + "</dl></div>" +
      (v.mapLink ? '<a class="btn btn-small" href="' + esc(v.mapLink) + '">Open in maps</a>' : ""));
  };

  // ---------- Say it in Quito: one phrase card at a time ----------
  R.phrases = function () {
    var ph = D.phrases;
    return sectionShell("phrases", ph.heading,
      '<div class="ph-card" id="ph-card">' +
        '<div class="ph-top"><p class="ph-count" id="ph-count"></p>' +
          '<div class="ph-nav"><button type="button" class="btn btn-small" id="ph-prev">' + esc(ph.prev) + '</button>' +
          '<button type="button" class="btn btn-small" id="ph-next">' + esc(ph.next) + "</button></div></div>" +
        '<div class="ph-body" id="ph-body" aria-live="polite"></div>' +
        '<div class="ph-actions"><button type="button" class="btn btn-primary btn-small" id="ph-listen" hidden>' + esc(ph.listen) + "</button>" +
          '<button type="button" class="btn btn-small" id="ph-try">' + esc(ph.try) + "</button></div>" +
        '<div class="ph-result" id="ph-result" aria-live="polite"></div>' +
      "</div>" +
      '<p class="ph-privacy">' + esc(ph.privacy) + "</p>");
  };
  var PH = { i: 0, voice: null, busy: false, rec: null, stream: null, timer: null };
  function phNorm(t) {
    return String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function phWords(t) { return phNorm(t).split(" ").filter(Boolean); }
  // Respelling chunks line up one-to-one with the phrase's words.
  function phSay(item) { return item.say.replace(/,/g, "").split(/\s+/); }
  function phRender() {
    var ph = D.phrases, item = ph.items[PH.i];
    $("ph-count").textContent = (PH.i + 1) + " / " + ph.items.length;
    $("ph-body").innerHTML = '<p class="ph-es" lang="es">' + esc(item.es) + '</p><p class="ph-en">' + esc(item.en) + '</p><p class="ph-say">' + esc(item.say) + "</p>";
    $("ph-result").innerHTML = "";
  }
  function phPickVoice() {
    if (!("speechSynthesis" in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [], order = D.phrases.voiceLangs;
    function lang(v) { return String(v.lang || "").replace("_", "-").toLowerCase(); }
    for (var k = 0; k < order.length; k++) {
      var want = order[k].toLowerCase();
      for (var j = 0; j < vs.length; j++) if (lang(vs[j]) === want) return vs[j];
    }
    for (var m = 0; m < vs.length; m++) if (lang(vs[m]).indexOf("es") === 0) return vs[m];
    return null;
  }
  function phUpdateVoice() {
    PH.voice = phPickVoice();
    if ($("ph-listen")) $("ph-listen").hidden = !PH.voice;
  }
  function phSpeak(text, done) {
    if (!PH.voice) { if (done) done(); return; }
    var u = new SpeechSynthesisUtterance(text);
    try { u.voice = PH.voice; } catch (e) { /* lang below still picks Spanish */ }
    u.lang = PH.voice.lang; u.rate = 0.85;
    u.onend = u.onerror = function () { if (done) done(); };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }
  // Compare word by word and show each phrase word as matched (solid ink) or missed (underlined).
  function phJudge(transcripts) {
    var ph = D.phrases, item = ph.items[PH.i], want = phWords(item.es), say = phSay(item), best = null;
    transcripts.forEach(function (t) {
      var got = phWords(t), hitAll = item.accept && item.accept.some(function (a) { return phNorm(t).replace(/\s/g, "").indexOf(a) > -1; });
      var marks = want.map(function (w) { return hitAll || got.indexOf(w) > -1; });
      var n = marks.filter(Boolean).length;
      if (!best || n > best.n) best = { t: t, marks: marks, n: n };
    });
    if (!best) { $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noSpeech) + "</p>"; return; }
    var esWords = item.es.split(/\s+/), missed = [], missedSay = [];
    var words = esWords.map(function (w, k) {
      if (!best.marks[k]) { missed.push(w.replace(/[¿?¡!.,]/g, "")); missedSay.push(say[k]); }
      return '<span class="ph-w ' + (best.marks[k] ? "is-hit" : "is-miss") + '">' + esc(w) + "</span>";
    }).join(" ");
    var msg = best.n === want.length ? esc(ph.nailed)
      : best.n * 2 >= want.length ? esc(ph.close) + " " + esc(missed.join(" ")) + ' <span class="ph-say-inline">(' + esc(missedSay.join(" ")) + ")</span>"
      : esc(ph.again);
    $("ph-result").innerHTML = '<p class="ph-heard">' + esc(ph.heard) + " " + esc(best.t) + '</p><p class="ph-words" lang="es">' + words + '</p><p class="ph-msg">' + msg + "</p>";
  }
  function phStopMic() {
    if (PH.stream) { PH.stream.getTracks().forEach(function (t) { t.stop(); }); PH.stream = null; }
    if (PH.rec) { try { PH.rec.abort ? PH.rec.abort() : PH.rec.stop(); } catch (e) { /* already stopped */ } PH.rec = null; }
    clearTimeout(PH.timer);
    PH.busy = false;
    if ($("ph-try")) $("ph-try").disabled = false;
  }
  function phTry() {
    var ph = D.phrases, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (PH.busy) return;
    PH.busy = true; $("ph-try").disabled = true;
    if (SR) {
      var rec = new SR();
      PH.rec = rec;
      rec.lang = "es-EC"; rec.maxAlternatives = 3; rec.interimResults = false; rec.continuous = false;
      var got = false;
      rec.onresult = function (e) {
        got = true;
        var alts = [], r = e.results[0];
        for (var k = 0; k < r.length; k++) alts.push(r[k].transcript);
        phJudge(alts);
        try { rec.stop(); } catch (er) { /* done */ }
      };
      rec.onerror = function (e) {
        var msg = e && (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") ? ph.noMic : ph.noSpeech;
        $("ph-result").innerHTML = '<p class="ph-msg">' + esc(msg) + "</p>";
      };
      rec.onend = function () { if (!got && !$("ph-result").textContent) $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noSpeech) + "</p>"; PH.rec = null; phStopMic(); };
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.listening) + "</p>";
      try { rec.start(); } catch (e) { phStopMic(); }
      return;
    }
    // No speech recognition (for example Firefox): record 4 seconds, play it back, then the voice.
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder)) {
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; phStopMic(); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      PH.stream = stream;
      var chunks = [], mr = new MediaRecorder(stream);
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        if (PH.stream) { PH.stream.getTracks().forEach(function (t) { t.stop(); }); PH.stream = null; }
        var url = URL.createObjectURL(new Blob(chunks, { type: mr.mimeType || "audio/webm" })), au = new Audio(url);
        $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.playing) + "</p>";
        var next = function () { URL.revokeObjectURL(url); phSpeak(ph.items[PH.i].es, function () { phStopMic(); }); };
        au.onended = next; au.onerror = next;
        au.play().catch(next);
      };
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.recording) + "</p>";
      mr.start();
      PH.timer = setTimeout(function () { if (mr.state !== "inactive") mr.stop(); }, 4000);
    }).catch(function () { $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; phStopMic(); });
  }
  function wirePhrases() {
    if (!$("ph-card")) return;
    var ph = D.phrases, SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) $("ph-try").textContent = ph.record;
    phRender();
    $("ph-prev").addEventListener("click", function () { phStopMic(); PH.i = (PH.i - 1 + ph.items.length) % ph.items.length; phRender(); });
    $("ph-next").addEventListener("click", function () { phStopMic(); PH.i = (PH.i + 1) % ph.items.length; phRender(); });
    $("ph-listen").addEventListener("click", function () { phSpeak(ph.items[PH.i].es); });
    $("ph-try").addEventListener("click", phTry);
    phUpdateVoice();
    if ("speechSynthesis" in window && window.speechSynthesis.addEventListener) window.speechSynthesis.addEventListener("voiceschanged", phUpdateVoice);
    document.addEventListener("visibilitychange", function () { if (document.hidden) phStopMic(); });
    window.addEventListener("pagehide", phStopMic);
  }

  function field(id, label, input, extraCls) {
    return '<div class="field' + (extraCls ? " " + extraCls : "") + '" id="fld-' + id + '"><label for="f-' + id + '">' + esc(label) + "</label>" + input +
      '<span class="error" id="e-' + id + '"></span></div>';
  }
  function textInput(id, type, auto, extra) {
    return '<input type="' + type + '" id="f-' + id + '" name="' + id + '" autocomplete="' + auto + '" required aria-describedby="e-' + id + '"' + (extra || "") + ">";
  }

  R.register = function () {
    var r = D.registration, t = D.tickets, ts = r.teamSize;
    var opts = t.tiers.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("");
    var sizes = "";
    for (var i = ts.min; i <= ts.max; i++) sizes += '<option value="' + i + '">' + i + " people</option>";
    return sectionShell("register", r.heading,
      (r.intro ? '<p class="lede">' + copy(r.intro) + "</p>" : "") +
      '<p class="demo" role="note">' + esc(r.demoNotice) + "</p>" +
      '<div id="reg-out"><form class="reg-form" id="reg-form" novalidate>' +
        '<div class="two-col">' +
          field("first", "First name", textInput("first", "text", "given-name")) +
          field("last", "Last name", textInput("last", "text", "family-name")) +
        "</div>" +
        field("email", "Work email", textInput("email", "email", "email", ' inputmode="email"')) +
        field("company", "Company", textInput("company", "text", "organization")) +
        '<div class="two-col">' +
          field("tier", "Registration type", '<select id="f-tier" name="tier">' + opts + "</select>") +
          field("size", ts.label, '<select id="f-size" name="size">' + sizes + "</select>", "field-size") +
        "</div>" +
        '<button type="submit" class="btn btn-primary" id="reg-submit">' + esc(r.submitLabel) + "</button>" +
      "</form></div>");
  };

  R.faq = function () {
    var f = D.faq;
    return '<section class="section sec-faq" id="faq" aria-labelledby="faq-title"><div class="wrap faq-layout">' +
      '<h2 class="section-title" id="faq-title">' + copy(f.heading) + '</h2><div class="faq-list">' + f.items.map(function (x) {
      return '<details class="faq-item"><summary><span>' + copy(x.q) + '</span><span class="q-icon" aria-hidden="true">+</span></summary><div class="a"><p>' + copy(x.a) + (x.link ? ' <a href="' + esc(x.link.href) + '">' + esc(x.link.label) + "</a>." : "") + "</p></div></details>";
    }).join("") + "</div></div></section>";
  };

  // ---------- wiring ----------
  function wireTabs() {
    var sec = $("schedule");
    if (!sec) return;
    var tabs = Array.prototype.slice.call(sec.querySelectorAll('[role="tab"]'));
    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () { selectTab(tab, false); });
      tab.addEventListener("keydown", function (e) {
        var n = null;
        if (e.key === "ArrowRight") n = tabs[(i + 1) % tabs.length];
        if (e.key === "ArrowLeft") n = tabs[(i - 1 + tabs.length) % tabs.length];
        if (e.key === "Home") n = tabs[0];
        if (e.key === "End") n = tabs[tabs.length - 1];
        if (n) { e.preventDefault(); selectTab(n, true); }
      });
    });
  }
  function selectTab(tab, focus) {
    var tabs = $("schedule").querySelectorAll('[role="tab"]');
    Array.prototype.forEach.call(tabs, function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      $(t.getAttribute("aria-controls")).hidden = !on;
    });
    if (focus) tab.focus();
  }

  function setTier(id) {
    state.tier = id;
    var tier = byId(D.tickets.tiers, id);
    var m = $("matrix");
    if (m) {
      Array.prototype.forEach.call(m.querySelectorAll("th.m-col, td[class^='c-']"), function (c) {
        c.classList.toggle("is-sel", c.classList.contains("c-" + id));
      });
      var radio = m.querySelector('input[value="' + id + '"]');
      if (radio) radio.checked = true;
    }
    var cta = $("tier-cta");
    if (cta && tier) cta.innerHTML = "Register as " + esc(tier.name) + ' <span class="arrow" aria-hidden="true">&rarr;</span>';
    var sel = $("f-tier");
    if (sel) sel.value = id;
    var size = $("fld-size");
    if (size) size.hidden = id !== "team";
  }

  function wireMatrix() {
    var m = $("matrix");
    if (!m) return;
    var preview = $("preview");
    m.addEventListener("change", function (e) { if (e.target.name === "tier") setTier(e.target.value); });
    function show(rowEl) {
      Array.prototype.forEach.call(m.querySelectorAll(".m-row"), function (r) { r.classList.toggle("is-hot", r === rowEl); });
      var row = byId(D.tickets.rows, rowEl.getAttribute("data-row"));
      if (row && preview) preview.innerHTML = rowPreviewHtml(row);
    }
    Array.prototype.forEach.call(m.querySelectorAll(".m-row"), function (rowEl) {
      rowEl.addEventListener("mouseenter", function () { show(rowEl); });
      rowEl.addEventListener("focusin", function () { show(rowEl); });
      var btn = rowEl.querySelector(".m-label");
      btn.addEventListener("click", function () {
        var detail = $(btn.getAttribute("aria-controls"));
        var open = btn.getAttribute("aria-expanded") === "true";
        btn.setAttribute("aria-expanded", String(!open));
        detail.hidden = open;
        show(rowEl);
      });
    });
    setTier(state.tier);
  }

  function wireForm() {
    var form = $("reg-form");
    if (!form) return;
    form.elements.tier.addEventListener("change", function () { setTier(form.elements.tier.value); });
    if (state.tier) setTier(state.tier);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var first = null;
      function check(name, msg) {
        var el = form.elements[name];
        el.setAttribute("aria-invalid", msg ? "true" : "false");
        $("e-" + name).textContent = msg || "";
        if (msg && !first) first = el;
      }
      function val(name) { return form.elements[name].value.trim(); }
      var ev = val("email");
      check("first", val("first") ? "" : "Enter your first name.");
      check("last", val("last") ? "" : "Enter your last name.");
      check("email", !ev ? "Enter your work email." : (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ev) ? "" : "Check the email format, for example name@company.com."));
      check("company", val("company") ? "" : "Enter your company.");
      if (first) {
        // Focus the first problem and bring its field, message included, into view.
        first.focus({ preventScroll: true });
        first.closest(".field").scrollIntoView({ block: "center", behavior: smoothOK() ? "smooth" : "instant" });
        return;
      }
      var tier = byId(D.tickets.tiers, form.elements.tier.value);
      confirmReg({ name: val("first") + " " + val("last"), company: val("company"), tier: tier,
        size: tier.id === "team" ? form.elements.size.value : "" }, true);
    });
  }

  function daysForTier(tierId) {
    return D.schedule.days.filter(function (day) {
      return day.sessions.some(function (s) { return !s.tiers || s.tiers.indexOf(tierId) > -1; });
    });
  }
  function regLine(rec) {
    return rec.company + " · " + rec.tier.name + (rec.size ? ", " + rec.size + " people" : "");
  }

  // The walk-up title card: the wall's own stage component with the registrant on it. It cuts in.
  function confirmReg(rec, focus) {
    var c = D.registration.card, days = daysForTier(rec.tier.id);
    $("reg-out").innerHTML =
      '<div class="confirm" role="status" tabindex="-1" id="reg-confirm">' +
        '<div class="stage walkup"><div class="stage-body wu-body"><div class="stage-copy">' +
          stageCopy({ label: c.label, name: rec.name, title: regLine(rec), cue: D.meta.dateLine }) +
        "</div>" + '<div class="wu-slot" id="wu-slot" role="img" aria-label="' + esc(c.photo.labelEmpty) + '">' + wuEmpty() + "</div>" +
        '</div><div class="stage-floor" aria-hidden="true"></div></div>' +
        '<div class="wu-actions">' +
          '<button type="button" class="btn btn-small" id="wu-take">' + esc(c.photo.take) + "</button>" +
          '<button type="button" class="btn btn-small" id="wu-upload">' + esc(c.photo.upload) + "</button>" +
          '<input type="file" id="wu-file" accept="image/*" hidden>' +
          '<button type="button" class="btn btn-primary btn-small" id="wu-snap" hidden>' + esc(c.photo.snap) + "</button>" +
          '<button type="button" class="btn btn-small" id="wu-cancel" hidden>' + esc(c.photo.cancel) + "</button>" +
        "</div>" +
        '<p class="wu-status" id="wu-status" role="status"></p>' +
        '<p class="wu-privacy">' + esc(c.photo.privacy) + "</p>" +
        '<p class="confirm-demo">' + esc(c.demoLine) + "</p>" +
        '<div class="confirm-actions"><button type="button" class="btn btn-small" id="card-save">' + esc(c.saveLabel) + "</button>" +
        days.map(function (d) {
          return '<button type="button" class="btn btn-small" data-ics-day="' + d.id + '" data-ics-tier="' + rec.tier.id + '">Add ' + esc(d.title) + " to calendar</button>";
        }).join("") + '<button type="button" class="btn btn-small" id="reg-again">' + esc(c.againLabel) + "</button></div>" +
      "</div>";
    fitNames();
    if (focus) {
      var card = $("reg-confirm"), header = document.querySelector(".site-header");
      var top = card.getBoundingClientRect().top + window.pageYOffset - (header ? header.getBoundingClientRect().height : 0) - 16;
      window.scrollTo({ top: top, behavior: smoothOK() ? "smooth" : "instant" });
      card.focus({ preventScroll: true });
    }
    $("card-save").addEventListener("click", function () {
      saveCard({ label: c.label, name: rec.name, title: regLine(rec), cue: D.meta.dateLine, canvas: WU.canvas }, D.meta.shortName + "-walk-up.png");
    });
    wireWalkupPhoto();
    $("reg-again").addEventListener("click", function () {
      stopCamera();
      WU.canvas = null;
      $("register").outerHTML = R.register();
      wireForm();
      $("f-first").focus();
    });
  }

  // ---------- walk-up photo: camera or upload, duotoned on a canvas, memory only ----------
  var WU = { stream: null, canvas: null, observer: null };
  var SLOT_W = 480, SLOT_H = 600;
  function wuEmpty() {
    return '<div class="wu-empty">' + queueFigure(0) + '<p class="wu-empty-line">' + esc(D.registration.card.photo.empty) + "</p></div>";
  }
  function stopCamera() {
    if (WU.stream) { WU.stream.getTracks().forEach(function (t) { t.stop(); }); WU.stream = null; }
    var v = document.querySelector("#wu-slot video");
    if (v) { v.srcObject = null; v.remove(); }
    ["wu-snap", "wu-cancel"].forEach(function (id) { if ($(id)) $(id).hidden = true; });
    if ($("wu-take")) $("wu-take").hidden = false;
  }
  // Ink in the shadows, host in the lights: the same duotone as the wall photos.
  function duotone(ctx, w, h) {
    var hc = hexRgb(cssVar("--host", "#FFC629")), ic = hexRgb(cssVar("--ink", "#101218"));
    var data = ctx.getImageData(0, 0, w, h), d = data.data;
    for (var i = 0; i < d.length; i += 4) {
      var l = Math.min(1, ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255) * 1.08);
      d[i] = ic[0] + (hc[0] - ic[0]) * l; d[i + 1] = ic[1] + (hc[1] - ic[1]) * l; d[i + 2] = ic[2] + (hc[2] - ic[2]) * l;
    }
    ctx.putImageData(data, 0, 0);
  }
  // Cover-crop any source into the 4:5 slot, optionally mirrored (camera preview is mirrored).
  function toSlot(src, sw, sh, mirror) {
    var cv = document.createElement("canvas");
    cv.width = SLOT_W; cv.height = SLOT_H;
    var ctx = cv.getContext("2d"), sc = Math.max(SLOT_W / sw, SLOT_H / sh), cw = SLOT_W / sc, ch = SLOT_H / sc;
    if (mirror) { ctx.translate(SLOT_W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, SLOT_W, SLOT_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    duotone(ctx, SLOT_W, SLOT_H);
    return cv;
  }
  function showPhoto(cv) {
    var slot = $("wu-slot"), p = D.registration.card.photo;
    WU.canvas = cv;
    cv.className = "wu-canvas";
    slot.innerHTML = "";
    slot.appendChild(cv);
    slot.setAttribute("aria-label", p.labelPhoto);
  }
  function wuStatus(msg) { if ($("wu-status")) $("wu-status").textContent = msg || ""; }
  function wireWalkupPhoto() {
    var p = D.registration.card.photo, slot = $("wu-slot");
    if (!slot) return;
    var canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    $("wu-take").addEventListener("click", function () {
      wuStatus("");
      if (!canCam) { wuStatus(p.none); $("wu-take").hidden = true; return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).then(function (stream) {
        stopCamera();
        WU.stream = stream;
        var v = document.createElement("video");
        v.className = "wu-video"; v.muted = true; v.playsInline = true; v.autoplay = true;
        v.setAttribute("playsinline", ""); v.srcObject = stream;
        slot.innerHTML = ""; slot.appendChild(v);
        slot.setAttribute("aria-label", p.labelLive);
        v.play().catch(function () { /* autoplay may need the click; the stream still shows */ });
        $("wu-take").hidden = true; $("wu-snap").hidden = false; $("wu-cancel").hidden = false;
        $("wu-snap").focus();
      }).catch(function (err) {
        var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
        wuStatus(denied ? p.denied : p.none);
        $("wu-take").hidden = true;
      });
    });
    $("wu-snap").addEventListener("click", function () {
      var v = document.querySelector("#wu-slot video");
      if (!v || !v.videoWidth) return;
      var cv = toSlot(v, v.videoWidth, v.videoHeight, true);
      stopCamera();
      showPhoto(cv);
      $("wu-take").focus();
    });
    $("wu-cancel").addEventListener("click", function () {
      stopCamera();
      if (WU.canvas) showPhoto(WU.canvas);
      else { slot.innerHTML = wuEmpty(); slot.setAttribute("aria-label", p.labelEmpty); }
      $("wu-take").focus();
    });
    $("wu-upload").addEventListener("click", function () { $("wu-file").click(); });
    $("wu-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      stopCamera();
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () { showPhoto(toSlot(im, im.naturalWidth, im.naturalHeight, false)); URL.revokeObjectURL(url); wuStatus(""); };
      im.onerror = function () { URL.revokeObjectURL(url); wuStatus(p.bad); };
      im.src = url;
      this.value = "";
    });
    // Leaving the section, hiding the tab or leaving the page stops the camera.
    if (WU.observer) WU.observer.disconnect();
    if ("IntersectionObserver" in window) {
      WU.observer = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) stopCamera(); }); });
      WU.observer.observe($("register"));
    }
  }
  document.addEventListener("visibilitychange", function () { if (document.hidden) stopCamera(); });
  window.addEventListener("pagehide", stopCamera);

  // "See in agenda": switch day, scroll the session under the header, light only it, move focus to it.
  function goToSession(id, opts) {
    var target = $(id);
    if (!target) return false;
    var panel = target.closest('[role="tabpanel"]');
    if (panel && panel.hidden && $(panel.getAttribute("aria-labelledby"))) selectTab($(panel.getAttribute("aria-labelledby")), false);
    Array.prototype.forEach.call(document.querySelectorAll(".session.is-lit"), function (el) {
      if (el === target) return;
      el.classList.remove("is-lit");
      var tag = el.querySelector(".s-live");
      if (tag) tag.remove();
    });
    if (!target.classList.contains("is-lit")) {
      target.classList.add("is-lit");
      target.querySelector(".s-time").insertAdjacentHTML("beforeend", '<span class="s-live">' + esc(D.schedule.liveTag) + "</span>");
    }
    target.setAttribute("tabindex", "-1");
    var header = document.querySelector(".site-header");
    var off = SHOT || !header ? 16 : header.getBoundingClientRect().height + 16;
    var top = target.getBoundingClientRect().top + window.pageYOffset - off;
    var smooth = !(opts && opts.instant) && smoothOK();
    window.scrollTo({ top: top, behavior: smooth ? "smooth" : "instant" });
    target.focus({ preventScroll: true });
    history.replaceState(null, "", "#" + target.id);
    return true;
  }

  function rerenderTimes() {
    // Re-render the time-dependent sections in place, keeping the selected day.
    var sel = document.querySelector('#schedule [role="tab"][aria-selected="true"]');
    var selId = sel ? sel.id : null;
    ["schedule", "tickets"].forEach(function (id) {
      var old = $(id);
      if (old && R[id]) old.outerHTML = R[id]();
    });
    wireTabs(); wireMatrix();
    if (selId && $(selId)) selectTab($(selId), false);
  }

  function wireGlobal() {
    document.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target : null;
      if (!t) return;
      var tz = t.closest("#tz-toggle");
      if (tz) { state.tzMode = state.tzMode === "local" ? "event" : "local"; rerenderTimes(); var b = $("tz-toggle"); if (b) b.focus(); return; }
      var ics = t.closest("[data-ics-day]");
      if (ics) {
        var day = byId(D.schedule.days, ics.getAttribute("data-ics-day"));
        var tier = ics.getAttribute("data-ics-tier");
        var copyDay = { id: day.id, date: day.date, label: day.label, sessions: day.sessions.filter(function (s) { return !tier || !s.tiers || s.tiers.indexOf(tier) > -1; }) };
        downloadIcs([copyDay], (D.meta.shortName || "event") + "-" + day.id + ".ics");
        return;
      }
      // Links into a schedule session (wall, speaker cards) go through goToSession.
      var a = t.closest('a[href^="#session-"]');
      if (a && goToSession(a.getAttribute("href").slice(1))) e.preventDefault();
    });
  }

  function renderChrome() {
    var m = D.meta, on = D.sections.filter(function (s) { return s.on && R[s.id]; });
    document.title = m.pageTitle || m.name;
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", String(m.description || "").replace(/\[PLACEHOLDER\]\s?/g, ""));
    if (m.placeholderNotice) { $("notice").textContent = m.placeholderNotice; $("notice").hidden = false; }
    $("brand").innerHTML = '<span class="brand-name">' + esc(m.host) + "</span>";
    $("brand").setAttribute("aria-label", m.host + ", " + m.name + ", back to top");
    var navOn = on.filter(function (s) { return s.nav !== false; });
    $("nav").innerHTML = navOn.filter(function (s) { return s.id !== "register"; }).map(function (s) {
      return '<li><a href="#' + s.id + '">' + esc(s.label) + "</a></li>";
    }).join("");
    $("header-cta").setAttribute("href", D.header.cta.href);
    $("header-cta").textContent = D.header.cta.label;
    $("sections").innerHTML = on.map(function (s) { return R[s.id](); }).join("");
    $("footer").innerHTML = '<div class="wrap footer-inner"><p class="footer-word">' + esc(m.host) + "</p>" +
      '<nav aria-label="Footer"><ul class="footer-links">' + navOn.map(function (s) { return '<li><a href="#' + s.id + '">' + esc(s.label) + "</a></li>"; }).join("") + "</ul></nav>" +
      '<p class="footer-small mono">' + esc(m.name) + " · " + esc(m.dateLine) + "</p>" +
      '<p class="footer-small">' + esc(m.footerLine || "") + "</p></div>";
  }

  // ---------- save card: 1200x630 PNG via canvas ----------
  function cssVar(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }
  function hexRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.replace(/(.)/g, "$1$1");
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function loadImage(src) {
    return new Promise(function (res) {
      if (!src) { res(null); return; }
      var im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = function () { res(im); };
      im.onerror = function () { res(null); };
      im.src = src;
    });
  }
  function wrapLines(ctx, text, maxW) {
    var words = String(text).split(" "), lines = [], line = "";
    words.forEach(function (w) {
      var test = line ? line + " " + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }
  function saveCard(o, filename) {
    var W = 1200, H = 630, P = 56;
    var host = cssVar("--host", "#FFC629"), onHost = cssVar("--on-host", "#101218"), ink = cssVar("--ink", "#101218");
    var numeralColor = cssVar("--host-deep", "#F0B000");
    var display = cssVar("--display", "sans-serif"), body = cssVar("--body", "sans-serif"), mono = cssVar("--mono", "monospace");
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.all([fontsReady, o.canvas ? Promise.resolve(o.canvas) : loadImage(o.photo ? wallPhoto(o.photo) : "")]).then(function (r) {
      var photo = r[1];
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var ctx = cv.getContext("2d");
      var canStretch = "fontStretch" in ctx;
      function setFont(spec, stretch) { ctx.font = spec; if (canStretch) ctx.fontStretch = stretch || "normal"; }
      ctx.fillStyle = host; ctx.fillRect(0, 0, W, H);
      var floorY = H - 96, textW = W - P * 2;
      // The cue numeral behind the name, cut off by the floor line.
      if (o.numeral) {
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, floorY); ctx.clip();
        ctx.fillStyle = numeralColor; setFont("800 400px " + display);
        ctx.fillText(o.numeral, P - 20, floorY + 90);
        ctx.restore();
      }
      if (photo) {
        // Duotone, ink to host: luminance picks a point between the two colors.
        var pw = 380, ph = floorY - P, px = W - P - pw, py = P;
        var off = document.createElement("canvas"); off.width = pw; off.height = ph;
        var o2 = off.getContext("2d");
        if (o.canvas) {
          var s = Math.max(pw / photo.width, ph / photo.height), sw = pw / s, sh = ph / s;
          o2.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, 0, 0, pw, ph);
        } else {
          var fr = wallFrame(pw, ph); // same framing as the wall
          o2.drawImage(photo, fr.x, fr.y, fr.w, fr.h);
        }
        try {
          if (!o.canvas) duotone(o2, pw, ph); // a walk-up photo is already duotoned
          ctx.drawImage(off, px, py);
          textW = px - P - 32;
        } catch (e) { /* tainted canvas: leave the photo out */ }
      }
      ctx.fillStyle = onHost;
      ctx.textBaseline = "alphabetic";
      setFont("800 56px " + display, "semi-expanded");
      ctx.fillText(o.label, P, P + 50);
      // Name: 110px, narrowed (not shrunk) to fit one line; two lines only as a last resort.
      var size = 110, n = splitName(o.name), lines = [o.name];
      var widths = ["semi-expanded", "normal", "semi-condensed", "condensed", "extra-condensed"], wi = 0;
      setFont("800 " + size + "px " + display, widths[wi]);
      while (ctx.measureText(o.name).width > textW && wi < widths.length - 1) { wi++; setFont("800 " + size + "px " + display, widths[wi]); }
      if (ctx.measureText(o.name).width > textW) lines = [n.first, n.last];
      var y = P + 50 + 24 + size * 0.86;
      lines.forEach(function (ln, k) { ctx.fillText(ln, P, y + k * size * 0.92); });
      y += (lines.length - 1) * size * 0.92 + 56;
      setFont("700 32px " + body);
      wrapLines(ctx, o.title, textW).slice(0, 3).forEach(function (ln, k) { ctx.fillText(ln, P, y + k * 40); });
      ctx.fillRect(P, floorY, W - P * 2, 3);
      setFont("500 24px " + mono);
      ctx.fillText(o.cue, P, floorY + 50);
      setFont("800 26px " + display, "semi-expanded");
      var mark = D.meta.host;
      ctx.fillText(mark, W - P - ctx.measureText(mark).width, floorY + 50);
      // Standing figure on the floor line, for scale.
      ctx.save(); ctx.translate((photo ? W - P - 380 - 34 : W - P - 40), floorY - 64); ctx.scale(64 / 56, 64 / 56);
      ctx.beginPath(); ctx.arc(10, 5, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fill(new Path2D("M5 12h10l1.5 20h-3L13 54H10.8L10 36l-.8 18H7l-.5-22h-3z"));
      ctx.restore();
      cv.toBlob(function (blob) { if (blob) saveBlob(blob, filename); }, "image/png");
    });
  }

  // ---------- URL switches ----------
  function applyNameParam() {
    if (!NAME_PARAM) return;
    if (SHOT) {
      var sd = D.registration.shotDefaults, tier = byId(D.tickets.tiers, sd.tier);
      setTier(tier.id);
      confirmReg({ name: NAME_PARAM, company: sd.company, tier: tier, size: "" }, false);
      return;
    }
    var n = splitName(NAME_PARAM);
    if ($("f-first")) $("f-first").value = n.first;
    if ($("f-last")) $("f-last").value = n.last;
  }
  function markShotReady() {
    if (!SHOT) return;
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fonts.then(function () {
      fitNames();
      root.setAttribute("data-shot-fonts", "1");
      var imgs = Array.prototype.slice.call(document.images);
      return Promise.all(imgs.map(function (im) {
        if (im.complete) return Promise.resolve();
        return new Promise(function (res) { im.addEventListener("load", res); im.addEventListener("error", res); });
      }));
    }).then(function () { root.setAttribute("data-shot-ready", "1"); });
    // Never leave the page hidden if font loading stalls.
    setTimeout(function () { root.setAttribute("data-shot-fonts", "1"); }, 4000);
  }

  function showError(err) {
    $("notice").hidden = false;
    $("notice").classList.add("is-error");
    $("notice").textContent = "Content failed to load from data/event.json.";
    $("hero").innerHTML = '<h1 id="hero-title">Content did not load</h1><p>Open this page from a web server (GitHub Pages, or python3 -m http.server), not straight from disk. Detail: ' + esc(err && err.message) + "</p>";
    root.setAttribute("data-shot-fonts", "1");
  }

  fetch("data/event.json", { cache: "no-cache" })
    .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
    .then(function (data) {
      D = data;
      buildCues();
      if (SHOT) {
        var q = parseInt(Q.get("q"), 10);
        state.cue = q >= 1 && q <= CUES.length ? q - 1 : 0;
      }
      renderHero();
      renderChrome();
      wireWall(); wireTabs(); wireMatrix(); wireForm(); wireGlobal(); wirePhrases();
      applyNameParam();
      fitNames();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitNames);
      window.addEventListener("resize", fitNames);
      markShotReady();
      if (!SHOT && location.hash.length > 1) {
        var id = location.hash.slice(1);
        if (/^session-/.test(id)) goToSession(id);
        else {
          var target = $(id);
          if (target) target.scrollIntoView({ behavior: smoothOK() ? "smooth" : "instant" });
        }
      }
    })
    .catch(showError);
})();
