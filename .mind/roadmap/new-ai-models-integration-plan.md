# Integrazione production-grade dei nuovi modelli scientifici

## Sintesi

Raccomando **4 fasi**, completabili e rilasciabili separatamente. Tutto viene distribuito come Runtime Box firmato costruito da Scrollcase, installato solo su richiesta e utilizzabile offline.

Scelta architetturale:

- Boltz-2, MHCflurry, RFdiffusion3, ProteinMPNN e Protenix restano **AI Models**.
- pVACtools e OpenMM diventano **Tool Runtimes**: ambienti scientifici installabili, ma non vengono falsamente mostrati come modelli AI.
- RFdiffusion3 e ProteinMPNN condividono un box perché appartengono allo stesso ambiente Foundry.
- Protenix v2 e Mini hanno box separati: chi vuole Mini non deve scaricare anche il modello grande.
- MHCflurry standalone e quello incluso in pVACtools restano separati: pVACtools 7.1.2 blocca ufficialmente MHCflurry 2.0.6, mentre lo standalone corrente è 2.2.1 con PyTorch. Forzare l’aggiornamento significherebbe mantenere un fork non supportato. [pVACtools setup](https://github.com/griffithlab/pVACtools/blob/master/setup.py), [MHCflurry](https://github.com/openvax/mhcflurry)

Stima prudenziale seriale: **50–72 giornate lavorative, circa 10–15 settimane**. Include buffer per incompatibilità, test reali e correzioni; esclude attese dei runner GPU, pubblicazione remota e firma dell’app.

## Box e supporto iniziale

| Componente | Tipo Liatir | Box | Target iniziali |
| --- | --- | --- | --- |
| MHCflurry 2.2.1 | AI Model | dedicato | macOS Metal; Linux/Windows CPU e CUDA |
| pVACtools 7.1.2 + MHCflurry 2.0.6 | Tool Runtime | dedicato | macOS/Linux/Windows CPU |
| Boltz 2.2.1 | AI Model | dedicato | Linux CUDA; prova limitata Windows CUDA e macOS Metal |
| Protenix v2 / runtime 2.0.0 | AI Model | dedicato | Linux CUDA |
| Protenix Mini Default v0.5.0 | AI Model | dedicato | Linux CUDA; prova limitata Windows CUDA |
| RFdiffusion3 + ProteinMPNN / Foundry 0.1.9 | due AI Models, runtime condiviso | unico box suite | Linux CUDA |
| OpenMM 8.5.1 | Tool Runtime | dedicato | CPU sui tre sistemi; CUDA su Linux e Windows |

Per RFdiffusion3 non userei il fork community per Apple Silicon: upstream indica Windows solo tramite WSL2 e l’accelerazione macOS tramite fork, quindi non è una base production-grade. [Installazione RFdiffusion3](https://github.com/RosettaCommons/foundry/blob/production/models/rfd3/docs/tutorials/RFdiffusion3_installation_tutorial.md)

Per ogni target “in prova” viene concesso un solo ciclo di fattibilità: lock delle dipendenze, self-test e inferenza reale. Se servono patch profonde, fork o kernel non supportati, il target viene dichiarato indisponibile nell’interfaccia senza ulteriori tentativi.

## Fase 1 — Runtime Component e contratti scientifici

**Codex effort consigliato: xhigh**  
**Stima prudenziale: 7–10 giorni**

- Generalizzare l’installer esistente mantenendo invariati formato Scrollcase v2, firme, trust root, target ID, rollback, revoche e anti-replay.
- Introdurre `LiatirRuntimeComponentKind = "ai-model" | "tool-runtime"` e un catalogo dei Tool Runtimes. Gli AI Models continuano a usare `ai-runtimes`; pVACtools e OpenMM vivono sotto `tool-runtimes`.
- Aggiungere i comandi generici `lia_runtime_box_install/status/remove/rollback`; i vecchi comandi AI restano alias compatibili.
- Portare installazione, aggiornamento, cancellazione e rimozione nella schermata Dependencies. Il controllo aggiornamenti scarica solamente il piccolo manifest firmato: download e attivazione partono esclusivamente dopo il click su **Update**.
- Estendere il catalogo CI da soli `models` a `components`, mantenendo separati AI Models e Tool Runtimes.
- Aggiungere profili scientifici versionati per:
  - FASTA e allineamenti A3M;
  - VCF tumorale annotato VEP;
  - strutture PDB/mmCIF/SDF;
  - rapporti neoantigenici TSV;
  - traiettorie DCD con struttura iniziale collegata.
- Introdurre `LiatirComplexSpec v1`: formato neutro con proteine, DNA, RNA, ligandi SMILES/CCD, MSA locali, template e vincoli. Gli adattatori lo traducono nei formati Boltz e Protenix.
- Estendere la provenienza AI con una lista di modelli, necessaria per registrare separatamente RFdiffusion3 e ProteinMPNN nello stesso Result.
- Aggiungere una sezione Result per traiettorie molecolari, con player temporale caricato su richiesta.
- Rigenerare SDK e tipi frontend esclusivamente dalla sorgente `packages/liatir-core`.

Accettazione: vecchi box AI ancora installabili ed eseguibili, Tool Runtime isolati, nessuna migrazione distruttiva degli ambienti esistenti e nessun download automatico.

### Implementation status — complete locally (2026-08-25)

- The shared `Runtime Component` lifecycle is live end to end. AI Models remain under
  `ai-runtimes`; Tool Runtimes use the independent `tool-runtimes` root. The generic status,
  install, rollback and remove commands are exposed through the typed browser API, while every
  previous AI command remains a compatibility alias.
- Dependencies owns install, explicit update check, Update, cancel, rollback and remove. A check
  verifies only the bounded signed channel document; it cannot fetch a release manifest, archive
  or activate anything. There is no automatic update check.
- The CI authority is now the schema-v2 `components` catalog. Existing Scrollcase `modelId`, v2
  signatures, target identity, trust roots, revocations and app-global anti-replay state remain
  unchanged. New evidence records carry both product component identity and the compatibility
  `modelId`.
- Core now owns the FASTA, A3M, VEP tumor VCF, PDB/mmCIF/SDF, neoantigen TSV and linked DCD
  profiles; `LiatirComplexSpec v1`; non-empty multi-model AI provenance while retaining the primary
  model fields read by existing Results; and the lazy, memory-bounded DCD Result player. SDK and
  browser API types were regenerated from Core.
- The Tool Runtime catalog is deliberately empty in Phase 1. pVACtools and OpenMM enter it only
  after their later component-specific legal, build, scientific and lifecycle gates pass.

Local evidence: `npm run test:fast` passed 454 tests; `npm run test:verify` passed all six suites;
Rust passed 91 tests with 2 ignored and Clippy completed without errors; `npm run test:ui` passed
all seven applicable suites, including 34 native app scenarios. The signed
security fixture exercised the old AI alias and the generic Tool Runtime install, A-to-B update,
isolated roots, rollback, remove, anti-replay and restart path in the real app. Windows and Linux
desktop lifecycles were not executed on the macOS host. No GPU, heavy-model, publication, signing
or remote deployment action was run.

Release follow-up: the clean frontend install reported five advisories across production and
development dependencies (two low, one moderate and two high). The production-only `npm audit`
could not be queried because this environment did not permit sending the dependency inventory to
the external npm advisory endpoint. Run that authorized registry audit before a public package
release; it does not invalidate the local Phase 1 functional gates above.

## Fase 2 — Oncologia: MHCflurry e pVACtools

**Codex effort consigliato: xhigh**  
**Stima prudenziale: 10–15 giorni**

### Runtime Box

- Box MHCflurry standalone con PyTorch, modelli Class I binding/processing/presentation e asset già inclusi: nessun `mhcflurry-downloads fetch` durante l’uso.
- Box pVACtools con la combinazione ufficiale 7.1.2 + MHCflurry 2.0.6, senza predictor IEDB, servizi web o componenti con licenze non approvate.
- Entrambi con revisioni, pesi, pacchetti e hash esatti; inventario delle licenze per ogni target.

### Superfici utente

- AI Tool **MHC-I Epitope Prediction**:
  - input FASTA proteico oppure tabella di peptidi;
  - alleli HLA-I, lunghezze dei peptidi e modalità binding/presentation;
  - output CSV ordinato, FASTA dei migliori peptidi, riepilogo e provenienza.
- Built-in tool **Neoantigen Prioritization** basato su pVACseq:
  - VCF annotato con VEP, campione tumorale, eventuale normale, alleli HLA-I e VCF di varianti prossimali opzionale;
  - predictor bloccato a MHCflurry/MHCflurryEL;
  - output `all_epitopes`, `filtered`, rapporto aggregato, metriche JSON e FASTA dei candidati.
- Validazione preventiva del VCF: presenza di `CSQ`, genotipi, campione scelto e annotazioni WildtypeProtein/FrameshiftSequence. pVACseq richiede esplicitamente un VCF annotato VEP. [Documentazione pVACseq](https://pvactools.readthedocs.io/en/stable/pvacseq/run.html)
- Preset pipeline **Tumor variants → Neoantigen candidates**.
- Risultati presentati come candidati sperimentali, non come vaccino o terapia validata.

### Validazione scientifica

- Dataset ufficiale pVACseq ridotto, eseguito interamente offline.
- Confronto di conteggi, alleli, peptidi, ranking e colonne obbligatorie con l’output upstream.
- MHCflurry standalone verificato su peptidi noti: valori finiti, ranking stabile e parità CPU/CUDA/MPS entro tolleranza.
- Test di VCF non annotato, allele sconosciuto, campione assente, output vuoto, cancellazione e ripresa della navigazione.

### Implementation status — complete for the authorized Phase 2 scope (2026-08-29)

- The standalone MHCflurry 2.2.1 component has exact Scrollcase recipes and Pixi locks for Apple
  silicon Metal, Linux and Windows CPU, and Linux and Windows CUDA. The pVACseq component has exact
  recipes for macOS and Linux CPU with the upstream-supported pVACtools 7.1.2 + MHCflurry 2.0.6
  pair. The Linux recipe declares Windows WSL2 as a future validation environment; the current app
  does not select Runtime Boxes through WSL2, so Windows pVACseq is not claimed as product support.
- Both components have reviewed legal records, per-target dependency inventories, signer identities,
  component-specific workflows, exact product scripts, native lifecycle specifications and scientific
  validators. The MHCflurry model archive repacker reproduced the prepared artifact byte for byte:
  135,602,727 bytes, SHA-256
  `44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e`.
- The product surfaces are implemented end to end. MHC-I Epitope Prediction accepts protein FASTA
  or peptide tables and produces ranked CSV, candidate FASTA, summary and provenance. Neoantigen
  Prioritization validates the primary and optional proximal VCF contracts before importing the
  scientific stack, locks predictors to local MHCflurry/MHCflurryEL, and records all required pVACseq
  reports, metrics, candidate FASTA, Jobs, Results, logs, cancellation and navigation-safe state.
  Input and output reading is bounded, and network access is denied in both the parent and pVACseq
  child processes. Direct screens bind only to their own direct-run Job, so pipeline executions do not
  disable unrelated inputs. Persisted Result provenance includes every selected scientific parameter,
  both VCF inspections when applicable, accelerator and disabled-network state, and the exact signed
  Runtime Box version, target and archive SHA-256.
- The pipeline step and Tumor variants to neoantigen candidates preset are registered internally but
  filtered from the product until pVACseq has an exact published target. The Neoantigen card follows
  the same catalog gate. The direct pVACseq page says that the runtime is not published; MHCflurry is
  absent from the active AI catalog. This prevents an unvalidated or unavailable component from
  appearing installable.
- The exact upstream pVACtools wheel retains its generic IEDB integration modules because pVACseq
  imports that machinery even for local MHCflurry execution. They are not an approved product surface:
  Liatir permits only MHCflurry/MHCflurryEL, sets IEDB retries to zero and denies parent and child
  network access. Physically pruning those modules would require an unsupported pVACtools fork.

Local evidence: the final `npm run test:verify` passed 70 files / 473 tests; generated
SDK types, Core, frontend checks/build and `src-ts` compile passed. Rust passed 91 tests with 2 heavy
fixtures ignored, and Clippy completed without errors. The real desktop UI gate passed 34 native app
scenarios plus the applicable index, SnpEff, restart, Runtime Box security and macOS desktop lifecycle
suites. The new native MHCflurry and pVACseq E2E specifications loaded correctly but were skipped as
designed because no target is published. Catalog validation, 16 changed JSON documents, JavaScript
syntax and `git diff --check` also passed. No GPU CI, Runtime Box signing or Runtime Box publication ran.

Runtime Box publication remains gated, but its reviewed source mirror is ready. Commit `8128002` added
the dedicated source-mirror command, the manual protected GitHub workflow and the independently
allowlisted Registry route. Callers can select only
`mhcflurry-class1-presentation`; they cannot provide an R2 key, size, SHA-256 or content type. The
Registry was deployed from clean commit bytes as Cloudflare version
`f8905c7a-9893-4d52-93dd-bbcbf4926a34`, and its public health, R2 binding, retained admin secret and
unauthenticated 401 boundary were read back successfully.

The billing-blocked run `33064748592` created no job. The first healthy run `33159915001` reproduced the
archive but exposed a missing stable-CLI route before any Registry request; commit `1a891c7` added that
route and a regression guard. Run `33160339119` then passed the official-source check, deterministic
repack, restricted multipart upload, public byte/hash verification and receipt upload. An independent
public download confirmed 135,602,727 bytes, SHA-256
`44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e`, and 45 entries limited to
`models/` plus `LIATIR_SOURCE.json`. Receipt artifact `9681436581` has digest
`sha256:2047147d0330adb7154edd4309e014b1fc50cde2fc11f050b52703c15cee34c9`. This completed the restricted
source-mirror boundary, not Runtime Box publication. Only targets with their own native evidence may
advance beyond `planned`; production signing, publication and active product-catalog exposure remain
separate release actions.

The implementation commit `e7a7a7b16bbfb37f322db13bda55c6f91ed55e2b` was pushed to `main` after
the local gates. Automatic catalog-only preflights passed for MHCflurry in run `33161230745`
(artifact `9681714960`, digest
`sha256:7984adb083f2d1eaadc54faffb3c4a21fc98bae2fbe04412260494c24aaf0fd6`) and pVACtools in run
`33161230937` (artifact `9681718976`, digest
`sha256:6cceb615655ac04546538578d0bac44dd30b458be679329ce00ac258a45bed84`).

After the Apple-silicon host regained the reviewed free-disk floor, commit
`d8bc51266e8e1eff779c25f0d366d75479de98dc` enabled only MHCflurry
`macos-aarch64-metal`; all other oncology targets remain disabled. Manual native-lifecycle run
`33166465046` passed on ephemeral runner `liatir-macos-heavy-1787915736-91228`. It built and verified
the exact 459,529,381-byte archive (SHA-256
`b9d645b4051eb796308ba29b66005891658c4258e26b32296de57b04bb36b72e`), ran the native self-test,
proved finite and stable binding/presentation predictions, and passed CPU/Metal parity with maximum
absolute difference 0.0014372563091455959 inside the declared 0.001 absolute/relative tolerance.
The Rust lifecycle passed 23 tests with 2 heavy fixtures ignored. Compact evidence artifact
`9683966329` has digest
`sha256:3c7a180df1d584ba4f8b188bc11877d5d020b40b982dbd6df2fc26cdb1531e54`. Cleanup deregistered the
runner and removed its marked root. This proves the first native target, but does not prove CUDA,
production signing/publication or the real product lifecycle; those gates remain separate.

The first pVACseq native attempt, run `33197657605`, built and self-tested the box but exposed two
real product defects before the scientific result could pass: Python `spawn` re-entered the stdin
runner, and the broad pVACview prune removed anchor tables and report support files that pVACseq
itself uses. Commit `ac44d6a70dafff60b144fec6fedaa9a80fc360db` added guarded Python entry points,
kept Unix-domain sockets for local multiprocessing while continuing to reject network sockets,
retained and self-tested only the required pVACview data/support subset, and aligned score parity
with the reviewed 0.001 absolute/relative MHCflurry tolerance. A fresh local box then passed its
self-test and the official reduced pVACseq fixture: 540 all-epitope rows, 3 filtered rows, 11
aggregates, 10 candidate peptides and 2,160 score comparisons, with maximum absolute difference
0.007866887946875067. `npm run test:verify` passed 70 files / 479 tests; Rust passed 92 tests with 2
heavy fixtures ignored, and Clippy completed without errors. Automatic preflight run `33226907559`
passed for the clean commit; artifact `9707173508` has digest
`sha256:277af6af86c03f6056ce92a4797ebef0ccc39a57dce5c8e94377fa1e434fbd02`.

Manual native-lifecycle run `33227035747` then passed on exact ephemeral runner
`liatir-macos-heavy-1787967600-24204`. It built and independently verified the 994,583,880-byte
archive (SHA-256 `1d36f172182ed940ad413a19791defca527e6866a803208aef231eee04c9b706`),
installed size 3,598,150,920 bytes, exact dependency lock and local development signature. The remote
scientific validator reproduced the same 540 / 3 / 11 output counts and 2,160 finite score
comparisons against the official fixture within the declared tolerance. The Rust lifecycle passed
23 tests with 2 heavy fixtures ignored. Compact evidence artifact `9707342686` has digest
`sha256:56925fdfad59a98fffa48ea3e7cee3f36657cac370de43286f42b99ae095c7b9`.
Workflow cleanup passed, the runner deregistered, its marked root was removed and repository runner
inventory returned to zero.

Phase 2 is therefore complete at the authorized implementation and first-native-target scope:
MHCflurry Apple Metal and pVACseq macOS CPU are `native-lifecycle-validated`; all other oncology
targets remain `planned`, and no CUDA claim is made. Both active product catalogs still omit these
unpublished components. Production signing, immutable Runtime Box publication and the real packaged
product release lifecycle were not authorized here and remain explicit release gates rather than
hidden Phase 2 claims.

## Fase 3 — Strutture, affinità e simulazione

**Codex effort consigliato: max**  
**Stima prudenziale: 18–25 giorni**

### Runtime Box

- Boltz-2 con checkpoint di struttura e affinità inclusi; Linux CUDA come target obbligatorio. Boltz supporta CPU/non-CUDA ma upstream avverte che sono molto più lenti, quindi niente box CPU pesanti senza utilità pratica. [Boltz ufficiale](https://github.com/jwohlwend/boltz)
- Box distinti per Protenix v2 e `protenix_mini_default_v0.5.0`. Non usare Mini ESM: richiederebbe anche ESM2-3B e perderebbe il vantaggio di essere leggero. [Modelli Protenix](https://github.com/bytedance/Protenix/blob/main/docs/supported_models.md)
- OpenMM con backend CPU e CUDA, Amber19/TIP3P-FB e parameterizzazione OpenFF per ligandi. Licenze MIT/LGPL registrate separatamente. [OpenMM](https://github.com/openmm/openmm), [piattaforme disponibili](https://github.com/openmm/openmm/blob/master/docs-source/usersguide/application/02_running_sims.rst)

### AI Tools

- **Biomolecular Structure Prediction**, compatibile con Boltz-2, Protenix v2 e Protenix Mini:
  - builder semplice per proteine, acidi nucleici e ligandi;
  - MSA A3M e template esclusivamente locali;
  - modalità avanzata tramite `LiatirComplexSpec`;
  - output mmCIF, punteggi di confidenza, PAE/PDE, tabella dei modelli e viewer 3D.
- **Protein–Ligand Affinity**, solo Boltz-2:
  - una proteina e un piccolo ligando;
  - probabilità di binding e `log10(IC50)` chiaramente distinti;
  - blocco oltre 128 atomi e avviso sopra 56, seguendo i limiti dichiarati da Boltz. [Formato Boltz](https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md)
- Nessun server MSA implicito: senza A3M l’utente deve scegliere esplicitamente la modalità single-sequence, accompagnata dall’avviso di accuratezza inferiore.

### OpenMM

- Tool **Molecular Relaxation**: preparazione, idrogeni, solvente opzionale, minimizzazione e struttura finale.
- Tool **Molecular Dynamics**:
  - preset 10 ps di verifica e 100 ps breve, più durata personalizzata;
  - temperatura, pressione, intervallo di salvataggio e seed;
  - output DCD, struttura finale, CSV energia/temperatura, checkpoint e grafici.
- Checkpoint riprendibile solo con stessa versione e stesso target; altrimenti errore esplicito.
- Nessuna affermazione di affinità o stabilità clinica: OpenMM simula il moto atomico secondo un campo di forze, non dimostra efficacia terapeutica.

### Protezione hardware

- Prima del run stimare token, atomi, RAM, VRAM, tempo e spazio di output.
- Il minimo VRAM pubblicato sarà il picco misurato sui fixture moltiplicato per 1,25; il consigliato userà 1,5.
- Rifiutare prima del caricamento gli input oltre il massimo validato, evitando crash OOM.
- Ogni Result registra GPU/CPU, precisione, seed, MSA, modello, force field e release Scrollcase.

## Fase 4 — RFdiffusion3 + ProteinMPNN e chiusura production

**Codex effort consigliato: max**  
**Stima prudenziale: 15–22 giorni**

- Un solo box Linux CUDA con Foundry, checkpoint RFdiffusion3 e ProteinMPNN, perché condividono codice e dipendenze. Foundry è BSD-3-Clause e distribuisce entrambi nello stesso framework. [Foundry](https://github.com/RosettaCommons/foundry)
- Due AI Model identity distinte e provenienza distinta, anche se installazione e rimozione condividono il runtime.
- AI Tool **Protein Binder Design**:
  - struttura target PDB/mmCIF;
  - catena target, residui hotspot selezionabili dal viewer;
  - intervallo di lunghezza, numero di design, seed e modalità memoria ridotta;
  - validazione dell’input prima di caricare il modello;
  - RFdiffusion3 genera gli scheletri, ProteinMPNN assegna le sequenze.
- Output: strutture progettate, FASTA, tabella di ranking, vincoli risolti, metadati e file intermedi separati dai risultati finali.
- Preset **Design → Sequence → Structure check → Relax**:
  - RFdiffusion3;
  - ProteinMPNN;
  - Protenix Mini per ripredire il complesso;
  - OpenMM per minimizzazione;
  - un Result finale mantiene i collegamenti a tutti i run e non nasconde design scartati o falliti.
- Imporre limiti iniziali conservativi su lunghezza e numero di design; aumentabili solo dopo misure reali.
- Chiudere ogni componente con:
  - record legale e attribution;
  - Scroll, Pixi lock, hash degli asset e self-test;
  - validatore scientifico dedicato;
  - test install/update esplicito/rollback/remove/revoca;
  - Jobs, Results, log, cancellazione e provenienza;
  - documentazione hardware e limiti;
  - lifecycle E2E su ogni target pubblicato;
  - pubblicazione beta manuale e indipendente per componente.

Un box non passa al catalogo pubblico finché non esistono inferenza reale, lifecycle completo e relativo evidence record. Un modello può essere rilasciato senza aspettare gli altri.

## Test e criteri finali

- `npm run test:fast`, `npm run test:verify`, Rust test/clippy e `npm run test:ui`.
- Nessuna rete durante l’esecuzione dopo l’installazione.
- Nessun download o aggiornamento senza scelta esplicita dell’utente.
- Installazioni concorrenti isolate per `runtimeId`; un fallimento non blocca altri run.
- Navigazione, riavvio dell’app, cancellazione e ritorno alla pagina conservano Job e Result corretti.
- Strutture con coordinate finite e topologia coerente; confidence nei range dichiarati.
- OpenMM deve ridurre l’energia nella minimizzazione e riprendere correttamente un checkpoint.
- RFdiffusion3 deve produrre il numero richiesto di strutture; ProteinMPNN deve generare sequenze coerenti con ogni backbone.
- GPU CI esclusivamente manuale, una coppia modello/target per job e nessun retry costoso senza diagnosi locale.

## Assunzioni bloccate

- Solo inferenza locale: niente training o fine-tuning.
- Nessun database MSA enorme incluso; si accettano MSA già preparati oppure la modalità single-sequence esplicita.
- Niente fork community nei target pubblici.
- Protenix Mini significa `protenix_mini_default_v0.5.0`.
- pVACtools v1 copre neoantigeni MHC-I tramite MHCflurry; Class II e predictor IEDB restano fuori.
- OpenMM copre minimizzazione e dinamica molecolare standard, non free-energy perturbation o validazione terapeutica.
- Le predizioni oncologiche sono strumenti di prioritizzazione da verificare sperimentalmente, non dispositivi diagnostici.
