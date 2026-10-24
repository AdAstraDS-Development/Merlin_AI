using System.Net;
using System.Net.Http.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Merlin.Api.Data;
using Merlin.Api.Features.Factory;

namespace Merlin.Api.Tests.Integration;

// Each acceptance criterion of intent/001-factory-backend/spec.md has a test named after its use case.
public sealed class FactoryTests : IClassFixture<FactoryHost>
{
    private readonly FactoryHost _app;
    public FactoryTests(FactoryHost app) => _app = app;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static string Slug() => "app-" + Guid.NewGuid().ToString("N")[..8];

    private static async Task<JsonObject> Json(HttpResponseMessage response) => (await response.Content.ReadFromJsonAsync<JsonObject>(Ct))!;
    private static async Task<Dictionary<string, string[]>> Errors(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        return (await Json(response))["errors"]!.AsObject().ToDictionary(kv => kv.Key, kv => kv.Value!.AsArray().Select(m => m!.GetValue<string>()).ToArray());
    }
    private static Task<HttpResponseMessage> Preview(HttpClient client, JsonObject request) => client.PostAsJsonAsync("/api/requests/preview", request, Ct);

    // ---- UC-01 configuration

    [Fact]
    public async Task UC01_InfoListsAllowlistsAndModes()
    {
        using var client = await _app.SignedIn();
        var info = await client.GetFromJsonAsync<JsonObject>("/api/info", Ct);
        Assert.Equal("acme-factory", info!["allowedOwners"]![0]!.GetValue<string>());
        Assert.NotEmpty(info["tenants"]!.AsArray());
        Assert.NotEmpty(info["subscriptions"]!.AsArray());
        Assert.Contains("westeurope", info["regions"]!.AsArray().Select(r => r!.GetValue<string>()));
        Assert.Equal(3, info["billing"]!["tiers"]!.AsArray().Count);
        Assert.Matches("^[a-z0-9]{4}$", info["defaults"]!["nameSuffix"]!.GetValue<string>());
        var modes = info["modes"]!.AsArray().ToDictionary(m => m!["id"]!.GetValue<string>(), m => m!.AsObject());
        Assert.True(modes["DryRun"]["available"]!.GetValue<bool>());
        foreach (var id in new[] { "Local", "Factory" })
        {
            Assert.False(modes[id]["available"]!.GetValue<bool>());
            Assert.False(string.IsNullOrWhiteSpace(modes[id]["reason"]!.GetValue<string>()));
        }
    }

    [Fact]
    public async Task UC01_InfoMarksAdmin()
    {
        using var user = await _app.SignedIn();
        var info = await user.GetFromJsonAsync<JsonObject>("/api/info", Ct);
        Assert.False(info!["isAdmin"]!.GetValue<bool>());
        Assert.False(info["demo"]!.GetValue<bool>());
        using var admin = await _app.SignedIn(admin: true);
        info = await admin.GetFromJsonAsync<JsonObject>("/api/info", Ct);
        Assert.True(info!["isAdmin"]!.GetValue<bool>());
        Assert.True(info["demo"]!.GetValue<bool>());
    }

