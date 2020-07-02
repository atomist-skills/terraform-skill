import {
  CommandHandler,
} from "@atomist/skill/lib/handler";
import {
  TerraformRegistration,
  SelectWorkspaceTerraform,
  InitTerraform,
  ValidateTerraform,
  RunTerraformApply,
  SetTerraformVersion,
} from "../terraform";
import { configureLogging } from "../utils";
import {LoadProjectStep, slackUpdate, SetParamsStep} from "../events/onPush";
import * as _ from "lodash";
import {runSteps} from "@atomist/skill/lib/steps";

export const handler: CommandHandler = async ctx => {
  // Configure Logging
  configureLogging((ctx.configuration[0].parameters as any).logLevel);

  // Load data from the command handler input
  const data = await ctx.parameters.prompt<{ data: string; }>({
    data: {},
  });
  const params = JSON.parse(data.data) as TerraformRegistration;

  // Set some non-standard data
  (ctx as any).parameters.project = params.project;
  (ctx as any).msgId = (params as any).msgId;
  (ctx as any).tfApply = true;

  // Define steps to run
  const steps = [
    SetParamsStep,
    LoadProjectStep,
    SetTerraformVersion,
    InitTerraform,
    ValidateTerraform,
    SelectWorkspaceTerraform,
    RunTerraformApply,
  ];

  const slackListener = await slackUpdate(
    ctx as any,
    steps,
    "Terraform Apply Execution",
    {
      name: _.get(params, "project.id.repo"),
      owner: _.get(params, "project.id.owner"),
      branch: undefined,
      sha: _.get(params, "project.id.sha"),
      commitUrl: _.get((params as any), "commitUrl"),
    },
   [_.get(ctx.trigger.source, "slack.channel.name")]);

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
