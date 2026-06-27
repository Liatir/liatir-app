"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decorrelatedJitter = exports.fullJitter = exports.addJitter = exports.backoffNoJitter = void 0;
// Clean backoff without jitter: base * 2^(n-1), with a cap.
const backoffNoJitter = (attempt, baseMin = 15, capMin = 240) => Math.min(capMin, baseMin * Math.pow(2, Math.max(0, attempt - 1)));
exports.backoffNoJitter = backoffNoJitter;
// Simple equal jitter around the value, defaulting to +/-10%.
const addJitter = (minutes, ratio = 0.10) => {
    const min = minutes * (1 - ratio);
    const max = minutes * (1 + ratio);
    return Math.round(min + Math.random() * (max - min));
};
exports.addJitter = addJitter;
// Full jitter: choose a random value between 0 and the computed backoff.
const fullJitter = (attempt, baseMin = 15, capMin = 240) => {
    const d = (0, exports.backoffNoJitter)(attempt, baseMin, capMin);
    return Math.round(Math.random() * d);
};
exports.fullJitter = fullJitter;
// Decorrelated jitter, using the previous delay.
const decorrelatedJitter = (prevMin, baseMin = 15, capMin = 240) => {
    const next = Math.min(capMin, Math.max(baseMin, Math.random() * (prevMin * 3)));
    return Math.round(next);
};
exports.decorrelatedJitter = decorrelatedJitter;
