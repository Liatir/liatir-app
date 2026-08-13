# Riallineamento del piano “Scientific AI Workbench”

Ultima revisione: 2026-08-13

## Stato corrente

| Gate | Stato |
| --- | --- |
| 1. Sicurezza Runtime Box | Completato su macOS arm64, Windows x86_64 e WSL2 Linux x86_64 |
| 2. Audit delle esecuzioni asincrone | Completato |
| 3. Common execution spine | Completato |
| 4. I/O scientifico standardizzato | Completato localmente su macOS arm64 |
| 5. Lighthouse single-cell | Completato localmente su macOS arm64 |
| 6. Nextflow come External Workflow | Completato localmente su macOS arm64; WSL2 e integrazione Windows→WSL da chiudere |
| 7–8 | Pianificati |

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

**Stato (2026-08-13): completato localmente su macOS arm64; verifica WSL2
Linux x86_64 e integrazione del client Windows con WSL ancora richieste.**

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

Evidenza locale: Nextflow `26.04.6 build 12646` con Java `21.0.11`, E2E nativo
Gate 6 3/3 per esecuzione diretta, doppio riuso nella stessa pipeline, output
downstream, fallimento, cancellazione e recovery esattamente una volta; 16/16
regressioni pipeline/execution-spine/lighthouse; `npm run test:verify` 51 file /
293 test; `cargo test` 52 passati / 2 ignorati intenzionalmente; `cargo clippy
--tests` sul warning baseline esistente. Questa evidenza non vale come prova
Windows o Linux. Nextflow supporta Windows attraverso WSL: servono sia il gate
con un binario ELF Linux compilato ed eseguito in WSL2 sotto Xvfb, sia una
integrazione esplicita del client Windows nativo con quel backend WSL, inclusi
mapping dei path, staging, cancellazione e raccolta output. Un wrapper Windows
ad hoc o il solo run Linux in WSL non dimostrano il comportamento dell'app
Windows.

### 7. Gate Beta 1

**Difficoltà:** `4/5` · **Codex effort:** `high` · **Windows** · **Linux**

- E2E del laboratorio single-cell.
- E2E Nextflow sia autonomo sia dentro una pipeline.
- Provare che il medesimo output sia riutilizzabile downstream.
- Installer firmato, aggiornamento, migrazione, recovery e disinstallazione.
- Documentazione pubblica e support matrix basata sulle evidenze.

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
