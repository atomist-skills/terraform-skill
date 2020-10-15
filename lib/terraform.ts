/*
 * Copyright © 2020 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { createLogger, Logger, Severity } from "@atomist/skill-logging";
import { buttonForCommand } from "@atomist/skill/lib/slack/button";
import { EventContext, HandlerStatus } from "@atomist/skill/lib/handler";
import { Project } from "@atomist/skill/lib/project/project";
import { Microgrammar } from "@atomist/microgrammar";
import { Step } from "@atomist/skill/lib/steps";
import { codeBlock, SlackMessage, url } from "@atomist/slack-messages";
import * as _ from "lodash";
import * as fs from "fs-extra";
import {
  OnPushSubscription,
} from "./typings/types";
import { StringCapturingProgressLog, findCommitterScreenName } from "./utils";

export interface TerraformResult extends HandlerStatus {
  message?: string[] | string;
}

export interface TerraformRegistration {
  /**
   * Project
   */
  project: Project;

  /**
   * Set the base location for the terraform code in this project.  Relative to project root.
   * Defaults to root
   */
  baseLocation?: string;

  /**
   * Environment variables (key/value) you want to inject into the environment
   */
  envVars?: { [key: string]: string };

  /*
   * Command line arguments you want to pass to Terraform
   */
  args?: Array<{ arg: string; value?: string }>;

  /**
   * Command line vars you want to pass to Terraform, ie -var <thing>=<value>
   */
  vars?: Array<{ tfVar: string; value?: string }>;

  /**
   * A list of var files you want to pass to Terraform, ie -var-file=<file>
   * Defaults to not present
   */
  varsFiles?: string[];

  /**
   * Execute terraform init prior to goal execution?  If you are handling retrieving the .terraform contents via
   * another vehicle (like a GoalProjectListener), you may not want init to run
   * Defaults to true
   */
  init?: boolean;

  /**
   * Provide a workspace to use and the goal will switch to this workspace prior to executing
   * Note:  The workspace must already exist!
   */
  workspace?: string;

  /**
   * Auto-Approve.  If set, this will cause the skill to automatically run Terraform apply (with auto-aprove) set
   * -auto-approve
   */
  autoApprove?: boolean;

  /**
   * Supply Terraform Version to use.  Optional, if not supplied the latest installed will be used.
   */
  version?: string;
}

export async function shouldRunTfInit(context: unknown, reg: TerraformRegistration): Promise<boolean> {
  // Init will be false by default.  If it is false, the user did NOT disable init and we should run it.
  return !reg.init;
}
export async function shouldRunSelectTfWorkspace(context: unknown, reg: TerraformRegistration): Promise<boolean> {
  return !!reg.workspace;
}
export async function shouldRunTerraformApply(context: unknown, reg: TerraformRegistration): Promise<boolean> {
  return (!!reg.autoApprove || (context as any).tfApply === true);
}
export async function shouldRunTfVersion(context: unknown, reg: TerraformRegistration): Promise<boolean> {
  return !!reg.version;
}

export const terraformBackendGrammar = Microgrammar.fromString("terraform { backend ${name}", {
  terms: {
    name: String,
    $skipGaps: true,
  },
});

export const ValidateTerraform: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
    name: "Validate Terraform",
    run: async (ctx, params) => {
      const logger = createLogger(ctx);
      const tfValidateResult = await runTfValidate(params, logger);
      if (tfValidateResult.code !== 0) {
        return {
          code: 2,
          reason: tfValidateResult.reason,
        };
      }

      const base = `${params.project.path()}/${params.baseLocation}`;
      const results = fs
        .readdirSync(base)
        .filter((f: string) => f.match(/^.*\.tf$/));

      let found = false;

      for (const i of results) {
        const data = fs.readFileSync(`${base}/${i}`);
        const result = terraformBackendGrammar.findMatches(data.toString());
        if (result.length > 0) {
          found = true;
          break;
        }
      }

      if (!found) {
        return {
          code: 3,
          reason: "No backend configured! State will be lost!  Please configure a backend and try again!",
        };
      }

      return {
        code: 0,
      };
    },
};

export const SetTerraformVersion: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
  name: "Set Terraform Version",
  run: async (ctx, params) => {
    return setTfVersion(params);
  },
  runWhen: shouldRunTfVersion,
};

