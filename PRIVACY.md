# Informativa sulla privacy

Velo è un browser che gira sul tuo computer. Chi lo sviluppa non riceve dati da Velo: non c'è telemetria, nessun
identificativo dell'installazione, nessuna statistica d'uso.

## Cosa resta sul tuo computer

Cronologia, preferiti, schede, impostazioni, cookie e dati dei siti, password, codici 2FA, indirizzi e carte restano nella
cartella del profilo. Password, codici 2FA, indirizzi e carte sono cifrati (portachiavi del sistema o password
principale). Le finestre private non salvano nulla. L'elenco degli arresti anomali (processo, motivo, versioni, sistema;
senza indirizzi né file) resta anch'esso sul computer.

## Le connessioni che Velo fa da solo

Oltre ai siti che visiti:

| A chi | Perché | Quando |
| --- | --- | --- |
| GitHub (`github.com`, `objects.githubusercontent.com`) | controllare e scaricare gli aggiornamenti di Velo | all'avvio e ogni 6 ore, se gli aggiornamenti sono attivi |
| Liste di Ghostery (EasyList, EasyPrivacy, uBlock Origin) | blocco dei tracker | al massimo una volta a settimana |
| Liste di malware-filter (GitLab, GitHub Pages, Cloudflare Pages) | protezione da phishing e malware | ogni 12 ore, se la protezione è attiva |
| Quad9 (Svizzera) o il DNS cifrato che scegli | risolvere i nomi dei siti | durante la navigazione (*Automatico* usa anche il DNS della rete in riserva) |
| Have I Been Pwned | password compromesse: escono solo i primi 5 caratteri dell'impronta SHA-1 | solo quando premi *Controlla ora*, o salvando una password se l'opzione è attiva |
| Google (componente Widevine) | contenuti protetti (Netflix…) | solo se attivi i contenuti protetti |
| Infomaniak | kDrive, Mail, Calendario, sincronizzazione cifrata, assistente IA | solo con l'account collegato e le funzioni attive |

La CI di Velo avvia un Velo inattivo a ogni modifica e fallisce se contatta altri indirizzi (Google compreso).

## Sincronizzazione

Facoltativa e cifrata da un capo all'altro: i dati partono dal computer già cifrati con una chiave derivata dalla tua
passphrase, che Infomaniak non conosce.

## Assistente IA

Facoltativo. Le domande e, se lo chiedi, il testo della pagina vengono inviati a Infomaniak AI Services con il tuo
account. Mai automaticamente nelle finestre private.

## Segnalazioni degli arresti anomali

Velo non invia nulla. Se scegli *Segnala su GitHub*, si apre una pagina di GitHub già compilata che leggi e invii tu,
con il tuo account GitHub: da quel momento vale l'informativa di GitHub.

## Contatti

Per domande su questa informativa apri una issue nel [repository](https://github.com/froll0/kSuiteBrowser/issues).
