using System.Text.Json.Nodes;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// Names, steps and resources a run would create (ported from ai-sw-template/factory/portal/Preview.cs).
/// The engine factory/New-AppProject.ps1 is the authority; the names follow the template's Terraform conventions.
/// </summary>
public static class Preview
{
    public static readonly (string Id, string Title, string Description)[] Steps =
    [
        ("validate", "Validate request", "Checks the request against the schema and the platform allowlists."),
        ("prerequisites", "Check tools and sign-ins", "Verifies tools, sign-ins and Azure resource provider registration."),
        ("export", "Create the app from the template", "Generates the app including intent/001-initial/intent.md and the .tfvars files."),
        ("validate-app", "Validate the app locally", "Installs dependencies and runs pnpm validate (optional)."),
        ("repository", "Create the GitHub repository", "Creates the repository from the template repository."),
        ("azure-groups", "Create Azure resource groups", "One shared group and one per environment."),
        ("azure-state", "Create Terraform state storage", "Creates or reuses the storage account for Terraform state."),
        ("azure-identities", "Create deployment identities", "Plan, infrastructure and deploy identities with federated credentials and scoped roles."),
        ("github-setup", "Configure GitHub", "Creates environments, variables and branch protection."),
        ("infrastructure", "Provision development", "Runs the Infrastructure workflow (plan and apply) for development."),
        ("release", "Deploy the first release", "Enables deployment and runs the Release workflow."),
        ("verify", "Verify the deployment", "Checks the deployed app's health endpoint."),
    ];

    public static JsonArray StepList(JsonObject req)
    {
        var withValidate = req["options"]?["runLocalValidation"]?.GetValue<bool>() ?? false;
        return new JsonArray([.. Steps.Where(s => s.Id != "validate-app" || withValidate)
            .Select(s => (JsonNode)new JsonObject { ["id"] = s.Id, ["title"] = s.Title, ["description"] = s.Description })]);
    }

    private static string Short(string env) => env == "production" ? "prd" : "dev";

    public static JsonObject Names(JsonObject req, FactoryOptions cfg)
    {
        var slug = req["appSlug"]!.GetValue<string>();
        var suffix = req["azure"]!["nameSuffix"]!.GetValue<string>();
        var owner = req["github"]!["owner"]!.GetValue<string>();
        var repo = req["github"]!["repoName"]!.GetValue<string>();
        var envs = req["azure"]!["environments"]!.AsArray().Select(e => e!.GetValue<string>()).ToArray();

        // Same rules as factory/New-AppProject.ps1: a shared state account (one container per app) or an own account.
        var useShared = cfg.SharedStateAccount.Length > 0 && cfg.SharedStateGroup.Length > 0;
        var st = useShared ? cfg.SharedStateAccount : "st" + slug.Replace("-", "") + suffix + "tf";
        var stContainer = useShared ? $"{slug}-{suffix}" : "tfstate";
        var stGroup = useShared ? cfg.SharedStateGroup : $"rg-{slug}-shared-{suffix}";

        var groups = new JsonArray { new JsonObject { ["role"] = "shared", ["name"] = $"rg-{slug}-shared-{suffix}" } };
        var webApps = new JsonArray();
        var database = req["options"]?["database"]?.GetValue<string>() ?? "none";
        var databases = new JsonArray();
        var ghEnvs = new JsonArray();
        var subjects = new JsonArray();
        foreach (var e in envs)
        {
            var n = $"{slug}-{Short(e)}-{suffix}";
            groups.Add(new JsonObject { ["role"] = e, ["name"] = "rg-" + n });
            webApps.Add(new JsonObject { ["environment"] = e, ["name"] = "app-" + n, ["plan"] = "plan-" + n, ["url"] = $"https://app-{n}.azurewebsites.net" });
            if (database == "azure-sql") databases.Add(new JsonObject { ["environment"] = e, ["kind"] = "Azure SQL (serverless)", ["name"] = $"sql-{n} / sqldb-{slug}" });
            ghEnvs.Add(new JsonObject { ["name"] = e + "-plan", ["purpose"] = "terraform plan (read-only identity)" });
            ghEnvs.Add(new JsonObject { ["name"] = e, ["purpose"] = e == "production" ? "apply and deploy, behind required reviewers" : "apply and deploy" });
            subjects.Add($"repo:{owner}/{repo}:environment:{e}-plan");
            subjects.Add($"repo:{owner}/{repo}:environment:{e}");
        }
        return new JsonObject
        {
            ["repository"] = new JsonObject
            {
                ["url"] = $"https://{cfg.GithubHost}/{owner}/{repo}",
                ["fullName"] = $"{owner}/{repo}",
                ["visibility"] = req["github"]!["visibility"]!.GetValue<string>(),
                ["branchProtection"] = req["options"]!["protectMain"]!.GetValue<bool>(),
            },
            ["resourceGroups"] = groups,
            ["stateStorage"] = new JsonObject { ["storageAccount"] = st, ["container"] = stContainer, ["resourceGroup"] = stGroup },
            ["identities"] = new JsonArray
            {
                new JsonObject { ["name"] = $"id-{slug}-plan", ["purpose"] = "Plan", ["roles"] = "Reader and state blob access" },
                new JsonObject
                {
                    ["name"] = $"id-{slug}-infra", ["purpose"] = "Infrastructure",
                    ["roles"] = database == "azure-sql"
                        ? "Web Plan, Website, SQL Server Contributor and SQL Security Manager on the environment groups"
                        : "Web Plan and Website Contributor on the environment groups",
                },
                new JsonObject { ["name"] = $"id-{slug}-deploy", ["purpose"] = "Deploy", ["roles"] = "Website Contributor on the web app" },
            },
            ["federatedSubjects"] = subjects,
            ["webApps"] = webApps,
            ["databases"] = databases,
            ["githubEnvironments"] = ghEnvs,
            ["variables"] = new JsonArray("AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "AZURE_CLIENT_ID", "AZURE_INFRA_CLIENT_ID",
                "TF_STATE_RESOURCE_GROUP", "TF_STATE_STORAGE_ACCOUNT", "TF_STATE_CONTAINER", "AZURE_WEBAPP_NAME"),
            ["productionReviewers"] = req["github"]!["productionReviewers"]!.DeepClone(),
            ["region"] = req["azure"]!["region"]!.GetValue<string>(),
        };
    }

