// backoff "pulito" (senza jitter): base * 2^(n-1), con cap
export const backoffNoJitter = (attempt: number, baseMin = 15, capMin = 240) =>
  Math.min(capMin, baseMin * Math.pow(2, Math.max(0, attempt - 1)));

// ±10% attorno al valore (equal jitter semplice)
export const addJitter = (minutes: number, ratio = 0.10) => {
  const min = minutes * (1 - ratio);
  const max = minutes * (1 + ratio);
  return Math.round(min + Math.random() * (max - min));
};

// Full jitter: scegli un valore casuale tra 0 e il backoff calcolato
export const fullJitter = (attempt: number, baseMin = 15, capMin = 240) => {
  const d = backoffNoJitter(attempt, baseMin, capMin);
  return Math.round(Math.random() * d);
};

// Decorrelated jitter (richiede il delay precedente)
export const decorrelatedJitter = (prevMin: number, baseMin = 15, capMin = 240) => {
  const next = Math.min(capMin, Math.max(baseMin, Math.random() * (prevMin * 3)));
  return Math.round(next);
};
