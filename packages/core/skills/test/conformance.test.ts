import { managedSkillRegistryConformance } from "../src/conformance.ts";

import { makeFilesystemHarness } from "./harness.ts";

managedSkillRegistryConformance(makeFilesystemHarness);
