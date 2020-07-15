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
  ParameterType,
  parameter,
  skill,
  resourceProvider,
  Category,
} from "@atomist/skill";

export const Skill = skill({
  name: "terraform-skill",
  namespace: "atomist",
  displayName: "Run Terraform",
  author: "Atomist",
  categories: [Category.DevOps, Category.Deploy],
  homepageUrl: "https://github.com/atomist-skills/terraform-skill",
  repositoryUrl: "https://github.com/atomist-skills/terraform-skill.git",
  iconUrl: "file://docs/icon.svg",
  license: "Apache-2.0",

  runtime: {
    memory: 1024,
    timeout: 60,
  },

  resourceProviders: {
    github: resourceProvider.gitHub({ minRequired: 1 }),
    slack: resourceProvider.slack({ minRequired: 1 }),
    gcp: resourceProvider.gcp({
      description: "Which Google Cloud Provider credential should be used?",
      minRequired: 1,
      maxAllowed: 1,
    }),
  },

  parameters: {
    base: {
      description:
        "Base location for the Terraform code in the repo.  If not supplied, the root of the project is assumed.",
      displayName: "Set Terraform Code base",
      placeHolder: "Path to Terraform code",
      type: ParameterType.String,
      required: false,
    },
    workspace: {
      description:
        "Name of Terraform workspace to use.  Workspace must already exist!",
      displayName: "Terraform Workspace",
      placeHolder: "Set Terraform Workspace",
      type: ParameterType.String,
      required: false,
    },
    branch: {
      description:
        "Git branch for Terraform to operate on. " +
        "If the incoming push doesn't match branch supplied it will be skipped",
      displayName: "Restrict Git Branch",
      placeHolder: "Branch Name",
      type: ParameterType.String,
      required: false,
    },
    envvars: {
      required: false,
      type: ParameterType.StringArray,
      description:
        "Set Environment Variables that will be set when Terraform code runs.  Provide in the form of" +
        " name=value",
      displayName: "Environment Variables",
    },
    cmdlineargs: {
      description: "Command line arguments to be passed to Terraform.",
      displayName: "Command line arguments",
      type: ParameterType.StringArray,
      required: false,
    },
    cmdlinevars: {
      description:
        "Command line vars to be passed to Terraform.  Provide in the form name=value",
      displayName: "Command line vars",
      required: false,
      type: ParameterType.StringArray,
    },
    varfiles: {
      required: false,
      type: ParameterType.StringArray,
      description:
        "Supply one or more Terraform variable files to be used when launching Terraform actions",
      displayName: "Terraform Variable Files",
    },
    init: {
      required: false,
      type: ParameterType.Boolean,
      description:
        "Should the skill not execute `terraform init` prior to running a plan/apply?",
      displayName: "Disable Terraform Init?",
    },
    autoApprove: {
      required: false,
      type: ParameterType.Boolean,
      description:
        "When enabled, Terraform will run a plan and then immediately execute an apply without confirmation",
      displayName: "Terraform Auto Apply?",
    },
    version: {
      required: false,
      type: ParameterType.String,
      placeHolder: "0.12.26",
      description:
        "Supply the version of Terraform to use for this configuration.",
      displayName: "Terraform Version",
    },
    logLevel: {
      required: false,
      type: ParameterType.SingleChoice,
      description: "What logging level should be used?",
      displayName: "Logging Level",
      defaultValue: "info",
      options: [
        { text: "error", value: "error" },
        { text: "warn", value: "warn" },
        { text: "info", value: "info" },
        { text: "debug", value: "debug" },
      ],
    },
    repo_filter: parameter.repoFilter(),
  },

  containers: {
    package: {
      image: "gcr.io/atomist-container-skills/terraform-skill",
    },
  },

  subscriptions: ["file://graphql/subscription/*.graphql"],
});
