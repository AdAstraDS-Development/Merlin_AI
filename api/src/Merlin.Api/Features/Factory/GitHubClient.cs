using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;

namespace Merlin.Api.Features.Factory;

/// <summary>An answer from GitHub other than the expected one. Carries only the status and GitHub's message, never tokens or headers.</summary>
public sealed class GitHubException(HttpStatusCode status, string message) : Exception(message)
{
    public HttpStatusCode Status { get; } = status;
}

/// <summary>The GitHub calls a Factory run makes (UC-08). Every call except the token takes the token from <see cref="AccessTokenAsync"/>.</summary>
public interface IGitHub
{
    /// <summary>
    /// The token for <paramref name="owner"/>: a short-lived installation token of Merlin's GitHub App (404 when the App is not installed there),
    /// or the configured personal access token after checking that GitHub accepts it (401 when it does not).
    /// </summary>
    Task<string> AccessTokenAsync(string owner, CancellationToken ct);
    /// <summary>False only for 404; any other answer than 200 throws.</summary>
    Task<bool> RepositoryExistsAsync(string token, string owner, string repo, CancellationToken ct);
    /// <summary>Creates <paramref name="owner"/>/<paramref name="repo"/> from the template, private, and returns its web URL.</summary>
    Task<string> GenerateFromTemplateAsync(string token, string template, string owner, string repo, string description, CancellationToken ct);
    Task SetTopicsAsync(string token, string owner, string repo, string[] topics, CancellationToken ct);
    Task SetVisibilityAsync(string token, string owner, string repo, string visibility, CancellationToken ct);
}

/// <summary>
/// GitHub REST calls, as chosen by <c>Factory:GitHub:Auth</c>: as Merlin's GitHub App (an RS256 app JWT for the installation token,
/// the installation token for everything else) or with a personal access token.
/// </summary>
public sealed class GitHubClient(HttpClient http, IOptions<FactoryOptions> options, TimeProvider time) : IGitHub
{
    private Uri Base => options.Value.GitHub.ApiBase(options.Value.GithubHost);

    public async Task<string> AccessTokenAsync(string owner, CancellationToken ct)
    {
        var github = options.Value.GitHub;
        if (github.UsesToken)
        {
            await SendAsync(HttpMethod.Get, "user", github.Token, null, ct);
            return github.Token;
        }
        var jwt = AppJwt();
        var installation = await SendAsync(HttpMethod.Get, $"orgs/{Uri.EscapeDataString(owner)}/installation", jwt, null, ct);
        var id = installation["id"]!.GetValue<long>();
        var token = await SendAsync(HttpMethod.Post, $"app/installations/{id}/access_tokens", jwt, new JsonObject(), ct);
        return token["token"]!.GetValue<string>();
    }

    public async Task<bool> RepositoryExistsAsync(string token, string owner, string repo, CancellationToken ct)
    {
        try
        {
            await SendAsync(HttpMethod.Get, Repo(owner, repo), token, null, ct);
            return true;
        }
        catch (GitHubException ex) when (ex.Status == HttpStatusCode.NotFound) { return false; }
    }

    public async Task<string> GenerateFromTemplateAsync(string token, string template, string owner, string repo, string description, CancellationToken ct)
    {
        var parts = template.Split('/', 2);
        var body = new JsonObject
        {
            ["owner"] = owner,
            ["name"] = repo,
            ["description"] = description,
            ["private"] = true,
            ["include_all_branches"] = false,
        };
        var created = await SendAsync(HttpMethod.Post, $"{Repo(parts[0], parts[1])}/generate", token, body, ct);
        return created["html_url"]!.GetValue<string>();
    }

    public Task SetTopicsAsync(string token, string owner, string repo, string[] topics, CancellationToken ct) =>
        SendAsync(HttpMethod.Put, $"{Repo(owner, repo)}/topics", token, new JsonObject { ["names"] = new JsonArray([.. topics.Select(t => (JsonNode)t)]) }, ct);

    public Task SetVisibilityAsync(string token, string owner, string repo, string visibility, CancellationToken ct) =>
        SendAsync(HttpMethod.Patch, Repo(owner, repo), token, new JsonObject { ["visibility"] = visibility }, ct);

    private static string Repo(string owner, string repo) => $"repos/{Uri.EscapeDataString(owner)}/{Uri.EscapeDataString(repo)}";

    private async Task<JsonObject> SendAsync(HttpMethod method, string path, string bearer, JsonObject? body, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(method, new Uri(Base, path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearer);
        request.Headers.Accept.ParseAdd("application/vnd.github+json");
        request.Headers.Add("X-GitHub-Api-Version", "2022-11-28");
        request.Headers.UserAgent.ParseAdd("Merlin");
        if (body is not null) request.Content = JsonContent.Create(body);
        using var response = await http.SendAsync(request, ct);
        JsonNode? json = null;
        try { json = await response.Content.ReadFromJsonAsync<JsonNode>(ct); }
        catch (System.Text.Json.JsonException) { }
        if (!response.IsSuccessStatusCode)
        {
            var message = json?["message"] is JsonValue m && m.TryGetValue<string>(out var text) ? text : response.ReasonPhrase ?? "No message.";
            throw new GitHubException(response.StatusCode, message.Length > 300 ? message[..300] : message);
        }
        return json as JsonObject ?? [];
    }

    /// <summary>The app JWT: issued a minute in the past against clock drift, valid for 9 minutes (GitHub allows 10).</summary>
    private string AppJwt()
    {
        var now = time.GetUtcNow().ToUnixTimeSeconds();
        var header = Base64Url("""{"alg":"RS256","typ":"JWT"}"""u8.ToArray());
        var payload = Base64Url(Encoding.UTF8.GetBytes(new JsonObject { ["iat"] = now - 60, ["exp"] = now + 540, ["iss"] = options.Value.GitHub.AppId }.ToJsonString()));
        using var rsa = RSA.Create();
        rsa.ImportFromPem(options.Value.GitHub.PrivateKey);
        var signature = rsa.SignData(Encoding.ASCII.GetBytes($"{header}.{payload}"), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        return $"{header}.{payload}.{Base64Url(signature)}";
    }

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
