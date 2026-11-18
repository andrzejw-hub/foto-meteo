# Foto Meteo

Szanse na morze chmur, mgły w dolinach, kolorowe niebo i przejrzystość
dla wybranych miejsc na Dolnym Śląsku – na kolejne wschody i zachody słońca (2 dni).

- **Strona** (`index.html`) pobiera prognozę z Open-Meteo przy każdym otwarciu.
- **Alert** (`scripts/alert.js`, GitHub Actions) codziennie o 18:50 – uruchamiany z cron-job.org – sprawdza prognozę
  i wysyła powiadomienie ntfy tylko przy ocenie ≥ 85 („wyjątkowe”).
- **Ocena** (`scoring.js`) – wspólna logika dla strony i alertu.
- **Miejsca** (`spots.json`) – edytuj ten plik, żeby dodać lub wyłączyć lokalizację (`"active": false`).

## Uruchomienie

1. **GitHub Pages**: Settings → Pages → Source: *Deploy from a branch*, gałąź `main`, folder `/ (root)`.
   Strona będzie pod `https://<użytkownik>.github.io/<repozytorium>/`.
2. **Powiadomienia**: zainstaluj aplikację **ntfy** (Android/iOS) i zasubskrybuj temat
   o trudnej do zgadnięcia nazwie, np. `foto-meteo-` + kilka losowych znaków.
   W repozytorium: Settings → Secrets and variables → Actions → *New repository secret*:
   nazwa `NTFY_TOPIC`, wartość = nazwa tematu.
3. **Test**: Actions → *Alert Foto Meteo* → *Run workflow*, w polu progu wpisz `20`
   – powinno przyjść powiadomienie. Puste pole = normalny próg 85.

## Uwagi

- Alert uruchamia zadanie na cron-job.org (POST na `/actions/workflows/alert.yml/dispatches`, body `{"ref":"main"}`,
  token fine-grained z uprawnieniem Actions: Read and write). Gdy token wygaśnie, trzeba wkleić nowy w cron-job.org.
- Inwersję szacuje różnica temperatur na 925 i 850 hPa (ok. 750 i 1500 m n.p.m.).
  To heurystyka – przy wysokiej ocenie porównaj modele w meteoblue (link przy każdym miejscu).
