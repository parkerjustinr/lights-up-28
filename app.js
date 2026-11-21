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
  function copy(v) { return esc(times(v)).replace(/\[PLACEHOLDER\]\s?/g, '<span class="ph">Placeholder</span> '); }
  // Times written in copy as {{2028-04-11 18:30}} (event time) follow "Show my time", with a zone label.
  // "|day" adds the date; a later time in the same string only repeats the date if it differs.
  function times(v) {
    var lastDay = "";
    return String(v == null ? "" : v).replace(/\{\{(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(\|day)?\}\}/g, function (m, date, time, withDay) {
      if (!D) return m;
      var t = zoned(date, time), tz = viewTz();
      var day = t.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz });
      var showDay = withDay || (lastDay && day !== lastDay);
      lastDay = day;
      return (showDay ? day + ", " : "") + fmtTime(t) + " " + tzShort(tz, t);
    });
  }
  function $(id) { return document.getElementById(id); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function trackIndex(id) { for (var i = 0; i < D.tracks.length; i++) if (D.tracks[i].id === id) return i + 1; return 0; }
  function splitName(full) {
    var s = String(full || "").trim().replace(/\s+/g, " "), i = s.lastIndexOf(" ");
    return i < 0 ? { first: s, last: "" } : { first: s.slice(0, i), last: s.slice(i + 1) };
  }
  // Unsplash sizing: photos are stored as bare URLs in the data and sized here.
  // facearea + crop=faces centers the face in every crop; facepad sets how much head and shoulders show.
  // A photo URL that already carries ?rect= (a hand-set crop, for originals with little headroom) keeps
  // that crop and is only fitted to size.
  function img(url, w, h, pad) {
    if (!url) return "";
    // Small thumbnails go back to the face crop, so the face fills them.
    if (url.indexOf("?") > -1 && w <= 96) url = url.split("?")[0];
    else if (url.indexOf("?") > -1) return url + "&w=" + w + "&h=" + h + "&fit=crop&crop=faces&auto=format&q=70";
    return url + "?w=" + w + "&h=" + h + "&fit=facearea&facepad=" + (pad || 2.6) + "&crop=faces&auto=format&q=70";
  }
  // Wall photos: a little more zoomed out than the cards, so the CSS framing has headroom to work with.
  var WALL_W = 760, WALL_H = 900, EYE = 0.465, EYE_AT = 0.38;
  // Wall photo size: the standard 760x900, or the hand-set crop's own shape when the URL carries ?rect=.
  function wallSize(url) {
    var m = /rect=\d+,\d+,(\d+),(\d+)/.exec(url || "");
    return m ? { w: 900, h: Math.round(900 * (+m[2]) / (+m[1])) } : { w: WALL_W, h: WALL_H };
  }
  function wallPhoto(url) { var z = wallSize(url); return img(url, z.w, z.h, 4.6); }
  // Box for a wall photo inside a W x H frame: eyes at 38% of the frame, frame fully covered.
  function wallFrame(W, H, eye, ar) {
    ar = ar || WALL_H / WALL_W;
    var E = eye || EYE;
    var ih = Math.max(W * ar, (EYE_AT * H) / E, ((1 - EYE_AT) * H) / (1 - E));
    var iw = ih / ar;
    return { w: iw, h: ih, x: (W - iw) / 2, y: EYE_AT * H - E * ih };
  }
  // Every wall-shaped stage (the wall and the program monitor's copy of it).
  function frameWallPhotos() {
    Array.prototype.forEach.call(document.querySelectorAll(".wall .stage-photo"), function (box) {
      Array.prototype.forEach.call(box.querySelectorAll("img.wall-shot"), function (im) {
        var f = wallFrame(box.clientWidth, box.clientHeight, parseFloat(im.getAttribute("data-eye")) || 0, (+im.getAttribute("height")) / (+im.getAttribute("width")));
        im.style.width = f.w + "px"; im.style.height = f.h + "px"; im.style.left = f.x + "px"; im.style.top = f.y + "px";
      });
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
    var loc = D.meta.icsLocation || [D.meta.venue, D.meta.city].filter(Boolean).join(", ");
    var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Event Kit//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
    days.forEach(function (day) {
      day.sessions.forEach(function (s) {
        var t = sessionTimes(day, s), tr = s.track ? byId(D.tracks, s.track) : null;
        lines.push("BEGIN:VEVENT", "UID:" + s.id + "-" + D.meta.year + "@event-kit", "DTSTAMP:" + D.meta.icsStamp,
          "DTSTART:" + icsStamp(t.start), "DTEND:" + icsStamp(t.end), "SUMMARY:" + icsText(D.meta.name + ": " + s.title),
          "DESCRIPTION:" + icsText([tr ? tr.name : "", s.detail].filter(Boolean).join(". ")), "LOCATION:" + icsText(loc), "END:VEVENT");
      });
    });
    lines.push("END:VCALENDAR");
    saveBlob(new Blob([lines.map(icsFold).join("\r\n")], { type: "text/calendar;charset=utf-8" }), filename);
  }
  // RFC 5545: lines longer than 75 octets fold, continuing on a line that starts with one space.
  function icsFold(line) {
    var out = [], cur = "", bytes = 0, limit = 75;
    Array.from(line).forEach(function (ch) {
      var b = unescape(encodeURIComponent(ch)).length;
      if (bytes + b > limit) { out.push(cur); cur = " "; bytes = 1; limit = 75; }
      cur += ch; bytes += b;
    });
    out.push(cur);
    return out.join("\r\n");
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
    if (c.visitor) return c.cue + " · " + D.wall.you.cueLine + " · " + D.tracks[0].name;
    var t = zoned(c.day.date, c.s.start), tr = byId(D.tracks, c.s.track), tz = viewTz();
    var day = tz === D.meta.timezone ? c.day.short : t.toLocaleDateString("en-US", { weekday: "short", timeZone: tz });
    return c.cue + " · " + day + " " + fmtTime(t) + " " + tzShort(tz, t) + (tr ? " · " + tr.name : "");
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
  // The wall's markup. The program monitor renders the same markup (main = false: no ids, lazy photos).
  function stageMarkup(main) {
    var w = D.wall, c = CUES[state.cue];
    function id(x) { return main ? ' id="' + x + '"' : ""; }
    var photos = CUES.map(function (x, i) {
      // All six photos are in the DOM (eager on the wall), so a cut never shows a blank.
      var z = wallSize(x.sp.photo);
      return '<img src="' + esc(wallPhoto(x.sp.photo)) + '" alt="" class="wall-shot" width="' + z.w + '" height="' + z.h + '" loading="' + imgLoading(main) + '"' + (main ? ' decoding="sync"' : "") + (x.sp.photoEye ? ' data-eye="' + x.sp.photoEye + '"' : "") + ' data-cue="' + i + '"' + (i === state.cue ? "" : " hidden") + ">";
    }).join("");
    var strip = CUES.map(function (x, i) {
      return '<li><button type="button" class="cue-btn" data-cue="' + i + '"><span class="cue-q">' + esc(x.cue) + '</span><span class="cue-state" aria-hidden="true"></span></button></li>';
    }).join("");
    return '<div class="stage wall"' + (main ? ' id="wall" role="region" aria-label="Keynote wall"' : "") + ">" +
        '<div class="stage-body">' +
          '<p class="stage-numeral"' + id("wall-numeral") + ' aria-hidden="true">' + esc(c.cue) + "</p>" +
          '<div class="stage-copy">' + stageCopy({ label: w.label, name: c.sp.name, title: c.s.title, cue: cueLine(c),
            nameId: main && "wall-name", titleId: main && "wall-title", cueId: main && "wall-cue",
            after: ' <a class="stage-link"' + id("wall-link") + ' href="#session-' + esc(c.s.id) + '">' + esc(w.agendaLink) + "</a>" }) + "</div>" +
          '<div class="stage-photo" aria-hidden="true">' + photos + '<span class="scanline" hidden></span></div>' +
          '<div class="queue"' + id("queue") + ' aria-hidden="true">' + CUES.map(function (x, k) { return queueFigure(k); }).join("") + "</div>" +
        "</div>" +
        '<div class="stage-floor" aria-hidden="true"></div>' +
        '<div class="wall-controls">' +
          '<ol class="cue-strip" aria-label="Cues">' + strip + "</ol>" +
          '<button type="button" class="go-btn"' + id("go-btn") + '><span class="go-ring" aria-hidden="true"></span><span class="go-text">' + esc(w.goText) + "</span></button>" +
          '<p class="wall-caption">' + esc(w.caption) + "</p>" +
        "</div>" +
        (main ? '<p class="sr" aria-live="polite" id="wall-live"></p>' : "") +
      "</div>";
  }
  function renderHero() {
    var h = D.hero, m = D.meta;
    $("hero-moment").innerHTML = stageMarkup(true);
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
  var Qs = { busy: false, timers: [], anims: [] };
  // Queue helpers take a stage root: the wall by default, or the program monitor's copy.
  function figs(root) { return Array.prototype.slice.call((root || $("wall")).querySelectorAll(".queue .qf")); }
  function figK(k, root) { return (root || $("wall")).querySelector('.queue .qf[data-k="' + k + '"]'); }
  function qGeom(root) {
    root = root || $("wall");
    var lane = root.querySelector(".queue"), photo = root.querySelector(".stage-photo");
    var wide = window.matchMedia("(min-width: 720px)").matches;
    // Unscaled layout coordinates (the monitor's copy is scaled down with a transform).
    var lr = { left: lane.offsetLeft, width: lane.offsetWidth }, pr = { left: photo.offsetLeft };
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
  function move(f, x0, x1, steps, dur, delay, bag) {
    setX(f, x0);
    if (!f.animate) { setX(f, x1); return; }
    var a = f.animate(walkKF(x0, x1, steps, steps > 1 ? 3 : 2), { duration: dur, delay: delay || 0, easing: "linear", fill: "both" });
    (bag || Qs.anims).push(a);
    a.onfinish = function () { setX(f, x1); a.cancel(); };
  }
  function later(ms, fn) { Qs.timers.push(setTimeout(fn, ms)); }
  function placeQueue(i, root) {
    root = root || $("wall");
    if (!root || !root.querySelector(".queue")) return;
    var g = qGeom(root);
    figs(root).forEach(function (f) {
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
  function photoReveal(root, bag) {
    root = root || $("wall"); bag = bag || Qs.anims;
    var box = root && root.querySelector(".stage-photo"), now = performance.now();
    if (!box || SHOT || now - (box._lastBand || -1000) < 340) return;
    var shot = box.querySelector("[data-cue]:not([hidden])"), line = box.querySelector(".scanline");
    if (!shot || !shot.animate) return;
    box._lastBand = now;
    var base = getComputedStyle(shot).filter, bright = base && base !== "none" ? base + " brightness(1.35)" : "brightness(1.35)";
    var ease = "cubic-bezier(0.33, 1, 0.68, 1)";
    // Open from the frame's middle line, even when the photo box is taller than the frame.
    var mid = box.clientHeight / 2 - shot.offsetTop, h = shot.offsetHeight || 1, top = Math.max(0, Math.min(100, (mid / h) * 100));
    shot.style.transformOrigin = "50% " + mid + "px";
    bag.push(shot.animate([
      { clipPath: "inset(" + top + "% 0 " + (100 - top) + "% 0)", transform: "scale(1.06)", filter: bright },
      { clipPath: "inset(0% 0 0% 0)", transform: "scale(1)", filter: base && base !== "none" ? base : "none" }
    ], { duration: 380, delay: 70, easing: ease, fill: "backwards" }));
    if (line) {
      line.hidden = false;
      var la = line.animate([{ opacity: 1, transform: "scaleY(1)" }, { opacity: 1, offset: 0.16 }, { opacity: 0, transform: "scaleY(1)" }], { duration: 450, easing: "linear" });
      bag.push(la);
      la.onfinish = function () { line.hidden = true; };
    }
  }
  // ---------- Lights up: first-load entrance (tier 1, skipped by ?shot=1) ----------
  // The wall starts as flat ink with the floor line and cue strip showing. At 250ms it powers on like
  // a screen (a paper line across the middle opens to full height, about 450ms), then the five waiting
  // figures walk in from the left (600ms). Text never animates. Any press skips to the end state.
  // `delay` holds the ink state longer: the opening overlay lifts first.
  var ENT = { on: false, timers: [], anims: [] };
  function startEntrance(delay) {
    var wall = $("wall"), floor = wall && wall.querySelector(".stage-floor"), d = delay || 0;
    if (!wall || !floor || SHOT || !document.body.animate) return;
    ENT.on = true;
    wall.insertAdjacentHTML("beforeend", '<div class="power" id="power" aria-hidden="true"><i class="pw-top"></i><i class="pw-bot"></i><span class="pw-line"></span></div>');
    $("power").style.height = floor.offsetTop + "px"; // the whole wall above the floor line
    figs().forEach(function (f) { f.style.visibility = "hidden"; });
    var ease = "cubic-bezier(0.33, 1, 0.68, 1)", pw = $("power");
    ENT.timers.push(setTimeout(function () {
      ENT.anims.push(pw.querySelector(".pw-line").animate([{ opacity: 1 }, { opacity: 1, offset: 0.16 }, { opacity: 0 }], { duration: 450, easing: "linear", fill: "forwards" }));
      ["pw-top", "pw-bot"].forEach(function (c) {
        ENT.anims.push(pw.querySelector("." + c).animate([{ transform: "scaleY(1)" }, { transform: "scaleY(0)" }], { duration: 380, delay: 70, easing: ease, fill: "forwards" }));
      });
    }, 250 + d));
    ENT.timers.push(setTimeout(function () {
      if (pw.parentNode) pw.remove();
      var g = qGeom();
      figs().forEach(function (f) {
        var k = +f.getAttribute("data-k");
        if (k <= state.cue) return;
        f.style.visibility = "visible";
        move(f, g.enter, slotX(g, k - state.cue - 1), 3, 600);
        ENT.anims.push(Qs.anims[Qs.anims.length - 1]);
      });
    }, 700 + d));
    ENT.timers.push(setTimeout(function () { ENT.on = false; }, 1320 + d));
  }

  // ---------- the opening: LIGHTS UP on ink, once per browser session (tier 1) ----------
  // A full-viewport ink overlay. The letters start as dark outlines and light solid host one at a
  // time, 110ms apart, hold 300ms, then the overlay lifts (opacity, 350ms) and the wall entrance plays.
  // About 2.7s in all. Any click, tap, key or scroll skips to the settled page. aria-hidden, never
  // focusable, so focus is never trapped. ?shot=1, a hash or ?n= in the URL skip it.
  var OP = { el: null, timers: [], evs: ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] };
  var OP_KEY = "intro:lights-up";
  function opSeen() { try { return window.sessionStorage.getItem(OP_KEY) === "1"; } catch (e) { return false; } }
  function opMark() { try { window.sessionStorage.setItem(OP_KEY, "1"); } catch (e) { /* plays once per load instead */ } }
  function startOpening() {
    if (SHOT) return;
    if (opSeen() || location.hash.length > 1 || NAME_PARAM || !document.body.animate) { startEntrance(0); return; }
    opMark();
    var n = 0, rows = D.intro.lines.map(function (w) {
      return '<span class="op-row">' + w.split("").map(function (c) { n++; return '<span class="op-l">' + esc(c) + "</span>"; }).join("") + "</span>";
    }).join(" ");
    document.body.insertAdjacentHTML("beforeend", '<div class="opening" id="opening" aria-hidden="true"><p class="op-big">' + rows + "</p></div>");
    OP.el = $("opening");
    opFit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(opFit);
    var L = OP.el.querySelectorAll(".op-l"), first = 120, step = 110, hold = first + (L.length - 1) * step + 300;
    Array.prototype.forEach.call(L, function (l, k) { OP.timers.push(setTimeout(function () { l.classList.add("on"); }, first + k * step)); });
    OP.timers.push(setTimeout(function () {
      var a = OP.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: "ease-out", fill: "forwards" });
      a.onfinish = opEnd;
    }, hold));
    startEntrance(hold + 200);
    OP.evs.forEach(function (ev) { window.addEventListener(ev, skipOpening, { capture: true, passive: true }); });
  }
  // Narrow the width axis so each row of the big word fits the screen.
  function opFit() {
    if (!OP.el) return;
    var big = OP.el.querySelector(".op-big"), cs = getComputedStyle(OP.el);
    var avail = OP.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var rows = big.querySelectorAll(".op-row");
    for (var w = 100; w >= 50; w -= 2) {
      big.style.fontStretch = w + "%";
      var ok = big.getBoundingClientRect().width <= avail + 1;
      for (var i = 0; i < rows.length; i++) if (rows[i].getBoundingClientRect().width > avail) ok = false;
      if (ok) break;
    }
  }
  function opEnd(keep) {
    OP.timers.forEach(clearTimeout); OP.timers = [];
    OP.evs.forEach(function (ev) { window.removeEventListener(ev, skipOpening, { capture: true }); });
    var el = OP.el;
    OP.el = null;
    if (!el || !el.parentNode) return;
    if (!keep) { el.remove(); return; }
    // A press that skips: the overlay vanishes now but stays under the pointer until the press ends,
    // so the same click never lands on a button underneath.
    el.style.opacity = "0";
    var gone = function () { if (el.parentNode) el.remove(); };
    el.addEventListener("click", function () { setTimeout(gone, 0); });
    setTimeout(gone, 700);
  }
  function skipOpening(e) {
    if (!OP.el) return;
    opEnd(e && (e.type === "pointerdown" || e.type === "touchstart"));
    endEntrance();
  }
  function endEntrance() {
    if (!ENT.on) return;
    ENT.on = false;
    ENT.timers.forEach(clearTimeout); ENT.timers = [];
    ENT.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* done */ } }); ENT.anims = [];
    var pw = $("power");
    if (pw) pw.remove();
    placeQueue(state.cue);
  }

  // GO: the front figure walks to the photo (600ms), the text cuts and the photo powers on (about 450ms),
  // the rest shuffle forward (300ms). From Q6, everyone runs back in from the left (1.5s max).
  function goNext() {
    endEntrance();
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
    endEntrance();
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

  // ---------- Q7 · YOU: the registrant joins the back of the queue (memory only) ----------
  var VIS = { joined: false, name: "", title: "", rec: null };
  function visitorCue() {
    return { cue: D.wall.you.cue, visitor: true, sp: { name: VIS.name }, s: { title: VIS.title, id: null, track: D.tracks[0].id }, day: null };
  }
  function dpr() { return Math.max(1, Math.min(3, window.devicePixelRatio || 1)); }
  // A duotone (ink to host) canvas of the visitor's original photo, cover-cropped to w x h, face kept
  // near the top third (the crop of an unknown photo can't find the face, so it favours the upper part).
  function youCanvas(w, h) {
    var src = WU.src, cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(w)); cv.height = Math.max(1, Math.round(h));
    if (!src) return cv;
    var ctx = cv.getContext("2d"), sc = Math.max(cv.width / src.width, cv.height / src.height);
    var sw = cv.width / sc, sh = cv.height / sc;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (src.width - sw) / 2, Math.max(0, Math.min(src.height - sh, src.height * 0.38 - sh * 0.38)), sw, sh, 0, 0, cv.width, cv.height);
    duotone(ctx, cv.width, cv.height);
    return cv;
  }
  // The visitor's figure: the plain figure with a 2px paper outline. With a photo, a small square speech
  // bubble rides above the head (inside the wrapper, so it moves and hides with the figure).
  function youFigure() {
    var svg = '<svg viewBox="0 0 28 60" focusable="false"><circle class="you-ring" cx="12" cy="6" r="5"/>' +
      '<path class="you-ring" d="M6 13h12l2 22h-3.2L15.4 60h-3L12 39l-.4 21h-3L7.2 35H4z"/></svg>';
    var bubble = WU.src ? '<span class="you-bubble"><canvas width="132" height="132"></canvas></span>' : "";
    return '<div class="qf qf-you is-you" data-k="6" style="--h:58px">' + bubble + svg + "</div>";
  }
  // The bubble photo: drawn at 3x the bubble size from the original image, duotoned, no CSS filters.
  // Every bubble (wall queue, monitor queue, the cast) is drawn from the original.
  function drawYouBubble() {
    var src = WU.src;
    Array.prototype.forEach.call(document.querySelectorAll(".wall"), function (w) { w.classList.toggle("has-bubble", !!src && VIS.joined); });
    if (!src) return;
    Array.prototype.forEach.call(document.querySelectorAll(".you-bubble canvas"), function (cv) {
      var S = cv.width, ctx = cv.getContext("2d"), side = src.width * 0.56;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(src, (src.width - side) / 2, Math.max(0, src.height * 0.34 - side / 2), side, side, 0, 0, S, S);
      duotone(ctx, S, S);
    });
  }
  function youShot() {
    return WU.src
      ? '<canvas class="wall-you" data-cue="6" aria-hidden="true"></canvas>'
      : '<div class="wall-empty" data-cue="6">' + queueFigure(0) + "</div>";
  }
  // Q7's wall photo is drawn at the frame's real pixel size times devicePixelRatio, no CSS filters.
  function drawYouWall() {
    if (!WU.src) return;
    Array.prototype.forEach.call(document.querySelectorAll(".wall .stage-photo"), function (box) {
      var cv = box.querySelector("canvas.wall-you");
      if (!cv) return;
      // The frame's real pixel size: the monitor's copy is scaled down, so it needs fewer pixels.
      var r = box.getBoundingClientRect(), sc = box.clientWidth ? r.width / box.clientWidth : 1;
      var w = box.clientWidth * sc * dpr(), h = box.clientHeight * sc * dpr(), src = youCanvas(w, h);
      cv.width = src.width; cv.height = src.height;
      cv.getContext("2d").drawImage(src, 0, 0);
    });
  }
  function stages() { return Array.prototype.slice.call(document.querySelectorAll(".wall")); }
  function refreshVisitor() {
    CUES[CUES.length - 1] = visitorCue();
    stages().forEach(function (root) {
      var old = root.querySelector('.stage-photo [data-cue="6"]');
      if (old) { old.insertAdjacentHTML("afterend", youShot()); old.remove(); }
      var f = figK(6, root);
      if (f) { var x = f._x, vis = f.style.visibility; f.insertAdjacentHTML("afterend", youFigure()); f.remove(); f = figK(6, root); setX(f, x); f.style.visibility = vis; }
    });
    drawYouBubble(); frameWallPhotos(); drawYouWall();
    if (!Qs.busy) placeQueue(state.cue);
    cutTo(state.cue, false);
    monPaint(MON.cue);
  }
  function joinQueue(rec, opts) {
    opts = opts || {};
    endEntrance();
    VIS.rec = rec; VIS.name = rec.name; VIS.title = regLine(rec);
    if (VIS.joined) { refreshVisitor(); }
    else {
      VIS.joined = true;
      CUES.push(visitorCue());
      var y = D.wall.you;
      stages().forEach(function (root) {
        root.querySelector(".cue-strip").insertAdjacentHTML("beforeend",
          '<li><button type="button" class="cue-btn is-you" data-cue="6"><span class="cue-q">' + esc(y.cue) + '</span><span class="cue-you" aria-hidden="true">' + esc(y.label) + '</span><span class="cue-state" aria-hidden="true"></span></button></li>');
        root.querySelector(".cue-strip").classList.add("has-you");
        root.querySelector(".scanline").insertAdjacentHTML("beforebegin", youShot());
        root.querySelector(".stage-photo [data-cue='6']").hidden = true;
        root.querySelector(".queue").insertAdjacentHTML("beforeend", youFigure());
      });
      $("wall").querySelector('.cue-btn[data-cue="6"]').addEventListener("click", function () { jumpTo(6); });
      drawYouBubble(); frameWallPhotos(); drawYouWall();
      cutTo(state.cue, false);
      var f = figK(6), g = qGeom();
      f.style.visibility = "visible";
      if (SHOT || opts.silent || Qs.busy) placeQueue(state.cue);
      else move(f, g.enter, slotX(g, 6 - state.cue - 1), 4, 900);
    }
    castJoin(opts);
    monFit();
    if (SHOT || opts.liveMonitor) monLive(); else monStandby();
    if (!opts.silent) {
      var live = $("wall-live");
      live.textContent = "";
      setTimeout(function () { live.textContent = D.wall.you.joined; }, 30);
    }
  }

  // Paint one stage (the wall, or the program monitor's copy) on cue i. Hard cut, no fade, no slide.
  function paintStage(root, i) {
    var n = CUES.length, c = CUES[i];
    if (!root || !c) return;
    root.querySelector(".stage-name").innerHTML = nameHtml(c.sp.name);
    root.querySelector(".stage-numeral").textContent = c.cue;
    root.querySelector(".stage-title").textContent = c.s.title;
    root.querySelector(".stage-cue > span").textContent = cueLine(c);
    var link = root.querySelector(".stage-link");
    link.hidden = !!c.visitor;
    if (!c.visitor) link.setAttribute("href", "#session-" + c.s.id);
    var ph = root.querySelector(".stage-photo");
    if (ph) ph.classList.toggle("is-you", !!c.visitor && !!WU.src);
    Array.prototype.forEach.call(root.querySelectorAll(".stage-photo [data-cue]"), function (im) {
      im.hidden = +im.getAttribute("data-cue") !== i;
    });
    Array.prototype.forEach.call(root.querySelectorAll(".cue-btn"), function (b) {
      var k = +b.getAttribute("data-cue"), live = k === i, sb = k === (i + 1) % n, called = k < i;
      var x = CUES[k];
      b.classList.toggle("is-live", live);
      b.classList.toggle("is-standby", sb);
      b.classList.toggle("is-called", called);
      if (live) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      b.querySelector(".cue-state").innerHTML = sb ? '<span class="lamp"></span>' + esc(D.wall.standby) : "";
      b.setAttribute("aria-label", x.cue + ", " + x.sp.name + (x.visitor ? ", " + D.wall.you.aria : "") + (live ? ", " + D.wall.live : sb ? ", " + D.wall.standbyLong : called ? ", " + D.wall.called : ""));
    });
    fitName(root.querySelector(".stage-name"));
  }
  // Hard cut on the wall: everything swaps in the same frame. No fade, no slide.
  function cutTo(i, announce) {
    var n = CUES.length;
    i = ((i % n) + n) % n;
    state.cue = i;
    var c = CUES[i], next = CUES[(i + 1) % n];
    paintStage($("wall"), i);
    $("go-btn").setAttribute("aria-label", D.wall.goText + ": call " + next.cue + ", " + next.sp.name);
    markOnWall();
    // Before registering, the program monitor shows what the wall shows.
    if (MON.mode === "mirror") monPaint(i);
    if (announce) {
      var live = $("wall-live");
      live.textContent = "";
      setTimeout(function () { live.textContent = c.cue + ". " + c.sp.name + ". " + c.s.title + (/[.!?]$/.test(c.s.title) ? "" : "."); }, 30);
    }
  }

  // The agenda row of the keynote live on the wall carries an ON THE WALL tag. Follows every cut,
  // never switches the day tab. No tag on Q7 (the visitor has no session).
  function markOnWall() {
    Array.prototype.forEach.call(document.querySelectorAll(".s-onwall"), function (el) { el.parentNode.removeChild(el); });
    var c = CUES[state.cue], row = c && !c.visitor && c.s.id ? $("session-" + c.s.id) : null;
    if (!row) return;
    row.querySelector(".s-time").insertAdjacentHTML("beforeend", '<span class="s-onwall"><span class="s-onwall-dot" aria-hidden="true"></span>' + esc(D.schedule.onWallTag) + "</span>");
  }

  // Names fit by narrowing the Anybody width axis, never by shrinking the size.
  // Desktop: one line. Phone: each word on its own line. Instant, not motion.
  var WDTH_MAX = 110, WDTH_MIN = 60;
  function fitName(el) {
    if (!el) return;
    var w = WDTH_MAX;
    el.style.fontSize = "";
    el.style.fontStretch = w + "%";
    var box = el.clientWidth;
    function over() {
      var parts = el.querySelectorAll(".nm"), wide = el.scrollWidth > box + 1;
      for (var k = 0; k < parts.length && !wide; k++) if (parts[k].getBoundingClientRect().width > box + 1) wide = true;
      return wide;
    }
    while (over() && w > WDTH_MIN) { w -= 5; el.style.fontStretch = w + "%"; }
    // Only a long registrant name gets here: reduce the size as a last resort.
    var size = parseFloat(getComputedStyle(el).fontSize);
    while (over() && size > 32) { size -= 4; el.style.fontSize = size + "px"; }
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
    window.addEventListener("resize", function () { frameWallPhotos(); drawYouWall(); if (!Qs.busy && !ENT.on) placeQueue(state.cue); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!Qs.busy && !ENT.on) placeQueue(state.cue); });
  }

  // ---------- sections ----------
  var R = {};

  // About: a static ink band. The statement is the heading, its cue word in host.
  R.about = function () {
    var a = D.about;
    // One sentence per line.
    var line = (a.line.match(/[^.!?]+[.!?]*/g) || [a.line]).map(function (t) {
      var h = esc(t.trim());
      if (a.highlight) h = h.replace(a.highlight, '<span class="ab-hi">' + esc(a.highlight) + "</span>");
      return '<span class="ab-s">' + h + "</span>";
    }).join(" ");
    return '<section class="about" id="about" aria-labelledby="about-title"><div class="wrap ab-inner">' +
      '<h2 class="ab-line" id="about-title">' + line + "</h2>" +
      '<p class="ab-desc">' + copy(a.description) + "</p></div></section>";
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
    // The Stage: a 3:4 portrait panel per keynote, standing on an ink floor band.
    function panel(p) {
      var f = first(p.id), ci = CUES.findIndex(function (c) { return c.sp && c.sp.id === p.id; });
      return '<li class="st-panel" id="speaker-' + p.id + '">' +
        '<p class="st-cue">' + esc(f.s.cue) + "</p>" +
        '<div class="st-photo duo">' + (p.photo
          ? '<img src="' + esc(img(p.photo, 480, 640)) + '" alt="" width="480" height="640" loading="' + imgLoading(false) + '">'
          : '<span class="sp-initials" aria-hidden="true">' + esc(initials(p.name)) + "</span>") + "</div>" +
        '<div class="st-info"><h3 class="st-name">' + esc(p.name) + '</h3><p class="st-role">' + esc(p.role) + '</p><p class="st-co">' + esc(p.company) + "</p>" +
        (p.place ? '<p class="st-co">' + esc(p.place) + "</p>" : "") +
        '<p class="st-links">' + link(p) + (ci > -1 ? '<button type="button" class="st-wall" data-wall-cue="' + ci + '" aria-label="' + esc(sp.wallLink + ": " + p.name) + '">' + esc(sp.wallLink) + "</button>" : "") + "</p></div></li>";
    }
    function row(p) {
      return '<li class="sp-row" id="speaker-' + p.id + '">' + photo(p, 160, 160) +
        '<div class="sp-row-text"><h3 class="sp-name">' + esc(p.name) + '</h3><p class="sp-role">' + esc(p.role) + ' <span class="sp-company">' + esc(p.company) + (p.place ? ", " + esc(p.place) : "") + "</span></p></div>" + link(p) + "</li>";
    }
    var keynote = sp.items.filter(function (p) { var f = first(p.id); return f && f.s.cue; });
    keynote.sort(function (a, b) { return parseInt(first(a.id).s.cue.slice(1), 10) - parseInt(first(b.id).s.cue.slice(1), 10); });
    var others = sp.items.filter(function (p) { return keynote.indexOf(p) < 0; });
    return '<section class="section sec-speakers" id="speakers" aria-labelledby="speakers-title"><div class="st-cone" aria-hidden="true"></div>' +
      '<div class="wrap"><h2 class="section-title" id="speakers-title">' + copy(sp.heading) + "</h2>" +
      (sp.intro ? '<p class="lede">' + copy(sp.intro) + "</p>" : "") +
      '<h3 class="sp-group">' + esc(sp.keynoteHeading) + "</h3></div>" +
      '<div class="st-grid"><div class="st-floor" aria-hidden="true"></div><ul class="st-panels">' + keynote.map(panel).join("") + "</ul></div>" +
      '<div class="wrap"><h3 class="sp-group">' + esc(sp.boothHeading) + '</h3><ul class="sp-booth">' + others.map(row).join("") + "</ul></div></section>";
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
        '<tr class="m-detail" id="detail-' + row.id + '" hidden><td colspan="' + (t.tiers.length + 1) + '"><p class="m-detail-text">' + copy(row.detail || "") + "</p></td></tr>";
    });
    var table = '<table class="matrix" id="matrix" style="--tiers:' + t.tiers.length + '"><caption class="sr">What each registration type includes</caption>' + head + "<tbody>" + body + "</tbody></table>";
    return sectionShell("tickets", t.heading,
      (t.intro ? '<p class="lede">' + copy(t.intro) + "</p>" : "") +
      '<fieldset class="matrix-wrap"><legend class="sr">Choose a registration type</legend><div class="matrix-layout">' + table + "</div></fieldset>" +
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
      // Metro map: Line 1 as flat ink lines, the venue as a host dot, the equator and the shuttle dashed.
      (v.map ? '<figure class="metro" id="metro-map">' + metroSvg(v.map, false) + metroSvg(v.map, true) +
        '<figcaption class="metro-cap">' + esc(v.map.caption) + "</figcaption></figure>" : "") +
      '<div class="venue-layout">' +
      (f ? '<div class="venue-feature">' + '<h3>' + esc(f.title) + (f.tag ? ' <span class="venue-tag">' + esc(f.tag) + "</span>" : "") + "</h3><p>" + copy(f.body) + "</p></div>" : "") +
      '<dl class="ruled">' + v.items.map(function (x) { return "<div><dt>" + esc(x.title) + "</dt><dd>" + copy(x.body) + "</dd></div>"; }).join("") + "</dl></div>" +
      (v.mapLink ? '<a class="btn btn-small" href="' + esc(v.mapLink) + '">Open in maps</a>' : ""));
  };

  // Metro map SVG. Desktop: horizontal, north to the right (east is down). Phones: vertical, north
  // at the top (east is right). Stations sit evenly spaced; only La Carolina is named.
  function metroSvg(m, vert) {
    var n = m.stations, vi = m.venueStation - 1, out = [], eq = m.equator.split(" · ");
    function t(x, y, str, cls, anchor) { return '<text x="' + x + '" y="' + y + '" class="' + cls + '"' + (anchor ? ' text-anchor="' + anchor + '"' : "") + ">" + esc(str) + "</text>"; }
    function ln(x1, y1, x2, y2, cls) { return '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" class="' + cls + '"/>'; }
    var W, H, P = [], i;
    if (!vert) {
      W = 1000; H = 290;
      for (i = 0; i < n; i++) P.push([50 + i * 50, 150]);
      var vx = P[vi][0], end = P[n - 1][0];
      out.push(ln(950, 16, 950, 274, "mm-dash"), t(936, 36, eq[0], "mm-b", "end"), t(936, 56, eq[1] || "", "mm-m", "end"));
      out.push(ln(vx, 150, 680, 250, "mm-dash"), t(640, 222, m.shuttle, "mm-m", "end"));
      out.push(ln(P[0][0], 150, end, 150, "mm-line"));
      for (i = 1; i < n - 1; i++) if (i !== vi) out.push(ln(P[i][0], 136, P[i][0], 150, "mm-tick"));
      out.push('<rect x="672" y="242" width="16" height="16" class="mm-node"/>', t(698, 256, m.airport, "mm-b", "start"));
      out.push('<circle cx="' + P[0][0] + '" cy="150" r="8" class="mm-end"/>', '<circle cx="' + end + '" cy="150" r="8" class="mm-end"/>');
      out.push(t(P[0][0] - 8, 186, m.south, "mm-b", "start"), t(P[0][0] - 8, 206, m.southLabel, "mm-m", "start"));
      out.push(t(end, 186, m.north, "mm-b", "middle"), t(end, 206, m.northLabel, "mm-m", "middle"));
      out.push(ln(vx, 92, vx, 150, "mm-pole"), '<rect x="' + (vx - 344) + '" y="30" width="344" height="62" class="mm-flag"/>',
        t(vx - 330, 56, m.flag, "mm-fb", "start"), t(vx - 330, 80, m.venueLabel, "mm-fm", "start"));
      out.push('<circle cx="' + vx + '" cy="150" r="13" class="mm-venue"/>');
    } else {
      W = 360; H = 620;
      for (i = 0; i < n; i++) P.push([60, 580 - i * 30]);
      var vy = P[vi][1], top = P[n - 1][1];
      out.push(ln(16, 84, 344, 84, "mm-dash"), t(16, 44, eq[0], "mm-b"), t(16, 66, eq[1] || "", "mm-m"));
      out.push(ln(60, vy, 300, vy - 14, "mm-dash"), t(92, vy - 22, m.shuttle, "mm-m"));
      out.push(ln(60, P[0][1], 60, top, "mm-line"));
      for (i = 1; i < n - 1; i++) if (i !== vi) out.push(ln(46, P[i][1], 60, P[i][1], "mm-tick"));
      out.push('<rect x="292" y="' + (vy - 22) + '" width="16" height="16" class="mm-node"/>', t(344, vy - 34, m.airport, "mm-b", "end"));
      out.push('<circle cx="60" cy="' + P[0][1] + '" r="8" class="mm-end"/>', '<circle cx="60" cy="' + top + '" r="8" class="mm-end"/>');
      out.push(t(80, P[0][1] + 5, m.south, "mm-b"), t(80, P[0][1] + 25, m.southLabel, "mm-m"));
      out.push(t(80, top + 5, m.north, "mm-b"), t(80, top + 25, m.northLabel, "mm-m"));
      var fl = m.flag.split(" · ");
      out.push(ln(60, vy, 84, vy + 28, "mm-pole"), '<rect x="84" y="' + (vy + 22) + '" width="236" height="84" class="mm-flag"/>',
        t(98, vy + 46, fl[0], "mm-fb"), t(98, vy + 68, fl[1] || "", "mm-fm"), t(98, vy + 92, m.venueLabel, "mm-fm"));
      out.push('<circle cx="60" cy="' + vy + '" r="13" class="mm-venue"/>');
    }
    var id = "mm-title-" + (vert ? "v" : "h");
    return '<svg class="metro-svg ' + (vert ? "is-v" : "is-h") + '" viewBox="0 0 ' + W + " " + H + '" role="img" aria-labelledby="' + id + '" preserveAspectRatio="xMinYMin meet">' +
      '<title id="' + id + '">' + esc(m.title) + "</title>" + out.join("") + "</svg>";
  }

  // ---------- Say it in Quito: one phrase card at a time ----------
  // Phones (and browsers that can't speak or listen) get a plain phrasebook: no Listen, no Try it.
  function phBook() {
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return coarse || !("speechSynthesis" in window) || (!SR && !window.MediaRecorder);
  }
  R.phrases = function () {
    var ph = D.phrases, book = phBook();
    return '<section class="section sec-phrases' + (book ? " is-book" : "") + '" id="phrases" aria-labelledby="phrases-title"><div class="wrap">' +
      '<h2 class="section-title" id="phrases-title">' + esc(ph.heading) + "</h2>" +
      // The phrase on a paper cue card: counter and arrows in the top corner.
      '<div class="ph-card" id="ph-card">' +
        '<div class="ph-top"><p class="ph-count" id="ph-count"></p>' +
          '<button type="button" class="ph-arrow" id="ph-prev" aria-label="' + esc(ph.prev) + '"><span aria-hidden="true">&larr;</span></button>' +
          '<button type="button" class="ph-arrow" id="ph-next" aria-label="' + esc(ph.next) + '"><span aria-hidden="true">&rarr;</span></button></div>' +
        '<div class="ph-body" id="ph-body" aria-live="polite"></div>' +
      "</div>" +
      (book ? "" :
        '<ol class="ph-steps" id="ph-steps">' + ph.steps.map(function (t, k) { return '<li data-step="' + (k + 1) + '">' + (k + 1) + " " + esc(t) + "</li>"; }).join("") + "</ol>" +
        '<div class="ph-actions"><button type="button" class="btn btn-small ph-listen" id="ph-listen" hidden>' + esc(ph.listen) + "</button>" +
          '<button type="button" class="btn btn-small ph-rec" id="ph-try">' + esc(ph.try) + "</button>" +
          '<span class="ph-meter" id="ph-meter" aria-hidden="true" hidden><i></i><i></i><i></i><i></i><i></i></span></div>' +
        '<div class="ph-result" id="ph-result" aria-live="polite"></div>') +
      '<p class="ph-privacy">' + esc(book ? ph.phrasebook : ph.privacy) + "</p>" +
    "</div></section>";
  };
  var PH = { i: 0, voice: null, busy: false, rec: null, stream: null, timer: null, recordOnly: {}, audio: null };
  // A 0.05s silent WAV, played inside a tap to unlock audio playback on iOS.
  var SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";
  function phNorm(t) {
    return String(t).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }
  function phWords(t) { return phNorm(t).split(" ").filter(Boolean); }
  // Respelling chunks line up one-to-one with the phrase's words.
  function phSay(item) { return item.say.replace(/,/g, "").split(/\s+/); }
  function phRender() {
    var ph = D.phrases, item = ph.items[PH.i];
    function two(n) { return (n < 10 ? "0" : "") + n; }
    $("ph-count").textContent = two(PH.i + 1) + " / " + two(ph.items.length);
    // The stressed syllable is the capitalized one: bold it.
    var say = item.say.split(" ").map(function (w) { return '<span class="nw">' + esc(w).replace(/[A-ZÁÉÍÓÚÑ]{2,}/g, "<b>$&</b>") + "</span>"; }).join(" ");
    $("ph-body").innerHTML = '<p class="ph-es" lang="es">' + esc(item.es) + '</p><p class="ph-en">' + esc(item.en) + '</p><p class="ph-say">' + say + "</p>";
    if ($("ph-result")) $("ph-result").innerHTML = "";
    phStep(1);
  }
  // The three-step strip: the current step is bold paper, the others dimmed.
  function phStep(n) {
    Array.prototype.forEach.call(document.querySelectorAll("#ph-steps li"), function (li) {
      var on = +li.getAttribute("data-step") === n;
      li.classList.toggle("is-on", on);
      if (on) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
  }
  function phPickVoice() {
    if (!("speechSynthesis" in window)) return null;
    var vs = window.speechSynthesis.getVoices() || [], order = D.phrases.voiceLangs;
    function lang(v) { return String(v.lang || "").replace("_", "-").toLowerCase(); }
    // Among voices for one language, "Natural" or "Online" voices (Edge) come first.
    function best(list) {
      for (var q = 0; q < list.length; q++) if (/natural|online/i.test(list[q].name || "")) return list[q];
      return list[0] || null;
    }
    var last = order[order.length - 1].toLowerCase(); // es-ES is the last resort
    for (var k = 0; k < order.length - 1; k++) {
      var want = order[k].toLowerCase();
      var hit = best(vs.filter(function (v) { return lang(v) === want; }));
      if (hit) return hit;
    }
    var other = best(vs.filter(function (v) { var l = lang(v); return l.indexOf("es") === 0 && l !== last; }));
    return other || best(vs.filter(function (v) { return lang(v) === last; }));
  }
  // Voices load late on phones, so Listen is shown whenever the browser can speak at all.
  function phUpdateVoice() {
    PH.voice = phPickVoice();
    if ($("ph-listen")) $("ph-listen").hidden = phBook() || !("speechSynthesis" in window);
  }
  // Speak with the best Spanish voice, or lang es-ES with no voice set. onStart/onFail report whether it played.
  function phUtter(text, opts) {
    opts = opts || {};
    var u = new SpeechSynthesisUtterance(text);
    if (PH.voice) { try { u.voice = PH.voice; } catch (e) { /* lang below still picks Spanish */ } u.lang = PH.voice.lang; }
    else u.lang = "es-ES";
    u.rate = 0.85;
    var started = false, finished = false;
    function end() { if (finished) return; finished = true; if (opts.done) opts.done(started); }
    u.onstart = function () { started = true; };
    u.onend = end;
    u.onerror = end;
    window.speechSynthesis.speak(u);
    // Nothing started within 1.5s: treat it as no voice.
    setTimeout(function () { if (!started) { try { window.speechSynthesis.cancel(); } catch (e) { /* none */ } end(); } }, 1500);
  }
  function phSpeak(text, done) {
    if (!("speechSynthesis" in window)) { if (done) done(); return; }
    PH.voice = phPickVoice();
    phUtter(text, { done: function () { if (done) done(); } });
  }
  // Listen, inside the tap: cancel, find voices (waiting up to 1s for them to load), then speak.
  function phListen() {
    var ph = D.phrases, text = ph.items[PH.i].es, syn = window.speechSynthesis;
    if (!syn) return;
    phStep(2);
    syn.cancel();
    function go() {
      PH.voice = phPickVoice();
      phUtter(text, { done: function (started) { if (!started) $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noVoice) + "</p>"; } });
    }
    if ((syn.getVoices() || []).length) { go(); return; }
    var fired = false;
    function onVoices() { if (fired) return; fired = true; if (syn.removeEventListener) syn.removeEventListener("voiceschanged", onVoices); go(); }
    if (syn.addEventListener) syn.addEventListener("voiceschanged", onVoices);
    setTimeout(onVoices, 1000);
  }
  // Inside a tap: unlock audio playback and speech for later, async use (iOS needs both started by a gesture).
  function phUnlockAudio() {
    try {
      PH.audio = document.createElement("audio");
      PH.audio.setAttribute("playsinline", "");
      PH.audio.src = SILENT_WAV;
      var pr = PH.audio.play();
      if (pr && pr.catch) pr.catch(function () { /* the clip still tries later */ });
    } catch (e) { PH.audio = null; }
    try { if (window.speechSynthesis) { var u = new SpeechSynthesisUtterance(" "); u.volume = 0; window.speechSynthesis.speak(u); } } catch (e) { /* no speech */ }
  }
  // Compare word by word and show each phrase word as matched (solid ink) or missed (underlined).
  function phJudge(transcripts) {
    var ph = D.phrases, item = ph.items[PH.i], want = phWords(item.es), say = phSay(item), best = null;
    transcripts.forEach(function (t) {
      var got = phWords(t);
      // A phrase can list other spellings that count for a word, e.g. "seas" for "sea".
      var alt = item.accept || {};
      var marks = want.map(function (w) { return got.indexOf(w) > -1 || (alt[w] || []).some(function (a) { return got.indexOf(a) > -1; }); });
      var n = marks.filter(Boolean).length;
      if (!best || n > best.n) best = { t: t, marks: marks, n: n };
    });
    phStep(3);
    if (!best) { $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noSpeech) + "</p>"; return; }
    var esWords = item.es.split(/\s+/), missed = [], missedSay = [];
    var words = esWords.map(function (w, k) {
      if (!best.marks[k]) { missed.push(w.replace(/[¿?¡!.,]/g, "")); missedSay.push(say[k]); }
      return '<span class="ph-w ' + (best.marks[k] ? "is-hit" : "is-miss") + '">' + esc(w) + '<span class="sr">' + (best.marks[k] ? " (heard)" : " (missed)") + "</span></span>";
    }).join(" ");
    var msg = best.n === want.length ? esc(ph.nailed)
      : best.n * 2 >= want.length ? esc(ph.close) + " " + esc(missed.join(" ")) + ' <span class="ph-say-inline">(' + esc(missedSay.join(" ")) + ")</span>"
      : esc(ph.again);
    $("ph-result").innerHTML = '<p class="ph-heard">' + esc(ph.heard) + " " + esc(best.t) + '</p><p class="ph-words" lang="es">' + words + '</p><p class="ph-msg">' + msg + "</p>";
  }
  // Listening: keep every final and interim result until "I'm done" or 10 seconds, then grade once.
  // A 5-bar meter follows the input level only. Every mic track stops when a try ends.
  function phUseSR() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition) && !PH.recordOnly[PH.i]; }
  function phTryLabel() {
    var ph = D.phrases;
    return phUseSR() ? ph.try : ph.record;
  }
  // Recognition failed or threw: this phrase switches to Record and compare, with one line saying why.
  function phFallback(code) {
    var ph = D.phrases;
    PH.recordOnly[PH.i] = true;
    phStopMic();
    $("ph-result").innerHTML = '<p class="ph-msg">' + esc((ph.fallbackWhy && ph.fallbackWhy[code]) || ph.fallback) + "</p>";
  }
  // The first recording format this browser supports: audio/mp4 first (iOS Safari), then webm.
  function phMime() {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return "";
    var list = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
    for (var k = 0; k < list.length; k++) if (MediaRecorder.isTypeSupported(list[k])) return list[k];
    return "";
  }
  function phMeterStart(stream) {
    var AC = window.AudioContext || window.webkitAudioContext, bars = document.querySelectorAll("#ph-meter i");
    $("ph-meter").hidden = false;
    if (!AC || !stream) return;
    try {
      PH.ac = PH.ac || new AC();
      if (PH.ac.resume) PH.ac.resume();
      var an = PH.ac.createAnalyser(); an.fftSize = 512;
      PH.ac.createMediaStreamSource(stream).connect(an);
      var buf = new Uint8Array(an.fftSize);
      (function tick() {
        an.getByteTimeDomainData(buf);
        var sum = 0;
        for (var k = 0; k < buf.length; k++) { var v = (buf[k] - 128) / 128; sum += v * v; }
        var level = Math.min(1, Math.sqrt(sum / buf.length) * 6);
        Array.prototype.forEach.call(bars, function (bar, i) { bar.classList.toggle("on", level > (i + 0.5) / 5.5); });
        PH.raf = requestAnimationFrame(tick);
      })();
    } catch (e) { /* no meter, listening still works */ }
  }
  function phStopMic() {
    if (PH.stream) { PH.stream.getTracks().forEach(function (t) { t.stop(); }); PH.stream = null; }
    if (PH.rec) { var r = PH.rec; PH.rec = null; r.onend = r.onresult = r.onerror = null; try { r.abort(); } catch (e) { /* already stopped */ } }
    if (PH.mr && PH.mr.state !== "inactive") { PH.mr.onstop = null; try { PH.mr.stop(); } catch (e) { /* done */ } }
    PH.mr = null;
    cancelAnimationFrame(PH.raf);
    if (PH.ac) { try { PH.ac.close(); } catch (e) { /* closed */ } PH.ac = null; }
    clearTimeout(PH.timer);
    PH.busy = false;
    if ($("ph-try")) $("ph-try").disabled = false;
    if ($("ph-meter")) { $("ph-meter").hidden = true; Array.prototype.forEach.call(document.querySelectorAll("#ph-meter i"), function (b) { b.classList.remove("on"); }); }
    if ($("ph-try")) $("ph-try").textContent = phTryLabel();
  }
  function phStartTry() {
    var ph = D.phrases, SR = window.SpeechRecognition || window.webkitSpeechRecognition, useSR = phUseSR();
    PH.busy = true;
    // Inside the tap: the audio context for the meter, and audio/speech unlocked for later playback.
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC && !PH.ac) { try { PH.ac = new AC(); } catch (e) { PH.ac = null; } }
    if (!useSR) phUnlockAudio();
    $("ph-try").textContent = ph.done;
    phStep(2);
    $("ph-result").innerHTML = '<p class="ph-msg ph-live">' + esc(ph.listening) + "</p>";
    // Ask for the mic first, inside the tap, so the permission prompt appears.
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) {
      if (useSR) { phStartSR(SR, null); return; }
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; phStopMic(); return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!PH.busy) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      if (useSR) phStartSR(SR, stream); else phStartRecord(stream);
    }).catch(function (err) {
      if (useSR && !(err && (err.name === "NotAllowedError" || err.name === "SecurityError"))) { phStartSR(SR, null); return; }
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; phStopMic();
    });
  }
  function phStartSR(SR, stream) {
    // On phones the recognizer needs the mic to itself, so the meter's stream is released there.
    var touch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (stream && touch) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; $("ph-meter").hidden = false; }
    if (stream) { PH.stream = stream; phMeterStart(stream); }
    var rec;
    try {
      rec = new SR();
      PH.rec = rec; PH.heardAll = ""; PH.heardFinal = ""; PH.micError = false;
      rec.lang = "es-EC"; rec.maxAlternatives = 3; rec.continuous = true; rec.interimResults = true;
      // Rebuild the transcript from event.results on every result event: results[i][0] for all i.
      // Nothing is appended to a running string, so a word can't be doubled.
      rec.onresult = function (e) {
        var all = [], fin = [];
        for (var k = 0; k < e.results.length; k++) {
          var t = e.results[k][0] ? e.results[k][0].transcript : "";
          all.push(t);
          if (e.results[k].isFinal) fin.push(t);
        }
        PH.heardAll = all.join(" ").replace(/\s+/g, " ").trim();
        PH.heardFinal = fin.join(" ").replace(/\s+/g, " ").trim();
      };
      rec.onerror = function (e) {
        var code = e && e.error;
        if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture" || code === "network") PH.fallbackCode = code;
      };
      rec.onend = function () {
        if (PH.fallbackCode) { var c = PH.fallbackCode; PH.fallbackCode = null; phFallback(c); return; }
        phGrade();
      };
      PH.fallbackCode = null;
      rec.start();
    } catch (e) { PH.fallbackCode = null; phFallback("throw"); return; }
    PH.timer = setTimeout(phDone, 10000);
  }
  // Record and compare: record until "I'm done" or 10 seconds, then play your clip, then the voice.
  function phStartRecord(stream) {
    var ph = D.phrases;
    if (!window.MediaRecorder) { stream.getTracks().forEach(function (t) { t.stop(); }); $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; phStopMic(); return; }
    PH.stream = stream;
    phMeterStart(stream);
    var chunks = [], mime = phMime(), mr;
    try { mr = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
    catch (e) { mr = new MediaRecorder(stream); }
    PH.mr = mr;
    mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    mr.onstop = function () {
      var type = mr.mimeType || mime || "audio/webm";
      phStopMic();
      PH.busy = true; $("ph-try").disabled = true;
      var url = URL.createObjectURL(new Blob(chunks, { type: type }));
      var au = PH.audio || document.createElement("audio");
      phStep(3);
      $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.playing) + "</p>";
      var next = function () { au.onended = au.onerror = null; URL.revokeObjectURL(url); phSpeak(ph.items[PH.i].es, function () { PH.busy = false; $("ph-try").disabled = false; }); };
      au.onended = next; au.onerror = next;
      au.src = url;
      var pr = au.play();
      if (pr && pr.catch) pr.catch(next);
    };
    mr.start();
    PH.timer = setTimeout(phDone, 10000);
  }
  // "I'm done" or the 10 second limit.
  function phDone() {
    clearTimeout(PH.timer);
    if (PH.rec) { try { PH.rec.stop(); } catch (e) { phGrade(); } return; }
    if (PH.mr && PH.mr.state !== "inactive") { PH.mr.stop(); return; }
    phStopMic();
  }
  // Grade only the rebuilt final text (a stop finalizes what was still interim).
  function phGrade() {
    var ph = D.phrases, text = PH.heardFinal || "", micError = PH.micError;
    phStopMic();
    phStep(3);
    if (micError) { $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noMic) + "</p>"; return; }
    if (!text) { $("ph-result").innerHTML = '<p class="ph-msg">' + esc(ph.noSpeech) + "</p>"; return; }
    phJudge([text]);
  }
  function phTry() {
    if (PH.busy) { if (PH.mr && PH.audio) { try { var pr = PH.audio.play(); if (pr && pr.catch) pr.catch(function () {}); } catch (e) { /* later */ } } phDone(); }
    else phStartTry();
  }
  function wirePhrases() {
    if (!$("ph-card")) return;
    var ph = D.phrases;
    function label() { if ($("ph-try")) $("ph-try").textContent = phTryLabel(); }
    label();
    phRender();
    $("ph-prev").addEventListener("click", function () { phStopMic(); PH.i = (PH.i - 1 + ph.items.length) % ph.items.length; phRender(); label(); });
    $("ph-next").addEventListener("click", function () { phStopMic(); PH.i = (PH.i + 1) % ph.items.length; phRender(); label(); });
    if (!$("ph-try")) return; // phones: phrasebook only
    $("ph-listen").addEventListener("click", phListen);
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

  // Curtain call: the registration stage. "That's the show." over the form (left) and the program
  // monitor (right; stacked on phones), with the cast on an ink floor line under the whole band.
  // At 40% in view the cast bows left to right, once per page load; each figure is a button that bows again.
  R.register = function () {
    var c = D.curtain;
    return '<section class="cc" id="register" aria-labelledby="register-title"><div class="wrap cc-inner">' +
      '<div class="cc-head"><h2 class="cc-title" id="register-title">' + esc(c.title) + "</h2>" +
        '<p class="cc-sub">' + esc(c.sub) + "</p>" +
        '<p class="cc-free">' + esc(c.free) + "</p>" +
        '<p class="cc-date">' + esc(D.meta.dateLine) + "</p></div>" +
      '<div class="cc-stage"><div class="cc-form">' + regForm() + "</div>" + monitorMarkup() + "</div>" +
      "</div>" +
      '<div class="cc-floor"><div class="wrap"><ul class="cc-cast" id="cc-cast" aria-label="' + esc(c.cast) + '">' +
        [0, 1, 2, 3, 4, 5].map(function (k) { return castItem(queueFigure(k).replace('class="qf"', 'class="qf cc-qf"')); }).join("") +
      "</ul></div></div></section>";
  };
  function castItem(fig, you) {
    return '<li' + (you ? ' class="cc-you-li"' : "") + '><button type="button" class="cc-fig' + (you ? " cc-you" : "") + '" aria-label="' + esc(D.curtain.bow) + '">' + fig + "</button></li>";
  }
  // The visitor's outlined figure (with the photo bubble) runs into the cast line, 900ms. Registering
  // again swaps the figure in place.
  function castJoin(opts) {
    var cast = $("cc-cast");
    if (!cast) return;
    var old = cast.querySelector(".cc-you-li");
    if (old) { old.outerHTML = castItem(youFigure(), true); drawYouBubble(); return; }
    cast.insertAdjacentHTML("beforeend", castItem(youFigure(), true));
    drawYouBubble();
    var li = cast.querySelector(".cc-you-li");
    if (SHOT || opts.silent || !li.animate) return;
    var x0 = -(li.getBoundingClientRect().right + 24), kf = [], n = 8;
    for (var s2 = 0; s2 <= n; s2++) kf.push({ transform: "translate(" + (x0 * (1 - s2 / n)) + "px," + (s2 % 2 ? -6 : 0) + "px)" });
    li.animate(kf, { duration: 900, easing: "linear", fill: "backwards" });
  }

  // The registration form: first, last, work email, company, type, team size (Bring your team only), photo.
  function regForm() {
    var r = D.registration, fm = r.form, c = r.card, ph = c.photo, t = D.tickets, ts = r.teamSize, cc = D.curtain;
    var opts = t.tiers.map(function (x) { return '<option value="' + x.id + '">' + esc(x.name) + "</option>"; }).join("");
    var sizes = "";
    for (var i = ts.min; i <= ts.max; i++) sizes += '<option value="' + i + '">' + i + " people</option>";
    return '<form class="reg-form" id="reg-form" novalidate aria-label="' + esc(fm.label) + '">' +
        '<div class="rf-grid">' +
          field("first", "First name", textInput("first", "text", "given-name")) +
          field("last", "Last name", textInput("last", "text", "family-name")) +
          field("email", "Work email", textInput("email", "email", "email", ' inputmode="email"')) +
          field("company", "Company", textInput("company", "text", "organization")) +
          field("tier", "Registration type", '<select id="f-tier" name="tier">' + opts + "</select>") +
          field("size", ts.label, '<select id="f-size" name="size">' + sizes + "</select>", "field-size") +
        "</div>" +
        '<div class="rf-photo"><span class="rf-thumb" id="wu-slot" role="img" aria-label="' + esc(ph.labelEmpty) + '">' + queueFigure(0) + "</span>" +
          '<button type="button" class="linkish" id="wu-take">' + esc(ph.take) + "</button>" +
          '<button type="button" class="linkish" id="wu-upload">' + esc(ph.upload) + "</button>" +
          '<input type="file" id="wu-file" accept="image/*" hidden>' +
          '<p class="wu-status" id="wu-status" role="status"></p>' +
          // Camera panel: a 4:5 live preview, mirrored like a selfie, then a look at the shot before using it.
          '<div class="cam-panel" id="cam-panel" hidden><div class="cam-frame">' +
            '<video class="cam-video" id="cam-video" muted playsinline autoplay aria-label="' + esc(ph.labelLive) + '"></video>' +
            '<canvas class="cam-shot" id="cam-shot" role="img" aria-label="' + esc(ph.labelShot) + '" hidden></canvas></div>' +
            '<div class="cam-actions"><button type="button" class="btn cam-go" id="wu-snap">' + esc(ph.snap) + "</button>" +
              '<button type="button" class="linkish" id="wu-cancel">' + esc(ph.cancel) + "</button>" +
              '<button type="button" class="btn cam-go" id="cam-use" hidden>' + esc(ph.use) + "</button>" +
              '<button type="button" class="linkish" id="cam-retake" hidden>' + esc(ph.retake) + "</button></div></div></div>" +
        '<div class="rf-submit"><button type="submit" class="btn btn-primary rf-go" id="reg-submit">' + esc(fm.submit) + "</button>" +
          '<p class="rf-demo">' + esc(fm.demo) + "</p></div>" +
      "</form>" +
      '<div class="reg-done" id="reg-done" tabindex="-1" hidden><p class="rd-line" id="rd-line"></p>' +
        '<p class="rd-links"><button type="button" class="linkish" id="card-save">' + esc(c.saveLabel) + "</button>" +
        '<button type="button" class="linkish" id="cal-all">' + esc(c.calendar) + "</button>" +
        '<button type="button" class="linkish" id="reg-again">' + esc(c.againLabel) + "</button></p></div>";
  }

  // ---------- the program monitor: a framed copy of the wall at about 40% ----------
  // Same markup as the wall (stageMarkup), laid out at the wall's own size and scaled down. Before
  // registering it mirrors the wall's cue. After a valid submit it stands by on Q7 with a GO on the
  // bezel; GO plays the walk-up here: the figure walks, the screen powers on, name and photo appear.
  var MON = { mode: "mirror", cue: 0, busy: false, anims: [], timers: [] };
  function monitorMarkup() {
    var c = D.curtain;
    return '<div class="monitor" id="monitor" role="group" aria-label="' + esc(c.monitor) + '"><div class="mon-bezel">' +
      '<p class="mon-label" aria-hidden="true">' + esc(c.program) + "</p>" +
      '<div class="mon-screen" id="mon-screen" inert><div class="mon-scale" id="mon-scale">' + stageMarkup(false) + "</div></div>" +
      '<div class="mon-foot"><button type="button" class="go-btn mon-go" id="mon-go" hidden aria-label="' + esc(c.walkOn) + '"><span class="go-ring" aria-hidden="true"></span><span class="go-text">' + esc(D.wall.goText) + "</span></button>" +
        '<span class="mon-go-label" id="mon-go-label" aria-hidden="true" hidden>' + esc(c.walkOn) + "</span></div>" +
      '<p class="sr" aria-live="polite" id="mon-live"></p>' +
      "</div></div>";
  }
  function monWall() { return document.querySelector("#mon-scale .wall"); }
  // Lay the copy out at the wall's own size, then scale it to the screen's width.
  function monFit() {
    var sc = $("mon-scale"), scr = $("mon-screen"), wall = $("wall");
    if (!sc || !wall) return;
    var W = wall.offsetWidth, H = wall.offsetHeight, k = scr.clientWidth / (W || 1);
    sc.style.width = W + "px"; sc.style.height = H + "px";
    sc.style.transform = "scale(" + k + ")";
    scr.style.height = Math.round(H * k) + "px";
    frameWallPhotos(); drawYouWall();
    if (!MON.busy) placeQueue(MON.cue, monWall());
  }
  function monPaint(i) {
    var r = monWall();
    if (!r || !CUES[i]) return;
    MON.cue = i;
    paintStage(r, i);
    if (!MON.busy) placeQueue(i, r);
  }
  function monStop() {
    MON.timers.forEach(clearTimeout); MON.timers = [];
    MON.anims.forEach(function (a) { try { a.cancel(); } catch (e) { /* done */ } }); MON.anims = [];
    MON.busy = false;
  }
  // Q7 on standby: Q6 is live, the visitor waits at the front of the queue, GO shows on the bezel.
  function monStandby() {
    monStop();
    MON.mode = "standby";
    monPaint(CUES.length - 2);
    $("mon-go").hidden = false; $("mon-go-label").hidden = false;
  }
  // Q7 live: the end state of the walk-up (also what ?shot=1&n= shows).
  function monLive() {
    monStop();
    MON.mode = "live";
    monPaint(CUES.length - 1);
    $("mon-go").hidden = true; $("mon-go-label").hidden = true;
  }
  function monWalkOn() {
    var r = monWall(), b = $("mon-go");
    if (!r || MON.busy || MON.mode !== "standby") return;
    var now = performance.now();
    if (now - (b._fired || 0) >= 340) { b._fired = now; b.classList.add("is-fired"); void b.offsetWidth; requestAnimationFrame(function () { requestAnimationFrame(function () { b.classList.remove("is-fired"); }); }); }
    var g = qGeom(r), f = figK(6, r), i = CUES.length - 1;
    MON.busy = true;
    move(f, slotX(g, 0), g.photoX, 2, 600, 0, MON.anims);
    MON.timers.push(setTimeout(function () {
      f.style.visibility = "hidden";
      MON.mode = "live";
      paintStage(r, i); MON.cue = i;
      photoReveal(r, MON.anims);
      var c = CUES[i], live = $("mon-live");
      live.textContent = "";
      setTimeout(function () { live.textContent = c.cue + ". " + c.sp.name + ". " + c.s.title + "."; }, 30);
    }, 600));
    MON.timers.push(setTimeout(function () {
      MON.busy = false;
      b.hidden = true; $("mon-go-label").hidden = true;
      $("reg-done").focus({ preventScroll: true });
    }, 1060));
  }

  var CC = { bowed: false };
  function bow(el, delay) {
    if (SHOT || !el.animate) return;
    el.animate([{ transform: "rotate(0deg)" }, { transform: "rotate(20deg)", offset: 0.45 }, { transform: "rotate(0deg)" }],
      { duration: 500, delay: delay || 0, easing: "ease-in-out" });
  }
  function bowAll() {
    Array.prototype.forEach.call(document.querySelectorAll("#cc-cast .cc-fig"), function (b, i) { bow(b.firstElementChild, i * 90); });
  }
  function wireCurtain() {
    var sec = $("register");
    if (!sec) return;
    $("cc-cast").addEventListener("click", function (e) {
      var f = e.target.closest(".cc-fig");
      if (f) bow(f.firstElementChild, 0);
    });
    $("mon-go").addEventListener("click", monWalkOn);
    monFit();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(monFit);
    window.addEventListener("resize", monFit);
    if (SHOT || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting && !CC.bowed) { CC.bowed = true; io.disconnect(); bowAll(); }
      });
    }, { threshold: 0.4 });
    io.observe($("cc-cast"));
  }

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
    m.addEventListener("change", function (e) { if (e.target.name === "tier") setTier(e.target.value); });
    // The "+" opens one sentence right under its row. One row open at a time. A real button, so
    // click, tap, Enter and Space all work.
    var btns = Array.prototype.slice.call(m.querySelectorAll(".m-label"));
    btns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var open = btn.getAttribute("aria-expanded") === "true";
        btns.forEach(function (b) {
          var on = b === btn && !open;
          b.setAttribute("aria-expanded", String(on));
          $(b.getAttribute("aria-controls")).hidden = !on;
          b.closest(".m-row").classList.toggle("is-open", on);
        });
      });
    });
    setTier(state.tier);
  }

  // Height of what sticks to the top: the nav bar. Not in ?shot=1.
  function stickyTop() {
    if (SHOT) return 0;
    var header = document.querySelector(".site-header");
    return header ? header.getBoundingClientRect().height : 0;
  }
  // Every Register trigger: scroll to the curtain call with its heading below the nav (smooth, instant
  // under reduced motion) and focus the first field (or the confirmation, once registered).
  function goToRegister(opts) {
    var h = $("register-title");
    if (!h) return;
    var top = h.getBoundingClientRect().top + window.pageYOffset - stickyTop() - 16;
    window.scrollTo({ top: Math.max(0, top), behavior: !(opts && opts.instant) && smoothOK() ? "smooth" : "instant" });
    var target = $("reg-form").hidden ? $("reg-done") : $("f-first");
    if (target) target.focus({ preventScroll: true });
  }
  function wireRegister() {
    if (!$("reg-form")) return;
    // Access's "Register as ..." has already set the type through setTier.
    document.addEventListener("click", function (e) {
      var t = e.target.closest && e.target.closest('a[href="#register"]');
      if (!t) return;
      e.preventDefault();
      goToRegister();
    });
    wireForm();
    wirePhoto();
    $("card-save").addEventListener("click", function () {
      if (!VIS.joined) return;
      var c = visitorCue();
      saveCard({ label: D.wall.label, name: c.sp.name, title: c.s.title, cue: cueLine(c), numeral: c.cue,
        canvas: WU.src ? youCanvas(380, 478) : null, emptyFigure: !WU.src }, D.meta.shortName + "-q7.png");
    });
    $("cal-all").addEventListener("click", function () {
      if (!VIS.rec) return;
      var tierId = VIS.rec.tier.id;
      var all = daysForTier(tierId).map(function (day) {
        return { id: day.id, date: day.date, label: day.label, sessions: day.sessions.filter(function (s) { return !s.tiers || s.tiers.indexOf(tierId) > -1; }) };
      });
      downloadIcs(all, (D.meta.shortName || "event") + ".ics");
    });
    $("reg-again").addEventListener("click", function () {
      stopCamera();
      closeCam();
      WU.src = null;
      $("reg-form").reset();
      Array.prototype.forEach.call($("reg-form").querySelectorAll("[aria-invalid]"), function (el) { el.removeAttribute("aria-invalid"); });
      Array.prototype.forEach.call($("reg-form").querySelectorAll(".error"), function (el) { el.textContent = ""; });
      setTier(state.tier);
      resetThumb();
      $("reg-done").hidden = true;
      $("reg-form").hidden = false;
      $("f-first").focus();
    });
  }
  function wireForm() {
    var form = $("reg-form");
    if (!form) return;
    form.elements.tier.addEventListener("change", function () { setTier(form.elements.tier.value); });
    if (state.tier) setTier(state.tier);
    // A fixed field drops its error straight away.
    ["first", "last", "email", "company"].forEach(function (name) {
      form.elements[name].addEventListener("input", function () {
        if (this.getAttribute("aria-invalid") === "true" && this.value.trim()) { this.setAttribute("aria-invalid", "false"); $("e-" + name).textContent = ""; }
      });
    });
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
        // Focus the first problem and keep its field, message included, in view.
        first.focus({ preventScroll: true });
        first.closest(".field").scrollIntoView({ block: "center", behavior: smoothOK() ? "smooth" : "instant" });
        return;
      }
      var tier = byId(D.tickets.tiers, form.elements.tier.value);
      confirmReg({ name: val("first") + " " + val("last"), first: val("first"), company: val("company"), tier: tier,
        size: tier.id === "team" ? form.elements.size.value : "" }, { focus: true });
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

  // A valid submit: the form gives way to one line, the visitor runs into the cast and joins the
  // wall's queue as Q7, and the program monitor stands by on Q7.
  function confirmReg(rec, opts) {
    opts = opts || {};
    stopCamera();
    closeCam();
    var first = rec.first || splitName(rec.name).first;
    $("rd-line").textContent = D.curtain.confirmed.replace("{first}", first);
    $("reg-form").hidden = true;
    $("reg-done").hidden = false;
    joinQueue(rec, { silent: !!opts.silent, liveMonitor: !!opts.liveMonitor });
    if (opts.focus) {
      var top = $("register-title").getBoundingClientRect().top + window.pageYOffset - stickyTop() - 16;
      if (window.pageYOffset > top) window.scrollTo({ top: top, behavior: smoothOK() ? "smooth" : "instant" });
      $("reg-done").focus({ preventScroll: true });
    }
  }

  // ---------- registrant photo: camera or upload, kept in memory only ----------
  var WU = { stream: null, src: null, observer: null };
  var SRC_W = 960, SRC_H = 1200;
  // Stops every camera track. A live panel closes; a shot waiting for "Use photo" stays on screen.
  function stopCamera() {
    if (WU.stream) { WU.stream.getTracks().forEach(function (t) { t.stop(); }); WU.stream = null; }
    var v = $("cam-video");
    if (v) v.srcObject = null;
    if (!WU.pending) closeCam();
  }
  function closeCam() {
    WU.pending = null;
    var panel = $("cam-panel");
    if (!panel) return;
    panel.hidden = true;
    if ($("wu-take")) $("wu-take").hidden = false;
    if ($("wu-upload")) $("wu-upload").hidden = false;
  }
  // Keep the Register button, and the panel's own buttons, on screen when the panel opens or changes.
  function keepRegisterInView() {
    var btn = $("reg-submit"), acts = document.querySelector("#cam-panel:not([hidden]) .cam-actions");
    if (!btn) return;
    var bottom = Math.max(btn.getBoundingClientRect().bottom, acts ? acts.getBoundingClientRect().bottom : 0);
    var over = bottom + 12 - window.innerHeight;
    if (over > 0) window.scrollBy({ top: over, behavior: smoothOK() ? "smooth" : "instant" });
  }
  function camMode(review) {
    $("cam-video").hidden = review; $("cam-shot").hidden = !review;
    $("wu-snap").hidden = review; $("wu-cancel").hidden = review;
    $("cam-use").hidden = !review; $("cam-retake").hidden = !review;
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
  // Keep the original (not duotoned), cover-cropped to 4:5 at a generous size; every view is drawn from it.
  function toSource(src, sw, sh, mirror) {
    var cv = document.createElement("canvas");
    cv.width = SRC_W; cv.height = SRC_H;
    var ctx = cv.getContext("2d"), sc = Math.max(SRC_W / sw, SRC_H / sh), cw = SRC_W / sc, ch = SRC_H / sc;
    if (mirror) { ctx.translate(SRC_W, 0); ctx.scale(-1, 1); }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, SRC_W, SRC_H);
    return cv;
  }
  function resetThumb() {
    var slot = $("wu-slot");
    if (!slot) return;
    slot.innerHTML = queueFigure(0);
    slot.setAttribute("aria-label", D.registration.card.photo.labelEmpty);
  }
  function showPhoto(src) {
    var slot = $("wu-slot"), p = D.registration.card.photo;
    WU.src = src;
    var S = 96 * dpr(), cv = document.createElement("canvas"), side = src.width * 0.8;
    cv.width = cv.height = S;
    var ctx = cv.getContext("2d");
    ctx.drawImage(src, (src.width - side) / 2, Math.max(0, src.height * 0.4 - side / 2), side, side, 0, 0, S, S);
    duotone(ctx, S, S);
    slot.innerHTML = '<img alt="" src="' + cv.toDataURL("image/png") + '">';
    slot.setAttribute("aria-label", p.labelPhoto);
    if (VIS.joined) refreshVisitor();
  }
  function wuStatus(msg) { if ($("wu-status")) $("wu-status").textContent = msg || ""; }
  function wirePhoto() {
    var p = D.registration.card.photo, slot = $("wu-slot");
    if (!slot) return;
    var canCam = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    function startCam() {
      wuStatus("");
      if (!canCam) { wuStatus(p.none); $("wu-take").hidden = true; return; }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false }).then(function (stream) {
        if (WU.stream) WU.stream.getTracks().forEach(function (t) { t.stop(); });
        WU.stream = stream; WU.pending = null;
        var v = $("cam-video");
        v.muted = true; v.playsInline = true; v.srcObject = stream;
        v.play().catch(function () { /* autoplay may need the tap; the stream still shows */ });
        $("cam-panel").hidden = false;
        camMode(false);
        $("wu-take").hidden = true; $("wu-upload").hidden = true;
        $("wu-snap").focus({ preventScroll: true });
        keepRegisterInView();
      }).catch(function (err) {
        var denied = err && (err.name === "NotAllowedError" || err.name === "SecurityError");
        wuStatus(denied ? p.denied : p.none);
        $("wu-take").hidden = true;
      });
    }
    $("wu-take").addEventListener("click", startCam);
    $("cam-retake").addEventListener("click", function () { WU.pending = null; startCam(); });
    $("wu-snap").addEventListener("click", function () {
      var v = $("cam-video");
      if (!v || !v.videoWidth) return;
      var src = toSource(v, v.videoWidth, v.videoHeight, true);
      WU.pending = src;
      if (WU.stream) { WU.stream.getTracks().forEach(function (t) { t.stop(); }); WU.stream = null; }
      v.srcObject = null;
      // Show the shot at the panel's size, in its own colors, before it is used.
      var c = $("cam-shot"), box = c.parentNode;
      c.width = Math.round(box.clientWidth * dpr()); c.height = Math.round(box.clientHeight * dpr());
      c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
      camMode(true);
      $("cam-use").focus({ preventScroll: true });
      keepRegisterInView();
    });
    $("cam-use").addEventListener("click", function () {
      var src = WU.pending;
      closeCam();
      if (src) showPhoto(src);
      $("wu-take").focus();
    });
    $("wu-cancel").addEventListener("click", function () {
      stopCamera();
      closeCam();
      $("wu-take").focus();
    });
    $("wu-upload").addEventListener("click", function () { $("wu-file").click(); });
    $("wu-file").addEventListener("change", function () {
      var f = this.files && this.files[0];
      if (!f) return;
      stopCamera();
      var url = URL.createObjectURL(f), im = new Image();
      im.onload = function () { showPhoto(toSource(im, im.naturalWidth, im.naturalHeight, false)); URL.revokeObjectURL(url); wuStatus(""); };
      im.onerror = function () { URL.revokeObjectURL(url); wuStatus(p.bad); };
      im.src = url;
      this.value = "";
    });
    // Scrolling the form out of view, hiding the tab or leaving the page stops the camera.
    if ("IntersectionObserver" in window) {
      WU.observer = new IntersectionObserver(function (es) { es.forEach(function (e) { if (!e.isIntersecting) stopCamera(); }); });
      WU.observer.observe($("reg-form"));
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
    var off = SHOT ? 16 : stickyTop() + 16;
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
    ["schedule", "tickets", "venue", "faq"].forEach(function (id) {
      var old = $(id);
      if (old && R[id]) old.outerHTML = R[id]();
    });
    wireTabs(); wireMatrix();
    if (CUES[state.cue]) $("wall-cue").textContent = cueLine(CUES[state.cue]);
    if (selId && $(selId)) selectTab($(selId), false);
    markOnWall();
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

  // ---------- the stage: spotlight and Cue on the wall ----------
  // Spotlight (tier 1): a flat host cone drops from the top of the stage onto the hovered,
  // focused or tapped panel in 200ms; the other panels dim. One at a time.
  var SPOT = { on: null };
  function spotOn(p) {
    var sec = $("speakers"), cone = sec && sec.querySelector(".st-cone"), list = sec && sec.querySelector(".st-panels");
    if (!cone || SPOT.on === p) return;
    if (SPOT.on) SPOT.on.classList.remove("is-spot");
    SPOT.on = p;
    if (!p) { list.classList.remove("has-spot"); cone.classList.remove("on"); return; }
    p.classList.add("is-spot"); list.classList.add("has-spot");
    var sr = sec.getBoundingClientRect(), ph = p.querySelector(".st-photo").getBoundingClientRect();
    var floor = sec.querySelector(".st-floor"), wide = floor && getComputedStyle(floor).display !== "none";
    var gt = sec.querySelector(".st-grid").getBoundingClientRect().top - sr.top;
    var top = wide ? gt : Math.max(gt, p.getBoundingClientRect().top - sr.top - 20);
    var w = ph.width * 1.24;
    cone.style.left = (ph.left - sr.left + ph.width / 2 - w / 2) + "px";
    cone.style.width = w + "px";
    cone.style.top = top + "px";
    cone.style.height = (ph.bottom - sr.top - top) + "px";
    cone.classList.remove("on");
    void cone.offsetWidth;
    cone.classList.add("on");
  }
  function wireStage() {
    var list = document.querySelector("#speakers .st-panels");
    if (!list) return;
    list.addEventListener("click", function (e) {
      var b = e.target.closest("[data-wall-cue]");
      if (b) cueOnWall(+b.getAttribute("data-wall-cue"));
    });
    if (SHOT) return; // no spotlight in ?shot=1 (no hover or focus styling)
    Array.prototype.forEach.call(list.querySelectorAll(".st-panel"), function (p) {
      p.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") spotOn(p); });
      p.addEventListener("focusin", function () { spotOn(p); });
      p.addEventListener("click", function () { spotOn(p); });
    });
    // Only a real mouse leaving clears it: a tap's spotlight stays until the next tap elsewhere.
    list.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && !list.contains(document.activeElement)) spotOn(null); });
    list.addEventListener("focusout", function (e) { if (!list.contains(e.relatedTarget)) spotOn(null); });
    document.addEventListener("click", function (e) { if (SPOT.on && !list.contains(e.target)) spotOn(null); });
    window.addEventListener("resize", function () { var p = SPOT.on; if (p) { SPOT.on = null; spotOn(p); } });
  }
  // Cue on the wall: back to the top (smooth unless reduced motion), then the cue-button jump.
  function cueOnWall(i) {
    var btn = document.querySelector('#wall .cue-btn[data-cue="' + i + '"]');
    function go() { jumpTo(i); if (btn) btn.focus({ preventScroll: true }); }
    if (!smoothOK() || window.scrollY < 2) { window.scrollTo(0, 0); go(); return; }
    var done = false, t;
    function fin() { if (done) return; done = true; clearTimeout(t); window.removeEventListener("scrollend", fin); go(); }
    window.addEventListener("scrollend", fin);
    t = setTimeout(fin, 1600);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderChrome() {
    var m = D.meta, on = D.sections.filter(function (s) { return s.on && R[s.id]; });
    document.title = m.pageTitle || m.name;
    var md = document.querySelector('meta[name="description"]');
    if (md) md.setAttribute("content", String(m.description || "").replace(/\[PLACEHOLDER\]\s?/g, ""));
    var ogt = document.querySelector('meta[property="og:title"]'), ogd = document.querySelector('meta[property="og:description"]');
    if (ogt) ogt.setAttribute("content", m.pageTitle || m.name);
    if (ogd) ogd.setAttribute("content", String(m.description || ""));
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
      '<p class="footer-small">' + esc(m.footerLine || "") + "</p>" +
      (m.credit ? '<p class="footer-small">' + esc(m.credit.text) + ' <a href="' + esc(m.credit.href) + '">' + esc(m.credit.name) + "</a></p>" : "") + "</div>";
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
          var fr = wallFrame(pw, ph, o.eye, photo.height / photo.width); // same framing as the wall
          o2.drawImage(photo, fr.x, fr.y, fr.w, fr.h);
        }
        try {
          if (!o.canvas) duotone(o2, pw, ph); // a visitor photo is already duotoned
          ctx.drawImage(off, px, py);
          textW = px - P - 32;
        } catch (e) { /* tainted canvas: leave the photo out */ }
      }
      if (!photo && o.emptyFigure) {
        // No photo: the empty-state figure on its own floor line, where the photo would be.
        var ex = W - P - 380, ew = 380, eb = floorY - 70;
        ctx.fillStyle = onHost;
        ctx.fillRect(ex + 60, eb, ew - 120, 3);
        ctx.save(); ctx.translate(ex + ew / 2 - 12 * 4.2, eb - 60 * 4.2); ctx.scale(4.2, 4.2);
        ctx.beginPath(); ctx.arc(12, 6, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fill(new Path2D("M6 13h12l2 22h-3.2L15.4 60h-3L12 39l-.4 21h-3L7.2 35H4z"));
        ctx.restore();
        textW = ex - P - 32;
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
      ctx.save(); ctx.translate((photo || o.emptyFigure ? W - P - 380 - 34 : W - P - 40), floorY - 64); ctx.scale(64 / 56, 64 / 56);
      ctx.beginPath(); ctx.arc(10, 5, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fill(new Path2D("M5 12h10l1.5 20h-3L13 54H10.8L10 36l-.8 18H7l-.5-22h-3z"));
      ctx.restore();
      cv.toBlob(function (blob) { if (blob) saveBlob(blob, filename); }, "image/png");
    });
  }

  // ---------- URL switches ----------
  function applyNameParam() {
    if (!NAME_PARAM) return;
    var sd = D.registration.shotDefaults, tier = byId(D.tickets.tiers, sd.tier);
    if (SHOT) {
      setTier(tier.id);
      var rec = { name: NAME_PARAM, company: sd.company, tier: tier, size: "" };
      // ?shot=1&n=Name: the curtain call confirmed, the monitor showing Q7 lit. ?shot=1&q=7&n=Name adds
      // the wall on Q7 (set after this, in init).
      confirmReg(rec, { silent: true, liveMonitor: true });
      return;
    }
    // ?n=Name: prefill the form's name fields and scroll to it. Does not submit.
    var n = splitName(NAME_PARAM);
    if ($("f-first")) $("f-first").value = n.first;
    if ($("f-last")) $("f-last").value = n.last;
    // After the fonts settle, so the layout above doesn't move the target mid-scroll.
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { goToRegister(); });
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
      var shotQ = SHOT ? parseInt(Q.get("q"), 10) : 0;
      if (SHOT) state.cue = shotQ >= 1 && shotQ <= CUES.length ? shotQ - 1 : 0;
      renderHero();
      renderChrome(); markOnWall();
      wireWall(); wireTabs(); wireMatrix(); wireRegister(); wireGlobal(); wirePhrases(); wireStage(); wireCurtain();
      startOpening();
      applyNameParam();
      // ?shot=1&q=7&n=Name: the registrant is already on the wall as Q7, empty photo state.
      if (SHOT && shotQ === 7 && NAME_PARAM && VIS.joined) { cutTo(6, false); placeQueue(6); }
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
