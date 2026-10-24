using System.Net.Http.Json;
using System.Text.Json.Nodes;

namespace Merlin.Api.Tests.Integration;

// UC-08 with a personal access token instead of the GitHub App (Factory:GitHub:Auth = Token).
public sealed class TokenRunTests : IClassFixture<TokenFactoryHost>, IClassFixture<EmptyTokenFactoryHost>
{
    private readonly TokenFactoryHost _app;
    private readonly EmptyTokenFactoryHost _withoutToken;
    public TokenRunTests(TokenFactoryHost app, EmptyTokenFactoryHost withoutToken) => (_app, _withoutToken) = (app, withoutToken);
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Slug() => "app-" + Guid.NewGuid().ToString("N")[..8];

    private static JsonObject Prerequisites(List<JsonObject> events) =>
        events.Last(e => e["type"]!.GetValue<string>() == "step" && e["id"]!.GetValue<string>() == "prerequisites");

    [Fact]
    public async Task UC08_TokenModeAvailableOnlyWhenTokenConfigured()
    {
        using var client = await _app.SignedIn();
        Assert.True((await client.GetFromJsonAsync<JsonObject>("/api/modes/Factory/check", Ct))!["available"]!.GetValue<bool>());

        using var other = await _withoutToken.SignedIn();
        var check = await other.GetFromJsonAsync<JsonObject>("/api/modes/Factory/check", Ct);
        Assert.False(check!["available"]!.GetValue<bool>());
        Assert.Equal("The GitHub token is not configured.", check["reason"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_TokenRunGeneratesRepositoryFromTemplate()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        var events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug)));

        Assert.Equal("succeeded", events[^1]["status"]!.GetValue<string>());
        Assert.Equal(
            [$"exists acme-factory/{slug}", $"generate acme-factory/ai-template-dotnet -> acme-factory/{slug}", $"topics acme-factory/{slug} project-factory"],
            _app.GitHub.CallsFor(slug));
        var prerequisites = Prerequisites(events);
        Assert.Equal("succeeded", prerequisites["status"]!.GetValue<string>());
        Assert.Equal("GET /user", prerequisites["commands"]![0]!.GetValue<string>());
        Assert.Equal("requested", (await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}", Ct))!["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_TokenRunFailsWhenTokenRejected()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        // Tests in one class run one after another, so no other run sees the token rejected.
        _app.GitHub.Rejected = true;
        List<JsonObject> events;
        try { events = await FactoryRequests.ReadEvents(client, await FactoryRuns.Start(client, FactoryRequests.Valid(slug))); }
        finally { _app.GitHub.Rejected = false; }

        var prerequisites = Prerequisites(events);
        Assert.Equal("failed", prerequisites["status"]!.GetValue<string>());
        Assert.StartsWith("GitHub rejected Merlin's token.", prerequisites["detail"]!.GetValue<string>());
        Assert.Empty(_app.GitHub.CallsFor(slug));
        Assert.Equal("failed", events[^1]["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_TokenRunEventsNeverContainToken()
    {
        using var client = await _app.SignedIn();
        var text = await client.GetStringAsync($"/api/runs/{await FactoryRuns.Start(client, FactoryRequests.Valid(Slug()))}/events", Ct);

        Assert.Contains("event: end", text);
        Assert.DoesNotContain(FakeGitHub.Token, text);
        Assert.DoesNotContain(_app.Logs.Messages, m => m.Contains(FakeGitHub.Token, StringComparison.Ordinal));
    }
}
