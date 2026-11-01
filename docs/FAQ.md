# Domande frequenti

**Velo è gratuito? Serve un account?**
Sì, è gratuito e open source (licenza MIT). L'account Infomaniak è facoltativo: serve solo per kDrive, Mail,
Calendario, la sincronizzazione e l'assistente IA.

**Velo raccoglie dati su di me?**
No. Non c'è telemetria. Le sole connessioni che fa da solo sono elencate nell'[informativa sulla privacy](../PRIVACY.md);
la CI verifica a ogni modifica che un Velo inattivo non contatti altro.

**Su cosa è basato?**
Su Chromium, tramite Electron (la versione di castlabs con Widevine per i contenuti protetti). I siti si comportano come
in Chrome.

**Perché Windows o macOS mostrano un avviso all'installazione?**
Perché i pacchetti non sono ancora firmati con un certificato. L'avviso sparirà con la firma; nel frattempo puoi
verificare l'impronta SHA-256 del file nella pagina della release.

**Netflix, Disney+ o Spotify non partono.**
I contenuti protetti richiedono il modulo Widevine, che viene da Google: Velo lo scarica solo se lo chiedi. Quando un
sito ne ha bisogno compare una barra con *Attiva e riavvia*; oppure **Impostazioni › Privacy e sicurezza**.

**Un sito non funziona bene.**
Prova, in quest'ordine: lo scudo nella barra (*protezioni spente per questo sito*), il livello di sicurezza *Standard*,
la protezione dall'impronta *Standard*. Se un sito serve in http, consenti l'eccezione da `velo://site`.

**Posso usare le estensioni (uBlock, Bitwarden…)?**
No: per sicurezza Velo non installa estensioni di terzi. Il blocco dei tracker è già incluso e il gestore password
importa da Bitwarden, 1Password e gli altri via CSV.

**C'è Tor?**
No, è stato tolto nella 0.6.0: per l'anonimato su rete Tor usa Tor Browser.

**Dove sono i miei dati?**
Nella cartella del profilo (vedi **Impostazioni › Informazioni**). Password, indirizzi, carte e chiavi 2FA sono cifrati
con il portachiavi del sistema o con la tua password principale.

**Ho dimenticato la password principale.**
Le password salvate non si possono recuperare: è il prezzo della cifratura. Puoi ripartire da zero cancellando
`vault.json` nella cartella del profilo; se usi la sincronizzazione, le password tornano dagli altri computer.

**Come uso due account dello stesso sito?**
Con i contenitori (clic destro sul `+`) o con due profili (**Impostazioni › Profili**).

**Come segnalo un problema?**
Dalla pagina [Issues](https://github.com/froll0/kSuiteBrowser/issues) del progetto. Per le vulnerabilità di sicurezza
segui invece [SECURITY.md](../SECURITY.md).
