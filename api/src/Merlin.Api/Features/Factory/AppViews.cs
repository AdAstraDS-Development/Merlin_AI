using System.Text.Json.Nodes;
using Merlin.Api.Data;

namespace Merlin.Api.Features.Factory;

/// <summary>Shapes registry rows into the <c>AppSummary</c> and <c>AppDetail</c> records of the web app, and dry-run status checks.</summary>
public static class AppViews
{
    public static JsonObject Summary(AppEntity app, CheckEntity? check, FactoryOptions cfg, DateTimeOffset now)
    {
        var request = JsonNode.Parse(app.RequestJson)!.AsObject();
        var resources = Preview.Resources(request, cfg);
        var row = new JsonObject
        {
            ["id"] = app.Slug,
            ["slug"] = app.Slug,
            ["name"] = app.Name,
            ["status"] = app.Status,
            ["createdAt"] = app.CreatedAt.ToString("o"),
            ["updatedAt"] = app.UpdatedAt.ToString("o"),
            ["requestedBy"] = app.RequestedByName,
            ["resources"] = resources,
            ["repoUrl"] = resources["github"]!["url"]!.DeepClone(),
            ["appUrls"] = new JsonArray([.. resources["azure"]!["webApps"]!.AsArray().Select(w => w!["url"]!.DeepClone())]),
            ["description"] = request["problem"]?.GetValue<string>() ?? FirstLine(request["description"]?.GetValue<string>()),
            ["environments"] = request["azure"]!["environments"]!.DeepClone(),
        };
        if (Costs.ForApp(cfg, request, app.Status, app.CreatedAt, now) is { } cost) row["cost"] = cost;
        if (check is not null) row["lastCheck"] = new JsonObject { ["at"] = check.At.ToString("o"), ["overall"] = check.Overall };
        return row;
    }

    public static JsonObject Detail(AppEntity app, CheckEntity? check, IReadOnlyList<RunEntity> runs, FactoryOptions cfg, DateTimeOffset now)
    {
        var row = Summary(app, check, cfg, now);
        if (check is not null) row["check"] = JsonNode.Parse(check.Json);
        row["runs"] = new JsonArray([.. runs.Select(r => (JsonNode)new JsonObject
        {
            ["id"] = r.Id, ["status"] = r.Status, ["mode"] = r.Mode, ["startedAt"] = r.StartedAt.ToString("o"),
        })]);
        return row;
    }

    public static JsonObject RunSummary(RunEntity run) => new()
    {
        ["id"] = run.Id,
        ["appSlug"] = run.AppSlug,
        ["appName"] = run.AppName,
        ["mode"] = run.Mode,
        ["status"] = run.Status,
        ["startedAt"] = run.StartedAt.ToString("o"),
        ["finishedAt"] = run.FinishedAt?.ToString("o"),
        ["message"] = run.Message,
    };

    private static readonly (string Id, string Title, string[] Links)[] Checks =
    [
        ("repository", "Repository exists", ["github"]),
        ("github-environments", "Environments and variables", ["github"]),
        ("identities", "Federated identities", ["github", "azure"]),
        ("azure-groups", "Resource groups and role assignments", ["azure"]),
        ("state", "Terraform state storage", ["azure"]),
        ("web-app", "Web app is running", ["azure", "deployment"]),
        ("release", "Latest release succeeded", ["deployment"]),
        ("deployed-version", "Deployed commit matches main", ["deployment"]),
        ("health", "Health endpoint answers", ["deployment"]),
    ];

    /// <summary>What factory/Get-AppStatus.ps1 -Mode DryRun returns: a simulated pass for simulated apps, otherwise unknown.</summary>
    public static JsonObject DryRunCheck(string status, DateTimeOffset at)
    {
        var simulated = status == "simulated";
        return new JsonObject
        {
            ["at"] = at.ToString("o"),
            ["overall"] = simulated ? "healthy" : "unknown",
            ["checks"] = new JsonArray([.. Checks.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id,
                ["title"] = c.Title,
                ["status"] = simulated ? "pass" : "unknown",
                ["detail"] = simulated ? "(simulated pass)" : "(dry run)",
                ["links"] = new JsonArray([.. c.Links.Select(l => (JsonNode)JsonValue.Create(l))]),
            })]),
        };
    }

    private static string? FirstLine(string? text)
    {
        var line = text?.Split('\n').Select(l => l.Trim().TrimStart('#', ' ', '\t')).FirstOrDefault(l => l.Length > 0);
        return line is { Length: > 200 } ? line[..200] + "..." : line;
    }
}
