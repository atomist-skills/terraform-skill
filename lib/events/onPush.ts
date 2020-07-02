import { EventContext, EventHandler, HandlerStatus } from "@atomist/skill/lib/handler";
import { gitHubComRepository, RepositoryId } from "@atomist/skill/lib/project";
import { gitHubAppToken } from "@atomist/skill/lib/secrets";
import { runSteps, Step, StepListener } from "@atomist/skill/lib/steps";
import { codeBlock } from "@atomist/slack-messages";
import {
  InitTerraform,
  RunTerraformPlan,
  SelectWorkspaceTerraform,
  TerraformRegistration,
  RunTerraformApply,
  ValidateTerraform,
  SetTerraformVersion,
} from "../terraform";
import {
  OnPushSubscription,
} from "../typings/types";
import {
  buildMessage,
  setParams,
  findCommitterScreenName,
  hclCodePresent,
  configureLogging,
  SkillStepState,
} from "../utils";
import * as _ from "lodash";

export async function updateSlackState(
  title: string,
  text: string,
  ctx: EventContext<OnPushSubscription>,
  sha: string,
  stepCount: number,
  currentStep: number,
  state: SkillStepState,
  channels: string[],
  params: TerraformRegistration,
  fullRender: string,
): Promise<void> {

  let notify: { type: "channel" | "person"; value: any };
  if (channels.length > 0) {
    notify = {
      type: "channel",
      value: channels,
    };
  } else {
    notify = {
      type: "person",
      value: await findCommitterScreenName(ctx, sha),
    };
  }

  // TODO: Gotta be a better way here.   Need to test if this context is from a push or from a command handler
  const msgId = Object.keys(ctx).includes("data") ? ctx.correlationId : (ctx as any).msgId;
  await ctx.message.send(
    buildMessage(
      title,
      ctx as any,
      params,
      codeBlock(text) + fullRender,
      currentStep,
      stepCount,
      state,
    ),
    notify.type === "person"
      ? { users: [notify.value], channels: [] }
      : { users: [], channels: notify.value },
    {id: msgId},
  );
}

async function updateRepo(
  repo: { owner: string; name: string; branch: string; sha: string; commitUrl: string; },
  params: TerraformRegistration): Promise<void> {
    if (_.isEmpty(params) || !Object.keys(params).includes("project")) {
      return;
    }
    params.project.id.repo = repo.name;
    params.project.id.owner = repo.owner;
    params.project.id.sha = repo.sha;
    params.project.id.branch = repo.branch;
    (params as any).commitUrl = repo.commitUrl;
}

export async function slackUpdate<
  C extends EventContext<OnPushSubscription, TerraformRegistration>,
  G extends TerraformRegistration = any,
>(
  ctx: C,
  steps: Array<Step<any>>,
  title: string,
  repo: { owner: string; name: string; branch: string; sha: string; commitUrl: string },
  // TODO: Handle user
  channels?: string[],
): Promise<StepListener<any>> {

  let text = "";
  let fullRender = "";
  const stepCount = steps.length;
  let finishedCount = 0;

  return {
    starting: async (step: Step<any>, params: G): Promise<void> => {
      await updateRepo(repo, params);
      text += `Running: ${step.name}.\n`;
      await updateSlackState(
        title,
        text,
        ctx,
        repo.sha,
        stepCount,
        finishedCount,
        SkillStepState.InProcess,
        channels,
        params,
        fullRender,
      );
    },
    skipped: async (step: Step<any>, params: G): Promise<void> => {
      await updateRepo(repo, params);
      text += `Skipped: ${step.name}.\n`;
      finishedCount++;
      await updateSlackState(
        title,
        text,
        ctx,
        repo.sha,
        stepCount,
        finishedCount,
        SkillStepState.Skipped,
        channels,
        params,
        fullRender,
      );
    },
    failed: async (step: Step<any>, params: G, error: Error): Promise<void> => {
      await updateRepo(repo, params);
      finishedCount++;
      text += `Failed: ${step.name}.\n${error.message}\n`;
      await updateSlackState(
        title,
        text,
        ctx,
        repo.sha,
        stepCount,
        finishedCount,
        SkillStepState.Failure,
        channels,
        params,
        fullRender,
      );
    },
    completed: async (step: Step<any>, params: G, result: undefined | HandlerStatus): Promise<void> => {
      await updateRepo(repo, params);
      finishedCount++;
      if (result.visibility !== "hidden") {
        if (!!result && result.code !== 0) {
          text += `Failed: ${step.name}.\n\n${result.reason}\n`;
          await updateSlackState(
            title,
            text,
            ctx,
            repo.sha,
            stepCount,
            finishedCount,
            SkillStepState.Failure,
            channels,
            params,
            fullRender,
          );
        } else if (!!result && result.reason) {
          text += `Completed: ${step.name}.\n`;
          fullRender += `\n\n${result.reason}`;
          await updateSlackState(
            title,
            text,
            ctx,
            repo.sha,
            stepCount,
            finishedCount,
            SkillStepState.Success,
            channels,
            params,
            fullRender,
          );
        } else {
          text += `Completed: ${step.name}.\n`;
          await updateSlackState(
            title,
            text,
            ctx,
            repo.sha,
            stepCount,
            finishedCount,
            SkillStepState.Success,
            channels,
            params,
            fullRender,
          );
        }
      }
    },
  };
}

