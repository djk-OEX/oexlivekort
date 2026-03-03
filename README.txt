
OEX Static Web App – Azure Maps (v2 logo)
========================================

Origins der skal whitelistes i Azure Maps (Authentication > Allowed origins):
- http://localhost:4280               (lokal test via python -m http.server)
- http://localhost:3000               (alternativ dev-port)
- https://<din-app>.azurestaticapps.net  (når du har deployet Static Web App)
- https://<tenant>.sharepoint.com        (når du embedder i SharePoint Online)
- (valgfrit) https://<tenant>.sharepoint.com/sites/<sitename>
