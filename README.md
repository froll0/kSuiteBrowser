# kSuite Browser

Browser desktop (Windows, macOS, Linux) con le funzioni di **Infomaniak kSuite** integrate:
navighi il web come in un normale browser e hai kDrive, Mail, Calendar, kChat, kMeet ed Euria
a portata di clic, più un pannello nativo che usa le API ufficiali di Infomaniak.

## Perché Electron + TypeScript

| Opzione | Pro | Contro per un *browser* |
| --- | --- | --- |
| **Electron + TypeScript** ✅ | Motore Chromium incluso e identico su ogni OS, API mature per schede (`WebContentsView`), download, permessi, PDF, menu contestuali | App più pesante (~100 MB) |
| Tauri (Rust) | Leggero | Usa il webview di sistema (WebKitGTK/WebView2/WKWebView): rendering diverso per OS e supporto multi-webview ancora instabile |
| Qt / PySide (QtWebEngine) | Chromium incluso | UI e packaging più laboriosi, ecosistema web meno ricco |

Per un browser servono un motore di rendering completo e controllo fine su schede, download e permessi:
Electron è la scelta più solida. Le app web di Infomaniak (Mail, kDrive, kMeet…) sono ottimizzate per Chromium,
quindi funzionano senza sorprese.

## Funzioni

**Browser**
- Schede multiple, barra indirizzi/ricerca (DuckDuckGo, Qwant, Ecosia, Startpage, Google)
- Scorciatoie: `Ctrl+T`, `Ctrl+W`, `Ctrl+L`, `Ctrl+R`/`F5`, `Alt+←/→`, `Ctrl+Tab`, `F12`
- Download gestiti, pagine di errore, popup di login (OAuth) supportati
- Permessi: fotocamera, microfono, notifiche e condivisione schermo concessi alle app kSuite, richiesti per gli altri siti

**Integrazione kSuite**
- Barra laterale con tutte le app della suite (ogni app resta in una scheda dedicata, login persistente)
- Badge con le email non lette
- Pannello laterale (`Ctrl+Shift+K`):
  - **Home**: profilo, email non lette, eventi di oggi, ultime email
  - **kDrive**: sfoglia cartelle, cerca, scarica, carica file, scegli la cartella di destinazione
  - **Mail**: posta in arrivo e invio email
  - **Agenda**: eventi dei prossimi 7 giorni e creazione rapida di eventi
  - **Download**: con opzione "carica automaticamente su kDrive"
- **Salva la pagina come PDF su kDrive** (`Ctrl+Shift+S`)
- **Invia la pagina via Mail** (`Ctrl+Shift+M`)
- Menu contestuale: *Salva immagine/link su kDrive*, *Invia link via Mail*

## Configurare l'accesso alle API

1. Vai su [Manager Infomaniak → Token API](https://manager.infomaniak.com/v3/ng/accounts/token/list).
2. Crea un token con questi scope: `user_info`, `drive`, `workspace:mail`, `workspace:calendar`.
3. Apri il browser → pannello **Impostazioni** → incolla il token → *Salva e verifica*.

Il token è salvato cifrato con il portachiavi del sistema operativo (`safeStorage` di Electron)
e viene usato solo dal processo principale: le pagine web non possono leggerlo.
In alternativa puoi passarlo con la variabile d'ambiente `KSUITE_API_TOKEN`.

Se il tuo account ha più kDrive puoi sceglierlo nelle impostazioni (oppure indicare l'ID che trovi
nell'URL dell'app web: `.../kdrive/app/drive/<ID>`).

## Sviluppo

Requisiti: Node.js 22+.

```bash
npm install
npm start          # compila e avvia
npm test           # test unitari (client API, omnibox, utilità)
npm run typecheck
```

### Creare l'installer

```bash
npm run dist:win     # .exe (NSIS)
npm run dist:mac     # .dmg
npm run dist:linux   # AppImage e .deb
```

Gli installer finiscono in `release/`. La GitHub Action `CI` li genera per tutti e tre i sistemi
quando pubblichi un tag `v*` o la avvii manualmente.

## Struttura

```
src/
  api/        Client REST Infomaniak (profilo, kDrive, Mail, Calendar) — senza dipendenze da Electron
  main/       Processo principale: finestra, schede, download, permessi, menu, IPC
  preload/    Ponte sicuro (contextBridge) tra UI e processo principale
  renderer/   Interfaccia del browser (barra schede, sidebar, pannello kSuite)
  shared/     Tipi, canali IPC, app della suite, parsing della barra indirizzi
test/         Test Vitest
```

## API utilizzate

| Servizio | Endpoint |
| --- | --- |
| Profilo | `GET api.infomaniak.com/2/profile` |
| kDrive | `GET /2/drive`, `GET /3/drive/{id}/files/{dir}/files`, `GET /3/drive/{id}/files/search`, `GET /2/drive/{id}/files/{file}/download`, `POST /3/drive/{id}/upload` |
| Mail | `GET mail.infomaniak.com/api/mailbox`, `.../mail/{mailbox}/folder`, `.../folder/{id}/message`, `POST/PUT .../draft` |
| Calendar | `GET /1/calendar/pim/calendar`, `GET/POST /1/calendar/pim/event` |

Sono gli stessi endpoint usati dai connettori MCP ufficiali di Infomaniak.

## Limiti noti

- Il caricamento diretto su kDrive è limitato a 1 GB per file (per file più grandi usa l'app web).
- Il pannello Mail usa la casella principale associata al token.
