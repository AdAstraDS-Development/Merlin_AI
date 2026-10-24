using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Merlin.Api.Infrastructure.Auth;

namespace Merlin.Api.Tests.Integration;

public sealed class AppFactory : WebApplicationFactory<Program>
{
    private readonly string _state = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
    protected override void ConfigureWebHost(IWebHostBuilder builder) => builder.UseEnvironment("Testing")
        .UseSetting("Auth:TenantId", "")
        .UseSetting("Auth:ClientId", "")
        .UseSetting("Auth:ClientSecret", "")
        .UseSetting("Auth:PublicOrigin", "")
        .UseSetting("StateDirectory", _state);
    protected override void Dispose(bool disposing)
    {
        base.Dispose(disposing);
        if (disposing && Directory.Exists(_state)) Directory.Delete(_state, true);
    }
}
public sealed class AppTests : IClassFixture<AppFactory>
{
    private readonly AppFactory _app;
    public AppTests(AppFactory app) => _app = app;
    private static CancellationToken Ct => TestContext.Current.CancellationToken;
    private HttpClient Client() => _app.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
    [Theory]
    [InlineData("/health/live", HttpStatusCode.OK)]
    [InlineData("/api/config", HttpStatusCode.OK)]
    [InlineData("/api/me", HttpStatusCode.Unauthorized)]
    [InlineData("/api/auth/csrf", HttpStatusCode.Unauthorized)]
    [InlineData("/api/auth/login", HttpStatusCode.ServiceUnavailable)]
    [InlineData("/api/missing", HttpStatusCode.NotFound)]
    [InlineData("/app", HttpStatusCode.Redirect)]
    public async Task PublicAndProtectedBoundaries(string path, HttpStatusCode expected)
    {
        using var client = Client();
        Assert.Equal(expected, (await client.GetAsync(path, Ct)).StatusCode);
    }
    [Fact]
    public async Task AnonymousMutationIsRejected()
    {
        using var client = Client();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/private/ping", null, Ct)).StatusCode);
    }
    [Fact]
    public async Task ConfigurationDoesNotEnableLoginOrExposeCredentials()
    {
        using var client = Client();
        var text = await client.GetStringAsync("/api/config", Ct);
        Assert.Contains("\"loginEnabled\":false", text);
        Assert.DoesNotContain("clientSecret", text);
    }
    // Construct a real opaque cookie referencing a stored test ticket; production has no bypass scheme.
    private async Task Authenticate(HttpClient client)
    {
        var options = _app.Services.GetRequiredService<IOptionsMonitor<CookieAuthenticationOptions>>().Get(CookieAuthenticationDefaults.AuthenticationScheme);
        var properties = new AuthenticationProperties { ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) };
        var ticket = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimTypes.Name, "Test user"), new Claim(ClaimTypes.NameIdentifier, "test-user")], "test")), properties, CookieAuthenticationDefaults.AuthenticationScheme);
        var key = await _app.Services.GetRequiredService<FileTicketStore>().StoreAsync(ticket);
        var reference = new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity([new Claim("Microsoft.AspNetCore.Authentication.Cookies-SessionId", key)], CookieAuthenticationDefaults.AuthenticationScheme)), null, CookieAuthenticationDefaults.AuthenticationScheme);
        client.DefaultRequestHeaders.Add("Cookie", $"{options.Cookie.Name}={options.TicketDataFormat.Protect(reference)}");
    }
    [Fact]
    public async Task AuthenticatedMutationsRequireCsrfAndLogoutRevokesTicket()
    {
        using var client = Client();
        await Authenticate(client);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/me", Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/private/ping", null, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/auth/logout", null, Ct)).StatusCode);
        var response = await client.GetAsync("/api/auth/csrf", Ct);
        var token = await response.Content.ReadFromJsonAsync<Csrf>(Ct);
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", "invalid-token");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsync("/api/private/ping", null, Ct)).StatusCode);
        client.DefaultRequestHeaders.Remove("X-CSRF-TOKEN");
        client.DefaultRequestHeaders.Add("X-CSRF-TOKEN", token!.RequestToken);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/private/ping", null, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.PostAsync("/api/auth/logout", null, Ct)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/me", Ct)).StatusCode);
    }
    private sealed record Csrf(string RequestToken);
}