export const InitTerraform: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
    name: "Initialize Terraform",
    run: async (ctx, params) => {
        const logger = createLogger(ctx);
        return runTfInit(params, logger);
    },
    runWhen: shouldRunTfInit,
};

export const SelectWorkspaceTerraform: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
    name: "Select Terraform Workspace",
    run: async (ctx, params) => {
        const logger = createLogger(ctx);
        return selectTfWorkspace(params, logger);
    },
    runWhen: shouldRunSelectTfWorkspace,
};

export const RunTerraformPlan: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
  name: "Terraform Plan",
  run: async (ctx, params) => {

    // Extra Args
    const newArgs = _.cloneDeep(params);
    newArgs.args.push({arg: "detailed-exitcode"});

    // Execute Plan
    const result = await executeTfAction(
      "plan",
      newArgs,
    );

    if (result.code === 1) {
      return {
        code: result.code,
        reason: `Error while running Terraform!  Exit code: ${result.code}`,
      };
    }

    // Build Message
    const msgId = `apply-${ctx.correlationId}`;
    const actions = [];
    const changes = result.code === 2;
    const msgText =
      `*Plan Output* ${codeBlock(
        typeof result.message === "string"
          ? result.message
          : result.message.join("\n"))}`;

    if (changes) {
      actions.push(
        buttonForCommand(
          {
            text: "Run Apply",
            confirm: {
              title: "Run Terraform Apply",
              text:
                "You are about to perform a potentionally destructive action, are you sure?",
              ok_text: "Apply",
              dismiss_text: "Cancel",
            },
          },
          "runApply",
          {
            data: JSON.stringify({
              project: _.omit(params.project, [
                "spawn",
                "exec",
                "id.credential",
              ]),
              msgId,
              commitUrl: ctx.data.Push[0].after.url,
            }),
          },
        ),
      );
    }
    const msg: SlackMessage = {
      attachments: [
        {
          author_name: url(
            `https://go.atomist.com/log/${ctx.workspaceId}/${ctx.correlationId}`,
            "Terraform Plan Confirmation",
          ),
          author_icon:
            "https://www.terraform.io/assets/images/og-image-8b3e4f7d.png",
          fallback: "Terraform Plan Execution",
          text:
            `*${params.project.id.owner}/${params.project.id.repo}* at ${url(
              ctx.data.Push[0].after.url,
              `\`${params.project.id.sha.slice(0, 7)}\``,
            )}\n\n` + msgText,
          color: "#5f43e9",
          actions,
        },
      ],
    };

    if (!changes) {
      msg.attachments.push({
        fallback: `No infrastructure changes found.`,
        text: `*No infrastructure changes found.  No action required.*`,
        color: "#4040b2",
      });
    }

    // Apply footer
    msg.attachments[msg.attachments.length - 1].footer = url(
      `https://go.atomist.com/manage/${ctx.workspaceId}/skills/configure/${ctx.skill.id}/${ctx.configuration[0].name}`,
      `${ctx.skill.namespace}/${ctx.skill.name}@${ctx.skill.version}`,
    );
    msg.attachments[msg.attachments.length - 1].footer_icon = `https://images.atomist.com/rug/atomist.png`;
    msg.attachments[msg.attachments.length - 1].ts = Math.floor(Date.now() / 1000);

    // Lookup who to notify
    let notify: { type: "channel" | "person"; value: any };
    if (ctx.data.Push[0].repo.channels.length > 0) {
      notify = {
        type: "channel",
        value: ctx.data.Push[0].repo.channels.map(c => c.name),
      };
    } else {
      notify = {
        type: "person",
        value: await findCommitterScreenName(ctx, ctx.data.Push[0].after.sha),
      };
    }

    // Send message only if autoApprove is not true
    if (!params.autoApprove) {
      await ctx.message.send(
        msg,
        notify.type === "person"
          ? { users: [notify.value], channels: [] }
          : { users: [], channels: notify.value },
        {id: msgId},
      );
    }

    // Return status
    return {
      code: 0,
      reason: msgText,
    };
  },
};

export const RunTerraformApply: Step<EventContext<OnPushSubscription>, TerraformRegistration> = {
    name: "Terraform Apply",
    run: async (ctx, params) => {
        const result = await executeTfAction("apply", params);

        return {
          code: result.code,
          reason:
            `*Apply Output:*\n\n` +
            codeBlock(
              typeof result.message === "string"
                ? result.message
                : result.message.join("\n"),
            ),
        };
    },
    runWhen: shouldRunTerraformApply,
};

