import { readFileSync } from "fs";

import type { GitHub } from "@actions/github/lib/utils";

import { IPRDetails, IPRGetDiffParams } from "./interface";

export const getDetails = async (
  octokit: InstanceType<typeof GitHub>
): Promise<IPRDetails> => {
  const { repository, number } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH || "", "utf8")
  );
  const prResponse = await octokit.rest.pulls.get({
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
  });

  return {
    owner: repository.owner.login,
    repo: repository.name,
    pull_number: number,
    title: prResponse.data.title ?? "",
    description: prResponse.data.body ?? "",
  };
};

export const getDiff = async ({
  octokit,
  owner,
  repo,
  pull_number,
}: IPRGetDiffParams): Promise<string | null> => {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
};
