import * as core from "@actions/core";

export const getInputs = () => {
  const githubToken: string = core.getInput("frontend_github_token");
  const openaiApiKey: string = core.getInput("openai_api_key", {
    required: true,
  });
  const exclude = core
    .getInput("exclude")
    .split(",")
    .map((s) => s.trim());

  return {
    githubToken,
    openaiApiKey,
    exclude,
  };
};
