using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;

namespace Merlin.Api.Features.Factory;

/// <summary>
/// How Merlin acts in GitHub (<c>Factory:GitHub</c>): as its own GitHub App (<see cref="AppId"/> and <see cref="PrivateKey"/>) or with a
/// personal access token (<see cref="Token"/>), chosen by <see cref="Auth"/>. Without the credential of the chosen kind the Factory mode is unavailable.
/// The private key and the token are secrets: user secrets locally, Key Vault references in Azure.
/// </summary>
public sealed class GitHubOptions
{
    public const string App = "App";
    public const string Pat = "Token";

    /// <summary><c>App</c> (default): installation tokens of Merlin's GitHub App. <c>Token</c>: a personal access token.</summary>
    public string Auth { get; set; } = App;
    public string AppId { get; set; } = "";
    public string PrivateKey { get; set; } = "";
    /// <summary>Personal access token used when <see cref="Auth"/> is <c>Token</c>.</summary>
    public string Token { get; set; } = "";
    /// <summary>The template repository new apps are generated from, as <c>owner/name</c>.</summary>
    public string TemplateRepository { get; set; } = "";
    /// <summary>REST API base; empty derives it from <see cref="FactoryOptions.GithubHost"/>.</summary>
    public string ApiUrl { get; set; } = "";

    public bool UsesToken => Auth == Pat;
    public bool Configured => UsesToken ? Token.Length > 0 : AppId.Length > 0 && PrivateKey.Length > 0;

    /// <summary>Why the Factory mode is unavailable, or null when it is configured.</summary>
    public string? NotConfiguredReason => Configured ? null : UsesToken ? "The GitHub token is not configured." : "The GitHub App is not configured.";

    /// <summary><c>api.github.com</c> for github.com, <c>api.&lt;host&gt;</c> for GitHub Enterprise Cloud with data residency, <c>/api/v3</c> for a server.</summary>
    public Uri ApiBase(string githubHost)
    {
        var url = ApiUrl.Length > 0 ? ApiUrl
            : githubHost.Equals("github.com", StringComparison.OrdinalIgnoreCase) ? "https://api.github.com"
            : githubHost.EndsWith(".ghe.com", StringComparison.OrdinalIgnoreCase) ? $"https://api.{githubHost}"
            : $"https://{githubHost}/api/v3";
        return new Uri(url.TrimEnd('/') + "/");
    }

    public IEnumerable<ValidationResult> Validate()
    {
        if (Auth is not (App or Pat))
        {
            yield return new ValidationResult("Factory:GitHub:Auth must be App or Token.");
            yield break;
        }
        if (Configured && !TemplateRepository.Contains('/')) yield return new ValidationResult("Factory:GitHub:TemplateRepository must be owner/name.");
        if (ApiUrl.Length > 0 && !(Uri.TryCreate(ApiUrl, UriKind.Absolute, out var api) && api.Scheme == Uri.UriSchemeHttps))
            yield return new ValidationResult("Factory:GitHub:ApiUrl must be an HTTPS URL.");
        if (UsesToken)
        {
            // The message never contains the token.
            if (Token.Any(char.IsWhiteSpace)) yield return new ValidationResult("Factory:GitHub:Token must not contain spaces or line breaks.");
            yield break;
        }
        if (AppId.Length > 0 != PrivateKey.Length > 0)
        {
            yield return new ValidationResult("Configure both Factory:GitHub:AppId and Factory:GitHub:PrivateKey, or neither.");
            yield break;
        }
        if (!Configured) yield break;
        if (!long.TryParse(AppId, out var id) || id <= 0) yield return new ValidationResult("Factory:GitHub:AppId must be the numeric ID of the GitHub App.");
        using var rsa = RSA.Create();
        var parsed = true;
        try { rsa.ImportFromPem(PrivateKey); }
        catch (ArgumentException) { parsed = false; }
        catch (CryptographicException) { parsed = false; }
        // The message never contains the key.
        if (!parsed) yield return new ValidationResult("Factory:GitHub:PrivateKey is not an RSA private key in PEM format.");
    }
}
