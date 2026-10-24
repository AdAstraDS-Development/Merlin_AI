using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Merlin.Api.Features.Factory;

namespace Merlin.Api.Tests.Integration;

/// <summary>GitHub in memory: records every call, never reaches a server. Owners, existing repositories and failures are set per test.</summary>
public sealed class FakeGitHub : IGitHub
{
    /// <summary>A marker the tests search for in events and logs.</summary>
    public const string Token = "ghs_FAKE_INSTALLATION_TOKEN_3f9a";
    public ConcurrentQueue<string> Calls { get; } = new();
    public ConcurrentDictionary<string, bool> NotInstalled { get; } = new();
    /// <summary>Answers 401 to the token check, as GitHub does for an expired or revoked personal access token.</summary>
    public bool Rejected { get; set; }
    public ConcurrentDictionary<string, bool> Existing { get; } = new();
    public ConcurrentDictionary<string, GitHubException> GenerateFails { get; } = new();

    public Task<string> AccessTokenAsync(string owner, CancellationToken ct)
    {
        Calls.Enqueue($"token {owner}");
        if (Rejected) throw new GitHubException(HttpStatusCode.Unauthorized, "Bad credentials");
        return NotInstalled.ContainsKey(owner) ? throw new GitHubException(HttpStatusCode.NotFound, "Not Found") : Task.FromResult(Token);
    }

    public Task<bool> RepositoryExistsAsync(string token, string owner, string repo, CancellationToken ct)
    {
        Check(token);
        Calls.Enqueue($"exists {owner}/{repo}");
        return Task.FromResult(Existing.ContainsKey($"{owner}/{repo}"));
    }

    public Task<string> GenerateFromTemplateAsync(string token, string template, string owner, string repo, string description, CancellationToken ct)
    {
        Check(token);
        Calls.Enqueue($"generate {template} -> {owner}/{repo}");
        if (GenerateFails.TryGetValue($"{owner}/{repo}", out var error)) throw error;
        Existing[$"{owner}/{repo}"] = true;
        return Task.FromResult($"https://acme.ghe.com/{owner}/{repo}");
    }

    public Task SetTopicsAsync(string token, string owner, string repo, string[] topics, CancellationToken ct)
    {
        Check(token);
        Calls.Enqueue($"topics {owner}/{repo} {string.Join(',', topics)}");
        return Task.CompletedTask;
    }

    public Task SetVisibilityAsync(string token, string owner, string repo, string visibility, CancellationToken ct)
    {
        Check(token);
        Calls.Enqueue($"visibility {owner}/{repo} {visibility}");
        return Task.CompletedTask;
    }

    public string[] CallsFor(string repo) => [.. Calls.Where(c => c.Contains($"/{repo}", StringComparison.Ordinal))];

    private static void Check(string token)
    {
        if (token != Token) throw new InvalidOperationException("The run did not use the installation token.");
    }
}

/// <summary>Every log message the app writes, formatted, so tests can check what never appears in logs.</summary>
public sealed class CapturedLogs : ILoggerProvider
{
    public ConcurrentQueue<string> Messages { get; } = new();
    public ILogger CreateLogger(string categoryName) => new Logger(this);
    public void Dispose() { }

    private sealed class Logger(CapturedLogs owner) : ILogger
    {
        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;
        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter) =>
            owner.Messages.Enqueue(formatter(state, exception) + exception);
    }
}

/// <summary>The app with Merlin's GitHub App configured (a throwaway key) and <see cref="FakeGitHub"/> instead of GitHub.</summary>
public class GitHubFactoryHost : FactoryHost
{
    public FakeGitHub GitHub { get; } = new();
    public CapturedLogs Logs { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        Credentials(builder);
        builder.ConfigureLogging(l => l.AddProvider(Logs)).ConfigureTestServices(s => s.AddSingleton<IGitHub>(GitHub));
    }

    protected virtual void Credentials(IWebHostBuilder builder)
    {
        using var rsa = RSA.Create(2048);
        builder.UseSetting("Factory:GitHub:AppId", "123456").UseSetting("Factory:GitHub:PrivateKey", rsa.ExportRSAPrivateKeyPem());
    }
}

/// <summary>The app with a personal access token instead of the GitHub App (<c>Factory:GitHub:Auth</c> = <c>Token</c>).</summary>
public sealed class TokenFactoryHost : GitHubFactoryHost
{
    protected override void Credentials(IWebHostBuilder builder) =>
        builder.UseSetting("Factory:GitHub:Auth", "Token").UseSetting("Factory:GitHub:Token", FakeGitHub.Token);
}

/// <summary>Token mode chosen, but no token configured.</summary>
public sealed class EmptyTokenFactoryHost : FactoryHost
{
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Factory:GitHub:Auth", "Token");
    }
}

public static class FactoryRuns
{
    public static Task<HttpResponseMessage> Post(HttpClient client, JsonObject request, string? confirmation) =>
        client.PostAsJsonAsync("/api/runs", new JsonObject { ["request"] = request, ["mode"] = "Factory", ["confirmation"] = confirmation }, TestContext.Current.CancellationToken);

    public static async Task<string> Start(HttpClient client, JsonObject request)
    {
        var response = await Post(client, request, request["appSlug"]!.GetValue<string>());
        Assert.Equal(HttpStatusCode.Accepted, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<JsonObject>(TestContext.Current.CancellationToken))!["runId"]!.GetValue<string>();
    }
}
