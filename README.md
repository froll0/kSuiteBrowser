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
- Schede e più finestre, barra indirizzi/ricerca (DuckDuckGo, Qwant, Ecosia, Startpage, Google)
- Riapertura delle schede della sessione precedente
- Scorciatoie: `Ctrl+T`, `Ctrl+N`, `Ctrl+Shift+N` (finestra privata), `Ctrl+W`, `Ctrl+L`, `Ctrl+R`/`F5`, `Alt+←/→`, `Ctrl+Tab`, `Ctrl+,` (impostazioni), `Ctrl+Shift+Canc` (cancella dati), `F12`
- Download con cartella configurabile o "chiedi dove salvare"

**Impostazioni** (`ksuite://settings`, `Ctrl+,`)
- Generale: avvio, pagina iniziale, motore di ricerca, download
- Aspetto: tema chiaro/scuro/sistema, barra laterale kSuite
- Privacy e sicurezza, permessi dei siti, account kSuite, informazioni
- Ricerca tra le impostazioni

**Privacy e sicurezza**
- **Protezione dal tracciamento** con il motore Ghostery (EasyList, EasyPrivacy, liste uBlock Origin), liste aggiornate ogni settimana:
  *Standard* (pubblicità e tracker) o *Rigorosa* (anche banner dei cookie e altri fastidi)
- **Pulsante scudo** nella barra: quante richieste sono state bloccate e disattivazione delle protezioni per un singolo sito
- **Blocco dei cookie di terze parti** sulle richieste di rete
- **Do Not Track e Global Privacy Control** (`DNT: 1`, `Sec-GPC: 1`)
- **Modalità solo HTTPS**: le pagine `http://` vengono caricate in `https://`; se il sito non lo supporta compare un avviso con "Continua con HTTP" (le reti locali sono escluse)
- **Cancella dati di navigazione** (cookie e dati dei siti, cache, elenco download, permessi) e cancellazione automatica alla chiusura
- **Finestre private**: sessione solo in memoria (cookie, cache, permessi spariscono alla chiusura), i download non vengono caricati su kDrive
- **Permessi dei siti**: valori predefiniti (chiedi/blocca) per fotocamera e microfono, notifiche e posizione; scelte ricordate e revocabili

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
3. Apri **Impostazioni** (`Ctrl+,`) → *Account kSuite* → incolla il token → *Salva e verifica*.

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
  main/       Processo principale: finestre, schede, privacy, download, permessi, menu, IPC
  preload/    Ponti sicuri (contextBridge): UI del browser e pagine interne ksuite://
  renderer/   Interfaccia del browser (barra schede, sidebar, pannello kSuite)
  pages/      Pagine interne: ksuite://settings, ksuite://https-only
  shared/     Tipi, canali IPC, schema delle impostazioni, regole privacy, barra indirizzi
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

- Il blocco dei cookie di terze parti agisce sulle richieste di rete: uno script dentro un iframe di terze parti
  può ancora usare `document.cookie` all'interno di quell'iframe.
- Il browser si basa su Electron, che riceve gli aggiornamenti di sicurezza di Chromium con qualche settimana di ritardo:
  aggiorna regolarmente le dipendenze (`npm update electron`).

- Il caricamento diretto su kDrive è limitato a 1 GB per file (per file più grandi usa l'app web).
- Il pannello Mail usa la casella principale associata al token.
