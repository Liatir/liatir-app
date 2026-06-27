// Clean backoff without jitter: base * 2^(n-1), with a cap.
export const backoffNoJitter = (attempt: number, baseMin = 15, capMin = 240) =>
  Math.min(capMin, baseMin * Math.pow(2, Math.max(0, attempt - 1)));

// Simple equal jitter around the value, defaulting to +/-10%.
export const addJitter = (minutes: number, ratio = 0.10) => {
  const min = minutes * (1 - ratio);
  const max = minutes * (1 + ratio);
  return Math.round(min + Math.random() * (max - min));
};

// Full jitter: choose a random value between 0 and the computed backoff.
export const fullJitter = (attempt: number, baseMin = 15, capMin = 240) => {
  const d = backoffNoJitter(attempt, baseMin, capMin);
  return Math.round(Math.random() * d);
};

// Decorrelated jitter, using the previous delay.
export const decorrelatedJitter = (prevMin: number, baseMin = 15, capMin = 240) => {
  const next = Math.min(capMin, Math.max(baseMin, Math.random() * (prevMin * 3)));
  return Math.round(next);
};
