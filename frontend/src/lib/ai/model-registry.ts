// The AI model catalog now lives in @liatir/core (the single source of truth
// shared with the plugin API). This module re-exports it so existing frontend
// imports keep working unchanged.
export {
  MOCK_AI_MODEL_ID,
  CELLTYPIST_MODEL_ID,
  NUCLEOTIDE_TRANSFORMER_50M_ID,
  NUCLEOTIDE_TRANSFORMER_500M_ID,
  ENFORMER_REGULATORY_MODEL_ID,
  BASENJI2_REGULATORY_MODEL_ID,
  BORZOI_K562_RNA_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
  GENEFORMER_V1_10M_MODEL_ID,
  UCE_4LAYER_MODEL_ID,
  SCFOUNDATION_100M_MODEL_ID,
  ESM2_8M_ID,
  BOLTZ2_MODEL_ID,
  CHAI1_MODEL_ID,
  BUILT_IN_AI_MODEL_REGISTRY,
  LOCAL_AI_MODEL_REGISTRY,
  VISIBLE_LOCAL_AI_MODEL_REGISTRY,
  isAIModelCatalogVisible,
  getLocalAIModelMetadata,
} from "@liatir/core";
