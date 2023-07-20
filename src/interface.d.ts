import type { OpenAIApi } from "openai";
import type { File } from "parse-diff";

import type { GitHub } from "@actions/github/lib/utils";

export interface IPRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

export interface IPRGetDiffParams {
  octokit: InstanceType<typeof GitHub>;
  owner: string;
  repo: string;
  pull_number: number;
}

export interface IAnalyzeCodeParams {
  openaikit: OpenAIApi;
  openaiApiKey: string;
  parsedDiff: File[];
  prDetails: IPRDetails;
}
