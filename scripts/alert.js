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
  }

  const spots = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "spots.json"), "utf8")).filter(s => s.active !== false);
  const res = await fetch(FS.buildUrl(spots));
  if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
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
  const r = await fetch("https://ntfy.sh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic, title, message: body, priority: 4, tags: ["camera", "sunrise"],
      click: process.env.SITE_URL || undefined
    })
  });
  if (!r.ok) throw new Error(`ntfy HTTP ${r.status}: ${await r.text()}`);
  console.log("Powiadomienie wysłane.");
}

main().catch(e => { console.error(e); process.exit(1); });
