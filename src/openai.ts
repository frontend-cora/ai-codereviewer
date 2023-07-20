import { Configuration, OpenAIApi } from "openai";
import { Chunk, File } from "parse-diff";

import { IPRDetails, IAnalyzeCodeParams } from "./interface";

export const getOpenai = () => {
  const configuration = new Configuration({
    basePath: "https://api.stage.cora.com.br/openai-proxy/v1",
  });
  const openai = new OpenAIApi(configuration);

  return openai;
};

export const analyzeCode = async ({
  openaikit,
  openaiApiKey,
  parsedDiff,
  prDetails,
}: IAnalyzeCodeParams): Promise<
  Array<{ body: string; path: string; line: number }>
> => {
  const comments: Array<{ body: string; path: string; line: number }> = [];

  for (const file of parsedDiff) {
    if (file.to === "/dev/null") continue;
    for (const chunk of file.chunks) {
      const prompt = createPrompt(file, chunk, prDetails);
      const aiResponse = await getAIResponse(openaikit, openaiApiKey, prompt);

      if (aiResponse) {
        const newComments = createComment(file, chunk, aiResponse);
        if (newComments) {
          comments.push(...newComments);
        }
      }
    }
  }

  return comments;
};

const createPrompt = (
  file: File,
  chunk: Chunk,
  prDetails: IPRDetails
): string => {
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
};

const getAIResponse = async (
  openaikit: OpenAIApi,
  openaiApiKey: string,
  prompt: string
): Promise<Array<{
  lineNumber: string;
  reviewComment: string;
}> | null> => {
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
    const response = await openaikit.createChatCompletion(
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
          apikey: openaiApiKey,
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
};

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
