"use strict";
// _logger.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const _pageStore_1 = require("./_pageStore");
const _utils_1 = require("./_utils");
const noop = () => { };
const dev = () => {
    try {
        return (0, _utils_1.isDev)();
    }
    catch {
        return false;
    }
};
exports.logger = {
    log: (dev()) ? console.log.bind(console) : noop,
    warn: (dev()) ? console.warn.bind(console) : noop,
    error: console.error.bind(console), // always logs
    devError: (dev()) ? console.error.bind(console) : noop,
    logCaller: (dev())
        ? (...args) => {
            const name = (0, _utils_1.callerName)(3); // called at log time (3 means level 3, it looks for the caller of the caller, otherwise would always log logger.logCaller)
            console.log(`${name}()`, ...args);
        }
        : noop,
    page: (dev())
        ? () => {
            console.log("Page:", (0, _pageStore_1.pageStore)().get());
        }
        : noop,
    prod: {
        log: console.log.bind(console),
        warn: console.warn.bind(console),
        logCaller: (...args) => {
            const name = (0, _utils_1.callerName)(3); // called at log time (3 means level 3, it looks for the caller of the caller, otherwise would always log logger.logCaller)
            console.log(`${name}()`, ...args);
        },
        page: () => {
            console.log("Page:", (0, _pageStore_1.pageStore)().get());
        }
    }
};
