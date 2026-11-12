# Liatir 1.0.0

Implementare nell’ordine seguente, mantenendo i contratti condivisi in `packages/liatir-core` e aggiornando documentazione e `.context/` insieme alle modifiche.

## 1. Plugin condivisi

- Portare il catalogo dei plugin a livello dell’app, con migrazione automatica ripetibile senza duplicazioni e senza rompere i riferimenti delle pipeline esistenti.
- Condividere installazione e disponibilità; mantenere esecuzioni, log, risultati e annullamenti associati al workspace di partenza, anche quando l’utente cambia progetto durante un’elaborazione.

## 2. Scripts Python nelle pipeline

- Rendere **Scripts** una voce della barra laterale, con elenco, editor Python, definizione degli ingressi/uscite ed esecuzione diretta.
- Usare struttura, validatori e motore Python dei plugin: contratto obbligatorio, controllato prima dell’esecuzione, e risultati verificati prima di passarli al nodo successivo. Nessun confezionamento `.lia` richiesto.
- Aggiungere gli script al menu dei nodi della pipeline. Ogni esecuzione conserva una copia di codice, contratto e dipendenze utilizzati, così successive modifiche non alterano un lavoro già avviato.
- Tenere gli script **per workspace**, con **Copy to workspace** che crea una copia indipendente, senza trasferire esecuzioni o risultati.
- Conservare i vecchi script JS/TS in un archivio consultabile ed esportabile; nessuna conversione automatica in Python.

## 3. Pipeline predefinite

Aggiungere sette modelli pronti:

- Docking con visualizzazione del complesso.
- Screening di molecole con rivalutazione tramite GNINA.
- Docking → dinamica molecolare → analisi.
- Analisi di traiettorie e interazioni.
- Analisi del metabolismo.
- Simulazione di reazioni biochimiche.
- Simulazione multicellulare.

Ogni modello dichiara risultato atteso, dati richiesti e dipendenze. Collegamenti già configurati; scelte scientifiche lasciate esplicitamente all’utente; requisiti di piattaforma e GPU visibili prima dell’avvio.

## 4. Quenta: due profili locali

- Profilo predefinito **16 GB**: integrare [Gemma 4 12B](https://ollama.com/library/gemma4:12b).
- Profilo **32 GB**, selezionabile con un clic: integrare [Qwen 3.8 27B](https://ollama.com/library/qwen3.8:27b).
- Riutilizzare Ollama, il programma locale che esegue i modelli, con limiti di contesto adeguati ai due profili e download solo su richiesta. Conservare le configurazioni personalizzate.
- Confrontare brevemente risposte e consumo di memoria con l’attuale modello prima di dichiarare il miglioramento.

## 5. Quenta: presentazioni HTML

Ultimo blocco, a priorità inferiore:

- Selezionare uno o più Results e chiedere una presentazione interattiva.
- Generare una pagina HTML con **Preact**, una piccola libreria simile a React, e risorse incluse localmente.
- Usare un percorso dedicato: preparazione dei dati selezionati → generazione → controllo → anteprima, con al massimo un tentativo di correzione.
- Eseguire la pagina in un ambiente isolato: nessuna rete, risorsa esterna, lettura libera dei file o accesso ai comandi dell’app.
- Salvare e riaprire la presentazione nei Results, conservando dati utilizzati e riferimenti ai risultati originali.

## Verifiche e preparazione della versione

Test mirati per migrazioni, isolamento dei workspace, script nelle pipeline e blocco degli accessi della pagina generata; poi i controlli ordinari `test:verify`, `test:ui` e `syngraphe check`.

**La prova estesa con workflow lunghi resta esclusa:** deciderai alla fine se eseguirla. Preparare infine versione 1.0.0 e note di rilascio; la pubblicazione rimane un passaggio successivo.