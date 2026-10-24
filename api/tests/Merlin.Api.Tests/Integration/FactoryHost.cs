using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Merlin.Api.Infrastructure.Auth;

namespace Merlin.Api.Tests.Integration;

/// <summary>The app with the in-memory registry and no pause between dry-run steps.</summary>
public class FactoryHost : WebApplicationFactory<Program>
{
    private readonly string _state = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    protected virtual int StepDelayMs => 0;
    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Testing")
        .UseSetting("Auth:TenantId", "")
        .UseSetting("Auth:ClientId", "")
        .UseSetting("Auth:ClientSecret", "")
        .UseSetting("Auth:PublicOrigin", "")
        .UseSetting("StateDirectory", _state)
        .UseSetting("Factory:DryRunStepDelayMs", StepDelayMs.ToString());
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(_state)) Directory.Delete(_state, true);
    }

    public HttpClient Anonymous() => CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });

    /// <summary>A client with a real server-side session for the given user (claims as Entra issues them) and a CSRF token.</summary>
    public async Task<HttpClient> SignedIn(string name = "Alex Example", string oid = "11111111-1111-1111-1111-111111111111", bool admin = false)
    {
        var client = Anonymous();
        var options = Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(CookieAuthenticationDefaults.AuthenticationScheme);
        List<Claim> claims = [new("name", name), new("oid", oid)];
        if (admin) claims.Add(new("roles", "Factory.Admin"));
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, "test", "name", "roles")),
            new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) }, CookieAuthenticationDefaults.AuthenticationScheme);
        var key = await Services.GetRequiredService<FileTicketStore>().StoreAsync(ticket);
        var reference = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim("Microsoft.AspNetCore.Authentication.Cookies-SessionId", key)], CookieAuthenticationDefaults.AuthenticationScheme)), null, CookieAuthenticationDefaults.AuthenticationScheme);
        client.DefaultRequestHeaders.Add("Cookie", $"{options.Cookie.Name}={options.TicketDataFormat.Protect(reference)}");
        var csrf = await client.GetFromJsonAsync<JsonObject>("/api/auth/csrf", TestContext.Current.CancellationToken);
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", csrf!["requestToken"]!.GetValue<string>());
        return client;
    }
}

/// <summary>Dry runs that take long enough to still be running during a test.</summary>
public sealed class SlowFactoryHost : FactoryHost
{
    protected override int StepDelayMs => 2000;
}

public static class FactoryRequests
{
    /// <summary>A valid request with the platform defaults, which every signed-in user may submit.</summary>
    public static JsonObject Valid(string slug = "fleet-portal", bool production = false) => new()
    {
        ["appName"] = string.Concat(slug.Split('-').Select(p => char.ToUpperInvariant(p[0]) + p[1..])),
        ["appSlug"] = slug,
        ["problem"] = "Dispatchers track vehicle assignments in spreadsheets.",
        ["users"] = new JsonArray("Dispatchers"),
        ["useCases"] = new JsonArray("Dispatcher assigns a vehicle to a trip"),
        ["billing"] = new JsonObject { ["costCenter"] = "CC-4711", ["tier"] = production ? "standard" : "sandbox" },
        ["azure"] = new JsonObject
        {
            ["tenantId"] = "00000000-0000-0000-0000-000000000000",
            ["subscriptionId"] = "00000000-0000-0000-0000-000000000000",
            ["region"] = "westeurope",
            ["nameSuffix"] = "ab12",
            ["environments"] = production ? new JsonArray("development", "production") : new JsonArray("development"),
        },
        ["github"] = new JsonObject
        {
            ["owner"] = "acme-factory",
            ["repoName"] = slug,
            ["visibility"] = "private",
            ["productionReviewers"] = production ? new JsonArray("octocat") : new JsonArray(),
        },
        ["options"] = new JsonObject { ["protectMain"] = true, ["runLocalValidation"] = false, ["database"] = "none" },
    };

    public static async Task<string> StartDryRun(HttpClient client, JsonObject request)
    {
        var response = await client.PostAsJsonAsync("/api/runs", new JsonObject { ["request"] = request, ["mode"] = "DryRun", ["confirmation"] = "" }, TestContext.Current.CancellationToken);
        Assert.Equal(System.Net.HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>(TestContext.Current.CancellationToken))!["runId"]!.GetValue<string>();
    }

    /// <summary>Reads the event stream of a run from <paramref name="from"/> until its end event.</summary>
    public static async Task<List<JsonObject>> ReadEvents(HttpClient client, string runId, int from = 0)
    {
        var text = await client.GetStringAsync($"/api/runs/{runId}/events?from={from}", TestContext.Current.CancellationToken);
        Assert.Contains("event: end", text);
        return [.. text.Split("\n").Where(l => l.StartsWith("data: {\"type\"", StringComparison.Ordinal)).Select(l => JsonNode.Parse(l["data: ".Length..])!.AsObject())];
    }
}
