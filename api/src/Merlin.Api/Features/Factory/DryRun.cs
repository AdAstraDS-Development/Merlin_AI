using System.Text.Json.Nodes;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// A dry run computed here instead of by factory/New-AppProject.ps1 -Mode DryRun (no PowerShell in the App Service):
/// the same steps and events (PROTOCOL.md), with the commands each step would run. Nothing is created.
/// </summary>
public static class DryRun
{
    public static async Task RunAsync(string runId, JsonObject request, FactoryOptions cfg, Func<JsonObject, Task> emit, CancellationToken ct)
    {
        var delay = TimeSpan.FromMilliseconds(cfg.DryRunStepDelayMs);
        var names = Preview.Names(request, cfg);
        var steps = Preview.StepList(request);
        var slug = request["appSlug"]!.GetValue<string>();
        await emit(new JsonObject { ["type"] = "plan", ["runId"] = runId, ["mode"] = "DryRun", ["steps"] = steps });
        // Events are readable by every signed-in user, so they carry no names; the run records who started it.
        await emit(Log($"Dry run for {slug} started."));
        foreach (var step in steps)
        {
            var id = step!["id"]!.GetValue<string>();
            await Task.Delay(delay, ct);
            await emit(Step(id, "running", $"Running {step["title"]}"));
            await Task.Delay(delay, ct);
            var commands = Preview.Commands(id, request, names, cfg);
            foreach (var c in commands.Take(3)) await emit(Log("[dry run] " + c));
            var done = Step(id, "succeeded", id == "validate" ? "Request is valid. Names derived." : "Simulated, nothing was changed.");
            done["url"] = id == "repository" ? names["repository"]!["url"]!.DeepClone() : null;
            done["commands"] = new JsonArray([.. commands.Select(c => (JsonNode)JsonValue.Create(c))]);
            await emit(done);
        }
        await emit(new JsonObject
        {
            ["type"] = "result",
            ["status"] = "succeeded",
            ["repoUrl"] = names["repository"]!["url"]!.DeepClone(),
            ["appUrl"] = names["webApps"]!.AsArray().FirstOrDefault()?["url"]?.DeepClone(),
            ["message"] = "Dry run finished. Nothing was created.",
        });
    }

    private static JsonObject Log(string message) => new() { ["type"] = "log", ["level"] = "info", ["message"] = message };

    private static JsonObject Step(string id, string status, string detail) => new() { ["type"] = "step", ["id"] = id, ["status"] = status, ["detail"] = detail };
}
