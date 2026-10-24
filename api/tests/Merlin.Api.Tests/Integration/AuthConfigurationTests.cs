using System.Net;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;

namespace Merlin.Api.Tests.Integration;

public sealed class AuthConfigurationTests
{
    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void PartialOrInsecureConfigurationFailsClosed(bool insecureOrigin)
    {
        using var app = CreateApp(insecureOrigin ? "http://localhost" : "https://localhost", insecureOrigin ? "test-only-secret" : "");
        Assert.Throws<InvalidOperationException>(() => app.CreateClient());
    }

    [Fact]
    public async Task ConfiguredLoginUsesCodePkceAndFixedCallback()
    {
        using var app = CreateApp("https://localhost", "test-only-secret");
        using var client = app.CreateClient(new WebApplicationFactoryClientOptions { BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false });
        var response = await client.GetAsync("/api/auth/login?returnUrl=https://untrusted.example", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Redirect, response.StatusCode);
        var redirect = response.Headers.Location!.AbsoluteUri;
        Assert.StartsWith("https://login.microsoftonline.com/", redirect);
        Assert.Contains("response_type=code", redirect);
        Assert.Contains("code_challenge_method=S256", redirect);
        Assert.Contains("redirect_uri=https%3A%2F%2Flocalhost%2Fapi%2Fauth%2Fcallback", redirect);
        Assert.DoesNotContain("untrusted.example", redirect);
        Assert.All(response.Headers.GetValues("Set-Cookie"), cookie =>
        {
            Assert.Contains("secure", cookie, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        });
    }

    private static ConfiguredFactory CreateApp(string origin, string secret) => new(origin, secret);

    private sealed class ConfiguredFactory(string origin, string secret) : WebApplicationFactory<Program>
    {
        private readonly string _state = Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N"));
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing")
                .UseSetting("Auth:TenantId", "11111111-1111-1111-1111-111111111111")
                .UseSetting("Auth:ClientId", "22222222-2222-2222-2222-222222222222")
                .UseSetting("Auth:ClientSecret", secret)
                .UseSetting("Auth:PublicOrigin", origin)
                .UseSetting("StateDirectory", _state);
            builder.ConfigureServices(services => services.PostConfigure<OpenIdConnectOptions>(OpenIdConnectDefaults.AuthenticationScheme, options =>
                options.ConfigurationManager = new StaticConfigurationManager<OpenIdConnectConfiguration>(new OpenIdConnectConfiguration
                {
                    AuthorizationEndpoint = "https://login.microsoftonline.com/11111111-1111-1111-1111-111111111111/oauth2/v2.0/authorize"
                })));
        }
        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (disposing && Directory.Exists(_state)) Directory.Delete(_state, true);
        }
    }
}
