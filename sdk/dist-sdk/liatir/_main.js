"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liaReadyEventListener = exports.liaInitiators = exports.LiatirInstance = void 0;
const constants_1 = require("../constants");
exports.LiatirInstance = {
    ready: () => {
        if (!window?.Liatir)
            return false;
        return true;
    },
    get: () => {
        if (!exports.LiatirInstance.ready())
            throw ("'window.Liatir' not found");
        return window?.Liatir;
    }
};
const liaInitiators = async () => {
    try {
        if (!exports.LiatirInstance.ready())
            throw ("Liatir instance not found");
        console.log("## READY ##");
        const eventReady = new CustomEvent(constants_1.READY_EVENT_NAME);
        window?.dispatchEvent(eventReady);
    }
    catch (error) {
        console.error(error);
    }
};
exports.liaInitiators = liaInitiators;
const liaReadyEventListener = (callback) => window.addEventListener(constants_1.READY_EVENT_NAME, () => callback());
exports.liaReadyEventListener = liaReadyEventListener;
