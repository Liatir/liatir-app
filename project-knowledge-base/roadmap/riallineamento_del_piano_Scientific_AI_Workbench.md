# Riallineamento del piano “Scientific AI Workbench”

Ultima revisione: 2026-08-17

## Stato corrente

| Gate | Stato |
| --- | --- |
| 1. Sicurezza Runtime Box | Completato su macOS arm64, Windows x86_64 e WSL2 Linux x86_64 |
| 2. Audit delle esecuzioni asincrone | Completato |
| 3. Common execution spine | Completato |
| 4. I/O scientifico standardizzato | Completato localmente su macOS arm64 |
| 5. Lighthouse single-cell | Completato localmente su macOS arm64 |
| 6. Nextflow come External Workflow | Completato su macOS arm64, Linux x86_64 e app Windows x86_64 con backend WSL2 Linux x86_64 |
| 7. Gate Beta 1 | In corso: implementazione ed evidenza locale macOS arm64 complete ed eseguite; release Apple firmata/notarizzata e Windows/Linux ancora aperti |
| 8. MCP dopo il nucleo Beta | Pianificato dopo il Gate 7 |

## Indicatori

- **Difficoltà:** complessità tecnica indicativa da `1/5` a `5/5`.
- **Codex effort:** livello di ragionamento consigliato.
- **Windows / Linux:** richiede verifica reale anche su quella piattaforma.

Aggiornare `scientific-ai-workbench.md` e sincronizzare `beta-readiness.md` e `current-project-status.md`.

## Successione dei gate

### 1. Sicurezza Runtime Box

**Difficoltà:** `4/5` · **Codex effort:** `xhigh` · **Windows** · **Linux**

- Provare aggiornamento A → B e rollback.
- Persistenza anti-replay globale all’app.
- Rifiutare documenti firmati più vecchi o equivoci.
- Uno stato corrotto blocca nuovi aggiornamenti, non i modelli già installati.

### 2. Audit delle esecuzioni asincrone

**Difficoltà:** `4/5` · **Codex effort:** `high`

- Verificare Native Tool, Plugin, AI Tool, API Connector e sub-pipeline.
- Un nodo resta `running` finché processi e output necessari non sono conclusi.
- Nessun downstream parte dopo il semplice `spawn` di un Job.
- Per Beta 1 i nodi della stessa pipeline restano sequenziali; pipeline differenti possono procedere contemporaneamente.
- Coprire cancellazione, navigazione, riavvio e finalizzazione prematura.

### 3. Common execution spine

**Difficoltà:** `5/5` · **Codex effort:** `max`

- Uniformare identità, Jobs, Results, log, progress, cancellazione e recovery.
- Introdurre run annidati e l’identità stabile `External Workflow Run`.
- Garantire finalizzazione esattamente una volta e isolamento fra entità indipendenti.

### 4. I/O scientifico standardizzato

**Difficoltà:** `5/5` · **Codex effort:** `xhigh`

**Stato (2026-08-13): completato localmente su macOS arm64.**

- Profili scientifici versionati e retrocompatibili in `packages/liatir-core`.
- Distinguere compatibilità fisica, di formato e scientifica.
- Conservare formato, digest, provenienza, lineage e trasformazioni.
- Prima applicazione completa: AnnData e single-cell.

Il profilo `org.liatir.scientific.anndata@1.0.0` è ora condiviso dal core,
opzionale per i record legacy e compatibile con revisioni minor/patch dello
stesso major. L'identità SHA-256 viene calcolata in streaming dal bridge nativo;
Data, selettori e Results conservano o mostrano validazione, compatibilità e
lineage. Il Single-cell Embedding Tool usa lo stesso contratto in esecuzione
diretta e pipeline, rifiuta incompatibilità note prima del calcolo e produce un
nuovo AnnData immutabile invece di modificare l'input.

Evidenza locale: `npm run test:verify` (47 file / 272 test), `cargo test`
(46 passati / 2 ignorati intenzionalmente), `cargo clippy --tests`, E2E nativo
Gate 4 1/1, pipeline lifecycle 10/10 e common execution spine 5/5. Viewer,
riutilizzo downstream completo e preset no-code restano correttamente nel Gate 5.

### 5. Lighthouse single-cell

**Difficoltà:** `4/5` · **Codex effort:** `xhigh`

**Stato (2026-08-13): completato localmente su macOS arm64.**

- AnnData → validazione → Single-cell Embedding Tool → modello → viewer → riutilizzo.
- Parità tra esecuzione diretta e pipeline.
- Preset no-code utile e verificato.

Il viewer single-cell ora consuma un AnnData profilato, conserva identità e
validazione dell'artefatto e usa l'anteprima CSV prodotta dal Tool. I tre adapter
Geneformer, scGPT e UCE generano una PCA deterministica e limitata a 1.000
cellule per la sola visualizzazione; non viene presentata come UMAP, clustering
o annotazione scientifica completa. Lo stesso finalizzatore produce artefatti,
provenienza e hint del viewer in esecuzione diretta e pipeline.

