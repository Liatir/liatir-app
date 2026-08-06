export type Unlisten = () => void;
export declare const listenForEvent: (event: string, handler: (payload: any) => void) => Promise<Unlisten>;
