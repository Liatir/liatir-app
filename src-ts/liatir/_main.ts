import { READY_EVENT_NAME } from "../constants";
import { LiatirAPI, LiatirInstanceInterface } from "../types";
import { Liatir } from "../sdk";

export const LiatirInstance: LiatirInstanceInterface = {
    ready: (): boolean => {
        if(!window?.Liatir) return false;
        return true;
    },
    get: (): LiatirAPI => {
        if(!LiatirInstance.ready()) throw("'window.Liatir' not found");
        return window?.Liatir as LiatirAPI;
    }
}

export const liaInitiators = async () => {
    try {
        if(!LiatirInstance.ready()) throw("Liatir instance not found");

        console.log("## READY ##");

        const eventReady = new CustomEvent(READY_EVENT_NAME);

        window?.dispatchEvent(eventReady);
    } catch (error) {
        console.error(error);
    }
}

export const liaReadyEventListener = (callback: Function) => window.addEventListener(READY_EVENT_NAME, () => callback());
