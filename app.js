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
  function img(url, w, h) { return url ? url + "?w=" + w + "&h=" + h + "&fit=crop&crop=faces&auto=format&q=70" : ""; }
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
    return { start: a, end: b, label: fmtTime(a) + " - " + fmtTime(b) + " " + tzShort(viewTz(), a) };
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
      return '<img src="' + esc(img(x.sp.photo, 720, 860)) + '" alt="" width="720" height="860" loading="eager" decoding="sync" data-cue="' + i + '"' + (i === state.cue ? "" : " hidden") + ">";
    }).join("");
    var strip = CUES.map(function (x, i) {
      return '<li><button type="button" class="cue-btn" data-cue="' + i + '">' + esc(x.cue) + '<span class="cue-state" aria-hidden="true"></span></button></li>';
    }).join("");
    $("hero-moment").innerHTML =
      '<div class="stage wall" id="wall" role="region" aria-label="Keynote wall">' +
        '<div class="stage-body">' +
          '<div class="stage-copy">' + stageCopy({ label: w.label, name: c.sp.name, title: c.s.title, cue: cueLine(c),
            nameId: "wall-name", titleId: "wall-title", cueId: "wall-cue",
            after: ' <a class="stage-link" id="wall-link" href="#session-' + esc(c.s.id) + '">' + esc(w.agendaLink) + "</a>" }) + "</div>" +
          '<div class="stage-photo" aria-hidden="true">' + photos + "</div>" +
          FIGURE +
          '<button type="button" class="stage-save" id="wall-save">' + esc(w.saveLabel) + "</button>" +
        "</div>" +
        '<div class="stage-floor" aria-hidden="true"></div>' +
        '<div class="wall-controls">' +
          '<ol class="cue-strip" aria-label="Cues">' + strip + "</ol>" +
          '<button type="button" class="go-btn" id="go-btn">' + esc(w.goText) + "</button>" +
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

  // Hard cut: everything swaps in the same frame. No fade, no slide.
  function cutTo(i, announce) {
    var n = CUES.length;
    i = ((i % n) + n) % n;
    state.cue = i;
    var c = CUES[i], next = CUES[(i + 1) % n];
    $("wall-name").innerHTML = nameHtml(c.sp.name);
    $("wall-title").textContent = c.s.title;
    $("wall-cue").textContent = cueLine(c);
    $("wall-link").setAttribute("href", "#session-" + c.s.id);
    Array.prototype.forEach.call(document.querySelectorAll("#wall .stage-photo img"), function (im) {
      im.hidden = +im.getAttribute("data-cue") !== i;
    });
    Array.prototype.forEach.call(document.querySelectorAll("#wall .cue-btn"), function (b) {
      var k = +b.getAttribute("data-cue"), live = k === i, sb = k === (i + 1) % n;
      var x = CUES[k];
      b.classList.toggle("is-live", live);
      b.classList.toggle("is-standby", sb);
      if (live) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
      b.querySelector(".cue-state").textContent = live ? D.wall.live : sb ? D.wall.standby : "";
      b.setAttribute("aria-label", x.cue + ", " + x.sp.name + (live ? ", " + D.wall.live : sb ? ", " + D.wall.standby : ""));
    });
    $("go-btn").setAttribute("aria-label", D.wall.goText + ": call " + next.cue + ", " + next.sp.name);
    if (announce) {
      var live = $("wall-live");
      live.textContent = "";
      setTimeout(function () { live.textContent = c.cue + ". " + c.sp.name + ". " + c.s.title + (/[.!?]$/.test(c.s.title) ? "" : "."); }, 30);
    }
  }

  function wireWall() {
    var wall = $("wall");
    if (!wall) return;
    $("go-btn").addEventListener("click", function () { cutTo(state.cue + 1, true); });
    Array.prototype.forEach.call(wall.querySelectorAll(".cue-btn"), function (b) {
      b.addEventListener("click", function () { cutTo(+b.getAttribute("data-cue"), true); });
    });
    $("wall-save").addEventListener("click", function () {
      var c = CUES[state.cue];
      saveCard({ label: D.wall.label, name: c.sp.name, title: c.s.title, cue: cueLine(c), photo: c.sp.photo },
        D.meta.shortName + "-" + c.cue.toLowerCase() + ".png");
    });
  }

  // ---------- sections ----------
  var R = {};

  R.about = function () {
    var a = D.about;
    return sectionShell("about", a.heading,
      (a.statement ? '<p class="about-statement">' + copy(a.statement) + "</p>" : "") +
      '<div class="about-copy">' + a.paragraphs.map(function (p) { return "<p>" + copy(p) + "</p>"; }).join("") + "</div>");
  };

  R.speakers = function () {
    var sp = D.speakers, map = speakerSessions();
    function agendaLink(id) {
      var first = (map[id] || [])[0];
      return first ? '<a class="sp-agenda" href="#session-' + esc(first.s.id) + '">' + esc(sp.agendaLink) + "</a>" : "";
    }
    function photo(p, w, h) {
      return p.photo
        ? '<img class="sp-photo" src="' + esc(img(p.photo, w, h)) + '" alt="' + esc(p.name) + '" width="' + w + '" height="' + h + '" loading="' + imgLoading(false) + '">'
        : '<div class="sp-photo sp-initials" aria-hidden="true">' + esc(initials(p.name)) + "</div>";
    }
    function body(p) {
      return '<h3 class="sp-name">' + esc(p.name) + '</h3><p class="sp-role">' + esc(p.role) + '</p><p class="sp-company">' + esc(p.company) + "</p>" + agendaLink(p.id);
    }
    var first = sp.items[0], rest = sp.items.slice(1);
    var featured = first ? '<article class="sp-featured" id="speaker-' + first.id + '">' + photo(first, 640, 800) +
      '<div class="sp-body">' + body(first) + "</div></article>" : "";
    var grid = '<ul class="sp-grid">' + rest.map(function (p) {
      return '<li class="sp-card" id="speaker-' + p.id + '">' + photo(p, 480, 480) + body(p) + "</li>";
    }).join("") + "</ul>";
    return sectionShell("speakers", sp.heading, (sp.intro ? '<p class="lede">' + copy(sp.intro) + "</p>" : "") + featured + grid);
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
              (p.photo ? '<img src="' + esc(img(p.photo, 64, 64)) + '" alt="" width="32" height="32" loading="' + imgLoading(false) + '">' : "") +
              '<span><span class="s-sp-name">' + esc(p.name) + '</span><span class="s-sp-role">' + esc(p.role) + ", " + esc(p.company) + "</span></span></a>";
          }).filter(Boolean).join("");
          var cls = "session track-" + trackIndex(x.track) + (x.cue ? " is-keynote" : "") + (tr ? "" : " is-common");
          return '<li class="' + cls + '" id="session-' + x.id + '">' +
            '<span class="s-time"><time datetime="' + t.start.toISOString() + '">' + esc(t.label) + "</time>" +
              (x.cue ? '<span class="s-cue">' + esc(x.cue) + "</span>" : "") + "</span>" +
            '<div class="s-body"><h3 class="s-title">' + esc(x.title) + "</h3>" +
              (spk ? '<div class="s-speakers">' + spk + "</div>" : "") +
              (x.detail ? '<p class="s-detail">' + copy(x.detail) + "</p>" : "") + "</div>" +
            (tr ? '<span class="s-track">' + esc(tr.name) + "</span>" : "") +
          "</li>";
        }).join("") + "</ol>" +
        '<button type="button" class="btn btn-small ics-btn" data-ics-day="' + day.id + '">Add ' + esc(day.title) + " to calendar</button>" +
      "</div>";
    }).join("");
    return sectionShell("schedule", s.heading, (s.note ? '<p class="note">' + copy(s.note) + "</p>" : "") + tzBar + legend + tabs + panels);
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
  // Computed row: how many agenda items each registration type can attend, counted from session tiers.
  function sessionsForTier(tierId) {
    var n = 0;
    D.schedule.days.forEach(function (day) { day.sessions.forEach(function (s) { if (!s.tiers || s.tiers.indexOf(tierId) > -1) n++; }); });
    return n;
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
    var computed = t.computedRow ? '<tfoot><tr><th scope="row">' + esc(t.computedRow) + "</th>" + t.tiers.map(function (tier) {
      return '<td class="c-' + tier.id + '" data-tier="' + esc(tier.name) + '">' + sessionsForTier(tier.id) + "</td>";
    }).join("") + "</tr></tfoot>" : "";
    var table = '<table class="matrix" id="matrix" style="--tiers:' + t.tiers.length + '"><caption class="sr">What each registration type includes</caption>' + head + "<tbody>" + body + "</tbody>" + computed + "</table>";
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
      (f ? '<div class="venue-feature"><h3>' + esc(f.title) + (f.tag ? ' <span class="venue-tag">' + esc(f.tag) + "</span>" : "") + "</h3><p>" + copy(f.body) + "</p></div>" : "") +
      '<dl class="ruled">' + v.items.map(function (x) { return "<div><dt>" + esc(x.title) + "</dt><dd>" + copy(x.body) + "</dd></div>"; }).join("") + "</dl>" +
      (v.mapLink ? '<a class="btn btn-small" href="' + esc(v.mapLink) + '">Open in maps</a>' : ""));
  };

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
    return sectionShell("faq", f.heading, '<div class="faq-list">' + f.items.map(function (x) {
      return '<details class="faq-item"><summary><span>' + copy(x.q) + '</span><span class="q-icon" aria-hidden="true">+</span></summary><div class="a"><p>' + copy(x.a) + "</p></div></details>";
    }).join("") + "</div>");
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
        '<div class="stage walkup"><div class="stage-body"><div class="stage-copy">' +
          stageCopy({ label: c.label, name: rec.name, title: regLine(rec), cue: D.meta.dateLine }) +
        "</div>" + FIGURE + '</div><div class="stage-floor" aria-hidden="true"></div></div>' +
        '<p class="confirm-demo">' + esc(c.demoLine) + "</p>" +
        '<div class="confirm-actions"><button type="button" class="btn btn-small" id="card-save">' + esc(c.saveLabel) + "</button>" +
        days.map(function (d) {
          return '<button type="button" class="btn btn-small" data-ics-day="' + d.id + '" data-ics-tier="' + rec.tier.id + '">Add ' + esc(d.title) + " to calendar</button>";
        }).join("") + '<button type="button" class="btn btn-small" id="reg-again">' + esc(c.againLabel) + "</button></div>" +
      "</div>";
    if (focus) {
      var card = $("reg-confirm"), header = document.querySelector(".site-header");
      var top = card.getBoundingClientRect().top + window.pageYOffset - (header ? header.getBoundingClientRect().height : 0) - 16;
      window.scrollTo({ top: top, behavior: smoothOK() ? "smooth" : "instant" });
      card.focus({ preventScroll: true });
    }
    $("card-save").addEventListener("click", function () {
      saveCard({ label: c.label, name: rec.name, title: regLine(rec), cue: D.meta.dateLine }, D.meta.shortName + "-walk-up.png");
    });
    $("reg-again").addEventListener("click", function () {
      $("register").outerHTML = R.register();
      wireForm();
      $("f-first").focus();
    });
  }

  // "See in agenda": switch day, scroll the session under the header, light only it, move focus to it.
  function goToSession(id, opts) {
    var target = $(id);
    if (!target) return false;
    var panel = target.closest('[role="tabpanel"]');
    if (panel && panel.hidden && $(panel.getAttribute("aria-labelledby"))) selectTab($(panel.getAttribute("aria-labelledby")), false);
    Array.prototype.forEach.call(document.querySelectorAll(".session.is-lit"), function (el) { if (el !== target) el.classList.remove("is-lit"); });
    target.classList.add("is-lit");
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
    $("nav").innerHTML = on.filter(function (s) { return s.id !== "register"; }).map(function (s) {
      return '<li><a href="#' + s.id + '">' + esc(s.label) + "</a></li>";
    }).join("");
    $("header-cta").setAttribute("href", D.header.cta.href);
    $("header-cta").textContent = D.header.cta.label;
    $("sections").innerHTML = on.map(function (s) { return R[s.id](); }).join("");
    $("footer").innerHTML = '<div class="wrap footer-inner"><p class="footer-word">' + esc(m.host) + "</p>" +
      '<nav aria-label="Footer"><ul class="footer-links">' + on.map(function (s) { return '<li><a href="#' + s.id + '">' + esc(s.label) + "</a></li>"; }).join("") + "</ul></nav>" +
      '<p class="footer-small">' + esc(m.name) + " · " + esc(m.dateLine) + "</p>" +
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
    var host = cssVar("--host", "#2340FF"), onHost = cssVar("--on-host", "#FFFFFF");
    var display = cssVar("--display", "sans-serif"), body = cssVar("--body", "sans-serif");
    var fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    Promise.all([fontsReady, loadImage(o.photo ? img(o.photo, 720, 860) : "")]).then(function (r) {
      var photo = r[1];
      var cv = document.createElement("canvas");
      cv.width = W; cv.height = H;
      var ctx = cv.getContext("2d");
      ctx.fillStyle = host; ctx.fillRect(0, 0, W, H);
      var floorY = H - 96, textW = W - P * 2;
      if (photo) {
        // Duotone: grayscale the photo, then multiply it with the host color.
        var pw = 380, ph = floorY - P, px = W - P - pw, py = P;
        var s = Math.max(pw / photo.width, ph / photo.height), sw = pw / s, sh = ph / s;
        var off = document.createElement("canvas"); off.width = pw; off.height = ph;
        var o2 = off.getContext("2d");
        o2.drawImage(photo, (photo.width - sw) / 2, (photo.height - sh) / 2, sw, sh, 0, 0, pw, ph);
        try {
          var data = o2.getImageData(0, 0, pw, ph), d = data.data, hc = hexRgb(host);
          for (var i = 0; i < d.length; i += 4) {
            var l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
            d[i] = hc[0] * l; d[i + 1] = hc[1] * l; d[i + 2] = hc[2] * l;
          }
          o2.putImageData(data, 0, 0);
          ctx.drawImage(off, px, py);
          textW = px - P - 32;
        } catch (e) { /* tainted canvas: leave the photo out */ }
      }
      ctx.fillStyle = onHost;
      ctx.textBaseline = "alphabetic";
      ctx.font = "800 56px " + display;
      ctx.fillText(o.label, P, P + 50);
      // Name: as big as fits, one line if it can, else two.
      var size = 120, n = splitName(o.name), lines;
      ctx.font = "800 " + size + "px " + display;
      while (size > 64 && ctx.measureText(o.name).width > textW) { size -= 4; ctx.font = "800 " + size + "px " + display; }
      lines = ctx.measureText(o.name).width > textW ? [n.first, n.last] : [o.name];
      var y = P + 50 + 24 + size * 0.86;
      lines.forEach(function (ln, k) { ctx.fillText(ln, P, y + k * size * 0.92); });
      y += (lines.length - 1) * size * 0.92 + 56;
      ctx.font = "600 32px " + body;
      wrapLines(ctx, o.title, textW).slice(0, 3).forEach(function (ln, k) { ctx.fillText(ln, P, y + k * 40); });
      ctx.fillRect(P, floorY, W - P * 2, 3);
      ctx.font = "600 24px " + body;
      ctx.fillText(o.cue, P, floorY + 50);
      ctx.font = "800 24px " + display;
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
      wireWall(); wireTabs(); wireMatrix(); wireForm(); wireGlobal();
      applyNameParam();
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
