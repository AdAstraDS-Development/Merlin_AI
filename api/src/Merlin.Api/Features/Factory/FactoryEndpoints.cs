using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Nodes;
using Merlin.Api.Data;
using Merlin.Api.Infrastructure.Auth;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.Extensions.Options;

namespace Merlin.Api.Features.Factory;

/// <summary>The factory API of intents 001 and 003 (UC-01 to UC-08): dry runs and Factory runs, every endpoint behind sign-in, every POST behind CSRF.</summary>
public static class FactoryEndpoints
{
    private const int MaxBodyBytes = 64 * 1024;
    private const string NotYet = "Not available in Merlin yet. Use a dry run.";
    private static readonly string[] Modes = ["DryRun", "Local", "Factory"];
    private static readonly string[] DemoNames = ["Fleet Portal", "Visitor Desk", "Spare Parts", "Shift Planner", "Track Works", "Lost And Found"];

    public static IServiceCollection AddFactory(this IServiceCollection services, IConfiguration configuration)
    {
        services.AddOptions<FactoryOptions>().Bind(configuration.GetSection("Factory")).ValidateDataAnnotations().ValidateOnStart();
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<FeatureBoard>();
        services.AddHttpClient<IGitHub, GitHubClient>(c => c.Timeout = TimeSpan.FromSeconds(30));
        services.AddSingleton<RunService>();
        services.AddHostedService(sp => sp.GetRequiredService<RunService>());
        return services;
    }

