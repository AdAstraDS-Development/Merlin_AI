using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Merlin.Api.Features.Factory;

namespace Merlin.Api.Tests.Unit;

public sealed class GitHubClientTests
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    /// <summary>Answers requests in order and records them with their bodies.</summary>
    private sealed class Stub(params (HttpStatusCode Status, string Body)[] answers) : HttpMessageHandler
    {
        private int _next;
        public List<(HttpRequestMessage Request, string? Body)> Requests { get; } = [];

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add((request, request.Content is null ? null : await request.Content.ReadAsStringAsync(cancellationToken)));
            var (status, body) = answers[_next++];
            return new HttpResponseMessage(status) { Content = new StringContent(body, Encoding.UTF8, "application/json") };
        }
    }

    private static (GitHubClient Client, RSA Key) Client(Stub stub, string host = "acme.ghe.com")
    {
        var rsa = RSA.Create(2048);
        var options = new FactoryOptions { GithubHost = host, GitHub = new GitHubOptions { AppId = "123456", PrivateKey = rsa.ExportRSAPrivateKeyPem(), TemplateRepository = "acme-factory/ai-template-dotnet" } };
        return (new GitHubClient(new HttpClient(stub), Options.Create(options), TimeProvider.System), rsa);
    }

    private static byte[] FromBase64Url(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s + new string('=', (4 - s.Length % 4) % 4));
    }

    [Theory]
    [InlineData("github.com", "", "https://api.github.com/")]
    [InlineData("acme.ghe.com", "", "https://api.acme.ghe.com/")]
    [InlineData("git.example.com", "", "https://git.example.com/api/v3/")]
    [InlineData("acme.ghe.com", "https://api.example.test/v1", "https://api.example.test/v1/")]
    public void UC08_ApiBaseFollowsGitHubHost(string host, string apiUrl, string expected) =>
        Assert.Equal(expected, new GitHubOptions { ApiUrl = apiUrl }.ApiBase(host).ToString());

    [Fact]
    public void UC08_GitHubSettingsAreAllOrNothing()
    {
        Assert.Empty(new GitHubOptions().Validate());
        Assert.NotEmpty(new GitHubOptions { AppId = "1" }.Validate());
        var bad = new GitHubOptions { AppId = "1", PrivateKey = "-----BEGIN RSA PRIVATE KEY-----\nnot a key\n-----END RSA PRIVATE KEY-----", TemplateRepository = "a/b" }.Validate().ToList();
        Assert.Single(bad);
        Assert.DoesNotContain("not a key", bad[0].ErrorMessage);
        using var rsa = RSA.Create(2048);
        Assert.Empty(new GitHubOptions { AppId = "1", PrivateKey = rsa.ExportRSAPrivateKeyPem(), TemplateRepository = "a/b" }.Validate());
    }

    [Fact]
    public async Task UC08_InstallationTokenUsesSignedAppJwt()
    {
        var stub = new Stub((HttpStatusCode.OK, """{"id":42}"""), (HttpStatusCode.Created, """{"token":"ghs_abc"}"""));
        var (client, key) = Client(stub);
        Assert.Equal("ghs_abc", await client.AccessTokenAsync("acme-factory", Ct));

        Assert.Equal("https://api.acme.ghe.com/orgs/acme-factory/installation", stub.Requests[0].Request.RequestUri!.ToString());
        Assert.Equal(HttpMethod.Post, stub.Requests[1].Request.Method);
        Assert.Equal("https://api.acme.ghe.com/app/installations/42/access_tokens", stub.Requests[1].Request.RequestUri!.ToString());
        var jwt = stub.Requests[0].Request.Headers.Authorization!.Parameter!.Split('.');
        Assert.True(key.VerifyData(Encoding.ASCII.GetBytes($"{jwt[0]}.{jwt[1]}"), FromBase64Url(jwt[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1));
        var payload = JsonNode.Parse(FromBase64Url(jwt[1]))!;
        Assert.Equal("123456", payload["iss"]!.GetValue<string>());
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        Assert.InRange(payload["exp"]!.GetValue<long>() - now, 500, 600);
        Assert.True(payload["iat"]!.GetValue<long>() < now);
    }

    [Fact]
    public async Task UC08_GenerateSendsTemplateRequest()
    {
        var stub = new Stub((HttpStatusCode.Created, """{"html_url":"https://acme.ghe.com/acme-factory/fleet-portal"}"""));
        var (client, _) = Client(stub);
        var url = await client.GenerateFromTemplateAsync("ghs_abc", "acme-factory/ai-template-dotnet", "acme-factory", "fleet-portal", "Tracks vehicles.", Ct);

        Assert.Equal("https://acme.ghe.com/acme-factory/fleet-portal", url);
        var (request, body) = stub.Requests.Single();
        Assert.Equal("https://api.acme.ghe.com/repos/acme-factory/ai-template-dotnet/generate", request.RequestUri!.ToString());
        Assert.Equal("ghs_abc", request.Headers.Authorization!.Parameter);
        var json = JsonNode.Parse(body!)!;
        Assert.Equal("acme-factory", json["owner"]!.GetValue<string>());
        Assert.Equal("fleet-portal", json["name"]!.GetValue<string>());
        Assert.True(json["private"]!.GetValue<bool>());
        Assert.False(json["include_all_branches"]!.GetValue<bool>());
    }

    [Fact]
    public async Task UC08_RepositoryExistsOnlyFalseFor404()
    {
        var (client, _) = Client(new Stub((HttpStatusCode.NotFound, """{"message":"Not Found"}"""), (HttpStatusCode.OK, "{}"), (HttpStatusCode.Forbidden, """{"message":"Forbidden"}""")));
        Assert.False(await client.RepositoryExistsAsync("t", "o", "r", Ct));
        Assert.True(await client.RepositoryExistsAsync("t", "o", "r", Ct));
        var ex = await Assert.ThrowsAsync<GitHubException>(() => client.RepositoryExistsAsync("t", "o", "r", Ct));
        Assert.Equal(HttpStatusCode.Forbidden, ex.Status);
        Assert.Equal("Forbidden", ex.Message);
    }

    [Fact]
    public async Task UC08_TopicsAndVisibilityBodies()
    {
        var stub = new Stub((HttpStatusCode.OK, """{"names":["project-factory"]}"""), (HttpStatusCode.OK, "{}"));
        var (client, _) = Client(stub);
        await client.SetTopicsAsync("t", "acme-factory", "fleet-portal", ["project-factory"], Ct);
        await client.SetVisibilityAsync("t", "acme-factory", "fleet-portal", "internal", Ct);

        Assert.Equal(HttpMethod.Put, stub.Requests[0].Request.Method);
        Assert.Equal("""{"names":["project-factory"]}""", stub.Requests[0].Body);
        Assert.Equal(HttpMethod.Patch, stub.Requests[1].Request.Method);
        Assert.Equal("https://api.acme.ghe.com/repos/acme-factory/fleet-portal", stub.Requests[1].Request.RequestUri!.ToString());
        Assert.Equal("""{"visibility":"internal"}""", stub.Requests[1].Body);
    }

    private static GitHubClient TokenClient(Stub stub, string token = "github_pat_abc") =>
        new(new HttpClient(stub), Options.Create(new FactoryOptions
        {
            GithubHost = "acme.ghe.com",
            GitHub = new GitHubOptions { Auth = "Token", Token = token, TemplateRepository = "acme-factory/ai-template-dotnet" },
        }), TimeProvider.System);

    [Fact]
    public async Task UC08_TokenModeChecksAndUsesPersonalAccessToken()
    {
        var stub = new Stub((HttpStatusCode.OK, """{"login":"merlin-bot"}"""));
        Assert.Equal("github_pat_abc", await TokenClient(stub).AccessTokenAsync("acme-factory", Ct));

        var (request, _) = stub.Requests.Single();
        Assert.Equal(HttpMethod.Get, request.Method);
        Assert.Equal("https://api.acme.ghe.com/user", request.RequestUri!.ToString());
        Assert.Equal("github_pat_abc", request.Headers.Authorization!.Parameter);
    }

    [Fact]
    public async Task UC08_TokenModeReportsRejectedToken()
    {
        var ex = await Assert.ThrowsAsync<GitHubException>(() => TokenClient(new Stub((HttpStatusCode.Unauthorized, """{"message":"Bad credentials"}"""))).AccessTokenAsync("acme-factory", Ct));
        Assert.Equal(HttpStatusCode.Unauthorized, ex.Status);
        Assert.DoesNotContain("github_pat_abc", ex.Message);
    }

    [Fact]
    public void UC08_AuthSettingChoosesCredential()
    {
        Assert.Single(new GitHubOptions { Auth = "Pat" }.Validate());
        var empty = new GitHubOptions { Auth = "Token", TemplateRepository = "a/b" };
        Assert.Empty(empty.Validate());
        Assert.False(empty.Configured);
        Assert.Equal("The GitHub token is not configured.", empty.NotConfiguredReason);
        var token = new GitHubOptions { Auth = "Token", Token = "github_pat_abc", TemplateRepository = "a/b" };
        Assert.Empty(token.Validate());
        Assert.True(token.Configured);
        // An App ID left over from App mode does not matter in token mode.
        Assert.Empty(new GitHubOptions { Auth = "Token", Token = "github_pat_abc", AppId = "1", TemplateRepository = "a/b" }.Validate());
        var spaced = new GitHubOptions { Auth = "Token", Token = "github_pat_abc\n", TemplateRepository = "a/b" }.Validate().ToList();
        Assert.Single(spaced);
        Assert.DoesNotContain("github_pat_abc", spaced[0].ErrorMessage);
        Assert.Equal("The GitHub App is not configured.", new GitHubOptions().NotConfiguredReason);
    }
}
