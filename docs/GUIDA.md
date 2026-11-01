# Guida rapida di Velo

## Installare

Scarica l'installer dell'ultima versione dalla pagina [Releases](https://github.com/froll0/kSuiteBrowser/releases/latest):

| Sistema | File |
| --- | --- |
| Windows 10 e 11 (64 bit) | `Velo-x.y.z-win-x64.exe` |
| macOS (Apple Silicon) | `Velo-x.y.z-mac-arm64.dmg` |
| Linux | `Velo-x.y.z-linux-x86_64.AppImage` oppure `Velo-x.y.z-linux-amd64.deb` |

Finché i pacchetti non sono firmati, Windows può mostrare l'avviso di SmartScreen (*Ulteriori informazioni › Esegui
comunque*) e macOS chiede conferma alla prima apertura (clic destro sull'app › *Apri*).

Velo si aggiorna da solo: scarica le nuove versioni in background e le installa al riavvio (sul Mac serve la firma; fino
ad allora compare un avviso con il link alla nuova versione).

## Il primo avvio

La pagina di benvenuto ti guida in cinque passaggi: lingua, aspetto, protezioni, importazione dal browser che usavi e
account Infomaniak facoltativo. Puoi saltarla e cambiare tutto più tardi in **Impostazioni** (`Ctrl+,`).

## Le cose da sapere

- **Cerca o vai a un sito** dalla barra degli indirizzi (`Ctrl+L`). Scrivi `?` seguito da una domanda per l'assistente
  IA, se l'hai attivato.
- **Tavolozza dei comandi** (`Ctrl+K`): trova qualsiasi comando, scheda aperta, impostazione o preferito.
- **Schede**: trascinale per riordinarle o spostarle in un'altra finestra; clic destro per fissarle, metterle in un
  gruppo, spostarle in uno spazio di lavoro o riaprirle in un contenitore.
- **Contenitori**: clic destro sul `+` per aprire una scheda con cookie separati (per esempio Lavoro e Personale).
- **Lo scudo** nella barra mostra quanti tracker sono stati bloccati e permette di spegnere le protezioni per un sito
  che non funziona.
- **Il lucchetto** accanto all'indirizzo apre le informazioni del sito: permessi, cookie e le sue impostazioni.
- **Password**: dopo un accesso Velo propone di salvarla; la volta dopo basta un clic nel campo. In `velo://passwords`
  trovi anche codici 2FA, indirizzi e carte.
- **Finestra privata** (`Ctrl+Maiusc+N`): niente cronologia, cookie e dati dopo la chiusura.

## Scorciatoie principali

| Azione | Windows e Linux | macOS |
| --- | --- | --- |
| Nuova scheda | `Ctrl+T` | `⌘T` |
| Chiudi scheda | `Ctrl+W` | `⌘W` |
| Riapri scheda chiusa | `Ctrl+Maiusc+T` | `⌘⇧T` |
| Tavolozza dei comandi | `Ctrl+K` | `⌘K` |
| Cerca tra le schede | `Ctrl+Maiusc+A` | `⌘⇧A` |
| Trova nella pagina | `Ctrl+F` | `⌘F` |
| Spazio di lavoro successivo | `Ctrl+Alt+→` | `⌘⌥→` |
| Parte successiva della finestra | `F6` | `F6` |
| Modalità lettura | `F9` | `F9` |

Tutte si possono cambiare in **Impostazioni › Scorciatoie**.

## Portare i dati da un altro browser

**Impostazioni › Password › Importa da un altro browser** (oppure `velo://import`): scegli il browser e cosa importare.
Chiudi prima l'altro browser per avere i dati più recenti. Se le password non si possono leggere (Chrome 127 e
successivi su Windows, Firefox con password principale), esportale in CSV da quel browser e importale da
`velo://passwords`.

## Sincronizzare più computer

Con un account Infomaniak collegato, **Impostazioni › Sincronizzazione** copia su kDrive, cifrati con una passphrase che
solo tu conosci, preferiti, password (con codici 2FA, indirizzi e carte), cronologia, schede aperte, spazi di lavoro e
contenitori.

## Se qualcosa non va

- Un sito non funziona: prova a spegnere le protezioni dallo scudo, o abbassa il livello di sicurezza.
- Velo si è chiuso all'improvviso: al riavvio propone una segnalazione anonima, che leggi prima di inviarla.
- Altre domande: [domande frequenti](FAQ.md).
