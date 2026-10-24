using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Merlin.Api.Features.Factory;

namespace Merlin.Api.Tests.Integration;

// Each acceptance criterion of intent/003-template-repository/spec.md has a test named after its use case.
public sealed class FactoryRunTests : IClassFixture<GitHubFactoryHost>, IClassFixture<FactoryHost>
{
    private readonly GitHubFactoryHost _app;
    private readonly FactoryHost _withoutApp;
    public FactoryRunTests(GitHubFactoryHost app, FactoryHost withoutApp) => (_app, _withoutApp) = (app, withoutApp);
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Slug() => "app-" + Guid.NewGuid().ToString("N")[..8];
    private const string Template = "acme-factory/ai-template-dotnet";

    private static async Task<Dictionary<string, string[]>> Errors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>(Ct))!["errors"]!.AsObject()
            .ToDictionary(kv => kv.Key, kv => kv.Value!.AsArray().Select(m => m!.GetValue<string>()).ToArray());
    }

    private static Dictionary<string, JsonObject> LastStepEvents(List<JsonObject> events) =>
        events.Where(e => e["type"]!.GetValue<string>() == "step").GroupBy(e => e["id"]!.GetValue<string>()).ToDictionary(g => g.Key, g => g.Last());

    [Fact]
    public async Task UC08_FactoryModeAvailableOnlyWhenGitHubAppConfigured()
    {
        using var client = await _app.SignedIn();
        var info = await client.GetFromJsonAsync<JsonObject>("/api/info", Ct);
        var factory = info!["modes"]!.AsArray().Single(m => m!["id"]!.GetValue<string>() == "Factory")!;
        Assert.True(factory["available"]!.GetValue<bool>());
        var check = await client.GetFromJsonAsync<JsonObject>("/api/modes/Factory/check", Ct);
        Assert.True(check!["available"]!.GetValue<bool>());

        using var other = await _withoutApp.SignedIn();
        info = await other.GetFromJsonAsync<JsonObject>("/api/info", Ct);
        factory = info!["modes"]!.AsArray().Single(m => m!["id"]!.GetValue<string>() == "Factory")!;
        Assert.False(factory["available"]!.GetValue<bool>());
        Assert.Equal("The GitHub App is not configured.", factory["reason"]!.GetValue<string>());
        check = await other.GetFromJsonAsync<JsonObject>("/api/modes/Factory/check", Ct);
        Assert.False(check!["available"]!.GetValue<bool>());
        Assert.Equal("The GitHub App is not configured.", check["reason"]!.GetValue<string>());
        var slug = Slug();
        Assert.Contains("mode", (await Errors(await FactoryRuns.Post(other, FactoryRequests.Valid(slug), slug))).Keys);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong-slug")]
    public async Task UC08_FactoryRunNeedsSlugConfirmation(string? confirmation)
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        var errors = await Errors(await FactoryRuns.Post(client, FactoryRequests.Valid(slug), confirmation));
        Assert.Contains("confirmation", errors.Keys);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/apps/{slug}", Ct)).StatusCode);
        Assert.Empty(_app.GitHub.CallsFor(slug));
    }

    [Fact]
    public async Task UC08_FactoryRunGeneratesRepositoryFromTemplate()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug)));
        Assert.Equal(
            [$"exists acme-factory/{slug}", $"generate {Template} -> acme-factory/{slug}", $"topics acme-factory/{slug} project-factory"],
            _app.GitHub.CallsFor(slug));
    }

    [Fact]
    public async Task UC08_FactoryRunEventsSkipStepsNotAutomated()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        var runId = await FactoryRuns.Start(client, FactoryRequests.Valid(slug));
        var events = await FactoryRequests.ReadEvents(client, runId);

        Assert.Equal("plan", events[0]["type"]!.GetValue<string>());
        Assert.Equal("Factory", events[0]["mode"]!.GetValue<string>());
        var planned = events[0]["steps"]!.AsArray().Select(s => s!["id"]!.GetValue<string>()).ToArray();
        var steps = LastStepEvents(events);
        Assert.Equal(planned.Order(), steps.Keys.Order());
        foreach (var id in planned)
            Assert.Equal(id is "validate" or "prerequisites" or "repository" ? "succeeded" : "skipped", steps[id]["status"]!.GetValue<string>());
        Assert.Equal($"https://acme.ghe.com/acme-factory/{slug}", steps["repository"]["url"]!.GetValue<string>());
        var resources = events.Single(e => e["type"]!.GetValue<string>() == "resources");
        Assert.Equal($"https://acme.ghe.com/acme-factory/{slug}", resources["github"]!["url"]!.GetValue<string>());
        var result = events[^1];
        Assert.Equal("result", result["type"]!.GetValue<string>());
        Assert.Equal("succeeded", result["status"]!.GetValue<string>());
        Assert.Equal($"https://acme.ghe.com/acme-factory/{slug}", result["repoUrl"]!.GetValue<string>());

        var run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{runId}", Ct);
        Assert.Equal("Factory", run!["mode"]!.GetValue<string>());
        Assert.Equal("succeeded", run["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_FactoryRunLeavesAppRequestedWithRepository()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug)));
        var app = (await client.GetFromJsonAsync<JsonArray>("/api/apps", Ct))!.Single(a => a!["slug"]!.GetValue<string>() == slug)!;
        Assert.Equal("requested", app["status"]!.GetValue<string>());
        Assert.Equal($"https://acme.ghe.com/acme-factory/{slug}", app["resources"]!["github"]!["url"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_FactoryRunStopsWhenRepositoryExists()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        _app.GitHub.Existing[$"acme-factory/{slug}"] = true;
        var events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug)));

        var prerequisites = LastStepEvents(events)["prerequisites"];
        Assert.Equal("failed", prerequisites["status"]!.GetValue<string>());
        Assert.Contains($"acme-factory/{slug} exists already", prerequisites["detail"]!.GetValue<string>());
        Assert.DoesNotContain(_app.GitHub.CallsFor(slug), c => c.StartsWith("generate", StringComparison.Ordinal));
        Assert.Equal("failed", events[^1]["status"]!.GetValue<string>());
        Assert.Equal("failed", (await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}", Ct))!["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_FactoryRunFailsWhenAppNotInstalled()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        // Tests in one class run one after another, so no other run sees the owner as not installed.
        _app.GitHub.NotInstalled["acme-factory"] = true;
        List<JsonObject> events;
        try { events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug))); }
        finally { _app.GitHub.NotInstalled.TryRemove("acme-factory", out _); }

        var prerequisites = LastStepEvents(events)["prerequisites"];
        Assert.Equal("failed", prerequisites["status"]!.GetValue<string>());
        Assert.Equal("Merlin's GitHub App is not installed on acme-factory.", prerequisites["detail"]!.GetValue<string>());
        Assert.Empty(_app.GitHub.CallsFor(slug));
        Assert.Equal("failed", events[^1]["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_FactoryRunFailsWhenGitHubRejectsGenerate()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        _app.GitHub.GenerateFails[$"acme-factory/{slug}"] = new GitHubException(HttpStatusCode.UnprocessableEntity, "Repository creation failed.");
        var events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug)));

        var repository = LastStepEvents(events)["repository"];
        Assert.Equal("failed", repository["status"]!.GetValue<string>());
        Assert.Contains("Repository creation failed.", repository["detail"]!.GetValue<string>());
        Assert.Equal("failed", events[^1]["status"]!.GetValue<string>());
        Assert.Contains("Repository creation failed.", events[^1]["message"]!.GetValue<string>());
        Assert.Equal("failed", (await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}", Ct))!["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_FactoryRunEventsNeverContainToken()
    {
        using var client = await _app.SignedIn();
        var ok = Slug();
        var failing = Slug();
        _app.GitHub.GenerateFails[$"acme-factory/{failing}"] = new GitHubException(HttpStatusCode.Forbidden, "Resource not accessible by integration");
        var text = await client.GetStringAsync($"/api/runs/{await FactoryRuns.Start(client, FactoryRequests.Valid(ok))}/events", Ct)
            + await client.GetStringAsync($"/api/runs/{await FactoryRuns.Start(client, FactoryRequests.Valid(failing))}/events", Ct);

        Assert.Contains("event: end", text);
        Assert.DoesNotContain(FakeGitHub.Token, text);
        Assert.DoesNotContain("PRIVATE KEY", text);
        Assert.NotEmpty(_app.Logs.Messages);
        Assert.DoesNotContain(_app.Logs.Messages, m => m.Contains(FakeGitHub.Token, StringComparison.Ordinal) || m.Contains("PRIVATE KEY", StringComparison.Ordinal));
    }

    [Fact]
    public async Task UC08_InternalVisibilityIsSetAfterGenerate()
    {
        using var client = await _app.SignedIn(admin: true);
        var slug = Slug();
        var request = FactoryRequests.Valid(slug);
        request["github"]!["visibility"] = "internal";
        var events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, request));

        Assert.Equal("succeeded", events[^1]["status"]!.GetValue<string>());
        var calls = _app.GitHub.CallsFor(slug);
        Assert.Equal($"visibility acme-factory/{slug} internal", calls[^1]);
        Assert.True(Array.FindIndex(calls, c => c.StartsWith("generate", StringComparison.Ordinal)) < calls.Length - 1);
    }

    [Fact]
    public async Task UC08_NonAdminCannotRequestInternalVisibility()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        var request = FactoryRequests.Valid(slug);
        request["github"]!["visibility"] = "internal";
        Assert.Contains("request.github.visibility", (await Errors(await FactoryRuns.Post(client, request, slug))).Keys);
    }
}
