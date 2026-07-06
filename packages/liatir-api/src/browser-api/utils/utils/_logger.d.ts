type LogFn = (...args: any[]) => void;
export declare const logger: {
    log: LogFn;
    warn: (...data: any[]) => void;
    error: (...data: any[]) => void;
    devError: (...data: any[]) => void;
    logCaller: LogFn;
    page: LogFn;
    prod: {
        log: (...data: any[]) => void;
        warn: (...data: any[]) => void;
        logCaller: (...args: any[]) => void;
        page: () => void;
    };
};
export {};
