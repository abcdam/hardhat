import { Journal } from "../internal/types/journal";

import { Artifact, BuildInfo } from "./artifact";

/**
 * Read and write to the deployment storage.
 *
 * @beta
 */
export interface DeploymentLoader {
  journal: Journal;
  loadArtifact(artifactFutureId: string): Promise<Artifact>;
  storeUserProvidedArtifact(
    futureId: string,
    artifact: Artifact
  ): Promise<void>;
  storeNamedArtifact(
    futureId: string,
    contractName: string,
    artifact: Artifact
  ): Promise<void>;
  storeBuildInfo(buildInfo: BuildInfo): Promise<void>;
  recordDeployedAddress(
    futureId: string,
    contractAddress: string
  ): Promise<void>;
}
