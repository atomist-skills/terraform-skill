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

import { createContext } from "@atomist/skill/lib/context";
import * as steps from "@atomist/skill";
import * as fs from "fs-extra";
import * as assert from "power-assert";
import * as sinon from "sinon";
import {
  InitTerraform,
  RunTerraformApply,
  RunTerraformPlan,
  SelectWorkspaceTerraform,
  SetTerraformVersion,
} from "../../lib/terraform";
import { Project, Spawn, Exec } from "@atomist/skill/lib/project/project";
import { RepositoryProviderType } from "@atomist/skill/lib/repository";
import {Push} from "../../lib/typings/types";
import {HandlerStatus} from "@atomist/skill/lib/handler";
import {handler, SetParamsStep} from "../../lib/events/onPush";

const gcp = { GoogleCloudPlatformProvider: [{
                  credential: {
                    secret: "just text",
                  },
                  name: "MattsTestGCPProject (Non-Atomist)",
                },
            ]};

describe ("terraform", () => {
    let sandbox: sinon.SinonSandbox;
    let f: sinon.SinonStub;
    before(() => {
      sandbox = sinon.createSandbox();
      process.env.STORAGE = "iamfake";
    });
    after(() => {
      delete process.env.STORAGE;
      sandbox.reset();
      sandbox.restore();
    });

    describe ("handler", () => {
      it("should not run if the branch is incorrect", async () => {
        f = sandbox.stub(steps, "runSteps");
        f.returns(Promise.resolve({code: 0}));
        const push: Push = JSON.parse(fs.readFileSync("test/data/pushHandlerTest.json").toString());
        const context = createFakeContext(push, gcp);
        const result = await handler(context);
        assert(result, "No response from handler!");
        const resultGood: HandlerStatus = (result as HandlerStatus);
        const reason =
          `Incoming branch [${context.data.Push[0].branch}] does not match configured branch [master], skipping.`;
        assert.strictEqual(resultGood.code, 0, "Result code is not 0!");
        assert.strictEqual(resultGood.reason, reason, "Reason string doesn't match expected!");
        assert.strictEqual(f.calledOnce, false);
        f.reset();
        f.restore();
      });
      it("should run if the branch is correct", async () => {
        f = sandbox.stub(steps, "runSteps");
        f.returns(Promise.resolve({code: 0}));
        const push = JSON.parse(fs.readFileSync("test/data/pushHandlerTest.json").toString());
        push.data.Push[0].branch = "master";
        const context = createFakeContext(push, gcp);
        const result = await handler(context);
        assert(result, "No response from handler!");
        assert.strictEqual((result as any).code, 0, "Result code is not 0!");
        assert.strictEqual((result as any).reason, "Success", "Result is not correct! Should be 'Success'!");
        assert.strictEqual(f.calledOnce, true);
        f.reset();
        f.restore();
      });
    });

    describe ("SetTerraformVersion", () => {
      it("should not run if version is not set in registration", async () => {
        const push = JSON.parse(fs.readFileSync("test/data/pushHandlerTest.json").toString());
        const context = createFakeContext(push, gcp);
        const params = {};
        await SetParamsStep.run(context as any, params as any);
        const result = await SetTerraformVersion.runWhen(context, params as any);
        assert.strictEqual(result, false);
      });
      it("should run if version is set in registration", async () => {
        const push = JSON.parse(fs.readFileSync("test/data/pushHandlerTest.json").toString());
        const context = createFakeContext(push, gcp);
        context.configuration[0].parameters.version = "12.1.1";
        const params = {};
        await SetParamsStep.run(context as any, params as any);
        const result = await SetTerraformVersion.runWhen(context, params as any);
        assert.strictEqual(result, true);
      });
      it("should run using the supplied version in registration", async () => {
        const push = JSON.parse(fs.readFileSync("test/data/pushHandlerTest.json").toString());
        const context = createFakeContext(push, gcp);
        context.configuration[0].parameters.version = "12.1.1";
        const fake = sandbox.stub();
        fake.onCall(0).returns({code: 1});
        fake.onCall(1).returns({code: 0});
        await steps.runSteps(
            {
                context,
                steps: [SetParamsStep, createFakeProjectLoader(fake, fake), SetTerraformVersion],
                listeners: [],
            });
        assert.strictEqual(fake.calledTwice, true);
        assert.strictEqual(fake.secondCall.args[0], "tfenv");
        assert.strictEqual(fake.secondCall.args[1][0], "install");
        assert.strictEqual(fake.secondCall.args[1][1], "12.1.1");
      });
    });

    describe ("SetParamsStep", () => {
        it("should set params successfully", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/push.json").toString());
            const context = createFakeContext(push, gcp);
            const params = {};
            await SetParamsStep.run(context as any, params as any);
            assert.strictEqual(
                JSON.stringify(params),
                `{"workspace":"test","args":[{"arg":"no-color"}],"baseLocation":"tf","init":false,` +
                `"vars":[{"tfVar":"foo","value":"bar"}],"varsFiles":[],` +
                `"envVars":{"foo":"bar","bar":"foo","GOOGLE_CREDENTIALS":"just text"}` +
                `,"autoApprove":false}`,
            );
        });
        it("should set params successfully with default config", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/pushNoArgs.json").toString());
            const context = createFakeContext(push, gcp);
            const params = {};
            await SetParamsStep.run(context as any, params as any);
            assert.deepStrictEqual(
                Object.keys(params).sort(),
                [
                    "workspace",
                    "autoApprove",
                    "args",
                    "baseLocation",
                    "version",
                    "init",
                    "vars",
                    "varsFiles",
                    "envVars",
                ].sort(),
            );
            assert.strictEqual(
                JSON.stringify(params),
                `{"args":[],"init":true,"vars":[],"varsFiles":[],"envVars":{"GOOGLE_CREDENTIALS":"just text"},` +
                `"autoApprove":false}`,
            );
        });
    });
    describe ("initTerraform", () => {
        it ("should not run if init param is true", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/pushNoArgs.json").toString());
            const context = createFakeContext(push, gcp);
            const fake = sinon.fake.returns({status: 0});
            await steps.runSteps(
                {
                    context,
                    steps: [SetParamsStep, createFakeProjectLoader(fake, fake), InitTerraform],
                    listeners: [],
            });
            assert.strictEqual(fake.notCalled, true);
        });
        it ("should run if init param is false", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/push.json").toString());
            const context = createFakeContext(push, gcp);
            const fake = sinon.fake.returns({status: 0});
            await steps.runSteps(
                {
                    context,
                    steps: [SetParamsStep, createFakeProjectLoader(fake, fake), InitTerraform],
                    listeners: [],
                });
            assert.strictEqual(fake.calledOnce, true);
            assert.strictEqual(fake.firstCall.args[0], "terraform");
            assert.strictEqual(fake.firstCall.args[1][0], "init");
            assert.strictEqual(fake.firstCall.args[1][1], "-var");
            assert.strictEqual(fake.firstCall.args[1][2], "foo=bar");
            assert.strictEqual(fake.firstCall.lastArg.cwd, "/fake/project/path/tf");
            assert.strictEqual(fake.firstCall.lastArg.env.foo, "bar");
        });
    });
    describe("SelectWorkspace", async () => {
        it ("should not run if workspace is undefined", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/pushNoArgs.json").toString());
            const context = createFakeContext(push, gcp);
            const fake = sinon.fake.returns({status: 0});
            await steps.runSteps(
                {
                    context,
                    steps: [SetParamsStep, createFakeProjectLoader(fake, fake), SelectWorkspaceTerraform],
                    listeners: [],
                });
            assert.strictEqual(fake.notCalled, true);
        });
        it ("should not run if workspace is defined", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/push.json").toString());
            const context = createFakeContext(push, gcp);
            const fake = sinon.fake.returns({status: 0});
            await steps.runSteps(
                {
                    context,
                    steps: [SetParamsStep, createFakeProjectLoader(fake, fake), SelectWorkspaceTerraform],
                    listeners: [],
                });
            assert.strictEqual(fake.calledOnce, true);
            assert.strictEqual(fake.firstCall.args[0], "terraform");
            assert.strictEqual(fake.firstCall.args[1][0], "workspace");
            assert.strictEqual(fake.firstCall.args[1][1], "select");
            assert.strictEqual(fake.firstCall.args[1][2], "test");
        });
    });
    describe ("RunTerraformPlan", () => {
        it ("should run plan", async () => {
            const push = JSON.parse(fs.readFileSync("test/data/push.json").toString());
            const context = createFakeContext(push, gcp);
            const fake = sinon.fake.returns({status: 0, output: "this is a test"});
            await steps.runSteps({
              context,
              steps: [
                SetParamsStep,
                createFakeProjectLoader(fake, fake),
                RunTerraformPlan,
              ],
              listeners: [],
            });
            assert.strictEqual(fake.calledOnce, true);
            assert.strictEqual(fake.firstCall.args[0], "terraform");
            assert.strictEqual(fake.firstCall.args[1][0], "plan");
            assert.strictEqual(fake.firstCall.args[1][1], "-input=false");
            assert.strictEqual(fake.firstCall.args[1][2], "-no-color");
            assert.strictEqual(fake.firstCall.args[1][3], "-detailed-exitcode");
            assert.strictEqual(fake.firstCall.args[1][4], "-var");
            assert.strictEqual(fake.firstCall.args[1][5], "foo=bar");
        });
    });
    describe ("RunTerraformApply", () => {
      it ("should not run apply when autoApprove is false", async () => {
          const push = JSON.parse(fs.readFileSync("test/data/push.json").toString());
          const context = createFakeContext(push, gcp);
          const fake = sinon.fake.returns({status: 0});
          await steps.runSteps({
            context,
            steps: [
              SetParamsStep,
              createFakeProjectLoader(fake, fake),
              RunTerraformApply,
            ],
            listeners: [],
          });
          assert.strictEqual(fake.calledOnce, false);
      });
      it ("should run apply", async () => {
          const push = JSON.parse(fs.readFileSync("test/data/pushAutoApprove.json").toString());
          const context = createFakeContext(push, gcp);
          const fake = sinon.fake.returns({status: 0});
          await steps.runSteps({
            context,
            steps: [
              SetParamsStep,
              createFakeProjectLoader(fake, fake),
              RunTerraformApply,
            ],
            listeners: [],
          });
          assert.strictEqual(fake.calledOnce, true);
          assert.strictEqual(fake.firstCall.args[0], "terraform");
          assert.strictEqual(fake.firstCall.args[1][0], "apply");
          assert.strictEqual(fake.firstCall.args[1][1], "-auto-approve");
          assert.strictEqual(fake.firstCall.args[1][2], "-input=false");
          assert.strictEqual(fake.firstCall.args[1][3], "-no-color");
          assert.strictEqual(fake.firstCall.args[1][4], "-var");
          assert.strictEqual(fake.firstCall.args[1][5], "foo=bar");
      });
    });
});

function createFakeContext(push: any, gqlResponse?: any): any {
    const context = createContext(push, {} as any);
    const logFake = sinon.fake();
    const graphClient = sinon.stub();
    if (gqlResponse) {
      graphClient.returns(gqlResponse);
    }
    const message = sinon.fake();
    sinon.replace(context.audit, "log", logFake);
    sinon.replace(context.graphql, "query", graphClient);
    sinon.replace(context.message, "send", message);
    return context;
}

function createFakeProjectLoader(spawn: Spawn, exec: Exec): any  {
    return {
        name: "load project",
        run: async (ctx: any, params: {project: Project}) => {
            params.project = createFakeProject(spawn, exec);
            params.project.spawn = spawn;
            params.project.exec = exec;
            return {
                code: 0,
            };
        },
    };
}

function createFakeProject(spawn: Spawn, exec: Exec): Project {
  return {
    id: {
      credential: "fake",
      cloneUrl: () => "https://fake.project.host.com/fake/project",
      owner: "dummyOwner",
      repo: "dummyRepo",
      sha: "9e48f944bf1aaf41feeea003aa1c96a92cec0c4f",
      type: RepositoryProviderType.GitHubCom,
    },
    spawn,
    exec,
    path: () => "/fake/project/path",
  };
}
