import {
  fixtureUrl,
  schemaUrl,
} from "scrollcase/contract";
import {
  BOX_SCHEMA_VERSION,
  boxTargetId,
  isSignedBoxDocument,
} from "scrollcase/contract/browser";
import type {
  BoxChannelManifest,
  BoxReleaseManifest,
  BoxTarget,
  SignedBoxDocument,
} from "scrollcase/contract/types";
import {
  boxReleaseStem,
  collectFiles,
  createDeterministicZip,
} from "scrollcase/build";
import {
  signDocument,
  verifySignedDocument,
} from "scrollcase/sign";

const target: BoxTarget = {
  platform: "linux",
  arch: "x86_64",
  accelerator: "cpu",
};

const release = {} as BoxReleaseManifest;
const channel = {} as BoxChannelManifest;
const signed = {} as SignedBoxDocument;

void BOX_SCHEMA_VERSION;
void boxTargetId(target);
void fixtureUrl("target-id-contract");
void schemaUrl("release-manifest");
void isSignedBoxDocument(signed);
void boxReleaseStem(release);
void collectFiles;
void createDeterministicZip;
void signDocument;
void verifySignedDocument;
void channel;
