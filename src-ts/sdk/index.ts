// Main SDK entry: typed proxy over window.Liatir
export { Liatir, isLiatirAvailable } from "./_proxy";

// Re-export the API type so app devs can type their code against it
export { type LiatirAPI } from "../types";
