using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Merlin.Api.Data;
using Merlin.Api.Features.Factory;
using Merlin.Api.Tests.Integration;

namespace Merlin.Api.Tests.Unit;

public sealed class RunServiceTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private static readonly FactoryOptions Options = new()
    {
        AllowedOwners = ["acme-factory"],
        Tenants = ["00000000-0000-0000-0000-000000000000"],
        Subscriptions = [new SubscriptionInfo { Id = "00000000-0000-0000-0000-000000000000", Name = "apps-development" }],
        Regions = ["westeurope"],
        DryRunStepDelayMs = 0,
    };
    private static RunService Service(IAppRegistry registry) => new(registry, Microsoft.Extensions.Options.Options.Create(Options), new FakeGitHub(), TimeProvider.System, NullLogger<RunService>.Instance);

    private static JsonObject Request(string slug)
    {
        var request = FactoryRequests.Valid(slug);
        request.Remove("billing");
        request["author"] = "Alex Example";
        return request;
    }

    [Fact]
    public async Task UC03_DryRunKeepsRealAppStatus()
    {
        var registry = new InMemoryAppRegistry();
        var at = DateTimeOffset.UtcNow;
        await registry.StartRunAsync(
            new RunEntity { Id = "real-run", AppSlug = "real-app", AppName = "RealApp", Mode = "Factory", Status = "succeeded", StartedAt = at, StartedByOid = "x" },
            new AppEntity { Slug = "real-app", Name = "RealApp", Status = "live", CreatedAt = at, UpdatedAt = at, RequestedByOid = "x", RequestedByName = "Someone", RequestJson = "{\"original\":true}" }, Ct);
        var service = Service(registry);
        var id = await service.StartDryRunAsync(Request("real-app"), "y", "Alex Example", Ct);
        while ((await registry.GetRunAsync(id, Ct))!.Status == "running") await Task.Delay(20, Ct);
        var app = await registry.GetAppAsync("real-app", Ct);
        Assert.Equal("live", app!.Status);
        Assert.Equal("{\"original\":true}", app.RequestJson);
        Assert.Equal("succeeded", (await registry.GetRunAsync(id, Ct))!.Status);
    }

    [Fact]
    public async Task UC03_RestartFailsRunningRuns()
    {
        var registry = new InMemoryAppRegistry();
        var at = DateTimeOffset.UtcNow;
        await registry.StartRunAsync(
            new RunEntity { Id = "interrupted", AppSlug = "some-app", AppName = "SomeApp", Mode = "DryRun", Status = "running", StartedAt = at, StartedByOid = "x" },
            new AppEntity { Slug = "some-app", Name = "SomeApp", Status = "simulated", CreatedAt = at, UpdatedAt = at, RequestedByOid = "x", RequestedByName = "Someone", RequestJson = "{}" }, Ct);
        await registry.AddEventAsync("interrupted", 0, "{\"type\":\"plan\"}", Ct);

        await Service(registry).StartAsync(Ct);

        Assert.Equal("failed", (await registry.GetRunAsync("interrupted", Ct))!.Status);
        var events = await registry.ListEventsAsync("interrupted", 0, Ct);
        Assert.Equal(2, events.Count);
        var last = JsonNode.Parse(events[^1])!;
        Assert.Equal("result", last["type"]!.GetValue<string>());
        Assert.Equal("failed", last["status"]!.GetValue<string>());
    }

    [Fact]
    public async Task UC08_RestartFailsAppOfInterruptedFactoryRun()
    {
        var registry = new InMemoryAppRegistry();
        var at = DateTimeOffset.UtcNow;
        await registry.StartRunAsync(
            new RunEntity { Id = "interrupted-factory", AppSlug = "new-app", AppName = "NewApp", Mode = "Factory", Status = "running", StartedAt = at, StartedByOid = "x" },
            new AppEntity { Slug = "new-app", Name = "NewApp", Status = "provisioning", CreatedAt = at, UpdatedAt = at, RequestedByOid = "x", RequestedByName = "Someone", RequestJson = "{}" }, Ct);

        await Service(registry).StartAsync(Ct);

        Assert.Equal("failed", (await registry.GetRunAsync("interrupted-factory", Ct))!.Status);
        Assert.Equal("failed", (await registry.GetAppAsync("new-app", Ct))!.Status);
    }
}
