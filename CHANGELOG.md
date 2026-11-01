# Novità di Velo

Le note di ogni versione. La sezione di una versione diventa il testo della sua pagina di rilascio su GitHub.

## Prossima versione

### Sicurezza e affidabilità
- Segnalazione degli arresti anomali facoltativa e anonima: Velo tiene un breve elenco locale, ripulito da indirizzi,
  percorsi ed e-mail, e propone di aprire una segnalazione su GitHub già compilata, che leggi e invii tu.
- Aggiornamenti di Electron (le correzioni di sicurezza di Chromium) preparati dalla CI: quando esce una versione nuova
  viene aperta una pull request già aggiornata e provata.
- Test end-to-end anche su Windows e macOS, oltre che su Linux.
- Dipendenze e GitHub Actions aggiornate.

### Accessibilità
- Barra delle schede usabile da tastiera (frecce, Home/Fine, Invio, Canc, tasto menu) e `F6` per passare da una parte
  all'altra della finestra.
- Schede e gruppi descritti ai lettori di schermo con il loro stato.
- Contrasto WCAG AA garantito in ogni tema, tavolozza e colore d'accento; controlli automatici con axe-core in CI.

### Funzioni
- Sincronizzazione cifrata anche di codici 2FA, indirizzi, carte, spazi di lavoro e contenitori.
- Contenitori con permessi dei siti propri; «Dimentica i siti alla chiusura» vale anche nei contenitori.
- Le carte si compilano anche nei moduli di pagamento incorporati (Stripe, Adyen…), con il nome del fornitore nel menu.

## 0.6.0

### Novità
- **Pagina di benvenuto** al primo avvio: lingua, aspetto, protezioni, importazione, account facoltativo.
- **Tavolozza dei comandi** (`Ctrl+K`) e **scorciatoie da tastiera personalizzabili**.
- **Impostazioni del sito** (`velo://site`): permessi, protezioni, zoom e cookie in un solo posto.
- **Gruppi di schede**, **spazi di lavoro**, **contenitori** con cookie separati e **profili** separati.
- **Importazione diretta** di preferiti, cronologia, password e cookie da Chrome, Edge, Brave, Vivaldi, Opera,
  Chromium e Firefox.
- **Codici di verifica (2FA)** nel gestore password, **indirizzi e carte di pagamento** nei moduli.
- Animazioni discrete con **riduci movimento**; barra a scomparsa migliorata (pulsanti della finestra su Linux,
  pannello cloud visibile, ricomparsa scorrendo verso l'alto).

### Rimosso
- Estensioni e finestre Tor: i resti nei profili esistenti vengono cancellati al primo avvio.

### Sicurezza e privacy
- Sandbox per tutte le pagine, pagine interne più chiuse, cookie di terze parti bloccati anche per gli script,
  «dimentica i siti alla chiusura», protezione dall'impronta nei Web Worker, link di rimbalzo saltati, verifica di rete
  in CI, livelli di sicurezza *Più sicuro* e *Il più sicuro*.