    [Theory]
    [InlineData("GET", "/api/info")]
    [InlineData("GET", "/api/modes/DryRun/check")]
    [InlineData("POST", "/api/requests/preview")]
    [InlineData("POST", "/api/runs")]
    [InlineData("GET", "/api/runs/x")]
    [InlineData("GET", "/api/runs/x/events")]
    [InlineData("GET", "/api/apps")]
    [InlineData("GET", "/api/apps/x")]
    [InlineData("POST", "/api/apps/x/check")]
    [InlineData("GET", "/api/apps/x/features")]
    [InlineData("POST", "/api/apps/x/features")]
    [InlineData("POST", "/api/demo")]
    public async Task UC01_InfoRequiresSignIn(string method, string path)
    {
        using var client = _app.Anonymous();
        var response = await client.SendAsync(new HttpRequestMessage(new HttpMethod(method), path) { Content = method == "POST" ? JsonContent.Create(new { }) : null }, Ct);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task UC01_UnknownModeIsNotFound()
    {
        using var client = await _app.SignedIn();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/modes/Bogus/check", Ct)).StatusCode);
        var factory = await client.GetFromJsonAsync<JsonObject>("/api/modes/Factory/check", Ct);
        Assert.False(factory!["available"]!.GetValue<bool>());
    }

    // ---- UC-02 validate and preview

    [Fact]
    public async Task UC02_PreviewMatchesEngineNames()
    {
        var vector = JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "testdata", "names", "fleet-portal.json")))!;
        var engine = vector["names"]!;
        var cfg = _app.Services.GetRequiredService<IOptions<FactoryOptions>>().Value;
        var v = RequestValidator.Validate(vector["request"]!.DeepClone(), cfg, "Alex Example");
        Assert.True(v.Ok, string.Join(" ", v.Errors.Select(e => $"{e.Key}: {string.Join(' ', e.Value)}")));
        var names = Features.Factory.Preview.Names(v.Request!, cfg);
        static string[] Strings(JsonNode? a) => [.. a!.AsArray().Select(x => x!.GetValue<string>())];
        var groups = names["resourceGroups"]!.AsArray();
        Assert.Equal(engine["sharedResourceGroup"]!.GetValue<string>(), groups.Single(g => g!["role"]!.GetValue<string>() == "shared")!["name"]!.GetValue<string>());
        Assert.Equal(Strings(engine["environmentResourceGroups"]), groups.Where(g => g!["role"]!.GetValue<string>() != "shared").Select(g => g!["name"]!.GetValue<string>()));
        Assert.Equal(Strings(engine["webApps"]), names["webApps"]!.AsArray().Select(w => w!["name"]!.GetValue<string>()));
        Assert.Equal(engine["stateResourceGroup"]!.GetValue<string>(), names["stateStorage"]!["resourceGroup"]!.GetValue<string>());
        Assert.Equal(engine["stateStorageAccount"]!.GetValue<string>(), names["stateStorage"]!["storageAccount"]!.GetValue<string>());
        Assert.Equal(engine["stateContainer"]!.GetValue<string>(), names["stateStorage"]!["container"]!.GetValue<string>());
        Assert.Equal(Strings(engine["identities"]), names["identities"]!.AsArray().Select(i => i!["name"]!.GetValue<string>()));

        using var client = await _app.SignedIn();
        var response = await Preview(client, FactoryRequests.Valid(Slug()));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var preview = await Json(response);
        Assert.Matches("^[0-9a-f]{64}$", preview["fingerprint"]!.GetValue<string>());
        Assert.NotEmpty(preview["steps"]!.AsArray());
        var request = preview["request"]!.AsObject();
        Assert.True(JsonNode.DeepEquals(Features.Factory.Preview.Names(request, cfg), preview["names"]), "The endpoint returns the names derived from the normalized request.");
        Assert.Equal(RequestValidator.Fingerprint(request), preview["fingerprint"]!.GetValue<string>());
        Assert.NotNull(preview["cost"]);
        Assert.Equal("Alex Example", preview["request"]!["author"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC02_RejectsInvalidSlug()
    {
        using var client = await _app.SignedIn();
        var request = FactoryRequests.Valid();
        request["appSlug"] = "A";
        Assert.Contains("appSlug", (await Errors(await Preview(client, request))).Keys);
    }

    [Fact]
    public async Task UC02_RejectsDuplicatePropertiesAsInvalid()
    {
        using var client = await _app.SignedIn();
        var body = FactoryRequests.Valid(Slug()).ToJsonString().Replace("\"region\":\"westeurope\"", "\"region\":\"westeurope\",\"region\":\"northeurope\"");
        var response = await client.PostAsync("/api/requests/preview", new StringContent(body, System.Text.Encoding.UTF8, "application/json"), Ct);
        Assert.Contains("", (await Errors(response)).Keys);
    }

    [Fact]
    public async Task UC02_ProductionNeedsReviewer()
    {
        using var client = await _app.SignedIn();
        var request = FactoryRequests.Valid(Slug(), production: true);
        request["github"]!["productionReviewers"] = new JsonArray();
        Assert.Contains("github.productionReviewers", (await Errors(await Preview(client, request))).Keys);
    }

    [Fact]
    public async Task UC02_TierWithoutProductionRejected()
    {
        using var client = await _app.SignedIn();
        var request = FactoryRequests.Valid(Slug(), production: true);
        request["billing"]!["tier"] = "sandbox";
        Assert.Contains("azure.environments", (await Errors(await Preview(client, request))).Keys);
    }

    [Fact]
    public async Task UC02_NonAdminCannotChangeRegion()
    {
        var request = FactoryRequests.Valid(Slug());
        request["azure"]!["region"] = "northeurope";
        using var user = await _app.SignedIn();
        Assert.Contains("azure.region", (await Errors(await Preview(user, request))).Keys);
        using var admin = await _app.SignedIn(admin: true);
        Assert.Equal(HttpStatusCode.OK, (await Preview(admin, request)).StatusCode);
    }

    [Fact]
    public async Task UC02_RealAppSlugIsTaken()
    {
        var slug = Slug();
        var at = DateTimeOffset.UtcNow;
        await _app.Services.GetRequiredService<IAppRegistry>().StartRunAsync(
            new RunEntity { Id = "seed-" + slug, AppSlug = slug, AppName = "Seed", Mode = "Factory", Status = "succeeded", StartedAt = at, StartedByOid = "x" },
            new AppEntity { Slug = slug, Name = "Seed", Status = "live", CreatedAt = at, UpdatedAt = at, RequestedByOid = "x", RequestedByName = "Someone", RequestJson = FactoryRequests.Valid(slug).ToJsonString() }, Ct);
        using var client = await _app.SignedIn();
        Assert.Contains("appSlug", (await Errors(await Preview(client, FactoryRequests.Valid(slug)))).Keys);
    }

    [Fact]
    public async Task UC02_PreviewRequiresCsrf()
    {
        using var client = await _app.SignedIn();
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        var slug = Slug();
        var response = await Preview(client, FactoryRequests.Valid(slug));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal("CSRF validation failed.", (await Json(response))["title"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/runs", new JsonObject { ["request"] = FactoryRequests.Valid(slug), ["mode"] = "DryRun" }, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/apps/{slug}", Ct)).StatusCode);
    }

    // ---- UC-03 dry runs

    [Fact]
    public async Task UC03_StartsDryRun()
    {
        using var client = await _app.SignedIn();
        var id = await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(Slug()));
        var run = await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}", Ct);
        Assert.Equal("DryRun", run!["mode"]!.GetValue<string>());
        Assert.Contains(run["status"]!.GetValue<string>(), new[] { "running", "succeeded" });
    }

    [Fact]
    public async Task UC03_EventsReplayInOrder()
    {
        using var client = await _app.SignedIn();
        var id = await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(Slug()));
        var events = await FactoryRequests.ReadEvents(client, id);
        Assert.Equal("plan", events[0]["type"]!.GetValue<string>());
        var planned = events[0]["steps"]!.AsArray().Select(s => s!["id"]!.GetValue<string>()).ToArray();
        var succeeded = events.Where(e => e["type"]!.GetValue<string>() == "step" && e["status"]!.GetValue<string>() == "succeeded").Select(e => e["id"]!.GetValue<string>());
        Assert.Equal(planned, succeeded);
        Assert.Equal("result", events[^1]["type"]!.GetValue<string>());
        Assert.Equal("succeeded", events[^1]["status"]!.GetValue<string>());
        var again = await FactoryRequests.ReadEvents(client, id);
        Assert.Equal(events.Select(e => e.ToJsonString()), again.Select(e => e.ToJsonString()));
        Assert.Equal(events.Skip(3).Select(e => e.ToJsonString()), (await FactoryRequests.ReadEvents(client, id, from: 3)).Select(e => e.ToJsonString()));
        Assert.Equal("succeeded", (await client.GetFromJsonAsync<JsonObject>($"/api/runs/{id}", Ct))!["status"]!.GetValue<string>());
        // A reconnecting browser sends the id of the last event it received and gets only the ones after it.
        using var resume = new HttpRequestMessage(HttpMethod.Get, $"/api/runs/{id}/events?from=0");
        resume.Headers.Add("Last-Event-ID", "4");
        var resumed = await (await client.SendAsync(resume, Ct)).Content.ReadAsStringAsync(Ct);
        Assert.StartsWith("id: 5\n", resumed);
    }

    [Fact]
    public async Task UC03_FactoryModeRejected()
    {
        using var client = await _app.SignedIn();
        var slug = Slug();
        var response = await client.PostAsJsonAsync("/api/runs", new JsonObject { ["request"] = FactoryRequests.Valid(slug), ["mode"] = "Factory", ["confirmation"] = slug }, Ct);
        Assert.Contains("mode", (await Errors(response)).Keys);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync($"/api/apps/{slug}", Ct)).StatusCode);
    }

    [Fact]
    public async Task UC03_UnknownRunIsNotFound()
    {
        using var client = await _app.SignedIn();
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/runs/missing", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/runs/missing/events", Ct)).StatusCode);
    }

    // ---- UC-04 inventory

    [Fact]
    public async Task UC04_InventoryIsShared()
    {
        var slug = Slug();
        using var a = await _app.SignedIn("Alex Example", "11111111-1111-1111-1111-111111111111");
        await FactoryRequests.ReadEvents(a, await FactoryRequests.StartDryRun(a, FactoryRequests.Valid(slug)));
        using var b = await _app.SignedIn("Bo Example", "22222222-2222-2222-2222-222222222222");
        var apps = await b.GetFromJsonAsync<JsonArray>("/api/apps", Ct);
        var app = apps!.Single(x => x!["slug"]!.GetValue<string>() == slug)!;
        Assert.Equal("Alex Example", app["requestedBy"]!.GetValue<string>());
        Assert.Equal("simulated", app["status"]!.GetValue<string>());
        Assert.NotNull(app["cost"]);
        Assert.Equal($"https://acme.ghe.com/acme-factory/{slug}", app["repoUrl"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC04_UnknownAppIsNotFound()
    {
        using var client = await _app.SignedIn();
        var response = await client.GetAsync("/api/apps/no-such-app", Ct);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
    }

    [Fact]
    public async Task UC04_DetailListsRunsNewestFirst()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        var first = await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug));
        await FactoryRequests.ReadEvents(client, first);
        var second = await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug));
        await FactoryRequests.ReadEvents(client, second);
        var detail = await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}", Ct);
        Assert.Equal([second, first], detail!["runs"]!.AsArray().Select(r => r!["id"]!.GetValue<string>()));
    }

    // ---- UC-05 status checks

    [Fact]
    public async Task UC05_DryRunCheckStoresResult()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        await FactoryRequests.ReadEvents(client, await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug)));
        var response = await client.PostAsJsonAsync($"/api/apps/{slug}/check", new { mode = "DryRun" }, Ct);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var detail = await Json(response);
        Assert.NotEmpty(detail["check"]!["checks"]!.AsArray());
        Assert.NotNull(detail["lastCheck"]!["at"]);
        Assert.Equal("simulated", detail["status"]!.GetValue<string>());
        var again = await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}", Ct);
        Assert.Equal(detail["lastCheck"]!["at"]!.GetValue<string>(), again!["lastCheck"]!["at"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC05_LiveCheckRejected()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        await FactoryRequests.ReadEvents(client, await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug)));
        var response = await client.PostAsJsonAsync($"/api/apps/{slug}/check", new { mode = "Live", confirm = true }, Ct);
        Assert.Contains("mode", (await Errors(response)).Keys);
        Assert.Equal(HttpStatusCode.NotFound, (await client.PostAsJsonAsync("/api/apps/no-such-app/check", new { mode = "DryRun" }, Ct)).StatusCode);
    }

    // ---- UC-06 feature board

    [Fact]
    public async Task UC06_BoardHasStages()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        await FactoryRequests.ReadEvents(client, await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug)));
        var board = await client.GetFromJsonAsync<JsonObject>($"/api/apps/{slug}/features", Ct);
        Assert.Equal(8, board!["stages"]!.AsArray().Count);
        Assert.True(board["simulated"]!.GetValue<bool>());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/apps/no-such-app/features", Ct)).StatusCode);
    }

    [Fact]
    public async Task UC06_AddsFeature()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        await FactoryRequests.ReadEvents(client, await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug)));
        var response = await client.PostAsJsonAsync($"/api/apps/{slug}/features", new { title = "Export to Excel", kind = "feature", source = "teams" }, Ct);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Contains("Export to Excel", (await Json(response))["features"]!.AsArray().Select(f => f!["title"]!.GetValue<string>()));
    }

    [Fact]
    public async Task UC06_RejectsShortTitle()
    {
        var slug = Slug();
        using var client = await _app.SignedIn();
        await FactoryRequests.ReadEvents(client, await FactoryRequests.StartDryRun(client, FactoryRequests.Valid(slug)));
        var response = await client.PostAsJsonAsync($"/api/apps/{slug}/features", new { title = "Ab", kind = "feature", source = "jira" }, Ct);
        Assert.Contains("title", (await Errors(response)).Keys);
    }

    // ---- UC-07 admin

    [Fact]
    public async Task UC07_AdminStartsDemo()
    {
        using var admin = await _app.SignedIn(admin: true);
        var response = await admin.PostAsJsonAsync("/api/demo", new { }, Ct);
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        var body = await Json(response);
        var events = await FactoryRequests.ReadEvents(admin, body["runId"]!.GetValue<string>());
        Assert.Equal("succeeded", events[^1]["status"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.OK, (await admin.GetAsync($"/api/apps/{body["slug"]!.GetValue<string>()}", Ct)).StatusCode);
    }

    [Fact]
    public async Task UC07_NonAdminDemoForbidden()
    {
        using var user = await _app.SignedIn();
        Assert.Equal(HttpStatusCode.Forbidden, (await user.PostAsJsonAsync("/api/demo", new { }, Ct)).StatusCode);
    }
}

public sealed class SlowRunTests : IClassFixture<SlowFactoryHost>
{
    private readonly SlowFactoryHost _app;
    public SlowRunTests(SlowFactoryHost app) => _app = app;

    [Fact]
    public async Task UC03_OneRunPerSlug()
    {
        using var client = await _app.SignedIn();
        var request = FactoryRequests.Valid("one-run-per-slug");
        await FactoryRequests.StartDryRun(client, request);
        var response = await client.PostAsJsonAsync("/api/runs", new JsonObject { ["request"] = request.DeepClone(), ["mode"] = "DryRun" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }
}
