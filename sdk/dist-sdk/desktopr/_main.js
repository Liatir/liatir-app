"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dtrReadyEventListener = exports.dtrInitiators = exports.DesktoprInstance = void 0;
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
const dtrInitiators = async () => {
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
exports.dtrInitiators = dtrInitiators;
const dtrReadyEventListener = (callback) => window.addEventListener(constants_1.READY_EVENT_NAME, () => callback());
exports.dtrReadyEventListener = dtrReadyEventListener;
