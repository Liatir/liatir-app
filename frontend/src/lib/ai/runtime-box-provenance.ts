/** Pure helpers for carrying verified Runtime Box activation metadata into Jobs and Results. */
import type { LiatirAIProvenance, LiatirRuntimeBoxActivationMetadata } from '@liatir/core';

/** Reads validated Runtime Box provenance added by the Rust job launcher. */
export function runtimeBoxActivationFromMetadata(
	metadata: unknown
): LiatirRuntimeBoxActivationMetadata | undefined {
	if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
	const activation = (metadata as Record<string, unknown>).runtimeBoxActivation;
	if (!activation || typeof activation !== 'object' || Array.isArray(activation)) return undefined;
	const value = activation as Partial<LiatirRuntimeBoxActivationMetadata>;
	if (
		value.schemaVersion !== 2 ||
		!value.selectedTarget ||
		!value.release ||
		!value.signedRelease
	) return undefined;
	return value as LiatirRuntimeBoxActivationMetadata;
}

/** Adds Runtime Box activation provenance to a scientific Result when execution used one. */
export function runtimeBoxResultProvenance(result: {
	runtimeBoxActivation?: LiatirRuntimeBoxActivationMetadata;
}): Pick<LiatirAIProvenance, 'runtimeBoxActivation'> {
	return result.runtimeBoxActivation ? { runtimeBoxActivation: result.runtimeBoxActivation } : {};
}