Il Result consente di registrare AnnData e preview in Data e riaprirli nel
viewer senza cercare path manualmente. Il preset salvabile
`single-cell-embedding-viewer-v1` collega gli output tipizzati del Single-cell
Embedding Tool agli input del viewer, lasciando all'utente solo AnnData e AI
Model da scegliere.

Evidenza locale: `npm run test:verify` (48 file / 279 test), `cargo test`
(46 passati / 2 ignorati intenzionalmente), `cargo clippy --tests`, E2E nativo
Gate 5 1/1, regressione scientific-artifact 1/1, pipeline lifecycle 10/10 e
common execution spine 5/5. Il gate riusa le evidenze di pubblicazione e
ciclo-prodotto già tracciate per i Runtime Box; nessun modello pesante è stato
riscaricato o rieseguito per validare il solo handoff UI/orchestrazione.
Il Gate 5 nativo 1/1 è passato dopo l'implementazione principale. Due successive
correzioni limite del parser/PCA sono coperte dai test unitari e da
`test:verify`; il binario finale è stato ricostruito. La suite è stata poi
rieseguita come regressione del Gate 6 contro il binario Tauri finale ed è
rimasta verde 1/1.

### 6. Nextflow come External Workflow

**Difficoltà:** `5/5` · **Codex effort:** `max` · **Windows** · **Linux**

**Stato (2026-08-14): completato su macOS arm64, Linux x86_64 e client
Windows x86_64 con backend WSL2 Linux x86_64.**

- Aggiungere una nuova entità `External Workflow` e il relativo tipo `external-workflow` nei contratti condivisi.
- Una definizione salvata contiene motore, sorgente locale o revisione repository, parametri, input e output dichiarati.
- Nextflow è il primo adapter; non è una `.lia` Plugin né un normale Native Tool.
- Esporlo direttamente nella sezione Tools/External Workflows.
- Consentire l’esecuzione autonoma con un proprio External Workflow Run, Job e Result.
- Consentire alle pipeline di usare la stessa definizione salvata come nodo, aggiungendo il parent `pipelineRunId`.
- Usare lo stesso adapter, gli stessi parametri e lo stesso mapping I/O per entrambe le modalità.
- Prima versione con Nextflow e Java già installati.
- Registrare sorgente, revisione, profilo, configurazione, ambiente, log, trace, report, timeline e stato finale.
- Convertire gli output dichiarati in artifact Liatir riutilizzabili.
- Non duplicare DSL2, scheduler, cache, resume o parallelismo interno di Nextflow.

`packages/liatir-core` ora possiede la definizione versionata di External
Workflow e il tipo pipeline `external-workflow`. La definizione è salvata per
workspace e descrive sorgente locale o repository a revisione fissa, parametri,
input e output esatti. Tools / External Workflows e il nodo pipeline la
referenziano per lo stesso ID e usano un solo adapter Nextflow.

Ogni run crea una directory isolata, copia sorgente, configurazione e input
senza modificare gli originali, rifiuta link simbolici alla frontiera di
staging e pubblica soltanto gli output esattamente dichiarati. Il run autonomo
ha External Workflow Run, Job e Result di primo livello; il run annidato
mantiene anche `pipelineRunId`. Processi e task restano dettaglio annidato del
singolo Job. Provenienza e Result conservano versioni Nextflow/Java, comando,
sorgente e digest, profilo/configurazione, parametri, input, directory, log,
trace, report, timeline, sessione, task, output, digest e codice d'uscita.
Cancellazione e fallimento restano leggibili; `-resume` è un'azione esperta
esplicita e compatibile con la stessa revisione della definizione.

La chiusura cross-platform mantiene il backend POSIX nativo di macOS/Linux e
aggiunge un confine esplicito `liatir.exe → wsl.exe → Nextflow` su Windows. Il
bridge seleziona e verifica WSL2 Linux x86_64, converte in sicurezza soltanto
path assoluti, conserva staging e raccolta output per singola run, avvia un
nuovo process group identificato da token e lo cancella con TERM/KILL limitati
alla run. I control record persistiti consentono al successivo processo
dell'app di eliminare l'albero orfano e riconciliare una sola volta Job, Result
e parent identity. Il contratto condiviso e i backend macOS/Linux non cambiano.

Evidenza Windows 11 Pro x86_64 build 26200 con WSL `2.7.10.0`, Ubuntu 26.04
LTS, kernel WSL2 `6.18.33.2`, Nextflow `26.04.6 build 12646` e OpenJDK
`21.0.11`: E2E dell'app Windows verso WSL 3/3 e prova restart in due processi
2/2; `npm run test:verify` 51 file / 296 test; `cargo test` 53 passati / 2
ignorati intenzionalmente; `cargo clippy --tests` verde sul warning baseline.
Evidenza Linux nativa nello stesso WSL2, da checkout nel filesystem Linux:
nuovo binario ELF 64-bit x86-64, E2E Xvfb 3/3, `test:verify` 51 / 296,
`cargo test` 52 passati / 2 ignorati e Clippy verde. Dettagli, comandi e
limitazioni sono in
[Gate 6 Nextflow cross-platform evidence](./gate-6-nextflow-cross-platform.md).

