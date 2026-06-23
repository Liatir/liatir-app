// @liatir/output-parser — shared bioinformatics output parsers + ToolOutput types.
//
// Public surface, organised by tool category. Each parser is a pure function:
//   raw tool output (stdout / JSON)  →  typed result  →  ToolOutput (rendered).

export * from './types';

// Quality control
export * from './qc/seqkit';
export * from './qc/fastp';
export * from './qc/fastqc';

// Alignment
export * from './alignment/bwa';
export * from './alignment/minimap2';
export * from './alignment/samtools';

// Variants
export * from './variants/bcftools';
export * from './variants/snpeff';
