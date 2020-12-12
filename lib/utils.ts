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

import {
	CommandContext,
	EventContext,
	HandlerStatus,
	slack,
} from "@atomist/skill";
import { WritableLog } from "@atomist/skill/lib/child_process";
import * as fs from "fs-extra";
import { sprintf } from "sprintf-js";

import { TerraformRegistration } from "./terraform";
import {
	OnPushSubscription,
	TfSkill_ChatIdByCommitQuery,
	TfSkill_ChatIdByCommitQueryVariables,
} from "./typings/types";
import stripAnsi = require("strip-ansi");

/**
 * Returns a formatted string replacing any placeholders in msg with
 * provided args
 *
 * See npm springf-js for more details on what args and placeholder
 * patterns are supported.
 */
export function format(msg: string, ...args: any[]): string {
	if (!args || args.length === 0) {
		return msg;
	} else {
		try {
			return sprintf(msg, ...args);
		} catch (e) {
			return msg;
		}
	}
}

export class StringCapturingProgressLog implements WritableLog {
	public readonly name: string = "StringCapturingProgressLog";
	public log = "";
	public stripAnsi = true;

	public close(): Promise<void> {
		return Promise.resolve();
	}

	public flush(): Promise<void> {
		return Promise.resolve();
	}

	public write(msg: string, ...args: string[]): void {
		const m = this.stripAnsi ? stripAnsi(msg) : msg;
		if (this.log) {
			this.log += format(m, ...args);
		} else {
			this.log = format(m, ...args);
		}
	}
}

export function buildMessage(
	msgTitle: string,
	ctx: CommandContext,
	params: TerraformRegistration,
	text: string,
	step: number,
	steps: number,
	state: SkillStepState,
): slack.SlackMessage {
	let header: string;
	if (
		params.project &&
		params.project.id &&
		params.project.id.owner &&
		params.project.id.repo &&
		params.project.id.sha
	) {
		header = `*${params.project.id.owner}/${
			params.project.id.repo
		}* at ${slack.url(
			(params as any).commitUrl,
			`\`${params.project.id.sha.slice(0, 7)}\``,
		)}\n\n`;
	}

	if (params.autoApprove) {
		header += `_Auto-Approve has been enabled, apply will automatically run following the plan step._\n\n`;
	}

	const finalState =
		step === steps || state === SkillStepState.Failure
			? state
			: SkillStepState.InProcess;

	const color = state === SkillStepState.Failure ? "cc0000" : "5f43e9";
	return {
		attachments: [
			{
				text: header ? header + text : text,
				color: "#5f43e9",
				author_name: slack.url(
					`https://go.atomist.com/log/${ctx.workspaceId}/${ctx.correlationId}`,
					msgTitle,
				),
				author_icon:
					"https://www.terraform.io/assets/images/og-image-8b3e4f7d.png",
				fallback: msgTitle,
				footer: slack.url(
					`https://go.atomist.com/manage/` +
						`${ctx.workspaceId}/skills/configure/${ctx.skill.id}/${ctx.configuration[0].name}`,
					`${ctx.skill.namespace}/${ctx.skill.name}@${ctx.skill.version}`,
				),
				thumb_url: `https://badge.atomist.com/v2/progress/${finalState}/${step}/${steps}?image=no&counter=no&color=${color}`,
				footer_icon: `https://images.atomist.com/rug/atomist.png`,
				ts: Math.floor(Date.now() / 1000),
			},
		],
	};
}

// GCP Auth
interface GcpCredential {
	credential: {
		secret: string;
	};
}
interface GcpAuthCred {
	GoogleCloudPlatformProvider: GcpCredential[];
}

export async function retrieveGcpCreds(
	ctx: EventContext<OnPushSubscription, TerraformRegistration>,
): Promise<string> {
	const query = `query gcpProviderSecret ($id: ID) {
    GoogleCloudPlatformProvider(id: $id) {
      name
      credential {
        ... on Password {
          secret
        }
      }
    }
  }`;

	const result: GcpAuthCred = await ctx.graphql.query(query, {
		id:
			ctx.configuration.resourceProviders.gcp.selectedResourceProviders[0]
				.id,
	});
	return result.GoogleCloudPlatformProvider[0].credential.secret;
}

const convertEnvArray = (data: string[]): Record<string, string> => {
	const result = {};
	data.forEach(a => {
		const splitData = a.split("=");
		if (splitData.length !== 2) {
			throw new Error("Could not process argument!");
		}
		result[splitData[0]] = splitData[1];
	});

	return result;
};

const convertTfVarArray = (data: string) => {
	const splitData = data.split("=");
	if (splitData.length !== 2) {
		throw new Error(
			`Could not process supplied Terraform var: ${data}.  Is it delimited with "="?`,
		);
	}
	return { tfVar: splitData[0], value: splitData[1] };
};

const convertArgArray = (data: string) => {
	const splitData = data.split("=");
	return { arg: splitData[0], value: splitData[1] };
};

export async function setParams(
	ctx: EventContext,
	params: TerraformRegistration,
): Promise<TerraformRegistration> {
	params.workspace = ctx.configuration.parameters.workspace;
	params.args = ctx.configuration.parameters.cmdlineargs
		? ctx.configuration.parameters.cmdlineargs.map(convertArgArray)
		: [];
	params.baseLocation = ctx.configuration.parameters.base;
	params.init = ctx.configuration.parameters.init;
	params.vars = ctx.configuration.parameters.cmdlinevars
		? (ctx.configuration.parameters.cmdlinevars as string[]).map(
				convertTfVarArray,
		  )
		: [];
	params.varsFiles = ctx.configuration.parameters.varFiles
		? ctx.configuration.parameters.varsFiles
		: [];
	params.envVars = ctx.configuration.parameters.envvars
		? convertEnvArray(ctx.configuration.parameters.envvars)
		: {};
	params.autoApprove = ctx.configuration.parameters.autoApprove
		? ctx.configuration.parameters.autoApprove
		: false;
	params.version = ctx.configuration.parameters.version
		? ctx.configuration.parameters.version
		: undefined;

	// Set incoming secrets
	const secret = await retrieveGcpCreds(ctx);
	params.envVars.GOOGLE_CREDENTIALS = secret;
	return params;
}

export async function hclCodePresent(
	params: TerraformRegistration,
): Promise<HandlerStatus> {
	const path = `${params.project.path()}/${params.baseLocation}`;
	if (!fs.existsSync(path)) {
		return {
			code: 1,
			reason: `Supplied baseLocation [${params.baseLocation}] does not exist!`,
		};
	}

	const results = fs
		.readdirSync(`${params.project.path()}/${params.baseLocation}`)
		.filter((f: string) => f.match(/^.*\.tf$/));

	return results.length > 0
		? { code: 0 }
		: {
				code: 1,
				reason: `No HCL code exists in supplied base location [${params.baseLocation}]`,
		  };
}

export async function findCommitterScreenName(
	ctx: EventContext | CommandContext,
	sha: string,
): Promise<string> {
	const result = await ctx.graphql.query<
		TfSkill_ChatIdByCommitQuery,
		TfSkill_ChatIdByCommitQueryVariables
	>("tfSkill_ChatIdByCommit.graphql", { sha });
	return result.Commit[0].committer.person.chatId.screenName;
}

export function configureLogging(level: string): void {
	process.env.ATOMIST_LOG_LEVEL = level;
}

export enum SkillStepState {
	Success = "success",
	Approved = "approved",
	Failure = "failure",
	Stopped = "stopped",
	Planned = "planned",
	InProcess = "in_process",
	Skipped = "skipped",
	Canceled = "canceled",
}