### 7. Gate Beta 1

**Difficoltà:** `4/5` · **Codex effort:** `high` · **Windows** · **Linux**

**Stato (2026-08-17): in corso. La parte locale macOS arm64 è implementata e
completamente eseguita; non è ancora evidenza di una release pubblicabile.**

- E2E del laboratorio single-cell.
- E2E Nextflow sia autonomo sia dentro una pipeline.
- Provare che il medesimo output sia riutilizzabile downstream.
- Installer firmato, aggiornamento, migrazione, recovery e disinstallazione.
- Documentazione pubblica e support matrix basata sulle evidenze.

Il frontend di produzione è ora incorporato nell'app e resta avviabile offline.
Il bridge updater nativo usa il verificatore Tauri, serializza le operazioni e
rifiuta installazione o restart mentre un Job è attivo. Migrazioni fallite
aprono un percorso di recovery senza cancellare dati. Un gate locale separato
ha prodotto, verificato e montato un DMG ad-hoc esplicitamente non pubblicabile;
una prova in due processi ha conservato workspace e Results attraverso
migrazione, restart e rimozione dell'app. Le regressioni native single-cell
1/1 e Nextflow reale 3/3 sono verdi.

Le due prove rimaste sospese sono state eseguite il 2026-08-17 su un binario
ricostruito dal worktree corrente: il pacchetto DMG ad-hoc passa sulla revisione
attuale (`codesign` e `hdiutil` verdi, immagine montata e ispezionata) e l'E2E di
recovery da indice corrotto passa 1/1. La prima esecuzione di quest'ultimo ha
rivelato un difetto **nel test**, non nell'app: un handle WebDriver già risolto
resta memorizzato, quindi chiedere a un nodo rimosso se è visibile solleva uno
stale reference invece di riportarne l'assenza. Corretto interrogando di nuovo
l'elemento a ogni ciclo.

È stato inoltre corretto un difetto di proprietà delle suite: i due spec
`desktop-beta-macos-*` non dichiaravano `requiredEnv`, quindi il glob predefinito
del runner li avrebbe eseguiti dentro `npm run test:ui` senza lo stato seminato
dall'orchestratore. Ora richiedono `LIATIR_DESKTOP_BETA_LIFECYCLE`, la prova di
ciclo di vita è una suite dichiarata (`desktop-beta-lifecycle-e2e`) nei profili
`ui` e `all`, il matrix runner supporta `platforms` per saltare una suite fuori
piattaforma invece di fallirla, e un test unitario impedisce che uno spec
orchestrato torni a finire nel glob predefinito.

Evidenza finale macOS: `npm run test:verify` 52 file / 306 test, `cargo test` 54
passati / 2 ignorati intenzionalmente, `desktop-beta:test:macos` 2 processi su 2,
Gate 5 1/1, updater/Job-safety 1/1, scientific-artifact 1/1.

Restano aperti Developer ID, notarizzazione e updater firmato A → B su un
pacchetto pubblico, oltre ai gate desktop Windows e Linux. Dettagli e handoff:
[Gate 7 Beta 1 — macOS evidence](./gate-7-beta1-macos.md).

### 8. MCP dopo il nucleo Beta

**Difficoltà:** `5/5` · **Codex effort:** `max`

- Server MCP locale con risorse in lettura e pipeline salvate eseguibili in modo controllato.
- Identità asincrona stabile per ogni esecuzione.
- Stato, log, cancellazione e Results consultabili separatamente.
- Allowlist, autorizzazione esplicita e audit.
- Nessuna shell arbitraria, modifica autonoma delle pipeline o decisione scientifica autonoma.
- Validazione con un vero client MCP.

## Contratti e verifiche comuni

- I contratti restano in `packages/liatir-core`.
- La definizione External Workflow è unica; UI diretta e nodo pipeline la referenziano per ID.
- Un run autonomo produce un Result di primo livello.
- Un run dentro una pipeline conserva sia `externalWorkflowRunId` sia `pipelineRunId`.
- Test asincrono con Job ritardato per impedire downstream prematuri.
- Test Nextflow diretto, annidato, cancellato, fallito e riconciliato dopo restart.
- Nessuna readiness viene promossa senza evidenza ripetibile.

## Assunzioni

- P5.0–P5.7 resta chiuso.
- Nextflow è il primo External Workflow supportato.
- Il parallelismo interno delle pipeline Liatir non è richiesto per Beta 1.
- MCP viene dopo Beta 1.
- HPC, cloud executor, installazione gestita e altri workflow engine vengono dopo il primo adapter Nextflow verificato.