    public static WebApplication MapFactory(this WebApplication app)
    {
        var adminRole = app.Services.GetRequiredService<IOptions<FactoryOptions>>().Value.AdminRole;
        var api = app.MapGroup("/api").RequireAuthorization();

        api.MapGet("/info", (ClaimsPrincipal user, IOptions<FactoryOptions> o) =>
        {
            var cfg = o.Value;
            var admin = user.IsInRole(cfg.AdminRole);
            return Results.Json(new
            {
                githubHost = cfg.GithubHost,
                allowedOwners = cfg.AllowedOwners,
                tenants = cfg.Tenants,
                subscriptions = cfg.Subscriptions,
                regions = cfg.Regions,
                modes = Modes.Select(m => Mode(m, cfg)),
                defaults = new
                {
                    nameSuffix = NewSuffix(),
                    region = cfg.Regions.FirstOrDefault(),
                    tenantId = cfg.Tenants.FirstOrDefault(),
                    subscriptionId = cfg.Subscriptions.FirstOrDefault()?.Id,
                    owner = cfg.AllowedOwners.FirstOrDefault(),
                    visibility = "private",
                },
                isAdmin = admin,
                databases = cfg.Databases,
                demo = admin,
                billing = cfg.Billing,
                sharedState = cfg.SharedStateAccount.Length > 0,
            });
        });

        api.MapGet("/modes/{mode}/check", (string mode, IOptions<FactoryOptions> o) =>
            Modes.Contains(mode) ? Results.Json(new { available = Available(mode, o.Value), reason = Reason(mode, o.Value) })
                : Results.Problem(statusCode: 404, title: "Unknown run mode."));

        api.MapPost("/requests/preview", async (HttpContext ctx, IOptions<FactoryOptions> o, IAppRegistry registry) =>
        {
            var cfg = o.Value;
            if (await ReadJson(ctx) is not { } body) return Invalid(new() { [""] = ["The body must be valid JSON (at most 64 KB)."] });
            var v = RequestValidator.Validate(body, cfg, DisplayName(ctx.User));
            if (!v.Ok) return Invalid(v.Errors);
            if (RequestValidator.TargetLock(v.Request!, cfg, ctx.User.IsInRole(cfg.AdminRole)) is { } locked) return Invalid(locked);
            if (await SlugTaken(registry, v.Request!, ctx.RequestAborted) is { } taken) return Invalid(new() { ["appSlug"] = [taken] });
            return Results.Json(new
            {
                request = v.Request,
                fingerprint = RequestValidator.Fingerprint(v.Request!),
                names = Preview.Names(v.Request!, cfg),
                steps = Preview.StepList(v.Request!),
                cost = Costs.ForRequest(cfg, v.Request!),
            });
        }).RequireCsrf();

        api.MapPost("/runs", async (HttpContext ctx, IOptions<FactoryOptions> o, IAppRegistry registry, RunService runs) =>
        {
            var cfg = o.Value;
            if (await ReadJson(ctx) is not JsonObject body) return Invalid(new() { [""] = ["The body must be a JSON object with request, mode and confirmation."] });
            var mode = body["mode"] is JsonValue mv && mv.TryGetValue<string>(out var m) ? m : null;
            if (mode is not ("DryRun" or "Local" or "Factory")) return Invalid(new() { ["mode"] = ["Choose DryRun, Local or Factory."] });
            if (!Available(mode, cfg)) return Invalid(new() { ["mode"] = [Reason(mode, cfg)!] });
            var v = RequestValidator.Validate(body["request"], cfg, DisplayName(ctx.User));
            if (!v.Ok) return Invalid(v.Errors.ToDictionary(kv => "request" + (kv.Key.Length > 0 && kv.Key[0] != '[' ? "." : "") + kv.Key, kv => kv.Value));
            if (RequestValidator.TargetLock(v.Request!, cfg, ctx.User.IsInRole(cfg.AdminRole), "request.") is { } locked) return Invalid(locked);
            // A Factory run creates real things, so the person types the slug to confirm (UC-08).
            var slug = v.Request!["appSlug"]!.GetValue<string>();
            if (mode == "Factory" && !(body["confirmation"] is JsonValue cv && cv.TryGetValue<string>(out var typed) && typed == slug))
                return Invalid(new() { ["confirmation"] = [$"Type {slug} to confirm."] });
            if (await SlugTaken(registry, v.Request!, ctx.RequestAborted) is { } taken) return Invalid(new() { ["request.appSlug"] = [taken] });
            return await Start(runs, mode, v.Request!, ctx, slug: null);
        }).RequireCsrf();

        api.MapGet("/runs/{id}", async (string id, IAppRegistry registry, CancellationToken ct) =>
            await registry.GetRunAsync(id, ct) is { } run ? Results.Json(AppViews.RunSummary(run)) : RunNotFound());

        api.MapGet("/runs/{id}/events", async (string id, HttpContext ctx, IAppRegistry registry, RunService runs) =>
        {
            var ct = ctx.RequestAborted;
            if (await registry.GetRunAsync(id, ct) is null) return RunNotFound();
            var next = int.TryParse(ctx.Request.Query["from"], out var f) && f >= 0 ? f : 0;
            // A browser reconnecting after a dropped connection sends the id of the last event it received.
            if (int.TryParse(ctx.Request.Headers["Last-Event-ID"], out var last) && last >= 0) next = last + 1;
            ctx.Response.ContentType = "text/event-stream";
            ctx.Response.Headers["X-Accel-Buffering"] = "no";
            var keepAlive = Task.Delay(TimeSpan.FromSeconds(15), ct);
            try
            {
                while (true)
                {
                    string[] batch;
                    bool done;
                    Task changed;
                    if (runs.Live(id) is { } live) (batch, done, changed) = live.Read(next);
                    else
                    {
                        // Not in progress here: everything is stored. A run still marked running belongs to an interrupted start; poll it.
                        // Status first, then events: a run that finishes in between still delivers its last events.
                        done = (await registry.GetRunAsync(id, ct))?.Status != "running";
                        batch = [.. await registry.ListEventsAsync(id, next, ct)];
                        changed = Task.Delay(1000, ct);
                    }
                    foreach (var e in batch) await ctx.Response.WriteAsync($"id: {next++}\ndata: {e}\n\n", ct);
                    if (batch.Length > 0) { await ctx.Response.Body.FlushAsync(ct); continue; }
                    if (done)
                    {
                        await ctx.Response.WriteAsync("event: end\ndata: {}\n\n", ct);
                        await ctx.Response.Body.FlushAsync(ct);
                        return Results.Empty;
                    }
                    if (await Task.WhenAny(changed, keepAlive) == keepAlive)
                    {
                        await ctx.Response.WriteAsync(": keep-alive\n\n", ct);
                        await ctx.Response.Body.FlushAsync(ct);
                        keepAlive = Task.Delay(TimeSpan.FromSeconds(15), ct);
                    }
                }
            }
            catch (OperationCanceledException) { return Results.Empty; }
        });

        api.MapGet("/apps", async (IAppRegistry registry, IOptions<FactoryOptions> o, TimeProvider time, CancellationToken ct) =>
        {
            var now = time.GetUtcNow();
            var rows = new JsonArray();
            foreach (var a in await registry.ListAppsAsync(ct)) rows.Add(AppViews.Summary(a, await registry.GetLastCheckAsync(a.Slug, ct), o.Value, now));
            return Results.Json(rows);
        });

        api.MapGet("/apps/{slug}", async (string slug, IAppRegistry registry, IOptions<FactoryOptions> o, TimeProvider time, CancellationToken ct) =>
            await registry.GetAppAsync(slug, ct) is { } a
                ? Results.Json(AppViews.Detail(a, await registry.GetLastCheckAsync(slug, ct), await registry.ListRunsAsync(slug, ct), o.Value, time.GetUtcNow()))
                : AppNotFound());

        api.MapPost("/apps/{slug}/check", async (string slug, HttpContext ctx, IAppRegistry registry, IOptions<FactoryOptions> o, TimeProvider time) =>
        {
            var ct = ctx.RequestAborted;
            if (await registry.GetAppAsync(slug, ct) is not { } a) return AppNotFound();
            var mode = await ReadJson(ctx) is JsonObject body && body["mode"] is JsonValue mv && mv.TryGetValue<string>(out var m) ? m : null;
            if (mode == "Live") return Invalid(new() { ["mode"] = ["Live checks are not available yet."] });
            if (mode != "DryRun") return Invalid(new() { ["mode"] = ["Choose DryRun or Live."] });
            var now = time.GetUtcNow();
            var result = AppViews.DryRunCheck(a.Status, now);
            var check = new CheckEntity { AppSlug = slug, At = now, Overall = result["overall"]!.GetValue<string>(), Json = result.ToJsonString() };
            await registry.AddCheckAsync(check, ct);
            return Results.Json(AppViews.Detail(a, check, await registry.ListRunsAsync(slug, ct), o.Value, now));
        }).RequireCsrf();

        api.MapGet("/apps/{slug}/features", async (string slug, IAppRegistry registry, FeatureBoard board, TimeProvider time, CancellationToken ct) =>
            await registry.GetAppAsync(slug, ct) is null ? AppNotFound() : Results.Json(board.Board(slug, time.GetUtcNow())));

        api.MapPost("/apps/{slug}/features", async (string slug, HttpContext ctx, IAppRegistry registry, FeatureBoard board, TimeProvider time) =>
        {
            if (await registry.GetAppAsync(slug, ctx.RequestAborted) is null) return AppNotFound();
            if (await ReadJson(ctx) is not JsonObject o) return Invalid(new() { [""] = ["The body must be a JSON object with title, kind and source."] });
            var title = o["title"] is JsonValue tv && tv.TryGetValue<string>(out var t) ? t : null;
            var kind = o["kind"] is null ? "feature" : o["kind"] is JsonValue kv && kv.TryGetValue<string>(out var k) ? k : "";
            var source = o["source"] is null ? "jira" : o["source"] is JsonValue sv && sv.TryGetValue<string>(out var s) ? s : "";
            var errors = new Dictionary<string, string[]>();
            if (FeatureBoard.CheckTitle(title) is { } te) errors["title"] = [te];
            if (kind is not ("feature" or "bug")) errors["kind"] = ["Choose feature or bug."];
            if (source is not ("jira" or "servicenow" or "teams")) errors["source"] = ["Choose jira, servicenow or teams."];
            if (errors.Count > 0) return Invalid(errors);
            if (!board.Add(slug, title!, kind, source)) return Invalid(new() { ["title"] = ["At most 10 added requests per app in the simulation."] });
            return Results.Json(board.Board(slug, time.GetUtcNow()), statusCode: 201);
        }).RequireCsrf();

        // The sample simulation would mix sample apps into the shared inventory, so only platform admins may start it.
        api.MapPost("/demo", async (HttpContext ctx, IOptions<FactoryOptions> o, IAppRegistry registry, RunService runs) =>
        {
            var cfg = o.Value;
            var taken = (await registry.ListAppsAsync(ctx.RequestAborted)).Select(a => a.Slug).ToHashSet();
            var pick = DemoNames.Select(n => (Name: n, Slug: string.Join('-', n.ToLowerInvariant().Split(' ')))).FirstOrDefault(x => !taken.Contains(x.Slug));
            if (pick.Name is null) return Results.Problem(statusCode: 409, title: "All sample apps exist already.");
            var tier = cfg.Billing?.Tiers.FirstOrDefault(t => t.Id == "sandbox") ?? cfg.Billing?.Tiers.FirstOrDefault();
            var production = tier?.Production != false;
            var request = new JsonObject
            {
                ["appName"] = string.Concat(pick.Name.Split(' ')),
                ["appSlug"] = pick.Slug,
                ["problem"] = $"Sample app {pick.Name}, created by the simulation.",
                ["description"] = "## Today\nThe team works with spreadsheets and mail.\n\n## What they need to do\n- Record a new entry\n- See all open entries\n- Export the list",
                ["users"] = new JsonArray("Employees", "Team leads"),
                ["useCases"] = new JsonArray("Employee records a new entry", "Team lead reviews open entries"),
                ["azure"] = new JsonObject
                {
                    ["tenantId"] = cfg.Tenants.FirstOrDefault(),
                    ["subscriptionId"] = cfg.Subscriptions.FirstOrDefault()?.Id,
                    ["region"] = cfg.Regions.FirstOrDefault(),
                    ["nameSuffix"] = NewSuffix(),
                    ["environments"] = production ? new JsonArray("development", "production") : new JsonArray("development"),
                },
                ["github"] = new JsonObject
                {
                    ["owner"] = cfg.AllowedOwners.FirstOrDefault(),
                    ["repoName"] = pick.Slug,
                    ["visibility"] = "private",
                    ["productionReviewers"] = production ? new JsonArray("product-owner") : new JsonArray(),
                },
                ["options"] = new JsonObject { ["protectMain"] = true, ["runLocalValidation"] = false },
            };
            if (cfg.Billing is not null && tier is not null) request["billing"] = new JsonObject { ["costCenter"] = cfg.Billing.CostCenters.FirstOrDefault()?.Id ?? "CC-4711", ["tier"] = tier.Id };
            var v = RequestValidator.Validate(request, cfg, DisplayName(ctx.User));
            if (!v.Ok) return Invalid(v.Errors);
            return await Start(runs, "DryRun", v.Request!, ctx, pick.Slug);
        }).RequireAuthorization(p => p.RequireRole(adminRole)).RequireCsrf();

        return app;
    }

