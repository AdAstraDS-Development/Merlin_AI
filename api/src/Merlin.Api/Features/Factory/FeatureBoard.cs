using System.Collections.Concurrent;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// Feature board per app (ported unchanged from ai-sw-template/factory/portal/FeatureBoard.cs): features move through the AI-native stages, each stage worked by an agent with a model.
/// For now a simulated orchestrator produces the states; a real orchestrator (for example Microsoft Agent Framework)
/// will later send the same events. States are computed from the elapsed time, so the board is stateless and always moving.
/// </summary>
public sealed class FeatureBoard
{
    public sealed record Stage(string Id, string Title, string Agent, string? Model, string Purpose);

    public static readonly Stage[] Stages =
    [
        new("spec", "Spec", "Spec writer", "claude-sonnet-5-5", "Turns the request into use cases and acceptance criteria"),
        new("grill", "Grill", "Griller", "claude-opus-5-5", "Challenges the spec: gaps, edge cases, open questions"),
        new("size", "Size", "Sizer", "claude-haiku-5-5", "Small goes straight on, big is split into slices"),
        new("build", "Build", "Builder", "claude-sonnet-5-5", "Implements slice by slice with tests"),
        new("review-code", "Review: code", "Code reviewer", "claude-sonnet-5-5", "Checks the coding guidelines and REVIEW.md"),
        new("review-security", "Review: security", "Security reviewer", "claude-opus-5-5", "Checks auth, input handling, secrets, dependencies"),
        new("human", "Human", "Product owner", null, "A person approves the change"),
        new("done", "Released", "Release pipeline", null, "Deployed through the release workflow"),
    ];

    /// <summary>One scripted step: stage, status, seconds it lasts, detail, optional progress (0..1).</summary>
    sealed record Step(string Stage, string Status, int Seconds, string Detail, double? Progress = null);

    sealed record Script(string Title, string Kind, string Source, string Size, int Offset, Step[] Steps, bool Repeat);

    static Step[] SmallFeature(string what) =>
    [
        new("spec", "running", 8, $"Drafting use cases for {what}", 0.4),
        new("spec", "running", 6, "Writing acceptance criteria (Given/When/Then)", 0.8),
        new("grill", "running", 8, "Asking 4 questions about edge cases"),
        new("grill", "running", 5, "Spec updated: 1 edge case added"),
        new("size", "running", 4, "Estimating the change"),
        new("size", "passed", 2, "Small: one slice"),
        new("build", "running", 7, "Writing tests first", 0.2),
        new("build", "running", 9, "Implementing endpoint and UI", 0.6),
        new("build", "running", 6, "pnpm validate: 9/9 checks", 0.95),
        new("review-code", "running", 8, "Checking naming, structure and tests"),
        new("review-security", "running", 8, "Checking authorization and input validation"),
        new("human", "waiting", 14, "Waiting for the product owner"),
        new("done", "done", 30, "Deployed to development"),
    ];

    static readonly Script[] Seeds =
    [
        new("CSV export of the main list", "feature", "jira", "small", 0, SmallFeature("the CSV export"), true),
        new("Sign-in for external partners", "feature", "servicenow", "big", 9,
        [
            new("spec", "running", 10, "Drafting use cases for partner sign-in", 0.5),
            new("spec", "running", 6, "Acceptance criteria for 5 use cases", 0.9),
            new("grill", "running", 9, "Question: which partner tenants are allowed?"),
            new("grill", "waiting", 8, "Waiting for an answer from the requester"),
            new("grill", "running", 5, "Answer received, spec updated"),
            new("size", "running", 4, "Estimating the change"),
            new("size", "passed", 3, "Big: split into 3 slices"),
            new("build", "running", 9, "Slice 1/3: guest tenant allowlist", 0.33),
            new("build", "running", 9, "Slice 2/3: role mapping", 0.66),
            new("build", "running", 8, "Slice 3/3: partner landing page", 0.95),
            new("review-code", "running", 7, "Checking the coding guidelines"),
            new("review-code", "changes", 4, "2 comments: missing test for UC-04, naming"),
            new("build", "running", 8, "Fixing 2 review comments", 0.8),
            new("review-code", "running", 6, "Re-checking the changes"),
            new("review-security", "running", 9, "Checking tenant validation and token handling"),
            new("human", "waiting", 16, "Waiting for the product owner and security officer"),
            new("done", "done", 30, "Deployed to development"),
        ], true),
        new("Bug: date filter ignores the time zone", "bug", "teams", "small", 22,
        [
            new("spec", "running", 6, "Reproducing the bug, writing a failing test", 0.6),
            new("grill", "running", 5, "Checking other places with the same pattern"),
            new("size", "passed", 3, "Small: one fix"),
            new("build", "running", 8, "Fixing the filter and 3 similar places", 0.7),
            new("review-code", "running", 6, "Checking the fix"),
            new("review-security", "running", 6, "Checking the query parameters"),
            new("review-security", "changes", 4, "Query string reaches SQL unparameterized"),
            new("build", "running", 7, "Parameterizing the query", 0.9),
            new("review-security", "running", 5, "Re-checking"),
            new("human", "waiting", 12, "Waiting for the product owner"),
            new("done", "done", 30, "Deployed to development"),
        ], true),
    ];

