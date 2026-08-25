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
