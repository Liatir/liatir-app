/**
 * What "the right Java is installed" means, pinned against real `java` output.
 *
 * Java is the only dependency Liatir still asks the user to install themselves, and it is unusually
 * easy to get wrong: several JDKs can sit on one machine, and on macOS the system ships a launcher
 * stub at `/usr/bin/java` that exists whether or not any JVM does. Detection reports the stub as
 * "available", so presence alone proves nothing — which is why the requirement declares
 * `versionMustBeDetectable` and the wrong-tool resolver treats silence as the failure.
 *
 * The banners below are verbatim output from two real JDKs (Temurin 21 and Oracle 8), not invented
 * strings: the parsing they exercise is fragile enough that a plausible-looking fake would prove
 * nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  DEP_REQUIREMENTS,
  depVersionSatisfied,
  type DepRequirement,
} from '$lib/data/dep-requirements';
import { wrongToolMessage } from '$lib/dependencies/resolvers';

const java = DEP_REQUIREMENTS.java;

/** `java --version`, Temurin 21 — stdout, exit 0. */
const TEMURIN_21 = 'openjdk 21.0.11 2026-04-21 LTS';
/** `java -version`, Oracle 8 — stderr, exit 0. `--version` is not a flag it understands. */
const ORACLE_8 = 'java version "1.8.0_501"';

describe('java requirement', () => {
  it('declares that finding the binary is not enough', () => {
    expect(java.versionMustBeDetectable).toBe(true);
    expect(java.wrongToolMessage).toBeTruthy();
  });

  it('accepts a JDK that meets the minimum', () => {
    expect(depVersionSatisfied(TEMURIN_21, java)).toBe(true);
  });

  it('rejects Java 8, whose banner buries the version in quotes', () => {
    expect(depVersionSatisfied(ORACLE_8, java)).toBe(false);
  });

  it('rejects a java that reports no version at all', () => {
    expect(depVersionSatisfied(null, java)).toBe(false);
  });

  it('explains the silent case rather than only reporting it', () => {
    expect(wrongToolMessage(null, java)).toBe(java.wrongToolMessage);
    // A JDK that answered is a version problem, not an impostor: it must not borrow this message.
    expect(wrongToolMessage(ORACLE_8, java)).toBeNull();
    expect(wrongToolMessage(TEMURIN_21, java)).toBeNull();
  });
});

describe('every other dependency', () => {
  const others = Object.values(DEP_REQUIREMENTS).filter(
    (req: DepRequirement) => req.binary !== 'java',
  );

  it('still passes when it declines to identify itself', () => {
    // The default has to stay permissive: plenty of tools work without naming a version, and
    // flipping them all to "not installed" would be a far worse failure than the one being fixed.
    for (const req of others) {
      expect(depVersionSatisfied(null, req)).toBe(true);
    }
  });
});
