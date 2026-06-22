// @liatir/output-parser — shared bioinformatics output parsers + ToolOutput types.
//
// Public surface, organised by tool category. Each parser is a pure function:
//   raw tool output (stdout / JSON)  →  typed result  →  ToolOutput (rendered).

export * from './types';

// Quality control
export * from './qc/seqkit';
