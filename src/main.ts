import { readFileSync } from "fs";
import minimatch from "minimatch";
import fetch from "node-fetch";
import { Configuration, OpenAIApi } from "openai";
import parseDiff, { Chunk, File } from "parse-diff";

import { Octokit } from "@octokit/rest";

import { getInputs } from "./inputs";

const inputs = getInputs();

const octokit = new Octokit({ auth: inputs.githubToken, request: { fetch } });

const configuration = new Configuration({
  basePath: "https://api.stage.cora.com.br/openai-proxy/v1",
});

console.log({ inputs });

const openai = new OpenAIApi(configuration);

interface PRDetails {
  owner: string;
  repo: string;
  pull_number: number;
  title: string;
  description: string;
}

async function getPRDetails(): Promise<PRDetails> {
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
}

async function getDiff(
  owner: string,
  repo: string,
  pull_number: number
): Promise<string | null> {
  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  // @ts-expect-error - response.data is a string
  return response.data;
}

async function analyzeCode(
  parsedDiff: File[],
  prDetails: PRDetails
): Promise<Array<{ body: string; path: string; line: number }>> {
  const comments: Array<{ body: string; path: string; line: number }> = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue;
    for (const chunk of file.chunks) {
      const prompt = createPrompt(file, chunk, prDetails);
      const aiResponse = await getAIResponse(prompt);

      if (aiResponse) {
        const newComments = createComment(file, chunk, aiResponse);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }
  return comments;
}

function createPrompt(file: File, chunk: Chunk, prDetails: PRDetails): string {
  return `Your task is to review pull requests. Instructions:
- Provide the response in following JSON format:  [{"lineNumber":  <line_number>, "reviewComment": "<review comment>"}]
- Do not give positive comments or compliments.
- Provide comments and suggestions ONLY if there is something to improve, otherwise return an empty array.
- Write the comment in GitHub Markdown format.
- Use the given description only for the overall context and only comment the code.
- Consider that will be used Typescript or Javascript code.
- Make clear performance improvements, better understanding and explain why.
- Always consider using es6+
- IMPORTANT: NEVER suggest adding comments or descriptions to the code.

Review the following code diff in the file "${
    file.to
  }" and take the pull request title and description into account when writing the response.

Pull request title: ${prDetails.title}
Pull request description:

---
${prDetails.description}
---

Git diff to review:

\`\`\`diff
${chunk.content}
${chunk.changes
  // @ts-expect-error - ln and ln2 exists where needed
  .map((c) => `${c.ln ? c.ln : c.ln2} ${c.content}`)
  .join("\n")}
\`\`\`
`;
}

async function getAIResponse(prompt: string): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> {
  const queryConfig = {
    model: "gpt-3.5-turbo",
    temperature: 0.2,
    max_tokens: 700,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    stream: false,
  };

  try {
    const response = await openai.createChatCompletion(
      {
        ...queryConfig,
        messages: [
          {
            role: "system",
            content: prompt,
          },
        ],
      },
      {
        headers: {
          apikey: inputs.openaiApiKey,
          Authorization: false,
          "x-email": "frontend@cora.com.br",
        },
      }
    );

    const res = response.data.choices[0].message?.content?.trim() || "[]";
    return JSON.parse(res);
  } catch (error) {
    console.error("Error openIA response:", error);
    return null;
  }
}

function createComment(
  file: File,
  chunk: Chunk,
  aiResponses: Array<{
    lineNumber: string;
    reviewComment: string;
  }>
): Array<{ body: string; path: string; line: number }> {
  return aiResponses.flatMap((aiResponse) => {
    if (!file.to) {
      return [];
    }
    return {
      body: aiResponse.reviewComment,
      path: file.to,
      line: Number(aiResponse.lineNumber),
    };
  });
}

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
  const prDetails = await getPRDetails();

  console.log({ prDetails });

  let diff: string | null;
  const eventData = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")
  );

  console.log({ eventData });

  if (eventData.action === "opened") {
    diff = await getDiff(
      prDetails.owner,
      prDetails.repo,
      prDetails.pull_number
    );
    console.log({ diff });
  } else if (eventData.action === "synchronize") {
    const newBaseSha = eventData.before;
    const newHeadSha = eventData.after;

    console.log({ newBaseSha, newHeadSha });

    const response = await octokit.rest.repos.compareCommits({
      owner: prDetails.owner,
      repo: prDetails.repo,
      base: newBaseSha,
      head: newHeadSha,
    });

    console.log({ response });

    diff = response.data.diff_url
      ? await octokit
          .request({
            url: response.data.diff_url,
          })
          .then((res) => res.data)
      : null;
    console.log({ diff2: diff });
  } else {
    console.log("Unsupported event:", process.env.GITHUB_EVENT_NAME);
    return;
  }

  if (!diff) {
    console.log("No diff found");
    return;
  }

  const parsedDiff = parseDiff(diff);

  console.log({ parsedDiff });

  const filteredDiff = parsedDiff.filter((file) => {
    return !inputs.exclude.some((pattern) => minimatch(file.to ?? "", pattern));
  });

  console.log({ filteredDiff });

  const comments = await analyzeCode(filteredDiff, prDetails);

  console.log({ comments });

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