    private static async Task<IResult> Start(RunService runs, string mode, JsonObject request, HttpContext ctx, string? slug)
    {
        try
        {
            var id = await runs.StartRunAsync(mode, request, UserId(ctx.User), DisplayName(ctx.User), ctx.RequestAborted);
            return Results.Json(slug is null ? new { runId = id } : (object)new { runId = id, slug }, statusCode: 202);
        }
        catch (RunConflictException ex)
        {
            return Results.Problem(statusCode: 409, title: "Run already in progress", detail: ex.Message);
        }
    }

    /// <summary>A run never replaces an app that was really created (or is being created).</summary>
    private static async Task<string?> SlugTaken(IAppRegistry registry, JsonObject request, CancellationToken ct)
    {
        var slug = request["appSlug"]!.GetValue<string>();
        return await registry.GetAppAsync(slug, ct) is { Status: not "simulated" } ? $"An app named {slug} exists already." : null;
    }

    private static Dictionary<string, object?> Mode(string id, FactoryOptions cfg) => new()
    {
        ["id"] = id,
        ["available"] = Available(id, cfg),
        ["reason"] = Reason(id, cfg),
        ["needsCheck"] = false,
    };

    /// <summary>Dry runs always; Factory runs once the GitHub App or token is configured; Local runs never (they need a person's own az and gh sign-in).</summary>
    private static bool Available(string mode, FactoryOptions cfg) => mode == "DryRun" || (mode == "Factory" && cfg.GitHub.Configured);

