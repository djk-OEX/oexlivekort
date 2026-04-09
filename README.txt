OEX Static Web App – Azure Maps (v2 logo)
========================================

Origins der skal whitelistes i Azure Maps (Authentication > Allowed origins):
- http://localhost:4280               (lokal test via python -m http.server)
- http://localhost:3000               (alternativ dev-port)
- https://<din-app>.azurestaticapps.net  (når du har deployet Static Web App)
- https://<tenant>.sharepoint.com        (når du embedder i SharePoint Online)
- (valgfrit) https://<tenant>.sharepoint.com/sites/<sitename)

GTFS-data til busstop-opslag (Option C)
========================================

Appen bruger lokale GTFS-filer til busstop-opslag og rute-visning – ingen
ekstern API nødvendig. Filerne skal genereres én gang og commites til repo.

Forudsætninger:
  Node.js >= 16

Trin:
  1. Hent dansk GTFS-feed (kræver registrering):
       https://www.rejseplanen.info/labs/  →  GTFS.zip
       eller: https://gtfs.rejseplanen.dk/

  2. Kør preprocessing-scriptet:
       node scripts/build-gtfs-data.js /sti/til/GTFS.zip
       – eller med en udpakket mappe:
       node scripts/build-gtfs-data.js /sti/til/gtfs-mappe/

     For ZIP-understøttelse skal adm-zip installeres første gang:
       npm install --no-save adm-zip

  3. Scriptet skriver fire filer til data/:
       data/stops.json               – alle busstop: [{id, name, lat, lng}, ...]
       data/stop_routes.json         – ruter per stop: {"stop_id": [{line, headsigns}], ...}
       data/routes.json              – route_id → short_name opslag: {"102785-12345": "2A", ...}
       data/departures_5min/*.json   – 5-min afgangsvinduer med linjekort (short_name)

  4. Commit og push de nye datafiler til repo:
       git add data/stops.json data/stop_routes.json data/routes.json data/departures_5min/
       git commit -m "Opdater GTFS-data"
       git push

GTFS-data bør opdateres når Rejseplanen udgiver nye køreplaner
(typisk 2-4 gange om året).
