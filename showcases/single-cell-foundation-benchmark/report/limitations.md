# Current scientific and execution limitations

- The two-dataset study remains incomplete. PBMC has final measurements;
  pancreas has four completed representation stages and no final biological
  or batch measurements. The scGPT partial attempt lost its in-memory output.
- One seed and a fixed split do not estimate variation across training,
  clustering, datasets or deployments. There is no statistical superiority claim.
- scVI is trained on each dataset; foundation models receive no fine-tuning.
  Downstream classifiers use the same fixed held-out split for every method.
- The pancreas upstream count layer contains fractional quantification values.
  They are preserved exactly. Integer-count model assumptions are imperfect;
  provenance-gated acceptance does not remove that scientific limitation.
- Resource ceilings deliberately constrain feasibility. UCE's checkpoint alone
  exceeds the Mac's approved memory cap; a preflight failure is not a scientific
  performance score. Linux target availability must be checked independently.
- CPU runs have no accelerator measurement. The recorded nulls and reasons
  must be retained. OS peak RSS for pretrained workers excludes child processes;
  the independent monitor additionally records the whole process family.
- Resumed Linux work creates a different hardware/runtime condition. Preserve
  original Mac provenance and identify each new host; do not compare mixed-host
  timings as if every method ran on one machine.
- Full PBMC native Results and chart validation passed. Pancreas used the
  supported development frontend with the existing verified native bridge;
  updated bundled-native packaging exceeded the Mac's unchanged memory cap.
- Independent final metric reproduction and the complete twelve-row artifact
  validation have not run yet. Helper scripts and instructions are not evidence
  that those remaining completion criteria passed.
