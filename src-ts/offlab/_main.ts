import { READY_EVENT_NAME } from "../constants";
import { OfflabAPI, OfflabInstanceInterface } from "../types";
import { Offlab } from "../sdk";

export const OfflabInstance: OfflabInstanceInterface = {
    ready: (): boolean => {
        if(!window?.Offlab) return false;
        return true;
    },
    get: (): OfflabAPI => {
        if(!OfflabInstance.ready()) throw("'window.Offlab' not found");
        return window?.Offlab as OfflabAPI;
    }
}

export const dtrInitiators = async () => {
    try {
        if(!OfflabInstance.ready()) throw("Offlab instance not found");

        console.log("## READY ##");

        const eventReady = new CustomEvent(READY_EVENT_NAME);

        window?.dispatchEvent(eventReady);
    } catch (error) {
        console.error(error);
    }
}

export const dtrReadyEventListener = (callback: Function) => window.addEventListener(READY_EVENT_NAME, () => callback());
