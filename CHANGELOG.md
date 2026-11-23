# Novità di Velo

Le note di ogni versione. La sezione di una versione diventa il testo della sua pagina di rilascio su GitHub.

## Prossima versione

### Rifinitura
- **Errori in parole semplici**: «Il calendario non ha accettato la richiesta», «Nessuna connessione con Infomaniak»…
  con *Riprova* e i dettagli tecnici in *Dettagli*, da copiare per una segnalazione.
- **Pannello cloud**: posta ed eventi in cima, i moduli «Scrivi» e «Nuovo evento» si aprono quando servono; kDrive
  con icone colorate per tipo di file, data di modifica, dimensioni in formato italiano e la cartella dei salvataggi
  indicata chiaramente; download con uno stato vuoto che spiega cosa comparirà.
- **Suggerimenti della barra degli indirizzi** larghi quanto la barra (prima erano una finestrella tagliata).
- **Pagine d'errore** con i colori e il tema di Velo (prima sempre chiare), testi più semplici e il codice tecnico in
  *Dettagli*.
- **Barra di caricamento** sottile sotto le barre mentre la pagina si carica.
- **Conferme** («Aggiunto ai preferiti», «Email inviata»…) in basso sopra la pagina: prima coprivano i pulsanti della
  barra.
- **Nuova scheda**: con l'account Infomaniak, la giornata a colpo d'occhio (email da leggere, prossimo impegno) che apre
  il pannello; le app su una riga; tutto sta nello schermo senza scorrere.
- **Richieste dei siti** (fotocamera, microfono, posizione, notifiche, aprire un programma esterno) in una barra di
  Velo sopra la pagina, con «Ricorda per questo sito», invece della finestra di sistema.
- **Tavolozza dei comandi** con un'icona per ogni comando (prima tutti uguali per gruppo) e la lente al posto del
  simbolo ⌘ del Mac.
- **Barra degli indirizzi**: il secondo Esc rimette l'indirizzo della pagina invece di lasciare il testo digitato.

### Correzioni
- Calendario: le date si inviano nell'ora del fuso del profilo Infomaniak, come fa il client ufficiale di Infomaniak.
  Gli eventi creati da Velo non risultano più spostati di una o due ore; se l'elenco degli eventi viene ancora
  rifiutato, il messaggio mostra la richiesta e la risposta complete.

## 0.8.2

### Correzioni
- Assistente IA: non partiva («Errore API 404 … /2/ai/undefined/…») perché Velo leggeva male il numero del prodotto
  AI Services; ora usa quello documentato da Infomaniak e propone solo i modelli di chat già disponibili.
- Eventi del calendario: se l'API rifiuta il formato delle date (errore 422) Velo prova gli altri formati, e i messaggi
  di errore dicono cosa l'API ha contestato.
- «Dimentica i siti alla chiusura» cancella i dati anche di una scheda chiusa mentre stava ancora caricando la prima
  pagina del sito.

## 0.8.1

### Design
- **Nuovo menu ⋮** disegnato da Velo al posto della barra dei menu del sistema: le voci più usate in vista, zoom e
  schermo intero su una riga, «Altri strumenti» e «Aiuto» che si aprono sul posto, interruttori per barra dei preferiti
  e barra a scomparsa, tutto usabile da tastiera.
- **Tutti gli altri menu** nello stesso stile: clic destro sulle pagine, sulle schede e sui preferiti, scudo, sito,
  spazi di lavoro, contenitori, cartelle dei preferiti, compilazione automatica. Seguono tema e colore d'accento, i
  sottomenu si aprono sul posto e le opzioni attive hanno la spunta.
- **Finestre strette**: le schede non finiscono più sotto i pulsanti della finestra né si tagliano a metà. Con le schede
  accanto all'indirizzo, sotto i 980 pixel di larghezza passano da sole sopra la barra; quando sono troppe scorrono, con
  i bordi sfumati.
- Schede più leggibili: i titoli troppo corti lasciano il posto alla sola icona, un divisore separa le schede inattive,
  la scheda attiva si distingue meglio nel tema scuro.

## 0.8.0

### Sicurezza
- Electron 44.10.1: corregge le vulnerabilità note della 44.1 (permessi attribuiti all'origine sbagliata, cookie
  SameSite nelle finestre aperte dai link, certificati eMudhra compromessi e altre).
- Il controllo settimanale propone per prima la correzione della stessa versione principale, e se GitHub non lascia
  aprire la pull request la annuncia nella issue con il link.

### Più computer
- Velo anche per Mac con processore Intel, Windows su ARM e Linux su ARM (64 bit). Su Windows un solo installer
  per Intel/AMD e ARM.

### Preferiti
- **Cartelle dei preferiti**, anche una dentro l'altra: nella barra si aprono come menu, nella pagina Preferiti si
  creano, rinominano ed eliminano. L'importazione da Chrome, Edge, Firefox e dai file HTML mantiene le cartelle, e la
  sincronizzazione le porta sugli altri computer.

### Design
- Tema scuro corretto nelle pagine interne: i riquadri ora risaltano sullo sfondo invece di sprofondarci.
- Pagina nuova scheda: scorciatoie ai siti che scegli tu (aggiungi, modifica, rimuovi), schede chiuse di recente,
  sfondo leggermente tinto di serie.
- La barra dei preferiti vuota compare solo sulla nuova scheda, con il suggerimento per riempirla.
- Impostazioni divise in pagine con la navigazione a gruppi; la ricerca trova le impostazioni in tutte le pagine.
- Preferiti e Cronologia vuoti spiegano cosa fare (con l'importazione dal browser di prima); la cronologia si cancella
  da una finestra con il periodo da scegliere.
- Pagina di benvenuto con i passaggi indicati per nome e l'anteprima dal vivo di tema, colore e schede.
- Pulsanti, intestazioni e larghezze uguali in tutte le pagine; il carattere Inter si carica davvero in tutte le pagine
  interne.

## 0.7.0

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