    private static string? Reason(string mode, FactoryOptions cfg) => Available(mode, cfg) ? null : mode == "Factory" ? cfg.GitHub.NotConfiguredReason : NotYet;

    private static async Task<JsonNode?> ReadJson(HttpContext ctx)
    {
        if (ctx.Features.Get<IHttpMaxRequestBodySizeFeature>() is { IsReadOnly: false } limit) limit.MaxRequestBodySize = MaxBodyBytes;
        if (ctx.Request.ContentLength > MaxBodyBytes) return null;
        try
        {
            var node = await ctx.Request.ReadFromJsonAsync<JsonNode>(ctx.RequestAborted);
            Materialize(node);
            return node;
        }
        // ArgumentException: duplicate property names, which JsonNode only detects when an object is first read.
        catch (Exception ex) when (ex is JsonException or BadHttpRequestException or InvalidOperationException or ArgumentException) { return null; }
    }

    private static void Materialize(JsonNode? node)
    {
        if (node is JsonObject o) foreach (var kv in o) Materialize(kv.Value);
        else if (node is JsonArray a) foreach (var item in a) Materialize(item);
    }

    private static IResult Invalid(Dictionary<string, string[]> errors) => Results.ValidationProblem(errors, title: "The request is not valid.");
    private static IResult AppNotFound() => Results.Problem(statusCode: 404, title: "App not found.");
    private static IResult RunNotFound() => Results.Problem(statusCode: 404, title: "Run not found.");

    private static string NewSuffix()
    {
        const string chars = "abcdefghijklmnopqrstuvwxyz0123456789";
        return string.Concat(Enumerable.Range(0, 4).Select(_ => chars[RandomNumberGenerator.GetInt32(chars.Length)]));
    }

    private static string DisplayName(ClaimsPrincipal user) => user.Identity?.Name is { Length: > 0 } n ? (n.Length > 200 ? n[..200] : n) : "Signed-in user";

    /// <summary>The Entra object ID (<c>oid</c>), which identifies a person across sign-ins; never taken from the request.</summary>
    private static string UserId(ClaimsPrincipal user) =>
        user.FindFirst("oid")?.Value ?? user.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? user.FindFirst("sub")?.Value ?? "unknown";
}