export async function selectTfWorkspace(registration: TerraformRegistration, logger: Logger): Promise<HandlerStatus> {
    const result = await registration.project.spawn(
        "terraform",
        ["workspace", "select", registration.workspace],
        {
            cwd: registration.baseLocation ? `${registration.project.path()}/${registration.baseLocation}` :
              registration.project.path(),
            env: {...process.env, ...registration.envVars},
        },
    );
    if (result.status === 0) {
        return {
            code: 0,
        };
    } else {
        await logger.log(`Terraform workspace select failed => ${result.stderr}`, Severity.ERROR);
        return {
            code: 1,
            reason: `Failed to run terraform workspace select!`,
        };
    }
}

export async function runTfValidate(registration: TerraformRegistration, logger: Logger): Promise<HandlerStatus> {
    const result = await registration.project.spawn(
        "terraform",
        ["validate"],
        {
            cwd: registration.baseLocation ? `${registration.project.path()}/${registration.baseLocation}` :
              registration.project.path(),
            env: {...process.env, ...registration.envVars},
        },
    );
    if (result.status === 0) {
        return {
            code: 0,
        };
    } else {
        await logger.log(`Terraform Validate failed => ${result.stderr}`, Severity.ERROR);
        return {
            code: 1,
            reason: `Failed to run terraform validate!`,
        };
    }
}

export async function runTfInit(registration: TerraformRegistration, logger: Logger): Promise<HandlerStatus> {
    const vars = await buildTfVars(registration);
    const result = await registration.project.spawn(
        "terraform",
        ["init", ...vars],
        {
            cwd: registration.baseLocation ? `${registration.project.path()}/${registration.baseLocation}` :
              registration.project.path(),
            env: {...process.env, ...registration.envVars},
        },
    );
    if (result.status === 0) {
        return {
            code: 0,
        };
    } else {
        await logger.log(`Terraform initialize failed => ${result.stderr}`, Severity.ERROR);
        return {
            code: 1,
            reason: `Failed to run terraform init!`,
        };
    }
}

export async function executeTfAction(
  action: "apply" | "destroy" | "plan",
  registration: TerraformRegistration,
): Promise<TerraformResult> {
    const args = await buildTfArgs(action, registration);
    const vars = await buildTfVars(registration);
    const log = new StringCapturingProgressLog();
    const result = await registration.project.spawn(
        "terraform",
        [action, ...args, ...vars],
        {
            cwd: registration.baseLocation ? `${registration.project.path()}/${registration.baseLocation}` :
              registration.project.path(),
            env: {...process.env, ...registration.envVars},
            logCommand: false,
            log,
        },
    );

    return {
      code: result.status,
      message: log.log,
    };
}

export async function buildTfVars(registration: TerraformRegistration): Promise<string[]> {
    const args: string[] = [];
    if (registration.vars) {
        args.push(..._.flatten(registration.vars.map(a => [`-var`, `${a.tfVar}=${a.value}`])));
    }
    if (registration.varsFiles) {
        args.push(...(registration.varsFiles.map(f => `-var-file=${f}`)));
    }
    return args;
}

export async function buildTfArgs(
    action: "apply" | "plan" | "destroy",
    registration: TerraformRegistration,
): Promise<string[]> {
    const args: string[] = [];
    switch (action) {
        case "apply": {
            args.push("-auto-approve");
            break;
        }
        case "destroy": {
            args.push("-force");
        }
    }
    // Disable interactive prompts
    args.push("-input=false");

    // Add args from registration
    if (registration.args) {
        args.push(
            ...registration.args.map(
                a => `-${a.arg}${a.value ? `=${a.value}` : ""}`,
            ),
        );
    }
    return args;
}

export async function setTfVersion(registration: TerraformRegistration): Promise<HandlerStatus> {
  let response: HandlerStatus;
  const result = await registration.project.spawn("tfenv", ["use", registration.version]);
  if (result.status !== 0) {
    const install = await registration.project.spawn("tfenv", ["install", registration.version]);
    if (install.status !== 0) {
      response = {
        code: 1,
        reason: install.stderr,
      };
    } else {
      response = {
        code: 0,
        reason: install.stdout,
      };
    }
  }

  return response;
}