    readonly DateTimeOffset _epoch = DateTimeOffset.UtcNow;
    readonly ConcurrentDictionary<string, List<(Script Script, DateTimeOffset Start)>> _added = new();
    static readonly Regex Title = new("^[^\\x00-\\x1F\\x7F-\\x9F]{3,120}\\z", RegexOptions.Compiled);

    public static string? CheckTitle(string? title) =>
        title is null || !Title.IsMatch(title) || title.Trim().Length < 3 ? "Use 3 to 120 characters, without line breaks." : null;

    /// <summary>Adds a simulated feature request from a tracker; it runs once through all stages.</summary>
    public bool Add(string slug, string title, string kind, string source)
    {
        var list = _added.GetOrAdd(slug, _ => []);
        lock (list)
        {
            if (list.Count >= 10) return false;
            list.Add((new Script(title.Trim(), kind, source, "small", 0, SmallFeature("the request"), false), DateTimeOffset.UtcNow));
            return true;
        }
    }

    public JsonObject Board(string slug, DateTimeOffset now)
    {
        var items = new JsonArray();
        var prefix = string.Concat(slug.Split('-').Select(p => char.ToUpperInvariant(p[0])));
        var n = 0;
        foreach (var s in Seeds) items.Add(Feature(s, _epoch.AddSeconds(s.Offset), now, prefix, ++n));
        if (_added.TryGetValue(slug, out var list))
            lock (list)
                foreach (var (s, start) in list) items.Add(Feature(s, start, now, prefix, ++n));
        return new JsonObject
        {
            ["simulated"] = true,
            ["stages"] = new JsonArray(Stages.Select(st => (JsonNode)new JsonObject
            {
                ["id"] = st.Id,
                ["title"] = st.Title,
                ["agent"] = st.Agent,
                ["model"] = st.Model,
                ["purpose"] = st.Purpose,
            }).ToArray()),
            ["features"] = items,
        };
    }

    static JsonObject Feature(Script s, DateTimeOffset start, DateTimeOffset now, string prefix, int n)
    {
        var total = s.Steps.Sum(x => x.Seconds);
        var elapsed = (now - start).TotalSeconds;
        if (s.Repeat && elapsed >= 0) elapsed %= total;
        var history = new JsonArray();
        Step? current = null;
        var at = 0.0;
        var loops = 0;
        if (elapsed >= 0)
            foreach (var step in s.Steps)
            {
                if (elapsed < at + step.Seconds || ReferenceEquals(step, s.Steps[^1])) { current = step; break; }
                if (step.Status == "changes") loops++;
                history.Add(new JsonObject { ["stage"] = step.Stage, ["status"] = step.Status, ["detail"] = step.Detail });
                at += step.Seconds;
            }
        var stage = Stages.First(x => x.Id == (current?.Stage ?? "spec"));
        var source = s.Source switch
        {
            "jira" => new JsonObject { ["kind"] = "jira", ["label"] = "Jira", ["key"] = $"{prefix}-{140 + n}" },
            "servicenow" => new JsonObject { ["kind"] = "servicenow", ["label"] = "ServiceNow", ["key"] = $"RITM00{41200 + n}" },
            _ => new JsonObject { ["kind"] = "teams", ["label"] = "Teams", ["key"] = $"Task {n}" },
        };
        var sized = history.Any(h => h?["stage"]?.GetValue<string>() == "size") || current is { Stage: "size", Status: "passed" } || current?.Stage is "build" or "review-code" or "review-security" or "human" or "done";
        return new JsonObject
        {
            ["id"] = $"f{n}",
            ["title"] = s.Title,
            ["kind"] = s.Kind,
            ["source"] = source,
            ["size"] = sized ? s.Size : null,
            ["stage"] = stage.Id,
            ["status"] = current is null ? "queued" : current.Status,
            ["agent"] = new JsonObject { ["name"] = stage.Agent, ["model"] = stage.Model },
            ["detail"] = current?.Detail ?? "Queued",
            ["progress"] = current?.Progress,
            ["loops"] = loops + (current?.Status == "changes" ? 1 : 0),
            ["history"] = history,
        };
    }
}
