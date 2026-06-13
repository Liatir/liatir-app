type LogFn = (...args: any[]) => void;
export declare const logger: {
    log: LogFn;
    warn: LogFn;
    error: (...data: any[]) => void;
    devError: LogFn;
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