    /// <summary>The resources an app has (or, after a dry run, would have), in the shape of <c>AppResources</c>.</summary>
    public static JsonObject Resources(JsonObject req, FactoryOptions cfg)
    {
        var n = Names(req, cfg);
        var state = n["stateStorage"]!;
        return new JsonObject
        {
            ["github"] = new JsonObject
            {
                ["host"] = cfg.GithubHost,
                ["owner"] = req["github"]!["owner"]!.DeepClone(),
                ["repo"] = req["github"]!["repoName"]!.DeepClone(),
                ["url"] = n["repository"]!["url"]!.DeepClone(),
            },
            ["azure"] = new JsonObject
            {
                ["resourceGroups"] = new JsonArray([.. n["resourceGroups"]!.AsArray().Select(g => g!["name"]!.DeepClone())]),
                ["stateStorage"] = new JsonObject { ["account"] = state["storageAccount"]!.DeepClone(), ["container"] = state["container"]!.DeepClone(), ["resourceGroup"] = state["resourceGroup"]!.DeepClone() },
                ["identities"] = new JsonArray([.. n["identities"]!.AsArray().Select(i =>
                {
                    var name = i!["name"]!.GetValue<string>();
                    return (JsonNode)new JsonObject { ["role"] = name[(name.LastIndexOf('-') + 1)..], ["name"] = name };
                })]),
                ["webApps"] = new JsonArray([.. n["webApps"]!.AsArray().Select(w => (JsonNode)new JsonObject
                {
                    ["environment"] = w!["environment"]!.DeepClone(), ["name"] = w["name"]!.DeepClone(), ["url"] = w["url"]!.DeepClone(),
                })]),
            },
        };
    }

    /// <summary>The commands a real run executes for a step; a dry run only lists them (from the engine's Invoke-Tool calls).</summary>
    public static string[] Commands(string step, JsonObject req, JsonObject names, FactoryOptions cfg)
    {
        var full = names["repository"]!["fullName"]!.GetValue<string>();
        var slug = req["appSlug"]!.GetValue<string>();
        var region = names["region"]!.GetValue<string>();
        var state = names["stateStorage"]!;
        string[] Each(string key, Func<JsonNode, string> f) => [.. names[key]!.AsArray().Select(x => f(x!))];
        return step switch
        {
            "prerequisites" => ["az account show", $"gh auth status --hostname {cfg.GithubHost}", "az provider show --namespace Microsoft.Web --query registrationState"],
            "export" => [$"Export the template to ./work/{slug}", "git init --initial-branch=main", "git add --all", "git commit --message \"chore: initial commit\""],
            "validate-app" => ["pnpm install --frozen-lockfile", "pnpm validate"],
            "repository" =>
            [
                $"POST /repos/{cfg.GitHub.TemplateRepository}/generate (owner: {req["github"]!["owner"]}, name: {req["github"]!["repoName"]}, private: true)",
                $"PUT /repos/{full}/topics ({FactoryRun.Topic})",
                .. req["github"]!["visibility"]!.GetValue<string>() == "private" ? Array.Empty<string>() : [$"PATCH /repos/{full} (visibility: {req["github"]!["visibility"]})"],
            ],
            "azure-groups" => Each("resourceGroups", g => $"az group create --name {g["name"]} --location {region} --tags app={slug}"),
            "azure-state" =>
            [
                $"az storage account create --name {state["storageAccount"]} --resource-group {state["resourceGroup"]} --sku Standard_LRS --allow-blob-public-access false",
                $"az storage container create --name {state["container"]} --account-name {state["storageAccount"]} --auth-mode login",
            ],
            "azure-identities" =>
            [
                .. Each("identities", i => $"az identity create --name {i["name"]} --resource-group {state["resourceGroup"]}"),
                .. Each("federatedSubjects", s => $"az identity federated-credential create --subject {s} ..."),
            ],
            "github-setup" =>
            [
                .. Each("githubEnvironments", e => $"gh api --method PUT repos/{full}/environments/{e["name"]}"),
                .. Each("variables", v => $"gh variable set {v} --repo {full}"),
                .. req["options"]!["protectMain"]!.GetValue<bool>() ? new[] { $"gh api --method PUT repos/{full}/branches/main/protection" } : [],
            ],
            "infrastructure" => [$"gh workflow run infrastructure.yml --repo {full} --field environment=development", $"gh run watch --repo {full}"],
            "release" => [$"gh variable set DEPLOY_ENABLED --body true --repo {full}", $"gh workflow run release.yml --repo {full}"],
            "verify" => Each("webApps", w => $"curl --fail {w["url"]}/health/live"),
            _ => [],
        };
    }
}
