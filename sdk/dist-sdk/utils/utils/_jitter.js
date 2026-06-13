"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decorrelatedJitter = exports.fullJitter = exports.addJitter = exports.backoffNoJitter = void 0;
// backoff "pulito" (senza jitter): base * 2^(n-1), con cap
const backoffNoJitter = (attempt, baseMin = 15, capMin = 240) => Math.min(capMin, baseMin * Math.pow(2, Math.max(0, attempt - 1)));
exports.backoffNoJitter = backoffNoJitter;
// ±10% attorno al valore (equal jitter semplice)
const addJitter = (minutes, ratio = 0.10) => {
    const min = minutes * (1 - ratio);
    const max = minutes * (1 + ratio);
    return Math.round(min + Math.random() * (max - min));
};
exports.addJitter = addJitter;
// Full jitter: scegli un valore casuale tra 0 e il backoff calcolato
const fullJitter = (attempt, baseMin = 15, capMin = 240) => {
    const d = (0, exports.backoffNoJitter)(attempt, baseMin, capMin);
    return Math.round(Math.random() * d);
};
exports.fullJitter = fullJitter;
// Decorrelated jitter (richiede il delay precedente)
const decorrelatedJitter = (prevMin, baseMin = 15, capMin = 240) => {
    const next = Math.min(capMin, Math.max(baseMin, Math.random() * (prevMin * 3)));
    return Math.round(next);
};
exports.decorrelatedJitter = decorrelatedJitter;
