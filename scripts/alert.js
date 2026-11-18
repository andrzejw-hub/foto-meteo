#!/usr/bin/env node
/*
 * Codzienny alert Foto Meteo (GitHub Actions).
 * Pobiera prognozę, liczy oceny tą samą logiką co strona i wysyła
 * powiadomienie ntfy TYLKO gdy któreś zdarzenie ma ocenę >= ALERT_THRESHOLD.
 *
 * Zmienne środowiskowe:
 *   NTFY_TOPIC  – nazwa tematu ntfy (sekret repozytorium)
 *   SITE_URL    – adres strony (otwierany po kliknięciu powiadomienia)
 *   SCHEDULE    – wpis cron, który uruchomił przebieg (z GitHub Actions)
 *   FORCE=1     – pomija kontrolę przebiegu (ręczne uruchomienie)
 *   DRY_RUN=1   – tylko wypisuje wynik, nic nie wysyła
 *   THRESHOLD   – opcjonalnie inny próg (np. 60 do testów)
 */
"use strict";
const path = require("path");
const fs = require("fs");
const FS = require(path.join(__dirname, "..", "scoring.js"));

const EV = { sunrise: "wschód", sunset: "zachód" };

// Open-Meteo czasem nie odpowiada od razu – próbujemy kilka razy z rosnącą przerwą
async function fetchWithRetry(url, opts, label) {
  const waits = [0, 20, 45, 90]; // sekundy
  let lastErr;
  for (let i = 0; i < waits.length; i++) {
    if (waits[i]) { console.log(`${label}: ponowna próba za ${waits[i]} s…`); await new Promise(r => setTimeout(r, waits[i] * 1000)); }
    try {
      const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(30000) }, opts || {}));
      if (res.ok) return res;
      lastErr = new Error(`${label}: HTTP ${res.status}`);
      if (res.status < 500 && res.status !== 429) break; // błąd zapytania – ponawianie nic nie da
    } catch (e) { lastErr = e; console.log(`${label}: ${e.cause ? e.cause.code || e.cause.message : e.message}`); }
  }
  throw lastErr;
}

function dayLabel(iso, nowIso) {
  const diff = Math.round((new Date(iso.slice(0, 10) + "T12:00:00Z") - new Date(nowIso.slice(0, 10) + "T12:00:00Z")) / 86400000);
  return diff === 0 ? "dziś" : diff === 1 ? "jutro" : diff === 2 ? "pojutrze" : iso.slice(0, 10);
}

async function main() {
  const nowIso = FS.nowWarsawIso();
  // Dwa wpisy cron (16:45 i 17:45 UTC); działa tylko ten, który w Warszawie oznacza 18:45.
  // Decyduje wpis, który uruchomił przebieg, a nie godzina startu – GitHub potrafi opóźnić start o kilkadziesiąt minut.
  if (!process.env.FORCE) {
    const offsetH = Number(nowIso.slice(11, 13)) - new Date().getUTCHours();
    const offset = ((offsetH % 24) + 24) % 24; // 1 zimą, 2 latem
    const wanted = offset === 2 ? "45 16 * * *" : "45 17 * * *";
    const sched = (process.env.SCHEDULE || "").trim();
    if (sched !== wanted) {
      console.log(`Pomijam: przebieg z wpisu "${sched}", wieczorny to "${wanted}" (UTC+${offset}).`);
      return;
    }
    // GitHub potrafi opóźnić start o kilka godzin – alert po 21:00 nie ma już sensu (i myli „jutro”/„pojutrze”)
    const hm = nowIso.slice(11, 16);
    if (hm < "18:00" || hm > "21:00") {
      console.log(`Pomijam: GitHub uruchomił przebieg z opóźnieniem, w Warszawie jest już ${hm}.`);
      return;
    }
  }

  const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "spots.json"), "utf8")).filter(s => s.active !== false);
  const res = await fetchWithRetry(FS.buildUrl(spots), null, "Open-Meteo");
  const data = await res.json();
  const results = FS.analyze(spots, data, nowIso);

  const threshold = Number(process.env.THRESHOLD) || FS.ALERT_THRESHOLD;
  const hits = [];
  for (const r of results) for (const ev of r.events) {
    if (ev.best && ev.best.score >= threshold) hits.push({ spot: r.spot, ev });
  }
  hits.sort((a, b) => b.ev.best.score - a.ev.best.score || a.ev.time.localeCompare(b.ev.time));

  // Podsumowanie do logu Actions
  for (const r of results) {
    const cells = r.events.slice(0, 4).map(e => `${dayLabel(e.time, nowIso)} ${EV[e.kind]} ${e.best ? e.best.score : "-"}`).join(" | ");
    console.log(`${r.spot.name.padEnd(28)} ${cells}`);
  }

  if (!hits.length) { console.log(`Brak warunków >= ${threshold}. Bez powiadomienia.`); return; }

  const lines = hits.slice(0, 6).map(h =>
    `${h.ev.best.score} · ${h.spot.name} – ${FS.CONDS[h.ev.best.cond]} (${dayLabel(h.ev.time, nowIso)}, ${EV[h.ev.kind]} ${h.ev.time.slice(11, 16)})`);
  const top = hits[0];
  const title = `Okazja: ${top.spot.name}, ${dayLabel(top.ev.time, nowIso)} ${EV[top.ev.kind]}`;
  const body = lines.join("\n") + (hits.some(h => dayLabel(h.ev.time, nowIso) === "pojutrze") ? "\nPojutrze – prognoza wstępna, potwierdzę jutro." : "");
  console.log("\n" + title + "\n" + body);

  if (process.env.DRY_RUN) return;
  const topic = process.env.NTFY_TOPIC;
  if (!topic) throw new Error("Brak NTFY_TOPIC");
  // Publikacja JSON-em: polskie znaki w tytule działają bez kodowania nagłówków
  const r = await fetchWithRetry("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic, title, message: body, priority: 4, tags: ["camera", "sunrise"],
      click: process.env.SITE_URL || undefined
    })
  }, "ntfy");
  console.log("Powiadomienie wysłane.");
}

main().catch(e => { console.error(e); process.exit(1); });
