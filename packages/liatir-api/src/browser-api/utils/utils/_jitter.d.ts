export declare const backoffNoJitter: (attempt: number, baseMin?: number, capMin?: number) => number;
export declare const addJitter: (minutes: number, ratio?: number) => number;
export declare const fullJitter: (attempt: number, baseMin?: number, capMin?: number) => number;
export declare const decorrelatedJitter: (prevMin: number, baseMin?: number, capMin?: number) => number;
