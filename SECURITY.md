# Sicurezza

## Segnalare una vulnerabilità

Non aprire una issue pubblica. Usa *Report a vulnerability* nella scheda **Security** del repository
(GitHub Private Vulnerability Reporting): la segnalazione resta privata finché non c'è una correzione.

Indica la versione di Velo e il sistema, i passi per riprodurre il problema e cosa permette a un attaccante.
Rispondiamo entro una settimana; le correzioni di sicurezza escono in una versione dedicata e sono descritte nelle note
di rilascio dopo la pubblicazione.

## Versioni supportate

Solo l'ultima versione pubblicata riceve correzioni. Velo si aggiorna da solo.

## Come è costruito

- Tutte le pagine girano nella sandbox di Chromium, senza Node.js; le pagine interne `velo://` hanno una CSP stretta e
  rispondono ai comandi privilegiati solo dal proprio frame principale.
- Nessuna estensione di terzi, nessun `<webview>` nelle pagine.
- Password, codici 2FA, indirizzi e carte cifrati (AES-256-GCM) con il portachiavi del sistema o una password principale.
- Electron porta le correzioni di sicurezza di Chromium: ogni settimana la CI controlla se c'è una versione nuova e
  prepara una pull request già aggiornata e provata.
- Fusibili di Electron attivi (niente `ELECTRON_RUN_AS_NODE`, niente debug da riga di comando, integrità dell'archivio).
