# terraform-skill

<!---atomist-skill-description:start--->

Use terraform to converge changes to infrastructure via GitOps.

<!---atomist-skill-description:end--->

<!---atomist-skill-readme:start--->

# What it's useful for

This skill enables you to automatically run Terraform whenever your git repos change and provide visibility into the
process.
  
Terraform is an excellent tool for modeling the state of your cloud resources in code. In order to effectively make use
of this tool in a team setting, all members of the team must be applying their changes to the cloud infrastructure in a
standardized way — not running locally on their laptop. This skill allows the entire team to utilize a common workflow
simply by pushing their changes to a git repo (and using all the same practices you would on any development project).
In addition, the Terraform skill provides visibility into the infrastructure changes being applied either through the
web based log view or through ChatOps integration.
  
By default, the skill will first run a `terraform plan` and notify you of the changes to be made via a Chat message.
Here you can review the proposed changes and, if appropriate, approve them which will cause a `terraform apply` to be
run. This skill can also be used in an `auto-approve` mode in which changes will be automatically approved provided a
plan successfully runs.

# Before you get started

Connect and configure these integrations:

1. Github
1. Slack
1. Google Cloud Provider (GCP)

<sup>_\*\*Currently, the Terraform skill only has support for the GCP provider. More cloud provider support will be added in the
future_</sup>

#### How credentials are supplied to Terraform

This skill utilizes the actual Terraform binaries directly. When invoked, additional environment variables are injected
to supply the required credentials. For GCP the environment variable that is set is called `GOOGLE_CREDENTIALS`. The
contents of your JSON credentials is set as the value of this variable. This is done only for the process that actually
invokes the `terraform` command, not for the entire skill execution.

# How to configure

#### Mandatory Settings

1. Select Google Cloud Provider (GCP) Credential

The GCP provider supports enabling multiple authorizations to support different teams or use cases. In the configuration
you must select which of these authorizations to use in the `Which Google Cloud Provider credential should be used?`
drop down.

2. Determine Repository Scope

The repository selector at the bottom of the configuration for allows you to specify which repostories should have this
skill run against them. You may decide to setup only specific repositories or let the skill run against entire
organizations depending on your use case.

#### Optional Settings

`Set Terraform Code base`  
This setting can be used to set a directory within your repository where your HCL code can be found. This can be useful
for repositories that contain both application code and infrastructure code, or in a situation where you have multiple
sets of HCL code that are independent. You can create multiple skill configurations all using the same repository with
different code locations.

`Terraform Workspace`  
If you are making use of [Terraform workspaces](https://www.terraform.io/docs/state/workspaces.html), you can define
which workspace should be used for this skill configuration.

`Enviornment Variables`  
This configuration allows you to pass arbitrary environment variables that will be set when the `terraform` executable
is run. Each variable should be set on its own line and supplied in a `var=value` format.

`Command line arguments`  
These arguments will be appended to the command used to launch the `terraform` command. See the documentation
[here](https://www.terraform.io/docs/commands/index.html) for valid arguments. Each argument should be set on its own
line and supplied in a `var=value` format. Arguments are passed to all `terraform` command executions
(`apply` and `plan`) so only global options should be specified.

`Command line vars`  
Additional Terraform `vars` that should be passed at execution. The options supplied here will be passed as `-var key=value` to the `terraform` commands. These should be set one var to each line in a `var=value` format.

`Terraform Variable Files`  
This configuration option allows you to specify tfvar files that should be passed to the Terraform commands. See the
[documentation](https://www.terraform.io/docs/configuration/variables.html#variable-definitions-tfvars-files) for
details on using tfvar files.

`Disable Terraform Init?`  
By default the Terraform skill will run `terraform init` on every run to download the required providers. If you do not
want this to execute, select this option.

`Terraform Auto Approve`  
When enabled this automatically runs `terraform apply` following the successful execution of `terraform plan`. In this
mode there is no review of pending changes; they are simply applied.

`Restrict Git Branch`  
By default the Terraform skill will run on any branch pushed. If you wish to only run the skill for a particular branch
you should specify it here.

`Terraform Version`  
When supplied, this version of Terraform will be used when running Terraform. If not supplied the default Terraform
version for this skill is used, which is `0.12.26`. Note, this skill uses [tfenv](https://github.com/tfutils/tfenv) to
handle version management.

#### ChatOps Integration

This skill uses ChatOps as an interface to permit you to control the behavior of Terraform (when auto approve is
disabled). Notifications are automatically routed to the appropriate locations based on two factors:

-   Is this repository currently linked to any chat channels (see [GitHub Notifications Skill](https://go.atomist.com/catalog/skills/atomist/github-notifications-skill))
-   If there are no links, can the authors chat id be determined

The skill prefers notifying a channel of the changes that are pending or occuring. If no channel has been linked the
notifications will be sent directly to the author of the change, if found. If neither of these conditions are met no
notiifcation will be sent, however the log can still be viewed in the Atomist web interface.

<!---atomist-skill-readme:end--->

---

Created by [Atomist][atomist].
Need Help? [Join our Slack workspace][slack].

[atomist]: https://atomist.com/ "Atomist - How Teams Deliver Software"
[slack]: https://join.atomist.com/ "Atomist Community Slack"

