import type { LiatirAIModelMetadata, LiatirAIModelRuntimePackage, LiatirAIModelRuntimeSource } from './index';
export declare const MOCK_AI_MODEL_ID = "liatir-mock-local";
export declare const CELLTYPIST_MODEL_ID = "celltypist-local-annotation";
export declare const NUCLEOTIDE_TRANSFORMER_50M_ID = "instadeep-nt-v2-50m-multi-species";
export declare const NUCLEOTIDE_TRANSFORMER_500M_ID = "instadeep-nt-v2-500m-multi-species";
export declare const ENFORMER_REGULATORY_MODEL_ID = "deepmind-enformer-regulatory";
export declare const BASENJI2_REGULATORY_MODEL_ID = "calico-basenji2-human-regulatory";
export declare const BORZOI_K562_RNA_MODEL_ID = "calico-borzoi-mini-k562-rna";
export declare const SCGPT_WHOLE_HUMAN_MODEL_ID = "bowang-scgpt-whole-human";
export declare const GENEFORMER_V1_10M_MODEL_ID = "ctheodoris-geneformer-v1-10m";
export declare const UCE_4LAYER_MODEL_ID = "snap-stanford-uce-4layer";
export declare const SCFOUNDATION_100M_MODEL_ID = "biomap-scfoundation-100m";
export declare const ESM2_8M_ID = "facebook-esm2-8m-protein";
export declare const BOLTZ2_MODEL_ID = "boltz2-local-structure-binding";
export declare const CHAI1_MODEL_ID = "chai1-local-structure";
export declare const BUILT_IN_AI_MODEL_REGISTRY: LiatirAIModelMetadata[];
export declare const LOCAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[];
export declare function isAIModelCatalogVisible(model: LiatirAIModelMetadata): boolean;
export declare const VISIBLE_LOCAL_AI_MODEL_REGISTRY: LiatirAIModelMetadata[];
export declare function getLocalAIModelMetadata(id: string): LiatirAIModelMetadata | undefined;
/** A package presence check (name + optional import name / specifier). */
export interface AiRuntimePackageCheck {
    package: string;
    importName?: string;
    specifier?: string;
}
/** Managed runtime id for a model, or null when the model has no runtime. */
export declare function runtimeIdForModel(model: LiatirAIModelMetadata): string | null;
/** pip requirement strings derived from the model's runtime packages. */
export declare function requirementsForModel(model: LiatirAIModelMetadata): string[];
export declare function runtimePackagesForModel(model: LiatirAIModelMetadata): LiatirAIModelRuntimePackage[];
export declare function runtimeSourcesForModel(model: LiatirAIModelMetadata): LiatirAIModelRuntimeSource[];
export declare function packageChecksForModel(model: LiatirAIModelMetadata): AiRuntimePackageCheck[];
//# sourceMappingURL=ai-catalog.d.ts.map