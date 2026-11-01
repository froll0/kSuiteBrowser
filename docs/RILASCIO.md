# Come si pubblica una versione

## 1. Prima

- La CI del commit da pubblicare è verde: typecheck, test unitari, build, test end-to-end su Linux, Windows e macOS,
  verifica di rete.
- `CHANGELOG.md`: la sezione «Prossima versione» diventa `## X.Y.Z` (diventerà il testo della release).
- `npm version X.Y.Z --no-git-tag-version`, commit, push.

## 2. Pubblicare

*Actions › CI › Run workflow* con l'opzione **release**. La CI crea la bozza con le note del CHANGELOG, compila e firma
(se i certificati sono nei secrets) gli installer dei tre sistemi, li carica con i file per l'aggiornamento automatico e
pubblica la release. Se un passo fallisce, rilanciando si riparte da zero (la bozza viene sostituita).

## 3. Prove a mano (prima di una versione importante e sempre per la 1.0)

Su Windows 11, macOS (Apple Silicon) e una Linux (Ubuntu o Fedora), con un profilo nuovo e con uno della versione
precedente:

- [ ] Installazione senza avvisi (con la firma) e primo avvio con la pagina di benvenuto
- [ ] Aggiornamento automatico dalla versione precedente (dati, schede e password ancora lì)
- [ ] Importazione da Chrome, Edge e Firefox installati (password comprese; su macOS compare la richiesta del portachiavi)
- [ ] Salvataggio e compilazione di una password, di un codice 2FA, di un indirizzo, di una carta (anche su un negozio
      con Stripe)
- [ ] Netflix o Spotify dopo *Attiva e riavvia* (Widevine)
- [ ] Barra a scomparsa, pulsanti della finestra, schermo intero, picture-in-picture
- [ ] Contenitori, gruppi, spazi di lavoro, un secondo profilo
- [ ] Sincronizzazione tra due computer
- [ ] Lettore di schermo: NVDA su Windows e VoiceOver su macOS leggono schede, barra degli indirizzi e impostazioni;
      tutto raggiungibile da tastiera
- [ ] Un arresto anomalo provocato (*Gestione attività* › termina il processo di una scheda) compare nell'elenco

## Aggiornare Electron (correzioni di sicurezza)

Ogni lunedì la CI controlla l'Electron di castlabs. Se ce n'è uno nuovo apre una issue e una pull request già
aggiornata e provata su Linux: unirla, controllare che la CI sia verde sui tre sistemi, pubblicare una versione
correttiva. A mano: `node scripts/update-electron.mjs [versione]`.

## Firma del codice

Aggiungere ai secrets del repository `CSC_LINK` e `CSC_KEY_PASSWORD` (certificato Windows `.pfx` o macOS `.p12` in
base64) e, per la notarizzazione Apple, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Le build successive
sono firmate senza altre modifiche.
