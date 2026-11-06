# Protein–Ligand Affinity

Protein–Ligand Affinity is an AI Tool that estimates whether a small molecule
binds a protein, and how strongly.

It runs on [Boltz-2](/ai/models/jwohlwend-boltz-2) only, installed from **AI
Models**. You find it in the app under **Tools → Structure Prediction**, and it
is available as a step in a [pipeline](/pipeline/overview).

## What it does

A **ligand** is a small molecule that attaches to a protein — a drug, for
instance. How tightly it attaches decides whether it works at a sensible dose.
Measuring that in a laboratory is slow, so being able to rank candidate molecules
beforehand is useful.

The tool predicts the structure of the protein with the molecule in place, and on
top of that gives two numbers:

- **Binding probability**, from 0 to 1: how likely it is that the molecule binds
  this protein at all.
- **Log10(IC50) in micromolar**: an estimate of binding strength. **Lower means
  stronger.** A value of 0 means roughly 1 micromolar, −1 roughly 0.1
  micromolar and so ten times tighter, 1 roughly 10 micromolar and so ten times
  weaker.

## Inputs

Exactly **one protein and one small molecule**, one copy each. The protein is
given as its sequence, the molecule as a SMILES string, a text description of its
atoms and bonds. This is the scope Boltz-2's affinity prediction was built for,
so Liatir enforces it rather than returning a meaningless number for a complex
it was not designed to judge.

Molecule size follows Boltz-2's own limits. Liatir counts the molecule's atoms
exactly as the model does: above 56 it warns that you are outside the range the
model was trained on, and above 128 it refuses.

The alignment choice, the seed and the measured-hardware check work exactly as
in [Structure Prediction](/ai/tools/structure-prediction).

## Outputs

| Output | Meaning |
| --- | --- |
| Binding probability | 0 to 1, how likely binding is |
| Log10(IC50), micromolar | Predicted strength; lower is stronger |
| Predicted structure | mmCIF of the complex, for the [3D Structure Viewer](/visualization/structure-viewer) |
| Confidence | pLDDT and pTM for the predicted structure |

## Reading the result

**Use these numbers to rank, not to quote.** They are predictions, not
measurements, and the quantity Boltz-2 predicts (IC50) is not the same as the
quantity laboratories often report (Ki). On the case Liatir measured — human
carbonic anhydrase II — the model correctly called acetazolamide a binder with
probability 0.99 and correctly ranked it above sulfanilamide, matching laboratory
measurements, but its absolute strength values were weaker than the laboratory
ones.

Two further limits are worth knowing. Telling a real binder apart from a molecule
that does not bind at all was not part of what Liatir verified. And a low binding
probability is not proof that a molecule is inactive.

So the honest use of this tool is comparative: run several candidate molecules
against the same protein, and let the ranking tell you which ones to test first.

## Related

- [Molecular Docking](/tools/molecular-docking) takes the opposite approach,
  physically placing a molecule in a binding site and scoring the fit, and it
  handles whole libraries of molecules.
- [Neural Pose Rescoring](/tools/neural-pose-rescoring) re-scores docked poses
  with a neural network.
