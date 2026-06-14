// Main SDK entry: typed proxy over window.Offlab
export { Offlab, isOfflabAvailable } from "./_proxy";

// Re-export the API type so app devs can type their code against it
export { type OfflabAPI } from "../types";
