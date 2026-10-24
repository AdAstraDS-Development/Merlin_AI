using System.Text.Json.Nodes;

namespace Merlin.Api.Features.Factory;

/// <summary>A step that failed; its message is the run's result message. Never contains tokens.</summary>
public sealed class RunStepFailedException(string message) : Exception(message);

/// <summary>
/// A Factory run (UC-08): validates, checks the GitHub App or token and the collision rule, creates the repository from the template
/// with the topic <c>project-factory</c>, and reports every step Merlin does not automate yet as skipped (PROTOCOL.md events).
/// </summary>
public static class FactoryRun
{
    public const string Topic = "project-factory";
    public const string Finished = "Repository created. The remaining steps are not automated yet.";

    public static async Task RunAsync(string runId, JsonObject request, FactoryOptions cfg, IGitHub github, Func<JsonObject, Task> emit, CancellationToken ct)
    {
        var names = Preview.Names(request, cfg);
        var steps = Preview.StepList(request);
        var slug = request["appSlug"]!.GetValue<string>();
        var owner = request["github"]!["owner"]!.GetValue<string>();
        var repo = request["github"]!["repoName"]!.GetValue<string>();
        var visibility = request["github"]!["visibility"]!.GetValue<string>();
        var full = $"{owner}/{repo}";
        var template = cfg.GitHub.TemplateRepository;
        var byToken = cfg.GitHub.UsesToken;
        string? token = null;
        string? repoUrl = null;

        await emit(new JsonObject { ["type"] = "plan", ["runId"] = runId, ["mode"] = "Factory", ["steps"] = steps });
        await emit(Log($"Factory run for {slug} started."));
        foreach (var step in steps)
        {
            ct.ThrowIfCancellationRequested();
            var id = step!["id"]!.GetValue<string>();
            switch (id)
            {
                case "validate":
                    await emit(Step(id, "running", "Running Validate request"));
                    await emit(Done(id, "Request is valid. Names derived.", null, []));
                    break;

                case "prerequisites":
                    await emit(Step(id, "running", byToken ? "Checking the GitHub token and the repository name" : "Checking Merlin's GitHub App and the repository name"));
                    try { token = await github.AccessTokenAsync(owner, ct); }
                    catch (GitHubException ex)
                    {
                        throw await Failed(emit, id, (byToken, ex.Status) switch
                        {
                            (false, System.Net.HttpStatusCode.NotFound) => $"Merlin's GitHub App is not installed on {owner}.",
                            (false, _) => $"Merlin's GitHub App could not sign in to {owner}: GitHub answered {(int)ex.Status} {ex.Message}",
                            (true, System.Net.HttpStatusCode.Unauthorized) => "GitHub rejected Merlin's token. It may have expired or been revoked; replace Factory:GitHub:Token.",
                            (true, _) => $"Merlin's GitHub token could not be checked: GitHub answered {(int)ex.Status} {ex.Message}",
                        });
                    }
                    bool exists;
                    try { exists = await github.RepositoryExistsAsync(token!, owner, repo, ct); }
                    catch (GitHubException ex) { throw await Failed(emit, id, $"Could not check whether {full} exists: GitHub answered {(int)ex.Status} {ex.Message}"); }
                    if (exists) throw await Failed(emit, id, $"The repository {full} exists already. Choose another repository name.");
                    await emit(byToken
                        ? Done(id, "Merlin's GitHub token is valid and the repository name is free.", null, ["GET /user", $"GET /repos/{full}"])
                        : Done(id, "Merlin's GitHub App is installed and the repository name is free.", null, [$"GET /orgs/{owner}/installation", $"GET /repos/{full}"]));
                    break;

                case "export":
                    await emit(Step(id, "skipped", "The template repository is used instead."));
                    break;

                case "repository":
                    await emit(Step(id, "running", $"Creating {full} from {template}"));
                    var commands = Preview.Commands(id, request, names, cfg);
                    var description = request["problem"]?.GetValue<string>() ?? "";
                    try { repoUrl = await github.GenerateFromTemplateAsync(token!, template, owner, repo, description.Length > 350 ? description[..350] : description, ct); }
                    catch (GitHubException ex) { throw await Failed(emit, id, $"GitHub could not create {full} from {template}: {(int)ex.Status} {ex.Message}"); }
                    try
                    {
                        await github.SetTopicsAsync(token!, owner, repo, [Topic], ct);
                        if (visibility != "private") await github.SetVisibilityAsync(token!, owner, repo, visibility, ct);
                    }
                    catch (GitHubException ex)
                    {
                        throw await Failed(emit, id, $"{full} was created, but GitHub refused to finish it ({(int)ex.Status} {ex.Message}). Set the topic {Topic} and the visibility {visibility} by hand.");
                    }
                    await emit(Done(id, $"Created {full} from {template}.", repoUrl, commands));
                    await emit(new JsonObject
                    {
                        ["type"] = "resources",
                        ["github"] = new JsonObject { ["host"] = cfg.GithubHost, ["owner"] = owner, ["repo"] = repo, ["url"] = repoUrl },
                    });
                    break;

                default:
                    await emit(Step(id, "skipped", "Not automated in Merlin yet."));
                    break;
            }
        }
        await emit(new JsonObject { ["type"] = "result", ["status"] = "succeeded", ["repoUrl"] = repoUrl, ["appUrl"] = null, ["message"] = Finished });
    }

    /// <summary>Emits the failed step; the caller throws the returned exception and the run service emits the failed result with the same message.</summary>
    private static async Task<RunStepFailedException> Failed(Func<JsonObject, Task> emit, string id, string message)
    {
        await emit(Step(id, "failed", message));
        return new RunStepFailedException(message);
    }

    private static JsonObject Done(string id, string detail, string? url, string[] commands)
    {
        var e = Step(id, "succeeded", detail);
        e["url"] = url;
        e["commands"] = new JsonArray([.. commands.Select(c => (JsonNode)JsonValue.Create(c))]);
        return e;
    }

    private static JsonObject Log(string message) => new() { ["type"] = "log", ["level"] = "info", ["message"] = message };

    private static JsonObject Step(string id, string status, string detail) => new() { ["type"] = "step", ["id"] = id, ["status"] = status, ["detail"] = detail };
}
