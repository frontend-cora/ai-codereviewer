import { readFileSync } from "fs";
import minimatch from "minimatch";
import parseDiff from "parse-diff";

import * as github from "@actions/github";

import { getInputs } from "./inputs";
import * as openai from "./openai";
import * as pr from "./pull_request";

const inputs = getInputs();

console.log({ inputs });

const octokit = github.getOctokit(inputs.githubToken);
const openaikit = openai.getOpenai();

// eslint-disable-next-line max-params
async function createReviewComment(
  owner: string,
  repo: string,
  pull_number: number,
  comments: Array<{ body: string; path: string; line: number }>
): Promise<void> {
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number,
    comments,
    event: "COMMENT",
  });
}

async function main() {
  const prDetails = await pr.getDetails(octokit);

  let diff: string | null;
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  if (eventData.action === "opened") {
    diff = await pr.getDiff({
      octokit,
      owner: prDetails.owner,
      repo: prDetails.repo,
      pull_number: prDetails.pull_number,
    });
  } else if (eventData.action === "synchronize") {
    const newBaseSha = eventData.before;
    const newHeadSha = eventData.after;

    const response = await octokit.rest.repos.compareCommits({
      owner: prDetails.owner,
      repo: prDetails.repo,
      base: newBaseSha,
      head: newHeadSha,
    });

    diff = response.data.diff_url
      ? await octokit
          .request({
            url: response.data.diff_url,
          })
          .then((res) => res.data)
      : null;
  } else {
    console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
    return;
  }

  if (!diff) {
    console.log("No diff found");
    return;
  }

  const parsedDiff = parseDiff(diff);

  const filteredDiff = parsedDiff.filter((file) => {
    return !inputs.exclude.some((pattern) => minimatch(file.to ?? "", pattern));
  });

  const comments = await openai.analyzeCode({
    openaikit,
    openaiApiKey: inputs.openaiApiKey,
    parsedDiff: filteredDiff,
    prDetails,
  });

  console.log({ comments, filteredDiff, prDetails });

  if (comments.length > 0) {
    await createReviewComment(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number,
      [
        {
          body: "Consider using a more descriptive name for the GitHub token, such as 'FRONTEND_GITHUB_TOKEN'.",
          path: ".github/workflows/code_review.yml",
          line: 19,
        },
        {
          body: "The function `funcaoDeConsole` is being called with the argument 'string aqui 1'. Is there a reason for this change? If not, please revert it back to 'string aqui'.",
          path: "index2.js",
          line: 19,
        },
      ]
    );
  }
}

main().catch((error) => {
  console.error("main Error:", error);
  process.exit(1);
});
