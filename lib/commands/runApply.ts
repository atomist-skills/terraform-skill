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

import { CommandHandler } from "@atomist/skill/lib/handler";
import { runSteps } from "@atomist/skill/lib/steps";
import * as _ from "lodash";

import { LoadProjectStep, SetParamsStep, slackUpdate } from "../events/onPush";
import {
	InitTerraform,
	RunTerraformApply,
	SelectWorkspaceTerraform,
	SetTerraformVersion,
	TerraformRegistration,
	ValidateTerraform,
} from "../terraform";
import { configureLogging } from "../utils";

export const handler: CommandHandler = async ctx => {
	// Configure Logging
	configureLogging((ctx.configuration?.[0]?.parameters as any).logLevel);

	// Load data from the command handler input
	const data = await ctx.parameters.prompt<{ data: string }>({
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
			commitUrl: _.get(params as any, "commitUrl"),
		},
		[_.get(ctx.trigger.source, "slack.channel.name")],
	);

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
