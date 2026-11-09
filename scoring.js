/*
 * Foto Meteo – ocena warunków fotograficznych.
 * Ten sam plik działa w przeglądarce (window.FotoScore) i w Node (require).
 * Dane: Open-Meteo, model "best match", strefa Europe/Warsaw.
 */
(function (root) {
  "use strict";

  var HOURLY = [
    "temperature_2m", "dew_point_2m", "relative_humidity_2m",
    "cloud_cover_low", "cloud_cover_mid", "cloud_cover_high",
    "visibility", "wind_speed_10m", "precipitation",
    "temperature_925hPa", "temperature_850hPa"
  ];

  var CONDS = {
    inwersja: "Inwersja / morze chmur",
    mgly: "Mgły w dolinach",
    swiatlo: "Światło wsch./zach.",
    przejrzystosc: "Przejrzystość"
  };

  // Progi ocen (0–100)
  var LEVELS = [
    { min: 85, key: "wyjatkowe", label: "wyjątkowe" },
    { min: 65, key: "dobre", label: "dobre" },
    { min: 45, key: "mozliwe", label: "możliwe" },
    { min: 0, key: "slabe", label: "słabe" }
  ];
  var ALERT_THRESHOLD = 85;

  function buildUrl(spots) {
    var p = [
      "latitude=" + spots.map(function (s) { return s.lat; }).join(","),
      "longitude=" + spots.map(function (s) { return s.lon; }).join(","),
      "elevation=" + spots.map(function (s) { return s.alt; }).join(","),
      "hourly=" + HOURLY.join(","),
      "daily=sunrise,sunset",
      "timezone=Europe%2FWarsaw",
      "forecast_days=3"
    ];
    return "https://api.open-meteo.com/v1/forecast?" + p.join("&");
  }

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function num(x, d) { return (typeof x === "number" && isFinite(x)) ? x : d; }
  function round1(x) { return Math.round(x * 10) / 10; }

  function level(score) {
    for (var i = 0; i < LEVELS.length; i++) if (score >= LEVELS[i].min) return LEVELS[i];
    return LEVELS[LEVELS.length - 1];
  }

  // Indeks godziny w tablicy hourly dla czasu "YYYY-MM-DDTHH:MM" (zaokrąglone do pełnej godziny w dół)
  function hourIndex(times, iso) {
    var key = iso.slice(0, 13) + ":00";
    return times.indexOf(key);
  }

  // Średnie warunki w oknie [i0, i1] (włącznie)
  function sample(h, i0, i1) {
    var out = {}, n = 0;
    HOURLY.forEach(function (k) { out[k] = 0; });
    out.minSpread = 99;
    for (var i = i0; i <= i1; i++) {
      if (i < 0 || i >= h.time.length) continue;
      n++;
      HOURLY.forEach(function (k) { out[k] += num(h[k] && h[k][i], 0); });
      var spread = num(h.temperature_2m[i], 0) - num(h.dew_point_2m[i], -99);
      if (spread < out.minSpread) out.minSpread = spread;
    }
    if (!n) return null;
    HOURLY.forEach(function (k) { out[k] /= n; });
    out.precipitation *= n; // suma, nie średnia
    return out;
  }

  // --- poszczególne warunki: zwracają {score 0..1, why: [..]} ---

  function windFactor(w) { return w <= 5 ? 1 : w <= 10 ? 0.7 : w <= 15 ? 0.35 : 0.05; }

  function scoreInversion(s, spot) {
    var inv = s.temperature_850hPa - s.temperature_925hPa; // normalnie ok. -4,5 °C
    var invF = clamp((inv + 3) / 5, 0, 1);
    var why = ["różnica T850–T925: " + round1(inv) + " °C" + (inv > 0 ? " (inwersja)" : inv > -2 ? " (słaby spadek, możliwa inwersja)" : " (brak inwersji)")];
    var score;
    if (spot.alt >= 800) {
      var lowF = s.cloud_cover_low >= 70 ? 1 : s.cloud_cover_low >= 40 ? 0.7 : s.cloud_cover_low >= 20 ? 0.35 : 0.1;
      var rh = s.relative_humidity_2m;
      var topF = rh < 75 ? 1 : rh < 85 ? 0.7 : rh < 92 ? 0.3 : 0.05;
      var aboveF = 1 - (s.cloud_cover_mid / 100) * 0.6 - (s.cloud_cover_high / 100) * 0.2;
      score = invF * lowF * topF * clamp(aboveF, 0, 1);
      why.push("niskie chmury: " + Math.round(s.cloud_cover_low) + "%");
      why.push("wilgotność na szczycie: " + Math.round(rh) + "%" + (rh < 85 ? " (szczyt prawdopodobnie ponad chmurami)" : " (szczyt może być w chmurze)"));
    } else {
      var skyF = clamp(1 - (s.cloud_cover_mid + s.cloud_cover_high) / 200, 0, 1);
      var humF = s.relative_humidity_2m >= 85 ? 1 : s.relative_humidity_2m >= 75 ? 0.6 : 0.3;
      score = invF * skyF * humF * windFactor(s.wind_speed_10m);
      why.push("wiatr: " + Math.round(s.wind_speed_10m) + " km/h");
    }
    return { score: score, why: why };
  }

  function scoreFog(s, spot, kind) {
    var sp = s.minSpread;
    var fogF = sp <= 0.5 ? 1 : sp <= 1.5 ? 0.8 : sp <= 3 ? 0.4 : sp <= 5 ? 0.15 : 0;
    var skyF = clamp(1 - (s.cloud_cover_mid / 100) * 0.5 - (s.cloud_cover_high / 100) * 0.2, 0, 1);
    var score = fogF * windFactor(s.wind_speed_10m) * skyF * (kind === "sunset" ? 0.5 : 1);
    return {
      score: score,
      why: [
        "różnica temp. i punktu rosy: " + round1(sp) + " °C" + (sp <= 1.5 ? " (powietrze prawie nasycone)" : ""),
        "wiatr: " + Math.round(s.wind_speed_10m) + " km/h",
        kind === "sunset" ? "wieczorem mgły rzadsze niż o świcie" : null
      ].filter(Boolean)
    };
  }

  function scoreLight(s, spot) {
    var hi = s.cloud_cover_high, mid = s.cloud_cover_mid, low = s.cloud_cover_low;
    var highF = (hi >= 30 && hi <= 60) ? 1 : (hi >= 20 && hi <= 70) ? 0.85 : (hi >= 10 && hi <= 85) ? 0.55 : 0.2;
    var midF = mid <= 30 ? 1 : mid <= 60 ? 0.6 : 0.2;
    var lowF = low <= 20 ? 1 : low <= 50 ? 0.5 : 0.1;
    if (spot.alt >= 800 && s.relative_humidity_2m < 80) lowF = Math.max(lowF, 0.8); // chmury poniżej szczytu nie zasłaniają
    return {
      score: highF * midF * lowF,
      why: ["chmury wysokie/średnie/niskie: " + Math.round(hi) + "/" + Math.round(mid) + "/" + Math.round(low) + "%",
        highF >= 0.85 ? "wysokie chmury mogą się zapalić" : hi < 10 ? "czyste niebo – mało koloru" : "za dużo wysokich chmur"]
    };
  }

  function scoreClarity(s, spot) {
    var vis = s.visibility;
    var visF = vis >= 40000 ? 1 : vis >= 25000 ? 0.75 : vis >= 15000 ? 0.45 : 0.15;
    var rh = s.relative_humidity_2m;
    var rhF = rh < 60 ? 1 : rh < 75 ? 0.7 : rh < 85 ? 0.4 : 0.1;
    var cloudF = (s.cloud_cover_low <= 20 && s.cloud_cover_mid <= 40) ? 1 : s.cloud_cover_low <= 50 ? 0.5 : 0.1;
    return {
      score: (visF * 0.5 + rhF * 0.5) * cloudF,
      why: ["widzialność: " + Math.round(vis / 1000) + " km", "wilgotność: " + Math.round(rh) + "%"]
    };
  }

  var SCORERS = { inwersja: scoreInversion, mgly: scoreFog, swiatlo: scoreLight, przejrzystosc: scoreClarity };

  function scoreEvent(loc, spot, kind, iso) {
    var h = loc.hourly;
    var i = hourIndex(h.time, iso);
    if (i < 0) return null;
    var s = sample(h, i - 1, i);
    if (!s) return null;
    var best = null, details = {};
    (spot.conds || []).forEach(function (c) {
      var f = SCORERS[c];
      if (!f) return;
      var r = f(s, spot, kind);
      var sc = r.score;
      if (s.precipitation > 0.3) { sc *= 0.2; r.why.push("opady: " + round1(s.precipitation) + " mm"); }
      var pct = Math.round(clamp(sc, 0, 1) * 100);
      details[c] = { score: pct, why: r.why };
      if (!best || pct > best.score) best = { cond: c, score: pct };
    });
    var notes = [];
    if (spot.tower) {
      var hr = parseInt(iso.slice(11, 13), 10);
      if (kind === "sunrise" || hr >= 16) notes.push("Wieża o tej porze najpewniej zamknięta – fotografuj z poziomu szczytu.");
    }
    return {
      kind: kind, time: iso, best: best, details: details, notes: notes,
      raw: {
        t2m: round1(s.temperature_2m), rh: Math.round(s.relative_humidity_2m),
        low: Math.round(s.cloud_cover_low), mid: Math.round(s.cloud_cover_mid), high: Math.round(s.cloud_cover_high),
        visKm: Math.round(s.visibility / 1000), wind: Math.round(s.wind_speed_10m),
        precip: round1(s.precipitation), inv: round1(s.temperature_850hPa - s.temperature_925hPa)
      }
    };
  }

  // Zwraca listę zdarzeń (wschód/zachód) po "nowIso" dla każdego miejsca.
  function analyze(spots, data, nowIso) {
    var locs = Array.isArray(data) ? data : [data];
    return spots.map(function (spot, idx) {
      var loc = locs[idx];
      var events = [];
      if (loc && loc.daily) {
        loc.daily.time.forEach(function (d, j) {
          [["sunrise", loc.daily.sunrise[j]], ["sunset", loc.daily.sunset[j]]].forEach(function (pair) {
            if (!pair[1] || pair[1] <= nowIso) return;
            var ev = scoreEvent(loc, spot, pair[0], pair[1]);
            if (ev) events.push(ev);
          });
        });
      }
      return { spot: spot, events: events };
    });
  }

  function nowWarsawIso(date) {
    var d = date || new Date();
    var parts = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    }).format(d); // "2026-11-08 21:30"
    return parts.replace(" ", "T");
  }

  var api = {
    HOURLY: HOURLY, CONDS: CONDS, LEVELS: LEVELS, ALERT_THRESHOLD: ALERT_THRESHOLD,
    buildUrl: buildUrl, analyze: analyze, level: level, nowWarsawIso: nowWarsawIso
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FotoScore = api;
})(typeof window !== "undefined" ? window : this);
