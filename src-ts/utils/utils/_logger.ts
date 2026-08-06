// _logger.ts

import { pageStore } from "./_pageStore";
import { callerName, isDev } from "./_utils";

type LogFn = (...args: any[]) => void;

const noop: LogFn = () => {};

const dev = () => {
  try {
    return isDev();
  } catch {
    return false;
  }
};

export const logger = {
    log: (dev()) ? console.log.bind(console) : noop,
    warn: (dev()) ? console.warn.bind(console) : noop,
    error: console.error.bind(console), // always logs
    devError: (dev()) ? console.error.bind(console) : noop,
    logCaller: (dev())
      ? (...args: any[]) => {
          const name = callerName(3); // called at log time (3 means level 3, it looks for the caller of the caller, otherwise would always log logger.logCaller)
          console.log(`${name}()`, ...args);
        }
      : noop,
    page: (dev()) 
      ? () => {
          console.log("Page:",pageStore().get());
        }
      : noop,
    prod: {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      logCaller: (...args: any[]) => {
            const name = callerName(3); // called at log time (3 means level 3, it looks for the caller of the caller, otherwise would always log logger.logCaller)
            console.log(`${name}()`, ...args);
          },
      page: () => {
            console.log("Page:",pageStore().get());
          }
    }
  };
