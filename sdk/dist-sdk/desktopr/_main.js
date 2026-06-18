"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.liaReadyEventListener = exports.liaInitiators = exports.DesktoprInstance = void 0;
// import { listenForEvent } from "../_helpers";
const constants_1 = require("../constants");
exports.DesktoprInstance = {
    ready: () => {
        if (!window?.Desktopr)
            return false;
        return true;
    },
    get: () => {
        if (!exports.DesktoprInstance.ready())
            throw ("'window.Desktopr' not found");
        return window?.Desktopr;
    }
};
const liaInitiators = async () => {
    try {
        if (!exports.DesktoprInstance.ready())
            throw ("Desktopr instance not found");
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
