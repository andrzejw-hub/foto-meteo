# Foto Meteo

Szanse na morze chmur, mgły w dolinach, kolorowe niebo i przejrzystość
dla wybranych miejsc na Dolnym Śląsku – na kolejne wschody i zachody słońca (2 dni).

- **Strona** (`index.html`) pobiera prognozę z Open-Meteo przy każdym otwarciu.
- **Alert** (`scripts/alert.js`, GitHub Actions) codziennie ok. 19:00 sprawdza prognozę
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

- GitHub wyłącza zaplanowane workflow po 60 dniach bez żadnej aktywności w repozytorium.
  Wystarczy od czasu do czasu coś zmienić (np. `spots.json`) albo ponownie włączyć workflow w zakładce Actions.
- Godziny w cronie są w UTC; skrypt sam wybiera przebieg, który w Warszawie wypada ok. 19:00 (latem i zimą).
- Inwersję szacuje różnica temperatur na 925 i 850 hPa (ok. 750 i 1500 m n.p.m.).
  To heurystyka – przy wysokiej ocenie porównaj modele w meteoblue (link przy każdym miejscu).