export const handler: EventHandler<OnPushSubscription, TerraformRegistration> = async ctx => {

  // Explicitly set home
  process.env.HOME = "/tmp";

  // Test branch
  const branch = (ctx.configuration[0].parameters as any).branch;
  if (branch && !(branch === ctx.data.Push[0].branch)) {
    return {
      code: 0,
      reason: `Incoming branch [${ctx.data.Push[0].branch}] does not match configured branch [${branch}], skipping.`,
    };
  }

  // Configure Logging
  configureLogging((ctx.configuration[0].parameters as any).logLevel);

  // Define steps to run
  const steps = [
    SetParamsStep,
    LoadProjectStep,
    SetTerraformVersion,
    InitTerraform,
    ValidateTerraform,
    SelectWorkspaceTerraform,
    RunTerraformPlan,
    RunTerraformApply,
  ];

  const slackListener = await slackUpdate(
    ctx,
    steps,
    ctx.configuration[0].parameters.autoApprove ?
      "Terraform Execution" :
      "Terraform Plan Execution",
    {
      name: ctx.data.Push[0].repo.name,
      owner: ctx.data.Push[0].repo.owner,
      branch: ctx.data.Push[0].branch,
      sha: ctx.data.Push[0].after.sha,
      commitUrl: ctx.data.Push[0].after.url,
    },
    ctx.data.Push[0].repo.channels.map(c => c.name));

  const result = await runSteps({
    context: ctx,
    steps,
    listeners: [slackListener],
  });

  return {
    code: result.code,
    reason: result.code === 0 ? "Success" : result.reason,
  };
};

export const SetParamsStep: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
    name: "Set Parameters",
    run: async (ctx, params) => {
      await setParams(ctx, params);
      return {
        code: 0,
      };
    },
};

function determineProjectDetails(
  data: OnPushSubscription["Push"],
  params: TerraformRegistration,
): Omit<RepositoryId, "type"> {
  return data && data.length > 0
    ? {
        repo: data[0].repo.name,
        owner: data[0].repo.owner,
        sha: data[0].after.sha,
        apiUrl: data[0].repo.org.provider.apiUrl,
      }
    : params.project.id;
}

export const LoadProjectStep: Step<EventContext<OnPushSubscription>> = {
    name: "Load Project",
    run: async (ctx, params) => {
        const repo = determineProjectDetails(_.get(ctx, "data.Push"), (ctx as any).parameters);
        const credential = await ctx.credential.resolve(
            gitHubAppToken({ owner: repo.owner, repo: repo.repo, apiUrl: repo.apiUrl }));

        // Load project
        params.project = await ctx.project.clone(gitHubComRepository({
            owner: repo.owner,
            repo: repo.repo,
            sha: repo.sha,
            credential,
        }));

        // Validate Path exists and contains HCL code
        const present = await hclCodePresent(params);
        if (present.code !== 0) {
          return {
            code: 1,
            reason: present.reason,
          };
        }

        return {
            code: 0,
        };
    },
};
