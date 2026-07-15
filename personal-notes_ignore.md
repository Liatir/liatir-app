
<!-- IGNORE THIS FILE -->

# IMPORTANT: These are the human developer's personal notes, do not edit nor consider them, just ignore this file
---

## Notes
---


### Liatir Runtime Box cross-platform CI foundation plan:

Gates efforts consigliati:

0. High
1. Extra High
2. High
3. Extra High
4. High
5. Extra High
6. Medium
7. Medium
8. Extra High
9. High
10. Medium

---

Stima durata dei gate:

0. Medium - `DONE`
1. Very long - `DONE`
2. Long - `DONE`
3. Long - `DONE`
4. Long - `DONE`
5. Long - `DONE`
6. Medium - `DONE`
7. Short - `DONE`
8. Very long
9. Long
10. Medium

**I gate più onerosi saranno:**
- Gate 1, perché trasforma il builder attuale in una struttura realmente multipiattaforma.
- Gate 8, perché è il primo collaudo completo cross-platform con Geneformer e include build, validazione scientifica e correzione dei problemi reali.
- Gate 9 può richiedere attesa esterna per configurare il runner macOS arm64, ma non necessariamente tutto quel tempo sarà lavoro attivo o consumo di crediti.

> Queste durate sono relative al lavoro Codex, non equivalgono automaticamente a ore di esecuzione continua: nei gate con build o CI lunghe ti avviserò e interromperò il lavoro attivo, così potrai chiedermi di ricontrollare in seguito.

---

Prompt per far procedere al gate successivo:

```txt

Bene, se hai fatto, per favore prosegui con il gate X del piano: [liatir-runtime-box-ci-foundation-plan.md](/Users/lorenzo/.codex/memories/extensions/ad_hoc/notes/2026-07-14T23-24-53+0200-liatir-runtime-box-ci-foundation-plan.md). Una volta fatto aggiorna velocemente la memoria sul progresso del piano, cosi da non perdere riferimento quando viene compattata la context window e tieni a mente i principi generali in AGENTS.md, e quando hai finito pusha. Detto ciò, vai con il gate X.

```

---
---

<!-- IGNORE THIS FILE -->